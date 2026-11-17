import { screenToWorld } from './geometry.js';
export const defaultCameraLimits = {
    minZoom: 0.08,
    maxZoom: 6,
};
export function clampZoom(zoom, limits = defaultCameraLimits) {
    return Math.min(limits.maxZoom, Math.max(limits.minZoom, zoom));
}
export function panCamera(camera, deltaScreen) {
    return {
        ...camera,
        x: camera.x - deltaScreen.x / camera.zoom,
        y: camera.y - deltaScreen.y / camera.zoom,
    };
}
export function zoomCameraAtPoint(camera, screenPoint, nextZoom, limits = defaultCameraLimits) {
    return placeWorldPointAt(screenToWorld(screenPoint, camera), screenPoint, clampZoom(nextZoom, limits));
}
/** The camera at `zoom` that shows `worldPoint` at `screenPoint`, e.g. the point under a pinch's fingers. */
export function placeWorldPointAt(worldPoint, screenPoint, zoom) {
    return {
        zoom,
        x: worldPoint.x - screenPoint.x / zoom,
        y: worldPoint.y - screenPoint.y / zoom,
    };
}
export function zoomCameraByFactor(camera, screenPoint, factor, limits = defaultCameraLimits) {
    return zoomCameraAtPoint(camera, screenPoint, camera.zoom * factor, limits);
}
//# sourceMappingURL=camera.js.map