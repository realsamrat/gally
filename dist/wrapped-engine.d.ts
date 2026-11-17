import { type CameraLimits } from './camera.js';
import { type LodConfig } from './lod.js';
import { GallyImageLoader } from './image-loader.js';
import type { Camera, InteractionKind, InteractionState, PhotoSourceKey, PhotoTile, Point, Viewport, VisiblePhoto, WrappedPhotoGroup, WrappedPhotoMetadata } from './types.js';
export type { WrappedPhotoGroup, WrappedPhotoMetadata } from './types.js';
export type WrappedWindow<Metadata extends WrappedPhotoMetadata> = {
    camera: Camera;
    viewport: Viewport;
    visible: Array<VisiblePhoto<Metadata>>;
    preload: Array<VisiblePhoto<Metadata>>;
    interaction: InteractionState;
    stats: {
        totalPhotos: number;
        visiblePhotos: number;
        preloadPhotos: number;
        zoom: number;
        sourceCounts: Record<PhotoSourceKey, number>;
    };
};
export type GallyWrappedOptions = {
    camera?: Camera;
    viewport?: Viewport;
    groups?: WrappedPhotoGroup[];
    periodY: number;
    cameraLimits?: CameraLimits;
    lod?: LodConfig;
    preloadMarginScreenPx?: number;
    spatialCellSize?: number;
    devicePixelRatio?: () => number;
    /** Share a loader to share decoded images with renderers. */
    loader?: GallyImageLoader;
};
export declare class GallyWrappedEngine<Metadata extends WrappedPhotoMetadata = WrappedPhotoMetadata> {
    private camera;
    private viewport;
    private readonly cameraLimits;
    private readonly lod;
    private readonly preloadMarginScreenPx;
    private readonly devicePixelRatio;
    private readonly index;
    private readonly preloads;
    private periodY;
    private groups;
    private interaction;
    constructor(options: GallyWrappedOptions);
    setGroups(groups: WrappedPhotoGroup[]): void;
    setPeriodY(periodY: number): void;
    setPhotos(tiles: Array<PhotoTile<Metadata>>): void;
    setViewport(viewport: Viewport): void;
    getCamera(): Camera;
    setCamera(camera: Camera): void;
    beginInteraction(kind: InteractionKind): void;
    endInteraction(): void;
    panBy(deltaScreen: Point): Camera;
    zoomAt(screenPoint: Point, nextZoom: number): Camera;
    getWindow(): WrappedWindow<Metadata>;
    /** Stop warming images: releases this engine's demand on its image loader. */
    destroy(): void;
    /** Warm these photos' images (by default the Preload Window). */
    primePreloadQueue(photos?: Array<VisiblePhoto<Metadata>>): void;
    private getGroupWorldBounds;
    private getScreenBounds;
}
//# sourceMappingURL=wrapped-engine.d.ts.map