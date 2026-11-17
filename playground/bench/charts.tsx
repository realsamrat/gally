import { useRef } from 'react'
import { fpsState, useFrameRate } from '../frame-rate'
import type { BenchResult } from './run'
import { isValidRun } from './storage'

/** Score per run, oldest to newest, as a white line over faint bars; invalid runs show as dim bars. */
export function ScoreHistory({ results }: { results: BenchResult[] }) {
  const runs = [...results].slice(0, 16).reverse()
  const width = 132
  const height = 40
  if (!runs.length) return <svg className="bench-history" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" />
  const min = Math.min(80, ...runs.map((r) => r.score.total))
  const y = (score: number) => height - 2 - ((score - min) / (100 - min)) * (height - 6)
  const step = width / Math.max(1, runs.length)
  const points = runs
    .map((r, i) => (isValidRun(r) ? `${(i + 0.5) * step},${y(r.score.total)}` : null))
    .filter(Boolean)
    .join(' ')
  return (
    <svg className="bench-history" viewBox={`0 0 ${width} ${height}`} aria-label="Score history">
      <line x1="0" x2={width} y1={y(98)} y2={y(98)} className="bench-target" />
      {runs.map((r, i) => (
        <rect
          key={r.id}
          x={i * step + 1}
          width={Math.max(1, step - 2)}
          y={y(r.score.total)}
          height={height - y(r.score.total)}
          className="bench-bar"
          data-invalid={isValidRun(r) ? undefined : ''}
        />
      ))}
      {points && <polyline points={points} className="bench-line" />}
    </svg>
  )
}

const SAMPLES = 60

/** Live frames per second as a white line; writes its own SVG directly so measuring adds no renders. */
export function FpsChart() {
  const lineRef = useRef<SVGPolylineElement>(null)
  const valueRef = useRef<HTMLSpanElement>(null)
  const worstRef = useRef<HTMLSpanElement>(null)
  const samples = useRef<number[]>([])
  const width = 268
  const height = 34
  /** The chart tops out at 120 fps; faster displays clip. */
  const y = (fps: number) => height - 2 - (Math.min(fps, 120) / 120) * (height - 4)

  useFrameRate(250, (fps, worst) => {
    const values = samples.current
    values.push(fps)
    if (values.length > SAMPLES) values.shift()
    lineRef.current?.setAttribute('points', values.map((v, i) => `${(i / (SAMPLES - 1)) * width},${y(v)}`).join(' '))
    if (valueRef.current) {
      valueRef.current.textContent = `${Math.round(fps)}`
      valueRef.current.dataset.state = fpsState(fps)
    }
    if (worstRef.current) worstRef.current.textContent = `${Math.round(worst)}ms`
  })

  return (
    <section className="bench-fps">
      <div className="bench-fps-label">
        <span ref={valueRef} className="bench-fps-value">
          –
        </span>
        <span title="Frames the screen showed: never more than its refresh rate (120 on a ProMotion display). A run's capacity, below, is how fast Gally could go.">fps on screen</span>
        <span className="bench-fps-worst">
          worst <span ref={worstRef}>–</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2={width} y1={y(60)} y2={y(60)} className="bench-target" />
        <polyline ref={lineRef} className="bench-line" />
      </svg>
    </section>
  )
}
