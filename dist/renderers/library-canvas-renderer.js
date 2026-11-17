import { fitPhotoInTile } from '../library-layout.js';
import { makeBounds } from '../geometry.js';
/** Approximate band height in CSS pixels; bands always hold whole rows. */
const BAND_HEIGHT = 480;
/** Released band canvases kept for reuse. */
const SPARE_BANDS = 8;
/**
 * Images drawn for the first time per frame, at most this long and this many pixels. A canvas
 * draws an image the first time by copying it for the GPU on the main thread, inside the frame: a
 * screenful of new thumbnails at a dense level is tens of millions of pixels, enough to stall one
 * frame for tens of milliseconds. Timing it lets a fast GPU fill a dense level in a few frames while
 * a slow one still spends about a millisecond a frame. Over budget, tiles keep what they show and
 * fill in on the next frames.
 */
const UPLOAD_MS_PER_FRAME = 1.5;
const UPLOAD_PIXELS_PER_FRAME = 8_000_000;
/**
 * Drawing time per frame for passes the renderer schedules itself (bands off screen, the first
 * draw after a level change, tiles over the upload budget); the rest continue on the next frame.
 */
const FOLLOW_UP_DRAW_MS = 1.5;
/** Drawn bands kept for levels not on screen, at most this many device pixels in all. */
const KEPT_BAND_PIXELS = 16_000_000;
/**
 * Bands already drawn for levels that aren't on screen, kept so coming back to a level shows it
 * as it was instead of drawing it again tile by tile. Share one between the renderers a component
 * makes (one per stretch of canvas levels), and `clear` it when the photos change.
 */
export class LibraryBandCache {
    layouts = new Map();
    /** Canvases shown elsewhere for now (a transition's outgoing copy). */
    lent = new Set();
    pixels = 0;
    /** @internal */
    keep(key, band) {
        let bands = this.layouts.get(band.layoutKey);
        if (!bands)
            this.layouts.set(band.layoutKey, (bands = new Map()));
        const old = bands.get(key);
        if (old && old !== band)
            this.drop(old);
        if (old !== band)
            this.pixels += band.canvas.width * band.canvas.height;
        // Most recently kept last, for bands and layouts alike, so eviction takes the oldest.
        bands.delete(key);
        bands.set(key, band);
        this.layouts.delete(band.layoutKey);
        this.layouts.set(band.layoutKey, bands);
        this.trim(band);
    }
    /** Over budget: the oldest bands not lent out go, oldest level first, all but `keep`. */
    trim(keep) {
        for (const held of this.layouts.values()) {
            for (const kept of held.values()) {
                if (this.pixels <= KEPT_BAND_PIXELS)
                    return;
                if (kept !== keep && !this.lent.has(kept.canvas))
                    this.drop(kept);
            }
        }
    }
    /** @internal A kept band for this layout and key, unless it's lent out. */
    take(layoutKey, key) {
        const band = this.layouts.get(layoutKey)?.get(key);
        if (!band || this.lent.has(band.canvas))
            return undefined;
        this.layouts.get(layoutKey).delete(key);
        this.pixels -= band.canvas.width * band.canvas.height;
        return band;
    }
    /** @internal */
    lend(key, band) {
        this.keep(key, band);
        this.lent.add(band.canvas);
    }
    /** Canvases lent to a copy are back: their bands can show their level again. */
    giveBack(canvases) {
        for (const canvas of canvases) {
            if (!this.lent.delete(canvas))
                continue;
            canvas.remove();
            canvas.style.display = 'none';
        }
        this.trim();
    }
    clear() {
        for (const bands of this.layouts.values())
            for (const band of bands.values())
                if (!this.lent.has(band.canvas))
                    this.drop(band);
        this.layouts.clear();
        this.lent.clear();
        this.pixels = 0;
    }
    drop(band) {
        this.pixels -= band.canvas.width * band.canvas.height;
        band.canvas.remove();
        // Frees the backing store now rather than at garbage collection.
        band.canvas.width = band.canvas.height = 0;
        for (const [layout, bands] of this.layouts) {
            for (const [key, kept] of bands)
                if (kept === band)
                    bands.delete(key);
            if (!bands.size)
                this.layouts.delete(layout);
        }
    }
}
export class LibraryCanvasRenderer {
    container;
    cache;
    bands = new Map();
    spare = [];
    lastInput = null;
    deferredFrame = 0;
    /** Images already drawn once, so drawing them again uploads nothing. */
    uploaded = new WeakSet();
    uploadBudget = UPLOAD_PIXELS_PER_FRAME;
    /** When this frame's first upload started (-1: none yet). */
    uploadStart = -1;
    refillFrame = 0;
    overBudget = false;
    lastVisible;
    /** Since a `deferDraw` render: the bands are covered, so every pass draws within a time budget until all on screen are drawn. */
    covered = false;
    constructor(container, cache = new LibraryBandCache()) {
        this.container = container;
        this.cache = cache;
    }
    /** Draw the bands covering `range`. Cheap to call often: unchanged bands are skipped. */
    render(input) {
        this.renderPass(input, false);
    }
    /** A pass the caller asked for re-checks tiles waiting for images; follow-ups the renderer schedules itself don't. */
    renderPass(input, followUp) {
        this.lastInput = input;
        const { geometry, range, dpr } = input;
        const { rowsPerBand, layoutKey } = layoutOf(input);
        const firstBand = Math.floor(range.firstRow / rowsPerBand);
        const lastBand = Math.floor(range.lastRow / rowsPerBand);
        for (const [key, band] of this.bands) {
            if (key < firstBand || key > lastBand || band.layoutKey !== layoutKey)
                this.release(key, band);
        }
        const visible = input.visible;
        if (visible)
            this.lastVisible = visible;
        // Rows on screen: drawn first, so the upload budget goes to what's seen.
        const onScreen = visible ?? this.lastVisible;
        const firstNow = onScreen ? clamp(Math.floor(onScreen.firstRow / rowsPerBand), firstBand, lastBand) : firstBand;
        const lastNow = onScreen ? clamp(Math.floor(onScreen.lastRow / rowsPerBand), firstNow, lastBand) : lastBand;
        let deferred = false;
        this.overBudget = false;
        if (input.deferDraw)
            this.covered = true;
        // A render from the app (`visible` set) draws bands coming on screen now, since they're being
        // scrolled into view; the rest, every follow-up pass, and anything covered draw within a time budget.
        const deadline = visible && !this.covered ? undefined : performance.now() + FOLLOW_UP_DRAW_MS;
        for (const key of [...span(firstNow, lastNow), ...span(firstBand, firstNow - 1), ...span(lastNow + 1, lastBand)]) {
            let band = this.bands.get(key);
            if (!band) {
                band = this.acquire(key, layoutKey, rowsPerBand, geometry, dpr);
                this.bands.set(key, band);
            }
            const onScreenBand = key >= firstNow && key <= lastNow;
            if (!followUp && this.recheckDue(band, input)) {
                band.stale = true;
                // A pass under way may already have passed tiles whose images just changed: it now has to
                // visit every tile again from where it is.
                if (band.remaining > 0) {
                    const { first, last } = this.bandSpan(band, geometry);
                    band.remaining = last - first + 1;
                }
            }
            const due = band.stale || this.decorationChanged(band, input);
            const skip = input.deferDraw ||
                (visible && (!onScreenBand || (band.drawn && !due))) ||
                (deadline !== undefined && performance.now() > deadline);
            if (skip) {
                if (due)
                    deferred = true;
                continue;
            }
            // Interrupted, or finished with tiles held back earlier in the pass: draw again next frame.
            if (!this.drawBand(band, input, deadline) || band.stale)
                deferred = true;
        }
        if (this.covered && !input.deferDraw) {
            let allDrawn = true;
            for (let key = firstNow; key <= lastNow; key++)
                if (!this.bands.get(key)?.drawn)
                    allDrawn = false;
            if (allDrawn)
                this.covered = false;
        }
        // Off-screen bands (overscan), and tiles over a budget, draw on the next frame, keeping zooms
        // and scrolls within budget.
        if (deferred || this.overBudget)
            this.scheduleDeferred();
    }
    /** The budget is per frame, however many times the renderer draws in it. */
    spendUploadBudget(pixels) {
        if (this.uploadStart < 0)
            this.uploadStart = performance.now();
        this.uploadBudget -= pixels;
        if (this.refillFrame || typeof requestAnimationFrame !== 'function')
            return;
        this.refillFrame = requestAnimationFrame(() => {
            this.refillFrame = 0;
            this.uploadBudget = UPLOAD_PIXELS_PER_FRAME;
            this.uploadStart = -1;
        });
    }
    /** Whether another image can be drawn for the first time this frame. */
    canUpload() {
        return this.uploadBudget > 0 && (this.uploadStart < 0 || performance.now() - this.uploadStart < UPLOAD_MS_PER_FRAME);
    }
    /**
     * What a tile shows now: 0 nothing, 1 its placeholder, 2 an image that isn't the wanted size
     * yet, 3 the wanted image. Tiles outside the drawn bands are 0.
     */
    tileState(index) {
        const geometry = this.lastInput?.geometry;
        if (!geometry)
            return 0;
        const rowsPerBand = Math.max(1, Math.round(BAND_HEIGHT / geometry.pitch));
        const row = Math.floor(index / geometry.columns);
        const band = this.bands.get(Math.floor(row / rowsPerBand));
        if (!band)
            return 0;
        return band.states[index - band.firstRow * geometry.columns] ?? 0;
    }
    scheduleDeferred() {
        if (!this.deferredFrame && typeof requestAnimationFrame === 'function') {
            this.deferredFrame = requestAnimationFrame(() => {
                this.deferredFrame = 0;
                const latest = this.lastInput;
                if (!latest)
                    return;
                const { visible: _visible, deferDraw: _deferDraw, ...everything } = latest;
                this.renderPass(everything, true);
            });
        }
    }
    /**
     * Paint the current bands into another canvas through a content-to-screen transform, for the
     * zoom transition's outgoing snapshot.
     */
    snapshot(context, contentToScreen) {
        if (!this.lastInput)
            return;
        const { geometry, dpr } = this.lastInput;
        context.setTransform(new DOMMatrix().scale(dpr).multiply(contentToScreen));
        for (const band of this.bands.values()) {
            const top = geometry.insetTop + band.firstRow * geometry.pitch;
            context.drawImage(band.canvas, 0, top, geometry.viewport.width, bandPixelHeight(band, geometry));
        }
        context.setTransform(1, 0, 0, 1, 0, 0);
    }
    /**
     * Hand the drawn band canvases over, e.g. to a pinch's copy of the outgoing grid, which shows them
     * where they are in content coordinates. The renderer forgets them and draws new ones.
     */
    detachBands() {
        const canvases = [];
        for (const [key, band] of this.bands) {
            if (band.drawn)
                this.cache.lend(key, band);
            canvases.push(band.canvas);
        }
        this.bands.clear();
        return canvases;
    }
    /** Forget what the bands show (the photos changed): every band draws again from nothing. */
    reset() {
        if (this.deferredFrame)
            cancelAnimationFrame(this.deferredFrame);
        this.deferredFrame = 0;
        this.lastInput = null;
        for (const [key, band] of this.bands) {
            band.drawn = false;
            this.release(key, band);
        }
    }
    destroy() {
        if (this.deferredFrame)
            cancelAnimationFrame(this.deferredFrame);
        if (this.refillFrame)
            cancelAnimationFrame(this.refillFrame);
        this.deferredFrame = 0;
        this.refillFrame = 0;
        for (const [key, band] of this.bands)
            this.release(key, band);
        for (const band of this.spare)
            band.canvas.remove();
        this.spare.length = 0;
        this.lastInput = null;
    }
    acquire(key, layoutKey, rowsPerBand, geometry, dpr) {
        // Drawn before, for this level: shown as it was. Image upgrades since are re-checked by version.
        const kept = this.cache.take(layoutKey, key);
        if (kept) {
            if (kept.canvas.parentNode !== this.container)
                this.container.append(kept.canvas);
            kept.canvas.style.display = '';
            return kept;
        }
        let band = this.spare.pop();
        if (!band) {
            const canvas = document.createElement('canvas');
            canvas.setAttribute('aria-hidden', 'true');
            const context = canvas.getContext('2d', { alpha: true });
            if (!context)
                throw new Error('Gally library needs a 2D canvas context.');
            band = {
                canvas,
                context,
                layoutKey,
                firstRow: 0,
                rowCount: 0,
                states: new Uint8Array(0),
                stale: true,
                drawn: false,
                unfinished: true,
                checkedVersion: undefined,
                cursor: 0,
                remaining: 0,
                passSkipped: false,
                selectedIndex: null,
                hiddenIndex: null,
            };
            this.container.append(canvas);
        }
        const firstRow = key * rowsPerBand;
        const rowCount = Math.max(0, Math.min(rowsPerBand, geometry.rows - firstRow));
        band.layoutKey = layoutKey;
        band.firstRow = firstRow;
        band.rowCount = rowCount;
        band.states = new Uint8Array(rowCount * geometry.columns);
        band.stale = true;
        band.drawn = false;
        band.unfinished = true;
        band.checkedVersion = undefined;
        band.cursor = 0;
        band.remaining = 0;
        band.passSkipped = false;
        band.selectedIndex = null;
        band.hiddenIndex = null;
        const width = geometry.viewport.width;
        const height = bandPixelHeight(band, geometry);
        const pixelWidth = Math.max(1, Math.round(width * dpr));
        const pixelHeight = Math.max(1, Math.round(height * dpr));
        if (band.canvas.width !== pixelWidth || band.canvas.height !== pixelHeight) {
            band.canvas.width = pixelWidth;
            band.canvas.height = pixelHeight;
        }
        else {
            band.context.setTransform(1, 0, 0, 1, 0, 0);
            band.context.clearRect(0, 0, pixelWidth, pixelHeight);
        }
        const style = band.canvas.style;
        style.top = `${geometry.insetTop + firstRow * geometry.pitch}px`;
        style.width = `${width}px`;
        style.height = `${height}px`;
        style.display = '';
        return band;
    }
    release(key, band) {
        this.bands.delete(key);
        band.canvas.style.display = 'none';
        if (band.drawn) {
            this.cache.keep(key, band);
            return;
        }
        if (this.spare.length < SPARE_BANDS)
            this.spare.push(band);
        else
            band.canvas.remove();
    }
    /**
     * Redraw only these tiles, e.g. the ones whose images just became ready: the cost follows what
     * changed, not how many tiles are on screen. Tiles outside the drawn bands are left to `render`.
     */
    renderTiles(input, indices) {
        this.lastInput = input;
        const { geometry } = input;
        const { rowsPerBand, layoutKey } = layoutOf(input);
        this.overBudget = false;
        for (const index of indices) {
            const band = this.bands.get(Math.floor(Math.floor(index / geometry.columns) / rowsPerBand));
            if (!band || band.layoutKey !== layoutKey || index - band.firstRow * geometry.columns >= band.states.length)
                continue;
            // Selection or visibility changes repaint whole tiles; the next full pass handles those.
            if (this.decorationChanged(band, input)) {
                band.stale = true;
                this.overBudget = true;
                continue;
            }
            band.context.setTransform(input.dpr, 0, 0, input.dpr, 0, 0);
            // Held back by the upload budget: a pass under way may already be past this tile, so the
            // band needs another full pass once this one ends.
            if (!this.drawTile(band, index, input)) {
                band.stale = true;
                band.passSkipped = true;
            }
        }
        // The caller passed every image that changed up to this version.
        for (const band of this.bands.values())
            if (band.layoutKey === layoutKey)
                band.checkedVersion = input.version;
        if (this.overBudget)
            this.scheduleDeferred();
    }
    /** Tiles still waiting for images, and images may have changed since they were checked. */
    recheckDue(band, input) {
        return band.unfinished && (input.version === undefined || input.version !== band.checkedVersion);
    }
    bandSpan(band, geometry) {
        const first = band.firstRow * geometry.columns;
        return { first, last: Math.min(geometry.count - 1, (band.firstRow + band.rowCount) * geometry.columns - 1) };
    }
    decorationFor(band, input) {
        const { first, last } = this.bandSpan(band, input.geometry);
        const inBand = (index) => (index != null && index >= first && index <= last ? index : null);
        return { selected: inBand(input.selectedIndex), hidden: inBand(input.hiddenIndex) };
    }
    decorationChanged(band, input) {
        const { selected, hidden } = this.decorationFor(band, input);
        return band.selectedIndex !== selected || band.hiddenIndex !== hidden;
    }
    setState(band, slot, state) {
        band.states[slot] = state;
    }
    /** Draw the band's tiles that can show something better; false if the deadline cut it short. */
    drawBand(band, input, deadline) {
        const { geometry } = input;
        const { first, last } = this.bandSpan(band, geometry);
        const { selected, hidden } = this.decorationFor(band, input);
        const decorationChanged = band.selectedIndex !== selected || band.hiddenIndex !== hidden;
        if (!band.stale && !decorationChanged)
            return true;
        // Tiles whose selection or hidden state changed must be repainted from scratch.
        for (const index of [band.selectedIndex, band.hiddenIndex, selected, hidden]) {
            if (index != null && index >= first && index <= last)
                this.setState(band, index - first, 0);
        }
        band.selectedIndex = selected;
        band.hiddenIndex = hidden;
        const ctx = band.context;
        ctx.setTransform(input.dpr, 0, 0, input.dpr, 0, 0);
        const { cell: size, columns, pitch } = geometry;
        // Blank tiles on a fresh band: placeholders go into one path per colour and images draw on
        // top afterwards, instead of hundreds of separate fills.
        const fills = new Map();
        const images = [];
        const flush = () => {
            for (const [color, path] of fills) {
                ctx.fillStyle = color;
                ctx.fill(path);
            }
            for (const { x, y, image } of images)
                drawTileImage(ctx, image, makeBounds(x, y, size, size), input.fit);
        };
        // A pass interrupted by a budget continues where it stopped, so passes complete across
        // frames; a decoration change starts a new one, since it needs every tile.
        const count = last - first + 1;
        if (decorationChanged || band.remaining === 0) {
            band.cursor = 0;
            band.remaining = count;
            band.passSkipped = false;
        }
        const start = band.cursor;
        const todo = band.remaining;
        for (let step = 0; step < todo; step++) {
            const slot = (start + step) % count;
            const index = first + slot;
            const outOfTime = deadline !== undefined && step % 32 === 31 && performance.now() > deadline;
            // A band already showing placeholders gains nothing once no more images can upload this frame.
            const outOfUploads = band.drawn && !decorationChanged && !this.canUpload();
            if (outOfTime || outOfUploads) {
                flush();
                band.cursor = slot;
                band.remaining = todo - step;
                band.stale = true;
                if (outOfUploads)
                    this.overBudget = true;
                return !outOfTime;
            }
            // Final tiles stay as drawn (decoration changes reset their state above).
            if (band.states[slot] === 3)
                continue;
            if (band.states[slot] !== 0 || decorationChanged || index === selected || index === hidden) {
                if (!this.drawTile(band, index, input, decorationChanged))
                    band.passSkipped = true;
                continue;
            }
            const { image, heldBack } = this.pickImage(index, input);
            if (heldBack)
                band.passSkipped = true;
            const x = (index % columns) * pitch;
            const y = (Math.floor(index / columns) - band.firstRow) * pitch;
            if (!image || input.fit === 'square') {
                const color = input.placeholderFor(index);
                let path = fills.get(color);
                if (!path)
                    fills.set(color, (path = new Path2D()));
                path.rect(x, y, size, size);
            }
            if (image)
                images.push({ x, y, image });
            this.setState(band, slot, image ? (image.sharp ? 3 : 2) : 1);
        }
        flush();
        band.stale = band.passSkipped;
        band.drawn = true;
        band.unfinished = band.states.some((state) => state < 3);
        band.checkedVersion = input.version;
        band.cursor = 0;
        band.remaining = 0;
        return true;
    }
    /** The image a tile can draw now, within this frame's upload budget. */
    pickImage(index, input) {
        const image = input.imageFor(index);
        if (!image || this.uploaded.has(image.image))
            return { image, heldBack: false };
        if (!this.canUpload()) {
            // Over budget: keep what the tile shows (or its placeholder) until a later frame.
            this.overBudget = true;
            return { image: undefined, heldBack: true };
        }
        this.spendUploadBudget(image.width * image.height);
        this.uploaded.add(image.image);
        return { image, heldBack: false };
    }
    /** Draw one tile if it can now show something better than it does; false if the upload budget held it back. */
    drawTile(band, index, input, decorationChanged = false) {
        const { geometry, ring } = input;
        const ctx = band.context;
        const slot = index - band.firstRow * geometry.columns;
        const shown = band.states[slot];
        const size = geometry.cell;
        const x = (index % geometry.columns) * geometry.pitch;
        const y = Math.floor(index / geometry.columns - band.firstRow) * geometry.pitch;
        if (index === band.hiddenIndex) {
            if (shown !== 0 || decorationChanged)
                ctx.clearRect(x, y, size, size);
            this.setState(band, slot, 0);
            return true;
        }
        const { image, heldBack } = this.pickImage(index, input);
        const state = image ? (image.sharp ? 3 : 2) : 1;
        if (state <= shown)
            return !heldBack;
        // A fresh band is already clear.
        if (shown !== 0 || decorationChanged)
            ctx.clearRect(x, y, size, size);
        if (!image || input.fit === 'square') {
            ctx.fillStyle = input.placeholderFor(index);
            ctx.fillRect(x, y, size, size);
        }
        if (image)
            drawTileImage(ctx, image, makeBounds(x, y, size, size), input.fit);
        if (index === band.selectedIndex) {
            const inset = ring.width / 2;
            ctx.strokeStyle = ring.color;
            ctx.lineWidth = ring.width;
            ctx.strokeRect(x + inset, y + inset, size - ring.width, size - ring.width);
        }
        this.setState(band, slot, state);
        return !heldBack;
    }
}
function layoutOf(input) {
    const { geometry, dpr, fit } = input;
    const rowsPerBand = Math.max(1, Math.round(BAND_HEIGHT / geometry.pitch));
    return {
        rowsPerBand,
        layoutKey: `${geometry.columns}:${geometry.cell}:${geometry.viewport.width}:${fit}:${dpr}:${rowsPerBand}:${geometry.count}:${geometry.insetTop}`,
    };
}
function span(from, to) {
    const keys = [];
    for (let key = from; key <= to; key++)
        keys.push(key);
    return keys;
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function bandPixelHeight(band, geometry) {
    return Math.max(1, band.rowCount * geometry.pitch - geometry.gap);
}
function drawTileImage(ctx, { image, width, height }, tile, fit) {
    if (width <= 0 || height <= 0)
        return;
    if (fit === 'square') {
        const crop = Math.min(width, height);
        ctx.drawImage(image, (width - crop) / 2, (height - crop) / 2, crop, crop, tile.x, tile.y, tile.width, tile.height);
        return;
    }
    const rect = fitPhotoInTile(tile, width, height, fit);
    ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
}
//# sourceMappingURL=library-canvas-renderer.js.map