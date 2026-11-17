# Canvases: touch and 240 fps

Goal: `GallyCanvas` and `GallyHybridCanvas` take touch input (pan with momentum, two-finger pinch,
trackpad pinch, Safari gesture events) and hold the library's bar: p95 main-thread capacity
≥ 240 fps while pinching and panning on desktop, and keeping up with a 120 Hz screen on a phone.

## Where they started

- `GallyCanvas` listened to the mouse and wheel only: a phone couldn't pan or pinch it at all. It
  mounted every photo nine times (160 photos × 3×3 copies, 1,440 DOM tiles) and, after each pan,
  measured every image's position on screen (a forced layout of all of them).
- `GallyHybridCanvas` had pinch code, but ignored any touch that started on a photo: at close zoom
  photos cover the screen, so pan and pinch looked dead.

## Result

Same harness and benchmark for every row. Capacity is main-thread capacity (see
[the 240 fps write-up](240-fps.md#the-measure)); "shown" is the frame rate the screen showed.

| | Input | Pinch p95 | Pan p95 | Shown (avg) | Score |
| --- | --- | --- | --- | --- | --- |
| `GallyCanvas` before, desktop | trackpad (no touch) | 43 | 115 | 106 | 98 |
| `GallyCanvas` after, desktop (hosted, 3 runs) | touch | 256–400 | 833–1,000 | 120 | 100 |
| `GallyHybridCanvas` before, desktop | trackpad (touch broken) | 294 | 417 | 119 | 100 |
| `GallyHybridCanvas` after, desktop (hosted, 3 runs) | touch | 270–278 | 667–769 | 120 | 100 |
| `GallyCanvas` before, phone profile | trackpad | 20 | 24 | 48 | — |
| `GallyCanvas` after, phone profile (hosted, 2 runs) | touch | 108–112 | 208–238 | 117 | 100 |
| `GallyHybridCanvas` before, phone profile | trackpad | 69 | 145 | 110 | — |
| `GallyHybridCanvas` after, phone profile (hosted, 2 runs) | touch | 105–110 | 238–263 | 116–117 | 100 |

- Desktop: 1440×900 at 2×, Chrome. Phone profile: 390×844 at 3×, touch, CPU slowed 4×; its target
  is the screen's 120 Hz (8.3 ms), not 240.
- The "before" rows ran with trackpad input because the old components couldn't take touch.
- Hosted "after" rows are the final build (`a42a718+f548aa3`) on the deployed playground, stored in
  its run history under `r11-final*`. The library ran in the same round: desktop motion p95
  417 fps, phone profile 139, score 100 everywhere.
- Capacity p95 while moving (pinch and pan together), desktop medians: `GallyCanvas` 400 fps,
  `GallyHybridCanvas` 345 fps.
- Real input: `npm run check:gestures` drives both canvases through Chrome's touch and mouse
  pipelines (24 checks). In the iOS Simulator's Mobile Safari, pinch in and out, one-finger pan
  (no page zoom), pinching the hybrid into its overview and tapping a photo there all work.

## What changed, and why

- **One gesture controller** (`src/gestures.ts`, exported as `attachCameraGestures`): pointer drag
  with momentum, two-finger pinch around the fingers' centre, ctrl+wheel, Safari gesture events.
  Pointers are captured only once a press becomes a drag, so a plain click still reaches its tile;
  a drag, pinch, or tap that stops a glide never clicks.
- **Virtualized tiles** (`src/react/photo-tile-layer.tsx`), shared by `GallyCanvas` and the
  hybrid's detail layer: tiles near the screen are mounted in world coordinates inside one layer
  the camera transforms. The mounted set changes only when the screen nears its edge or the zoom
  changes a lot; image arrivals re-render only tiles whose picture changes, off-screen ones in
  batches.
- **Decoded images at the right size**: tiles show images once the loader has decoded them, at the
  size the zoom needs. The canvases' default loader is blob mode (fetch and decode in a worker), so
  the hybrid's overview draws thumbnails from bitmaps the worker made: drawing image elements on a
  canvas decoded them again on the main thread, a 53 ms frame when the overview first appeared.
  Images from hosts without CORS fall back to plain image elements.
- **Overview drawing**: only on-screen tiles are looked up and drawn each frame; the ring around
  the screen (thousands of tiles far out on a phone) is requested only after the camera moves on.
- **Hybrid apply** writes styles only when they change: custom properties set on the shell every
  frame restyled every tile.

## Rounds

Local rounds ran a production build on this machine; hosted rounds ran on the deployed playground.
Numbers are capacity p95 (fps).

| Round | Change | `GallyCanvas` pinch / pan | Hybrid pinch / pan | Phone: hybrid pinch |
| --- | --- | --- | --- | --- |
| r0 | Baseline (trackpad input) | 43 / 115 | 294 / 417 | 69 |
| r1 | Gestures, virtualized `GallyCanvas`, hybrid detail on the tile layer | 303 / 909 | 227 / 625 | 62 |
| r2 | Overview: on-screen lookups only, ring demand throttled | 312 / 1,000–1,250 | 238–263 / 714 | — |
| r3 | Blob-mode default loader (worker decode, bitmaps) | — | ~286 (probe) | 68–70 |
| r4 | Hosted, desktop and phone, all three components | 256–286 / 909–1,111 | 250–256 / 588–714 | 100–104 |
| r5 | Council round 1 fixes | 256 / 909 | 263 / 667 | 64 |
| r6 | Tiles re-render only on a changed picture, off-screen in batches | 294 / 1,000 | 278 / 714 | 111 |
| r7–r10 | Council rounds 2–6 fixes (gesture edge cases, dissolve and blend races, overview redraw throttles, eviction, loader) | 270–294 / 909–1,111 | 263–286 / 667–714 | 69–111 (noisy) |
| r11 | Final, hosted | 256–400 / 833–1,000 | 270–278 / 667–769 | 105–110 |

Phone-profile p95 swings between runs (the same build read 69 and 101); the count of frames over
budget is steadier and didn't regress after r6.

## Review

Code review by a council of Claude Opus and GPT Sol, each round a fresh review of the updated code,
until both rated it ready to ship.

| Delegate | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Opus | 6.5 | 7 | 8 | 8 | 8.5 | 8.5 | 9 | 9.5 |
| GPT Sol | 6 | 7 | 8 | 8 | 8 | 9 | 9 | 9.5 |

Among what the reviews caught: taps on the zoom buttons swallowed after a touch pan, a tap that
stopped a glide also selecting a photo, zoom buttons during the hybrid's focus dissolve locking the
canvas (now covered by `check:gestures`), two layer blends running at once when a pinch reversed,
image arrivals defeating the overview's redraw throttles, fallback images evicted from under the
tiles showing them, and a loader race that made re-requested images uncancellable.

## Round 12: Safari and the library pinch rebuild

Hosted (`gally-playground.vercel.app`) and local production builds, after the library pinch was
rebuilt on the Apple Photos measurements and checked in Simulator Safari (iPhone 17 Pro):

| | Desktop capacity p95 (score) | Phone profile `--mobile --cpu 1.5` p95 (score) |
| --- | --- | --- |
| `GallyLibrary` | 500–625 (100; blank while pinching 1–3%, was 9–10%) | 250–270 (100) |
| `GallyCanvas` | 417 (100) | 417–455 (100) |
| `GallyHybridCanvas` | 313–323 (100) | 313–333 (100) |

- Simulator Safari, library pinches on the live link: 54–60 fps (60 Hz simulator) after the grid
  got its own layer while pinching; before, 27–60.
- Safari-specific fixes for the canvases: at most 48 new tiles mount per frame; tiles don't
  animate in while zooming (each animating tile was a compositor layer); the moving layer is
  re-rasterized each time the zoom halves; the hybrid's faded detail layer isn't painted.
- Still open: a very fast zoom from close-up to far out in Simulator Safari has one 180–240 ms
  frame on both canvases; it needs a Safari timeline to attribute.

## How to run it

```bash
npm run bench:fps -- --renderer stable --runs 3 --headed          # GallyCanvas, desktop
npm run bench:fps -- --renderer hybrid --mobile --runs 2 --headed # GallyHybridCanvas, phone profile
npm run bench:fps -- --renderer stable --input wheel              # trackpad input instead of touch
RENDERER=hybrid MOBILE=1 npm run bench:trace                      # trace, with where the time goes
npm run check:gestures                                            # real touch and mouse input
DEV=1 npm run check:gestures                                      # the same on the dev server (StrictMode)
```

In the playground, `?renderer=stable` or `?renderer=hybrid` shows a canvas with the benchmark
panel; `?input=wheel` benchmarks with trackpad input.

## What's left

- Phone-profile pinching still spends its time on layout, layer updates and commit when new tiles
  mount (Chrome at 4× slower CPU); a real iPhone is closer to the desktop numbers.
- The benchmark's touch input is synthetic pointer events dispatched on the canvas, so it measures
  main-thread work, not input latency; `check:gestures` covers the browser's real touch path.
