import type { Point } from './types.js';
/**
 * Camera gestures for a Photo Surface: drag to pan (with momentum when a touch or pen flick lets
 * go), two-finger pinch, trackpad pinch (ctrl+wheel), Safari's gesture events, and wheel panning.
 *
 * The surface only says how to move its camera, in screen terms, so the same gestures drive any
 * camera convention. Points are in the element's coordinates.
 */
export type CameraGestureTarget = {
    /** Move the content by this many screen pixels. */
    pan(dx: number, dy: number): void;
    /** Scale the zoom by `factor` around `point`, keeping what's under it in place. */
    zoom(point: Point, factor: number): void;
    /** Called when a gesture starts moving the camera, and again if a pan turns into a pinch. */
    start?(kind: 'pan' | 'zoom'): void;
    /** Called when the camera stops: fingers lifted and momentum done, or wheel input paused. */
    end?(): void;
    /** Return false to leave a pointer down on this element to the page (e.g. a control). */
    accept?(event: PointerEvent): boolean;
};
export type CameraGestureOptions = {
    /** Wheel zoom per pixel of `deltaY` while ctrl/⌘ is held (trackpad pinch). Default 0.01. */
    wheelZoomSpeed?: number;
    /** A pan lets go with momentum above this speed, in px/ms. Default 0.15. */
    momentumMinSpeed?: number;
    /** Momentum decay time constant in ms (iOS scroll views use about 325). Default 325. */
    momentumDecayMs?: number;
    /** Movement in px after which a press counts as a drag and its click is cancelled. Default 6. */
    clickSlop?: number;
};
/** Attach camera gestures to `element`. Returns a function that detaches them. */
export declare function attachCameraGestures(element: HTMLElement, target: CameraGestureTarget, options?: CameraGestureOptions): () => void;
//# sourceMappingURL=gestures.d.ts.map