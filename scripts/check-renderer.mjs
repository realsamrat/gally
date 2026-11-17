// Regression checks for the library canvas renderer and the image loader's readiness rules, run in
// Chrome against the built package (dist). Exits non-zero if any check fails.
//
//   npm run check:renderer
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { chromium } from 'playwright-core'

const root = process.cwd()
const server = createServer(async (req, res) => {
  try {
    const body = await readFile(join(root, decodeURIComponent(req.url.split('?')[0])))
    res.setHeader('Content-Type', extname(req.url) === '.js' ? 'text/javascript' : 'application/json')
    res.end(body)
  } catch {
    res.statusCode = 404
    res.end()
  }
}).listen(0)
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
await page.goto(`http://localhost:${server.address().port}/package.json`)

const checks = await page.evaluate(async () => {
  const { LibraryCanvasRenderer } = await import('/dist/renderers/library-canvas-renderer.js')
  const { getLibraryGeometry, getLibraryWindows } = await import('/dist/library-layout.js')
  const { GallyImageLoader } = await import('/dist/image-loader.js')
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
  const frames = async (n) => {
    for (let i = 0; i < n; i++) await frame()
  }
  const bitmap = await createImageBitmap(new ImageData(8, 8))
  const results = []
  const check = (name, pass, detail) => results.push({ name, pass, detail })

  const setup = (width, columns, count) => {
    const geometry = getLibraryGeometry({ width, height: 400 }, count, columns)
    const { preload, visible } = getLibraryWindows(geometry, 0, 0)
    const ready = new Set()
    let slow = 0
    const input = (extra = {}) => ({
      geometry,
      range: preload,
      visible,
      fit: 'square',
      dpr: 1,
      selectedIndex: null,
      hiddenIndex: null,
      ring: { color: '#00f', width: 2 },
      placeholderFor: () => '#ccc',
      imageFor: (index) => {
        const until = performance.now() + slow
        while (performance.now() < until) {}
        return ready.has(index) ? { image: bitmap, width: 8, height: 8, sharp: true } : undefined
      },
      ...extra,
    })
    const renderer = new LibraryCanvasRenderer(document.body.appendChild(document.createElement('div')))
    return { renderer, input, ready, setSlow: (ms) => (slow = ms) }
  }

  // Counts the renderer's own animation frames while `body` runs.
  const countFrames = async (body) => {
    let count = 0
    const original = window.requestAnimationFrame
    window.requestAnimationFrame = (callback) => {
      count++
      return original(callback)
    }
    try {
      await body()
    } finally {
      window.requestAnimationFrame = original
    }
    return count
  }

  {
    const { renderer, input, ready } = setup(400, 4, 16)
    renderer.render(input())
    await frames(2)
    ready.add(0)
    renderer.render(input())
    check('render() without version draws an image that became ready', renderer.tileState(0) === 3, renderer.tileState(0))
  }
  {
    const { renderer, input, ready } = setup(400, 4, 16)
    renderer.render(input({ version: 1 }))
    await frames(2)
    ready.add(0)
    renderer.render(input({ version: 1 }))
    const same = renderer.tileState(0)
    renderer.render(input({ version: 2 }))
    check('render() with an unchanged version skips; a new version draws', same === 1 && renderer.tileState(0) === 3, { same, next: renderer.tileState(0) })
  }
  {
    const { renderer, input } = setup(400, 4, 16)
    renderer.render(input())
    await frames(10)
    const extra = await countFrames(() => frames(10))
    check('follow-up passes stop when nothing is left to draw', extra === 10, `${extra - 10} frames requested by the renderer`)
  }
  {
    // A covered first draw makes follow-up passes run within a time budget; slow lookups make the
    // first pass stop part way, after tile 0.
    const { renderer, input, ready, setSlow } = setup(400, 20, 400)
    setSlow(0.1)
    renderer.render(input({ deferDraw: true, version: 0 }))
    await frames(1)
    const before = renderer.tileState(0)
    ready.add(0)
    renderer.render(input({ version: 1 }))
    await frames(60)
    setSlow(0)
    check('a new version reaches tiles an interrupted pass already passed', before === 1 && renderer.tileState(0) === 3, { before, after: renderer.tileState(0) })
    renderer.render(input({ version: 1 }))
    const extra = await countFrames(() => frames(10))
    check('...and the passes stop afterwards', extra === 10, `${extra - 10} frames requested by the renderer`)
  }
  {
    // An interrupted pass, then renderTiles with more new images than one frame can upload: the
    // tile held back (0, behind the pass's cursor) must still be drawn.
    const { renderer, input, ready, setSlow } = setup(400, 20, 400)
    const images = await Promise.all(Array.from({ length: 25 }, () => createImageBitmap(new ImageData(160, 160))))
    const big = (index) => (index <= 24 ? { image: images[index], width: 160, height: 160, sharp: true } : undefined)
    setSlow(0.1)
    renderer.render(input({ deferDraw: true, version: 0 }))
    await frames(1)
    setSlow(0)
    for (let index = 0; index <= 24; index++) ready.add(index)
    const order = [...Array.from({ length: 24 }, (_, i) => i + 1), 0]
    renderer.renderTiles(input({ version: 1, imageFor: big }), order)
    await frames(60)
    renderer.render(input({ version: 1, imageFor: big }))
    check('a tile held back by the upload budget during an interrupted pass is drawn later', renderer.tileState(0) === 3, renderer.tileState(0))
  }
  {
    // renderTiles covers the version it is given: a later render() at that version skips tiles
    // whose images weren't passed to it.
    const { renderer, input, ready } = setup(400, 4, 16)
    renderer.render(input({ version: 1 }))
    await frames(2)
    ready.add(0)
    ready.add(1)
    renderer.renderTiles(input({ version: 2 }), [0])
    renderer.render(input({ version: 2 }))
    check('renderTiles draws the tiles it is given and covers their version', renderer.tileState(0) === 3 && renderer.tileState(1) === 1, {
      given: renderer.tileState(0),
      other: renderer.tileState(1),
    })
  }
  {
    const loader = new GallyImageLoader({ mode: 'blob' })
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 400
    const src = canvas.toDataURL('image/png')
    loader.channel().demand([{ src, priority: 'visible' }])
    await new Promise((resolve) => {
      const unsubscribe = loader.subscribe(() => {
        if (loader.get(src)) {
          unsubscribe()
          resolve()
        }
      })
    })
    const before = loader.isRenderable(src)
    loader.prepareElements([src])
    await new Promise((resolve) => {
      const unsubscribe = loader.subscribe(() => {
        if (loader.isRenderable(src)) {
          unsubscribe()
          resolve()
        }
      })
    })
    check('a large inline image is renderable only once its element has decoded', !before && loader.get(src).image.naturalWidth === 600, { before })
  }
  {
    // New photos: what the bands showed for the old ones is forgotten.
    const { renderer, input, ready } = setup(400, 4, 16)
    for (let i = 0; i < 16; i++) ready.add(i)
    renderer.render(input({ version: 1 }))
    const before = renderer.tileState(0)
    ready.clear()
    renderer.reset()
    renderer.render(input({ version: 2 }))
    check('reset() redraws tiles that showed the previous photos', before === 3 && renderer.tileState(0) === 1, { before, after: renderer.tileState(0) })
    renderer.destroy()
  }

  {
    // Scrolling through one long dense level keeps at most the cache's budget of drawn bands.
    const geometry = getLibraryGeometry({ width: 2000, height: 1000 }, 400, 4)
    const container = document.body.appendChild(document.createElement('div'))
    const renderer = new LibraryCanvasRenderer(container)
    for (let top = 0; top < geometry.maxScroll; top += 500) {
      const { preload, visible } = getLibraryWindows(geometry, top, 0)
      renderer.render({ geometry, range: preload, visible, fit: 'square', dpr: 2, selectedIndex: null, hiddenIndex: null, ring: { color: '#00f', width: 2 }, placeholderFor: () => '#ccc', imageFor: () => undefined, version: 1 })
    }
    let kept = 0
    for (const canvas of container.querySelectorAll('canvas')) if (canvas.style.display === 'none') kept += canvas.width * canvas.height
    check('bands kept for one long level stay within the budget', kept <= 16_000_000, { kept })
    renderer.destroy()
  }

  {
    // Bands lent to a pinch's copy and given back count against the budget too.
    const { LibraryBandCache } = await import('/dist/renderers/library-canvas-renderer.js')
    const geometry = getLibraryGeometry({ width: 3840, height: 1200 }, 400, 4)
    const container = document.body.appendChild(document.createElement('div'))
    const cache = new LibraryBandCache()
    const renderer = new LibraryCanvasRenderer(container, cache)
    const base = { geometry, fit: 'square', dpr: 2, selectedIndex: null, hiddenIndex: null, ring: { color: '#00f', width: 2 }, placeholderFor: () => '#ccc', imageFor: () => undefined, version: 1 }
    const at = (top) => {
      const { preload, visible } = getLibraryWindows(geometry, top, 3)
      renderer.render({ ...base, range: preload, visible })
      renderer.render({ ...base, range: preload })
    }
    for (let top = 0; top < 4000; top += 960) at(top)
    const lent = renderer.detachBands()
    at(geometry.maxScroll)
    cache.giveBack(lent)
    let kept = 0
    for (const canvas of [...container.querySelectorAll('canvas'), ...lent]) if (canvas.style.display === 'none' && canvas.width) kept += canvas.width * canvas.height
    check('bands given back by a copy stay within the budget', kept <= 16_000_000, { kept })
    renderer.destroy()
  }
  return results
})

await browser.close()
server.close()
for (const { name, pass, detail } of checks) console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : `: ${JSON.stringify(detail)}`}`)
if (checks.some((c) => !c.pass)) process.exit(1)
