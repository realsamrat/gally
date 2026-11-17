import { type RefObject } from 'react';
import { type CameraGestureTarget } from '../gestures.js';
/**
 * Camera gestures on an element, attached once: the target's callbacks may change every render
 * (a new scene, new props) without re-attaching, which would drop a gesture in progress.
 */
export declare function useCameraGestures(elementRef: RefObject<HTMLElement | null>, target: CameraGestureTarget): void;
//# sourceMappingURL=use-camera-gestures.d.ts.map