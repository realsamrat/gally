---
name: test-gally
description: Run and verify Gally locally: the checks CI runs, the demo site and playground, gesture and renderer checks, and benchmarks. Use when verifying a change, reproducing a bug, or before opening or approving a pull request.
---

# Test Gally

## The checks CI runs

```bash
npm ci
npm run typecheck        # package, playground and demo site
npm run build            # the package, into dist
git status --short dist  # must print nothing: dist has to match src
npm run build:site
npm run build:playground
```

If `dist` shows changes after a build, commit them with the `src` change that caused them.

## See it in a browser

```bash
npm run fixtures     # once: downloads the sample photos into public/fixtures
npm run dev:site     # the demo site, port 4318
npm run dev          # the benchmark playground
```

Check the demo that covers what changed, at a desktop width and at a phone width with touch emulation. On a touch device a demo is a preview until it is tapped; test gestures full screen.

For each of the three components, confirm what applies:

- `GallyCanvas`: drag pans, flick has momentum, pinch and ctrl+wheel zoom around the pointer, tiles appear as they come near the screen.
- `GallyHybridCanvas`: zooming out past about 0.64× switches to the Canvas overview and back, and tapping a photo in the overview zooms into it.
- `GallyLibrary`: pinch and ⌘+ / ⌘− change level around the photo under the pointer, the levels dissolve rather than jump, and scrolling stays smooth at the densest level.

Press Debug on a demo for a live readout and outlines: blue is DOM, orange is Canvas.

## Deeper checks

These drive a local Chrome through Playwright.

| Changed | Run |
| --- | --- |
| `src/gestures.ts`, pan or pinch behaviour | `npm run check:gestures` |
| `src/renderers/library-canvas-renderer.ts` | `npm run check:renderer` |
| Anything claimed to be faster | `npm run bench:fps` before and after, or `npm run bench:trace` |

A benchmark run in a hidden or background tab is throttled and its numbers are wrong. Run it in a visible window. `docs/benchmarks` shows how earlier rounds were measured.

## Don't

- Don't run `npm run deploy:site` or `npm run deploy:playground`. They publish to the maintainer's hosting.
- Don't stop a dev server by matching its name (`pkill -f vite`). Stop the process you started.
- Don't claim a frame rate, a speed-up or "works on iPhone" without having measured or tested it. Say what you checked and what you couldn't.
