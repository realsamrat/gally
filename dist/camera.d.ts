import type { Camera, Point } from './types.js';
export type CameraLimits = {
    minZoom: number;
    maxZoom: number;
};
export declare const defaultCameraLimits: CameraLimits;
export declare function clampZoom(zoom: number, limits?: CameraLimits): number;
export declare function panCamera(camera: Camera, deltaScreen: Point): Camera;
export declare function zoomCameraAtPoint(camera: Camera, screenPoint: Point, nextZoom: number, limits?: CameraLimits): Camera;
/** The camera at `zoom` that shows `worldPoint` at `screenPoint`, e.g. the point under a pinch's fingers. */
export declare function placeWorldPointAt(worldPoint: Point, screenPoint: Point, zoom: number): Camera;
export declare function zoomCameraByFactor(camera: Camera, screenPoint: Point, factor: number, limits?: CameraLimits): Camera;
//# sourceMappingURL=camera.d.ts.map