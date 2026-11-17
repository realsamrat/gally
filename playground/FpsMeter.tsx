import { useRef } from 'react'
import { fpsState, useFrameRate } from './frame-rate'

/** Frames per second and the slowest frame over the last half second. */
export function FpsMeter() {
  const fpsRef = useRef<HTMLSpanElement>(null)
  const worstRef = useRef<HTMLSpanElement>(null)

  useFrameRate(500, (fps, worst) => {
    if (fpsRef.current) {
      fpsRef.current.textContent = `${Math.round(fps)}`
      fpsRef.current.dataset.state = fpsState(fps)
    }
    if (worstRef.current) worstRef.current.textContent = `${Math.round(worst)}`
  })

  return (
    <div className="fps-meter" aria-hidden="true">
      <span ref={fpsRef} className="fps-meter-value">
        –
      </span>
      <span className="fps-meter-unit">fps</span>
      <span ref={worstRef} className="fps-meter-value">
        –
      </span>
      <span className="fps-meter-unit">ms worst</span>
    </div>
  )
}
