import type { Bounds, Camera, Point, Size } from './types.js'

export function makeBounds(x: number, y: number, width: number, height: number): Bounds {
  return {
    x,
    y,
    width,
    height,
    minX: x,
    minY: y,
    maxX: x + width,
    maxY: y + height,
  }
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

export function boundsContainPoint(bounds: Bounds, point: Point): boolean {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY
}

export function expandBounds(bounds: Bounds, amount: number): Bounds {
  return makeBounds(
    bounds.x - amount,
    bounds.y - amount,
    bounds.width + amount * 2,
    bounds.height + amount * 2
  )
}

export function screenToWorld(point: Point, camera: Camera): Point {
  return {
    x: point.x / camera.zoom + camera.x,
    y: point.y / camera.zoom + camera.y,
  }
}

export function worldToScreen(point: Point, camera: Camera): Point {
  return {
    x: (point.x - camera.x) * camera.zoom,
    y: (point.y - camera.y) * camera.zoom,
  }
}

export function getViewportWorldBounds(camera: Camera, viewport: Size): Bounds {
  return makeBounds(camera.x, camera.y, viewport.width / camera.zoom, viewport.height / camera.zoom)
}

export function getScreenBounds(worldBounds: Bounds, camera: Camera): Bounds {
  const topLeft = worldToScreen({ x: worldBounds.x, y: worldBounds.y }, camera)
  return makeBounds(
    topLeft.x,
    topLeft.y,
    worldBounds.width * camera.zoom,
    worldBounds.height * camera.zoom
  )
}

/** Offset in [-period, 0) for a camera coordinate on a layout that repeats every `period`. */
export function wrapOffset(value: number, period: number): number {
  return (((value % period) + period) % period) - period
}
