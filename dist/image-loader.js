import { createWorkerFetcher, decodeImageBlob, FetchAborted, FetchBlocked, mainThreadFetcher } from './image-fetcher.js';
const TUNING = {
    /** Parallel background loads by network quality. */
    concurrency: { fast: 48, normal: 10, slow: 4 },
    /** On-screen loads all start at once, up to this; HTTP/2 servers usually allow 100 streams. */
    visibleLimit: 64,
    /** Background loads allowed while on-screen loads are still downloading. */
    backgroundWhileVisible: 2,
    /** HTTP/1.1 browsers allow this many connections per host; more only queue out of our control. */
    http1Limit: 6,
    /** Measured on-screen load time (ms) above which the network counts as normal / slow. */
    normalAfterMs: 600,
    slowAfterMs: 1500,
    /** A failed image isn't asked for again for this long. */
    retryFailedAfterMs: 30_000,
    /** Decoded pixels kept before evicting least recently demanded images (about 96 MB). */
    maxCachedPixels: 24_000_000,
    /** Recently demanded images are never evicted. */
    evictGraceMs: 2000,
    bitmapConcurrency: 6,
    /** Main-thread time per task for making image elements (each costs an object URL) or starting inline images. */
    taskBudgetMs: 1.5,
    /** In blob mode, images this small (short edge, pixels) keep the bitmap they were decoded into, ready for canvas. */
    keepBitmapEdge: 256,
    /** After an eviction pass that couldn't free enough (everything was recently demanded), wait this long before the next. */
    evictRetryMs: 250,
};
const RANK = { visible: 0, near: 1, prefetch: 2 };
/** A bitmap, not a state marker; safe where browsers have no `ImageBitmap` at all. */
const isBitmap = (value) => typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap;
/** Inline images (data: URLs, such as blur-up previews) need no network and decode straight away. */
const isInline = (src) => src.startsWith('data:');
/** The origin of a cross-origin image URL, or undefined for same-origin and inline ones. */
function crossOrigin(src) {
    if (isInline(src) || typeof location === 'undefined')
        return undefined;
    try {
        const origin = new URL(src, location.href).origin;
        return origin === location.origin ? undefined : origin;
    }
    catch {
        return undefined;
    }
}
export class GallyImageLoader {
    mode;
    /** Blob mode: origins whose images can't be fetched (no CORS), so they load as elements. */
    elementOrigins = new Set();
    /** Blob mode: blocked fetches per origin; one could be a network blip, two mean no CORS. */
    blockedFetches = new Map();
    entries = new Map();
    /** Queued and loading network entries: the only ones a new demand can cancel. */
    pending = new Set();
    lanes = { visible: [], near: [], prefetch: [] };
    listeners = new Set();
    changed = [];
    durations = [];
    bitmapQueue = [];
    elementQueue = [];
    elementScheduled = false;
    inlineQueue = [];
    inlineScheduled = false;
    /** Every channel's current demand; their union is what the loader keeps and loads. */
    channels = new Map();
    demanded = new Set();
    active = 0;
    activeBackground = 0;
    bitmapsActive = 0;
    bitmapScheduled = false;
    pumpScheduled = false;
    notifyScheduled = false;
    version = 0;
    cachedPixels = 0;
    observedMs = 0;
    readyCount = 0;
    evictBlockedUntil = 0;
    sortedDurations = null;
    protocolLimit;
    totals = { started: 0, loaded: 0, failed: 0, aborted: 0, dropped: 0, bytes: 0 };
    /** Blob mode: fetches and decodes, in a worker where possible. Made on the first load. */
    fetcher;
    constructor(options = {}) {
        this.mode = options.mode ?? 'element';
    }
    /**
     * A channel for one consumer. Each `demand` lists everything it needs now: images demanded again
     * keep loading (and can move up in priority), and within a priority the last listed loads first.
     * Work no channel demands any more is dropped if queued, and cancelled if in flight with no bytes
     * received yet (in blob mode).
     */
    channel() {
        const key = {};
        return {
            demand: (requests) => {
                const time = now();
                const srcs = new Set();
                for (const { src, priority } of requests) {
                    srcs.add(src);
                    this.want(src, priority, time);
                }
                this.channels.set(key, srcs);
                this.settleDemand();
            },
            release: () => {
                this.channels.delete(key);
                this.settleDemand();
            },
        };
    }
    settleDemand() {
        const demanded = new Set();
        for (const srcs of this.channels.values())
            for (const src of srcs)
                demanded.add(src);
        this.demanded = demanded;
        for (const entry of this.pending) {
            if (demanded.has(entry.src))
                continue;
            if (entry.state === 'queued') {
                entry.state = 'canceled';
                this.pending.delete(entry);
                this.totals.dropped++;
            }
            else if (entry.state === 'loading') {
                entry.cancel?.();
            }
        }
        this.schedulePump();
    }
    /** The decoded image, if it's ready. */
    get(src) {
        const entry = this.entries.get(src);
        return entry?.state === 'ready' ? entry.loaded : undefined;
    }
    /**
     * Whether an image element can show this image now, without decoding in the frame that paints
     * it. Always true once loaded in element mode; in blob mode, once `prepareElements` made it.
     */
    isRenderable(src) {
        const entry = this.entries.get(src);
        return entry?.state === 'ready' && (this.mode === 'element' || entry.element === 'ready');
    }
    /**
     * Blob mode: make decoded image elements for loaded images, a few per short task;
     * subscribers hear as each is ready (`isRenderable`). Images load without them, so canvas
     * renderers never pay for object URLs; DOM renderers ask for the images they show.
     */
    prepareElements(srcs) {
        if (this.mode === 'element')
            return;
        for (const src of srcs) {
            const entry = this.entries.get(src);
            if (entry?.state !== 'ready' || entry.element)
                continue;
            entry.element = 'pending';
            this.elementQueue.push(entry);
        }
        this.pumpElements();
    }
    /** A small GPU-ready bitmap of a loaded image, for canvas renderers, once `prepareBitmaps` made it. */
    getBitmap(src) {
        const bitmap = this.entries.get(src)?.bitmap;
        return isBitmap(bitmap) ? bitmap : undefined;
    }
    /**
     * Make GPU-ready bitmaps of loaded images, scaled to `shortEdge` pixels, a few at a time in
     * short tasks; subscribers hear as each is ready. Drawing a full-size photo onto a canvas
     * the first time uploads all of it; a small bitmap made off the main thread doesn't stall a frame.
     */
    prepareBitmaps(srcs, shortEdge) {
        // Without bitmaps, renderers draw decoded image elements instead.
        if (typeof createImageBitmap !== 'function')
            return this.prepareElements(srcs);
        for (const src of srcs) {
            const entry = this.entries.get(src);
            if (entry?.state !== 'ready' || entry.bitmap)
                continue;
            entry.bitmap = 'pending';
            entry.bitmapEdge = shortEdge;
            this.bitmapQueue.push(entry);
        }
        this.pumpBitmaps();
    }
    /**
     * Called at most once per frame after images, bitmaps or image elements become ready, with the
     * `src` of each, so renderers can redraw only what changed.
     */
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    /** Changes whenever images or bitmaps become ready (for `useSyncExternalStore`). */
    getVersion = () => this.version;
    getNetworkQuality() {
        const connection = globalThis.navigator?.connection;
        if (connection?.saveData)
            return 'slow';
        const type = connection?.effectiveType;
        if (type === 'slow-2g' || type === '2g')
            return 'slow';
        if (type === '3g')
            return 'normal';
        // Browsers without the Network Information API (Safari, Firefox): judge by measured loads.
        if (this.observedMs > TUNING.slowAfterMs)
            return 'slow';
        if (this.observedMs > TUNING.normalAfterMs)
            return 'normal';
        return 'fast';
    }
    /** Cheap enough to call every frame. */
    getStats() {
        const sorted = (this.sortedDurations ??= [...this.durations].sort((a, b) => a - b));
        const network = this.getNetworkQuality();
        return {
            ...this.totals,
            // Pending entries are queued or loading; every loading network entry is active.
            // An aborted load and its replacement overlap for a moment.
            queued: Math.max(0, this.pending.size - this.active),
            inFlight: this.active,
            cachedImages: this.readyCount,
            cachedPixels: this.cachedPixels,
            medianLoadMs: percentile(sorted, 0.5),
            p95LoadMs: percentile(sorted, 0.95),
            network,
            concurrency: this.backgroundLimit(network),
        };
    }
    want(src, priority, time) {
        const existing = this.entries.get(src);
        if (existing)
            existing.lastDemanded = time;
        if (existing?.state === 'ready' || existing?.state === 'loading')
            return;
        if (existing?.state === 'failed' && time - existing.failedAt < TUNING.retryFailedAfterMs)
            return;
        if (existing?.state === 'queued') {
            if (RANK[priority] > RANK[existing.priority])
                return;
            existing.priority = priority;
            this.lanes[priority].push(existing);
            return;
        }
        const entry = existing ?? { src, state: 'queued', priority, lastDemanded: time, failedAt: 0, pixels: 0 };
        entry.state = 'queued';
        entry.priority = priority;
        this.entries.set(src, entry);
        if (isInline(src)) {
            // Started from a short task rather than here: a level change can demand hundreds at once.
            entry.state = 'loading';
            this.inlineQueue.push(entry);
            this.pumpInline();
            return;
        }
        this.pending.add(entry);
        this.lanes[priority].push(entry);
    }
    backgroundLimit(network = this.getNetworkQuality()) {
        return Math.min(TUNING.concurrency[network], this.protocolLimit ?? Infinity);
    }
    /**
     * Requests from one demand are scheduled together, after all are queued, so the first few
     * listed can't start ahead of higher-priority ones listed after them.
     */
    schedulePump() {
        if (this.pumpScheduled)
            return;
        this.pumpScheduled = true;
        queueMicrotask(() => {
            this.pumpScheduled = false;
            this.pump();
        });
    }
    /**
     * On-screen images own the connection: they all start at once (one round trip for the whole
     * screen, within the protocol's limit), and background work waits while any are queued and uses
     * few slots while they download, so it never shares their bandwidth.
     */
    pump() {
        const limit = this.backgroundLimit();
        for (;;) {
            let entry;
            if (this.hasQueued('visible')) {
                if (this.active < Math.min(this.protocolLimit ?? Infinity, TUNING.visibleLimit))
                    entry = this.pop('visible');
            }
            else if (this.active < limit) {
                const cap = this.active > this.activeBackground ? TUNING.backgroundWhileVisible : limit;
                if (this.activeBackground < cap)
                    entry = this.pop('near') ?? this.pop('prefetch');
            }
            if (!entry)
                return;
            const background = entry.priority !== 'visible';
            this.active++;
            if (background)
                this.activeBackground++;
            entry.state = 'loading';
            void this.load(entry).finally(() => {
                this.active--;
                if (background)
                    this.activeBackground--;
                // Cancelled and asked for again meanwhile: queued once more (or already loading again), so
                // it stays pending.
                if (entry.state !== 'queued' && entry.state !== 'loading')
                    this.pending.delete(entry);
                this.pump();
            });
        }
    }
    /** Newest first; stale copies left by priority changes or cancellation are skipped. */
    pop(lane) {
        const stack = this.lanes[lane];
        while (stack.length) {
            const entry = stack.pop();
            if (entry.state === 'queued' && entry.priority === lane)
                return entry;
        }
        return undefined;
    }
    hasQueued(lane) {
        const stack = this.lanes[lane];
        while (stack.length) {
            const top = stack[stack.length - 1];
            if (top.state === 'queued' && top.priority === lane)
                return true;
            stack.pop();
        }
        return false;
    }
    async load(entry) {
        const startedAt = now();
        const inline = isInline(entry.src);
        if (!inline)
            this.totals.started++;
        try {
            let loaded;
            let bytes = 0;
            let protocol;
            entry.pixels = 0;
            const origin = crossOrigin(entry.src);
            let viaElement = this.mode === 'element' || (origin !== undefined && this.elementOrigins.has(origin));
            if (!viaElement) {
                let fetched;
                // Workers need `createImageBitmap` to decode; without it, everything runs here.
                const fetcher = typeof createImageBitmap !== 'function' ? mainThreadFetcher : (this.fetcher ??= createWorkerFetcher() ?? mainThreadFetcher);
                // On the main thread, inline images become blobs without a fetch.
                const inlineBlob = inline && fetcher === mainThreadFetcher ? dataUrlBlob(entry.src) : undefined;
                if (inlineBlob) {
                    fetched = { blob: inlineBlob, bytes: 0, ...(await decodeImageBlob(inlineBlob, TUNING.keepBitmapEdge)) };
                }
                else {
                    const job = fetcher.fetch(entry.src, entry.priority === 'visible' ? 'high' : 'low', TUNING.keepBitmapEdge);
                    // Cancelling before the first byte wastes nothing; once bytes flow, finishing costs less
                    // than the transfer already spent, so the job ignores the cancel and the image stays cached.
                    entry.cancel = () => job.cancel();
                    try {
                        fetched = await job.promise;
                    }
                    catch (error) {
                        // A cross-origin image without CORS can't be fetched (nor a same-origin URL redirecting
                        // to one), but an image element can show it. HTTP errors are responses: failures.
                        if (!(error instanceof FetchBlocked) || inline)
                            throw error;
                        delete entry.cancel;
                        viaElement = true;
                    }
                }
                if (fetched) {
                    if (!inline) {
                        bytes = fetched.bytes;
                        protocol = fetched.protocol;
                    }
                    loaded = this.blobImage(entry, fetched);
                    // Its fetches work: earlier blocked ones were blips.
                    if (origin !== undefined)
                        this.blockedFetches.delete(origin);
                }
            }
            if (viaElement) {
                // Element mode can't tell when bytes start, so it never cancels.
                const image = new Image();
                image.decoding = 'async';
                image.fetchPriority = entry.priority === 'visible' ? 'high' : 'low';
                image.src = entry.src;
                await image.decode();
                loaded = { src: entry.src, url: entry.src, image, width: image.naturalWidth, height: image.naturalHeight };
                // The element is decoded: renderable as it is, in either mode.
                entry.element = 'ready';
                if (this.mode === 'blob' && origin !== undefined) {
                    const blocked = (this.blockedFetches.get(origin) ?? 0) + 1;
                    this.blockedFetches.set(origin, blocked);
                    if (blocked >= 2)
                        this.elementOrigins.add(origin);
                }
                if (!inline) {
                    const timing = resourceTiming(entry.src);
                    bytes = timing ? timing.encodedBodySize || timing.transferSize : 0;
                    protocol = timing?.nextHopProtocol;
                }
            }
            if (!inline) {
                // More parallel requests than an HTTP/1.1 host allows only queue inside the browser, where
                // the loader can no longer reprioritise them.
                if (protocol && this.protocolLimit === undefined) {
                    this.protocolLimit = /^http\/1/.test(protocol) ? TUNING.http1Limit : Infinity;
                }
                this.record(now() - startedAt, entry.priority);
            }
            entry.loaded = loaded;
            // The decoded image, plus any bitmap kept from decoding it.
            entry.pixels += loaded.width * loaded.height;
            entry.state = 'ready';
            this.readyCount++;
            this.cachedPixels += entry.pixels;
            this.totals.loaded++;
            this.totals.bytes += bytes;
            this.evict();
            this.notify(entry.src);
        }
        catch (error) {
            if (error instanceof FetchAborted) {
                entry.state = 'canceled';
                this.totals.aborted++;
                // Demanded again while the cancellation settled.
                if (this.demanded.has(entry.src)) {
                    this.want(entry.src, entry.priority, now());
                    this.schedulePump();
                }
            }
            else {
                entry.state = 'failed';
                entry.failedAt = now();
                this.totals.failed++;
            }
        }
        finally {
            delete entry.cancel;
        }
    }
    /**
     * Blob mode: the loaded image from its blob and decoded size. A small decoded bitmap is kept for
     * canvas renderers; the object URL and image element are made only if something renders them.
     */
    blobImage(entry, { blob, width, height, bitmap, url, revoke }) {
        entry.blob = blob;
        if (url)
            entry.objectUrl = url;
        if (revoke)
            entry.revokeUrl = revoke;
        if (bitmap) {
            entry.bitmap = bitmap;
            entry.bitmapEdge = Math.min(width, height);
            entry.pixels += bitmap.width * bitmap.height;
        }
        const inline = isInline(entry.src);
        const objectUrl = () => (inline ? entry.src : (entry.objectUrl ??= URL.createObjectURL(blob)));
        let image;
        return {
            src: entry.src,
            width,
            height,
            get url() {
                return objectUrl();
            },
            get image() {
                if (!image) {
                    image = new Image();
                    image.decoding = 'async';
                    image.src = objectUrl();
                }
                return image;
            },
        };
    }
    /** Inline images in demand order, a short task at a time; they show before network images, so ahead of background work. */
    pumpInline() {
        if (this.inlineScheduled || !this.inlineQueue.length)
            return;
        this.inlineScheduled = true;
        task(() => {
            this.inlineScheduled = false;
            const end = now() + TUNING.taskBudgetMs;
            while (this.inlineQueue.length && now() < end)
                void this.load(this.inlineQueue.shift());
            this.pumpInline();
        });
    }
    /** Newest requests first, a short task at a time: each object URL is a synchronous call into the browser. */
    pumpElements() {
        if (this.elementScheduled || !this.elementQueue.length)
            return;
        this.elementScheduled = true;
        task(() => {
            this.elementScheduled = false;
            const end = now() + TUNING.taskBudgetMs;
            while (this.elementQueue.length && now() < end) {
                const entry = this.elementQueue.pop();
                if (entry.state !== 'ready' || this.entries.get(entry.src) !== entry) {
                    delete entry.element;
                    continue;
                }
                const ready = () => {
                    if (this.entries.get(entry.src) !== entry)
                        return;
                    entry.element = 'ready';
                    this.notify(entry.src);
                };
                const image = entry.loaded.image;
                image.decode().then(ready, () => {
                    // A browser that won't load a worker's object URL in the page gets one made here.
                    if (entry.revokeUrl && entry.blob && this.entries.get(entry.src) === entry) {
                        entry.revokeUrl();
                        delete entry.revokeUrl;
                        entry.objectUrl = URL.createObjectURL(entry.blob);
                        image.src = entry.objectUrl;
                    }
                    // Otherwise a failed decode still renders (the browser decodes when painting).
                    image.decode().then(ready, ready);
                });
            }
            this.pumpElements();
        });
    }
    /**
     * Starts at most one bitmap per task: creating a bitmap from an image element resizes on the main
     * thread in some browsers, and several in one task make a long task. Like image elements, these
     * are for tiles on screen, so they run at user-visible priority: background tasks can wait as long
     * as the page stays busy, leaving tiles blank through a whole pinch.
     */
    pumpBitmaps() {
        if (this.bitmapScheduled || this.bitmapsActive >= TUNING.bitmapConcurrency || !this.bitmapQueue.length)
            return;
        this.bitmapScheduled = true;
        task(() => {
            this.bitmapScheduled = false;
            let entry = this.bitmapQueue.pop();
            while (entry && (entry.state !== 'ready' || this.entries.get(entry.src) !== entry)) {
                delete entry.bitmap;
                entry = this.bitmapQueue.pop();
            }
            if (!entry)
                return;
            this.bitmapsActive++;
            void this.createBitmap(entry).finally(() => {
                this.bitmapsActive--;
                this.pumpBitmaps();
            });
            this.pumpBitmaps();
        });
    }
    async createBitmap(entry) {
        const { width, height } = entry.loaded;
        const scale = Math.min(1, (entry.bitmapEdge ?? width) / Math.max(1, Math.min(width, height)));
        const size = { resizeWidth: Math.max(1, Math.round(width * scale)), resizeHeight: Math.max(1, Math.round(height * scale)) };
        try {
            // Blob entries resize from the blob, in the worker when there is one (reading a blob here
            // costs the main thread a task per chunk); their lazy image element is never made for this.
            // Browsers without resize options still give a GPU-ready bitmap at full size.
            const bitmap = entry.blob
                ? await (this.fetcher ?? mainThreadFetcher).bitmap(entry.blob, size.resizeWidth, size.resizeHeight)
                : await this.resizeElement(entry.loaded.image, size);
            if (this.entries.get(entry.src) !== entry || entry.state !== 'ready') {
                bitmap.close();
                return;
            }
            entry.bitmap = bitmap;
            entry.pixels += bitmap.width * bitmap.height;
            this.cachedPixels += bitmap.width * bitmap.height;
            this.notify(entry.src);
        }
        catch {
            entry.bitmap = 'failed';
            // Renderers that asked for a bitmap draw the decoded element instead.
            this.prepareElements([entry.src]);
        }
    }
    resizeElement(image, size) {
        return createImageBitmap(image, { ...size, resizeQuality: 'medium' }).catch(() => createImageBitmap(image));
    }
    record(duration, priority) {
        this.sortedDurations = null;
        this.durations.push(duration);
        if (this.durations.length > 400)
            this.durations.shift();
        if (priority === 'visible') {
            this.observedMs = this.observedMs === 0 ? duration : this.observedMs * 0.8 + duration * 0.2;
        }
    }
    evict() {
        if (this.cachedPixels <= TUNING.maxCachedPixels)
            return;
        const time = now();
        // Sorting the whole cache on every load while nothing can go yet would cost every load.
        if (time < this.evictBlockedUntil)
            return;
        const cutoff = time - TUNING.evictGraceMs;
        const candidates = [...this.entries.values()]
            .filter((entry) => entry.state === 'ready' && !this.demanded.has(entry.src))
            .sort((a, b) => a.lastDemanded - b.lastDemanded);
        for (const entry of candidates) {
            if (this.cachedPixels <= TUNING.maxCachedPixels * 0.85 || entry.lastDemanded > cutoff)
                break;
            this.cachedPixels -= entry.pixels;
            this.readyCount--;
            if (entry.revokeUrl)
                entry.revokeUrl();
            else if (entry.objectUrl)
                URL.revokeObjectURL(entry.objectUrl);
            if (isBitmap(entry.bitmap))
                entry.bitmap.close();
            this.entries.delete(entry.src);
        }
        if (this.cachedPixels > TUNING.maxCachedPixels * 0.85)
            this.evictBlockedUntil = time + TUNING.evictRetryMs;
    }
    /** Once per frame; the timer covers hosts that aren't painting (background tabs, embedded previews). */
    notify(src) {
        this.changed.push(src);
        if (this.notifyScheduled)
            return;
        this.notifyScheduled = true;
        let done = false;
        const flush = () => {
            if (done)
                return;
            done = true;
            this.notifyScheduled = false;
            this.version++;
            const changed = this.changed;
            this.changed = [];
            for (const listener of this.listeners)
                listener(changed);
        };
        if (typeof requestAnimationFrame === 'function')
            requestAnimationFrame(flush);
        setTimeout(flush, 50);
    }
}
/** A base64 data URL as a blob, without a fetch; undefined for other data URLs. */
function dataUrlBlob(src) {
    const comma = src.indexOf(',');
    const header = src.slice(5, comma);
    if (comma < 0 || !header.endsWith(';base64'))
        return undefined;
    try {
        const bytes = atob(src.slice(comma + 1));
        const array = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++)
            array[i] = bytes.charCodeAt(i);
        return new Blob([array], { type: header.slice(0, -7) });
    }
    catch {
        return undefined;
    }
}
/** A short task at user-visible priority: work for what's on screen, never deferred until the page is idle. */
function task(callback) {
    const scheduler = globalThis.scheduler;
    if (scheduler?.postTask)
        void scheduler.postTask(callback, { priority: 'user-visible' });
    else
        setTimeout(callback, 0);
}
function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
function percentile(sorted, p) {
    if (!sorted.length)
        return 0;
    return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]);
}
/** The browser's timing for a URL's latest load; needs `Timing-Allow-Origin` for other origins. */
function resourceTiming(src) {
    if (typeof performance === 'undefined' || !performance.getEntriesByName)
        return undefined;
    const entries = performance.getEntriesByName(new URL(src, globalThis.location?.href).href);
    return entries[entries.length - 1];
}
//# sourceMappingURL=image-loader.js.map