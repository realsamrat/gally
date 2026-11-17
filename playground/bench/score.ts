import type { ImageNetwork } from '../config'

/**
 * Gally library score: one 0–100 number from the benchmark's metrics, so changes can be compared at
 * a glance. Each metric scores full points at or better than `good` and none at or worse than
 * `poor`, on a log scale for times (halving a slow time matters as much as halving a fast one) and
 * linearly for shares. Points are weights normalised to 100. Thresholds target the reference run:
 * hybrid renderer, local images, 4G profile. Compare scores only between runs with the same
 * configuration and window size.
 */

type ScoreInput = {
  firstScreenFilledMs: number | null
  firstScreenSharpMs: number | null
  firstScreenOverheadMs: number | null
  commitAvgMs: number
  commitMaxMs: number
  pinchBlankAvgPct: number
  settleSharpMs: number | null
  scrollBlankAvgPct: number
  sharpAfterFlickMs: number | null
  blockingMs: number
}

type Rule = { key: keyof ScoreInput; label: string; good: number; poor: number; weight: number; scale: 'log' | 'linear'; network?: boolean }

/**
 * Bump when rules, weights or the scripted session change: scores compare only within a version.
 * 3 added the idle second before pinching; 4 is the four default levels (fewer, larger steps);
 * 5 adds the 33-column level on phones.
 */
export const SCORE_VERSION = 5
/** The canvas benchmark's version (`canvas-run.ts`), counted separately. */
export const CANVAS_SCORE_VERSION = 1

/**
 * Network-bound times (a screen turning sharp) can't beat the link. One screen of target-size images
 * at the default level is about 0.85 MB here; on the 4G profile (see networks.json) that takes ~0.8 s
 * at best. "Good" is that floor plus about 25%; "poor" is about 5× it. Other networks scale it.
 */
const NETWORK_SCALE: Record<ImageNetwork, number> = { fast: 0.25, '4g': 1, '3g': 5.5, cdn: 1, real: 1.5 }

const SCORE_RULES: Rule[] = [
  { key: 'firstScreenFilledMs', label: 'First screen filled', good: 800, poor: 4000, weight: 12, scale: 'log' },
  // Scored as the engine's time above the measured network floor, so any network can reach full points.
  { key: 'firstScreenOverheadMs', label: 'First screen sharp (over network)', good: 250, poor: 2500, weight: 8, scale: 'log' },
  // Level change: the engine's synchronous work plus style and layout of the new grid. Under about
  // half a 60 Hz frame leaves room for paint and compositing in the same frame.
  { key: 'commitAvgMs', label: 'Level change (avg)', good: 8, poor: 40, weight: 12, scale: 'log' },
  { key: 'commitMaxMs', label: 'Level change (worst)', good: 16, poor: 80, weight: 6, scale: 'log' },
  { key: 'pinchBlankAvgPct', label: 'Blank while pinching', good: 3, poor: 40, weight: 14, scale: 'linear' },
  { key: 'settleSharpMs', label: 'Sharp after pinching', good: 1000, poor: 4500, weight: 6, scale: 'log', network: true },
  { key: 'scrollBlankAvgPct', label: 'Blank while flicking', good: 10, poor: 60, weight: 10, scale: 'linear' },
  { key: 'sharpAfterFlickMs', label: 'Sharp after a flick', good: 1000, poor: 4500, weight: 8, scale: 'log', network: true },
  // Total blocking time over the whole session (Lighthouse's measure of main-thread jank).
  { key: 'blockingMs', label: 'Total blocking time', good: 0, poor: 600, weight: 18, scale: 'linear' },
]

/**
 * Canvases have no zoom levels to change between, so no level-change times; the pinch is
 * continuous, and blank tiles while pinching and flicking count the same as in the library.
 */
const CANVAS_RULES = SCORE_RULES.filter((rule) => rule.key !== 'commitAvgMs' && rule.key !== 'commitMaxMs')

export type ScoreBreakdown = { total: number; parts: Array<{ label: string; value: number | null; points: number; weight: number }> }

export function scoreRun(input: ScoreInput, network: ImageNetwork, scenario: 'library' | 'canvas' = 'library'): ScoreBreakdown {
  let total = 0
  const scale = NETWORK_SCALE[network]
  const rules = scenario === 'canvas' ? CANVAS_RULES : SCORE_RULES
  const totalWeight = rules.reduce((sum, rule) => sum + rule.weight, 0)
  const parts = rules.map((base) => {
    const rule = base.network ? { ...base, good: base.good * scale, poor: base.poor * scale } : base
    const value = input[rule.key]
    const weight = (rule.weight * 100) / totalWeight
    const points = (value == null ? 0 : ruleFraction(rule, value)) * weight
    total += points
    return { label: rule.label, value, points: Math.round(points * 10) / 10, weight: Math.round(weight * 10) / 10 }
  })
  return { total: Math.round(total), parts }
}

function ruleFraction(rule: Rule, value: number) {
  if (value <= rule.good) return 1
  if (value >= rule.poor) return 0
  if (rule.scale === 'linear') return (rule.poor - value) / (rule.poor - rule.good)
  return (Math.log(rule.poor) - Math.log(value)) / (Math.log(rule.poor) - Math.log(Math.max(1e-6, rule.good)))
}
