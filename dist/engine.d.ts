import { type CameraLimits } from './camera.js';
import { type LodConfig } from './lod.js';
import { GallyImageLoader } from './image-loader.js';
import type { Camera, GallyListener, GallySnapshot, InteractionKind, PhotoTile, Point, Viewport, VisiblePhoto } from './types.js';
export type GallyOptions = {
    camera?: Camera;
    viewport?: Viewport;
    cameraLimits?: CameraLimits;
    lod?: LodConfig;
    preloadMarginScreenPx?: number;
    spatialCellSize?: number;
    devicePixelRatio?: () => number;
    /** Share a loader to share decoded images with renderers. */
    loader?: GallyImageLoader;
};
export declare class GallyEngine<Metadata = unknown> {
    private camera;
    private viewport;
    private readonly cameraLimits;
    private readonly lod;
    private readonly preloadMarginScreenPx;
    private readonly devicePixelRatio;
    private readonly index;
    private readonly listeners;
    private readonly preloads;
    private interaction;
    constructor(options?: GallyOptions);
    subscribe(listener: GallyListener<Metadata>): () => void;
    setPhotos(tiles: Array<PhotoTile<Metadata>>): void;
    upsertPhoto(tile: PhotoTile<Metadata>): void;
    removePhoto(id: string): void;
    setViewport(viewport: Viewport): void;
    getCamera(): Camera;
    setCamera(camera: Camera): void;
    beginInteraction(kind: InteractionKind): void;
    endInteraction(): void;
    panBy(deltaScreen: Point): void;
    zoomAt(screenPoint: Point, zoom: number): void;
    getVisiblePhotos(): Array<VisiblePhoto<Metadata>>;
    getPreloadPhotos(): Array<VisiblePhoto<Metadata>>;
    getSnapshot(): GallySnapshot<Metadata>;
    /** Stop warming images: releases this engine's demand on its image loader. */
    destroy(): void;
    /** Warm the images of near-visible photos (the Preload Window minus what's already visible). */
    primePreloadQueue(snapshot?: GallySnapshot<Metadata>): void;
    private resolveVisiblePhotos;
    private emit;
}
//# sourceMappingURL=engine.d.ts.map