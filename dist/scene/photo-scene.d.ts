import type { Bounds, Camera, GallyPhoto, PhotoSources, Viewport } from '../types.js';
export type GallyScenePhoto<Metadata = unknown> = GallyPhoto<Metadata>;
export type GallyScenePhotoTile<Metadata = unknown> = {
    id: string;
    index: number;
    photo: GallyScenePhoto<Metadata>;
    detailRect: Bounds;
    detailRowIndex: number;
    detailRowWidth: number;
    overviewRect: Bounds;
    sources: PhotoSources;
    alt?: string;
    dominantColor?: string;
    metadata?: Metadata;
};
export type GallySceneWrappedPhotoTile<Metadata = unknown> = GallyScenePhotoTile<Metadata> & {
    baseId: string;
    wrapX: number;
    wrapY: number;
};
export type GallyPhotoScene<Metadata = unknown> = {
    tiles: Array<GallyScenePhotoTile<Metadata>>;
    detailBounds: Bounds;
    overviewBounds: Bounds;
    detailRows: Array<{
        y: number;
        height: number;
        width: number;
        tileIds: string[];
    }>;
    overviewColumns: number;
    detailWrapGap: number;
    detailPeriodX: number;
    detailPeriodY: number;
    overviewPeriodX: number;
    overviewPeriodY: number;
};
export type GallyHybridLayoutOptions = {
    detailRowHeight: number;
    detailRowGap: number;
    detailColumnGap: number;
    detailRowCount: number;
    overviewTileSize: number;
    overviewGap: number;
    overviewColumns?: number;
    seed: number;
};
export type GallySceneQueryMode = 'detail' | 'overview';
export declare const defaultHybridLayoutOptions: GallyHybridLayoutOptions;
export declare function buildPhotoScene<Metadata = unknown>(photos: Array<GallyScenePhoto<Metadata>>, options?: Partial<GallyHybridLayoutOptions>): GallyPhotoScene<Metadata>;
export declare function getCameraWorldBounds(camera: Camera, viewport: Viewport, overscanScreenPx?: number): Bounds;
export declare function queryPhotoScene<Metadata = unknown>(scene: GallyPhotoScene<Metadata>, camera: Camera, viewport: Viewport, mode: GallySceneQueryMode, options?: {
    overscanScreenPx?: number;
    limit?: number;
}): Array<GallyScenePhotoTile<Metadata>>;
export declare function queryWrappedPhotoScene<Metadata = unknown>(scene: GallyPhotoScene<Metadata>, camera: Camera, viewport: Viewport, mode: GallySceneQueryMode, options?: {
    overscanScreenPx?: number;
    limit?: number;
}): Array<GallySceneWrappedPhotoTile<Metadata>>;
/** Distance after which a tile's detail row repeats horizontally. */
export declare function detailRowPeriodX(scene: Pick<GallyPhotoScene, 'detailWrapGap'>, tile: Pick<GallyScenePhotoTile, 'detailRowWidth'>): number;
//# sourceMappingURL=photo-scene.d.ts.map