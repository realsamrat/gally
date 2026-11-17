'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Minus, Plus } from './icons.js';
import { clampZoom, panCamera, placeWorldPointAt, zoomCameraAtPoint } from '../camera.js';
import { boundsContainPoint, boundsIntersect, getViewportWorldBounds, makeBounds, screenToWorld } from '../geometry.js';
import { defaultCanvasLoader } from './default-loader.js';
import { CanvasOverviewRenderer } from '../renderers/canvas-overview-renderer.js';
import { PhotoTiles, sourceFor, usePhotoTileWindow } from './photo-tile-layer.js';
import { useCameraGestures } from './use-camera-gestures.js';
import { buildPhotoScene, defaultHybridLayoutOptions, detailRowPeriodX, queryWrappedPhotoScene, } from '../scene/photo-scene.js';
const DEFAULT_CAMERA = { x: 0, y: 0, zoom: 1 };
const DEFAULT_VIEWPORT = { width: 1, height: 1 };
const DETAIL_UPDATE_INTERVAL_MS = 120;
const PAN_END_DELAY_MS = 120;
const ZOOM_SETTLE_MS = 360;
const FOCUS_DISSOLVE_MS = 620;
const LAYER_BLEND_MS = 280;
const OVERVIEW_ZOOM_RENDER_INTERVAL_MS = 48;
/** Background showing at an edge of the moved overview picture, in px, before it redraws early. */
const OVERVIEW_EDGE_GAP_PX = 12;
/** A hidden overview readied as the camera nears it redraws at most this often. */
const HIDDEN_OVERVIEW_RENDER_INTERVAL_MS = 120;
function GallyHybridCanvasInner({ photos, className, theme = { background: 'plain' }, layout: layoutOptions, minZoom = 0.22, maxZoom = 2.5, zoomStep = 1.2, overviewZoom = 0.56, detailZoom = 0.72, overviewOverscan = 900, detailOverscan = 720, detailMaxTiles = 96, dprCap = 2, loader: sharedLoader, showControls = true, onSelectPhoto, onModeChange, }, ref) {
    'use no memo';
    const shellRef = useRef(null);
    const canvasRef = useRef(null);
    const detailLayerRef = useRef(null);
    const rendererRef = useRef(null);
    const rafRef = useRef(null);
    const scheduleApplyRef = useRef(() => { });
    const applyNowRef = useRef(() => { });
    const updateDetailTilesRef = useRef(() => { });
    // One loader for both layers: overview thumbnails and detail images share its decoded cache.
    const loader = sharedLoader ?? defaultCanvasLoader();
    const currentLoaderRef = useRef(loader);
    currentLoaderRef.current = loader;
    const overviewRenderKeyRef = useRef('');
    const lastOverviewRenderAtRef = useRef(0);
    const cameraRef = useRef({ ...DEFAULT_CAMERA });
    /** Styles `apply` last wrote, so it writes only changes. */
    const writtenRef = useRef({ detailAlpha: -1, overviewAlpha: -1, pointerEvents: '', mode: '', canvasTransform: '' });
    const trailingRenderRef = useRef(undefined);
    /** Where the running focus dissolve takes the camera. */
    const focusTargetRef = useRef({ ...DEFAULT_CAMERA });
    /** The camera the overview canvas was last drawn at. */
    const drawnCameraRef = useRef({ ...DEFAULT_CAMERA });
    const viewportRef = useRef({ ...DEFAULT_VIEWPORT });
    const modeRef = useRef('detail');
    const panEndRef = useRef(null);
    const zoomEndRef = useRef(null);
    const spotlightEndRef = useRef(null);
    const zoomSettleFrameRef = useRef(null);
    const layerBlendFrameRef = useRef(null);
    const layerBlendTargetRef = useRef('detail');
    const layerBlendRef = useRef({
        detailAlpha: 1,
        overviewAlpha: 0,
        mode: 'detail',
    });
    const hoverOverviewTileIdRef = useRef(null);
    const focusTransitionRef = useRef({
        active: false,
        detailAlpha: 1,
        overviewAlpha: 0,
    });
    const [selectedPhotoId, setSelectedPhotoId] = useState(null);
    const [spotlightPhotoId, setSpotlightPhotoId] = useState(null);
    // Memoized on the values, so a `layout` object written inline doesn't rebuild the scene (and
    // everything drawn from it) on every parent render.
    const { detailRowHeight, detailRowGap, detailColumnGap, detailRowCount, overviewTileSize, overviewGap, overviewColumns, seed } = {
        ...defaultHybridLayoutOptions,
        ...layoutOptions,
    };
    const scene = useMemo(() => buildPhotoScene(photos, {
        detailRowHeight,
        detailRowGap,
        detailColumnGap,
        detailRowCount,
        overviewTileSize,
        overviewGap,
        ...(overviewColumns !== undefined && { overviewColumns }),
        seed,
    }), [photos, detailRowHeight, detailRowGap, detailColumnGap, detailRowCount, overviewTileSize, overviewGap, overviewColumns, seed]);
    // Overview thumbnails are drawn at most this big: a tile at the zoom where the detail layer takes over.
    const bitmapEdge = Math.ceil((scene.tiles[0]?.overviewRect.width ?? 112) * detailZoom * Math.max(1, Math.min(dprCap, globalThis.devicePixelRatio || 1)));
    const detail = usePhotoTileWindow(scene, loader, {
        mountOverscan: detailOverscan,
        preloadMargin: detailOverscan,
        maxTiles: detailMaxTiles,
        dprCap,
    });
    const detailRef = useRef(detail);
    detailRef.current = detail;
    const sceneRef = useRef(scene);
    sceneRef.current = scene;
    useImperativeHandle(ref, () => {
        const overviewShowing = () => (focusTransitionRef.current.active ? focusTransitionRef.current.overviewAlpha : layerBlendRef.current.overviewAlpha) >= 0.5;
        return {
            getElement: () => shellRef.current,
            getStats: () => {
                const zoom = cameraRef.current.zoom;
                if (overviewShowing()) {
                    const drawn = rendererRef.current?.getStats() ?? { visibleTiles: 0, filledTiles: 0, sharpTiles: 0 };
                    return { zoom, layer: 'canvas', ...drawn, loader: currentLoaderRef.current.getStats() };
                }
                return { zoom, layer: 'dom', ...detailRef.current.stats(cameraRef.current, viewportRef.current), loader: currentLoaderRef.current.getStats() };
            },
            getVisibleSources: () => overviewShowing()
                ? queryWrappedPhotoScene(sceneRef.current, cameraRef.current, viewportRef.current, 'overview', { overscanScreenPx: 0 }).map((tile) => tile.sources.thumb)
                : detailRef.current.tiles
                    .filter(({ tile }) => boundsIntersect(tile.detailRect, getViewportWorldBounds(cameraRef.current, viewportRef.current)))
                    .map(({ tile, size }) => sourceFor(tile, size)),
        };
    }, []);
    // In a ref, so an inline callback doesn't rebuild everything that depends on `setMode`.
    const onModeChangeRef = useRef(onModeChange);
    onModeChangeRef.current = onModeChange;
    const setMode = useCallback((mode) => {
        if (modeRef.current === mode)
            return;
        modeRef.current = mode;
        onModeChangeRef.current?.(mode);
    }, []);
    const getLayerTarget = useCallback(() => {
        const zoom = cameraRef.current.zoom;
        const switchZoom = overviewZoom + (detailZoom - overviewZoom) * 0.5;
        return zoom <= switchZoom ? 'overview' : 'detail';
    }, [detailZoom, overviewZoom]);
    const setLayerTarget = useCallback((target) => {
        if (layerBlendTargetRef.current === target)
            return;
        layerBlendTargetRef.current = target;
        if (layerBlendFrameRef.current !== null) {
            cancelAnimationFrame(layerBlendFrameRef.current);
            layerBlendFrameRef.current = null;
        }
        const startDetailAlpha = layerBlendRef.current.detailAlpha;
        const startOverviewAlpha = layerBlendRef.current.overviewAlpha;
        const endDetailAlpha = target === 'detail' ? 1 : 0;
        const endOverviewAlpha = target === 'overview' ? 1 : 0;
        let startedAt = 0;
        const tick = () => {
            // A newer blend (the pinch reversed) took over: this one stops.
            if (layerBlendTargetRef.current !== target)
                return;
            const progress = easeInOutQuad(clamp((performance.now() - startedAt) / LAYER_BLEND_MS, 0, 1));
            const detailAlpha = startDetailAlpha + (endDetailAlpha - startDetailAlpha) * progress;
            const overviewAlpha = startOverviewAlpha + (endOverviewAlpha - startOverviewAlpha) * progress;
            layerBlendRef.current = {
                detailAlpha,
                overviewAlpha,
                mode: progress >= 1 ? target : 'transition',
            };
            applyNowRef.current(progress >= 1);
            // Applying can reverse the target and start a newer blend, which owns the frame handle now.
            if (layerBlendTargetRef.current !== target)
                return;
            if (progress < 1) {
                layerBlendFrameRef.current = requestAnimationFrame(tick);
            }
            else {
                layerBlendFrameRef.current = null;
            }
        };
        layerBlendRef.current = {
            ...layerBlendRef.current,
            mode: 'transition',
        };
        const startBlend = () => {
            startedAt = performance.now();
            tick();
        };
        if (target === 'detail') {
            updateDetailTilesRef.current(true);
            layerBlendFrameRef.current = requestAnimationFrame(() => {
                layerBlendFrameRef.current = requestAnimationFrame(startBlend);
            });
        }
        else {
            layerBlendFrameRef.current = requestAnimationFrame(startBlend);
        }
    }, []);
    const updateDetail = detail.update;
    const clearDetail = detail.clear;
    /** Mount the detail tiles around `camera`, or none once the detail layer has faded out. */
    const updateDetailTiles = useCallback((force = false, camera = cameraRef.current) => {
        // Faded out and staying out, forced or not (a focus dissolve mounts its target's tiles while
        // detail is hidden). A blend towards detail keeps what it mounted while it starts.
        if (layerBlendTargetRef.current === 'overview' && layerBlendRef.current.detailAlpha <= 0.02 && !focusTransitionRef.current.active) {
            clearDetail();
            return;
        }
        updateDetail(camera, viewportRef.current, force);
    }, [clearDetail, updateDetail]);
    useEffect(() => {
        updateDetailTilesRef.current = updateDetailTiles;
    }, [updateDetailTiles]);
    /** Load and pre-draw the overview around the camera while it's hidden, so switching to it is instant. */
    const warmupOverview = useCallback(() => {
        const renderer = rendererRef.current;
        const viewport = viewportRef.current;
        if (!renderer || viewport.width <= 1 || viewport.height <= 1)
            return;
        const camera = cameraRef.current;
        const center = screenToWorld({ x: viewport.width / 2, y: viewport.height / 2 }, camera);
        const warmCamera = placeWorldPointAt(center, { x: viewport.width / 2, y: viewport.height / 2 }, overviewZoom);
        // Thumbnails only: the overview draws itself as the camera nears it (see `apply`).
        renderer.warmup({
            camera: warmCamera,
            viewport,
            overscanScreenPx: overviewOverscan,
        });
    }, [overviewOverscan, overviewZoom]);
    const primeOverviewWhenIdle = useCallback(() => {
        const shell = shellRef.current;
        if (!shell)
            return;
        if (focusTransitionRef.current.active)
            return;
        if (layerBlendTargetRef.current !== 'detail')
            return;
        if (shell.classList.contains('gally-hybrid--panning') ||
            shell.classList.contains('gally-hybrid--zooming')) {
            return;
        }
        warmupOverview();
    }, [warmupOverview]);
    const apply = useCallback((forceDetailUpdate = false) => {
        const shell = shellRef.current;
        const detailLayer = detailLayerRef.current;
        const renderer = rendererRef.current;
        if (!shell || !detailLayer || !renderer)
            return;
        const camera = cameraRef.current;
        const viewport = viewportRef.current;
        const focusTransition = focusTransitionRef.current;
        if (!focusTransition.active)
            setLayerTarget(getLayerTarget());
        const layer = layerBlendRef.current;
        const detailAlpha = focusTransition.active ? focusTransition.detailAlpha : layer.detailAlpha;
        const overviewAlpha = focusTransition.active ? focusTransition.overviewAlpha : layer.overviewAlpha;
        const mode = focusTransition.active
            ? detailAlpha >= 0.999
                ? 'detail'
                : 'transition'
            : layer.mode;
        const detailTransform = `translate3d(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px, 0) scale(${camera.zoom})`;
        detailLayer.style.transform = detailTransform;
        // Only what changed: a custom property set on the shell restyles every tile under it.
        const written = writtenRef.current;
        if (written.detailAlpha !== detailAlpha) {
            written.detailAlpha = detailAlpha;
            detailLayer.style.opacity = String(detailAlpha);
            // Hidden, it isn't painted or rasterized at all (scaled far down, its raster is vast).
            detailLayer.style.visibility = detailAlpha > 0 ? '' : 'hidden';
            shell.style.setProperty('--gally-hybrid-detail-opacity', String(detailAlpha));
        }
        if (written.overviewAlpha !== overviewAlpha) {
            written.overviewAlpha = overviewAlpha;
            shell.style.setProperty('--gally-hybrid-overview-opacity', String(overviewAlpha));
        }
        // Tiles take clicks once mostly shown, but not mid-flight in a focus dissolve.
        const pointerEvents = detailAlpha > 0.76 && !focusTransition.active ? 'auto' : 'none';
        if (written.pointerEvents !== pointerEvents) {
            written.pointerEvents = pointerEvents;
            detailLayer.style.pointerEvents = pointerEvents;
        }
        if (written.mode !== mode) {
            written.mode = mode;
            shell.dataset.gallyHybridMode = mode;
        }
        setMode(mode);
        if (mode === 'detail' && hoverOverviewTileIdRef.current !== null) {
            hoverOverviewTileIdRef.current = null;
            renderer.setHighlightedTileId(null);
            overviewRenderKeyRef.current = '';
            shell.style.cursor = '';
        }
        const overviewRenderKey = makeOverviewRenderKey(camera, viewport, overviewOverscan);
        const shouldPrepareOverview = overviewAlpha > 0.01 || (!focusTransition.active && camera.zoom < detailZoom + 0.2);
        const isZooming = shell.classList.contains('gally-hybrid--zooming');
        // Redraws while zooming, and of a hidden overview being readied, are spaced out; between
        // them the canvas is moved to match the camera (below), so it still follows every frame.
        const minRenderInterval = overviewAlpha <= 0.01 ? HIDDEN_OVERVIEW_RENDER_INTERVAL_MS : isZooming ? OVERVIEW_ZOOM_RENDER_INTERVAL_MS : 0;
        const now = performance.now();
        // A visible overview redraws at once for new images, or once the last picture, moved to this
        // camera, no longer covers the screen; a hidden one keeps to its interval.
        const sinceDrawn = now - lastOverviewRenderAtRef.current;
        const drawnAt = drawnCameraRef.current;
        const k = camera.zoom / drawnAt.zoom;
        const left = (drawnAt.x - camera.x) * camera.zoom;
        const top = (drawnAt.y - camera.y) * camera.zoom;
        const gap = OVERVIEW_EDGE_GAP_PX;
        const uncovered = left > gap || top > gap || left + viewport.width * k < viewport.width - gap || top + viewport.height * k < viewport.height - gap;
        const canRender = minRenderInterval === 0 ||
            sinceDrawn >= minRenderInterval ||
            (overviewAlpha > 0.01 && (overviewRenderKeyRef.current === '' || uncovered));
        if (shouldPrepareOverview && overviewRenderKeyRef.current !== overviewRenderKey && !canRender && !trailingRenderRef.current) {
            // Skipped: draw once the interval is up, in case nothing else asks.
            trailingRenderRef.current = setTimeout(() => {
                trailingRenderRef.current = undefined;
                scheduleApplyRef.current();
            }, Math.ceil(minRenderInterval - sinceDrawn));
        }
        if (shouldPrepareOverview && overviewRenderKeyRef.current !== overviewRenderKey && canRender) {
            renderer.render({
                camera,
                viewport,
                overscanScreenPx: overviewOverscan,
                priority: overviewAlpha > 0.01 ? 'visible' : 'near',
            });
            overviewRenderKeyRef.current = overviewRenderKey;
            lastOverviewRenderAtRef.current = now;
            drawnCameraRef.current = { ...camera };
            clearTimeout(trailingRenderRef.current);
            trailingRenderRef.current = undefined;
        }
        const drawn = drawnCameraRef.current;
        const canvas = canvasRef.current;
        if (canvas) {
            // The drawn picture, scaled and moved from the camera it was drawn at to this one.
            const k = camera.zoom / drawn.zoom;
            const transform = k === 1 && drawn.x === camera.x && drawn.y === camera.y
                ? ''
                : `matrix(${k}, 0, 0, ${k}, ${(drawn.x - camera.x) * camera.zoom}, ${(drawn.y - camera.y) * camera.zoom})`;
            if (written.canvasTransform !== transform) {
                written.canvasTransform = transform;
                canvas.style.transform = transform;
            }
        }
        if (!focusTransition.active)
            updateDetailTiles(forceDetailUpdate);
    }, [detailZoom, getLayerTarget, overviewOverscan, setLayerTarget, setMode, updateDetailTiles]);
    /** A forced detail update asked for before the frame runs, even by a call that found it queued. */
    const forceDetailRef = useRef(false);
    const scheduleApply = useCallback((forceDetailUpdate = false) => {
        forceDetailRef.current ||= forceDetailUpdate;
        if (rafRef.current !== null)
            return;
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            const force = forceDetailRef.current;
            forceDetailRef.current = false;
            apply(force);
        });
    }, [apply]);
    /**
     * Apply in this frame, from animations that run in frame callbacks: scheduling would land a frame
     * late. Takes over any apply already scheduled.
     */
    const applyNow = useCallback((forceDetailUpdate = false) => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        const force = forceDetailRef.current || forceDetailUpdate;
        forceDetailRef.current = false;
        apply(force);
    }, [apply]);
    useEffect(() => {
        scheduleApplyRef.current = scheduleApply;
        applyNowRef.current = applyNow;
    }, [applyNow, scheduleApply]);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        // A new renderer draws from scratch, wherever the camera is.
        overviewRenderKeyRef.current = '';
        const renderer = new CanvasOverviewRenderer(canvas, scene, {
            dprCap,
            loader,
            bitmapEdge,
            overscanScreenPx: overviewOverscan,
            onInvalidate: () => {
                overviewRenderKeyRef.current = '';
                // Redraw only an overview that's showing or about to (see `shouldPrepareOverview` in
                // `apply`); a hidden one redraws when the camera nears it.
                const camera = cameraRef.current;
                if (layerBlendRef.current.overviewAlpha > 0.01 || focusTransitionRef.current.active || camera.zoom < detailZoom + 0.2)
                    scheduleApply();
            },
        });
        rendererRef.current = renderer;
        // Keep the photo highlighted under the pointer (or just tapped) across a rebuild.
        renderer.setHighlightedTileId(hoverOverviewTileIdRef.current);
        scheduleApply(true);
        const warmupFrame = requestAnimationFrame(() => warmupOverview());
        return () => {
            cancelAnimationFrame(warmupFrame);
            renderer.destroy();
            if (rendererRef.current === renderer)
                rendererRef.current = null;
        };
    }, [dprCap, loader, overviewOverscan, scheduleApply, warmupOverview, bitmapEdge, detailZoom]);
    useEffect(() => {
        rendererRef.current?.setScene(scene);
        overviewRenderKeyRef.current = '';
        updateDetailTiles(true);
        scheduleApply(true);
    }, [scene, scheduleApply, updateDetailTiles]);
    useEffect(() => {
        const shell = shellRef.current;
        if (!shell)
            return;
        const resize = () => {
            const rect = shell.getBoundingClientRect();
            viewportRef.current = {
                width: Math.max(1, rect.width),
                height: Math.max(1, rect.height),
            };
            scheduleApply(true);
            requestAnimationFrame(() => warmupOverview());
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(shell);
        return () => observer.disconnect();
    }, [scheduleApply, warmupOverview]);
    useEffect(() => {
        return () => {
            // Cancel and forget, so a remount (StrictMode replays effects) can schedule frames again.
            if (rafRef.current !== null)
                cancelAnimationFrame(rafRef.current);
            if (zoomSettleFrameRef.current !== null)
                cancelAnimationFrame(zoomSettleFrameRef.current);
            if (layerBlendFrameRef.current !== null)
                cancelAnimationFrame(layerBlendFrameRef.current);
            rafRef.current = null;
            zoomSettleFrameRef.current = null;
            layerBlendFrameRef.current = null;
            // Animations cut short end where they were going, or the remounted canvas would be stuck in
            // them: a focus dissolve blocks gestures, and a blend half way leaves both layers half shown.
            if (focusTransitionRef.current.active) {
                // Where the dissolve was going, not half way: half way could be overview zoom.
                Object.assign(cameraRef.current, focusTargetRef.current);
                focusTransitionRef.current = { active: false, detailAlpha: 1, overviewAlpha: 0 };
                layerBlendTargetRef.current = 'detail';
                layerBlendRef.current = { detailAlpha: 1, overviewAlpha: 0, mode: 'detail' };
            }
            else if (layerBlendRef.current.mode === 'transition') {
                const target = layerBlendTargetRef.current;
                layerBlendRef.current = { detailAlpha: target === 'detail' ? 1 : 0, overviewAlpha: target === 'overview' ? 1 : 0, mode: target };
            }
            shellRef.current?.classList.remove('gally-hybrid--zooming', 'gally-hybrid--panning', 'gally-hybrid--spotlight');
            setSpotlightPhotoId(null);
            if (panEndRef.current)
                clearTimeout(panEndRef.current);
            if (zoomEndRef.current)
                clearTimeout(zoomEndRef.current);
            if (spotlightEndRef.current)
                clearTimeout(spotlightEndRef.current);
            clearTimeout(trailingRenderRef.current);
            trailingRenderRef.current = undefined;
        };
    }, []);
    const showSpotlight = useCallback((photoId) => {
        const shell = shellRef.current;
        if (!shell)
            return;
        setSpotlightPhotoId(photoId);
        shellRef.current?.classList.add('gally-hybrid--spotlight');
        if (spotlightEndRef.current)
            clearTimeout(spotlightEndRef.current);
        spotlightEndRef.current = setTimeout(() => {
            setSpotlightPhotoId(null);
            shellRef.current?.classList.remove('gally-hybrid--spotlight');
        }, 1000);
    }, []);
    const markPanning = useCallback(() => {
        const shell = shellRef.current;
        if (!shell)
            return;
        shell.classList.add('gally-hybrid--panning');
        if (panEndRef.current)
            clearTimeout(panEndRef.current);
        panEndRef.current = setTimeout(() => {
            shell.classList.remove('gally-hybrid--panning');
            primeOverviewWhenIdle();
        }, PAN_END_DELAY_MS);
    }, [primeOverviewWhenIdle]);
    const markZooming = useCallback(() => {
        const shell = shellRef.current;
        if (!shell)
            return;
        shell.classList.add('gally-hybrid--zooming');
        if (zoomEndRef.current)
            clearTimeout(zoomEndRef.current);
        zoomEndRef.current = setTimeout(() => {
            shell.classList.remove('gally-hybrid--zooming');
            // While zooming the overview redraws at most every 48 ms, so the last frames of a pinch can
            // be skipped: draw where the camera settled.
            scheduleApplyRef.current();
            primeOverviewWhenIdle();
        }, PAN_END_DELAY_MS);
    }, [primeOverviewWhenIdle]);
    const animateZoomTo = useCallback((point, targetZoom) => {
        // A focus dissolve owns the camera until it ends; cancelling its frames would strand it.
        if (focusTransitionRef.current.active)
            return;
        if (zoomEndRef.current)
            clearTimeout(zoomEndRef.current);
        zoomEndRef.current = null;
        if (zoomSettleFrameRef.current !== null) {
            cancelAnimationFrame(zoomSettleFrameRef.current);
            zoomSettleFrameRef.current = null;
        }
        shellRef.current?.classList.add('gally-hybrid--zooming');
        const startCamera = { ...cameraRef.current };
        const startZoom = startCamera.zoom;
        const clampedTarget = clampZoom(targetZoom, { minZoom, maxZoom });
        const world = screenToWorld(point, startCamera);
        const startedAt = performance.now();
        const tick = () => {
            const elapsed = performance.now() - startedAt;
            const progress = easeInOutQuad(clamp(elapsed / ZOOM_SETTLE_MS, 0, 1));
            const nextZoom = startZoom + (clampedTarget - startZoom) * progress;
            Object.assign(cameraRef.current, placeWorldPointAt(world, point, nextZoom));
            // The last frame draws unthrottled, at the camera where it settles.
            if (progress >= 1)
                shellRef.current?.classList.remove('gally-hybrid--zooming');
            applyNow();
            if (progress < 1) {
                zoomSettleFrameRef.current = requestAnimationFrame(tick);
            }
            else {
                zoomSettleFrameRef.current = null;
                updateDetailTiles(true);
            }
        };
        zoomSettleFrameRef.current = requestAnimationFrame(tick);
    }, [applyNow, maxZoom, minZoom, scheduleApply, updateDetailTiles]);
    const dissolveToCamera = useCallback((targetCamera, onComplete) => {
        // A gesture's zoom-end timer mustn't clear the zooming state mid-flight.
        if (zoomEndRef.current)
            clearTimeout(zoomEndRef.current);
        zoomEndRef.current = null;
        if (zoomSettleFrameRef.current !== null) {
            cancelAnimationFrame(zoomSettleFrameRef.current);
            zoomSettleFrameRef.current = null;
        }
        if (layerBlendFrameRef.current !== null) {
            cancelAnimationFrame(layerBlendFrameRef.current);
            layerBlendFrameRef.current = null;
        }
        layerBlendTargetRef.current = 'overview';
        layerBlendRef.current = {
            detailAlpha: 0,
            overviewAlpha: 1,
            mode: 'overview',
        };
        shellRef.current?.classList.add('gally-hybrid--zooming');
        const startCamera = { ...cameraRef.current };
        const target = {
            x: targetCamera.x,
            y: targetCamera.y,
            zoom: clampZoom(targetCamera.zoom, { minZoom, maxZoom }),
        };
        focusTargetRef.current = target;
        focusTransitionRef.current = {
            active: true,
            detailAlpha: 0,
            overviewAlpha: 1,
        };
        updateDetailTiles(true, target);
        let startedAt = 0;
        const tick = () => {
            const elapsed = performance.now() - startedAt;
            const progress = easeInOutQuad(clamp(elapsed / FOCUS_DISSOLVE_MS, 0, 1));
            const dissolveProgress = easeInOutQuad(clamp((progress - 0.64) / 0.36, 0, 1));
            cameraRef.current.x = startCamera.x + (target.x - startCamera.x) * progress;
            cameraRef.current.y = startCamera.y + (target.y - startCamera.y) * progress;
            cameraRef.current.zoom = startCamera.zoom + (target.zoom - startCamera.zoom) * progress;
            focusTransitionRef.current.detailAlpha = dissolveProgress;
            focusTransitionRef.current.overviewAlpha = 1 - dissolveProgress;
            applyNow();
            if (progress < 1) {
                zoomSettleFrameRef.current = requestAnimationFrame(tick);
            }
            else {
                zoomSettleFrameRef.current = null;
                layerBlendTargetRef.current = 'detail';
                layerBlendRef.current = {
                    detailAlpha: 1,
                    overviewAlpha: 0,
                    mode: 'detail',
                };
                focusTransitionRef.current = {
                    active: false,
                    detailAlpha: 1,
                    overviewAlpha: 0,
                };
                shellRef.current?.classList.remove('gally-hybrid--zooming');
                updateDetailTiles(true);
                onComplete?.();
                scheduleApply(true);
            }
        };
        const startAnimation = () => {
            startedAt = performance.now();
            zoomSettleFrameRef.current = requestAnimationFrame(tick);
        };
        zoomSettleFrameRef.current = requestAnimationFrame(() => {
            zoomSettleFrameRef.current = requestAnimationFrame(startAnimation);
        });
    }, [applyNow, maxZoom, minZoom, scheduleApply, updateDetailTiles]);
    const updateOverviewHover = useCallback((point) => {
        const shell = shellRef.current;
        const renderer = rendererRef.current;
        if (!shell || !renderer)
            return;
        const tile = findOverviewTileAtPoint(scene, cameraRef.current, viewportRef.current, point);
        const nextTileId = tile?.id ?? null;
        if (hoverOverviewTileIdRef.current === nextTileId)
            return;
        hoverOverviewTileIdRef.current = nextTileId;
        renderer.setHighlightedTileId(nextTileId);
        overviewRenderKeyRef.current = '';
        shell.style.cursor = nextTileId ? 'pointer' : '';
        scheduleApply();
    }, [scene, scheduleApply]);
    const zoomIntoOverviewTile = useCallback((point) => {
        // Mid-flight the camera is between layouts: a second click would aim at an unrelated photo.
        if (focusTransitionRef.current.active)
            return false;
        const tile = findOverviewTileAtPoint(scene, cameraRef.current, viewportRef.current, point);
        if (!tile)
            return false;
        const targetRect = getNearestDetailRectForOverviewTile(scene, tile);
        if (!targetRect)
            return false;
        const worldPoint = screenToWorld(point, cameraRef.current);
        const relativePoint = {
            x: clamp((worldPoint.x - tile.overviewRect.x) / tile.overviewRect.width, 0, 1),
            y: clamp((worldPoint.y - tile.overviewRect.y) / tile.overviewRect.height, 0, 1),
        };
        const targetWorld = {
            x: targetRect.x + targetRect.width * relativePoint.x,
            y: targetRect.y + targetRect.height * relativePoint.y,
        };
        const targetZoom = Math.max(detailZoom, 1);
        setSelectedPhotoId(tile.baseId);
        // Tracked like a hover, so it's cleared once the detail layer shows (taps have no hover).
        hoverOverviewTileIdRef.current = tile.id;
        rendererRef.current?.setHighlightedTileId(tile.id);
        dissolveToCamera(placeWorldPointAt(targetWorld, point, targetZoom), () => showSpotlight(tile.baseId));
        return true;
    }, [detailZoom, dissolveToCamera, scene, showSpotlight]);
    /** Stop a button zoom (a gesture took over), and the zooming state it set. */
    const stopZoomAnimation = useCallback(() => {
        if (zoomSettleFrameRef.current !== null) {
            cancelAnimationFrame(zoomSettleFrameRef.current);
            zoomSettleFrameRef.current = null;
            shellRef.current?.classList.remove('gally-hybrid--zooming');
        }
    }, []);
    // Pan, pinch, trackpad and wheel, from wherever the gesture starts (detail tiles included);
    // a press that turns into a drag doesn't click the tile it started on.
    useCameraGestures(shellRef, {
        accept: (event) => !event.target?.closest?.('.gally-hybrid__controls'),
        pan: (dx, dy) => {
            if (focusTransitionRef.current.active)
                return;
            stopZoomAnimation();
            Object.assign(cameraRef.current, panCamera(cameraRef.current, { x: dx, y: dy }));
            markPanning();
            scheduleApply();
        },
        zoom: (point, factor) => {
            if (focusTransitionRef.current.active)
                return;
            stopZoomAnimation();
            const camera = cameraRef.current;
            Object.assign(camera, zoomCameraAtPoint(camera, point, camera.zoom * factor, { minZoom, maxZoom }));
            markZooming();
            scheduleApply();
        },
        // Settled: the sizes this zoom wants, if the detail layer is showing (a focus dissolve
        // manages its own tiles).
        end: () => {
            if (!focusTransitionRef.current.active)
                updateDetailTiles(layerBlendRef.current.detailAlpha > 0.02);
        },
    });
    const onSelectDetailTile = useCallback((tile) => {
        if (focusTransitionRef.current.active)
            return;
        onSelectPhoto?.({ id: tile.baseId, index: tile.index, photo: tile.photo });
    }, [onSelectPhoto]);
    const localPoint = (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    // Hovering the overview highlights the photo a click would open.
    const onPointerMove = useCallback((event) => {
        if (event.pointerType !== 'mouse' || event.buttons !== 0 || modeRef.current === 'detail' || focusTransitionRef.current.active)
            return;
        updateOverviewHover(localPoint(event));
    }, [updateOverviewHover]);
    // A click (or tap) on the overview zooms into that photo. Detail tiles handle their own clicks.
    const onClick = useCallback((event) => {
        // Detail tiles (live from late in the blend) and controls handle their own clicks.
        const target = event.target;
        if (modeRef.current === 'detail' || target?.closest?.('.gally-hybrid__controls, .gally-hybrid__detail-tile'))
            return;
        zoomIntoOverviewTile(localPoint(event));
    }, [zoomIntoOverviewTile]);
    const zoomBy = useCallback((factor) => {
        const viewport = viewportRef.current;
        const rawTarget = cameraRef.current.zoom * factor;
        animateZoomTo({ x: viewport.width / 2, y: viewport.height / 2 }, rawTarget);
    }, [animateZoomTo]);
    const themeClass = theme.background === 'dotted'
        ? 'gally-hybrid--dotted'
        : theme.background === 'none'
            ? 'gally-hybrid--none'
            : '';
    return (_jsxs("div", { ref: shellRef, className: ['gally-hybrid', themeClass, className].filter(Boolean).join(' '), style: {
            '--gally-hybrid-background': theme.backgroundColor,
            '--gally-hybrid-dot-color': theme.dotColor,
        }, onPointerMove: onPointerMove, onClick: onClick, onPointerLeave: () => {
            if (hoverOverviewTileIdRef.current === null)
                return;
            hoverOverviewTileIdRef.current = null;
            rendererRef.current?.setHighlightedTileId(null);
            // Redraw without the highlight, though the camera hasn't moved.
            overviewRenderKeyRef.current = '';
            shellRef.current?.style.setProperty('cursor', '');
            scheduleApply();
        }, children: [_jsx("canvas", { ref: canvasRef, className: "gally-hybrid__overview", "aria-hidden": "true" }), _jsx("div", { ref: detailLayerRef, className: "gally-hybrid__detail-layer", children: _jsx(PhotoTiles, { window: detail, variant: "hybrid", selectedPhotoId: selectedPhotoId, spotlightPhotoId: spotlightPhotoId, onSelect: onSelectDetailTile }) }), showControls && (_jsxs("div", { className: "gally-hybrid__controls", children: [_jsx("button", { type: "button", "aria-label": "Zoom in", onClick: () => zoomBy(zoomStep), children: _jsx(Plus, {}) }), _jsx("button", { type: "button", "aria-label": "Zoom out", onClick: () => zoomBy(1 / zoomStep), children: _jsx(Minus, {}) })] }))] }));
}
export const GallyHybridCanvas = forwardRef(GallyHybridCanvasInner);
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function easeInOutQuad(value) {
    return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
}
function makeOverviewRenderKey(camera, viewport, overscanScreenPx) {
    return [
        Math.round(camera.x * 10),
        Math.round(camera.y * 10),
        Math.round(camera.zoom * 1000),
        Math.round(viewport.width),
        Math.round(viewport.height),
        Math.round(overscanScreenPx),
    ].join(':');
}
function findOverviewTileAtPoint(scene, camera, viewport, screenPoint) {
    const worldPoint = screenToWorld(screenPoint, camera);
    const tiles = queryWrappedPhotoScene(scene, camera, viewport, 'overview', { overscanScreenPx: 0 });
    for (let i = tiles.length - 1; i >= 0; i--) {
        const tile = tiles[i];
        if (!tile || !boundsContainPoint(tile.overviewRect, worldPoint))
            continue;
        return tile;
    }
    return null;
}
function getNearestDetailRectForOverviewTile(scene, overviewTile) {
    const baseTile = scene.tiles.find((tile) => tile.index === overviewTile.index);
    if (!baseTile)
        return null;
    const rowPeriodX = detailRowPeriodX(scene, baseTile);
    const overviewCenterX = overviewTile.overviewRect.x + overviewTile.overviewRect.width / 2;
    const overviewCenterY = overviewTile.overviewRect.y + overviewTile.overviewRect.height / 2;
    const baseDetailCenterX = baseTile.detailRect.x + baseTile.detailRect.width / 2;
    const baseDetailCenterY = baseTile.detailRect.y + baseTile.detailRect.height / 2;
    const wrapX = Math.round((overviewCenterX - baseDetailCenterX) / rowPeriodX);
    const wrapY = Math.round((overviewCenterY - baseDetailCenterY) / scene.detailPeriodY);
    return makeBounds(baseTile.detailRect.x + wrapX * rowPeriodX, baseTile.detailRect.y + wrapY * scene.detailPeriodY, baseTile.detailRect.width, baseTile.detailRect.height);
}
//# sourceMappingURL=GallyHybridCanvas.js.map