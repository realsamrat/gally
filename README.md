# Gally

Gally is a photo-first infinite canvas engine for image-heavy portfolio experiences.

**[Try the demo](https://gallyjs.vercel.app)** · [Architecture](docs/architecture.md) · [Library](docs/library.md) · [Benchmarks](docs/benchmarks)

It puts photos on a surface you can drag, pinch and zoom, and keeps it smooth when there are thousands of them. One engine, three React components:

| Component | What it is | Reach for it when |
| --- | --- | --- |
| `GallyCanvas` | A wall of photos that wraps forever in every direction | A portfolio home, where wandering is the point |
| `GallyHybridCanvas` | The same wall with two renderers: Canvas 2D zoomed out, DOM up close | An archive, where you want to see everything and then one thing |
| `GallyLibrary` | Photos in order on a grid whose columns snap between zoom levels | A camera roll or a client gallery, where the order matters |

Current version: `0.3.0-alpha.1`. `GallyCanvas` is the stable baseline; `GallyHybridCanvas` is alpha and its API may still change.

## Install

Gally isn't on npm yet (the name `gally` there belongs to an unrelated package), so install it from GitHub:

```bash
npm install github:realsamrat/gally
```

It needs React 18 or 19.

## Usage

```tsx
import { GallyCanvas } from "gally/react"
import "gally/styles.css"

const photos = [
  { id: "portrait-1", width: 1200, height: 1600, src: "/photos/portrait-1.webp", alt: "Studio portrait" },
  { id: "portrait-2", width: 1600, height: 1200, src: "/photos/portrait-2.webp", alt: "Editorial portrait" },
]

export function Portfolio() {
  return (
    <GallyCanvas
      photos={photos}
      theme={{ background: "dotted" }}
      onSelectPhoto={({ photo }) => openLightbox(photo)}
    />
  )
}
```

The component fills its parent, so give the parent a size.

### GallyCanvas

The stable single-surface renderer:

- pan and zoom: drag, flick with momentum, two-finger pinch, trackpad pinch and scroll, Safari gesture events, and zoom controls
- a wrapped row layout that repeats forever in both directions
- virtualized Photo Tiles: only tiles near the screen are mounted, in one layer the camera moves
- images from Gally's image loader, decoded before they show, at the size the zoom needs
- a plain or dotted background, hover scale, and a CSS-only reveal
- a selection callback for your own lightbox (a drag or pinch never selects)

### GallyHybridCanvas

The alpha renderer for denser canvases. It keeps two renderers over one photo scene:

- a Canvas 2D Overview Layer for far zoom, at contact-sheet density
- a DOM Detail Layer for close zoom, with buttons, hover, selection and accessibility

It takes the same gestures as `GallyCanvas`, from anywhere on the canvas. Tapping a photo in the overview zooms into it.

```tsx
<GallyHybridCanvas
  photos={photos}
  theme={{ background: "dotted" }}
  overviewZoom={0.56}
  detailZoom={0.72}
  detailMaxTiles={120}
  onSelectPhoto={({ photo }) => openLightbox(photo)}
/>
```

### GallyLibrary

A photo library grid: photos in order on a square grid whose column count snaps between zoom levels, with pinch, trackpad and keyboard zoom around the photo under the pointer. Dense levels draw on Canvas and close levels render DOM tiles.

```tsx
import { useRef } from "react"
import { GallyLibrary, type GallyLibraryHandle } from "gally/react"

export function Library({ photos }) {
  const library = useRef<GallyLibraryHandle>(null)
  return (
    <GallyLibrary
      ref={library}
      photos={photos}
      initialScroll="end"
      onOpenPhoto={({ index }) => openViewer(index)}
    />
  )
}
```

The handle zooms (`zoomIn`, `zoomOut`, `zoomToLevel`), scrolls (`scrollToIndex`), and reports tile rectangles and loaded images for viewer transitions (`getTileRect`, `getLoadedImage`). Headers, tabs and the viewer stay in your app. [docs/library.md](docs/library.md) covers levels, the pinch and its tuning.

## Photos

Start with one URL per photo:

```ts
{ id: "photo-1", width: 1200, height: 1600, src: "/photos/photo-1.webp" }
```

For many photos or large files, give each one a few sizes and Gally picks the smallest that still looks sharp at the current zoom:

```ts
{
  id: "photo-1",
  width: 1200,
  height: 1600,
  sources: {
    thumb: "/photos/photo-1-160.webp",
    small: "/photos/photo-1-400.webp",
    medium: "/photos/photo-1-800.webp",
    large: "/photos/photo-1-1600.webp",
  },
  // Optional: a ~24 px inline preview, shown until a real size loads (GallyLibrary).
  placeholder: "data:image/jpeg;base64,...",
}
```

## Image loader

`GallyImageLoader` is the engine's image cache and scheduler. Each component opens a channel and states what its current window needs; the loader starts on-screen images first, drops work nobody needs any more, keeps decoded images for reuse, and adapts to the network it observes.

By default the canvases share one blob-mode loader: images fetch and decode in a worker, and images from hosts without CORS load as plain image elements. Blob-mode images show from `blob:` URLs, so a Content Security Policy needs `img-src blob:`. Otherwise pass an element-mode loader, made once at module scope:

```ts
import { GallyImageLoader } from "gally"

const loader = new GallyImageLoader() // element mode
// <GallyCanvas loader={loader} />, <GallyLibrary loader={loader} />
```

Pass the same loader to several components to share its cache.

## How it works

```txt
photos -> scene -> camera -> visible window -> renderer
```

- Photos stay in world space. The camera is `x`, `y` and `zoom`.
- Panning and zooming move stable transform layers. React doesn't update every tile on each frame.
- Visibility is a 2D world-bounds query, with a Preload Window around the screen that warms images.
- Each photo's image size comes from the zoom and the device pixel ratio.
- Renderers are replaceable: DOM, Canvas 2D, or both.

The [demo](https://gallyjs.vercel.app) shows each of these as an interactive figure, and [docs/architecture.md](docs/architecture.md) has the details.

## What Gally owns

Gally owns the camera, the photo scene and its layouts, visible and preload windows, image loading, level-of-detail source selection, the pan and zoom gestures, and the renderers.

Your app owns the photo data and image pipeline, routing, the lightbox or viewer, analytics, headers and overlays, and any custom cursor.

## Positioning

Gally does not claim to invent infinite canvas interaction. Camera math, viewport culling, preloading and level-of-detail rendering are established patterns. Its value is the photo-first product shape, the API, the renderer boundary and the interaction tuning:

- the core primitive is a photo, not a generic drawing shape
- pan and zoom stay stable under dense image load
- image loading is part of the engine, not an afterthought

## Repository

```txt
src/          the package: engine, layouts, image loader, renderers, React components
styles/       the packaged CSS
dist/         build output, committed so installs from GitHub work
site/         the demo site (gallyjs.vercel.app)
playground/   the benchmark playground: both canvases and the library, with a benchmark panel
scripts/      sample photos, benchmarks, checks and deploys
docs/         architecture, the library, decisions, benchmarks, release checklist
```

## Development

```bash
npm install
npm run fixtures     # download the sample photos the site and playground use
npm run dev:site     # the demo site
npm run dev          # the benchmark playground
npm run typecheck    # package, playground and demo site
npm run build        # the package, into dist
```

`npm run check:gestures` drives both canvases and the library with real touch and mouse input in Chrome, and `npm run check:renderer` checks the library's canvas renderer. `npm run bench:fps` and `npm run bench:trace` run the benchmarks behind [docs/benchmarks](docs/benchmarks).

The package publishes ESM from `dist`. If files under `src` change, run `npm run build` and commit `dist` with them.

Coding agents and LLMs: read `AGENTS.md`, `CONTEXT.md` and `llms.txt` first.

## Contributing

Bug reports, device testing, fixes and docs are all welcome. [CONTRIBUTING.md](CONTRIBUTING.md) says what fits, how to set up, and what a pull request needs. Ideas and questions go in [Discussions](https://github.com/realsamrat/gally/discussions).

## License

[MIT](LICENSE)
