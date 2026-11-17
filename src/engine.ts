import { defaultCameraLimits, panCamera, zoomCameraAtPoint, type CameraLimits } from './camera.js'
import { expandBounds, getScreenBounds, getViewportWorldBounds } from './geometry.js'
import { defaultLodConfig, resolvePhotoSource, type LodConfig } from './lod.js'
import { GallyImageLoader, type GallyImageChannel } from './image-loader.js'
import { countSourceKeys } from './photo-sources.js'
import { PhotoSpatialIndex } from './spatial-index.js'
import type {
  Camera,
  GallyListener,
  GallySnapshot,
  InteractionKind,
  InteractionState,
  PhotoTile,
  Point,
  Viewport,
  VisiblePhoto,
} from './types.js'

export type GallyOptions = {
  camera?: Camera
  viewport?: Viewport
  cameraLimits?: CameraLimits
  lod?: LodConfig
  preloadMarginScreenPx?: number
  spatialCellSize?: number
  devicePixelRatio?: () => number
  /** Share a loader to share decoded images with renderers. */
  loader?: GallyImageLoader
}

export class GallyEngine<Metadata = unknown> {
  private camera: Camera
  private viewport: Viewport
  private readonly cameraLimits: CameraLimits
  private readonly lod: LodConfig
  private readonly preloadMarginScreenPx: number
  private readonly devicePixelRatio: () => number
  private readonly index: PhotoSpatialIndex<Metadata>
  private readonly listeners = new Set<GallyListener<Metadata>>()
  private readonly preloads: GallyImageChannel
  private interaction: InteractionState = {
    active: false,
    kind: null,
    startedAt: null,
  }

  constructor(options: GallyOptions = {}) {
    this.camera = options.camera ?? { x: 0, y: 0, zoom: 1 }
    this.viewport = options.viewport ?? { width: 1, height: 1 }
    this.cameraLimits = options.cameraLimits ?? defaultCameraLimits
    this.lod = options.lod ?? defaultLodConfig
    this.preloadMarginScreenPx = options.preloadMarginScreenPx ?? 900
    this.preloads = (options.loader ?? new GallyImageLoader()).channel()
    this.devicePixelRatio = options.devicePixelRatio ?? (() => globalThis.devicePixelRatio || 1)
    this.index = new PhotoSpatialIndex<Metadata>({ cellSize: options.spatialCellSize ?? 1024 })
  }

  subscribe(listener: GallyListener<Metadata>): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => this.listeners.delete(listener)
  }

  setPhotos(tiles: Array<PhotoTile<Metadata>>): void {
    this.index.clear()
    this.index.setMany(tiles)
    this.emit()
  }

  upsertPhoto(tile: PhotoTile<Metadata>): void {
    this.index.set(tile)
    this.emit()
  }

  removePhoto(id: string): void {
    this.index.delete(id)
    this.emit()
  }

  setViewport(viewport: Viewport): void {
    this.viewport = viewport
    this.emit()
  }

  getCamera(): Camera {
    return this.camera
  }

  setCamera(camera: Camera): void {
    this.camera = camera
    this.emit()
  }

  beginInteraction(kind: InteractionKind): void {
    this.interaction = {
      active: true,
      kind,
      startedAt: performance.now(),
    }
    this.emit()
  }

  endInteraction(): void {
    this.interaction = {
      active: false,
      kind: null,
      startedAt: null,
    }
    this.emit()
  }

  panBy(deltaScreen: Point): void {
    this.camera = panCamera(this.camera, deltaScreen)
    this.emit()
  }

  zoomAt(screenPoint: Point, zoom: number): void {
    this.camera = zoomCameraAtPoint(this.camera, screenPoint, zoom, this.cameraLimits)
    this.emit()
  }

  getVisiblePhotos(): Array<VisiblePhoto<Metadata>> {
    return this.resolveVisiblePhotos(getViewportWorldBounds(this.camera, this.viewport))
  }

  getPreloadPhotos(): Array<VisiblePhoto<Metadata>> {
    const viewport = getViewportWorldBounds(this.camera, this.viewport)
    const marginWorld = this.preloadMarginScreenPx / this.camera.zoom
    return this.resolveVisiblePhotos(expandBounds(viewport, marginWorld))
  }

  getSnapshot(): GallySnapshot<Metadata> {
    const visible = this.getVisiblePhotos()
    const preload = this.getPreloadPhotos()
    const sourceCounts = countSourceKeys(visible)

    return {
      camera: this.camera,
      viewport: this.viewport,
      visible,
      preload,
      interaction: this.interaction,
      stats: {
        totalPhotos: this.index.size,
        visiblePhotos: visible.length,
        preloadPhotos: preload.length,
        zoom: this.camera.zoom,
        sourceCounts,
      },
    }
  }

  /** Stop warming images: releases this engine's demand on its image loader. */
  destroy(): void {
    this.preloads.release()
  }

  /** Warm the images of near-visible photos (the Preload Window minus what's already visible). */
  primePreloadQueue(snapshot: GallySnapshot<Metadata> = this.getSnapshot()): void {
    const visibleSrcs = new Set(snapshot.visible.map((photo) => photo.src))
    this.preloads.demand(
      snapshot.preload.filter((photo) => !visibleSrcs.has(photo.src)).map((photo) => ({ src: photo.src, priority: 'near' as const })),
    )
  }

  private resolveVisiblePhotos(worldBounds: ReturnType<typeof getViewportWorldBounds>): Array<VisiblePhoto<Metadata>> {
    return this.index.search(worldBounds).map((tile) => {
      const bounds = this.index.getTileBounds(tile)
      const source = resolvePhotoSource(tile, this.camera, this.devicePixelRatio(), this.lod)

      return {
        tile,
        bounds,
        screenBounds: getScreenBounds(bounds, this.camera),
        sourceKey: source.key,
        src: source.src,
      }
    })
  }


  private emit(): void {
    const snapshot = this.getSnapshot()
    this.primePreloadQueue(snapshot)
    for (const listener of this.listeners) listener(snapshot)
  }
}
