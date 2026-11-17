import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { boundsIntersect, chooseSourceKeyForPixels, defaultLodConfig, expandBounds, getViewportWorldBounds, makeBounds, type Bounds } from '../src/index.js'
import { LOD, ratioOf, SOURCE_SIZES, sourceUrl } from './photos'
import { Cells, reducedMotion, Ruler, useNearScreen } from './ui'

/* The explanatory figures. The interactive ones run the engine's own geometry and level-of-detail functions. */

type LegendItem = { label: string; swatch: 'dom' | 'canvas' | 'on' | 'near' | 'off' }

function Figure({ number, title, legend, caption, children }: { number: number; title: string; legend?: LegendItem[]; caption: ReactNode; children: ReactNode }) {
  return (
    <figure className="fig">
      <div className="fig__head">
        <p>
          <span>Figure {number}</span>
          <b>{title}</b>
        </p>
        {legend && (
          <ul className="legend">
            {legend.map((item) => (
              <li key={item.label}>
                <i data-swatch={item.swatch} />
                {item.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="fig__panel">{children}</div>
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

/* Figure 1: the layers of a surface, pulled apart ------------------------------------------------ */

type Layout = { width: number; height: number; unit: number; rise: number; originX: number; originY: number; labelX: number }

/** Wide screens get labels beside a large drawing; phones get a smaller drawing and tighter labels. */
const LAYOUTS: Record<'wide' | 'narrow', Layout> = {
  wide: { width: 640, height: 392, unit: 30, rise: 78, originX: 398, originY: 206, labelX: 208 },
  narrow: { width: 350, height: 262, unit: 16, rise: 56, originX: 221, originY: 158, labelX: 124 },
}

/** The whole scene, and the window the camera cuts out of it, in scene units. */
const SCENE = { u: 9, v: 6 }
const WINDOW = { u0: 2.5, u1: 6.5, v0: 1.25, v1: 4.75 }

const LAYERS = [
  { name: 'Detail layer', spec: 'DOM · hover, focus, click', level: 3 },
  { name: 'Overview layer', spec: 'Canvas 2D · one bitmap', level: 2 },
  { name: 'Camera', spec: 'x · y · zoom', level: 1 },
  { name: 'Scene', spec: 'every photo, placed once', level: 0 },
]

function LayersDrawing({ variant }: { variant: 'wide' | 'narrow' }) {
  const L = LAYOUTS[variant]
  // Isometric: u runs down to the right, v down to the left, and each level sits `rise` higher.
  const point = (u: number, v: number, level: number): [number, number] => [
    L.originX + (u - v) * L.unit * 0.866,
    L.originY + (u + v) * L.unit * 0.38 - level * L.rise,
  ]
  const quad = (u0: number, v0: number, u1: number, v1: number, level: number) =>
    [point(u0, v0, level), point(u1, v0, level), point(u1, v1, level), point(u0, v1, level)].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const cells = (u0: number, v0: number, u1: number, v1: number, size: number, gap: number, level: number) => {
    const out: string[] = []
    for (let u = u0; u < u1 - 0.01; u += size) for (let v = v0; v < v1 - 0.01; v += size) out.push(quad(u + gap, v + gap, Math.min(u1, u + size) - gap, Math.min(v1, v + size) - gap, level))
    return out
  }
  const inWindow = (u: number, v: number) => u >= WINDOW.u0 && u < WINDOW.u1 && v >= WINDOW.v0 && v < WINDOW.v1
  const sceneCells: Array<{ points: string; seen: boolean }> = []
  for (let u = 0; u < SCENE.u; u++) for (let v = 0; v < SCENE.v; v++) sceneCells.push({ points: quad(u + 0.1, v + 0.1, u + 0.9, v + 0.9, 0), seen: inWindow(u + 0.5, v + 0.5) })
  const corners: Array<[number, number]> = [
    [WINDOW.u0, WINDOW.v0],
    [WINDOW.u1, WINDOW.v0],
    [WINDOW.u1, WINDOW.v1],
    [WINDOW.u0, WINDOW.v1],
  ]
  const windowQuad = (level: number) => quad(WINDOW.u0, WINDOW.v0, WINDOW.u1, WINDOW.v1, level)
  // Each label points at its layer's left corner.
  const anchor = (level: number) => (level === 0 ? point(0, SCENE.v, 0) : point(WINDOW.u0, WINDOW.v1, level))

  // Hovering a layer (or tapping it, or focusing its label) lifts it and dims the rest.
  const [active, setActive] = useState<number | null>(null)
  const touch = useRef(false)
  const hover = (level: number) => ({
    'data-on': active === level ? '' : undefined,
    onPointerDown: (event: React.PointerEvent) => {
      touch.current = event.pointerType !== 'mouse'
    },
    onPointerEnter: (event: React.PointerEvent) => {
      if (event.pointerType === 'mouse') setActive(level)
    },
    onPointerLeave: (event: React.PointerEvent) => {
      if (event.pointerType === 'mouse') setActive(null)
    },
    onClick: () => {
      if (touch.current) setActive((current) => (current === level ? null : level))
    },
  })
  const shapes: Record<number, ReactNode> = {
    3: cells(WINDOW.u0, WINDOW.v0, WINDOW.u1, WINDOW.v1, 1.75, 0.16, 3).map((points) => <polygon key={points} className="iso-dom" points={points} />),
    2: (
      <>
        <polygon className="iso-plane iso-plane--canvas" points={windowQuad(2)} />
        {cells(WINDOW.u0, WINDOW.v0, WINDOW.u1, WINDOW.v1, 0.5, 0.06, 2).map((points) => (
          <polygon key={points} className="iso-canvas" points={points} />
        ))}
      </>
    ),
    1: <polygon className="iso-camera" points={windowQuad(1)} />,
    0: (
      <>
        {sceneCells.map((cell) => (
          <polygon key={cell.points} className="iso-photo" data-seen={cell.seen ? '' : undefined} points={cell.points} />
        ))}
        <polygon className="iso-window" points={windowQuad(0)} />
      </>
    ),
  }
  const hit = (level: number) => (level === 0 ? quad(0, 0, SCENE.u, SCENE.v, 0) : windowQuad(level))

  return (
    <div className={`layers-fig layers-fig--${variant}`} data-active={active === null ? undefined : ''} style={{ aspectRatio: `${L.width} / ${L.height}` }}>
      <svg viewBox={`0 0 ${L.width} ${L.height}`} aria-hidden="true">
        {corners.map(([u, v]) => {
          const [x0, y0] = point(u, v, 0)
          const [x1, y1] = point(u, v, 3)
          return <line key={`${u}-${v}`} className="iso-drop" x1={x0} y1={y0} x2={x1} y2={y1} />
        })}
        {[0, 1, 2, 3].map((level) => (
          <g key={level} className="iso-layer" {...hover(level)}>
            {shapes[level]}
            <polygon className="iso-hit" points={hit(level)} />
          </g>
        ))}
        {LAYERS.map((layer) => {
          const [x, y] = anchor(layer.level)
          return (
            <g key={layer.name} className="iso-note" data-on={active === layer.level ? '' : undefined}>
              <line className="iso-lead" x1={L.labelX + 8} y1={y} x2={x - 5} y2={y} />
              <circle className="iso-pin" cx={L.labelX + 8} cy={y} r="1.75" />
            </g>
          )
        })}
      </svg>
      <ul>
        {LAYERS.map((layer) => (
          <li
            key={layer.name}
            tabIndex={0}
            style={{ top: `${(anchor(layer.level)[1] / L.height) * 100}%`, width: `${(L.labelX / L.width) * 100}%` }}
            onFocus={() => setActive(layer.level)}
            onBlur={() => setActive(null)}
            {...hover(layer.level)}
          >
            <b>{layer.name}</b>
            <span>{layer.spec}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function LayersFigure() {
  return (
    <Figure
      number={1}
      title="Surface Layers"
      legend={[
        { label: 'DOM', swatch: 'dom' },
        { label: 'Canvas', swatch: 'canvas' },
      ]}
      caption="A surface, pulled apart. The scene holds every photo, the camera cuts a window out of it, and only that window is ever drawn."
    >
      <LayersDrawing variant="wide" />
      <LayersDrawing variant="narrow" />
    </Figure>
  )
}

/* Figure 2: the visible window ---------------------------------------------------------------- */

const WORLD = { width: 1600, height: 900 }
/** The screen, in world units at zoom 1. */
const SCREEN = { width: 460, height: 300 }
/** How far past the screen photos start loading, in screen pixels. */
const PRELOAD = 170
const WINDOW_ZOOM = { min: 0.6, max: 2 }

function worldTiles(): Bounds[] {
  const tiles: Bounds[] = []
  const rowHeight = 132
  const gap = 16
  let photo = 0
  for (let row = 0; row < 6; row++) {
    let x = -((row * 97) % 140)
    const y = 12 + row * (rowHeight + gap)
    while (x < WORLD.width) {
      const [w, h] = ratioOf(photo++ * 7 + row)
      const width = Math.round((rowHeight * w) / h)
      tiles.push(makeBounds(x, y, width, rowHeight))
      x += width + gap
    }
  }
  return tiles
}

export function WindowFigure() {
  const tiles = useMemo(worldTiles, [])
  const [ref, near] = useNearScreen<HTMLDivElement>('0px')
  const tileRefs = useRef<Array<HTMLElement | null>>([])
  const frameRef = useRef<HTMLDivElement>(null)
  const preloadRef = useRef<HTMLDivElement>(null)
  const camera = useRef({ x: 420, y: 250, zoom: 1 })
  const [zoom, setZoom] = useState(1)
  const [counts, setCounts] = useState({ on: 0, near: 0, off: 0 })
  const lastCounts = useRef('')
  const touched = useRef(false)

  const apply = () => {
    const c = camera.current
    const visible = getViewportWorldBounds(c, SCREEN)
    c.x = Math.max(0, Math.min(WORLD.width - visible.width, c.x))
    c.y = Math.max(0, Math.min(WORLD.height - visible.height, c.y))
    const screen = getViewportWorldBounds(c, SCREEN)
    const preload = expandBounds(screen, PRELOAD / c.zoom)
    const place = (element: HTMLElement | null, b: Bounds) => {
      if (!element) return
      element.style.left = `${(b.x / WORLD.width) * 100}%`
      element.style.top = `${(b.y / WORLD.height) * 100}%`
      element.style.width = `${(b.width / WORLD.width) * 100}%`
      element.style.height = `${(b.height / WORLD.height) * 100}%`
    }
    place(frameRef.current, screen)
    place(preloadRef.current, preload)
    const next = { on: 0, near: 0, off: 0 }
    tiles.forEach((tile, index) => {
      const state = boundsIntersect(tile, screen) ? 'on' : boundsIntersect(tile, preload) ? 'near' : 'off'
      next[state]++
      const element = tileRefs.current[index]
      if (element && element.dataset.state !== state) element.dataset.state = state
    })
    const key = `${next.on}/${next.near}`
    if (key !== lastCounts.current) {
      lastCounts.current = key
      setCounts(next)
    }
  }

  useEffect(apply)

  // Until someone takes the frame, it wanders, so the figure explains itself.
  useEffect(() => {
    if (!near || touched.current || reducedMotion()) return
    let raf = 0
    const start = performance.now()
    const from = { ...camera.current }
    const tick = (now: number) => {
      if (touched.current) return
      const t = (now - start) / 1000
      camera.current.x = from.x + Math.sin(t * 0.42) * 330
      camera.current.y = from.y + Math.sin(t * 0.31 + 1.1) * 190 - Math.sin(1.1) * 190
      apply()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near])

  const drag = useRef<{ id: number; x: number; y: number; scale: number } | null>(null)
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const panel = ref.current
    if (!panel) return
    touched.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, scale: WORLD.width / panel.clientWidth }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    camera.current.x += (event.clientX - d.x) * d.scale
    camera.current.y += (event.clientY - d.y) * d.scale
    d.x = event.clientX
    d.y = event.clientY
    apply()
  }
  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === event.pointerId) drag.current = null
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40] }[event.key]
    if (!step) return
    event.preventDefault()
    touched.current = true
    camera.current.x += step[0]!
    camera.current.y += step[1]!
    apply()
  }
  const setZoomAt = (p: number) => {
    touched.current = true
    const next = WINDOW_ZOOM.min + (WINDOW_ZOOM.max - WINDOW_ZOOM.min) * p
    // Zoom around the middle of the screen.
    const c = camera.current
    const centre = { x: c.x + SCREEN.width / c.zoom / 2, y: c.y + SCREEN.height / c.zoom / 2 }
    c.zoom = next
    c.x = centre.x - SCREEN.width / next / 2
    c.y = centre.y - SCREEN.height / next / 2
    setZoom(next)
  }

  return (
    <Figure
      number={2}
      title="Visible Window"
      legend={[
        { label: 'On screen', swatch: 'on' },
        { label: 'Loading ahead', swatch: 'near' },
        { label: 'Skipped', swatch: 'off' },
      ]}
      caption="Drag the frame, or change its zoom. Photos fill in as it reaches them and empty again once it has gone."
    >
      <div className="world" ref={ref}>
        {tiles.map((tile, index) => (
          <i
            key={index}
            ref={(element) => {
              tileRefs.current[index] = element
            }}
            style={{
              left: `${(tile.x / WORLD.width) * 100}%`,
              top: `${(tile.y / WORLD.height) * 100}%`,
              width: `${(tile.width / WORLD.width) * 100}%`,
              height: `${(tile.height / WORLD.height) * 100}%`,
            }}
          />
        ))}
        <div className="world__preload" ref={preloadRef} />
        <div
          className="world__frame"
          ref={frameRef}
          role="slider"
          tabIndex={0}
          aria-label="Camera position"
          aria-valuetext="Use the arrow keys to move the camera"
          aria-valuenow={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={onKeyDown}
        >
          <span>Screen</span>
        </div>
      </div>
      <div className="fig__controls">
        <Ruler
          label="Zoom"
          lo={`${WINDOW_ZOOM.min.toFixed(2)}×`}
          hi={`${WINDOW_ZOOM.max.toFixed(2)}×`}
          value={(zoom - WINDOW_ZOOM.min) / (WINDOW_ZOOM.max - WINDOW_ZOOM.min)}
          text={`${zoom.toFixed(2)}×`}
          onChange={setZoomAt}
        />
        <Cells
          label="Photos by state"
          cells={[
            { name: `${counts.on}`, detail: 'on screen', swatch: 'on' },
            { name: `${counts.near}`, detail: 'loading ahead', swatch: 'near' },
            { name: `${counts.off}`, detail: 'skipped', swatch: 'off' },
          ]}
        />
      </div>
    </Figure>
  )
}

/* Figure 3: level of detail ------------------------------------------------------------------- */

const LOD_PHOTO = 13
const LOD_KEYS = ['thumb', 'small', 'medium'] as const
const LOD_MIN = 48

export function LodFigure() {
  const [t, setT] = useState(0.5)
  const [max, setMax] = useState(480)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const observer = new ResizeObserver(([entry]) => entry && setMax(Math.round(Math.min(480, entry.contentRect.width - 32))))
    observer.observe(panel)
    return () => observer.disconnect()
  }, [])
  const [w, h] = ratioOf(LOD_PHOTO)
  const width = Math.round(LOD_MIN + (max - LOD_MIN) * t)
  const dpr = Math.min(2, Math.max(1, Math.round(globalThis.devicePixelRatio || 1)))
  const pixels = width * dpr
  const chosen = chooseSourceKeyForPixels(pixels, { ...defaultLodConfig, ...LOD })
  const key = (LOD_KEYS as readonly string[]).includes(chosen) ? (chosen as (typeof LOD_KEYS)[number]) : 'medium'

  return (
    <Figure number={3} title="Level of Detail" caption={`Resize the photo. At ${width} px on a ${dpr}× screen it covers ${pixels} device pixels, so Gally shows the ${key} file.`}>
      <div className="lod" ref={panelRef}>
        <div className="lod__photo" style={{ width, aspectRatio: `${w} / ${h}` }}>
          {LOD_KEYS.map((size) => (
            <img key={size} src={sourceUrl(LOD_PHOTO, size)} alt="" data-on={size === key ? '' : undefined} draggable={false} />
          ))}
        </div>
      </div>
      <div className="fig__controls">
        <Ruler label="Size on screen" lo={`${LOD_MIN} px`} hi={`${max} px`} value={t} text={`${width} pixels wide`} onChange={setT} />
        <Cells label="Image sizes" cells={LOD_KEYS.map((size) => ({ name: size, detail: `${SOURCE_SIZES[size]} px`, on: size === key }))} />
      </div>
    </Figure>
  )
}

/* Figure 4: two renderers --------------------------------------------------------------------- */

const OVERVIEW_ZOOM = 0.56
const DETAIL_ZOOM = 0.72
const SWITCH_ZOOM = (OVERVIEW_ZOOM + DETAIL_ZOOM) / 2
const SHEET_ZOOM = { min: 0.3, max: 1.3 }
const SHEET = Array.from({ length: 21 }, (_, index) => index * 3 + 1)

export function RendererFigure() {
  const [zoom, setZoom] = useState(1)
  const painting = zoom <= SWITCH_ZOOM
  const position = (value: number) => (value - SHEET_ZOOM.min) / (SHEET_ZOOM.max - SHEET_ZOOM.min)
  return (
    <Figure
      number={4}
      title="Two Renderers"
      legend={[
        { label: 'DOM', swatch: 'dom' },
        { label: 'Canvas', swatch: 'canvas' },
      ]}
      caption={`Zoom out past ${SWITCH_ZOOM.toFixed(2)}×. The elements give way to one painted canvas, and the two cross over in about a quarter of a second.`}
    >
      <div className="sheets" data-painting={painting ? '' : undefined} style={{ '--zoom': zoom } as CSSProperties}>
        <div className="sheets__sheet sheets__sheet--canvas" aria-hidden="true">
          {SHEET.map((index) => (
            <img key={index} src={sourceUrl(index, 'thumb')} alt="" loading="lazy" draggable={false} />
          ))}
        </div>
        <div className="sheets__sheet sheets__sheet--dom" aria-hidden="true">
          {SHEET.map((index) => {
            const [w, h] = ratioOf(index)
            return <img key={index} src={sourceUrl(index, 'thumb')} alt="" loading="lazy" draggable={false} style={{ aspectRatio: `${w} / ${h}` }} />
          })}
        </div>
      </div>
      <div className="fig__controls">
        <Ruler
          label="Zoom"
          lo={`${SHEET_ZOOM.min.toFixed(2)}×`}
          hi={`${SHEET_ZOOM.max.toFixed(2)}×`}
          value={position(zoom)}
          text={`${zoom.toFixed(2)}×`}
          split={position(SWITCH_ZOOM)}
          onChange={(p) => setZoom(SHEET_ZOOM.min + (SHEET_ZOOM.max - SHEET_ZOOM.min) * p)}
        />
        <Cells
          label="Renderer"
          cells={[
            { name: 'Canvas', detail: 'one bitmap', on: painting, tone: 'canvas' },
            { name: 'DOM', detail: 'real elements', on: !painting, tone: 'dom' },
          ]}
        />
      </div>
    </Figure>
  )
}
