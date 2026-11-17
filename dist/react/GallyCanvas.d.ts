import { type ForwardedRef, type Ref } from 'react';
import type { GallyImageLoader } from '../image-loader.js';
import { type GallyLayoutOptions } from '../wrapped-layout.js';
import type { GallyCanvasHandle, GallyCanvasPhoto, GallyCanvasSelection, GallyCanvasTheme } from './types.js';
export type GallyCanvasProps<Metadata = unknown> = {
    photos: Array<GallyCanvasPhoto<Metadata>>;
    className?: string;
    theme?: GallyCanvasTheme;
    /** Row layout. `horizontalCopies` and `verticalCopies` are ignored: the layout wraps forever. */
    layout?: Partial<GallyLayoutOptions>;
    minZoom?: number;
    maxZoom?: number;
    zoomStep?: number;
    /** Screen pixels around the viewport whose thumbnails load ahead of panning. */
    preloadMargin?: number;
    /**
     * Share one image loader (and its cache) with other Gally components. By default canvases
     * share one blob-mode loader: images fetch and decode in a worker, and images from hosts
     * without CORS load as plain image elements.
     */
    loader?: GallyImageLoader;
    panScale?: number;
    showControls?: boolean;
    onSelectPhoto?: (selection: GallyCanvasSelection<Metadata>) => void;
    /** @deprecated Ignored: the first screen always loads first. */
    initialPriorityCount?: number;
    /** @deprecated Ignored: images load through Gally's image loader and show once decoded. */
    imageLoading?: 'browser' | 'scheduled';
    /** @deprecated Ignored (see `imageLoading`). */
    imageLoadConcurrency?: number;
    /** @deprecated Ignored (see `imageLoading`). */
    imageRevealStaggerMs?: number;
    /** @deprecated Ignored (see `imageLoading`). */
    imagePumpDelayMs?: number;
    /** @deprecated Ignored (see `imageLoading`). */
    imageVisibleBatchSize?: number;
    /** @deprecated Ignored (see `imageLoading`). */
    imageRetainMargin?: number;
    /** @deprecated Ignored (see `imageLoading`). */
    imagePruneDelayMs?: number;
};
declare function GallyCanvasInner<Metadata = unknown>({ photos, className, theme, layout: layoutOptions, minZoom, maxZoom, zoomStep, preloadMargin, loader: sharedLoader, panScale, showControls, onSelectPhoto, }: GallyCanvasProps<Metadata>, ref: ForwardedRef<GallyCanvasHandle>): import("react/jsx-runtime").JSX.Element;
export declare const GallyCanvas: <Metadata = unknown>(props: GallyCanvasProps<Metadata> & {
    ref?: Ref<GallyCanvasHandle>;
}) => ReturnType<typeof GallyCanvasInner>;
export {};
//# sourceMappingURL=GallyCanvas.d.ts.map