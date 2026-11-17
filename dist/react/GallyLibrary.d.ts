import { type ReactElement, type Ref } from 'react';
import { GallyImageLoader, type GallyImageLoaderStats, type GallyLoadedImage } from '../image-loader.js';
import { type GallyLibraryLayoutOptions } from '../library-layout.js';
import { type LodConfig } from '../lod.js';
import type { GallyCanvasPhoto, GallyCanvasSelection } from './types.js';
export type GallyLibraryFit = 'square' | 'aspect';
/**
 * `hybrid` draws dense levels on Canvas and close levels as DOM tiles; `dom` always uses DOM
 * tiles. Hybrid is the default because hundreds of DOM tiles per screen is where a grid drops frames.
 */
export type GallyLibraryRenderer = 'hybrid' | 'dom';
/** A debug snapshot of what the library shows and loads. */
export type GallyLibraryStats = {
    level: number;
    mode: 'canvas' | 'dom';
    visibleTiles: number;
    /** Visible tiles showing any image. */
    filledTiles: number;
    /** Visible tiles showing the size their zoom level wants. */
    sharpTiles: number;
    loader: GallyImageLoaderStats;
};
export type GallyLibraryPinchEvent = {
    /**
     * `start` and `end` bracket a pinch; `move` follows the fingers; `commit` is the level mostly on
     * screen changing mid-pinch (the two grids pass the middle of their dissolve).
     */
    phase: 'start' | 'move' | 'commit' | 'end';
    /** The level mostly on screen. */
    level: number;
    columns: number;
    /** That grid's scale on screen, relative to the level's own size. */
    scale: number;
    /** How far the fingers have zoomed since the pinch began (1 = not at all), before any resistance. */
    fingers: number;
    /** The scroll position, for recordings (`?debug=1` in the playground). */
    scrollTop: number;
};
export type GallyLibraryHandle = {
    /** Focus the grid so arrow keys, Enter and ⌘+ / ⌘− work. */
    focus(): void;
    zoomIn(): void;
    zoomOut(): void;
    /** Change level around a focus: a point in the component's coordinates, a photo index, or (default) the selection or centre. */
    zoomToLevel(level: number, focus?: {
        x: number;
        y: number;
    } | {
        index: number;
    }): void;
    scrollToIndex(index: number, align?: 'start' | 'center' | 'end' | 'nearest'): void;
    /** A photo's rectangle on screen (client coordinates), for transitions such as opening a viewer. */
    getTileRect(index: number): DOMRect | null;
    /** The sharpest image already loaded for a photo, for example to show instantly in a viewer. */
    getLoadedImage(index: number): GallyLoadedImage | undefined;
    /** The photos on screen, and the image URL each wants at the current level. */
    getVisibleWindow(): {
        start: number;
        end: number;
        sources: string[];
    };
    /** The element that scrolls, for driving or observing scrolling. */
    getScrollElement(): HTMLElement | null;
    getStats(): GallyLibraryStats;
};
export type GallyLibraryProps<Metadata = unknown> = {
    photos: Array<GallyCanvasPhoto<Metadata>>;
    className?: string;
    'aria-label'?: string;
    fit?: GallyLibraryFit;
    renderer?: GallyLibraryRenderer;
    /** Tiles smaller than this (CSS pixels) render on Canvas in hybrid mode. Default 110. */
    denseCellSize?: number;
    layout?: Partial<GallyLibraryLayoutOptions>;
    /** Starting level, an index into `layout.levels`. Default 1 (3 columns on a phone). */
    defaultLevel?: number;
    /** The level a click returns to when zoomed out further (as on iPhone). Default 1. */
    standardLevel?: number;
    /** Zoomed out past `standardLevel`, a click zooms back around the photo instead of only selecting it. Default true. */
    tapToZoom?: boolean;
    onLevelChange?: (level: number) => void;
    /** A pinch as it happens: its live scale, and when a level takes over. For zoom indicators and debugging. */
    onPinch?: (event: GallyLibraryPinchEvent) => void;
    initialScroll?: 'start' | 'end' | {
        index: number;
    };
    selectedIndex?: number | null;
    onSelectedIndexChange?: (index: number) => void;
    /** Hide one photo, e.g. while a viewer shows it enlarged. */
    hiddenIndex?: number | null;
    /** Double-click, Enter or Space on the selection. */
    onOpenPhoto?: (selection: GallyCanvasSelection<Metadata>) => void;
    onVisibleRangeChange?: (range: {
        start: number;
        end: number;
    }) => void;
    /** Share one loader between components to share its cache. */
    loader?: GallyImageLoader;
    /**
     * When each source size is used, by tile width in device pixels, and the highest pixel ratio to
     * serve. Match it to your image sizes: e.g. thumb 160 px, small 400 px, medium 800 px →
     * `{ thumbMaxScreenWidth: 176, smallMaxScreenWidth: 440, mediumMaxScreenWidth: 880 }`.
     * Scaled down on slow networks.
     */
    lod?: Partial<LodConfig>;
};
export declare const GallyLibrary: <Metadata = unknown>(props: GallyLibraryProps<Metadata> & {
    ref?: Ref<GallyLibraryHandle>;
}) => ReactElement | null;
//# sourceMappingURL=GallyLibrary.d.ts.map