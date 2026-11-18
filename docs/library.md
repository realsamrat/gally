# GallyLibrary

`GallyLibrary` is a photo library grid: photos in order on a square grid whose column count snaps between zoom levels, scrolled vertically. Dense levels draw on Canvas and close levels render DOM tiles, from one shared image loader.

It owns the grid: layout, zoom levels, pinch, rendering and image loading. Headers, tabs, albums and the viewer stay in your app.

```tsx
import { useRef } from "react"
import { GallyLibrary, type GallyLibraryHandle } from "gally/react"
import "gally/styles.css"

export function Library({ photos }) {
  const library = useRef<GallyLibraryHandle>(null)
  return (
    <GallyLibrary
      ref={library}
      photos={photos}
      layout={{ insetTop: 76, insetBottom: 104 }}
      initialScroll="end"
      onOpenPhoto={({ index }) => openViewer(index)}
    />
  )
}
```

## Levels

A level is one column count. By default a phone gets five levels (1, 3, 5, 15 and 33 columns, at any phone width) and wider screens four even steps of tile size (4, 7, 14 and 29 columns at 1440 px). Level 1 is the standard view on both.

- `layout.levels` sets your own levels as tile sizes in CSS pixels, largest first.
- `layout.columns` sets them as column counts instead, whatever the width.
- `defaultLevel` is the level it opens on, and `standardLevel` the one a click returns to when zoomed out further.
- `layout.insetTop` and `layout.insetBottom` leave room for app chrome laid over the grid.
- `fit` is `"square"` (cropped tiles) or `"aspect"` (whole photos inside square cells).

Tiles smaller than `denseCellSize` (110 px by default) draw on Canvas; `renderer="dom"` always uses DOM tiles.

## Zooming

Zoom changes level around the photo under the pointer, so that photo stays where it is.

- Pinch with two fingers, or on a trackpad.
- ⌘+ and ⌘− (Ctrl on Windows) while the grid has focus.
- `zoomIn()`, `zoomOut()` and `zoomToLevel(level, focus?)` on the handle.
- Zoomed out past the standard level, a click zooms back in around the photo (`tapToZoom`).

## The pinch

A pinch works as in a phone's photo library. The grid follows the fingers' spread and centre. Heading for another level, that level's grid takes over underneath a copy of the current one, placed so the photos show at the same size and the point under the fingers keeps its row. The two dissolve as the pinch progresses, not on a timer, so pinching back reverses the dissolve.

Grids stay within their edges as they scale, like a zooming scroll view: no gap opens above the first row or beside the grid. Letting go lands on the level the pinch was heading for once it is 40% of the way there, judged a moment ahead by the fingers' speed, and otherwise returns to the level it left. Either way it springs scale and position together (critically damped, about 12.5 rad/s, carrying the fingers' speed). Past the closest level the grid stretches up to about 1.6×, past the densest it gives a little, and both spring back.

Each frame only writes transforms and an opacity. The copy reuses what is already drawn, and the new level renders without blocking the fingers.

`onPinch` reports a pinch as it happens: the level mostly on screen, its scale, and the fingers' own zoom.

## The handle

| Method | What it does |
| --- | --- |
| `focus()` | Focus the grid, so arrow keys, Enter and ⌘+ / ⌘− work |
| `zoomIn()`, `zoomOut()` | Step one level |
| `zoomToLevel(level, focus?)` | Go to a level around a point, a photo index, or the selection |
| `scrollToIndex(index, align?)` | Scroll a photo into view |
| `getTileRect(index)` | A photo's rectangle on screen, for viewer transitions |
| `getLoadedImage(index)` | The sharpest image already loaded for a photo |
| `getVisibleWindow()` | The photos on screen and the image URL each wants |
| `getScrollElement()` | The element that scrolls |
| `getStats()` | A debug snapshot: level, renderer, tiles on screen, loader counters |

## Debugging a pinch

In the playground, `?debug=1` shows a one-line pinch indicator and records every pinch to `/api/pinch-logs` (and the browser), tagged with who made it (`?tester=` names it; automated browsers say so). It turns red only when levels flip back and forth while the fingers don't. `npm run pinch-logs` lists the recordings and prints one pinch by pinch.
