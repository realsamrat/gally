# Stable transform layers during pan and zoom

Gally keeps camera movement out of React's per-photo render path. During pan and zoom, the camera updates shared transform layers for the photo surface and its wrapped rows, while React remains responsible for stable structure, controls, and non-frame-critical state. This avoids the "puzzle" effect where individual tiles appear to reposition themselves instead of the canvas moving as one surface.

**Considered Options**

- React-render every visible tile position on each camera update.
- Move the photo surface and row strips imperatively from camera state.

We chose stable transform layers because the product is a pannable portfolio first, not a document editor. Smooth perceived movement matters more than making each frame a React render.
