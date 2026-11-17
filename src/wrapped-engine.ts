import { clampZoom, defaultCameraLimits, type CameraLimits } from './camera.js'
import { boundsIntersect, expandBounds, makeBounds, wrapOffset } from './geometry.js'
import { defaultLodConfig, resolvePhotoSource, type LodConfig } from './lod.js'
import { GallyImageLoader, type GallyImageChannel } from './image-loader.js'
import { countSourceKeys } from './photo-sources.js'
import { PhotoSpatialIndex } from './spatial-index.js'
import type {
  Bounds,
  Camera,
  InteractionKind,
  InteractionState,
  PhotoSourceKey,
  PhotoTile,
  Point,
  Viewport,
  VisiblePhoto,
  WrappedPhotoGroup,
  WrappedPhotoMetadata,
} from './types.js'

export type { WrappedPhotoGroup, WrappedPhotoMetadata } from './types.js'

export type WrappedWindow<Metadata extends WrappedPhotoMetadata> = {
  camera: Camera
  viewport: Viewport
  visible: Array<VisiblePhoto<Metadata>>
  preload: Array<VisiblePhoto<Metadata>>
  interaction: InteractionState
  stats: {
    totalPhotos: number
    visiblePhotos: number
    preloadPhotos: number
    zoom: number
    sourceCounts: Record<PhotoSourceKey, number>
  }
}

export type GallyWrappedOptions = {
  camera?: Camera
  viewport?: Viewport
  groups?: WrappedPhotoGroup[]
  periodY: number
  cameraLimits?: CameraLimits
  lod?: LodConfig
  preloadMarginScreenPx?: number
  spatialCellSize?: number
  devicePixelRatio?: () => number
  /** Share a loader to share decoded images with renderers. */
  loader?: GallyImageLoader
}

export class GallyWrappedEngine<Metadata extends WrappedPhotoMetadata = WrappedPhotoMetadata> {
  private camera: Camera
  private viewport: Viewport
  private readonly cameraLimits: CameraLimits
  private readonly lod: LodConfig
  private readonly preloadMarginScreenPx: number
  private readonly devicePixelRatio: () => number
  private readonly index: PhotoSpatialIndex<Metadata>
  private readonly preloads: GallyImageChannel
  private periodY: number
  private groups = new Map<string, WrappedPhotoGroup>()
  private interaction: InteractionState = {
    active: false,
    kind: null,
    startedAt: null,
  }

  constructor(options: GallyWrappedOptions) {
    this.camera = options.camera ?? { x: 0, y: 0, zoom: 1 }
    this.viewport = options.viewport ?? { width: 1, height: 1 }
    this.cameraLimits = options.cameraLimits ?? defaultCameraLimits
    this.lod = options.lod ?? defaultLodConfig
    this.preloadMarginScreenPx = options.preloadMarginScreenPx ?? 900
    this.devicePixelRatio = options.devicePixelRatio ?? (() => globalThis.devicePixelRatio || 1)
    this.preloads = (options.loader ?? new GallyImageLoader()).channel()
    this.periodY = options.periodY
    this.index = new PhotoSpatialIndex<Metadata>({ cellSize: options.spatialCellSize ?? 768 })
    this.setGroups(options.groups ?? [])
  }

  setGroups(groups: WrappedPhotoGroup[]): void {
    this.groups.clear()
    for (const group of groups) this.groups.set(group.id, group)
  }

  setPeriodY(periodY: number): void {
    this.periodY = periodY
  }

  setPhotos(tiles: Array<PhotoTile<Metadata>>): void {
    this.index.clear()
    this.index.setMany(tiles)
  }

  setViewport(viewport: Viewport): void {
    this.viewport = viewport
  }

  getCamera(): Camera {
    return this.camera
  }

  setCamera(camera: Camera): void {
    this.camera = {
      x: camera.x,
      y: camera.y,
      zoom: clampZoom(camera.zoom, this.cameraLimits),
    }
  }

  beginInteraction(kind: InteractionKind): void {
    this.interaction = {
      active: true,
      kind,
      startedAt: performance.now(),
    }
  }

  endInteraction(): void {
    this.interaction = {
      active: false,
      kind: null,
      startedAt: null,
    }
  }

  panBy(deltaScreen: Point): Camera {
    this.camera = {
      ...this.camera,
      x: this.camera.x + deltaScreen.x / this.camera.zoom,
      y: this.camera.y + deltaScreen.y / this.camera.zoom,
    }
    return this.camera
  }

  zoomAt(screenPoint: Point, nextZoom: number): Camera {
    const zoom = clampZoom(nextZoom, this.cameraLimits)
    const previousZoom = this.camera.zoom
    if (zoom === previousZoom) return this.camera

    this.camera = {
      x: this.camera.x + screenPoint.x * (1 / zoom - 1 / previousZoom),
      y: this.camera.y + screenPoint.y * (1 / zoom - 1 / previousZoom),
      zoom,
    }
    return this.camera
  }

  getWindow(): WrappedWindow<Metadata> {
    const visible = new Map<string, VisiblePhoto<Metadata>>()
    const preload = new Map<string, VisiblePhoto<Metadata>>()
    const zoom = this.camera.zoom
    const marginWorld = this.preloadMarginScreenPx / zoom

    for (const group of this.groups.values()) {
      const viewportBounds = this.getGroupWorldBounds(group)
      const preloadBounds = expandBounds(viewportBounds, marginWorld)
      const camera = {
        x: viewportBounds.x,
        y: viewportBounds.y,
        zoom,
      }

      for (const tile of this.index.search(preloadBounds)) {
        if (tile.metadata?.groupId !== group.id) continue

        const bounds = this.index.getTileBounds(tile)
        const source = resolvePhotoSource(tile, camera, this.devicePixelRatio(), this.lod)
        const photo: VisiblePhoto<Metadata> = {
          tile,
          bounds,
          screenBounds: this.getScreenBounds(group, bounds),
          sourceKey: source.key,
          src: source.src,
        }

        preload.set(tile.id, photo)
        if (boundsIntersect(bounds, viewportBounds)) visible.set(tile.id, photo)
      }
    }

    const visiblePhotos = Array.from(visible.values())
    const preloadPhotos = Array.from(preload.values())
    const sourceCounts = countSourceKeys(visiblePhotos)

    return {
      camera: this.camera,
      viewport: this.viewport,
      visible: visiblePhotos,
      preload: preloadPhotos,
      interaction: this.interaction,
      stats: {
        totalPhotos: this.index.size,
        visiblePhotos: visiblePhotos.length,
        preloadPhotos: preloadPhotos.length,
        zoom,
        sourceCounts,
      },
    }
  }

  /** Stop warming images: releases this engine's demand on its image loader. */
  destroy(): void {
    this.preloads.release()
  }

  /** Warm these photos' images (by default the Preload Window). */
  primePreloadQueue(photos: Array<VisiblePhoto<Metadata>> = this.getWindow().preload): void {
    this.preloads.demand(photos.map((photo) => ({ src: photo.src, priority: 'near' as const })))
  }

  private getGroupWorldBounds(group: WrappedPhotoGroup): Bounds {
    const x = -wrapOffset(this.camera.x, group.periodX)
    const y = -wrapOffset(this.camera.y, this.periodY)
    return makeBounds(x, y, this.viewport.width / this.camera.zoom, this.viewport.height / this.camera.zoom)
  }

  private getScreenBounds(group: WrappedPhotoGroup, bounds: Bounds): Bounds {
    const wx = wrapOffset(this.camera.x, group.periodX)
    const wy = wrapOffset(this.camera.y, this.periodY)
    return makeBounds(
      (wx + bounds.x) * this.camera.zoom,
      (wy + bounds.y) * this.camera.zoom,
      bounds.width * this.camera.zoom,
      bounds.height * this.camera.zoom
    )
  }

}
