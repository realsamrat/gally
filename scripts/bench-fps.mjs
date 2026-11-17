// Runs the library benchmark locally in Chrome against a production build (`vite preview`, as
// deployed; `--dev` uses the dev server and its simulated networks instead) and prints, per run, the frame
// rate the main thread could sustain while pinching and flicking (1000 / work per frame, see
// `sampleFrames` in playground/bench/run.ts), the frame rate the display showed, and the score.
// Each run must be stored by the run history it posts to (the deployed site's, or .bench/runs.jsonl
// locally), and gets a receipt in .bench/receipts.jsonl. Measure on the deployed playground for
// release numbers.
//
//   npm run bench:fps                   3 runs, 1440×900 @2x, headless
//   npm run bench:fps -- --runs 5 --label round-2 --headed --width 1280 --height 800 --dpr 1
//   npm run bench:fps -- --dev --net 4g
//   npm run bench:fps -- --url https://gally-playground.vercel.app --headed   the deployed site (saved there)
//   npm run bench:fps -- --renderer stable --input touch   GallyCanvas (or hybrid: GallyHybridCanvas)
//   npm run bench:fps -- --mobile       a phone: 390×844 @3x, touch, CPU slowed 4×
//   npm run bench:fps -- --json         one JSON result per line
import { appendFileSync, mkdirSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import { build, createServer, preview } from 'vite'

const { values: args } = parseArgs({
  options: {
    runs: { type: 'string', default: '3' },
    dev: { type: 'boolean', default: false },
    url: { type: 'string', default: '' },
    net: { type: 'string', default: 'fast' },
    label: { type: 'string', default: '' },
    engine: { type: 'string', default: 'hybrid' },
    renderer: { type: 'string', default: 'photos' },
    input: { type: 'string', default: 'touch' },
    mobile: { type: 'boolean', default: false },
    cpu: { type: 'string', default: '' },
    width: { type: 'string', default: '1440' },
    height: { type: 'string', default: '900' },
    dpr: { type: 'string', default: '2' },
    headed: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    target: { type: 'string', default: '240' },
  },
})

let server
if (args.url) {
  server = null
} else if (args.dev) {
  server = await createServer({ logLevel: 'error', server: { port: 0 } })
  await server.listen()
} else {
  await build({ logLevel: 'error' })
  server = await preview({ logLevel: 'error', preview: { port: 0 } })
}
const origin = args.url ? new URL(args.url).origin : `http://localhost:${server.httpServer.address().port}`
const query = new URLSearchParams({ renderer: args.renderer, engine: args.engine, autorun: '1', ...(args.label && { label: args.label }) })
if (args.renderer !== 'photos') query.set('input', args.input)
if (args.dev) for (const [key, value] of Object.entries({ images: 'local', net: args.net, bench: '1' })) query.set(key, value)
// A phone: its screen, touch input, and a CPU about a quarter as fast as this machine's.
if (args.mobile) Object.assign(args, { width: '390', height: '844', dpr: '3', cpu: args.cpu || '4' })
const browser = await chromium.launch({
  channel: 'chrome',
  headless: !args.headed,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
})

const target = Number(args.target)
const results = []
try {
  for (let run = 0; run < Number(args.runs); run++) {
    const context = await browser.newContext({
      viewport: { width: Number(args.width), height: Number(args.height) },
      deviceScaleFactor: Number(args.dpr),
      ...(args.mobile && { hasTouch: true, isMobile: true }),
    })
    const page = await context.newPage()
    if (Number(args.cpu) > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(args.cpu) })
    page.on('pageerror', (error) => console.error('page error:', error.message))
    const saved = page.waitForResponse((response) => response.url().endsWith('/api/runs') && response.request().method() === 'POST', {
      timeout: 180_000,
    })
    await page.goto(`${origin}/?${query}`)
    const response = await saved
    const result = JSON.parse(response.request().postData())
    // A run counts only once the run history has stored it.
    if (response.status() !== 201) throw new Error(`Run ${result.id} was not saved: ${response.status()} ${await response.text()}`)
    mkdirSync('.bench', { recursive: true })
    appendFileSync(
      '.bench/receipts.jsonl',
      `${JSON.stringify({ id: result.id, at: result.at, origin, label: result.config.label ?? '', renderer: result.config.renderer ?? 'photos', input: result.config.input, build: result.config.build, viewport: result.config.viewport })}\n`,
    )
    results.push(result)
    await context.close()
    if (args.json) console.log(JSON.stringify(result))
    else report(run + 1, result)
  }
} finally {
  await browser.close()
  if (server) await (server.close?.() ?? new Promise((resolve) => server.httpServer.close(resolve)))
}

if (!args.json && results.length > 1) {
  const median = (pick) => {
    const values = results.map(pick).sort((a, b) => a - b)
    return values[Math.floor(values.length / 2)]
  }
  console.log(
    `\nmedian of ${results.length}: capacity ${median((r) => r.capacity.motion.avg)} fps avg, ${median((r) => r.capacity.motion.p95)} fps p95, ${median((r) => r.capacity.motion.overBudget)} frames over budget · score ${median((r) => r.score.total)}`,
  )
}

function report(n, r) {
  const f = (rate) =>
    `${String(rate.avg).padStart(6)} avg ${String(rate.p95).padStart(6)} p95 ${String(rate.p99).padStart(6)} p99  worst ${rate.worstMs}ms  over ${rate.overBudget}/${rate.frames}`
  const pass = r.capacity.motion.p95 >= target ? 'PASS' : 'FAIL'
  console.log(`run ${n}  ${r.config.build}${r.config.label ? ` ${r.config.label}` : ''}  ${r.config.net}  score ${r.score.total}  ${r.pauses || r.hidden ? 'INVALID' : 'valid'}  ${pass} (${target} fps p95 capacity while moving)`)
  if (r.capacity.idle) console.log(`  capacity idle   ${f(r.capacity.idle)}`)
  console.log(`  capacity pinch  ${f(r.capacity.pinch)}`)
  console.log(`  capacity scroll ${f(r.capacity.scroll)}`)
  console.log(`  display  motion ${f(r.fps.motion)}`)
  console.log(
    `  ${r.config.renderer && r.config.renderer !== 'photos' ? `${r.zoom.steps} pinch strokes · ${r.loader.megabytes} MB images` : `level change ${r.zoom.commitAvgMs}ms avg / ${r.zoom.commitMaxMs}ms max`} · blank pinch ${r.zoom.blankAvgPct}% scroll ${r.scroll.blankAvgPct}% · blocking ${r.frames.blockingMs}ms · first sharp ${r.firstScreenSharpMs}ms`,
  )
  for (const frame of r.longFrameDetails.slice(0, 3)) console.log(`  long frame ${frame.duration}ms in ${frame.phase}: ${frame.scripts.join(' | ')}`)
}
