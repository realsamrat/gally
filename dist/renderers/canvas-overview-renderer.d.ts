import { GallyImageLoader, type GallyImagePriority } from '../image-loader.js';
import type { Camera, Viewport } from '../types.js';
import { type GallyPhotoScene } from '../scene/photo-scene.js';
export type CanvasOverviewRendererOptions = {
    dprCap?: number;
    overscanScreenPx?: number;
    placeholderColor?: string;
    /** Called when a thumbnail it waits for becomes ready, so the caller can render again. */
    onInvalidate?: () => void;
    /** Share a loader to share its decoded images with other renderers. */
    loader?: GallyImageLoader;
    /**
     * Short edge, in device pixels, of the bitmaps a blob-mode loader makes for thumbnails: about the
     * largest a tile is drawn. Made off the main thread, they keep decoding out of frames. Default 160.
     */
    bitmapEdge?: number;
};
export type CanvasOverviewRenderOptions = {
    camera: Camera;
    viewport: Viewport;
    overscanScreenPx?: number;
    /** How urgently to load the thumbnails it draws: `near` when drawing ahead while hidden. Default `visible`. */
    priority?: GallyImagePriority;
};
/** @deprecated Same as `CanvasOverviewRenderOptions`. */
export type CanvasOverviewWarmupOptions = CanvasOverviewRenderOptions;
export declare class CanvasOverviewRenderer<Metadata = unknown> {
    private readonly canvas;
    private readonly context;
    private scene;
    private readonly loader;
    private readonly channel;
    /** Warm-ups use their own channel, so a render elsewhere doesn't drop what they asked for. */
    private readonly warmChannel;
    private readonly unsubscribe;
    private highlightedTileId;
    private stats;
    /** Thumbnails the last render drew placeholders for. */
    private waiting;
    /** Images this renderer has drawn, whose decoded pixels the browser has cached. */
    private drawnImages;
    private readonly onInvalidate;
    private followUp;
    private readonly options;
    constructor(canvas: HTMLCanvasElement, scene: GallyPhotoScene<Metadata>, options?: CanvasOverviewRendererOptions);
    /** Tiles on screen in the last render, and how many it drew with their thumbnail. */
    getStats(): {
        visibleTiles: number;
        filledTiles: number;
        sharpTiles: number;
    };
    setScene(scene: GallyPhotoScene<Metadata>): void;
    setHighlightedTileId(tileId: string | null): void;
    destroy(): void;
    /** Start loading the thumbnails a render with these options would draw, without drawing. */
    warmup({ camera, viewport, overscanScreenPx }: CanvasOverviewRenderOptions): void;
    render({ camera, viewport, overscanScreenPx, priority }: CanvasOverviewRenderOptions): void;
    /** Where the last ring demand was made, so it's redone only once the camera has moved on. */
    private demanded;
    /**
     * Ask for the on-screen thumbnails first and those in a ring around the screen after. The ring is
     * re-queried only after the camera moves a quarter screen or zooms by 15%; in between, the
     * on-screen tiles are re-demanded alongside the last ring.
     */
    private ring;
    private demandAround;
}
//# sourceMappingURL=canvas-overview-renderer.d.ts.map