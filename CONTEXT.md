# Gally

Gally is a photo-first infinite canvas package for building image-dense portfolio experiences.

## Language

**Photo Tile**:
A positioned photo item in world space with dimensions, image sources, and optional metadata.
_Avoid_: Shape, object, node

**Photo Surface**:
The stable visual layer that contains rendered photo tiles and moves as a single canvas during pan and zoom.
_Avoid_: Grid, board, whiteboard

**Camera**:
The viewport state made of world-space `x`, `y`, and `zoom`.
_Avoid_: Scroll position, transform state

**Wrapped Layout**:
A repeating photo arrangement with row-specific horizontal periods and a shared vertical period.
_Avoid_: Infinite grid

**Preload Window**:
The expanded viewport region used to warm images before they become visible.
_Avoid_: Lazy area, buffer

**Library Layout**:
Photos in order on a square grid whose column count snaps between zoom levels, scrolled vertically.
_Avoid_: Masonry, table

**Image Loader**:
The shared image cache and scheduler. Consumers open a channel and demand the images their window needs.
_Avoid_: Preload queue

**Level Of Detail**:
The selected image source size for a photo tile at the current zoom and device pixel ratio.
_Avoid_: Responsive image mode

## Relationships

- A **Photo Surface** is viewed through exactly one **Camera**.
- A **Wrapped Layout** contains many **Photo Tiles**.
- A **Preload Window** contains the **Photo Tiles** near the current viewport.
- **Level Of Detail** is resolved per **Photo Tile** from the current **Camera**.

## Example Dialogue

> **Dev:** "Should we update every **Photo Tile** position in React when the user pans?"
> **Domain expert:** "No. The **Camera** changes, and the **Photo Surface** moves through stable transform layers."

## Flagged Ambiguities

- "Canvas" can mean the package, the visible DOM surface, or the mathematical viewport. Use **Photo Surface** for the rendered layer and **Camera** for viewport state.
- "Grid" can imply a fixed table. Use **Wrapped Layout** when rows repeat horizontally and vertically.
