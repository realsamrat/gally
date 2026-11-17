# Gally Architecture

Gally is not a whiteboard engine. It is a photo-first infinite canvas runtime.

## Core strategies

These ideas are the foundation of the engine:

- keep panning and zooming in camera state
- store items in world-space coordinates
- use a spatial index to query viewport contents
- render only visible and near-visible photos
- choose image sources from zoom and device pixel ratio
- separate interaction lifecycle from persistent item data
- expose performance snapshots for profiling

## Different choices

These choices keep the engine focused:

- `PhotoTile` is the primary model, not a generic shape
- the React DOM canvas is the first renderer, while the engine remains renderer-agnostic
- image loading is a first-class concern
- photo source switching and preloading live in the engine/canvas layer
- there are no whiteboard tools, bindings, rich handles, arrows, text, or sticky notes
- there is no cursor morph behavior in the package

## Runtime flow

```txt
photo records
  -> spatial index
  -> camera + viewport bounds
  -> visible photo query
  -> LOD source resolver
  -> renderer receives visible photos
  -> image loader channel warms near-visible photos
```

## Image loading

`GallyImageLoader` is the one image cache. Every consumer (an engine, a renderer, a React component) opens a channel and replaces its demand with what its current window needs, each image marked `visible`, `near` or `prefetch`. The loader keeps and loads the union of all demands: on-screen images start first and all at once, background work waits while on-screen work is queued, and anything no channel demands is dropped (or cancelled, in blob mode, before its first byte). Getters are pure, so rendering from the cache never changes what loads. Consumers re-render through `subscribe` and `getVersion`.

In blob mode, fetching and decoding run in a worker where possible, with results posted in batches, so hundreds of images arriving during a pinch cost the main thread little. Small images keep the bitmap they were decoded into, for canvas renderers (`getBitmap`; larger sizes come from `prepareBitmaps`). Image elements are made only when asked for: a DOM renderer calls `prepareElements` for the photos it shows and draws one once `isRenderable` says it has decoded, so painting never decodes in the frame. `subscribe` listeners receive the URLs that changed, so a renderer can redraw just those tiles.

## Renderer boundary

The engine returns `VisiblePhoto` records. A renderer can be:

- DOM/React for the first milestone
- Pixi/WebGL if zoomed-out density becomes too high
- a hybrid where DOM renders selected/hovered photos and WebGL renders the mass photo layer

The renderer should not mutate photo records during pan or zoom. The React canvas moves stable transform layers during camera changes; it does not React-render every tile position per frame.

The packaged React canvas mounts a buffered viewport/preload window rather than the entire wrapped photo surface. Camera movement still happens imperatively through transform layers, while React only receives a new mounted set when the list of near-visible tile ids changes.

## Hybrid alpha

`GallyHybridCanvas` is the v0.3 alpha renderer boundary. It keeps one photo scene with two rectangles per photo:

- `detailRect` for aspect-ratio-accurate close zoom
- `overviewRect` for square contact-sheet overview zoom

The overview renderer is Canvas 2D in the alpha. It draws on-screen overview tiles only, from the same image loader as the detail layer, preferring small decoded bitmaps (in blob mode, thumbnails arrive as bitmaps from the worker); thumbnails around the screen are requested separately and only after the camera has moved on. The detail renderer is DOM and mounts a limited visible set for buttons, image semantics, hover, and selection callbacks. The crossfade band is intentionally narrow so both layers are not fully live for long.

`GallyCanvas` and the hybrid's detail layer share one virtualized tile layer (`react/photo-tile-layer.tsx`): tiles near the screen are mounted in world coordinates inside one element the camera transforms, the mounted set changes only when the screen nears its edge or the zoom changes a lot, and each tile shows its image once the loader has decoded it, at the size the zoom wants (or the nearest size already loaded). Both canvases take their input from `attachCameraGestures` (`gestures.ts`): pointer drag with momentum, two-finger pinch, ctrl+wheel and Safari gesture events, moving the camera in screen terms. Pointers are captured only once a press becomes a drag, so a plain click still reaches the tile it was pressed on.

## Photo library

`GallyLibrary` uses a Library Layout (`library-layout.ts`): a square grid in order, with zoom levels as target tile sizes. The scroll offset is the camera's position and the level is its zoom. Changing level reflows the grid, so the change animates as a screen-space zoom around one focus photo (`planLibraryZoom`). Levels with tiles under `denseCellSize` draw on Canvas in bands of GPU bitmaps; closer levels render DOM tiles.

A pinch (`library-pinch.ts` holds its math) keeps every grid on screen as a camera, `screen = scale × content + offset`, written as one transform per frame. Heading for another level, the outgoing grid becomes a copy laid over the page (its DOM tiles cloned, or its canvas bands handed over as they are), with an opaque background so fading it gives the true mix of both grids; the incoming level renders underneath as a React transition, so the fingers keep moving the copy while it does. The dissolve follows pinch progress through a fitted curve with a short lag, the cameras stay within the grid's edges, and a release springs the target grid's scale and the point under the fingers to rest together, with the copy following through the same relative camera. The springs are sampled into Web Animations keyframes, which the compositor runs; a pinch that catches one evaluates it where it is rather than reading styles back.
