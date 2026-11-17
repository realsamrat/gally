/**
 * Library pinch math: the camera of a Photo Surface while a pinch scales it, the dissolve between
 * two column layouts, the resistance past the closest and densest levels, and the spring that
 * settles a release. Pure functions, so `GallyLibrary` keeps only DOM work in its frames.
 *
 * The model follows a frame-by-frame study of the iOS Photos library: both layouts scale
 * continuously about one image-local point under the fingers, they dissolve into each other as the
 * pinch progresses (not on a timer), and letting go springs scale and position together, critically
 * damped, carrying the fingers' speed. Constants marked "fitted" were fitted to that recording;
 * the rest are tuning choices.
 */

/** Where a surface's content is on screen: `screen = scale * content + (x, y)`. */
export type PinchCamera = { scale: number; x: number; y: number }

/** `outer` after `inner`: the camera that applies `inner`, then `outer`. */
export function composeCamera(outer: PinchCamera, inner: PinchCamera): PinchCamera {
  return { scale: outer.scale * inner.scale, x: outer.scale * inner.x + outer.x, y: outer.scale * inner.y + outer.y }
}

export function invertCamera(camera: PinchCamera): PinchCamera {
  return { scale: 1 / camera.scale, x: -camera.x / camera.scale, y: -camera.y / camera.scale }
}

/** The camera that scales by `scale` about `from` and moves `from` to `to` (a two-finger move). */
export function gestureCamera(from: { x: number; y: number }, to: { x: number; y: number }, scale: number): PinchCamera {
  return { scale, x: to.x - scale * from.x, y: to.y - scale * from.y }
}

/** A CSS transform for a camera, on an element whose transform origin is `0 0`. */
export function cameraTransform(camera: PinchCamera, offsetY = 0) {
  return `matrix(${camera.scale}, 0, 0, ${camera.scale}, ${camera.x}, ${camera.y + offsetY})`
}

/**
 * Resistance past the ends, on a log scale: `room` is how far (log units) the grid can go past
 * `limit` at most; within the levels the fingers move it one to one. Returns the shown value and
 * its slope, which scales the fingers' speed carried into a release.
 */
export function resist(value: number, limit: number, room: number, past: 1 | -1): { value: number; slope: number } {
  const excess = (value - limit) * past
  if (excess <= 0) return { value, slope: 1 }
  const t = Math.tanh(excess / room)
  return { value: limit + past * room * t, slope: 1 - t * t }
}

/** Past the closest level the grid stretches up to about e^0.5 (Photos reaches 1.45× there). */
export const CLOSEST_ROOM = 0.5
/** Past the densest level it gives a little, about 8% at most (Photos: about 3%). */
export const DENSEST_ROOM = 0.08

// The dissolve between two layouts, by pinch progress p (0 at the outgoing level's size, 1 at the
// incoming one's): a logistic fitted to two Photos transitions, normalised to run from 0 at
// p = 0.15 to 1 at p = 1.08. Progress is filtered with a ~17 ms lag (fitted), so a fast pinch
// dissolves a touch later than a slow one.
const DISSOLVE_SLOPE = 7.6668
const DISSOLVE_MIDPOINT = 0.64546
export const DISSOLVE_START = 0.15
export const DISSOLVE_END = 1.08
export const DISSOLVE_LAG_S = 0.01734
const logistic = (x: number) => 1 / (1 + Math.exp(-DISSOLVE_SLOPE * (x - DISSOLVE_MIDPOINT)))
const LOW = logistic(DISSOLVE_START)
const HIGH = logistic(DISSOLVE_END)

/** How far the incoming layout has dissolved in (0–1) at pinch progress `p`. */
export function dissolveAt(p: number) {
  return Math.min(1, Math.max(0, (logistic(p) - LOW) / (HIGH - LOW)))
}

/** The progress at which the dissolve shows `alpha`: carries a dissolve caught mid-way into a new pinch. */
export function progressForDissolve(alpha: number) {
  if (alpha <= 0) return DISSOLVE_START
  if (alpha >= 1) return DISSOLVE_END
  const l = LOW + alpha * (HIGH - LOW)
  return DISSOLVE_MIDPOINT - Math.log(1 / l - 1) / DISSOLVE_SLOPE
}

/** The release spring's rate, rad/s, critically damped (fitted: 12.2–12.9). */
export const SETTLE_RATE = 12.5
/** The dissolve finishes after a release on its own, faster spring. */
export const DISSOLVE_RATE = 25

/** A critically damped spring: what's left of `error` after `t` seconds, starting at `velocity`. */
export function springValue(error: number, velocity: number, rate: number, t: number) {
  return (error + (velocity + rate * error) * t) * Math.exp(-rate * t)
}

/** That spring's velocity after `t` seconds. */
export function springVelocity(error: number, velocity: number, rate: number, t: number) {
  return (velocity - rate * (velocity + rate * error) * t) * Math.exp(-rate * t)
}

/**
 * Speed (units per second) from recent `(t ms, value)` samples: a least-squares slope over the
 * last `windowMs`, so one jittery event doesn't decide a release. A pause before letting go
 * leaves no recent samples, and no speed.
 */
export function fitSpeed(samples: ReadonlyArray<{ t: number; v: number }>, now: number, windowMs = 80) {
  let n = 0
  let meanT = 0
  let meanV = 0
  for (const sample of samples) {
    if (now - sample.t > windowMs) continue
    n++
    meanT += sample.t
    meanV += sample.v
  }
  if (n < 2) return 0
  meanT /= n
  meanV /= n
  let covariance = 0
  let variance = 0
  let first = Infinity
  let last = -Infinity
  for (const sample of samples) {
    if (now - sample.t > windowMs) continue
    covariance += (sample.t - meanT) * (sample.v - meanV)
    variance += (sample.t - meanT) ** 2
    first = Math.min(first, sample.t)
    last = Math.max(last, sample.t)
  }
  if (last - first < 16 || variance <= 0) return 0
  return (covariance / variance) * 1000
}

/**
 * A settle after release: the target surface's scale springs to 1 and the point under the fingers
 * (`focus`, in its content) springs to where it rests, both critically damped from their speeds;
 * the surface's position follows from the two, so scale and position arrive together.
 */
export type SettlePlan = {
  focus: { x: number; y: number }
  scale: { error: number; velocity: number }
  /** The focus point's screen position: error from its resting place, and velocity (px, px/s). */
  x: { error: number; velocity: number }
  y: { error: number; velocity: number }
  rest: { x: number; y: number }
}

export function planSettle(
  camera: PinchCamera,
  focusScreen: { x: number; y: number },
  rest: PinchCamera,
  velocity: { scale: number; x: number; y: number },
): SettlePlan {
  const focus = { x: (focusScreen.x - camera.x) / camera.scale, y: (focusScreen.y - camera.y) / camera.scale }
  const restScreen = { x: rest.scale * focus.x + rest.x, y: rest.scale * focus.y + rest.y }
  return {
    focus,
    scale: { error: camera.scale - rest.scale, velocity: velocity.scale },
    x: { error: focusScreen.x - restScreen.x, velocity: velocity.x },
    y: { error: focusScreen.y - restScreen.y, velocity: velocity.y },
    rest: restScreen,
  }
}

/** The target surface's camera `t` seconds into a settle (rest scale 1). */
export function settleCamera(plan: SettlePlan, t: number): PinchCamera {
  const scale = 1 + springValue(plan.scale.error, plan.scale.velocity, SETTLE_RATE, t)
  const x = plan.rest.x + springValue(plan.x.error, plan.x.velocity, SETTLE_RATE, t)
  const y = plan.rest.y + springValue(plan.y.error, plan.y.velocity, SETTLE_RATE, t)
  return { scale, x: x - scale * plan.focus.x, y: y - scale * plan.focus.y }
}

/**
 * How long a settle takes: until every point on screen is within a quarter of a device pixel of
 * rest and slower than 2 px/s, so its last frame steps by less than anyone can see.
 */
export function settleDuration(plan: SettlePlan, reach: number, devicePixelRatio: number, maxSeconds = 2) {
  const tolerance = 0.25 / devicePixelRatio
  const { scale, x, y } = plan
  for (let t = 0; t < maxSeconds; t += 1 / 240) {
    const s = Math.abs(springValue(scale.error, scale.velocity, SETTLE_RATE, t)) * reach
    const p = Math.hypot(springValue(x.error, x.velocity, SETTLE_RATE, t), springValue(y.error, y.velocity, SETTLE_RATE, t))
    const sv = Math.abs(springVelocity(scale.error, scale.velocity, SETTLE_RATE, t)) * reach
    const pv = Math.hypot(springVelocity(x.error, x.velocity, SETTLE_RATE, t), springVelocity(y.error, y.velocity, SETTLE_RATE, t))
    if (s + p < tolerance && sv + pv < 2) return t
  }
  return maxSeconds
}

/** The scale velocity, reduced if needed so the spring overshoots rest by at most `limit` (a share of scale). */
export function limitOvershoot(error: number, velocity: number, limit: number) {
  const overshoot = (v: number) => {
    let most = 0
    for (let t = 0; t < 1; t += 1 / 120) {
      const at = springValue(error, v, SETTLE_RATE, t)
      if (error === 0 || Math.sign(at) !== Math.sign(error)) most = Math.max(most, Math.abs(at))
    }
    return most
  }
  let v = velocity
  for (let i = 0; i < 16 && overshoot(v) > limit; i++) v *= 0.75
  return overshoot(v) > limit ? 0 : v
}
