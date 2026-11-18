# Changelog

## Unreleased

Changes since `0.3.0-alpha.1`.

### Added

- `GallyLibrary`: a photo library grid whose columns snap between zoom levels, with a pinch that follows the fingers. See `docs/library.md`.
- `GallyImageLoader`: one shared image cache and scheduler for every component, with a blob mode that fetches and decodes in a worker.
- A `ref` on both canvases with `getStats()`, `getElement()` and `getVisibleSources()`.
- The demo site (`site/`) and the benchmark playground (`playground/`).

### Changed

- `GallyLibrary`: a pinch lands on the level it is heading for from 40% of the way there instead of half, and a trackpad pinch moves the grid a little further for the same movement.
- `GallyCanvas` mounts only the tiles near the screen, so its `.gally__scale-layer`, `.gally__surface`, `.gally__strip` and `.gally__copy` elements are gone; tiles sit in one `.gally__layer`.
- `layout.horizontalCopies` and `layout.verticalCopies` are ignored: the layout wraps forever.
- The canvases' default loader is blob mode. Blob-mode images show from `blob:` URLs, so a Content Security Policy needs `img-src blob:`, or pass an element-mode loader.

### Deprecated

- `imageLoading`, `initialPriorityCount` and the `image*` tuning props on `GallyCanvas`. They are ignored: images load through the image loader and show once decoded.

## 0.3.0-alpha.1

- Public docs and a warm overview canvas for `GallyHybridCanvas`.

## 0.3.0-alpha.0

- `GallyHybridCanvas`: a Canvas 2D Overview Layer and a DOM Detail Layer over one photo scene.

## 0.2.1

- `GallyCanvas` restored as the stable single-surface renderer.
