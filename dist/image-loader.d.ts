import type { GallyNetworkQualityLevel } from './lod.js';
/**
 * Gally image loader.
 *
 * Each consumer (a component, a renderer, an engine) opens a channel and describes what it needs
 * right now with `channel.demand()`: every image its current window wants, each with a priority.
 * The loader starts on-screen images first, cancels or drops work no channel demands any more,
 * keeps decoded images for instant reuse, and adapts to the network it observes. Consumers that
 * share a loader share its cache without cancelling each other's work. Getters are pure, so
 * reading the cache (for rendering or stats) never changes what it does.
 */
export type GallyImagePriority = 'visible' | 'near' | 'prefetch';
export type GallyImageDemand = {
    src: string;
    priority: GallyImagePriority;
};
/** One consumer's demands. A new `demand` replaces the channel's previous one; `release` withdraws it. */
export type GallyImageChannel = {
    demand(requests: Iterable<GallyImageDemand>): void;
    release(): void;
};
/** How the loader judges the connection: from `navigator.connection` where browsers expose it, otherwise from measured load times. */
export type GallyNetworkQuality = GallyNetworkQualityLevel;
export type GallyImageLoaderMode = 
/** Plain image elements. Works with any image URL and the browser's HTTP cache. */
'element'
/**
 * `fetch` + bitmaps. Needs same-origin or CORS: a cross-origin image whose fetch fails loads as
 * a plain image element instead, and so do later images from its origin. Gives requests real network priorities, lets
 * in-flight requests be cancelled, measures bytes exactly, and fetches and decodes in a worker
 * where possible, so a screenful of images arriving at once doesn't cost frames. Image elements
 * are made only when asked for (`prepareElements`). Also makes redirecting image URLs reusable.
 */
 | 'blob';
export type GallyImageLoaderOptions = {
    mode?: GallyImageLoaderMode;
};
export type GallyLoadedImage = {
    /** The URL that was requested. */
    src: string;
    /** The URL to render: `src` in element mode or for inline images, else an object URL in blob mode. */
    url: string;
    /**
     * In blob mode, made on first use and may still be decoding: check `isRenderable`, or ask with
     * `prepareElements`; canvas renderers can draw `getBitmap` instead.
     */
    image: HTMLImageElement;
    width: number;
    height: number;
};
export type GallyImageLoaderStats = {
    /** Network loads started. Inline (data:) images aren't counted. */
    started: number;
    loaded: number;
    failed: number;
    /** In-flight loads cancelled before their first byte arrived: free. */
    aborted: number;
    /** Queued requests dropped before they reached the network: free. */
    dropped: number;
    queued: number;
    inFlight: number;
    cachedImages: number;
    cachedPixels: number;
    bytes: number;
    medianLoadMs: number;
    p95LoadMs: number;
    network: GallyNetworkQuality;
    concurrency: number;
};
export declare class GallyImageLoader {
    private readonly mode;
    /** Blob mode: origins whose images can't be fetched (no CORS), so they load as elements. */
    private readonly elementOrigins;
    /** Blob mode: blocked fetches per origin; one could be a network blip, two mean no CORS. */
    private readonly blockedFetches;
    private readonly entries;
    /** Queued and loading network entries: the only ones a new demand can cancel. */
    private readonly pending;
    private readonly lanes;
    private readonly listeners;
    private changed;
    private readonly durations;
    private readonly bitmapQueue;
    private readonly elementQueue;
    private elementScheduled;
    private readonly inlineQueue;
    private inlineScheduled;
    /** Every channel's current demand; their union is what the loader keeps and loads. */
    private readonly channels;
    private demanded;
    private active;
    private activeBackground;
    private bitmapsActive;
    private bitmapScheduled;
    private pumpScheduled;
    private notifyScheduled;
    private version;
    private cachedPixels;
    private observedMs;
    private readyCount;
    private evictBlockedUntil;
    private sortedDurations;
    private protocolLimit;
    private totals;
    /** Blob mode: fetches and decodes, in a worker where possible. Made on the first load. */
    private fetcher;
    constructor(options?: GallyImageLoaderOptions);
    /**
     * A channel for one consumer. Each `demand` lists everything it needs now: images demanded again
     * keep loading (and can move up in priority), and within a priority the last listed loads first.
     * Work no channel demands any more is dropped if queued, and cancelled if in flight with no bytes
     * received yet (in blob mode).
     */
    channel(): GallyImageChannel;
    private settleDemand;
    /** The decoded image, if it's ready. */
    get(src: string): GallyLoadedImage | undefined;
    /**
     * Whether an image element can show this image now, without decoding in the frame that paints
     * it. Always true once loaded in element mode; in blob mode, once `prepareElements` made it.
     */
    isRenderable(src: string): boolean;
    /**
     * Blob mode: make decoded image elements for loaded images, a few per short task;
     * subscribers hear as each is ready (`isRenderable`). Images load without them, so canvas
     * renderers never pay for object URLs; DOM renderers ask for the images they show.
     */
    prepareElements(srcs: Iterable<string>): void;
    /** A small GPU-ready bitmap of a loaded image, for canvas renderers, once `prepareBitmaps` made it. */
    getBitmap(src: string): ImageBitmap | undefined;
    /**
     * Make GPU-ready bitmaps of loaded images, scaled to `shortEdge` pixels, a few at a time in
     * short tasks; subscribers hear as each is ready. Drawing a full-size photo onto a canvas
     * the first time uploads all of it; a small bitmap made off the main thread doesn't stall a frame.
     */
    prepareBitmaps(srcs: Iterable<string>, shortEdge: number): void;
    /**
     * Called at most once per frame after images, bitmaps or image elements become ready, with the
     * `src` of each, so renderers can redraw only what changed.
     */
    subscribe: (listener: (changed: readonly string[]) => void) => (() => void);
    /** Changes whenever images or bitmaps become ready (for `useSyncExternalStore`). */
    getVersion: () => number;
    getNetworkQuality(): GallyNetworkQuality;
    /** Cheap enough to call every frame. */
    getStats(): GallyImageLoaderStats;
    private want;
    private backgroundLimit;
    /**
     * Requests from one demand are scheduled together, after all are queued, so the first few
     * listed can't start ahead of higher-priority ones listed after them.
     */
    private schedulePump;
    /**
     * On-screen images own the connection: they all start at once (one round trip for the whole
     * screen, within the protocol's limit), and background work waits while any are queued and uses
     * few slots while they download, so it never shares their bandwidth.
     */
    private pump;
    /** Newest first; stale copies left by priority changes or cancellation are skipped. */
    private pop;
    private hasQueued;
    private load;
    /**
     * Blob mode: the loaded image from its blob and decoded size. A small decoded bitmap is kept for
     * canvas renderers; the object URL and image element are made only if something renders them.
     */
    private blobImage;
    /** Inline images in demand order, a short task at a time; they show before network images, so ahead of background work. */
    private pumpInline;
    /** Newest requests first, a short task at a time: each object URL is a synchronous call into the browser. */
    private pumpElements;
    /**
     * Starts at most one bitmap per task: creating a bitmap from an image element resizes on the main
     * thread in some browsers, and several in one task make a long task. Like image elements, these
     * are for tiles on screen, so they run at user-visible priority: background tasks can wait as long
     * as the page stays busy, leaving tiles blank through a whole pinch.
     */
    private pumpBitmaps;
    private createBitmap;
    private resizeElement;
    private record;
    private evict;
    /** Once per frame; the timer covers hosts that aren't painting (background tabs, embedded previews). */
    private notify;
}
//# sourceMappingURL=image-loader.d.ts.map