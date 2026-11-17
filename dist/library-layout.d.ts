import type { Bounds, Viewport } from './types.js';
/**
 * Library Layout: photos in capture order on a square grid whose column count snaps between zoom
 * levels, like a photo library. World space is the scrollable content; the camera is the scroll
 * offset plus the level. Changing level reflows the grid, so the transition between levels is a
 * camera zoom around one focus photo (see `planLibraryZoom`).
 */
export type GallyLibraryLayoutOptions = {
    /** Space between tiles in CSS pixels. */
    gap: number;
    /**
     * Zoom levels as target tile sizes in CSS pixels, largest first. Columns derive from the width.
     * By default `GallyLibrary` picks them by screen width (see `columns`). Few, far-apart levels make
     * each pinch a clear change.
     */
    levels: number[];
    /**
     * Zoom levels as column counts instead, whatever the width: phones use Apple Photos' 1, 3, 5, 15
     * and 33 by default (`phoneLibraryColumns`), which tile sizes can't give at every iPhone width.
     */
    columns?: number[];
    /** Space above the first row and below the last, e.g. for overlaid app chrome. */
    insetTop: number;
    insetBottom: number;
};
/** Phones: Apple Photos' 1, 3, 5, 15 and 33 columns, at any phone width. */
export declare const phoneLibraryColumns: number[];
/** Wider screens: four even steps of tile size, e.g. 4, 7, 14 and 29 columns at 1440 px. */
export declare const wideLibraryLevels: number[];
/** The default levels for a screen this wide (level 1 is the standard view on either). */
export declare function defaultLibraryLevels(width: number): Pick<GallyLibraryLayoutOptions, 'levels' | 'columns'>;
/** How many levels there are. */
export declare function libraryLevelCount(options?: GallyLibraryLayoutOptions): number;
export declare const defaultLibraryLayoutOptions: GallyLibraryLayoutOptions;
export type GallyLibraryGeometry = {
    viewport: Viewport;
    count: number;
    columns: number;
    /** Tile size in CSS pixels. */
    cell: number;
    /** Tile size plus gap. */
    pitch: number;
    rows: number;
    contentHeight: number;
    maxScroll: number;
    gap: number;
    insetTop: number;
    insetBottom: number;
};
export type GallyLibraryRange = {
    start: number;
    end: number;
    firstRow: number;
    lastRow: number;
};
export type GallyLibraryWindows = {
    /** Photos on screen, not counting rows hidden under `insetTop`. */
    visible: GallyLibraryRange;
    /** Photos to keep rendered and loading around the visible ones. */
    preload: GallyLibraryRange;
};
export declare function getLibraryColumns(width: number, level: number, options?: GallyLibraryLayoutOptions): number;
export declare function getLibraryCellSize(width: number, columns: number, options?: GallyLibraryLayoutOptions): number;
export declare function getLibraryGeometry(viewport: Viewport, count: number, columns: number, options?: GallyLibraryLayoutOptions): GallyLibraryGeometry;
/** A tile's rectangle in content coordinates. */
export declare function getLibraryTileRect(index: number, geometry: GallyLibraryGeometry): Bounds;
/** The tile at a point in content coordinates, or the nearest one when the point is in a gap or margin. */
export declare function getLibraryIndexAt(x: number, y: number, geometry: GallyLibraryGeometry): number;
export declare function getLibraryWindows(geometry: GallyLibraryGeometry, scrollTop: number, overscanRows?: number): GallyLibraryWindows;
/**
 * Windows for a span of content rather than a scroll position, e.g. what a pinch shows while it
 * scales the grid: `visible` covers `[visibleTop, visibleBottom)`, `preload` `[top, bottom)`.
 */
export declare function getLibraryWindowsForSpan(geometry: GallyLibraryGeometry, span: {
    top: number;
    bottom: number;
    visibleTop: number;
    visibleBottom: number;
}): GallyLibraryWindows;
/** Scroll offset that shows a photo: at the top, centred, or (`nearest`) moving as little as possible from `scrollTop`. */
export declare function scrollTopForIndex(index: number, geometry: GallyLibraryGeometry, align: 'start' | 'center' | 'end' | 'nearest', scrollTop?: number): number;
/** Where a photo of this size sits in a square tile: filling it (`square`, cropped) or fitted whole (`aspect`). */
export declare function fitPhotoInTile(tile: Bounds, photoWidth: number, photoHeight: number, fit: 'square' | 'aspect'): Bounds;
/** The next level in `direction` (-1 zooms in) that actually changes the column count. */
export declare function stepLibraryLevel(level: number, direction: -1 | 1, width: number, options?: GallyLibraryLayoutOptions): number;
/** The level whose tile size is closest, on a log scale, to `cellSize`. Used to snap a pinch. */
export declare function nearestLibraryLevel(cellSize: number, width: number, options?: GallyLibraryLayoutOptions): number;
export type GallyLibraryZoomPlan = {
    /** Scroll offset for the new level that keeps the focus photo at the same height on screen. */
    scrollTop: number;
    /**
     * Screen-space zoom that carries the focus photo from where it was to where it will be:
     * `point' = scale * point + translate`. The outgoing layer animates to it; the incoming layer
     * animates from its inverse.
     */
    scale: number;
    translateX: number;
    translateY: number;
};
/**
 * Plan a level change around a focus photo.
 *
 * @param from Where the focus photo is on screen now (may include a pinch in progress).
 * @param focusY Screen y of the focus point (pointer, or the photo's centre).
 */
export declare function planLibraryZoom(next: GallyLibraryGeometry, index: number, from: {
    x: number;
    y: number;
    size: number;
}, focusY: number): GallyLibraryZoomPlan;
//# sourceMappingURL=library-layout.d.ts.map