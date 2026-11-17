// Checks the benchmark's idle probe against an independent measure. Runs a local production build
// twice with the probe (its per-frame cost) and twice with it off under a Chrome trace (main-thread
// busy time per 8.33 ms frame from the trace's top-level tasks), and prints p95 per phase.
// Tracing adds its own overhead to every task, so the trace tends to read high; frames are fixed
// 8.33 ms windows, not the browser's own frame boundaries. Runs must be stored (local run history);
// each check appends a summary, with run ids, build and trace files, to .bench/trace-checks.jsonl.
//
//   npm run bench:trace                      1440×900
//   VIEW=1672x1166 npm run bench:trace
//   RENDERER=hybrid INPUT=touch npm run bench:trace   a canvas (stable: GallyCanvas, hybrid: GallyHybridCanvas)
//   MOBILE=1 npm run bench:trace             a phone: 390×844 @3x, touch, CPU slowed 4×
// Each traced run also prints where the main thread's time went while moving, by trace event.
import { chromium } from 'playwright-core'
import { build, preview } from 'vite'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
const mobile = process.env.MOBILE === '1'
const [width, height] = (process.env.VIEW || (mobile ? '390x844' : '1440x900')).split('x').map(Number)
const renderer = process.env.RENDERER || 'photos'
const input = process.env.INPUT || 'touch'
const cpu = Number(process.env.CPU || (mobile ? 4 : 1))
const extra = `${renderer === 'photos' ? '' : `&renderer=${renderer}&input=${input}`}`
await build({ logLevel: 'error' })
const server = await preview({ logLevel: 'error', preview: { port: 0 } })
const { port } = server.httpServer.address()
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-background-timer-throttling'] })
const stat = (arr) => { const s = [...arr].sort((a, b) => a - b); const at = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0; return { n: s.length, p50: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), p99: +at(0.99).toFixed(2), over: s.filter((x) => x > 1000 / 240).length } }
const run = async (probe, trace) => {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 3 : 2, ...(mobile && { hasTouch: true, isMobile: true }) })
  const page = await context.newPage()
  if (cpu > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: cpu })
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/runs') && r.request().method() === 'POST', { timeout: 180000 })
  await page.goto(`http://localhost:${port}/?autorun=1&label=trace-check${extra}${probe ? '' : '&probe=0'}`)
  let traceFile
  if (trace) {
    await page.waitForURL((u) => !u.searchParams.has('autorun'))
    // From the mount, so the idle second is in the trace too.
    await page.waitForFunction(() => performance.getEntriesByName('gally-library-mount').length > 0, undefined, { timeout: 60000, polling: 20 })
    await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing'] })
    await page.waitForFunction(() => performance.getEntriesByName('gally-bench:floor').length > 0, undefined, { timeout: 60000, polling: 50 })
    mkdirSync('.bench', { recursive: true })
    traceFile = `.bench/trace-${Date.now()}.json`
    writeFileSync(traceFile, await browser.stopTracing())
  }
  const response = await saved
  const r = JSON.parse(response.request().postData())
  if (response.status() !== 201) throw new Error(`Run ${r.id} was not saved: ${response.status()}`)
  await context.close()
  return { r, traceFile }
}
const fromTrace = (file) => {
  const ev = JSON.parse(readFileSync(file, 'utf8'))
  const list = Array.isArray(ev) ? ev : ev.traceEvents
  const names = new Map(list.filter((e) => e.name === 'thread_name').map((e) => [`${e.pid}:${e.tid}`, e.args.name]))
  const counts = new Map()
  for (const e of list) if (names.get(`${e.pid}:${e.tid}`) === 'CrRendererMain') counts.set(`${e.pid}:${e.tid}`, (counts.get(`${e.pid}:${e.tid}`) ?? 0) + 1)
  const main = [...counts].sort((a, b) => b[1] - a[1])[0][0]
  const marks = Object.fromEntries(list.filter((e) => String(e.name).startsWith('gally-bench:')).map((e) => [e.name.slice(12), e.ts]))
  const tasks = list.filter((e) => `${e.pid}:${e.tid}` === main && e.ph === 'X' && e.name === 'RunTask').sort((a, b) => a.ts - b.ts)
  const binned = (a, b) => {
    const B = 8333, n = Math.floor((b - a) / B), bins = new Array(n).fill(0)
    for (const t of tasks) {
      let s = Math.max(t.ts, a); const e = Math.min(t.ts + t.dur, a + n * B)
      while (s < e) { const k = Math.floor((s - a) / B); const end = Math.min(e, a + (k + 1) * B); bins[k] += (end - s) / 1000; s = end }
    }
    return { ...stat(bins), bins }
  }
  const p = binned(marks.pinch, marks.settle), f = binned(marks.flick, marks.sharpen)
  // Self time per event name inside main-thread tasks while moving, to see what the work is.
  const moving = (e) => (e.ts >= marks.pinch && e.ts < marks.settle) || (e.ts >= marks.flick && e.ts < marks.sharpen)
  const events = list.filter((e) => `${e.pid}:${e.tid}` === main && e.ph === 'X' && e.dur && moving(e)).sort((a, b) => a.ts - b.ts || b.dur - a.dur)
  const self = new Map()
  const stack = []
  for (const e of events) {
    while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop()
    const parent = stack.at(-1)
    if (parent) self.set(parent.name, (self.get(parent.name) ?? 0) - e.dur)
    self.set(e.name, (self.get(e.name) ?? 0) + e.dur)
    stack.push(e)
  }
  const seconds = ((marks.settle - marks.pinch) + (marks.sharpen - marks.flick)) / 1e6
  const perSecond = (map, secs) => [...map].filter(([, us]) => us > 0).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, us]) => `${name} ${(us / 1000 / secs).toFixed(1)}ms/s`)
  const breakdown = perSecond(self, seconds)
  // The same for the idle second: what runs with nothing moving.
  const idleSelf = new Map()
  const idleStack = []
  for (const e of list.filter((e) => `${e.pid}:${e.tid}` === main && e.ph === 'X' && e.dur && e.ts >= marks.idle && e.ts < marks.pinch).sort((a, b) => a.ts - b.ts || b.dur - a.dur)) {
    while (idleStack.length && idleStack.at(-1).ts + idleStack.at(-1).dur <= e.ts) idleStack.pop()
    const parent = idleStack.at(-1)
    const key = e.name === 'FunctionCall' && e.args?.data?.functionName ? `FunctionCall(${e.args.data.functionName})` : e.name
    if (parent) idleSelf.set(parent._key, (idleSelf.get(parent._key) ?? 0) - e.dur)
    e._key = key
    idleSelf.set(key, (idleSelf.get(key) ?? 0) + e.dur)
    idleStack.push(e)
  }
  const idle = perSecond(idleSelf, (marks.pinch - marks.idle) / 1e6)
  return { pinch: p, scroll: f, motion: stat([...p.bins, ...f.bins]), breakdown, idle }
}
const cost = (fps) => +(1000 / fps).toFixed(2)
const summary = { at: new Date().toISOString(), root: process.cwd(), viewport: `${width}×${height}`, renderer, input, mobile, cpu, build: '', probe: [], trace: [] }
const runs = Number(process.env.RUNS || 2)
for (let i = 0; i < runs; i++) {
  const { r } = await run(true, false)
  summary.build = r.config.build
  summary.probe.push({ id: r.id, motionP95Ms: cost(r.capacity.motion.p95), pinchP95Ms: cost(r.capacity.pinch.p95), scrollP95Ms: cost(r.capacity.scroll.p95), over: r.capacity.motion.overBudget, frames: r.capacity.motion.frames })
  console.log(`probe on  ${r.config.build}: motion p95 ${cost(r.capacity.motion.p95)} ms (over ${r.capacity.motion.overBudget}/${r.capacity.motion.frames}) · pinch p95 ${cost(r.capacity.pinch.p95)} ms (over ${r.capacity.pinch.overBudget}/${r.capacity.pinch.frames}) · scroll p95 ${cost(r.capacity.scroll.p95)} ms (over ${r.capacity.scroll.overBudget}/${r.capacity.scroll.frames})`)
}
for (let i = 0; i < runs; i++) {
  const { r, traceFile } = await run(false, true)
  const t = fromTrace(traceFile)
  const strip = ({ bins: _bins, ...rest }) => rest
  summary.trace.push({ id: r.id, traceFile, blankPct: r.zoom.blankAvgPct, motion: strip(t.motion), pinch: strip(t.pinch), scroll: strip(t.scroll), breakdown: t.breakdown, idle: t.idle })
  console.log(`trace     ${r.config.build}: motion p95 ${t.motion.p95} ms (over ${t.motion.over}/${t.motion.n}) · pinch p95 ${t.pinch.p95} ms (over ${t.pinch.over}/${t.pinch.n}, p50 ${t.pinch.p50}) · scroll p95 ${t.scroll.p95} ms (over ${t.scroll.over}/${t.scroll.n}, p50 ${t.scroll.p50}) · blank ${r.zoom.blankAvgPct}%`)
  console.log(`  moving, per second: ${t.breakdown.join(' · ')}`)
  console.log(`  idle, per second: ${t.idle.join(' · ')}`)
}
mkdirSync('.bench', { recursive: true })
appendFileSync('.bench/trace-checks.jsonl', `${JSON.stringify(summary)}\n`)
await browser.close(); await new Promise((r) => server.httpServer.close(r))
