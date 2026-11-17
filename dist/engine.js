import { defaultCameraLimits, panCamera, zoomCameraAtPoint } from './camera.js';
import { expandBounds, getScreenBounds, getViewportWorldBounds } from './geometry.js';
import { defaultLodConfig, resolvePhotoSource } from './lod.js';
import { GallyImageLoader } from './image-loader.js';
import { countSourceKeys } from './photo-sources.js';
import { PhotoSpatialIndex } from './spatial-index.js';
export class GallyEngine {
    camera;
    viewport;
    cameraLimits;
    lod;
    preloadMarginScreenPx;
    devicePixelRatio;
    index;
    listeners = new Set();
    preloads;
    interaction = {
        active: false,
        kind: null,
        startedAt: null,
    };
    constructor(options = {}) {
        this.camera = options.camera ?? { x: 0, y: 0, zoom: 1 };
        this.viewport = options.viewport ?? { width: 1, height: 1 };
        this.cameraLimits = options.cameraLimits ?? defaultCameraLimits;
        this.lod = options.lod ?? defaultLodConfig;
        this.preloadMarginScreenPx = options.preloadMarginScreenPx ?? 900;
        this.preloads = (options.loader ?? new GallyImageLoader()).channel();
        this.devicePixelRatio = options.devicePixelRatio ?? (() => globalThis.devicePixelRatio || 1);
        this.index = new PhotoSpatialIndex({ cellSize: options.spatialCellSize ?? 1024 });
    }
    subscribe(listener) {
        this.listeners.add(listener);
        listener(this.getSnapshot());
        return () => this.listeners.delete(listener);
    }
    setPhotos(tiles) {
        this.index.clear();
        this.index.setMany(tiles);
        this.emit();
    }
    upsertPhoto(tile) {
        this.index.set(tile);
        this.emit();
    }
    removePhoto(id) {
        this.index.delete(id);
        this.emit();
    }
    setViewport(viewport) {
        this.viewport = viewport;
        this.emit();
    }
    getCamera() {
        return this.camera;
    }
    setCamera(camera) {
        this.camera = camera;
        this.emit();
    }
    beginInteraction(kind) {
        this.interaction = {
            active: true,
            kind,
            startedAt: performance.now(),
        };
        this.emit();
    }
    endInteraction() {
        this.interaction = {
            active: false,
            kind: null,
            startedAt: null,
        };
        this.emit();
    }
    panBy(deltaScreen) {
        this.camera = panCamera(this.camera, deltaScreen);
        this.emit();
    }
    zoomAt(screenPoint, zoom) {
        this.camera = zoomCameraAtPoint(this.camera, screenPoint, zoom, this.cameraLimits);
        this.emit();
    }
    getVisiblePhotos() {
        return this.resolveVisiblePhotos(getViewportWorldBounds(this.camera, this.viewport));
    }
    getPreloadPhotos() {
        const viewport = getViewportWorldBounds(this.camera, this.viewport);
        const marginWorld = this.preloadMarginScreenPx / this.camera.zoom;
        return this.resolveVisiblePhotos(expandBounds(viewport, marginWorld));
    }
    getSnapshot() {
        const visible = this.getVisiblePhotos();
        const preload = this.getPreloadPhotos();
        const sourceCounts = countSourceKeys(visible);
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
        };
    }
    /** Stop warming images: releases this engine's demand on its image loader. */
    destroy() {
        this.preloads.release();
    }
    /** Warm the images of near-visible photos (the Preload Window minus what's already visible). */
    primePreloadQueue(snapshot = this.getSnapshot()) {
        const visibleSrcs = new Set(snapshot.visible.map((photo) => photo.src));
        this.preloads.demand(snapshot.preload.filter((photo) => !visibleSrcs.has(photo.src)).map((photo) => ({ src: photo.src, priority: 'near' })));
    }
    resolveVisiblePhotos(worldBounds) {
        return this.index.search(worldBounds).map((tile) => {
            const bounds = this.index.getTileBounds(tile);
            const source = resolvePhotoSource(tile, this.camera, this.devicePixelRatio(), this.lod);
            return {
                tile,
                bounds,
                screenBounds: getScreenBounds(bounds, this.camera),
                sourceKey: source.key,
                src: source.src,
            };
        });
    }
    emit() {
        const snapshot = this.getSnapshot();
        this.primePreloadQueue(snapshot);
        for (const listener of this.listeners)
            listener(snapshot);
    }
}
//# sourceMappingURL=engine.js.map