'use client'

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, type ForwardedRef, type Ref } from 'react'
import { panCamera, placeWorldPointAt, zoomCameraAtPoint } from '../camera.js'
import { boundsIntersect, getViewportWorldBounds, screenToWorld } from '../geometry.js'
import type { GallyImageLoader } from '../image-loader.js'
import { defaultCanvasLoader } from './default-loader.js'
import { buildPhotoScene, type GallySceneWrappedPhotoTile } from '../scene/photo-scene.js'
import type { Camera, Viewport } from '../types.js'
import { defaultLayoutOptions, type GallyLayoutOptions } from '../wrapped-layout.js'
import { PhotoTiles, sourceFor, usePhotoTileWindow } from './photo-tile-layer.js'
import { useCameraGestures } from './use-camera-gestures.js'
import type { GallyCanvasHandle, GallyCanvasPhoto, GallyCanvasSelection, GallyCanvasTheme } from './types.js'

export type GallyCanvasProps<Metadata = unknown> = {
  photos: Array<GallyCanvasPhoto<Metadata>>
  className?: string
  theme?: GallyCanvasTheme
  /** Row layout. `horizontalCopies` and `verticalCopies` are ignored: the layout wraps forever. */
  layout?: Partial<GallyLayoutOptions>
  minZoom?: number
  maxZoom?: number
  zoomStep?: number
  /** Screen pixels around the viewport whose thumbnails load ahead of panning. */
  preloadMargin?: number
  /**
   * Share one image loader (and its cache) with other Gally components. By default canvases
   * share one blob-mode loader: images fetch and decode in a worker, and images from hosts
   * without CORS load as plain image elements.
   */
  loader?: GallyImageLoader
  panScale?: number
  showControls?: boolean
  onSelectPhoto?: (selection: GallyCanvasSelection<Metadata>) => void
  /** @deprecated Ignored: the first screen always loads first. */
  initialPriorityCount?: number
  /** @deprecated Ignored: images load through Gally's image loader and show once decoded. */
  imageLoading?: 'browser' | 'scheduled'
  /** @deprecated Ignored (see `imageLoading`). */
  imageLoadConcurrency?: number
  /** @deprecated Ignored (see `imageLoading`). */
  imageRevealStaggerMs?: number
  /** @deprecated Ignored (see `imageLoading`). */
  imagePumpDelayMs?: number
  /** @deprecated Ignored (see `imageLoading`). */
  imageVisibleBatchSize?: number
  /** @deprecated Ignored (see `imageLoading`). */
  imageRetainMargin?: number
  /** @deprecated Ignored (see `imageLoading`). */
  imagePruneDelayMs?: number
}

const HOVER_SCALE = 1.04
const PAN_SCALE = 0.985
/** Screen pixels around the viewport whose tiles stay mounted. */
const MOUNT_OVERSCAN = 360
const ZOOM_BUTTON_MS = 260
const DPR_CAP = 2

function GallyCanvasInner<Metadata = unknown>(
  {
    photos,
    className,
    theme = { background: 'plain' },
    layout: layoutOptions,
    minZoom = 0.4,
    maxZoom = 2.5,
    zoomStep = 1.2,
    preloadMargin = 940,
    loader: sharedLoader,
    panScale = PAN_SCALE,
    showControls = true,
    onSelectPhoto,
  }: GallyCanvasProps<Metadata>,
  ref: ForwardedRef<GallyCanvasHandle>
) {
  const shellRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 })
  const viewportRef = useRef<Viewport>({ width: 1, height: 1 })
  const frameRef = useRef(0)
  const zoomAnimationRef = useRef(0)
  const loader = sharedLoader ?? defaultCanvasLoader()
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  const { rowHeight, rowGap, columnGap, rowCount, seed } = { ...defaultLayoutOptions, ...layoutOptions }
  const scene = useMemo(
    () =>
      buildPhotoScene(photos, {
        detailRowHeight: rowHeight,
        detailRowGap: rowGap,
        detailColumnGap: columnGap,
        detailRowCount: rowCount,
        seed,
      }),
    [photos, rowHeight, rowGap, columnGap, rowCount, seed]
  )
  const tiles = usePhotoTileWindow(scene, loader, { mountOverscan: MOUNT_OVERSCAN, preloadMargin, dprCap: DPR_CAP })
  const updateTiles = tiles.update
  // Frames already scheduled draw with the latest scene's tiles.
  const updateTilesRef = useRef(updateTiles)
  useLayoutEffect(() => {
    updateTilesRef.current = updateTiles
  }, [updateTiles])
  const limits = useMemo(() => ({ minZoom, maxZoom }), [minZoom, maxZoom])

  const apply = useCallback(() => {
    frameRef.current = 0
    const layer = layerRef.current
    if (!layer) return
    const { x, y, zoom } = cameraRef.current
    layer.style.transform = `translate3d(${-x * zoom}px, ${-y * zoom}px, 0) scale(${zoom})`
    updateTilesRef.current(cameraRef.current, viewportRef.current)
  }, [])

  const schedule = useCallback(() => {
    frameRef.current ||= requestAnimationFrame(apply)
  }, [apply])

  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current)
      // Reset, so a remount (StrictMode replays effects) can schedule frames again.
      frameRef.current = 0
      // Whatever was moving stopped with it: let the layer redraw sharp.
      shellRef.current?.classList.remove('gally--moving', 'gally--panning')
    },
    []
  )

  // A new scene re-mounts the tiles around the same camera.
  useEffect(() => {
    updateTiles(cameraRef.current, viewportRef.current, true)
    schedule()
  }, [scene, schedule, updateTiles])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    const resize = () => {
      viewportRef.current = { width: Math.max(1, shell.clientWidth), height: Math.max(1, shell.clientHeight) }
      updateTiles(cameraRef.current, viewportRef.current, true)
      schedule()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(shell)
    return () => observer.disconnect()
  }, [schedule, updateTiles])

  const stopZoomAnimation = useCallback(() => {
    if (!zoomAnimationRef.current) return
    cancelAnimationFrame(zoomAnimationRef.current)
    // A gesture took over: the moving state is its now, and its end clears it.
    zoomAnimationRef.current = 0
  }, [])
  useEffect(() => stopZoomAnimation, [stopZoomAnimation])

  // While moving, the layer keeps the raster it had (`.gally--moving`). Zoomed out to half that
  // scale or less, the screen shows four times the layer's area at that resolution, which Safari
  // rasterizes in full: let go of it for a frame, so the layer is redrawn at the new scale.
  const rasterZoomRef = useRef(1)
  const rerasterFrameRef = useRef(0)
  const rerasterIfZoomedOut = useCallback(() => {
    const shell = shellRef.current
    if (!shell || rerasterFrameRef.current || cameraRef.current.zoom > rasterZoomRef.current / 2) return
    rasterZoomRef.current = cameraRef.current.zoom
    shell.classList.add('gally--reraster')
    rerasterFrameRef.current = requestAnimationFrame(() => {
      rerasterFrameRef.current = requestAnimationFrame(() => {
        rerasterFrameRef.current = 0
        shell.classList.remove('gally--reraster')
      })
    })
  }, [])
  useEffect(() => () => cancelAnimationFrame(rerasterFrameRef.current), [])

  useCameraGestures(shellRef, {
    accept: (event) => !(event.target as Element | null)?.closest?.('.gally__controls'),
    pan: (dx, dy) => {
      stopZoomAnimation()
      cameraRef.current = panCamera(cameraRef.current, { x: dx, y: dy })
      schedule()
    },
    zoom: (point, factor) => {
      stopZoomAnimation()
      cameraRef.current = zoomCameraAtPoint(cameraRef.current, point, cameraRef.current.zoom * factor, limits)
      rerasterIfZoomedOut()
      schedule()
    },
    start: (kind) => {
      stopZoomAnimation()
      rasterZoomRef.current = cameraRef.current.zoom
      shellRef.current?.classList.add('gally--moving')
      shellRef.current?.classList.toggle('gally--panning', kind === 'pan')
    },
    end: () => {
      shellRef.current?.classList.remove('gally--moving', 'gally--panning')
      // Settled: ask for the sizes this zoom wants.
      updateTiles(cameraRef.current, viewportRef.current, true)
    },
  })

  const zoomCentered = useCallback(
    (factor: number) => {
      stopZoomAnimation()
      const viewport = viewportRef.current
      const point = { x: viewport.width / 2, y: viewport.height / 2 }
      const start = cameraRef.current
      const world = screenToWorld(point, start)
      const target = zoomCameraAtPoint(start, point, start.zoom * factor, limits).zoom
      const startedAt = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - startedAt) / ZOOM_BUTTON_MS))
        const eased = 1 - (1 - t) ** 3
        cameraRef.current = placeWorldPointAt(world, point, start.zoom * (target / start.zoom) ** eased)
        // Applied now, instead of in a frame of its own (one apply per frame).
        cancelAnimationFrame(frameRef.current)
        apply()
        if (t < 1) zoomAnimationRef.current = requestAnimationFrame(tick)
        else {
          zoomAnimationRef.current = 0
          shellRef.current?.classList.remove('gally--moving')
          updateTiles(cameraRef.current, viewportRef.current, true)
        }
      }
      // Moving: the layer keeps its raster while it scales (see `.gally--moving`).
      shellRef.current?.classList.add('gally--moving')
      zoomAnimationRef.current = requestAnimationFrame(tick)
    },
    [apply, limits, stopZoomAnimation, updateTiles]
  )

  const onSelect = useCallback(
    (tile: GallySceneWrappedPhotoTile<Metadata>) => {
      onSelectPhoto?.({ id: tile.baseId, index: tile.index, photo: tile.photo })
    },
    [onSelectPhoto]
  )

  const tilesRef = useRef(tiles)
  tilesRef.current = tiles
  useImperativeHandle(
    ref,
    () => ({
      getElement: () => shellRef.current,
      getStats: () => ({
        zoom: cameraRef.current.zoom,
        layer: 'dom' as const,
        ...tilesRef.current.stats(cameraRef.current, viewportRef.current),
        loader: loaderRef.current.getStats(),
      }),
      getVisibleSources: () => {
        const view = getViewportWorldBounds(cameraRef.current, viewportRef.current)
        return tilesRef.current.tiles.filter(({ tile }) => boundsIntersect(tile.detailRect, view)).map(({ tile, size }) => sourceFor(tile, size))
      },
    }),
    []
  )

  const background = theme.background ?? 'plain'
  const style = {
    '--gally-background': theme.backgroundColor ?? '#fff',
    '--gally-dot-color': theme.dotColor ?? 'rgba(0,0,0,0.11)',
    '--gally-hover-scale': HOVER_SCALE,
    '--gally-pan-scale': panScale,
  } as React.CSSProperties

  return (
    <div
      ref={shellRef}
      className={['gally', `gally--${background}`, className].filter(Boolean).join(' ')}
      style={style}
      role="application"
      aria-label="Photo canvas"
    >
      <div ref={layerRef} className="gally__layer">
        <PhotoTiles window={tiles} variant="canvas" onSelect={onSelect} />
      </div>

      {showControls && (
        <div className="gally__controls">
          <button type="button" aria-label="Zoom in" onClick={() => zoomCentered(zoomStep)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomCentered(1 / zoomStep)}>
            -
          </button>
        </div>
      )}
    </div>
  )
}

export const GallyCanvas = forwardRef(GallyCanvasInner) as <Metadata = unknown>(
  props: GallyCanvasProps<Metadata> & { ref?: Ref<GallyCanvasHandle> }
) => ReturnType<typeof GallyCanvasInner>
