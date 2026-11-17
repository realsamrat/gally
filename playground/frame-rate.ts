import { useEffect, useRef } from 'react'

/**
 * Calls `onWindow` with frames per second and the slowest frame (ms) every `windowMs`. Runs on
 * animation frames outside React, so measuring adds no renders of its own.
 */
export function useFrameRate(windowMs: number, onWindow: (fps: number, worstMs: number) => void) {
  const callback = useRef(onWindow)
  callback.current = onWindow

  useEffect(() => {
    let frame = 0
    let last = performance.now()
    let windowStart = last
    let frames = 0
    let worst = 0
    const tick = (now: number) => {
      worst = Math.max(worst, now - last)
      last = now
      frames++
      if (now - windowStart >= windowMs) {
        callback.current((frames * 1000) / (now - windowStart), worst)
        windowStart = now
        frames = 0
        worst = 0
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [windowMs])
}

export const fpsState = (fps: number) => (fps >= 55 ? 'good' : fps >= 40 ? 'fair' : 'poor')
