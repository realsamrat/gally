import { type GallyLibraryGeometry, type GallyLibraryRange } from '../library-layout.js';
/**
 * Canvas renderer for dense Library Layout levels.
 *
 * Hundreds of DOM tiles per screen is where a DOM grid stops keeping up, so dense levels draw onto
 * canvases instead. The grid is split into horizontal bands, one canvas each, placed in the
 * scrolling content: native scrolling moves them on the compositor, and a band is only redrawn
 * when it first appears or when one of its tiles gets a better image.
 */
export type LibraryCanvasTileImage = {
    image: CanvasImageSource;
    width: number;
    height: number;
    /** True when this is the size the tile wants, so it won't be redrawn again. */
    sharp: boolean;
};
export type LibraryCanvasRenderInput = {
    geometry: GallyLibraryGeometry;
    range: GallyLibraryRange;
    /** Rows on screen. Their bands draw immediately; the rest of `range` draws on the next frame. */
    visible?: GallyLibraryRange;
    fit: 'square' | 'aspect';
    imageFor: (index: number) => LibraryCanvasTileImage | undefined;
    placeholderFor: (index: number) => string;
    selectedIndex: number | null;
    hiddenIndex: number | null;
    /** Selection ring, matching the DOM tiles' CSS. */
    ring: {
        color: string;
        width: number;
    };
    /** Device pixel ratio the bands are drawn at. */
    dpr: number;
    /**
     * Place the bands now but draw them on the next frame, e.g. while something covers them, so a
     * frame that already does a lot (a level change) doesn't draw too.
     */
    deferDraw?: boolean;
    /**
     * Changes whenever images become ready, e.g. the loader's `getVersion()`. Bands with tiles still
     * waiting for an image re-check them when it changes; leave it out to re-check on every render.
     * `renderTiles` covers a version for the tiles it is given.
     */
    version?: number;
};
type Band = {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    layoutKey: string;
    firstRow: number;
    rowCount: number;
    states: Uint8Array;
    /**
     * Needs a full pass: new, or a tile was skipped (upload or time budget). Tiles waiting for
     * sharper images don't make a band stale: `renderTiles` draws them when their images arrive.
     */
    stale: boolean;
    /** Has had a full pass since it was placed, so it shows at least placeholders. */
    drawn: boolean;
    /** Some tile isn't showing its wanted image yet, as of `checkedVersion`. */
    unfinished: boolean;
    checkedVersion: number | undefined;
    /** A pass interrupted by a budget: the slot it stopped at, the slots it has left, and whether it held a tile back. */
    cursor: number;
    remaining: number;
    passSkipped: boolean;
    selectedIndex: number | null;
    hiddenIndex: number | null;
};
/**
 * Bands already drawn for levels that aren't on screen, kept so coming back to a level shows it
 * as it was instead of drawing it again tile by tile. Share one between the renderers a component
 * makes (one per stretch of canvas levels), and `clear` it when the photos change.
 */
export declare class LibraryBandCache {
    private readonly layouts;
    /** Canvases shown elsewhere for now (a transition's outgoing copy). */
    private readonly lent;
    private pixels;
    /** @internal */
    keep(key: number, band: Band): void;
    /** Over budget: the oldest bands not lent out go, oldest level first, all but `keep`. */
    private trim;
    /** @internal A kept band for this layout and key, unless it's lent out. */
    take(layoutKey: string, key: number): Band | undefined;
    /** @internal */
    lend(key: number, band: Band): void;
    /** Canvases lent to a copy are back: their bands can show their level again. */
    giveBack(canvases: Iterable<HTMLCanvasElement>): void;
    clear(): void;
    private drop;
}
export declare class LibraryCanvasRenderer {
    private readonly container;
    private readonly cache;
    private readonly bands;
    private readonly spare;
    private lastInput;
    private deferredFrame;
    /** Images already drawn once, so drawing them again uploads nothing. */
    private readonly uploaded;
    private uploadBudget;
    /** When this frame's first upload started (-1: none yet). */
    private uploadStart;
    private refillFrame;
    private overBudget;
    private lastVisible;
    /** Since a `deferDraw` render: the bands are covered, so every pass draws within a time budget until all on screen are drawn. */
    private covered;
    constructor(container: HTMLElement, cache?: LibraryBandCache);
    /** Draw the bands covering `range`. Cheap to call often: unchanged bands are skipped. */
    render(input: LibraryCanvasRenderInput): void;
    /** A pass the caller asked for re-checks tiles waiting for images; follow-ups the renderer schedules itself don't. */
    private renderPass;
    /** The budget is per frame, however many times the renderer draws in it. */
    private spendUploadBudget;
    /** Whether another image can be drawn for the first time this frame. */
    private canUpload;
    /**
     * What a tile shows now: 0 nothing, 1 its placeholder, 2 an image that isn't the wanted size
     * yet, 3 the wanted image. Tiles outside the drawn bands are 0.
     */
    tileState(index: number): number;
    private scheduleDeferred;
    /**
     * Paint the current bands into another canvas through a content-to-screen transform, for the
     * zoom transition's outgoing snapshot.
     */
    snapshot(context: CanvasRenderingContext2D, contentToScreen: DOMMatrix): void;
    /**
     * Hand the drawn band canvases over, e.g. to a pinch's copy of the outgoing grid, which shows them
     * where they are in content coordinates. The renderer forgets them and draws new ones.
     */
    detachBands(): HTMLCanvasElement[];
    /** Forget what the bands show (the photos changed): every band draws again from nothing. */
    reset(): void;
    destroy(): void;
    private acquire;
    private release;
    /**
     * Redraw only these tiles, e.g. the ones whose images just became ready: the cost follows what
     * changed, not how many tiles are on screen. Tiles outside the drawn bands are left to `render`.
     */
    renderTiles(input: LibraryCanvasRenderInput, indices: Iterable<number>): void;
    /** Tiles still waiting for images, and images may have changed since they were checked. */
    private recheckDue;
    private bandSpan;
    private decorationFor;
    private decorationChanged;
    private setState;
    /** Draw the band's tiles that can show something better; false if the deadline cut it short. */
    private drawBand;
    /** The image a tile can draw now, within this frame's upload budget. */
    private pickImage;
    /** Draw one tile if it can now show something better than it does; false if the upload budget held it back. */
    private drawTile;
}
export {};
//# sourceMappingURL=library-canvas-renderer.d.ts.map