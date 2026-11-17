import type { GallyCanvasHandle } from '../../src/react/index.js'
import { config, MOUNT_MARK } from '../config'
import {
  average,
  createClock,
  currentConfig,
  describeScript,
  frameRate,
  observe,
  round,
  sampleFrames,
  type BenchResult,
  type LoafEntry,
} from './run'
import { CANVAS_SCORE_VERSION, scoreRun } from './score'

/**
 * Canvas benchmark, for `GallyCanvas` and `GallyHybridCanvas`.
 *
 * The same kind of session as the library benchmark, from a cold page load: the first screen, an
 * idle second, a two-finger pinch out to the furthest zoom and back in past where it started, then
 * two diagonal flicks. Gestures go through the component's own input handling, as synthetic touch
 * pointer events (`?input=touch`, the default) or trackpad wheel events (`?input=wheel`).
 *
 * Results use the library's result shape: `zoom` is the pinch (no level changes, so no commit
 * times) and `scroll` is the pan.
 */

/** Pinch strokes: each scales by at most this much, over this long, with fingers lifted between. */
const STROKE_RATIO = 2
const STROKE_MS = 350
const STROKE_GAP_MS = 60
/** Finger spread at the start of a stroke that spreads or pinches. */
const SPREAD_START = 120
const PINCH_START = 240
/** Where the pinch goes, as multiples of the starting zoom (0 = as far out as the canvas allows). */
const PINCH_PLAN = [0, 2, 1]
/** A flick: speed in screen heights per second, momentum decay, and the speed at which the finger lifts. */
const FLICK_SPEED = 4
const FLICK_DECAY_MS = 400
const FLICK_END_SPEED = 0.25
const FLICK_COUNT = 2
const FLICK_REST_MS = 300
const IDLE_MS = 1000
const WHEEL_ZOOM_SPEED = 0.01

type Point = { x: number; y: number }

/** Drives an element with synthetic input: touch pointers or wheel events. */
function createDriver(element: HTMLElement, input: 'touch' | 'wheel') {
  const rect = element.getBoundingClientRect()
  const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  let nextId = 900
  const pointer = (type: string, id: number, point: Point, primary: boolean) =>
    element.dispatchEvent(
      new PointerEvent(type, {
        pointerId: id,
        pointerType: 'touch',
        isPrimary: primary,
        clientX: point.x,
        clientY: point.y,
        button: type === 'pointermove' ? -1 : 0,
        buttons: type === 'pointerup' ? 0 : 1,
        width: 20,
        height: 20,
        pressure: type === 'pointerup' ? 0 : 0.5,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    )
  const wheel = (init: WheelEventInit) =>
    element.dispatchEvent(new WheelEvent('wheel', { clientX: center.x, clientY: center.y, deltaMode: 0, bubbles: true, cancelable: true, ...init }))

  return {
    center,
    /** Two fingers on the centre, `distance` apart. */
    pinchStart(distance: number) {
      const ids = [nextId++, nextId++] as const
      const at = (d: number): [Point, Point] => [
        { x: center.x - d / 2, y: center.y },
        { x: center.x + d / 2, y: center.y },
      ]
      if (input === 'touch') {
        const [a, b] = at(distance)
        pointer('pointerdown', ids[0], a, true)
        pointer('pointerdown', ids[1], b, false)
      }
      let current = distance
      return {
        move(next: number) {
          if (input === 'touch') {
            const [a, b] = at(next)
            pointer('pointermove', ids[0], a, true)
            pointer('pointermove', ids[1], b, false)
          } else {
            wheel({ ctrlKey: true, deltaY: -Math.log(next / current) / WHEEL_ZOOM_SPEED })
          }
          current = next
        },
        end() {
          if (input !== 'touch') return
          const [a, b] = at(current)
          pointer('pointerup', ids[0], a, true)
          pointer('pointerup', ids[1], b, false)
        },
      }
    },
    /** One finger down on the centre. */
    dragStart() {
      const id = nextId++
      const at = { ...center }
      if (input === 'touch') pointer('pointerdown', id, at, true)
      return {
        move(dx: number, dy: number) {
          at.x += dx
          at.y += dy
          if (input === 'touch') pointer('pointermove', id, at, true)
          else wheel({ deltaX: -dx, deltaY: -dy })
        },
        end() {
          if (input === 'touch') pointer('pointerup', id, at, true)
        },
      }
    },
  }
}

export async function runCanvasBenchmark(canvas: GallyCanvasHandle): Promise<BenchResult> {
  const element = canvas.getElement()
  if (!element) throw new Error('The canvas has no element')
  const stats = () => canvas.getStats()
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
  const driver = createDriver(element, config.input)

  // 1. First screen, from the moment the canvas mounted.
  const sinceMount = (waited: number | null) => (waited == null ? null : Math.round(performance.now() - runStart))
  const firstScreenFilledMs = sinceMount(await clock.waitFor(complete('filledTiles')))
  const sharpAt = firstScreenFilledMs == null ? null : sinceMount(await clock.waitFor(complete('sharpTiles')))
  const firstScreenSources = canvas.getVisibleSources()
  await clock.sleep(200)

  mark('idle')
  clock.phase = 'idle'
  await clock.sleep(IDLE_MS)
  clock.phase = ''

  // 2. Pinch: out as far as the canvas goes, in to twice the starting zoom, back to the start. Each
  // stroke spreads or closes two fingers smoothly, like a hand does, then lifts.
  mark('pinch')
  clock.phase = 'pinch'
  const startZoom = stats().zoom
  let strokes = 0
  for (const multiple of PINCH_PLAN) {
    const target = multiple === 0 ? 0 : startZoom * multiple
    for (;;) {
      const zoom = stats().zoom
      if (target > 0 && Math.abs(Math.log(zoom / target)) < 0.01) break
      const ratio = target === 0 ? 1 / STROKE_RATIO : Math.min(STROKE_RATIO, Math.max(1 / STROKE_RATIO, target / zoom))
      const from = ratio > 1 ? SPREAD_START : PINCH_START
      const fingers = driver.pinchStart(from)
      const started = performance.now()
      for (;;) {
        const t = Math.min(1, (performance.now() - started) / STROKE_MS)
        // Ease in and out, as a hand does; a log scale keeps the zoom speed even.
        const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
        fingers.move(from * ratio ** eased)
        if (t >= 1) break
        await clock.tick()
      }
      fingers.end()
      strokes++
      await clock.sleep(STROKE_GAP_MS)
      // Out as far as it goes once a stroke no longer changes the zoom.
      if (Math.abs(Math.log(stats().zoom / zoom)) < 0.01 || strokes > 40) break
    }
  }
  clock.phase = ''
  mark('settle')
  const settleSharpMs = await clock.waitFor(complete('sharpTiles'))
  await clock.sleep(200)

  // 3. Diagonal flicks: a finger dragged at a decaying speed, lifted once slow.
  mark('flick')
  clock.phase = 'scroll'
  for (let flick = 0; flick < FLICK_COUNT; flick++) {
    const angle = flick % 2 ? (3 * Math.PI) / 4 : -Math.PI / 4
    const finger = driver.dragStart()
    let speed = FLICK_SPEED * innerHeight
    while (speed > FLICK_END_SPEED * innerHeight) {
      const dt = Math.min(50, await clock.tick())
      finger.move((Math.cos(angle) * speed * dt) / 1000, (Math.sin(angle) * speed * dt) / 1000)
      speed *= Math.exp(-dt / FLICK_DECAY_MS)
    }
    finger.end()
    await clock.sleep(FLICK_REST_MS)
  }
  clock.phase = ''
  mark('sharpen')
  const sharpAfterStopMs = await clock.waitFor(complete('sharpTiles'))

  // 4. Network floor: the first screen's images again, uncached and all at once.
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
  const cfg = currentConfig()
  const blockingMs = longTasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0)
  const zoom = {
    steps: strokes,
    commitAvgMs: 0,
    commitMaxMs: 0,
    blankAvgPct: round(average(clock.blank.pinch) * 100),
    blankMaxPct: round(Math.max(0, ...(clock.blank.pinch ?? [])) * 100),
    settleSharpMs,
  }
  const scroll = {
    blankAvgPct: round(average(clock.blank.scroll) * 100),
    blankMaxPct: round(Math.max(0, ...(clock.blank.scroll ?? [])) * 100),
    sharpAfterStopMs,
  }
  const loader = stats().loader

  return {
    id: `${Date.now()}`,
    at: new Date().toISOString(),
    config: cfg,
    scoreVersion: CANVAS_SCORE_VERSION,
    score: scoreRun(
      {
        firstScreenFilledMs,
        firstScreenSharpMs: sharpAt,
        firstScreenOverheadMs: sharpAt == null ? null : Math.max(0, sharpAt - networkFloorMs),
        commitAvgMs: 0,
        commitMaxMs: 0,
        pinchBlankAvgPct: zoom.blankAvgPct,
        settleSharpMs,
        scrollBlankAvgPct: scroll.blankAvgPct,
        sharpAfterFlickMs: sharpAfterStopMs,
        blockingMs,
      },
      cfg.net,
      'canvas',
    ),
    pauses: clock.pauses,
    hidden,
    longFrameDetails: longFrames.sort((a, b) => b.duration - a.duration).slice(0, 8),
    firstScreenFilledMs,
    firstScreenSharpMs: sharpAt,
    networkFloorMs,
    zoom,
    scroll,
    frames: { count: frameTimes.length, p50: pct(0.5), p95: pct(0.95), max: round(sorted.at(-1) ?? 0), longTasks: longTasks.length, blockingMs },
    fps: {
      pinch: frameRate(timesIn('pinch')),
      scroll: frameRate(timesIn('scroll')),
      motion: frameRate(timesIn('pinch', 'scroll')),
    },
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
