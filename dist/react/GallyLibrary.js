'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { forwardRef, memo, startTransition, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, } from 'react';
import { flushSync } from 'react-dom';
import { GallyImageLoader } from '../image-loader.js';
import { defaultLibraryLayoutOptions, defaultLibraryLevels, fitPhotoInTile, getLibraryCellSize, getLibraryColumns, getLibraryGeometry, getLibraryIndexAt, getLibraryTileRect, getLibraryWindows, getLibraryWindowsForSpan, libraryLevelCount, planLibraryZoom, scrollTopForIndex, stepLibraryLevel, } from '../library-layout.js';
import { CLOSEST_ROOM, DENSEST_ROOM, DISSOLVE_END, DISSOLVE_LAG_S, DISSOLVE_RATE, DISSOLVE_START, cameraTransform, composeCamera, dissolveAt, fitSpeed, gestureCamera, invertCamera, limitOvershoot, planSettle, progressForDissolve, resist, settleCamera, settleDuration, springValue, } from '../library-pinch.js';
import { cappedDevicePixelRatio, chooseSourceKeyForPixels, defaultLodConfig, lodForNetwork } from '../lod.js';
import { bestReadySource, normalizePhotoSources } from '../photo-sources.js';
import { LibraryBandCache, LibraryCanvasRenderer } from '../renderers/library-canvas-renderer.js';
const TUNING = {
    spring: 'cubic-bezier(0.2, 0.9, 0.25, 1)',
    transitionMs: 480,
    reducedMotionFadeMs: 160,
    overscanRows: 3,
    /** Extra rows rendered while a zoom-in starts smaller than the viewport, at most. */
    transitionRows: 8,
    /** Motion must pause this long before sharper sizes load. */
    settleMs: 250,
    /** Scrolling faster than this many screens per second counts as a flick. */
    flickScreensPerSecond: 2.5,
    /** A trackpad pinch ends when its wheel events stop for this long. */
    wheelPinchEndMs: 140,
    wheelPinchSensitivity: 0.012,
    /** While pinching, rows rendered beyond the screen, as a share of it on each side, for the grid to shrink into. */
    pinchCoverage: 0.75,
    /** Release speeds carried into the spring, at most: zoom (log scale per second) and pan (px/s). */
    pinchMaxZoomSpeed: 8,
    pinchMaxPanSpeed: 3000,
    /** A release lands on the nearer level as judged this far ahead (seconds of its speed). */
    pinchProjectionS: 0.12,
    /** The spring overshoots a level's size by at most this share. */
    pinchMaxOvershoot: 0.04,
    /** An outgoing copy that's all but dissolved fades out this fast. */
    pinchCopyFadeMs: 80,
    /** Released back to a level: the copy stays over it at most this long while it shows its images. */
    pinchRevealWaitMs: 300,
    /** A double-click within this of a tap-to-zoom belongs to that tap, not to opening the photo. */
    doubleClickAfterZoomMs: 600,
};
function GallyLibraryInner(props, ref) {
    'use no memo';
    const { photos, className, fit = 'square', renderer = 'hybrid', denseCellSize = 110, layout, defaultLevel = 1, standardLevel = 1, tapToZoom = true, onLevelChange, initialScroll = 'start', onSelectedIndexChange, hiddenIndex = null, onOpenPhoto, onVisibleRangeChange, lod, } = props;
    const uid = useId();
    const rootRef = useRef(null);
    const scrollerRef = useRef(null);
    const pinchRef = useRef(null);
    const contentRef = useRef(null);
    const bandsRef = useRef(null);
    const canvasRendererRef = useRef(null);
    const ownLoader = useRef(null);
    const loader = props.loader ?? (ownLoader.current ??= new GallyImageLoader());
    const [size, setSize] = useState({ width: 0, height: 0 });
    // Without `layout.levels` or `layout.columns`, the levels suit the screen: Apple Photos' column
    // counts on a phone, even steps of tile size wider.
    const ownLevels = Boolean(layout?.levels || layout?.columns);
    const phone = size.width > 0 && size.width < 600;
    const options = useMemo(() => ({ ...defaultLibraryLayoutOptions, ...layout, ...(ownLevels ? {} : defaultLibraryLevels(phone ? 1 : 1000)) }), [layout, ownLevels, phone]);
    const [level, setLevelState] = useState(defaultLevel);
    const [scrollTop, setScrollTop] = useState(0);
    const [ownSelected, setOwnSelected] = useState(null);
    /** Rows added to the overscan while a zoom-in transition starts smaller than the viewport. */
    const [transitionRows, setTransitionRows] = useState(0);
    /** False while pinching or flick-scrolling: only thumbnails load until motion settles. */
    const [settled, setSettled] = useState(true);
    const channel = useMemo(() => loader.channel(), [loader]);
    useEffect(() => () => channel.release(), [channel]);
    const settleTimer = useRef(0);
    const lastScroll = useRef({ top: 0, at: 0 });
    /**
     * Scroll position to apply to the scroller before the next paint (initial placement, level
     * changes), once `level` (when given) is the one rendered.
     */
    const pendingScroll = useRef(null);
    const onPinchRef = useRef(props.onPinch);
    onPinchRef.current = props.onPinch;
    /** Outgoing grids of animated level changes, zooming and fading over the new one. */
    const ghosts = useRef([]);
    const zoomedAt = useRef(-Infinity);
    /** True while a level change commits: the outgoing snapshot covers the canvas, so it draws next frame. */
    const zoomCommit = useRef(false);
    /** The pinch controller (in the effect below), told when React renders a level it asked for. */
    const pinchControl = useRef(null);
    /** A pinch's copy of the outgoing grid covers the new one while it renders: canvas bands draw next frame. */
    const pinchCover = useRef(false);
    /** A pinch is under way or settling: sharper images wait until it's done. */
    const pinchActive = useRef(false);
    /** While pinching: the rows to render, in content coordinates, for what the scaled grid shows. */
    const [pinchSpan, setPinchSpan] = useState(null);
    const gridRef = useRef(null);
    const selected = props.selectedIndex !== undefined ? props.selectedIndex : ownSelected;
    const count = photos.length;
    const columns = size.width ? getLibraryColumns(size.width, level, options) : 1;
    const geometry = getLibraryGeometry(size, count, columns, options);
    const windows = pinchSpan && pinchSpan.level === level
        ? getLibraryWindowsForSpan(geometry, pinchSpan)
        : getLibraryWindows(geometry, scrollTop, TUNING.overscanRows + transitionRows);
    /** Dense levels draw on canvas in hybrid mode. */
    const modeFor = (cell) => (renderer === 'hybrid' && cell < denseCellSize ? 'canvas' : 'dom');
    const mode = modeFor(geometry.cell);
    /** Changes as images become ready. Canvas levels redraw from the loader directly instead (see below). */
    const imagesVersion = useSyncExternalStore(mode === 'dom' ? loader.subscribe : noSubscribe, loader.getVersion, loader.getVersion);
    const sources = useMemo(() => photos.map((photo) => normalizePhotoSources(photo)), [photos]);
    /** The photos each image URL belongs to (previews can be shared), to redraw only what changed. */
    const indicesBySrc = useMemo(() => {
        const map = new Map();
        const add = (src, index) => {
            if (!src)
                return;
            const list = map.get(src);
            if (list)
                list.push(index);
            else
                map.set(src, [index]);
        };
        sources.forEach((photoSources, index) => {
            for (const src of new Set(Object.values(photoSources)))
                add(src, index);
            add(photos[index]?.placeholder, index);
        });
        return map;
    }, [sources, photos]);
    const lodConfig = useMemo(() => ({ ...defaultLodConfig, ...lod }), [lod]);
    const dpr = cappedDevicePixelRatio(lodConfig);
    const targetKey = chooseSourceKeyForPixels(geometry.cell * dpr, lodForNetwork(lodConfig, loader.getNetworkQuality()));
    /** What a photo can show right now: the best loaded size, else its inline preview. */
    const best = (index, target = targetKey) => {
        const found = bestReadySource(sources[index], target, (src) => loader.get(src) !== undefined, photos[index]?.placeholder);
        return found && { loaded: loader.get(found.src), sharp: found.sharp };
    };
    /** What a DOM tile shows: the best image whose element has decoded, so painting it never decodes in the frame. */
    const shown = (index) => {
        const found = bestReadySource(sources[index], targetKey, (src) => loader.isRenderable(src), photos[index]?.placeholder);
        return found && { loaded: loader.get(found.src), sharp: found.sharp };
    };
    const unsettle = () => {
        setSettled(false);
        clearTimeout(settleTimer.current);
        settleTimer.current = window.setTimeout(() => {
            if (!pinchActive.current)
                setSettled(true);
        }, TUNING.settleMs);
    };
    useEffect(() => () => clearTimeout(settleTimer.current), []);
    const live = useRef({ geometry, level, selected, mode, windows, targetKey, size, count });
    live.current = { geometry, level, selected, mode, windows, targetKey, size, count };
    /** The last level `onLevelChange` reported. */
    const reportedLevel = useRef(level);
    const reportLevel = (next) => {
        if (next === reportedLevel.current)
            return;
        reportedLevel.current = next;
        onLevelChange?.(next);
    };
    const setLevel = (next) => {
        setLevelState(next);
        reportLevel(next);
    };
    const setSelected = (index) => {
        setOwnSelected(index);
        onSelectedIndexChange?.(index);
    };
    // Measure, and on the first measurement place the scroll position in the same render, so the
    // first window (and its image requests) is already the one the reader starts at.
    useLayoutEffect(() => {
        const root = rootRef.current;
        let placed = false;
        const measure = () => {
            const next = { width: scrollerRef.current.clientWidth, height: root.clientHeight };
            setSize(next);
            // Scrolling renders only when rows change, so the last rendered position may be a little behind.
            if (placed)
                setScrollTop(scrollerRef.current.scrollTop);
            if (placed || !next.width)
                return;
            placed = true;
            // The levels for this width (the first render didn't know it yet).
            const measured = { ...defaultLibraryLayoutOptions, ...layout, ...(layout?.levels || layout?.columns ? {} : defaultLibraryLevels(next.width)) };
            const g = getLibraryGeometry(next, count, getLibraryColumns(next.width, level, measured), measured);
            const top = initialScroll === 'end'
                ? g.maxScroll
                : initialScroll === 'start'
                    ? 0
                    : scrollTopForIndex(initialScroll.index, g, 'start');
            pendingScroll.current = { top };
            setScrollTop(top);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(root);
        return () => observer.disconnect();
    }, []);
    // Apply a planned scroll position (initial placement, level change) before paint.
    useLayoutEffect(() => {
        const pending = pendingScroll.current;
        if (pending == null || (pending.level !== undefined && pending.level !== level))
            return;
        scrollerRef.current.scrollTop = pending.top;
        pendingScroll.current = null;
    });
    // Dense levels already drawn, kept for coming back to them (see `LibraryBandCache`).
    const bandCacheRef = useRef(null);
    const bandCache = (bandCacheRef.current ??= new LibraryBandCache());
    useEffect(() => () => bandCache.clear(), [bandCache]);
    /** Remove a transition's copy of a grid, giving back any canvas bands it borrowed. */
    const removeCopy = (element) => {
        bandCache.giveBack(Array.from(element.querySelectorAll('canvas')));
        element.remove();
    };
    // Canvas renderer lifecycle and drawing for dense levels.
    useLayoutEffect(() => {
        if (mode !== 'canvas')
            return;
        const instance = new LibraryCanvasRenderer(bandsRef.current, bandCache);
        canvasRendererRef.current = instance;
        return () => {
            instance.destroy();
            canvasRendererRef.current = null;
        };
    }, [mode]);
    // Canvas tiles take their look from the same CSS custom properties as DOM tiles.
    const look = useRef({ placeholder: '', ring: { color: '', width: 0 } });
    useLayoutEffect(() => {
        const styles = getComputedStyle(rootRef.current);
        look.current = {
            placeholder: styles.getPropertyValue('--gally-library-placeholder').trim(),
            ring: {
                color: styles.getPropertyValue('--gally-library-accent').trim(),
                width: parseFloat(styles.getPropertyValue('--gally-library-ring-width')) || 0,
            },
        };
    }, [className, mode]);
    /**
     * Draw the canvas bands, or with `changed` image sources only the tiles showing them. Images found
     * without a bitmap yet get one made; its arrival redraws the tile.
     */
    const drawCanvas = (changed) => {
        const instance = canvasRendererRef.current;
        if (mode !== 'canvas' || !instance || !size.width)
            return;
        const bitmapEdge = Math.ceil(denseCellSize * dpr);
        const input = {
            geometry,
            range: windows.preload,
            visible: windows.visible,
            fit,
            dpr,
            selectedIndex: selected,
            hiddenIndex,
            ring: look.current.ring,
            deferDraw: zoomCommit.current || pinchCover.current,
            version: loader.getVersion(),
            placeholderFor: (index) => photos[index]?.dominantColor ?? look.current.placeholder,
            // Small GPU-ready bitmaps only: drawing full-size photos would stall the frame on upload.
            imageFor: (index) => {
                const found = best(index);
                const bitmap = found && loader.getBitmap(found.loaded.src);
                if (bitmap)
                    return { image: bitmap, width: bitmap.width, height: bitmap.height, sharp: found.sharp };
                if (!found)
                    return undefined;
                // Asked for here, not after drawing: the renderer's follow-up passes call this later too.
                loader.prepareBitmaps([found.loaded.src], bitmapEdge);
                // A larger image is being scaled down for the canvas: meanwhile the thumbnail's bitmap
                // (kept when it was decoded), if it has one, rather than an empty tile.
                const thumb = sources[index]?.thumb;
                const fallback = thumb ? loader.getBitmap(thumb) : undefined;
                return fallback && { image: fallback, width: fallback.width, height: fallback.height, sharp: false };
            },
        };
        if (changed) {
            // Every tile showing a changed image: bands reach past the preload rows, and the renderer
            // skips tiles outside the bands it has.
            const indices = [];
            for (const src of changed)
                indices.push(...(indicesBySrc.get(src) ?? []));
            instance.renderTiles(input, indices);
        }
        else {
            instance.render(input);
        }
    };
    // New photos: nothing drawn for the old ones may show, mounted or kept.
    const drawnSources = useRef(sources);
    useLayoutEffect(() => {
        if (drawnSources.current === sources)
            return;
        drawnSources.current = sources;
        canvasRendererRef.current?.reset();
        bandCache.clear();
    }, [sources, bandCache]);
    useLayoutEffect(() => drawCanvas());
    // A level a pinch asked for is on the page (after its scroll position and first draw above).
    useLayoutEffect(() => pinchControl.current?.committed(level));
    // What to load. While pinching or flick-scrolling: only thumbnails for on-screen photos that have
    // nothing yet, since anything sharper would be outdated before it arrived, while thumbnails
    // already asked for around the screen carry on. Once settled: on-screen photos at the wanted size
    // (with a quick thumbnail first if they have nothing), thumbnails for what a pinch out to the next
    // level would show, the rest of the rendered rows, then thumbnails for the level after that.
    // Inline previews for every rendered tile. Within a priority the last listed loads first, so each
    // list runs back to front.
    const { visible, preload } = windows;
    // The level a pinch out shows next, and whether it draws on canvas.
    const nextOut = size.width ? stepLibraryLevel(level, 1, size.width, options) : level;
    const nextOutIsCanvas = nextOut !== level && modeFor(getLibraryCellSize(size.width, getLibraryColumns(size.width, nextOut, options), options)) === 'canvas';
    useEffect(() => {
        if (!size.width || !count) {
            channel.demand([]);
            return;
        }
        const demand = [];
        const ask = (index, key, priority) => demand.push({ src: sources[index][key], priority });
        // A denser level shows the square of the column ratio more photos: the range a pinch out one
        // and two levels would show, around the screen (at least two screens).
        const onScreen = visible.end - visible.start + 1;
        const outOne = stepLibraryLevel(level, 1, size.width, options);
        const outTwo = stepLibraryLevel(outOne, 1, size.width, options);
        const reach = (out) => {
            const ratio = getLibraryColumns(size.width, out, options) / columns;
            const extra = Math.max(onScreen * 2, Math.ceil((onScreen * (ratio * ratio - 1)) / 2));
            return { start: Math.max(0, visible.start - extra), end: Math.min(count - 1, visible.end + extra) };
        };
        const near = reach(outOne);
        const far = reach(outTwo);
        // On a fast connection, last of all, what a pinch straight to the densest level would show:
        // thumbnails are a few kilobytes, and that level shows hundreds at once.
        const densest = loader.getNetworkQuality() === 'fast' ? reach(libraryLevelCount(options) - 1) : far;
        const outside = (index) => index < preload.start || index > preload.end;
        for (let index = densest.end; index >= densest.start; index--) {
            if (outside(index) && (index < far.start || index > far.end))
                ask(index, 'thumb', 'prefetch');
        }
        for (let index = preload.start; index <= preload.end; index++) {
            const placeholder = photos[index]?.placeholder;
            if (placeholder)
                demand.push({ src: placeholder, priority: 'visible' });
        }
        // Inline previews (no network) for all of it, so a pinch out never shows an empty tile.
        for (let index = far.end; index >= far.start; index--) {
            const placeholder = photos[index]?.placeholder;
            if (placeholder && outside(index))
                demand.push({ src: placeholder, priority: 'near' });
        }
        for (let index = far.end; index >= far.start; index--) {
            if (outside(index) && (index < near.start || index > near.end))
                ask(index, 'thumb', 'prefetch');
        }
        if (!settled) {
            for (let index = near.end; index >= near.start; index--)
                if (outside(index))
                    ask(index, 'thumb', 'prefetch');
            for (let index = visible.end; index >= visible.start; index--) {
                // Sharp loads already under way for on-screen photos stay demanded, so they aren't cancelled.
                ask(index, targetKey, 'visible');
                if (!best(index))
                    ask(index, 'thumb', 'visible');
            }
            channel.demand(demand);
            return;
        }
        for (let index = preload.end; index >= preload.start; index--) {
            if (outside(index) || index < visible.start || index > visible.end)
                ask(index, targetKey, 'near');
        }
        // A canvas level draws thumbnails' bitmaps without scaling anything down first: those photos
        // on screen now that show a larger size get theirs too.
        for (let index = near.end; index >= near.start; index--)
            if (outside(index) || nextOutIsCanvas)
                ask(index, 'thumb', 'near');
        for (let index = visible.end; index >= visible.start; index--) {
            ask(index, targetKey, 'visible');
            if (targetKey !== 'thumb' && !best(index))
                ask(index, 'thumb', 'visible');
        }
        channel.demand(demand);
    }, [visible.start, visible.end, preload.start, preload.end, targetKey, sources, channel, size.width, settled, level, columns, options, nextOutIsCanvas]);
    // Canvas tiles draw from small GPU-ready bitmaps, made ahead so a pinch out switches renderers
    // without stalling.
    // Bitmaps for what a pinch out to that canvas level would show: the screen holds the square of
    // the column ratio more photos there. Drawing asks for any still missing.
    const prepareCanvasBitmaps = () => {
        if (!nextOutIsCanvas || !size.width || !settled)
            return;
        const onScreen = visible.end - visible.start + 1;
        const outColumns = getLibraryColumns(size.width, nextOut, options);
        const extra = Math.ceil((onScreen * ((outColumns / columns) ** 2 - 1)) / 2);
        const srcs = [];
        for (let index = Math.max(0, visible.start - extra); index <= Math.min(count - 1, visible.end + extra); index++) {
            const found = best(index, 'thumb');
            if (found)
                srcs.push(found.loaded.src);
        }
        loader.prepareBitmaps(srcs, Math.ceil(denseCellSize * dpr));
    };
    useEffect(prepareCanvasBitmaps, [mode, nextOutIsCanvas, visible.start, visible.end, imagesVersion, settled]);
    // On canvas levels images arrive without rendering: catch up a moment after they stop.
    const bitmapTimer = useRef(0);
    useEffect(() => () => clearTimeout(bitmapTimer.current), []);
    // On canvas levels nothing React renders depends on which images are ready, so new images redraw
    // the canvas directly, without rendering the component: at dense levels hundreds of images can
    // arrive per second.
    const onImages = useRef((_changed) => { });
    onImages.current = (changed) => {
        drawCanvas(changed);
        clearTimeout(bitmapTimer.current);
        bitmapTimer.current = window.setTimeout(() => actions.current.prepareCanvasBitmaps(), 150);
    };
    useEffect(() => {
        if (mode !== 'canvas')
            return;
        const unsubscribe = loader.subscribe((changed) => onImages.current(changed));
        // Images that became ready between the first draw and subscribing: a full draw re-checks them.
        onImages.current();
        return unsubscribe;
    }, [mode, loader]);
    // DOM tiles show images once their elements have decoded: ask for them, a few per task. Once
    // settled, also for what a pinch to a neighbouring DOM level would show first, so its tiles
    // don't appear empty while they decode.
    useEffect(() => {
        if (!size.width)
            return;
        // The loader makes the last listed first: neighbouring levels, rendered rows off screen, then
        // on-screen tiles from the top.
        const srcs = [];
        const add = (index) => {
            const found = best(index);
            if (found)
                srcs.push(found.loaded.src);
        };
        if (settled) {
            const onScreen = visible.end - visible.start + 1;
            for (const direction of [-1, 1]) {
                const next = stepLibraryLevel(level, direction, size.width, options);
                if (next === level)
                    continue;
                const nextColumns = getLibraryColumns(size.width, next, options);
                if (modeFor(getLibraryCellSize(size.width, nextColumns, options)) !== 'dom')
                    continue;
                const shown = Math.ceil(onScreen * (nextColumns / columns) ** 2);
                const middle = Math.round((visible.start + visible.end) / 2);
                const from = Math.max(0, middle - Math.ceil(shown / 2));
                for (let index = Math.min(count - 1, from + shown); index >= from; index--)
                    add(index);
            }
        }
        if (mode === 'dom') {
            for (let index = preload.end; index >= preload.start; index--)
                if (index < visible.start || index > visible.end)
                    add(index);
            for (let index = visible.end; index >= visible.start; index--)
                add(index);
        }
        if (srcs.length)
            loader.prepareElements(srcs);
    }, [mode, visible.start, visible.end, preload.start, preload.end, imagesVersion, sources, targetKey, loader, settled, level, columns, options]);
    useEffect(() => {
        if (size.width && count)
            onVisibleRangeChange?.({ start: visible.start, end: visible.end });
    }, [visible.start, visible.end, size.width, count]);
    /** Content coordinates to the component's screen coordinates, including any pinch or zoom in flight. */
    const contentToScreen = () => {
        const matrix = new DOMMatrix().translate(0, -scrollerRef.current.scrollTop);
        return matrix.multiply(layerMatrix(pinchRef.current)).multiply(layerMatrix(contentRef.current));
    };
    /** A content rectangle on screen through `matrix` (a scale and translation). */
    const project = (rect, matrix) => {
        const a = matrix.transformPoint(new DOMPoint(rect.x, rect.y));
        const b = matrix.transformPoint(new DOMPoint(rect.x + rect.width, rect.y + rect.height));
        return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
    };
    const removeGhost = (ghost) => {
        const list = ghosts.current;
        const at = list.indexOf(ghost);
        if (at < 0)
            return;
        list.splice(at, 1);
        for (const animation of ghost.animations)
            animation.cancel();
        removeCopy(ghost.element);
        if (!list.length)
            setTransitionRows(0);
    };
    const finishTransition = () => {
        for (const ghost of [...ghosts.current])
            removeGhost(ghost);
    };
    useEffect(() => () => ghosts.current.forEach((ghost) => removeCopy(ghost.element)), []);
    /**
     * Whether the grid on screen shows every photo it can: each on-screen photo with an image loaded
     * is drawn with it. The outgoing grid stays on top until then, so the new one isn't revealed
     * with placeholders that fill in a moment later.
     */
    const incomingReady = () => {
        const { mode: shownMode, windows: shownWindows } = live.current;
        const renderer = canvasRendererRef.current;
        for (let index = shownWindows.visible.start; index <= shownWindows.visible.end; index++) {
            if (!best(index))
                continue;
            if (shownMode === 'canvas' ? (renderer?.tileState(index) ?? 0) < 2 : !shown(index))
                return false;
        }
        return true;
    };
    /** Change level around a focus, as an animation: the old grid zooms and fades into the new one. */
    const zoomTo = (nextLevel, focus, duration = TUNING.transitionMs) => {
        pinchControl.current?.finish();
        const root = rootRef.current;
        const scroller = scrollerRef.current;
        const layer = pinchRef.current;
        const content = contentRef.current;
        if (!root || !scroller || !layer || !content || !size.width || !count)
            return;
        const { geometry: from, selected, windows: shownNow } = live.current;
        const nextColumns = getLibraryColumns(size.width, nextLevel, options);
        if (nextColumns === from.columns)
            return;
        const toScreen = contentToScreen();
        const screenRect = (index) => {
            const rect = project(getLibraryTileRect(index, from), toScreen);
            return { x: rect.x, y: rect.y, size: rect.width };
        };
        // Focus photo: the one under the pointer, a requested one, or the selection when it's on screen.
        let index;
        let focusY;
        if (focus && 'x' in focus) {
            const point = toScreen.inverse().transformPoint(new DOMPoint(focus.x, focus.y));
            index = getLibraryIndexAt(point.x, point.y, from);
            focusY = focus.y;
        }
        else {
            const selectionOnScreen = selected != null && selected >= shownNow.visible.start && selected <= shownNow.visible.end;
            const center = toScreen.inverse().transformPoint(new DOMPoint(size.width / 2, size.height / 2));
            index =
                focus && 'index' in focus
                    ? focus.index
                    : selectionOnScreen
                        ? selected
                        : getLibraryIndexAt(center.x, center.y, from);
            const rect = screenRect(index);
            focusY = rect.y + rect.size / 2;
        }
        const fromRect = screenRect(index);
        const next = getLibraryGeometry(size, count, nextColumns, options);
        const plan = planLibraryZoom(next, index, fromRect, focusY);
        // Snapshot of the grid as it looks now; it zooms and fades out over the new layout. The ghost
        // follows a pinch still under way; inside it, the zoomer carries the snapshot to the new layout.
        const ghost = document.createElement('div');
        ghost.className = 'gally-library__ghost';
        ghost.inert = true;
        const zoomer = document.createElement('div');
        zoomer.className = 'gally-library__ghost-zoom';
        ghost.append(zoomer);
        let snapshot;
        const canvasRenderer = canvasRendererRef.current;
        if (live.current.mode === 'canvas' && canvasRenderer) {
            // The canvas bands themselves, handed over where they are: copying them into a screen-sized
            // canvas allocated and painted megabytes in the frame of the change.
            snapshot = document.createElement('div');
            snapshot.className = 'gally-library__bands';
            snapshot.style.cssText = `position:absolute;left:0;top:0;width:${size.width}px;transform-origin:0 0;transform:matrix(${toScreen.a},0,0,${toScreen.d},${toScreen.e},${toScreen.f})`;
            snapshot.append(...canvasRenderer.detachBands());
        }
        else {
            // Only the tiles on screen, as positioned copies reusing the decoded images: cloning the
            // whole rendered grid (overscan rows included) costs a full layout of hundreds of nodes.
            snapshot = document.createElement('div');
            snapshot.className = 'gally-library__snapshot';
            for (let index = shownNow.preload.start; index <= shownNow.preload.end; index++) {
                const rect = screenRect(index);
                if (index === hiddenIndex || rect.y + rect.size < 0 || rect.y > size.height)
                    continue;
                const tile = document.createElement('div');
                tile.className = 'gally-library__tile';
                if (index === selected)
                    tile.setAttribute('aria-selected', 'true');
                tile.style.cssText = `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.size}px;height:${rect.size}px`;
                const found = shown(index);
                if (found) {
                    const img = document.createElement('img');
                    img.src = found.loaded.url;
                    img.alt = '';
                    tile.append(img);
                }
                else if (photos[index]?.dominantColor) {
                    tile.style.backgroundColor = photos[index].dominantColor;
                }
                snapshot.append(tile);
            }
        }
        zoomer.append(snapshot);
        finishTransition();
        for (const animation of layer.getAnimations())
            animation.cancel();
        layer.style.transform = '';
        root.append(ghost);
        pendingScroll.current = { top: plan.scrollTop, level: nextLevel };
        const k = plan.scale;
        // Reduced motion fades the snapshot quickly, so the new canvas draws in this frame there.
        zoomCommit.current = !reducedMotion();
        try {
            flushSync(() => {
                unsettle();
                setLevel(nextLevel);
                setScrollTop(plan.scrollTop);
                const extra = k > 1 ? k - 1 : 0;
                setTransitionRows(extra > 0 ? Math.min(TUNING.transitionRows, Math.ceil((extra * size.height) / next.pitch)) : 0);
            });
        }
        finally {
            zoomCommit.current = false;
        }
        const current = { element: ghost, animations: [] };
        ghosts.current.push(current);
        const done = () => removeGhost(current);
        if (reducedMotion()) {
            const fade = snapshot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: TUNING.reducedMotionFadeMs, fill: 'forwards' });
            current.animations.push(fade);
            fade.onfinish = done;
            return;
        }
        const { translateX: tx, translateY: ty } = plan;
        const grow = content.animate([{ transform: `translate(${-tx / k}px, ${plan.scrollTop - (plan.scrollTop + ty) / k}px) scale(${1 / k})` }, { transform: 'none' }], { duration, easing: TUNING.spring });
        const zoom = zoomer.animate([{ transform: 'none' }, { transform: `matrix(${k}, 0, 0, ${k}, ${tx}, ${ty})` }], {
            duration,
            easing: TUNING.spring,
            fill: 'forwards',
        });
        const fade = snapshot.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: duration * 0.75,
            easing: 'cubic-bezier(0.4, 0, 0.8, 1)',
            fill: 'forwards',
        });
        current.animations.push(grow, zoom, fade);
        zoom.onfinish = done;
    };
    const zoomStep = (direction) => {
        // A pinch still settling lands first: the step is from where it lands.
        pinchControl.current?.finish();
        const next = stepLibraryLevel(live.current.level, direction, size.width, options);
        if (next !== live.current.level)
            zoomTo(next);
    };
    const scrollToIndex = (index, align = 'nearest') => {
        const scroller = scrollerRef.current;
        if (!scroller)
            return;
        const target = scrollTopForIndex(index, live.current.geometry, align, scroller.scrollTop);
        if (target === scroller.scrollTop)
            return;
        scroller.scrollTop = target;
        flushSync(() => setScrollTop(target));
    };
    const getTileRect = (index) => {
        const root = rootRef.current;
        const photo = photos[index];
        if (!root || !photo)
            return null;
        const rect = project(fitPhotoInTile(getLibraryTileRect(index, live.current.geometry), photo.width, photo.height, fit), contentToScreen());
        const frame = root.getBoundingClientRect();
        return new DOMRect(frame.left + rect.x, frame.top + rect.y, rect.width, rect.height);
    };
    const getStats = () => {
        const { windows: w, mode: m } = live.current;
        let filled = 0;
        let sharp = 0;
        const canvas = m === 'canvas' ? canvasRendererRef.current : null;
        for (let index = w.visible.start; index <= w.visible.end; index++) {
            if (canvas) {
                // On canvas, count what's actually drawn: images draw once their bitmaps are ready, a few
                // frames' worth of uploads at a time.
                const state = canvas.tileState(index);
                if (state >= 2)
                    filled++;
                if (state === 3)
                    sharp++;
                continue;
            }
            const found = shown(index);
            if (found)
                filled++;
            if (found?.sharp)
                sharp++;
        }
        return {
            level: live.current.level,
            mode: m,
            visibleTiles: Math.max(0, w.visible.end - w.visible.start + 1),
            filledTiles: filled,
            sharpTiles: sharp,
            loader: loader.getStats(),
        };
    };
    const pinchHandoff = (next, top, span, sync) => {
        pendingScroll.current = { top, level: next };
        const apply = () => {
            setLevelState(next);
            setScrollTop(top);
            setPinchSpan(span && { level: next, top: span.top, bottom: span.bottom, visibleTop: span.visibleTop, visibleBottom: span.visibleBottom });
        };
        if (sync)
            flushSync(apply);
        else
            startTransition(apply);
        reportLevel(next);
    };
    const pinchSpanUpdate = (next, span) => startTransition(() => setPinchSpan({ level: next, top: span.top, bottom: span.bottom, visibleTop: span.visibleTop, visibleBottom: span.visibleBottom }));
    /** A pinch starts: render rows around the screen for the grid to shrink into, before it moves. */
    const pinchBegin = (next, span) => {
        pinchActive.current = true;
        clearTimeout(settleTimer.current);
        flushSync(() => {
            setSettled(false);
            setPinchSpan({ level: next, top: span.top, bottom: span.bottom, visibleTop: span.visibleTop, visibleBottom: span.visibleBottom });
        });
    };
    const pinchEnd = () => {
        pinchActive.current = false;
        setPinchSpan(null);
        setScrollTop(scrollerRef.current?.scrollTop ?? 0);
        setSettled(true);
    };
    const actions = useRef({ removeCopy, prepareCanvasBitmaps, zoomTo, zoomStep, scrollToIndex, getTileRect, getStats, best, incomingReady, finishTransition, pinchHandoff, pinchSpan: pinchSpanUpdate, pinchBegin, pinchEnd });
    actions.current = { removeCopy, prepareCanvasBitmaps, zoomTo, zoomStep, scrollToIndex, getTileRect, getStats, best, incomingReady, finishTransition, pinchHandoff, pinchSpan: pinchSpanUpdate, pinchBegin, pinchEnd };
    useImperativeHandle(ref, () => ({
        focus: () => rootRef.current?.focus({ preventScroll: true }),
        zoomIn: () => actions.current.zoomStep(-1),
        zoomOut: () => actions.current.zoomStep(1),
        zoomToLevel: (next, focus) => actions.current.zoomTo(next, focus),
        scrollToIndex: (index, align) => actions.current.scrollToIndex(index, align),
        getTileRect: (index) => actions.current.getTileRect(index),
        getStats: () => actions.current.getStats(),
        getLoadedImage: (index) => (sources[index] ? actions.current.best(index, 'original')?.loaded : undefined),
        getVisibleWindow: () => {
            const { visible: range } = live.current.windows;
            const urls = [];
            for (let index = range.start; index <= range.end; index++)
                urls.push(sources[index][live.current.targetKey]);
            return { start: range.start, end: range.end, sources: urls };
        },
        getScrollElement: () => scrollerRef.current,
    }), [sources, loader]);
    // Pinch: two-finger touch, Safari gesture events (a trackpad on macOS), and ctrl+wheel, as in
    // Apple Photos (see `library-pinch.ts` for the model). The grid follows the fingers' spread and
    // centre. Moving towards another level, that level's grid takes over underneath a copy of the
    // current one, placed so the point under the fingers is the same image point in both, and the
    // two dissolve as the pinch progresses. Letting go springs scale and position to rest together.
    // Each frame only writes transforms and an opacity: the copy is made from what's already drawn,
    // and the new grid renders without blocking the fingers.
    useEffect(() => {
        const root = rootRef.current;
        const scroller = scrollerRef.current;
        const layer = pinchRef.current;
        const touches = new Map();
        let origin = { left: 0, top: 0 };
        const measureOrigin = () => {
            const rect = scroller.getBoundingClientRect();
            origin = { left: rect.left, top: rect.top };
        };
        const local = (clientX, clientY) => ({ x: clientX - origin.left, y: clientY - origin.top });
        let stops = [];
        const stopOf = (level) => {
            const columns = getLibraryColumns(live.current.size.width, level, options);
            return Math.max(0, stops.findIndex((stop) => stop.columns === columns));
        };
        const geometryOf = (stop) => getLibraryGeometry(live.current.size, live.current.count, stops[stop].columns, options);
        let gesture = null;
        let grid = { stop: 0, camera: { scale: 1, x: 0, y: 0 }, start: { scale: 1, x: 0, y: 0 } };
        /** The base level's copy while the grid grid shows another level. */
        let copy = null;
        let base = 0;
        /** The level the pinch is heading for from `base`, -1 for none. */
        let pairTo = -1;
        let pairP = 0;
        /** A level handed over to React, waiting for it to render. */
        let pending = null;
        let settling = null;
        /** After a release back to the copy's level: React renders that level under the copy, then the copy goes. */
        let swapping = null;
        const fading = new Set();
        let scrollY = 0;
        /** The gesture's camera since its last rebase (identity outside a pinch). */
        let delta = { scale: 1, x: 0, y: 0 };
        let requestedSpan = null;
        /** The grid mostly on screen: the copy until the live grid has dissolved halfway in. */
        const shownSurface = () => (copy && copy.opacity >= 0.5 ? copy : grid);
        let shownStop = -1;
        let fingersAtStart = 0;
        let lastFingers = 1;
        const emit = (phase) => {
            const surface = shownSurface();
            const stop = stops[surface.stop];
            if (!stop || !onPinchRef.current)
                return;
            const fingers = gesture ? Math.exp(gesture.raw - fingersAtStart) : lastFingers;
            lastFingers = fingers;
            onPinchRef.current({ phase, level: stop.level, columns: stop.columns, scale: surface.camera.scale, fingers, scrollTop: scrollY });
        };
        const writeLive = () => {
            const { scale, x, y } = grid.camera;
            layer.style.transform = scale === 1 && x === 0 && y === -scrollY ? '' : cameraTransform(grid.camera, scrollY);
        };
        const writeCopy = () => {
            if (!copy)
                return;
            copy.zoom.style.transform = cameraTransform(copy.camera);
            const opacity = String(Math.round(copy.opacity * 1000) / 1000);
            if (copy.element.style.opacity !== opacity)
                copy.element.style.opacity = opacity;
        };
        const fadeOut = (element, from) => {
            fading.add(element);
            const fade = element.animate([{ opacity: from }, { opacity: 0 }], { duration: TUNING.pinchCopyFadeMs, fill: 'forwards' });
            fade.onfinish = () => {
                fading.delete(element);
                actions.current.removeCopy(element);
            };
        };
        const dropCopy = () => {
            if (!copy)
                return;
            actions.current.removeCopy(copy.element);
            copy = null;
            if (swapping)
                cancelAnimationFrame(swapping.waiting);
            swapping = null;
        };
        /** Copy the grid grid as drawn now: its tiles, or its canvas bands handed over. */
        const copyLive = () => {
            const { size, mode } = live.current;
            const element = document.createElement('div');
            element.className = 'gally-library__ghost gally-library__ghost--pinch';
            element.inert = true;
            element.setAttribute('aria-hidden', 'true');
            const zoom = document.createElement('div');
            zoom.className = 'gally-library__ghost-zoom';
            zoom.style.width = `${size.width}px`;
            // Opaque behind the rows it shows, so fading it mixes the two grids there, gaps included;
            // beyond them the new grid shows as it is rather than an empty band.
            const { geometry: g, windows: w } = live.current;
            const backdrop = document.createElement('div');
            backdrop.className = 'gally-library__ghost-backdrop';
            backdrop.style.cssText = `top:${g.insetTop + w.preload.firstRow * g.pitch}px;height:${(w.preload.lastRow - w.preload.firstRow + 1) * g.pitch}px`;
            zoom.append(backdrop);
            const renderer = canvasRendererRef.current;
            if (mode === 'canvas' && renderer) {
                const bands = document.createElement('div');
                bands.className = 'gally-library__bands';
                bands.append(...renderer.detachBands());
                zoom.append(bands);
            }
            else if (gridRef.current) {
                const grid = gridRef.current.cloneNode(true);
                grid.removeAttribute('role');
                // Positioned, so it paints over the backdrop.
                grid.style.position = 'relative';
                grid.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
                zoom.append(grid);
            }
            element.append(zoom);
            root.append(element);
            return { ...grid, element, zoom, opacity: 1 };
        };
        /** Content rows to keep rendered for a camera: the screen, and more around it in case it shrinks. */
        const spanFor = (stop, camera) => {
            const height = live.current.size.height;
            const visibleTop = -camera.y / camera.scale;
            const visibleBottom = (height - camera.y) / camera.scale;
            const extra = (visibleBottom - visibleTop) * TUNING.pinchCoverage;
            return { stop, visibleTop, visibleBottom, top: visibleTop - extra, bottom: visibleBottom + extra };
        };
        const requestSpan = (camera) => {
            const span = spanFor(grid.stop, camera);
            const margin = (span.visibleBottom - span.visibleTop) * 0.1;
            const have = requestedSpan;
            if (have && have.stop === grid.stop && span.visibleTop - margin >= have.top && span.visibleBottom + margin <= have.bottom)
                return;
            requestedSpan = span;
            actions.current.pinchSpan(stops[grid.stop].level, span);
        };
        /** Start following the fingers from how everything looks now. */
        const rebase = (g, point, d0) => {
            g.raw0 = g.raw;
            g.startZ = g.z;
            g.startC = point;
            g.c = point;
            g.d0 = d0;
            grid.start = grid.camera;
            if (copy)
                copy.start = copy.camera;
            if (pending)
                pending.start = composeCamera(delta, pending.start);
            delta = { scale: 1, x: 0, y: 0 };
        };
        /** A settle caught by a new pinch: everything stays where it is on screen, the dissolve too. */
        const interrupt = () => {
            const s = settling;
            if (!s)
                return;
            settling = null;
            const time = s.animations[0]?.currentTime;
            const t = Math.min(s.duration, Math.max(0, (typeof time === 'number' ? time : 0) / 1000));
            const camera = settleCamera(s.plan, t);
            grid.camera = composeCamera(camera, s.liveFrom);
            if (copy) {
                copy.camera = composeCamera(camera, s.copyFrom);
                copy.opacity = opacityAt(s.opacity, t);
            }
            for (const animation of s.animations)
                animation.cancel();
            writeLive();
            writeCopy();
        };
        const begin = (point, d0) => {
            if (gesture)
                return gesture;
            actions.current.finishTransition();
            layer.style.transformOrigin = '';
            // Its own compositor layer while it scales, rasterized once: otherwise Safari repaints the
            // whole grid at each new scale.
            layer.style.willChange = 'transform';
            stops = [];
            const { size } = live.current;
            for (let level = 0; level < libraryLevelCount(options); level++) {
                const columns = getLibraryColumns(size.width, level, options);
                if (stops.at(-1)?.columns === columns)
                    continue;
                const cell = getLibraryCellSize(size.width, columns, options);
                stops.push({ level, columns, cell, z: Math.log(cell) });
            }
            if (swapping)
                finishSwap(true);
            if (settling) {
                interrupt();
            }
            else {
                scrollY = scroller.scrollTop;
                grid = { stop: stopOf(live.current.level), camera: { scale: 1, x: 0, y: -scrollY }, start: { scale: 1, x: 0, y: -scrollY } };
                dropCopy();
                base = grid.stop;
                pairTo = -1;
            }
            const shown = copy && copy.stop === base ? copy.camera : grid.camera;
            const z = stops[base].z + Math.log(shown.scale);
            const g = {
                raw0: 0,
                startZ: z,
                raw: unresist(z),
                z,
                slope: 1,
                startC: point,
                c: point,
                d0,
                f: copy ? progressForDissolve(1 - copy.opacity) : 0,
                at: performance.now(),
                timer: 0,
                samples: [],
            };
            rebase(g, point, d0);
            gesture = g;
            fingersAtStart = g.raw;
            shownStop = shownSurface().stop;
            const span = spanFor(grid.stop, grid.camera);
            requestedSpan = span;
            actions.current.pinchBegin(stops[grid.stop].level, span);
            emit('start');
            return g;
        };
        /**
         * A grid stays within its edges as it scales, as a scroll view zooms: at the library's start or
         * end, the first or last row stays at the screen's edge rather than opening a gap; while it's
         * wider than the screen, no side shows a margin.
         */
        const bounded = (camera, stop) => {
            const { width, height } = live.current.size;
            const contentHeight = geometryOf(stop).contentHeight * camera.scale;
            const contentWidth = width * camera.scale;
            let { x, y } = camera;
            if (contentWidth >= width)
                x = clamp(x, width - contentWidth, 0);
            y = contentHeight >= height ? clamp(y, height - contentHeight, 0) : Math.min(y, 0);
            return x === camera.x && y === camera.y ? camera : { scale: camera.scale, x, y };
        };
        /** Selection zoom (log of the tile size shown) with resistance past the closest and densest levels. */
        const resisted = (raw) => {
            const closest = resist(raw, stops[0].z, CLOSEST_ROOM, 1);
            return closest.slope < 1 ? closest : resist(raw, stops.at(-1).z, DENSEST_ROOM, -1);
        };
        const unresist = (z) => {
            const undo = (limit, room, past) => {
                const t = Math.min(0.999, ((z - limit) * past) / room);
                return limit + past * room * Math.atanh(t);
            };
            if (z > stops[0].z)
                return undo(stops[0].z, CLOSEST_ROOM, 1);
            if (z < stops.at(-1).z)
                return undo(stops.at(-1).z, DENSEST_ROOM, -1);
            return z;
        };
        /** Input: the fingers' zoom (log units) and centre, with the event's time. */
        const input = (g, raw, c, t) => {
            g.raw = raw;
            g.c = c;
            g.samples.push({ t, z: raw, x: c.x, y: c.y });
            while (g.samples.length > 2 && t - g.samples[0].t > 120)
                g.samples.shift();
            schedule();
        };
        /** Hand the pinch to `to`: its grid renders under a copy of the base level, aligned at the fingers. */
        const handoff = (g, to, sync = false) => {
            copy ??= copyLive();
            const from = geometryOf(copy.stop);
            const next = geometryOf(to);
            const camera = copy.camera;
            const { width } = live.current.size;
            // Photos show at the same size in both grids.
            const scale = (camera.scale * from.cell) / next.cell;
            // Across: the same share of the grid's width stays under the fingers, so its edges line up
            // and nothing slides in from the side; photos change column under the dissolve.
            const share = (g.c.x - camera.x) / (camera.scale * width);
            const x = g.c.x - share * scale * width;
            // Down: the photo under the fingers keeps the same point of it under them...
            const point = { x: (g.c.x - camera.x) / camera.scale, y: (g.c.y - camera.y) / camera.scale };
            const index = getLibraryIndexAt(point.x, point.y, from);
            const a = getLibraryTileRect(index, from);
            const fy = clamp((point.y - a.y) / from.cell, 0, 1);
            const anchorY = camera.scale * (a.y + fy * from.cell) + camera.y;
            const y = anchorY - scale * (getLibraryTileRect(index, next).y + fy * next.cell);
            const placed = { scale, x, y };
            pending = { stop: to, start: composeCamera(invertCamera(delta), placed) };
            pinchCover.current = true;
            const span = spanFor(to, placed);
            requestedSpan = span;
            const restTop = clamp((g.c.y - y) / scale - g.c.y, 0, next.maxScroll);
            actions.current.pinchHandoff(stops[to].level, restTop, span, sync);
        };
        /** React rendered `level`: the pinch's new grid takes its place on screen. */
        const committed = (level) => {
            if (pending && stops[pending.stop]?.level === level) {
                grid = { stop: pending.stop, start: pending.start, camera: composeCamera(delta, pending.start) };
                pending = null;
                pinchCover.current = false;
                scrollY = scroller.scrollTop;
                writeLive();
                // The dissolve can start now, even if the fingers hold still.
                schedule();
            }
            if (swapping && stops[swapping.stop]?.level === level && grid.stop !== swapping.stop) {
                scrollY = scroller.scrollTop;
                grid = { stop: swapping.stop, camera: { scale: 1, x: 0, y: -scrollY }, start: { scale: 1, x: 0, y: -scrollY } };
                pinchCover.current = false;
                writeLive();
                base = grid.stop;
                const s = swapping;
                s.since = performance.now();
                const wait = () => {
                    if (actions.current.incomingReady() || performance.now() - s.since > TUNING.pinchRevealWaitMs)
                        finishSwap(false);
                    else
                        s.waiting = requestAnimationFrame(wait);
                };
                s.waiting = requestAnimationFrame(wait);
            }
        };
        /** The grid is back under the copy: remove the copy (now, when a new pinch needs a clean start). */
        const finishSwap = (now) => {
            const s = swapping;
            if (!s)
                return;
            if (grid.stop !== s.stop && now)
                actions.current.pinchHandoff(stops[s.stop].level, -copy.camera.y, null, true);
            dropCopy();
            layer.style.willChange = '';
            actions.current.pinchEnd();
        };
        // Input can arrive several times a frame (two fingers, Safari's events): it updates the gesture,
        // and the grids follow once per frame.
        let frame = 0;
        const schedule = () => {
            frame ||= requestAnimationFrame(() => {
                frame = 0;
                update();
            });
        };
        const flush = () => {
            if (!frame)
                return;
            cancelAnimationFrame(frame);
            frame = 0;
            update();
        };
        const update = () => {
            const g = gesture;
            if (!g)
                return;
            const now = performance.now();
            const shown = resisted(g.raw);
            g.z = shown.value;
            g.slope = shown.slope;
            delta = gestureCamera(g.startC, g.c, Math.exp(g.z - g.startZ));
            grid.camera = bounded(composeCamera(delta, grid.start), grid.stop);
            if (copy)
                copy.camera = bounded(composeCamera(delta, copy.start), copy.stop);
            // Which two levels the pinch is between, and how far along.
            for (;;) {
                const from = stops[base];
                const to = base + (g.z < from.z ? 1 : -1);
                if (to < 0 || to >= stops.length) {
                    pairTo = -1;
                    pairP = 0;
                    break;
                }
                const p = (g.z - from.z) / (stops[to].z - from.z);
                if (to !== pairTo) {
                    pairTo = to;
                    g.f = p;
                }
                // Past the incoming level, dissolved in: it becomes the base, and the copy goes.
                if (p >= DISSOLVE_END && grid.stop === to && !pending) {
                    if (copy) {
                        fadeOut(copy.element, copy.opacity);
                        copy = null;
                    }
                    base = to;
                    pairTo = -1;
                    continue;
                }
                if (p >= DISSOLVE_START && grid.stop !== to && pending?.stop !== to)
                    handoff(g, to);
                pairP = p;
                break;
            }
            const dt = Math.max(0, (now - g.at) / 1000);
            g.at = now;
            g.f = pairP + (g.f - pairP) * Math.exp(-dt / DISSOLVE_LAG_S);
            if (copy)
                copy.opacity = pairTo >= 0 && grid.stop === pairTo && !pending ? 1 - dissolveAt(g.f) : 1;
            writeLive();
            writeCopy();
            // The filtered dissolve catches up with the fingers even while they hold still.
            if (Math.abs(g.f - pairP) > 0.001)
                schedule();
            if (!pending)
                requestSpan(grid.camera);
            const shownNow = shownSurface().stop;
            if (shownNow !== shownStop) {
                shownStop = shownNow;
                emit('commit');
            }
            emit('move');
        };
        const release = (cancelled = false) => {
            flush();
            const g = gesture;
            gesture = null;
            if (!g)
                return;
            clearTimeout(g.timer);
            const now = performance.now();
            const zSpeed = cancelled ? 0 : clamp(fitSpeed(g.samples.map((s) => ({ t: s.t, v: s.z })), now), -TUNING.pinchMaxZoomSpeed, TUNING.pinchMaxZoomSpeed) * g.slope;
            const xSpeed = cancelled ? 0 : clamp(fitSpeed(g.samples.map((s) => ({ t: s.t, v: s.x })), now), -TUNING.pinchMaxPanSpeed, TUNING.pinchMaxPanSpeed);
            const ySpeed = cancelled ? 0 : clamp(fitSpeed(g.samples.map((s) => ({ t: s.t, v: s.y })), now), -TUNING.pinchMaxPanSpeed, TUNING.pinchMaxPanSpeed);
            // Where it lands: the nearer of the two levels it's between, judged a moment ahead.
            let target = base;
            if (pairTo >= 0) {
                const step = stops[pairTo].z - stops[base].z;
                const ahead = pairP + (zSpeed * TUNING.pinchProjectionS) / step;
                if (ahead >= 0.5)
                    target = pairTo;
            }
            // A level still rendering that it won't land on: keep the grid that's there.
            if (pending && pending.stop !== target) {
                pending = null;
                pinchCover.current = false;
                actions.current.pinchHandoff(stops[grid.stop].level, scrollY, spanFor(grid.stop, grid.camera), true);
            }
            // Landing on a level not on screen yet (or still rendering): render it now.
            if (target !== grid.stop && !(copy && copy.stop === target))
                handoff(g, target, true);
            const onCopy = copy !== null && copy.stop === target && grid.stop !== target;
            const surface = onCopy ? copy : grid;
            const geometry = geometryOf(surface.stop);
            const focus = { x: (g.c.x - surface.camera.x) / surface.camera.scale, y: (g.c.y - surface.camera.y) / surface.camera.scale };
            let restTop = clamp(focus.y - g.c.y, 0, geometry.maxScroll);
            // The live grid rests at its new scroll position: move it there now, under the same transform.
            if (!onCopy) {
                scroller.scrollTop = restTop;
                restTop = scroller.scrollTop;
                scrollY = restTop;
            }
            const plan = planSettle(surface.camera, g.c, { scale: 1, x: 0, y: -restTop }, { scale: surface.camera.scale * zSpeed, x: xSpeed, y: ySpeed });
            plan.scale.velocity = limitOvershoot(plan.scale.error, plan.scale.velocity, TUNING.pinchMaxOvershoot);
            // The dissolve finishes from where it is, at its own pace.
            const opacityTo = onCopy ? 1 : 0;
            let opacityVelocity = 0;
            if (copy && pairTo >= 0 && !cancelled) {
                const step = stops[pairTo].z - stops[base].z;
                const pSpeed = zSpeed / step;
                opacityVelocity = -(dissolveAt(g.f + 0.01) - dissolveAt(g.f - 0.01)) / 0.02 * pSpeed;
                // Never pushed past where it's going.
                if ((opacityTo - copy.opacity) * opacityVelocity < 0)
                    opacityVelocity = 0;
            }
            const opacity = { from: copy?.opacity ?? 0, to: opacityTo, velocity: opacityVelocity };
            const { size } = live.current;
            const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
            let duration = settleDuration(plan, Math.hypot(size.width, size.height), dpr);
            if (copy)
                for (let t = 0; t < 2 && Math.abs(opacityAt(opacity, t) - opacity.to) > 0.002; t += 1 / 240)
                    duration = Math.max(duration, t);
            const liveFrom = composeCamera(invertCamera(surface.camera), grid.camera);
            const copyFrom = copy ? composeCamera(invertCamera(surface.camera), copy.camera) : { scale: 1, x: 0, y: 0 };
            const animations = [];
            if (!reducedMotion() && duration > 0) {
                const liveFrames = [];
                const copyMoves = [];
                const copyFades = [];
                const steps = Math.max(1, Math.ceil(duration * 120));
                for (let i = 0; i <= steps; i++) {
                    const t = (i / steps) * duration;
                    const camera = i === steps ? { scale: 1, x: 0, y: -restTop } : settleCamera(plan, t);
                    const offset = i / steps;
                    liveFrames.push({ offset, transform: cameraTransform(composeCamera(camera, liveFrom), scrollY) });
                    if (copy) {
                        copyMoves.push({ offset, transform: cameraTransform(composeCamera(camera, copyFrom)) });
                        copyFades.push({ offset, opacity: i === steps ? opacity.to : opacityAt(opacity, t) });
                    }
                }
                const timing = { duration: duration * 1000, fill: 'forwards' };
                animations.push(layer.animate(liveFrames, timing));
                if (copy) {
                    // Opacity on the copy's frame, transform on its zoom layer.
                    animations.push(copy.element.animate(copyFades, timing));
                    animations.push(copy.zoom.animate(copyMoves, timing));
                }
            }
            const s = { plan, target: onCopy ? 'copy' : 'grid', liveFrom, copyFrom, opacity, duration, animations, restTop, done: () => { } };
            settling = s;
            // The end state, under the animations, for when they finish.
            const rest = { scale: 1, x: 0, y: -restTop };
            grid.camera = composeCamera(rest, liveFrom);
            if (copy) {
                copy.camera = composeCamera(rest, copyFrom);
                copy.opacity = opacity.to;
            }
            writeLive();
            writeCopy();
            const done = () => {
                if (settling !== s)
                    return;
                settling = null;
                for (const animation of s.animations)
                    animation.cancel();
                if (s.target === 'grid') {
                    dropCopy();
                    base = grid.stop;
                    pairTo = -1;
                    layer.style.willChange = '';
                    actions.current.pinchEnd();
                }
                else {
                    // Back to the copy's level: render it under the copy, then let the copy go.
                    base = copy.stop;
                    pairTo = -1;
                    swapping = { stop: copy.stop, waiting: 0, since: 0 };
                    pinchCover.current = true;
                    actions.current.pinchHandoff(stops[copy.stop].level, restTop, null, false);
                }
            };
            s.done = done;
            if (animations.length)
                animations[0].finished.then(done, () => { });
            else
                done();
            emit('end');
        };
        const onWheel = (event) => {
            if (!event.ctrlKey && !event.metaKey)
                return;
            event.preventDefault();
            if (!gesture)
                measureOrigin();
            const point = local(event.clientX, event.clientY);
            const g = begin(point, 0);
            input(g, g.raw - event.deltaY * TUNING.wheelPinchSensitivity, point, event.timeStamp);
            clearTimeout(g.timer);
            g.timer = window.setTimeout(() => release(), TUNING.wheelPinchEndMs);
        };
        const onGestureStart = (event) => {
            event.preventDefault();
            if (touches.size)
                return;
            measureOrigin();
            const e = event;
            begin(local(e.clientX, e.clientY), e.scale || 1);
        };
        const onGestureChange = (event) => {
            const g = gesture;
            if (!g)
                return;
            event.preventDefault();
            if (touches.size)
                return;
            const e = event;
            input(g, g.raw0 + Math.log(e.scale / g.d0), g.c, event.timeStamp);
        };
        const onGestureEnd = (event) => {
            if (!gesture)
                return;
            event.preventDefault();
            if (!touches.size)
                release();
        };
        const fingers = () => {
            const [a, b] = [...touches.values()];
            return a && b ? { c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) } : null;
        };
        let touchPinch = false;
        const onPointerDown = (event) => {
            if (event.pointerType !== 'touch')
                return;
            // A new touch: fingers from before are gone, even if their lift never reached us.
            if (event.isPrimary) {
                touches.clear();
                measureOrigin();
            }
            if (touches.size >= 2)
                return;
            touches.set(event.pointerId, local(event.clientX, event.clientY));
            const two = fingers();
            if (!two)
                return;
            // Joining a pinch Safari's gesture events began: carry on from where it is.
            if (gesture)
                rebase(gesture, two.c, two.d);
            else
                begin(two.c, two.d);
            touchPinch = true;
        };
        const onPointerMove = (event) => {
            if (!touches.has(event.pointerId))
                return;
            touches.set(event.pointerId, local(event.clientX, event.clientY));
            const g = gesture;
            const two = fingers();
            if (g && touchPinch && two)
                input(g, g.raw0 + Math.log(two.d / g.d0), two.c, event.timeStamp);
        };
        const onPointerEnd = (event) => {
            if (!touches.delete(event.pointerId))
                return;
            if (touches.size < 2 && touchPinch) {
                touchPinch = false;
                release(event.type === 'pointercancel');
            }
        };
        pinchControl.current = {
            committed,
            finish: () => {
                if (gesture)
                    return;
                // Now, not when the animations' promise resolves: the caller goes on to use the grid.
                settling?.done();
                if (swapping)
                    finishSwap(true);
            },
        };
        // A pinch starts in the grid, but its moves and ends are heard on the window: a touch's events go
        // to the element it began on, and a level change can remove that tile from the page, after which
        // they'd never reach the grid (the fingers would stay "down", and every later pinch be ignored).
        const capture = { capture: true };
        // Two fingers on the grid pinch it: the page mustn't also scroll under them.
        const onTouchMove = (event) => {
            if (event.touches.length >= 2 && gesture)
                event.preventDefault();
        };
        scroller.addEventListener('touchmove', onTouchMove, { passive: false });
        scroller.addEventListener('wheel', onWheel, { passive: false });
        scroller.addEventListener('gesturestart', onGestureStart);
        window.addEventListener('gesturechange', onGestureChange, capture);
        window.addEventListener('gestureend', onGestureEnd, capture);
        scroller.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove, capture);
        window.addEventListener('pointerup', onPointerEnd, capture);
        window.addEventListener('pointercancel', onPointerEnd, capture);
        return () => {
            scroller.removeEventListener('touchmove', onTouchMove);
            scroller.removeEventListener('wheel', onWheel);
            scroller.removeEventListener('gesturestart', onGestureStart);
            window.removeEventListener('gesturechange', onGestureChange, capture);
            window.removeEventListener('gestureend', onGestureEnd, capture);
            scroller.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('pointermove', onPointerMove, capture);
            window.removeEventListener('pointerup', onPointerEnd, capture);
            window.removeEventListener('pointercancel', onPointerEnd, capture);
            clearTimeout(gesture?.timer);
            cancelAnimationFrame(frame);
            settling?.animations.forEach((animation) => animation.cancel());
            if (swapping)
                cancelAnimationFrame(swapping.waiting);
            if (copy)
                actions.current.removeCopy(copy.element);
            for (const element of fading)
                actions.current.removeCopy(element);
            // Torn down mid-pinch (the layout changed): the grid goes back to rest.
            if (gesture || settling || swapping || pending) {
                layer.style.transform = '';
                layer.style.willChange = '';
                actions.current.pinchEnd();
            }
            pinchControl.current = null;
            pinchCover.current = false;
        };
    }, [options]);
    const indexAtEvent = (event) => {
        const rect = scrollerRef.current.getBoundingClientRect();
        const point = contentToScreen().inverse().transformPoint(new DOMPoint(event.clientX - rect.left, event.clientY - rect.top));
        const g = live.current.geometry;
        const index = getLibraryIndexAt(point.x, point.y, g);
        const tile = getLibraryTileRect(index, g);
        const inside = point.x >= tile.minX && point.x <= tile.maxX && point.y >= tile.minY && point.y <= tile.maxY;
        return { index, inside, x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const open = (index) => {
        const photo = photos[index];
        if (photo)
            onOpenPhoto?.({ id: photo.id, index, photo });
    };
    const onKeyDown = (event) => {
        const mod = event.metaKey || event.ctrlKey;
        if (mod && (event.key === '=' || event.key === '+')) {
            event.preventDefault();
            zoomStep(-1);
            return;
        }
        if (mod && event.key === '-') {
            event.preventDefault();
            zoomStep(1);
            return;
        }
        if (mod || event.altKey)
            return;
        const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
        const move = moves[event.key];
        if (move != null) {
            event.preventDefault();
            const next = selected == null ? visible.start : Math.min(count - 1, Math.max(0, selected + move));
            setSelected(next);
            scrollToIndex(next);
            return;
        }
        if ((event.key === 'Enter' || event.key === ' ') && selected != null) {
            event.preventDefault();
            open(selected);
        }
    };
    const tileId = (index) => `${uid}-photo-${index}`;
    const selectedPhoto = selected != null ? photos[selected] : undefined;
    const tiles = [];
    if (mode === 'dom' && size.width) {
        for (let index = preload.start; index <= preload.end; index++) {
            const photo = photos[index];
            tiles.push(_jsx(Tile, { id: tileId(index), label: photo.alt ?? `Photo ${index + 1}`, src: shown(index)?.loaded.url, color: photo.dominantColor, selected: selected === index, hidden: hiddenIndex === index }, photo.id));
        }
    }
    return (_jsxs("div", { ref: rootRef, className: ['gally-library', `gally-library--${fit}`, className].filter(Boolean).join(' '), role: "grid", "aria-label": props['aria-label'] ?? 'Photos', "aria-rowcount": geometry.rows, "aria-colcount": columns, "aria-activedescendant": mode === 'dom' && selected != null && selected >= preload.start && selected <= preload.end ? tileId(selected) : undefined, tabIndex: 0, onKeyDown: onKeyDown, "data-gally-mode": mode, children: [_jsx("div", { ref: scrollerRef, className: "gally-library__scroller", onScroll: (event) => {
                    const top = event.currentTarget.scrollTop;
                    const now = event.timeStamp;
                    const last = lastScroll.current;
                    const speed = Math.abs(top - last.top) / Math.max(1, now - last.at);
                    if (now - last.at < 100 && speed * 1000 > TUNING.flickScreensPerSecond * size.height)
                        unsettle();
                    lastScroll.current = { top, at: now };
                    // Render only when the rows change: tiles and canvas bands are placed in the scrolling
                    // content, so scrolling within the rendered rows needs no work.
                    const shownNow = live.current.windows;
                    const next = getLibraryWindows(live.current.geometry, top, TUNING.overscanRows + transitionRows);
                    if (!sameRange(next.visible, shownNow.visible) || !sameRange(next.preload, shownNow.preload))
                        setScrollTop(top);
                }, onClick: (event) => {
                    const hit = indexAtEvent(event);
                    if (!hit.inside)
                        return;
                    setSelected(hit.index);
                    if (tapToZoom && event.detail > 0 && live.current.level > standardLevel) {
                        zoomedAt.current = event.timeStamp;
                        zoomTo(standardLevel, { x: hit.x, y: hit.y });
                    }
                }, onDoubleClick: (event) => {
                    const hit = indexAtEvent(event);
                    if (!hit.inside || event.timeStamp - zoomedAt.current < TUNING.doubleClickAfterZoomMs)
                        return;
                    open(hit.index);
                }, children: _jsx("div", { ref: pinchRef, className: "gally-library__pinch", style: { height: geometry.contentHeight }, children: _jsx("div", { ref: contentRef, className: "gally-library__content", style: { height: geometry.contentHeight }, children: mode === 'canvas' ? (_jsx("div", { ref: bandsRef, className: "gally-library__bands" })) : (_jsx("div", { ref: gridRef, className: "gally-library__grid", role: "rowgroup", style: {
                                paddingTop: geometry.insetTop + preload.firstRow * geometry.pitch,
                                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                                gridAutoRows: geometry.cell,
                                gap: geometry.gap,
                            }, children: tiles })) }) }) }), _jsx("span", { className: "gally-library__status", "aria-live": "polite", children: selectedPhoto && selected != null ? `${selectedPhoto.alt ?? 'Photo'}, ${selected + 1} of ${count}` : '' })] }));
}
const Tile = memo(function Tile({ id, label, src, color, selected, hidden }) {
    return (_jsx("div", { id: id, role: "gridcell", "aria-label": label, "aria-selected": selected, className: "gally-library__tile", style: hidden || color ? { visibility: hidden ? 'hidden' : undefined, backgroundColor: color } : undefined, children: src && _jsx("img", { src: src, alt: "", draggable: false }) }));
});
export const GallyLibrary = forwardRef(GallyLibraryInner);
const noSubscribe = () => () => { };
function sameRange(a, b) {
    return a.start === b.start && a.end === b.end;
}
function layerMatrix(element) {
    const style = getComputedStyle(element);
    if (!style.transform || style.transform === 'none')
        return new DOMMatrix();
    const [originX = 0, originY = 0] = style.transformOrigin.split(' ').map(parseFloat);
    return new DOMMatrix().translate(originX, originY).multiply(new DOMMatrix(style.transform)).translate(-originX, -originY);
}
function reducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
/** A copy's opacity `t` seconds into a release: a critically damped spring of its own, kept within 0–1. */
function opacityAt(opacity, t) {
    return Math.min(1, Math.max(0, opacity.to + springValue(opacity.from - opacity.to, opacity.velocity, DISSOLVE_RATE, t)));
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
//# sourceMappingURL=GallyLibrary.js.map