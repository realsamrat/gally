# Gally Release Checklist

Gally is ready to publish when these are true:

- The package builds with `npm run build`.
- A consuming app can import `gally`, `gally/react`, and `gally/styles.css`.
- The canvas pans by moving shared transform layers, not by updating every tile through React.
- The default reveal is CSS-only: opacity plus a subtle `0.97` to `1` scale.
- The default React canvas avoids blur filters for dense image surfaces.
- Pan-scale motion scales photo tiles only, not the whole canvas, and does not use per-tile JavaScript updates.
- First-viewport images load first, through the image loader.
- Cursor morph behavior is not included.
- Selection is exposed through `onSelectPhoto`; lightbox UI stays optional and app-owned until a separate UI package exists.

Before a stable release, add:

- Browser performance traces for fast pan, wheel pan, and pinch zoom.
- DOM culling or renderer escape hatch notes for very large canvases.
- Source-level LOD switching in the rendered image component.

Hybrid alpha checklist:

- `GallyHybridCanvas` exports from `gally/react`.
- The default overview renderer is Canvas 2D, not a second DOM grid.
- DOM detail mounts a bounded nearby set.
- The crossfade band is narrow and configurable.
- The stable `GallyCanvas` path remains available for restore/comparison.

Library checklist:

- `GallyLibrary` exports from `gally/react`.
- All components share image loading through `GallyImageLoader` channels.
- The playground benchmark scores 98 or more on the hosted site (`?autorun=1`).

Demo site checklist:

- `npm run build:site` passes and the site deploys (`npm run deploy:site -- --prod`).
- Each demo works with a mouse, a trackpad and touch, inline and full screen.
- The site's install command and GitHub link point at the public repository.
