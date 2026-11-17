'use client';
import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { boundsIntersect, expandBounds, getViewportWorldBounds } from '../geometry.js';
import { cappedDevicePixelRatio } from '../lod.js';
import { bestReadySource, SOURCE_KEYS } from '../photo-sources.js';
import { getCameraWorldBounds, queryWrappedPhotoScene } from '../scene/photo-scene.js';
/** Re-query once the screen comes within this many pixels of the mounted area's edge. */
const EDGE_PX = 96;
/** Re-query after zooming in or out this much since the last query. */
const ZOOM_IN_REQUERY = 1.4;
/** Images arriving for mounted tiles off screen re-render them at most this often. */
const OFFSCREEN_RENDER_MS = 250;
/** When `maxTiles` cut the mounted set short, re-query at most this often while moving. */
const TRUNCATED_REQUERY_MS = 100;
/**
 * New tiles mounted per frame, at most, nearest the screen's centre first: zooming far out at once
 * otherwise mounts hundreds of photos in one frame (a 200 ms frame in Safari). The rest follow on
 * the next frames.
 */
const MOUNT_PER_FRAME = 48;
/**
 * The source size for a tile whose long edge spans `pixels` device pixels: the smallest whose
 * short edge, in usual photo sources, covers it.
 */
export function photoSizeForPixels(pixels) {
    if (pixels <= 200)
        return 'thumb';
    if (pixels <= 480)
        return 'small';
    if (pixels <= 1200)
        return 'medium';
    return 'large';
}
/** A tile's image URL at a size. Scene tiles have every size (missing ones fall back to another). */
export const sourceFor = (tile, size) => tile.sources[size];
const sizeForTile = (tile, zoom, dpr) => photoSizeForPixels(Math.max(tile.detailRect.width, tile.detailRect.height) * zoom * dpr);
/** The image a tile can show now: the size it wants or sharper, else the nearest smaller one decoded. */
function bestShown(loader, mounted) {
    const found = bestReadySource(mounted.tile.sources, mounted.size, (src) => loader.isRenderable(src));
    const loaded = found && loader.get(found.src);
    return found && loaded ? { url: loaded.url, sharp: found.sharp, src: found.src } : undefined;
}
export function usePhotoTileWindow(scene, loader, options) {
    const channel = useMemo(() => loader.channel(), [loader]);
    useEffect(() => () => channel.release(), [channel]);
    const [tiles, setTiles] = useState([]);
    const [imagesVersion, setImagesVersion] = useState(0);
    const live = useRef({
        bounds: null,
        zoom: 0,
        scene,
        truncatedAt: 0,
        /** Mounted tiles by every image URL they could show. */
        users: new Map(),
        /** The URL each mounted tile showed when last rendered. */
        rendered: new Map(),
        tiles,
        frame: 0,
        later: undefined,
        /** The last demand list, and its URLs, so displayed fallbacks can be added to it. */
        demands: [],
        demanded: new Set(),
        queried: null,
        camera: null,
        /** A follow-up query mounting the tiles held back by `MOUNT_PER_FRAME`. */
        more: 0,
        update: null,
    });
    const { mountOverscan, preloadMargin, maxTiles, dprCap } = options;
    // One re-render per frame at most, and only when a mounted tile would show something else.
    useEffect(() => {
        const state = live.current;
        const unsubscribe = loader.subscribe((changed) => {
            const elements = [];
            const protect = [];
            let render = false;
            const view = state.camera && getViewportWorldBounds(state.camera, state.camera);
            for (const src of changed) {
                for (const entry of state.users.get(src) ?? []) {
                    const showing = bestShown(loader, entry);
                    // A tile now showing an image it doesn't ask for: ask for it, so it isn't evicted.
                    if (showing && !state.demanded.has(showing.src))
                        protect.push(showing.src);
                    if (showing?.url !== state.rendered.get(entry.tile.id)) {
                        // On screen, next frame; just off it, batched: those tiles only need to be ready in time.
                        render = render === 'now' || !view || boundsIntersect(entry.tile.detailRect, view) ? 'now' : 'later';
                    }
                    // Blob-mode loaders decode an element for the image a tile wants, or for any image while
                    // it has none: not for every size that happens to load (thumbnails warmed for the overview).
                    if (!loader.isRenderable(src) && (src === sourceFor(entry.tile, entry.size) || !showing)) {
                        elements.push(src);
                        // Kept asked for while its element is made, so eviction can't take it meanwhile.
                        if (!state.demanded.has(src))
                            protect.push(src);
                    }
                }
            }
            if (elements.length)
                loader.prepareElements(elements);
            if (protect.length) {
                for (const src of protect) {
                    if (state.demanded.has(src))
                        continue;
                    state.demanded.add(src);
                    state.demands = [{ src, priority: 'prefetch' }, ...state.demands];
                }
                channel.demand(state.demands);
            }
            if (!render)
                return;
            const rerender = () => {
                cancelAnimationFrame(state.frame);
                clearTimeout(state.later);
                state.frame = 0;
                state.later = undefined;
                setImagesVersion((version) => version + 1);
            };
            if (render === 'now')
                state.frame ||= requestAnimationFrame(rerender);
            else
                state.later ??= setTimeout(rerender, OFFSCREEN_RENDER_MS);
        });
        return () => {
            unsubscribe();
            cancelAnimationFrame(state.frame);
            clearTimeout(state.later);
            state.frame = 0;
            state.later = undefined;
        };
    }, [channel, loader]);
    const update = useCallback((camera, viewport, force = false) => {
        const state = live.current;
        if (viewport.width <= 1 || viewport.height <= 1)
            return;
        // Where the screen is now, for telling on-screen tiles from off-screen ones between queries.
        state.camera = { ...camera, ...viewport };
        const view = getViewportWorldBounds(camera, viewport);
        if (!force && state.bounds && state.scene === scene) {
            // Nothing moved since the last query (an image arriving re-renders without moving).
            const last = state.queried;
            if (last && last.x === camera.x && last.y === camera.y && last.zoom === camera.zoom && last.width === viewport.width && last.height === viewport.height)
                return;
            const edge = expandBounds(view, EDGE_PX / camera.zoom);
            const inside = edge.minX >= state.bounds.minX && edge.maxX <= state.bounds.maxX && edge.minY >= state.bounds.minY && edge.maxY <= state.bounds.maxY;
            // Zoomed a lot either way since: in, to unmount what's far and ask for sharper images; out,
            // for smaller ones.
            if (inside && camera.zoom < state.zoom * ZOOM_IN_REQUERY && camera.zoom > state.zoom / ZOOM_IN_REQUERY)
                return;
            if (state.truncatedAt && performance.now() - state.truncatedAt < TRUNCATED_REQUERY_MS)
                return;
        }
        const dpr = cappedDevicePixelRatio({ dprCap });
        const reach = Math.max(mountOverscan, preloadMargin);
        const near = queryWrappedPhotoScene(scene, camera, viewport, 'detail', { overscanScreenPx: reach });
        const mountBounds = getCameraWorldBounds(camera, viewport, mountOverscan);
        const center = { x: (view.minX + view.maxX) / 2, y: (view.minY + view.maxY) / 2 };
        const distance = (tile) => {
            const rect = tile.detailRect;
            return (rect.x + rect.width / 2 - center.x) ** 2 + (rect.y + rect.height / 2 - center.y) ** 2;
        };
        let mounted = near.filter((tile) => boundsIntersect(tile.detailRect, mountBounds));
        let truncated = maxTiles !== undefined && mounted.length > maxTiles;
        if (truncated)
            mounted = mounted.sort((a, b) => distance(a) - distance(b)).slice(0, maxTiles);
        // Keep each still-mounted tile's entry, so its memoized element doesn't re-render.
        const previous = new Map(state.scene === scene ? state.tiles.map((entry) => [entry.tile.id, entry]) : []);
        // Too many new tiles for one frame: the nearest now, the rest on the next frames.
        const added = mounted.filter((tile) => !previous.has(tile.id));
        cancelAnimationFrame(state.more);
        state.more = 0;
        if (added.length > MOUNT_PER_FRAME) {
            const now = new Set(added.sort((a, b) => distance(a) - distance(b)).slice(0, MOUNT_PER_FRAME).map((tile) => tile.id));
            mounted = mounted.filter((tile) => previous.has(tile.id) || now.has(tile.id));
            truncated = true;
            state.more = requestAnimationFrame(() => {
                state.more = 0;
                const at = state.camera;
                if (at)
                    state.update?.(at, at, true);
            });
        }
        const mountedIds = new Set(mounted.map((tile) => tile.id));
        const next = mounted.map((tile) => {
            const size = sizeForTile(tile, camera.zoom, dpr);
            const kept = previous.get(tile.id);
            return kept && kept.size === size ? kept : { tile: kept?.tile ?? tile, size };
        });
        // Demands, least urgent first: within a priority the loader starts the last listed first.
        const demands = [];
        for (const tile of near)
            if (!mountedIds.has(tile.id))
                demands.push({ src: sourceFor(tile, 'thumb'), priority: 'prefetch' });
        const onScreen = [];
        for (const entry of next) {
            if (boundsIntersect(entry.tile.detailRect, view))
                onScreen.push(entry);
            else
                demands.push({ src: sourceFor(entry.tile, entry.size), priority: 'near' });
        }
        onScreen.sort((a, b) => distance(b.tile) - distance(a.tile));
        // What each tile shows meanwhile (smaller or sharper than it wants), kept asked for so the
        // cache doesn't evict it from under it.
        // That includes the best loaded one still getting its element (blob mode), which it'll show next.
        for (const entry of next) {
            const wanted = sourceFor(entry.tile, entry.size);
            const showing = bestReadySource(entry.tile.sources, entry.size, (src) => loader.isRenderable(src));
            const loaded = bestReadySource(entry.tile.sources, entry.size, (src) => loader.get(src) !== undefined);
            if (showing && showing.src !== wanted)
                demands.push({ src: showing.src, priority: 'prefetch' });
            if (loaded && loaded.src !== wanted && loaded.src !== showing?.src)
                demands.push({ src: loaded.src, priority: 'prefetch' });
        }
        for (const entry of onScreen)
            demands.push({ src: sourceFor(entry.tile, entry.size), priority: 'visible' });
        channel.demand(demands);
        state.demands = demands;
        state.demanded = new Set(demands.map((demand) => demand.src));
        // Every size a mounted tile could fall back to, so a ready one re-renders it.
        const users = new Map();
        for (const entry of next) {
            // Every size `bestReadySource` may pick, `original` included.
            for (const key of SOURCE_KEYS) {
                const src = sourceFor(entry.tile, key);
                const list = users.get(src);
                if (!list)
                    users.set(src, [entry]);
                else if (!list.includes(entry))
                    list.push(entry);
            }
        }
        // Elements for the size each tile wants, and for the best size already loaded, which it shows
        // meanwhile (an image loaded earlier, e.g. a thumbnail warmed ahead, has none yet in blob mode).
        const elements = [];
        for (const entry of next) {
            elements.push(sourceFor(entry.tile, entry.size));
            const cached = bestReadySource(entry.tile.sources, entry.size, (src) => loader.get(src) !== undefined);
            if (cached)
                elements.push(cached.src);
        }
        loader.prepareElements(elements);
        state.bounds = truncated ? view : mountBounds;
        state.truncatedAt = truncated ? performance.now() : 0;
        state.zoom = camera.zoom;
        state.queried = { ...camera, ...viewport };
        state.scene = scene;
        state.users = users;
        // Forget what unmounted tiles showed.
        for (const id of state.rendered.keys())
            if (!mountedIds.has(id))
                state.rendered.delete(id);
        // The same tiles at the same sizes: nothing to re-render.
        if (next.length === state.tiles.length && next.every((entry, i) => entry === state.tiles[i]))
            return;
        state.tiles = next;
        setTiles(next);
    }, [channel, dprCap, loader, maxTiles, mountOverscan, preloadMargin, scene]);
    live.current.update = update;
    useEffect(() => () => cancelAnimationFrame(live.current.more), []);
    const clear = useCallback(() => {
        const state = live.current;
        cancelAnimationFrame(state.more);
        state.more = 0;
        if (!state.bounds && !state.tiles.length)
            return;
        state.bounds = null;
        state.tiles = [];
        state.users = new Map();
        state.demands = [];
        state.demanded = new Set();
        channel.demand([]);
        setTiles([]);
    }, [channel]);
    const shown = useCallback((mounted) => bestShown(loader, mounted), [loader]);
    /** Called once tiles commit: what each showed, so image arrivals re-render only on a change. */
    const noteRendered = useCallback((tiles, urls) => {
        const rendered = live.current.rendered;
        tiles.forEach((entry, i) => rendered.set(entry.tile.id, urls[i]));
    }, []);
    // Counted against every tile in the Visible Window, mounted or not: a tile missing from the
    // mounted set (cut by `maxTiles`, or not mounted yet) is blank.
    const stats = useCallback((camera, viewport) => {
        const mounted = new Map(live.current.tiles.map((entry) => [entry.tile.id, entry]));
        const onScreen = queryWrappedPhotoScene(scene, camera, viewport, 'detail', { overscanScreenPx: 0 });
        let filledTiles = 0;
        let sharpTiles = 0;
        for (const tile of onScreen) {
            const entry = mounted.get(tile.id);
            const image = entry && bestShown(loader, entry);
            if (image)
                filledTiles++;
            if (image?.sharp)
                sharpTiles++;
        }
        return { visibleTiles: onScreen.length, filledTiles, sharpTiles };
    }, [loader, scene]);
    return { tiles, imagesVersion, update, clear, shown, stats, noteRendered };
}
/** Extra hit area around `GallyCanvas` tiles, so hover doesn't flicker in the gaps. */
const TILE_HIT_PAD = 16;
/** The mounted tiles. Each re-renders only when its image or selection changes. */
export function PhotoTiles({ window, variant, selectedPhotoId, spotlightPhotoId, onSelect }) {
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;
    const select = useCallback((tile) => onSelectRef.current?.(tile), []);
    const urls = window.tiles.map((mounted) => window.shown(mounted)?.url);
    // Noted once committed, so image arrivals compare against what's actually on screen.
    const { noteRendered, tiles } = window;
    useLayoutEffect(() => noteRendered(tiles, urls));
    return (_jsx(_Fragment, { children: window.tiles.map((mounted, i) => {
            const tile = mounted.tile;
            return (_jsx(PhotoTile, { tile: tile, url: urls[i], variant: variant, selected: tile.baseId === selectedPhotoId, spotlight: tile.baseId === spotlightPhotoId, onSelect: select }, tile.id));
        }) }));
}
const PhotoTile = memo(function PhotoTile({ tile, url, variant, selected, spotlight, onSelect, }) {
    const rect = tile.detailRect;
    const image = url ? (
    // eslint-disable-next-line @next/next/no-img-element -- Gally is framework-neutral.
    _jsx("img", { src: url, alt: tile.alt ?? '', draggable: false, decoding: "async" })) : null;
    if (variant === 'hybrid') {
        return (_jsx("button", { type: "button", className: "gally-hybrid__detail-tile", style: { left: rect.x, top: rect.y, width: rect.width, height: rect.height }, "aria-label": tile.alt ?? '', "data-gally-tile-id": tile.id, "data-gally-selected": selected ? '1' : undefined, "data-gally-spotlight-selected": spotlight ? '1' : undefined, onClick: () => onSelect(tile), children: image }));
    }
    return (_jsx("button", { type: "button", className: "gally__tile", "data-gally-tile": "", "data-gally-tile-id": tile.id, "data-gally-index": tile.index, "data-gally-revealed": url ? '1' : undefined, "aria-label": tile.alt ?? '', style: {
            left: rect.x - TILE_HIT_PAD,
            top: rect.y - TILE_HIT_PAD,
            width: rect.width + TILE_HIT_PAD * 2,
            height: rect.height + TILE_HIT_PAD * 2,
            padding: TILE_HIT_PAD,
        }, onClick: () => onSelect(tile), children: _jsx("span", { className: "gally__frame", children: image }) }));
});
//# sourceMappingURL=photo-tile-layer.js.map