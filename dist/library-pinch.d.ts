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
export type PinchCamera = {
    scale: number;
    x: number;
    y: number;
};
/** `outer` after `inner`: the camera that applies `inner`, then `outer`. */
export declare function composeCamera(outer: PinchCamera, inner: PinchCamera): PinchCamera;
export declare function invertCamera(camera: PinchCamera): PinchCamera;
/** The camera that scales by `scale` about `from` and moves `from` to `to` (a two-finger move). */
export declare function gestureCamera(from: {
    x: number;
    y: number;
}, to: {
    x: number;
    y: number;
}, scale: number): PinchCamera;
/** A CSS transform for a camera, on an element whose transform origin is `0 0`. */
export declare function cameraTransform(camera: PinchCamera, offsetY?: number): string;
/**
 * Resistance past the ends, on a log scale: `room` is how far (log units) the grid can go past
 * `limit` at most; within the levels the fingers move it one to one. Returns the shown value and
 * its slope, which scales the fingers' speed carried into a release.
 */
export declare function resist(value: number, limit: number, room: number, past: 1 | -1): {
    value: number;
    slope: number;
};
/** Past the closest level the grid stretches up to about e^0.5 (Photos reaches 1.45× there). */
export declare const CLOSEST_ROOM = 0.5;
/** Past the densest level it gives a little, about 8% at most (Photos: about 3%). */
export declare const DENSEST_ROOM = 0.08;
export declare const DISSOLVE_START = 0.15;
export declare const DISSOLVE_END = 1.08;
export declare const DISSOLVE_LAG_S = 0.01734;
/** How far the incoming layout has dissolved in (0–1) at pinch progress `p`. */
export declare function dissolveAt(p: number): number;
/** The progress at which the dissolve shows `alpha`: carries a dissolve caught mid-way into a new pinch. */
export declare function progressForDissolve(alpha: number): number;
/** The release spring's rate, rad/s, critically damped (fitted: 12.2–12.9). */
export declare const SETTLE_RATE = 12.5;
/** The dissolve finishes after a release on its own, faster spring. */
export declare const DISSOLVE_RATE = 25;
/** A critically damped spring: what's left of `error` after `t` seconds, starting at `velocity`. */
export declare function springValue(error: number, velocity: number, rate: number, t: number): number;
/** That spring's velocity after `t` seconds. */
export declare function springVelocity(error: number, velocity: number, rate: number, t: number): number;
/**
 * Speed (units per second) from recent `(t ms, value)` samples: a least-squares slope over the
 * last `windowMs`, so one jittery event doesn't decide a release. A pause before letting go
 * leaves no recent samples, and no speed.
 */
export declare function fitSpeed(samples: ReadonlyArray<{
    t: number;
    v: number;
}>, now: number, windowMs?: number): number;
/**
 * A settle after release: the target surface's scale springs to 1 and the point under the fingers
 * (`focus`, in its content) springs to where it rests, both critically damped from their speeds;
 * the surface's position follows from the two, so scale and position arrive together.
 */
export type SettlePlan = {
    focus: {
        x: number;
        y: number;
    };
    scale: {
        error: number;
        velocity: number;
    };
    /** The focus point's screen position: error from its resting place, and velocity (px, px/s). */
    x: {
        error: number;
        velocity: number;
    };
    y: {
        error: number;
        velocity: number;
    };
    rest: {
        x: number;
        y: number;
    };
};
export declare function planSettle(camera: PinchCamera, focusScreen: {
    x: number;
    y: number;
}, rest: PinchCamera, velocity: {
    scale: number;
    x: number;
    y: number;
}): SettlePlan;
/** The target surface's camera `t` seconds into a settle (rest scale 1). */
export declare function settleCamera(plan: SettlePlan, t: number): PinchCamera;
/**
 * How long a settle takes: until every point on screen is within a quarter of a device pixel of
 * rest and slower than 2 px/s, so its last frame steps by less than anyone can see.
 */
export declare function settleDuration(plan: SettlePlan, reach: number, devicePixelRatio: number, maxSeconds?: number): number;
/** The scale velocity, reduced if needed so the spring overshoots rest by at most `limit` (a share of scale). */
export declare function limitOvershoot(error: number, velocity: number, limit: number): number;
//# sourceMappingURL=library-pinch.d.ts.map