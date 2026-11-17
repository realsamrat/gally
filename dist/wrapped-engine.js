import { clampZoom, defaultCameraLimits } from './camera.js';
import { boundsIntersect, expandBounds, makeBounds, wrapOffset } from './geometry.js';
import { defaultLodConfig, resolvePhotoSource } from './lod.js';
import { GallyImageLoader } from './image-loader.js';
import { countSourceKeys } from './photo-sources.js';
import { PhotoSpatialIndex } from './spatial-index.js';
export class GallyWrappedEngine {
    camera;
    viewport;
    cameraLimits;
    lod;
    preloadMarginScreenPx;
    devicePixelRatio;
    index;
    preloads;
    periodY;
    groups = new Map();
    interaction = {
        active: false,
        kind: null,
        startedAt: null,
    };
    constructor(options) {
        this.camera = options.camera ?? { x: 0, y: 0, zoom: 1 };
        this.viewport = options.viewport ?? { width: 1, height: 1 };
        this.cameraLimits = options.cameraLimits ?? defaultCameraLimits;
        this.lod = options.lod ?? defaultLodConfig;
        this.preloadMarginScreenPx = options.preloadMarginScreenPx ?? 900;
        this.devicePixelRatio = options.devicePixelRatio ?? (() => globalThis.devicePixelRatio || 1);
        this.preloads = (options.loader ?? new GallyImageLoader()).channel();
        this.periodY = options.periodY;
        this.index = new PhotoSpatialIndex({ cellSize: options.spatialCellSize ?? 768 });
        this.setGroups(options.groups ?? []);
    }
    setGroups(groups) {
        this.groups.clear();
        for (const group of groups)
            this.groups.set(group.id, group);
    }
    setPeriodY(periodY) {
        this.periodY = periodY;
    }
    setPhotos(tiles) {
        this.index.clear();
        this.index.setMany(tiles);
    }
    setViewport(viewport) {
        this.viewport = viewport;
    }
    getCamera() {
        return this.camera;
    }
    setCamera(camera) {
        this.camera = {
            x: camera.x,
            y: camera.y,
            zoom: clampZoom(camera.zoom, this.cameraLimits),
        };
    }
    beginInteraction(kind) {
        this.interaction = {
            active: true,
            kind,
            startedAt: performance.now(),
        };
    }
    endInteraction() {
        this.interaction = {
            active: false,
            kind: null,
            startedAt: null,
        };
    }
    panBy(deltaScreen) {
        this.camera = {
            ...this.camera,
            x: this.camera.x + deltaScreen.x / this.camera.zoom,
            y: this.camera.y + deltaScreen.y / this.camera.zoom,
        };
        return this.camera;
    }
    zoomAt(screenPoint, nextZoom) {
        const zoom = clampZoom(nextZoom, this.cameraLimits);
        const previousZoom = this.camera.zoom;
        if (zoom === previousZoom)
            return this.camera;
        this.camera = {
            x: this.camera.x + screenPoint.x * (1 / zoom - 1 / previousZoom),
            y: this.camera.y + screenPoint.y * (1 / zoom - 1 / previousZoom),
            zoom,
        };
        return this.camera;
    }
    getWindow() {
        const visible = new Map();
        const preload = new Map();
        const zoom = this.camera.zoom;
        const marginWorld = this.preloadMarginScreenPx / zoom;
        for (const group of this.groups.values()) {
            const viewportBounds = this.getGroupWorldBounds(group);
            const preloadBounds = expandBounds(viewportBounds, marginWorld);
            const camera = {
                x: viewportBounds.x,
                y: viewportBounds.y,
                zoom,
            };
            for (const tile of this.index.search(preloadBounds)) {
                if (tile.metadata?.groupId !== group.id)
                    continue;
                const bounds = this.index.getTileBounds(tile);
                const source = resolvePhotoSource(tile, camera, this.devicePixelRatio(), this.lod);
                const photo = {
                    tile,
                    bounds,
                    screenBounds: this.getScreenBounds(group, bounds),
                    sourceKey: source.key,
                    src: source.src,
                };
                preload.set(tile.id, photo);
                if (boundsIntersect(bounds, viewportBounds))
                    visible.set(tile.id, photo);
            }
        }
        const visiblePhotos = Array.from(visible.values());
        const preloadPhotos = Array.from(preload.values());
        const sourceCounts = countSourceKeys(visiblePhotos);
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
        };
    }
    /** Stop warming images: releases this engine's demand on its image loader. */
    destroy() {
        this.preloads.release();
    }
    /** Warm these photos' images (by default the Preload Window). */
    primePreloadQueue(photos = this.getWindow().preload) {
        this.preloads.demand(photos.map((photo) => ({ src: photo.src, priority: 'near' })));
    }
    getGroupWorldBounds(group) {
        const x = -wrapOffset(this.camera.x, group.periodX);
        const y = -wrapOffset(this.camera.y, this.periodY);
        return makeBounds(x, y, this.viewport.width / this.camera.zoom, this.viewport.height / this.camera.zoom);
    }
    getScreenBounds(group, bounds) {
        const wx = wrapOffset(this.camera.x, group.periodX);
        const wy = wrapOffset(this.camera.y, this.periodY);
        return makeBounds((wx + bounds.x) * this.camera.zoom, (wy + bounds.y) * this.camera.zoom, bounds.width * this.camera.zoom, bounds.height * this.camera.zoom);
    }
}
//# sourceMappingURL=wrapped-engine.js.map