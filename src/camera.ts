import { screenToWorld } from './geometry.js'
import type { Camera, Point } from './types.js'

export type CameraLimits = {
  minZoom: number
  maxZoom: number
}

export const defaultCameraLimits: CameraLimits = {
  minZoom: 0.08,
  maxZoom: 6,
}

export function clampZoom(zoom: number, limits: CameraLimits = defaultCameraLimits): number {
  return Math.min(limits.maxZoom, Math.max(limits.minZoom, zoom))
}

export function panCamera(camera: Camera, deltaScreen: Point): Camera {
  return {
    ...camera,
    x: camera.x - deltaScreen.x / camera.zoom,
    y: camera.y - deltaScreen.y / camera.zoom,
  }
}

export function zoomCameraAtPoint(
  camera: Camera,
  screenPoint: Point,
  nextZoom: number,
  limits: CameraLimits = defaultCameraLimits
): Camera {
  return placeWorldPointAt(screenToWorld(screenPoint, camera), screenPoint, clampZoom(nextZoom, limits))
}

/** The camera at `zoom` that shows `worldPoint` at `screenPoint`, e.g. the point under a pinch's fingers. */
export function placeWorldPointAt(worldPoint: Point, screenPoint: Point, zoom: number): Camera {
  return {
    zoom,
    x: worldPoint.x - screenPoint.x / zoom,
    y: worldPoint.y - screenPoint.y / zoom,
  }
}

export function zoomCameraByFactor(
  camera: Camera,
  screenPoint: Point,
  factor: number,
  limits: CameraLimits = defaultCameraLimits
): Camera {
  return zoomCameraAtPoint(camera, screenPoint, camera.zoom * factor, limits)
}
