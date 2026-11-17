import { type ForwardedRef, type Ref } from 'react';
import type { GallyImageLoader } from '../image-loader.js';
import { type GallyHybridLayoutOptions } from '../scene/photo-scene.js';
import type { GallyCanvasHandle, GallyCanvasPhoto, GallyCanvasSelection, GallyCanvasTheme } from './types.js';
export type GallyHybridMode = 'overview' | 'transition' | 'detail';
export type GallyHybridCanvasProps<Metadata = unknown> = {
    photos: Array<GallyCanvasPhoto<Metadata>>;
    className?: string;
    theme?: GallyCanvasTheme;
    layout?: Partial<GallyHybridLayoutOptions>;
    minZoom?: number;
    maxZoom?: number;
    zoomStep?: number;
    overviewZoom?: number;
    detailZoom?: number;
    overviewOverscan?: number;
    detailOverscan?: number;
    detailMaxTiles?: number;
    dprCap?: number;
    /**
     * Share one image loader (and its cache) with other Gally components. By default canvases
     * share one blob-mode loader: images fetch and decode in a worker, and images from hosts
     * without CORS load as plain image elements.
     */
    loader?: GallyImageLoader;
    showControls?: boolean;
    onSelectPhoto?: (selection: GallyCanvasSelection<Metadata>) => void;
    onModeChange?: (mode: GallyHybridMode) => void;
};
declare function GallyHybridCanvasInner<Metadata = unknown>({ photos, className, theme, layout: layoutOptions, minZoom, maxZoom, zoomStep, overviewZoom, detailZoom, overviewOverscan, detailOverscan, detailMaxTiles, dprCap, loader: sharedLoader, showControls, onSelectPhoto, onModeChange, }: GallyHybridCanvasProps<Metadata>, ref: ForwardedRef<GallyCanvasHandle>): import("react/jsx-runtime").JSX.Element;
export declare const GallyHybridCanvas: <Metadata = unknown>(props: GallyHybridCanvasProps<Metadata> & {
    ref?: Ref<GallyCanvasHandle>;
}) => ReturnType<typeof GallyHybridCanvasInner>;
export {};
//# sourceMappingURL=GallyHybridCanvas.d.ts.map