// Gesture checks for GallyCanvas and GallyHybridCanvas in Chrome, through the browser's real touch
// and mouse input (CDP), on a production build of the playground. Exits non-zero if any fails.
//
//   npm run check:gestures
//   DEV=1 npm run check:gestures    on the dev server, where React StrictMode double-mounts
import { chromium } from 'playwright-core'
import { build, createServer, preview } from 'vite'

const dev = process.env.DEV === '1'
let server
if (dev) {
  server = await createServer({ logLevel: 'error', server: { port: 0 } })
  await server.listen()
} else {
  await build({ logLevel: 'error' })
  server = await preview({ logLevel: 'error', preview: { port: 0 } })
}
const origin = `http://localhost:${server.httpServer.address().port}`
// The dev server serves the benchmark fixtures without a simulated network.
const extra = dev ? '&images=local&net=fast' : ''
const browser = await chromium.launch({ channel: 'chrome' })
const results = []
const check = (name, pass, detail) => results.push({ name, pass, detail })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const LAYER = { stable: '.gally__layer', hybrid: '.gally-hybrid__detail-layer' }
const SHELL = { stable: '.gally', hybrid: '.gally-hybrid' }
const TILE = { stable: '.gally__tile[data-gally-revealed]', hybrid: '.gally-hybrid__detail-tile' }

for (const renderer of ['stable', 'hybrid']) {
  // A phone: touch input, mobile viewport.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  page.on('pageerror', (error) => check(`${renderer}: no page errors`, false, error.message))
  await page.goto(`${origin}/?renderer=${renderer}&bench=0&fps=0${extra}`)
  await page.waitForSelector(TILE[renderer], { timeout: 20000 })
  await sleep(500)
  const cdp = await context.newCDPSession(page)
  const camera = () =>
    page.evaluate((selector) => {
      const m = new DOMMatrix(getComputedStyle(document.querySelector(selector)).transform)
      return { zoom: m.a, x: m.e, y: m.f }
    }, LAYER[renderer])
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) })
  const pinch = async (from, to, steps = 12) => {
    const at = (d) => [[195 - d / 2, 422], [195 + d / 2, 422]]
    await touch('touchStart', at(from))
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', at(from + ((to - from) * i) / steps))
      await sleep(16)
    }
    await touch('touchEnd', [])
    await sleep(250)
  }
  const drag = async ([x, y], [dx, dy], steps = 10) => {
    await touch('touchStart', [[x, y]])
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', [[x + (dx * i) / steps, y + (dy * i) / steps]])
      await sleep(16)
    }
    // Hold still before lifting: no momentum, so the pan is exactly the drag.
    await sleep(120)
    await touch('touchEnd', [])
    await sleep(250)
  }

  const start = await camera()
  await pinch(100, 200)
  const spread = await camera()
  check(`${renderer}: two-finger spread zooms in`, spread.zoom > start.zoom * 1.6, { start: start.zoom, after: spread.zoom })
  await pinch(200, 100)
  const closed = await camera()
  check(`${renderer}: two-finger pinch zooms back out`, Math.abs(closed.zoom - start.zoom) < 0.08, { start: start.zoom, after: closed.zoom })

  // Drag starting on a photo: pans, and doesn't select it.
  await page.evaluate(() => delete document.documentElement.dataset.gallySelected)
  const before = await camera()
  await drag([195, 422], [-120, -160])
  const after = await camera()
  const moved = { dx: after.x - before.x, dy: after.y - before.y }
  check(`${renderer}: one-finger drag pans with the finger`, Math.abs(moved.dx + 120) < 12 && Math.abs(moved.dy + 160) < 12, moved)
  const selectedAfterDrag = await page.evaluate(() => document.documentElement.dataset.gallySelected ?? null)
  check(`${renderer}: a drag doesn't select the photo it started on`, selectedAfterDrag === null, selectedAfterDrag)

  // Flick: lifts while moving fast, so the canvas glides on.
  const beforeFlick = await camera()
  await touch('touchStart', [[195, 600]])
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', [[195, 600 - i * 30]])
    await sleep(16)
  }
  await touch('touchEnd', [])
  await sleep(900)
  const afterFlick = await camera()
  check(`${renderer}: a flick glides past where the finger lifted`, beforeFlick.y - afterFlick.y > 220, { finger: 180, moved: beforeFlick.y - afterFlick.y })

  // A tap that stops a glide only stops it.
  await page.evaluate(() => delete document.documentElement.dataset.gallySelected)
  await touch('touchStart', [[195, 600]])
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', [[195, 600 - i * 30]])
    await sleep(16)
  }
  await touch('touchEnd', [])
  await sleep(60)
  await page.touchscreen.tap(195, 422)
  // The camera's last steps reach the screen a frame or two later.
  await sleep(100)
  const stoppedAt = await camera()
  await sleep(400)
  const afterStop = await camera()
  const tappedDuringGlide = await page.evaluate(() => document.documentElement.dataset.gallySelected ?? null)
  check(`${renderer}: a tap during a glide stops it`, Math.abs(afterStop.y - stoppedAt.y) < 2, { drift: afterStop.y - stoppedAt.y })
  check(`${renderer}: ...without selecting a photo`, tappedDuringGlide === null, tappedDuringGlide)

  // The zoom buttons work right after a touch pan (which ends without a click).
  await drag([195, 422], [40, 60])
  const beforeButton = await camera()
  const button = await page.evaluate(() => {
    const r = document.querySelector('[aria-label="Zoom in"]').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.touchscreen.tap(button.x, button.y)
  await sleep(500)
  const afterButton = await camera()
  check(`${renderer}: the zoom-in button works right after a pan`, afterButton.zoom > beforeButton.zoom * 1.1, { before: beforeButton.zoom, after: afterButton.zoom })

  // Tap a photo near the centre: selects it.
  const box = await page.evaluate((selector) => {
    const rects = [...document.querySelectorAll(selector)].map((el) => el.getBoundingClientRect())
    const r = rects.sort((a, b) => Math.hypot(a.left + a.width / 2 - 195, a.top + a.height / 2 - 422) - Math.hypot(b.left + b.width / 2 - 195, b.top + b.height / 2 - 422))[0]
    return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, TILE[renderer])
  if (box) {
    await page.touchscreen.tap(box.x, box.y)
    await sleep(200)
  }
  const selected = await page.evaluate(() => document.documentElement.dataset.gallySelected ?? null)
  check(`${renderer}: a tap selects the photo`, Boolean(selected), selected)
  await context.close()

  // Desktop: trackpad pinch (ctrl+wheel) and mouse drag.
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const dpage = await desktop.newPage()
  await dpage.goto(`${origin}/?renderer=${renderer}&bench=0&fps=0${extra}`)
  await dpage.waitForSelector(TILE[renderer], { timeout: 20000 })
  await sleep(300)
  const dcamera = () =>
    dpage.evaluate((selector) => {
      const m = new DOMMatrix(getComputedStyle(document.querySelector(selector)).transform)
      return { zoom: m.a, x: m.e, y: m.f }
    }, LAYER[renderer])
  const d0 = await dcamera()
  await dpage.mouse.move(640, 400)
  await dpage.keyboard.down('Control')
  for (let i = 0; i < 6; i++) await dpage.mouse.wheel(0, -10)
  await dpage.keyboard.up('Control')
  await sleep(300)
  const d1 = await dcamera()
  check(`${renderer}: trackpad pinch (ctrl+wheel) zooms in`, d1.zoom > d0.zoom * 1.3, { start: d0.zoom, after: d1.zoom })
  await dpage.mouse.move(640, 400)
  await dpage.mouse.down()
  await dpage.mouse.move(540, 350, { steps: 8 })
  await dpage.mouse.up()
  await sleep(200)
  const d2 = await dcamera()
  check(`${renderer}: mouse drag pans`, Math.abs(d2.x - d1.x + 100) < 6 && Math.abs(d2.y - d1.y + 50) < 6, { dx: d2.x - d1.x, dy: d2.y - d1.y })
  // The photo nearest the centre of the screen.
  const tile = await dpage.evaluate((selector) => {
    const rects = [...document.querySelectorAll(selector)].map((el) => el.getBoundingClientRect())
    const r = rects.sort((a, b) => Math.hypot(a.left + a.width / 2 - 640, a.top + a.height / 2 - 400) - Math.hypot(b.left + b.width / 2 - 640, b.top + b.height / 2 - 400))[0]
    return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, TILE[renderer])
  if (tile) await dpage.mouse.click(tile.x, tile.y)
  await sleep(150)
  const clicked = await dpage.evaluate(() => document.documentElement.dataset.gallySelected ?? null)
  check(`${renderer}: a mouse click selects the photo`, Boolean(clicked), clicked)
  if (renderer === 'hybrid') {
    // Pinch out past the switch to the overview and straight back in while the layers blend:
    // it must settle on the detail layer, with the overview hidden.
    const blend = async () => {
      await dpage.mouse.move(640, 400)
      await dpage.keyboard.down('Control')
      const zoomTo = async (target, steps) => {
        for (let i = 0; i < steps; i++) {
          const zoom = (await dcamera()).zoom
          await dpage.mouse.wheel(0, -Math.log(target / zoom) / 0.01 / (steps - i))
        }
      }
      await zoomTo(0.55, 6)
      await sleep(60)
      await zoomTo(1, 6)
      await dpage.keyboard.up('Control')
      await sleep(900)
      return dpage.evaluate(() => {
        const shell = document.querySelector('.gally-hybrid')
        return {
          mode: shell.dataset.gallyHybridMode,
          overview: shell.style.getPropertyValue('--gally-hybrid-overview-opacity'),
          detail: shell.style.getPropertyValue('--gally-hybrid-detail-opacity'),
        }
      })
    }
    const settledBlends = []
    for (let i = 0; i < 4; i++) settledBlends.push(await blend())
    check(`hybrid: a pinch reversed mid-blend settles on the detail layer`, settledBlends.every((b) => b.mode === 'detail' && b.overview === '0' && b.detail === '1'), settledBlends)

    // Zoom out to the overview, click a photo, and press zoom-in while the dissolve runs: the
    // canvas must still pan afterwards.
    await dpage.mouse.move(640, 400)
    await dpage.keyboard.down('Control')
    for (let i = 0; i < 30; i++) await dpage.mouse.wheel(0, 20)
    await dpage.keyboard.up('Control')
    await sleep(700)
    const mode = await dpage.evaluate(() => document.querySelector('.gally-hybrid').dataset.gallyHybridMode)
    await dpage.mouse.click(640, 400)
    await sleep(120)
    await dpage.click('[aria-label="Zoom in"]')
    await sleep(1200)
    const settled = await dcamera()
    await dpage.mouse.move(640, 400)
    await dpage.mouse.down()
    await dpage.mouse.move(560, 360, { steps: 8 })
    await dpage.mouse.up()
    await sleep(200)
    const panned = await dcamera()
    check(`hybrid: zoom buttons during a focus dissolve don't lock the canvas`, mode === 'overview' && Math.abs(panned.x - settled.x + 80) < 6, {
      mode,
      dx: panned.x - settled.x,
    })
  }
  await desktop.close()
}

// The library: a pinch held near a level switch, with the fingers wobbling, changes level
// once (it used to flip between two levels), and pinching out then in steps through levels.
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  page.on('pageerror', (error) => check('library: no page errors', false, error.message))
  await page.goto(`${origin}/?renderer=photos&bench=0&fps=0${extra}`)
  await page.waitForSelector('.gally-library[aria-colcount]', { timeout: 20000 })
  await sleep(800)
  const cdp = await context.newCDPSession(page)
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) })
  const at = (d) => [[195 - d / 2, 500], [195 + d / 2, 500]]
  const columns = () => page.evaluate(() => Number(document.querySelector('.gally-library').getAttribute('aria-colcount')))
  await page.evaluate(() => {
    window.__levelChanges = 0
    new MutationObserver(() => window.__levelChanges++).observe(document.querySelector('.gally-library'), { attributes: true, attributeFilter: ['aria-colcount'] })
  })
  const start = await columns()
  // Like Safari on iOS: alongside the touches, gesture events carrying the pinch's scale measured
  // its own way (here 12% apart from the fingers' spread). Following both flipped the grid between
  // two levels every frame.
  const safariGesture = (type, scale) =>
    page.evaluate(
      ([type, scale]) => {
        const event = new UIEvent(type, { bubbles: true, cancelable: true })
        Object.assign(event, { scale, clientX: 195, clientY: 500 })
        document.querySelector('.gally-library__scroller').dispatchEvent(event)
      },
      [type, scale],
    )
  // Pinch out to about half way to the next level, then wobble ±6% around there for a second.
  await touch('touchStart', at(240))
  await safariGesture('gesturestart', 1)
  const spread = async (d) => {
    await touch('touchMove', at(d))
    await safariGesture('gesturechange', (d / 240) * 1.12)
    await sleep(16)
  }
  for (let i = 1; i <= 10; i++) await spread(240 - i * 6.5)
  for (let i = 0; i < 60; i++) await spread(175 * (1 + 0.06 * Math.sin(i / 3)))
  await touch('touchEnd', [])
  await safariGesture('gestureend', 1)
  await sleep(700)
  const changes = await page.evaluate(() => window.__levelChanges)
  check('library: a pinch wobbling near a level switch changes level at most once', changes <= 1, { start, changes, end: await columns() })

  // From a fresh page (3 columns): out twice, then in twice, a level each time. Each pinch spans
  // most of its step (5 ↔ 15 columns is a 3× step), as a pinch that only goes part of the way and
  // stops before letting go springs back, as in Photos.
  await page.reload()
  await page.waitForSelector('.gally-library[aria-colcount]', { timeout: 20000 })
  await sleep(800)
  const pinch = async (from, to) => {
    await touch('touchStart', at(from))
    for (let i = 1; i <= 12; i++) {
      await touch('touchMove', at(from + ((to - from) * i) / 12))
      await sleep(16)
    }
    await touch('touchEnd', [])
    await sleep(1200)
  }
  const steps = [await columns()]
  for (const [from, to] of [[200, 120], [240, 80], [80, 240], [120, 200]]) {
    await pinch(from, to)
    steps.push(await columns())
  }
  check('library: pinching out and back in steps one level at a time (3 → 5 → 15 → 5 → 3)', steps.join() === '3,5,15,5,3', steps)

  // Fingers that jump past the switch in one move and then hold still: the dissolve still runs
  // once the incoming grid has rendered (it used to wait for the next move, fully opaque).
  await page.reload()
  await page.waitForSelector('.gally-library[aria-colcount]', { timeout: 20000 })
  await sleep(800)
  await touch('touchStart', at(200))
  await touch('touchMove', at(146))
  await sleep(600)
  const held = await page.evaluate(() => {
    const copy = document.querySelector('.gally-library__ghost--pinch')
    return copy ? Number(getComputedStyle(copy).opacity) : null
  })
  await touch('touchEnd', [])
  await sleep(1200)
  check('library: the dissolve runs while the fingers hold still', held !== null && held < 0.9, { held })
  await context.close()
}

await browser.close()
await (dev ? server.close() : new Promise((resolve) => server.httpServer.close(resolve)))
for (const { name, pass, detail } of results) console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : `: ${JSON.stringify(detail)}`}`)
if (results.some((r) => !r.pass)) process.exit(1)
