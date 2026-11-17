import type { GallyLibraryHandle, GallyLibraryStats } from '../../src/react/index.js'
import { BUILD, config, MOUNT_MARK, type ImageNetwork, type Renderer } from '../config'
import { SCORE_VERSION, scoreRun, type ScoreBreakdown } from './score'

/**
 * Gally library benchmark.
 *
 * One scripted session from a cold page load against the library demo, measuring what users feel:
 * how fast the first screen fills and sharpens after the library mounts, how long each zoom level
 * change blocks the main thread, how many tiles are blank while pinching level by level and while
 * flick-scrolling, how fast the screen fills afterwards, and main-thread blocking. A score (see
 * `score.ts`) sums it up.
 *
 * The script steps every 16 ms on timers rather than animation frames, so it measures Gally even
 * when the host isn't painting steadily. If timers stall for over 250 ms, or the page is hidden
 * (browsers throttle hidden pages), the run is marked invalid.
 */

export type BenchConfig = {
  /** What was measured: the library (missing on older runs), or one of the canvases. */
  renderer?: Renderer
  /** How a canvas run moved the camera: synthetic touches, or trackpad wheel events. */
  input?: 'touch' | 'wheel'
  engine: string
  images: string
  net: ImageNetwork
  viewport: string
  dpr: number
  browser: string
  build?: string
  label?: string
  /** False when run without the idle probe (`?probe=0`): no capacity numbers. */
  probe?: boolean
}

export type BenchResult = {
  id: string
  at: string
  config: BenchConfig
  /** Missing on runs scored before versioning (version 1). */
  scoreVersion?: number
  score: ScoreBreakdown
  pauses: number
  hidden?: boolean
  firstScreenFilledMs: number | null
  firstScreenSharpMs: number | null
  /** Time to fetch the first screen's images directly, all at once: what the network allows. */
  networkFloorMs?: number
  zoom: { steps: number; commitAvgMs: number; commitMaxMs: number; blankAvgPct: number; blankMaxPct: number; settleSharpMs: number | null }
  scroll: { blankAvgPct: number; blankMaxPct: number; sharpAfterStopMs: number | null }
  frames: { count: number; p50: number; p95: number; max: number; longTasks: number; blockingMs: number }
  /** Frame rate the display showed while pinching and flicking (capped at its refresh rate). */
  fps?: Record<'pinch' | 'scroll' | 'motion', FrameRate>
  /**
   * Frame rate the main thread could sustain while pinching and flicking: 1000 / its work per frame.
   * `overBudget` counts frames over the 240 fps budget (4.17 ms).
   */
  capacity?: Record<'pinch' | 'scroll' | 'motion', FrameRate> & {
    /** The same measure with nothing moving: what the browser and machine take on their own. */
    idle?: FrameRate
  }
  /** The slowest frames with the scripts that ran in them (Chrome's Long Animation Frames API). */
  longFrameDetails: Array<{ at: number; phase: string; duration: number; blocking: number; render: number; scripts: string[] }>
  loader: { started: number; loaded: number; aborted: number; dropped: number; failed: number; megabytes: number; medianLoadMs: number; p95LoadMs: number; network: string }
}

/** Time per zoom level while pinching through levels, about what a steady trackpad pinch takes. */
const PINCH_STEP_MS = 250
/** A flick: initial speed in screens per second, and how fast it decays (momentum time constant). */
const FLICK_SPEED = 8
const FLICK_DECAY_MS = 400
const FLICK_COUNT = 2
/** A flick is over once it slows below this many screens per second. */
const FLICK_END_SPEED = 0.5
const FLICK_REST_MS = 300
const PAUSE_MS = 250
/** Idle time measured before moving, for the environment's own per-frame work. */
const IDLE_MS = 1000
const WAIT_LIMIT_MS = 20000

export type FrameRate = { frames: number; avg: number; p95: number; p99: number; worstMs: number; overBudget: number }

export const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits
export const average = (values: number[] = []) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0)

export function currentConfig(): BenchConfig {
  return {
    ...(config.renderer === 'photos' ? {} : { renderer: config.renderer, input: config.input }),
    // Canvas runs name their component, so they never compare with library runs.
    engine: config.renderer === 'photos' ? config.engine : config.renderer === 'stable' ? 'GallyCanvas' : 'GallyHybridCanvas',
    images: config.images,
    net: config.net,
    viewport: `${innerWidth}×${innerHeight}`,
    dpr: devicePixelRatio,
    browser: browserName(),
    build: BUILD,
    ...(config.label ? { label: config.label } : {}),
    ...(config.probe ? {} : { probe: false }),
  }
}

function browserName() {
  const ua = navigator.userAgent
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Edg\//.test(ua)) return 'Edge'
  if (/Chrome\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return 'Other'
}

/** Timer-driven clock that records the blank share of the screen per phase on every step. */
export function createClock(stats: () => Pick<GallyLibraryStats, 'visibleTiles' | 'filledTiles'>) {
  const clock = {
    last: performance.now(),
    pauses: 0,
    phase: '',
    blank: {} as Record<string, number[]>,
    async tick() {
      await new Promise((resolve) => setTimeout(resolve, 16))
      const now = performance.now()
      const delta = now - clock.last
      clock.last = now
      if (delta > PAUSE_MS) clock.pauses++
      if (clock.phase) {
        const s = stats()
        ;(clock.blank[clock.phase] ??= []).push(s.visibleTiles ? 1 - s.filledTiles / s.visibleTiles : 0)
      }
      return delta
    },
    async sleep(ms: number) {
      const end = performance.now() + ms
      while (performance.now() < end) await clock.tick()
    },
    /** Milliseconds until `check` passes, or null after the wait limit. */
    async waitFor(check: () => boolean) {
      const start = performance.now()
      while (performance.now() - start < WAIT_LIMIT_MS) {
        if (check()) return Math.round(performance.now() - start)
        await clock.tick()
      }
      return null
    },
  }
  return clock
}

/** A gap longer than this between idle probes means the main thread was busy (timers are coarsened to 0.1 ms). */
const PROBE_IDLE_MS = 0.15
/**
 * Each probe task holds the thread this long before yielding. Without it the probe runs thousands of
 * times per frame, and the garbage from its messages adds collections to the frames it measures.
 */
const PROBE_HOLD_MS = 0.1
/** A frame fits 240 fps when its main-thread work takes at most this long. */
export const FRAME_BUDGET_MS = 1000 / 240

/**
 * Frames while the host renders, each tagged with the phase it ended in, with two measures:
 *
 * - `ms`: time since the previous frame. Capped by the display's refresh rate (60–120 Hz), so it
 *   can't show whether Gally would keep up with a faster display.
 * - `cost`: main-thread time spent between the previous frame and this one (event handlers, React,
 *   style, layout, paint recording), measured during motion phases by an idle probe: a chain of
 *   message tasks that runs whenever the main thread is free, so any gap between two probes is
 *   work. 1000 / cost is the frame rate the main thread could sustain at that frame. It is a
 *   scheduling-gap proxy: gaps under `PROBE_IDLE_MS` are missed, and anything that keeps the
 *   thread from running a normal-priority task (including the operating system) counts as work.
 *   Background-priority tasks wait while it runs, so Gally schedules none.
 */
export function sampleFrames(phase: () => string) {
  const frames: Array<{ start: number; end: number; phase: string }> = []
  /** Busy spans as flat [start, end, start, end, …], in time order. */
  const busy: number[] = []
  const probe = new MessageChannel()
  let probing = false
  let probeLast = 0
  probe.port1.onmessage = () => {
    const start = performance.now()
    if (start - probeLast > PROBE_IDLE_MS) busy.push(probeLast, start)
    // Gaps run from the end of one probe task to the start of the next, so holding isn't work.
    let now = start
    while (now - start < PROBE_HOLD_MS) now = performance.now()
    probeLast = now
    if (probing && phase()) probe.port2.postMessage(0)
    else probing = false
  }
  let last = 0
  let running = true
  const loop = (now: number) => {
    if (!running) return
    const current = phase()
    if (last) frames.push({ start: last, end: now, phase: current })
    last = now
    if (current && !probing && config.probe) {
      probing = true
      probeLast = performance.now()
      probe.port2.postMessage(0)
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  return () => {
    running = false
    probing = false
    probe.port1.close()
    // Main-thread work inside each frame: the overlap of busy spans with it.
    let span = 0
    return frames.map((frame) => {
      let cost = 0
      while (span < busy.length && busy[span + 1]! <= frame.start) span += 2
      for (let i = span; i < busy.length && busy[i]! < frame.end; i += 2) {
        cost += Math.min(frame.end, busy[i + 1]!) - Math.max(frame.start, busy[i]!)
      }
      return { ms: frame.end - frame.start, cost, phase: frame.phase }
    })
  }
}

/** Frame rates from per-frame times: average, and at the 95th / 99th percentile frame. */
export function frameRate(times: number[]): FrameRate {
  const sorted = [...times].sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
  const total = times.reduce((sum, ms) => sum + ms, 0)
  const fps = (ms: number) => (ms > 0 ? round(1000 / ms) : 0)
  return {
    frames: times.length,
    avg: total ? round((times.length * 1000) / total) : 0,
    p95: fps(at(0.95)),
    p99: fps(at(0.99)),
    worstMs: round(sorted.at(-1) ?? 0),
    overBudget: times.filter((ms) => ms > FRAME_BUDGET_MS).length,
  }
}

export type LoafScript = { invoker?: string; sourceFunctionName?: string; sourceURL?: string; sourceCharPosition?: number; duration: number; forcedStyleAndLayoutDuration?: number }
export type LoafEntry = PerformanceEntry & { blockingDuration?: number; renderStart?: number; scripts?: LoafScript[] }

/** Observe a performance entry type from now on; unsupported types (outside Chromium) yield nothing. */
export function observe<Entry extends PerformanceEntry>(type: string, onEntry: (entry: Entry) => void) {
  const start = performance.now()
  let observer: PerformanceObserver | undefined
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Entry[]) if (entry.startTime >= start) onEntry(entry)
    })
    observer.observe({ type, buffered: false })
  } catch {
    // Not supported in this browser.
  }
  return () => observer?.disconnect()
}

export const describeScript = (script: LoafScript) =>
  `${Math.round(script.duration)}ms${script.forcedStyleAndLayoutDuration ? ` (forced layout ${Math.round(script.forcedStyleAndLayoutDuration)})` : ''} ${script.sourceFunctionName || script.invoker || '?'} (${(script.sourceURL ?? '').split('/').pop()?.split('?')[0]}:${script.sourceCharPosition ?? ''})`

export async function runBenchmark(library: GallyLibraryHandle): Promise<BenchResult> {
  const stats = () => library.getStats()
  const complete = (key: 'filledTiles' | 'sharpTiles') => () => {
    const s = stats()
    return s.visibleTiles > 0 && s[key] >= s.visibleTiles
  }
  const clock = createClock(stats)
  let hidden = document.visibilityState !== 'visible'
  const onVisibility = () => {
    if (document.visibilityState !== 'visible') hidden = true
  }
  document.addEventListener('visibilitychange', onVisibility)
  // Timings start when the library mounted, since it starts loading images then.
  const runStart = performance.getEntriesByName(MOUNT_MARK).at(-1)?.startTime ?? performance.now()
  const stopFrames = sampleFrames(() => clock.phase)
  const phases: Array<{ at: number; name: string }> = [{ at: runStart, name: 'first screen' }]
  const mark = (name: string) => {
    phases.push({ at: performance.now(), name })
    performance.mark(`gally-bench:${name}`)
  }
  const phaseAt = (time: number) => [...phases].reverse().find((p) => p.at <= time)?.name ?? ''
  const longTasks: Array<{ duration: number }> = []
  const stopLongTasks = observe('longtask', (entry) => longTasks.push({ duration: entry.duration }))
  const longFrames: BenchResult['longFrameDetails'] = []
  const stopLongFrames = observe<LoafEntry>('long-animation-frame', (entry) => {
    if (entry.duration <= 50) return
    longFrames.push({
      at: Math.round(entry.startTime - runStart),
      phase: phaseAt(entry.startTime),
      duration: Math.round(entry.duration),
      blocking: Math.round(entry.blockingDuration ?? 0),
      render: entry.renderStart ? Math.round(entry.startTime + entry.duration - entry.renderStart) : 0,
      scripts: [...(entry.scripts ?? [])].sort((a, b) => b.duration - a.duration).slice(0, 3).map(describeScript),
    })
  })
  const scroller = library.getScrollElement()!

  // 1. First screen, from the moment the library mounted.
  const sinceMount = (waited: number | null) => (waited == null ? null : Math.round(performance.now() - runStart))
  const firstScreenFilledMs = sinceMount(await clock.waitFor(complete('filledTiles')))
  const sharpAt = firstScreenFilledMs == null ? null : sinceMount(await clock.waitFor(complete('sharpTiles')))
  const firstScreenSources = library.getVisibleWindow().sources
  await clock.sleep(200)

  // Idle: the browser's own main-thread work with nothing moving, the floor under every frame.
  mark('idle')
  clock.phase = 'idle'
  await clock.sleep(IDLE_MS)
  clock.phase = ''

  // 2. Pinch out level by level to the densest level, then back in to where we started. Each level
  // change is timed as the engine's synchronous work plus the style and layout of the new grid.
  mark('pinch')
  const level = () => stats().level
  const startLevel = level()
  const commits: number[] = []
  const step = async (zoom: () => void) => {
    const before = level()
    const started = performance.now()
    zoom()
    if (level() === before) return false
    void scroller.offsetHeight
    commits.push(performance.now() - started)
    await clock.sleep(PINCH_STEP_MS)
    return true
  }
  clock.phase = 'pinch'
  while (await step(() => library.zoomOut()));
  while (level() > startLevel) await step(() => library.zoomIn())
  clock.phase = ''
  mark('settle')
  const settleSharpMs = await clock.waitFor(complete('sharpTiles'))
  await clock.sleep(200)

  // 3. Momentum flicks up the library with short rests, then time until the screen is sharp.
  mark('flick')
  clock.phase = 'scroll'
  for (let flick = 0; flick < FLICK_COUNT; flick++) {
    let speed = FLICK_SPEED * innerHeight
    while (speed > FLICK_END_SPEED * innerHeight) {
      const dt = Math.min(50, await clock.tick())
      scroller.scrollBy(0, (-speed * dt) / 1000)
      speed *= Math.exp(-dt / FLICK_DECAY_MS)
    }
    if (flick < FLICK_COUNT - 1) await clock.sleep(FLICK_REST_MS)
  }
  clock.phase = ''
  mark('sharpen')
  const sharpAfterStopMs = await clock.waitFor(complete('sharpTiles'))

  // 4. Network floor: the same first-screen images fetched again, uncached and all at once, with no
  // engine involved. First-screen time is scored as Gally's overhead above this.
  mark('floor')
  const floorStart = performance.now()
  const salt = Math.random().toString(36).slice(2)
  await Promise.all(
    firstScreenSources.map((src) =>
      fetch(`${src}${src.includes('?') ? '&' : '?'}floor=${salt}`, { cache: 'no-store' })
        .then((response) => response.blob())
        .catch(() => null),
    ),
  )
  const networkFloorMs = Math.round(performance.now() - floorStart)

  document.removeEventListener('visibilitychange', onVisibility)
  stopLongTasks()
  stopLongFrames()
  const frameSamples = stopFrames()
  const frameTimes = frameSamples.map((frame) => frame.ms)
  const timesIn = (...names: string[]) => frameSamples.filter((frame) => names.includes(frame.phase)).map((frame) => frame.ms)
  const costsIn = (...names: string[]) => frameSamples.filter((frame) => names.includes(frame.phase)).map((frame) => frame.cost)

  const sorted = [...frameTimes].sort((a, b) => a - b)
  const pct = (p: number) => round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0)
  const loader = stats().loader
  const cfg = currentConfig()
  const blockingMs = longTasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0)
  const zoom = {
    steps: commits.length,
    commitAvgMs: round(average(commits)),
    commitMaxMs: round(Math.max(0, ...commits)),
    blankAvgPct: round(average(clock.blank.pinch) * 100),
    blankMaxPct: round(Math.max(0, ...(clock.blank.pinch ?? [])) * 100),
    settleSharpMs,
  }
  const scroll = {
    blankAvgPct: round(average(clock.blank.scroll) * 100),
    blankMaxPct: round(Math.max(0, ...(clock.blank.scroll ?? [])) * 100),
    sharpAfterStopMs,
  }

  return {
    id: `${Date.now()}`,
    at: new Date().toISOString(),
    config: cfg,
    scoreVersion: SCORE_VERSION,
    score: scoreRun(
      {
        firstScreenFilledMs,
        firstScreenSharpMs: sharpAt,
        firstScreenOverheadMs: sharpAt == null ? null : Math.max(0, sharpAt - networkFloorMs),
        commitAvgMs: zoom.commitAvgMs,
        commitMaxMs: zoom.commitMaxMs,
        pinchBlankAvgPct: zoom.blankAvgPct,
        settleSharpMs,
        scrollBlankAvgPct: scroll.blankAvgPct,
        sharpAfterFlickMs: sharpAfterStopMs,
        blockingMs,
      },
      cfg.net,
    ),
    pauses: clock.pauses,
    hidden,
    longFrameDetails: longFrames.sort((a, b) => b.duration - a.duration).slice(0, 8),
    firstScreenFilledMs,
    firstScreenSharpMs: sharpAt,
    networkFloorMs,
    zoom,
    scroll,
    frames: {
      count: frameTimes.length,
      p50: pct(0.5),
      p95: pct(0.95),
      max: round(sorted[sorted.length - 1] ?? 0),
      longTasks: longTasks.length,
      blockingMs,
    },
    fps: {
      pinch: frameRate(timesIn('pinch')),
      scroll: frameRate(timesIn('scroll')),
      motion: frameRate(timesIn('pinch', 'scroll')),
    },
    // Without the probe there is no capacity to report.
    ...(config.probe
      ? {
          capacity: {
            idle: frameRate(costsIn('idle')),
            pinch: frameRate(costsIn('pinch')),
            scroll: frameRate(costsIn('scroll')),
            motion: frameRate(costsIn('pinch', 'scroll')),
          },
        }
      : {}),
    loader: {
      started: loader.started,
      loaded: loader.loaded,
      aborted: loader.aborted,
      dropped: loader.dropped,
      failed: loader.failed,
      megabytes: round(loader.bytes / 1e6, 2),
      medianLoadMs: loader.medianLoadMs,
      p95LoadMs: loader.p95LoadMs,
      network: loader.network,
    },
  }
}
