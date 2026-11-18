import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { defaultLibraryLayoutOptions, defaultLibraryLevels, getLibraryColumns, libraryLevelCount } from '../src/index.js'
import {
  GallyCanvas,
  GallyHybridCanvas,
  GallyLibrary,
  type GallyCanvasHandle,
  type GallyCanvasPhoto,
  type GallyCanvasStats,
  type GallyLibraryFit,
  type GallyLibraryHandle,
} from '../src/react/index.js'
import { canvasPhotos, libraryPhotos, loadPreviews, loader, LOD } from './photos'
import { Stage, type StageGroup, type StageReading, type StageRuler, type StatRow } from './Stage'
import { reducedMotion } from './ui'

/*
 * Each demo's Gally component sits in a memoised wrapper with stable props. The components key
 * their layout on the `layout` object, so a new object on every render would rebuild it, and a
 * rebuild in the middle of a zoom cuts the animation short.
 */

const zoomText = (zoom: number) => `${zoom.toFixed(2)}×`
const drawnBy = (layer: 'dom' | 'canvas'): StatRow => (layer === 'dom' ? { label: 'Drawn by', value: 'DOM', tone: 'dom' } : { label: 'Drawn by', value: 'Canvas', tone: 'canvas' })
const choice = <T extends string>(label: string, value: T, set: (value: T) => void, options: Array<[T, string]>): StageGroup => ({
  label,
  options: options.map(([key, name]) => ({ label: name, pressed: value === key, onPress: () => set(key) })),
})

const THEME = { background: 'dotted' as const, backgroundColor: 'var(--stage)', dotColor: 'var(--dot)' }
const PLAIN = { ...THEME, background: 'plain' as const }

function canvasRows(stats: GallyCanvasStats): StatRow[] {
  return [
    { label: 'Zoom', value: zoomText(stats.zoom) },
    drawnBy(stats.layer),
    { label: 'On screen', value: `${stats.visibleTiles} tiles` },
    { label: 'Sharp', value: `${stats.sharpTiles} of ${stats.visibleTiles}` },
    { label: 'Loaded', value: `${stats.loader.loaded} images` },
    { label: 'Network', value: stats.loader.network },
  ]
}

/*
 * The canvases have no zoom call on their handle, so the ruler zooms them the way a trackpad does:
 * with pinch (ctrl+wheel) events at the middle of the surface.
 */
const WHEEL_ZOOM_SPEED = 0.01
const WHEEL_ZOOM_STEP = 0.25

function zoomCanvasTo(handle: GallyCanvasHandle, target: number) {
  const element = handle.getElement()
  if (!element) return
  const rect = element.getBoundingClientRect()
  let remaining = Math.log(target / handle.getStats().zoom)
  for (let i = 0; i < 24 && Math.abs(remaining) > 0.002; i++) {
    const step = Math.max(-WHEEL_ZOOM_STEP, Math.min(WHEEL_ZOOM_STEP, remaining))
    remaining -= step
    element.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -step / WHEEL_ZOOM_SPEED,
        ctrlKey: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    )
  }
}

/** Glide a canvas to a zoom over about half a second. */
function glideCanvasTo(handle: GallyCanvasHandle, target: number) {
  if (reducedMotion()) return zoomCanvasTo(handle, target)
  const from = handle.getStats().zoom
  const start = performance.now()
  const frame = (now: number) => {
    const t = Math.min(1, (now - start) / 560)
    const eased = 1 - (1 - t) ** 3
    zoomCanvasTo(handle, from * (target / from) ** eased)
    if (t < 1) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

/** A ruler over a zoom range, on a log scale so each step feels the same. */
function zoomRuler(handle: GallyCanvasHandle, zoom: number, min: number, max: number, splitAt?: number): StageRuler {
  const position = (value: number) => Math.log(value / min) / Math.log(max / min)
  return {
    label: 'Zoom',
    value: position(zoom),
    text: zoomText(zoom),
    ...(splitAt ? { split: position(splitAt) } : {}),
    set: (p) => zoomCanvasTo(handle, min * (max / min) ** p),
  }
}

/* Canvas ------------------------------------------------------------------------------------- */

type Wall = 'airy' | 'tight' | 'large'

const WALLS: Record<Wall, { rowHeight: number; gap: number }> = {
  airy: { rowHeight: 240, gap: 44 },
  tight: { rowHeight: 190, gap: 6 },
  large: { rowHeight: 400, gap: 28 },
}
const CANVAS_ZOOM = { min: 0.4, max: 2.5 }

const CanvasSurface = memo(function CanvasSurface({ handle, wall, dots, compact }: { handle: RefObject<GallyCanvasHandle | null>; wall: Wall; dots: boolean; compact: boolean }) {
  const layout = useMemo(() => {
    const { rowHeight, gap } = WALLS[wall]
    // A phone shows the same wall at about two thirds the size.
    const scale = compact ? 0.62 : 1
    return { rowHeight: Math.round(rowHeight * scale), rowGap: Math.round(gap * scale), columnGap: Math.round(gap * scale) }
  }, [wall, compact])
  return (
    <GallyCanvas
      ref={handle}
      photos={canvasPhotos}
      loader={loader}
      theme={dots ? THEME : PLAIN}
      showControls={false}
      minZoom={CANVAS_ZOOM.min}
      maxZoom={CANVAS_ZOOM.max}
      layout={layout}
    />
  )
})

export function CanvasDemo() {
  const ref = useRef<GallyCanvasHandle>(null)
  const [wall, setWall] = useState<Wall>('airy')
  const [dots, setDots] = useState<'on' | 'off'>('on')
  const read = (): StageReading | null => {
    const handle = ref.current
    if (!handle) return null
    const stats = handle.getStats()
    return { rows: canvasRows(stats), ruler: zoomRuler(handle, stats.zoom, CANVAS_ZOOM.min, CANVAS_ZOOM.max) }
  }
  return (
    <Stage
      label="GallyCanvas demo"
      wheelToPage
      read={read}
      caption="Drag to pan, pinch to zoom. Only the photos near the screen exist, and the rest are made as you get there."
      groups={[
        choice('Layout', wall, setWall, [
          ['airy', 'Airy'],
          ['tight', 'Tight'],
          ['large', 'Large'],
        ]),
      ]}
      display={[
        choice('Dots', dots, setDots, [
          ['on', 'On'],
          ['off', 'Off'],
        ]),
      ]}
    >
      {({ compact }) => <CanvasSurface handle={ref} wall={wall} dots={dots === 'on'} compact={compact} />}
    </Stage>
  )
}

/* Hybrid ------------------------------------------------------------------------------------- */

const HYBRID = { min: 0.22, max: 2.5, overviewZoom: 0.56, detailZoom: 0.72 }
const HYBRID_SWITCH = (HYBRID.overviewZoom + HYBRID.detailZoom) / 2
const HYBRID_LAYOUT = {
  wide: { detailRowHeight: 220, detailRowGap: 32, detailColumnGap: 32 },
  compact: { detailRowHeight: 150, detailRowGap: 22, detailColumnGap: 22 },
}

const HybridSurface = memo(function HybridSurface({ handle, compact }: { handle: RefObject<GallyCanvasHandle | null>; compact: boolean }) {
  return (
    <GallyHybridCanvas
      ref={handle}
      photos={canvasPhotos}
      loader={loader}
      theme={THEME}
      showControls={false}
      minZoom={HYBRID.min}
      maxZoom={HYBRID.max}
      overviewZoom={HYBRID.overviewZoom}
      detailZoom={HYBRID.detailZoom}
      layout={compact ? HYBRID_LAYOUT.compact : HYBRID_LAYOUT.wide}
    />
  )
})

export function HybridDemo() {
  const ref = useRef<GallyCanvasHandle>(null)
  const [layer, setLayer] = useState<'dom' | 'canvas'>('dom')
  const read = (): StageReading | null => {
    const handle = ref.current
    if (!handle) return null
    const stats = handle.getStats()
    if (stats.layer !== layer) setLayer(stats.layer)
    return { rows: canvasRows(stats), ruler: zoomRuler(handle, stats.zoom, HYBRID.min, HYBRID.max, HYBRID_SWITCH) }
  }
  const jump = (zoom: number) => ref.current && glideCanvasTo(ref.current, zoom)
  return (
    <Stage
      label="GallyHybridCanvas demo"
      wheelToPage
      read={read}
      caption="Zoom out until the photos turn square, then tap one to dive back in. On the ruler, orange is where Canvas draws and blue is where elements do."
      groups={[
        {
          label: 'View',
          options: [
            { label: 'Overview', pressed: layer === 'canvas', onPress: () => jump(0.34) },
            { label: 'Detail', pressed: layer === 'dom', onPress: () => jump(1) },
          ],
        },
      ]}
    >
      {({ compact }) => <HybridSurface handle={ref} compact={compact} />}
    </Stage>
  )
}

/* Library ------------------------------------------------------------------------------------ */

const LibrarySurface = memo(function LibrarySurface({
  handle,
  photos,
  fit,
  insetTop,
  insetBottom,
}: {
  handle: RefObject<GallyLibraryHandle | null>
  photos: GallyCanvasPhoto[]
  fit: GallyLibraryFit
  insetTop: number
  insetBottom: number
}) {
  const layout = useMemo(() => ({ insetTop, insetBottom }), [insetTop, insetBottom])
  return <GallyLibrary ref={handle} aria-label="Photo library" photos={photos} loader={loader} lod={LOD} fit={fit} defaultLevel={2} layout={layout} />
})

export function LibraryDemo() {
  const ref = useRef<GallyLibraryHandle>(null)
  const [fit, setFit] = useState<GallyLibraryFit>('square')
  const [previews, setPreviews] = useState<string[] | null>(null)
  useEffect(() => {
    let current = true
    void loadPreviews().then((loaded) => current && setPreviews(loaded))
    return () => {
      current = false
    }
  }, [])
  const photos = useMemo<GallyCanvasPhoto[] | null>(() => (previews ? libraryPhotos(previews) : null), [previews])

  const read = ({ width }: { width: number }): StageReading | null => {
    const handle = ref.current
    if (!handle || !width) return null
    const stats = handle.getStats()
    // The same levels the library picks for this width: column counts on a phone, tile sizes otherwise.
    const options = { ...defaultLibraryLayoutOptions, ...defaultLibraryLevels(width) }
    const count = libraryLevelCount(options)
    const columns = (level: number) => getLibraryColumns(width, level, options)
    return {
      rows: [
        { label: 'Columns', value: `${columns(stats.level)}` },
        drawnBy(stats.mode),
        { label: 'On screen', value: `${stats.visibleTiles} tiles` },
        { label: 'Sharp', value: `${stats.sharpTiles} of ${stats.visibleTiles}` },
        { label: 'Loaded', value: `${stats.loader.loaded} images` },
        { label: 'Network', value: stats.loader.network },
      ],
      ruler: {
        label: 'Columns',
        steps: count,
        value: (count - 1 - stats.level) / (count - 1),
        text: `${columns(stats.level)}`,
        set: (p) => {
          const level = Math.round((1 - p) * (count - 1))
          if (level !== handle.getStats().level) handle.zoomToLevel(level)
        },
      },
    }
  }

  return (
    <Stage
      label="GallyLibrary demo"
      read={read}
      caption="Pinch, or step along the ruler. The photo under your fingers stays under your fingers."
      groups={[
        choice('Fit', fit, setFit, [
          ['square', 'Square'],
          ['aspect', 'Aspect'],
        ]),
      ]}
    >
      {({ open, inset }) => photos && <LibrarySurface handle={ref} photos={photos} fit={fit} insetTop={open ? inset.top : 0} insetBottom={open ? inset.bottom : 0} />}
    </Stage>
  )
}
