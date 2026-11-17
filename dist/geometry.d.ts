import type { Bounds, Camera, Point, Size } from './types.js';
export declare function makeBounds(x: number, y: number, width: number, height: number): Bounds;
export declare function boundsIntersect(a: Bounds, b: Bounds): boolean;
export declare function boundsContainPoint(bounds: Bounds, point: Point): boolean;
export declare function expandBounds(bounds: Bounds, amount: number): Bounds;
export declare function screenToWorld(point: Point, camera: Camera): Point;
export declare function worldToScreen(point: Point, camera: Camera): Point;
export declare function getViewportWorldBounds(camera: Camera, viewport: Size): Bounds;
export declare function getScreenBounds(worldBounds: Bounds, camera: Camera): Bounds;
/** Offset in [-period, 0) for a camera coordinate on a layout that repeats every `period`. */
export declare function wrapOffset(value: number, period: number): number;
//# sourceMappingURL=geometry.d.ts.map