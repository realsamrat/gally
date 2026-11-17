import { useEffect, useRef, type RefObject } from 'react'
import { attachCameraGestures, type CameraGestureTarget } from '../gestures.js'

/**
 * Camera gestures on an element, attached once: the target's callbacks may change every render
 * (a new scene, new props) without re-attaching, which would drop a gesture in progress.
 */
export function useCameraGestures(elementRef: RefObject<HTMLElement | null>, target: CameraGestureTarget) {
  const latest = useRef(target)
  latest.current = target
  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    return attachCameraGestures(element, {
      accept: (event) => latest.current.accept?.(event) ?? true,
      pan: (dx, dy) => latest.current.pan(dx, dy),
      zoom: (point, factor) => latest.current.zoom(point, factor),
      start: (kind) => latest.current.start?.(kind),
      end: () => latest.current.end?.(),
    })
  }, [elementRef])
}
