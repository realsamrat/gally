import { getScreenBounds } from '../geometry.js'
import { cappedDevicePixelRatio } from '../lod.js'
import { GallyImageLoader, type GallyImageChannel, type GallyImageDemand, type GallyImagePriority } from '../image-loader.js'
import type { Camera, Viewport } from '../types.js'
import {
  queryWrappedPhotoScene,
  type GallyPhotoScene,
} from '../scene/photo-scene.js'

export type CanvasOverviewRendererOptions = {
  dprCap?: number
  overscanScreenPx?: number
  placeholderColor?: string
  /** Called when a thumbnail it waits for becomes ready, so the caller can render again. */
  onInvalidate?: () => void
  /** Share a loader to share its decoded images with other renderers. */
  loader?: GallyImageLoader
  /**
   * Short edge, in device pixels, of the bitmaps a blob-mode loader makes for thumbnails: about the
   * largest a tile is drawn. Made off the main thread, they keep decoding out of frames. Default 160.
   */
  bitmapEdge?: number
}

export type CanvasOverviewRenderOptions = {
  camera: Camera
  viewport: Viewport
  overscanScreenPx?: number
  /** How urgently to load the thumbnails it draws: `near` when drawing ahead while hidden. Default `visible`. */
  priority?: GallyImagePriority
}

/** @deprecated Same as `CanvasOverviewRenderOptions`. */
export type CanvasOverviewWarmupOptions = CanvasOverviewRenderOptions

/**
 * Pixels of images drawn for the first time per render. A first draw of an image element decodes it
 * on the main thread (about a millisecond per thumbnail), so a screenful at once would stall a frame;
 * the rest show placeholders and are drawn over the next frames.
 */
const FIRST_DRAW_PIXELS_PER_FRAME = 400_000

export class CanvasOverviewRenderer<Metadata = unknown> {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private scene: GallyPhotoScene<Metadata>
  private readonly loader: GallyImageLoader
  private readonly channel: GallyImageChannel
  /** Warm-ups use their own channel, so a render elsewhere doesn't drop what they asked for. */
  private readonly warmChannel: GallyImageChannel
  private readonly unsubscribe: () => void
  private highlightedTileId: string | null = null
  private stats = { visibleTiles: 0, filledTiles: 0, sharpTiles: 0 }
  /** Thumbnails the last render drew placeholders for. */
  private waiting = new Set<string>()
  /** Images this renderer has drawn, whose decoded pixels the browser has cached. */
  private drawnImages = new Set<string>()
  private readonly onInvalidate: (() => void) | undefined
  private followUp = 0
  private readonly options: { dprCap: number; overscanScreenPx: number; placeholderColor: string; bitmapEdge: number }

  constructor(canvas: HTMLCanvasElement, scene: GallyPhotoScene<Metadata>, options: CanvasOverviewRendererOptions = {}) {
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) {
      throw new Error('Gally hybrid overview requires a 2D canvas context.')
    }

    this.canvas = canvas
    this.context = context
    this.scene = scene
    this.options = {
      dprCap: options.dprCap ?? 2,
      overscanScreenPx: options.overscanScreenPx ?? 900,
      placeholderColor: options.placeholderColor ?? '#e8e8e6',
      bitmapEdge: options.bitmapEdge ?? 160,
    }
    this.loader = options.loader ?? new GallyImageLoader()
    this.channel = this.loader.channel()
    this.warmChannel = this.loader.channel()
    const onInvalidate = options.onInvalidate
    this.onInvalidate = onInvalidate
    // Only for thumbnails it drew placeholders for: other images (the detail layer's, thumbnails
    // around the screen) don't change the picture.
    this.unsubscribe = onInvalidate
      ? this.loader.subscribe((changed) => {
          if (changed.some((src) => this.waiting.has(src))) onInvalidate()
        })
      : () => {}
  }

  /** Tiles on screen in the last render, and how many it drew with their thumbnail. */
  getStats() {
    return { ...this.stats }
  }

  setScene(scene: GallyPhotoScene<Metadata>) {
    this.scene = scene
    // The ring around the screen is the new scene's now.
    this.demanded = null
  }

  setHighlightedTileId(tileId: string | null) {
    this.highlightedTileId = tileId
  }

  destroy() {
    cancelAnimationFrame(this.followUp)
    this.channel.release()
    this.warmChannel.release()
    this.unsubscribe()
  }

  /** Start loading the thumbnails a render with these options would draw, without drawing. */
  warmup({ camera, viewport, overscanScreenPx = this.options.overscanScreenPx }: CanvasOverviewRenderOptions) {
    const tiles = queryWrappedPhotoScene(this.scene, camera, viewport, 'overview', { overscanScreenPx })
    this.warmChannel.demand(tiles.map((tile) => ({ src: tile.sources.thumb, priority: 'near' as const })))
  }

  render({ camera, viewport, overscanScreenPx = this.options.overscanScreenPx, priority = 'visible' }: CanvasOverviewRenderOptions) {
    const dpr = cappedDevicePixelRatio({ dprCap: this.options.dprCap })
    const width = Math.max(1, Math.round(viewport.width * dpr))
    const height = Math.max(1, Math.round(viewport.height * dpr))

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
      this.canvas.style.width = `${viewport.width}px`
      this.canvas.style.height = `${viewport.height}px`
    }

    const ctx = this.context
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, viewport.width, viewport.height)

    // Draw what's on screen only; the ring around it is asked for separately (see `demandAround`),
    // since far out it holds thousands of tiles.
    const visible = queryWrappedPhotoScene(this.scene, camera, viewport, 'overview', { overscanScreenPx: 0 })
    this.demandAround(camera, viewport, overscanScreenPx, priority, visible)
    let drawn = 0
    let onScreen = 0
    let firstDrawBudget = FIRST_DRAW_PIXELS_PER_FRAME
    let deferred = false
    const pending: string[] = []
    const waiting = new Set<string>()
    for (const tile of visible) {
      const rect = getScreenBounds(tile.overviewRect, camera)
      if (rect.width < 0.5 || rect.height < 0.5) continue
      onScreen++

      // A small decoded bitmap when there is one, else the decoded image element (blob-mode
      // loaders make bitmaps off the main thread on request; the loader notifies when they're
      // ready, which invalidates this renderer), else a placeholder.
      const src = tile.sources.thumb
      const bitmap = this.loader.getBitmap(src)
      let loaded = !bitmap && this.loader.isRenderable(src) ? this.loader.get(src) : undefined
      let heldBack = false
      // Without a callback to render again, everything draws now.
      if (loaded && !this.drawnImages.has(src)) {
        if (firstDrawBudget > 0 || !this.onInvalidate) {
          firstDrawBudget -= loaded.width * loaded.height
          if (this.drawnImages.size > 20_000) this.drawnImages.clear()
          this.drawnImages.add(src)
        } else {
          loaded = undefined
          deferred = true
          heldBack = true
        }
      }
      if (bitmap) {
        drawImageCover(ctx, bitmap, bitmap.width, bitmap.height, rect.x, rect.y, rect.width, rect.height)
        drawn++
      } else if (loaded) {
        drawImageCover(ctx, loaded.image, loaded.image.naturalWidth, loaded.image.naturalHeight, rect.x, rect.y, rect.width, rect.height)
        drawn++
      } else {
        // Held back by the budget, it draws next frame as it is; otherwise it needs a bitmap.
        if (!heldBack && this.loader.get(src)) pending.push(src)
        waiting.add(src)
        ctx.fillStyle = tile.dominantColor ?? this.options.placeholderColor
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      }

      if (tile.id === this.highlightedTileId) {
        ctx.save()
        ctx.strokeStyle = '#2563eb'
        ctx.lineWidth = Math.max(2, 2 / camera.zoom)
        ctx.strokeRect(rect.x + 1.5, rect.y + 1.5, Math.max(0, rect.width - 3), Math.max(0, rect.height - 3))
        ctx.restore()
      }
    }
    this.waiting = waiting
    if (pending.length) this.loader.prepareBitmaps(pending, this.options.bitmapEdge)
    // Images held back by the budget: ask the owner to render again next frame.
    if (deferred && !this.followUp && this.onInvalidate) {
      this.followUp = requestAnimationFrame(() => {
        this.followUp = 0
        this.onInvalidate?.()
      })
    }
    this.stats = { visibleTiles: onScreen, filledTiles: drawn, sharpTiles: drawn }
  }

  /** Where the last ring demand was made, so it's redone only once the camera has moved on. */
  private demanded: { camera: Camera; viewport: Viewport; priority: GallyImagePriority } | null = null

  /**
   * Ask for the on-screen thumbnails first and those in a ring around the screen after. The ring is
   * re-queried only after the camera moves a quarter screen or zooms by 15%; in between, the
   * on-screen tiles are re-demanded alongside the last ring.
   */
  private ring: string[] = []
  private demandAround(
    camera: Camera,
    viewport: Viewport,
    overscanScreenPx: number,
    priority: GallyImagePriority,
    visible: ReadonlyArray<{ sources: { thumb: string } }>
  ) {
    const last = this.demanded
    const moved =
      !last ||
      last.priority !== priority ||
      last.viewport.width !== viewport.width ||
      last.viewport.height !== viewport.height ||
      Math.abs(Math.log(camera.zoom / last.camera.zoom)) > 0.15 ||
      Math.abs(camera.x - last.camera.x) * camera.zoom > viewport.width / 4 ||
      Math.abs(camera.y - last.camera.y) * camera.zoom > viewport.height / 4
    if (moved) {
      // Far out a full overscan ring is thousands of tiles; a third of the screen is plenty.
      const ring = Math.min(overscanScreenPx, Math.max(viewport.width, viewport.height) / 3)
      this.ring = queryWrappedPhotoScene(this.scene, camera, viewport, 'overview', { overscanScreenPx: ring }).map((tile) => tile.sources.thumb)
      this.demanded = { camera: { ...camera }, viewport: { ...viewport }, priority }
    }
    const demands: GallyImageDemand[] = this.ring.map((src) => ({ src, priority: 'near' }))
    for (const tile of visible) demands.push({ src: tile.sources.thumb, priority })
    this.channel.demand(demands)
  }
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  x: number,
  y: number,
  width: number,
  height: number
) {
  if (imageWidth <= 0 || imageHeight <= 0) return

  const sourceRatio = imageWidth / imageHeight
  const targetRatio = width / height
  let sx = 0
  let sy = 0
  let sw = imageWidth
  let sh = imageHeight

  if (sourceRatio > targetRatio) {
    sw = imageHeight * targetRatio
    sx = (imageWidth - sw) / 2
  } else {
    sh = imageWidth / targetRatio
    sy = (imageHeight - sh) / 2
  }

  ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height)
}
