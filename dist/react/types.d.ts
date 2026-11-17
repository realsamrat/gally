import type { GallyImageLoaderStats } from '../image-loader.js';
import type { GallyPhoto, GallyPhotoSelection } from '../types.js';
export type GallyCanvasPhoto<Metadata = unknown> = GallyPhoto<Metadata>;
export type GallyCanvasBackground = 'plain' | 'dotted' | 'none';
export type GallyCanvasTheme = {
    background?: GallyCanvasBackground;
    backgroundColor?: string;
    dotColor?: string;
};
export type GallyCanvasSelection<Metadata = unknown> = GallyPhotoSelection<Metadata>;
/** What a canvas shows right now, for benchmarks and diagnostics. */
export type GallyCanvasStats = {
    zoom: number;
    /** Which layer is showing: DOM Photo Tiles, or the hybrid's Canvas Overview Layer. */
    layer: 'dom' | 'canvas';
    /** Photo Tiles on screen (each wrapped copy counts). */
    visibleTiles: number;
    /** On-screen tiles showing any image. */
    filledTiles: number;
    /** On-screen tiles showing the image size their layer wants. */
    sharpTiles: number;
    /** The image loader's counters (shared with anything else using the same loader). */
    loader: GallyImageLoaderStats;
};
/** Imperative handle of `GallyCanvas` and `GallyHybridCanvas`. */
export type GallyCanvasHandle = {
    /** The element that receives gestures (pointer, wheel and Safari gesture events). */
    getElement(): HTMLElement | null;
    getStats(): GallyCanvasStats;
    /** Image URLs of the tiles on screen. */
    getVisibleSources(): string[];
};
//# sourceMappingURL=types.d.ts.map