import type { GallyImageLoader } from '../image-loader.js';
import { type GallyPhotoScene, type GallySceneWrappedPhotoTile } from '../scene/photo-scene.js';
import type { Camera, PhotoSourceKey, Viewport } from '../types.js';
/**
 * The DOM Photo Tiles of a wrapped canvas, virtualized: only tiles near the screen are mounted, in
 * world coordinates inside one layer the camera transforms. Panning and pinching move that layer;
 * the mounted set changes only when the screen nears its edge or the zoom changes a lot. Images come
 * from the shared loader and show once decoded, at the size the zoom wants, or the nearest size
 * already loaded meanwhile.
 */
export type MountedPhotoTile<Metadata> = {
    tile: GallySceneWrappedPhotoTile<Metadata>;
    /** The source size this tile wants at the zoom it was mounted at. */
    size: PhotoSourceKey;
};
export type PhotoTileWindowOptions = {
    /** Screen pixels around the viewport whose tiles are mounted. */
    mountOverscan: number;
    /** Screen pixels around the viewport whose thumbnails are fetched ahead. */
    preloadMargin: number;
    /** At most this many tiles mounted, nearest the centre first. */
    maxTiles?: number;
    dprCap: number;
};
/**
 * The source size for a tile whose long edge spans `pixels` device pixels: the smallest whose
 * short edge, in usual photo sources, covers it.
 */
export declare function photoSizeForPixels(pixels: number): PhotoSourceKey;
/** A tile's image URL at a size. Scene tiles have every size (missing ones fall back to another). */
export declare const sourceFor: (tile: GallySceneWrappedPhotoTile<unknown>, size: PhotoSourceKey) => string;
export type PhotoTileWindow<Metadata> = {
    tiles: Array<MountedPhotoTile<Metadata>>;
    /** Bumps when an image a mounted tile can show became ready. */
    imagesVersion: number;
    /** Call whenever the camera moves; cheap unless the mounted set must change. */
    update(camera: Camera, viewport: Viewport, force?: boolean): void;
    /** Unmount everything and stop loading. */
    clear(): void;
    /** Records what the tiles showed once rendered (see `PhotoTiles`). */
    noteRendered(tiles: Array<MountedPhotoTile<Metadata>>, urls: Array<string | undefined>): void;
    /** The image a tile shows now: its URL, and whether it's the size it wants or sharper. */
    shown(mounted: MountedPhotoTile<Metadata>): {
        url: string;
        sharp: boolean;
    } | undefined;
    /** Tiles on screen, and how many show an image, and the size they want. */
    stats(camera: Camera, viewport: Viewport): {
        visibleTiles: number;
        filledTiles: number;
        sharpTiles: number;
    };
};
export declare function usePhotoTileWindow<Metadata>(scene: GallyPhotoScene<Metadata>, loader: GallyImageLoader, options: PhotoTileWindowOptions): PhotoTileWindow<Metadata>;
export type PhotoTilesProps<Metadata> = {
    window: PhotoTileWindow<Metadata>;
    variant: 'canvas' | 'hybrid';
    selectedPhotoId?: string | null;
    spotlightPhotoId?: string | null;
    onSelect?: (tile: GallySceneWrappedPhotoTile<Metadata>) => void;
};
/** The mounted tiles. Each re-renders only when its image or selection changes. */
export declare function PhotoTiles<Metadata>({ window, variant, selectedPhotoId, spotlightPhotoId, onSelect }: PhotoTilesProps<Metadata>): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=photo-tile-layer.d.ts.map