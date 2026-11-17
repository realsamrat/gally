import { makeBounds } from './geometry.js';
/** Phones: Apple Photos' 1, 3, 5, 15 and 33 columns, at any phone width. */
export const phoneLibraryColumns = [1, 3, 5, 15, 33];
/** Wider screens: four even steps of tile size, e.g. 4, 7, 14 and 29 columns at 1440 px. */
export const wideLibraryLevels = [400, 200, 100, 48];
/** The default levels for a screen this wide (level 1 is the standard view on either). */
export function defaultLibraryLevels(width) {
    return width > 0 && width < 600 ? { levels: wideLibraryLevels, columns: phoneLibraryColumns } : { levels: wideLibraryLevels };
}
/** How many levels there are. */
export function libraryLevelCount(options = defaultLibraryLayoutOptions) {
    return options.columns?.length ?? options.levels.length;
}
export const defaultLibraryLayoutOptions = {
    gap: 2,
    levels: wideLibraryLevels,
    insetTop: 0,
    insetBottom: 0,
};
export function getLibraryColumns(width, level, options = defaultLibraryLayoutOptions) {
    if (options.columns)
        return Math.max(1, Math.round(options.columns[clampLevel(level, options)]));
    const target = options.levels[clampLevel(level, options)];
    return Math.max(1, Math.round((width + options.gap) / (target + options.gap)));
}
function clampLevel(level, options = defaultLibraryLayoutOptions) {
    return Math.min(libraryLevelCount(options) - 1, Math.max(0, Math.round(level)));
}
export function getLibraryCellSize(width, columns, options = defaultLibraryLayoutOptions) {
    return Math.max(1, (width - options.gap * (columns - 1)) / columns);
}
export function getLibraryGeometry(viewport, count, columns, options = defaultLibraryLayoutOptions) {
    const { gap, insetTop, insetBottom } = options;
    const cell = getLibraryCellSize(viewport.width, columns, options);
    const pitch = cell + gap;
    const rows = Math.max(0, Math.ceil(count / columns));
    const contentHeight = insetTop + Math.max(0, rows * pitch - gap) + insetBottom;
    return {
        viewport,
        count,
        columns,
        cell,
        pitch,
        rows,
        contentHeight,
        maxScroll: Math.max(0, contentHeight - viewport.height),
        gap,
        insetTop,
        insetBottom,
    };
}
/** A tile's rectangle in content coordinates. */
export function getLibraryTileRect(index, geometry) {
    const column = index % geometry.columns;
    const row = Math.floor(index / geometry.columns);
    return makeBounds(column * geometry.pitch, geometry.insetTop + row * geometry.pitch, geometry.cell, geometry.cell);
}
/** The tile at a point in content coordinates, or the nearest one when the point is in a gap or margin. */
export function getLibraryIndexAt(x, y, geometry) {
    const column = clamp(Math.floor(x / geometry.pitch), 0, geometry.columns - 1);
    const row = clamp(Math.floor((y - geometry.insetTop) / geometry.pitch), 0, Math.max(0, geometry.rows - 1));
    return clamp(row * geometry.columns + column, 0, Math.max(0, geometry.count - 1));
}
export function getLibraryWindows(geometry, scrollTop, overscanRows = 3) {
    const { pitch, viewport, insetTop, insetBottom } = geometry;
    // Rows whose tiles cross [top, bottom) in content coordinates.
    const rowsBetween = (top, bottom) => ({
        from: Math.floor((top - geometry.insetTop + geometry.gap) / pitch),
        to: Math.floor((bottom - geometry.insetTop - 1) / pitch),
    });
    // On screen: between the app's chrome (`insetTop`, `insetBottom`). Rendered: the whole viewport,
    // since tiles under translucent chrome still show, plus overscan rows on each side.
    const onScreen = rowsBetween(scrollTop + insetTop, scrollTop + viewport.height - insetBottom);
    const shown = rowsBetween(scrollTop, scrollTop + viewport.height);
    return {
        visible: rowRange(geometry, onScreen.from, onScreen.to),
        preload: rowRange(geometry, shown.from - overscanRows, shown.to + overscanRows),
    };
}
/**
 * Windows for a span of content rather than a scroll position, e.g. what a pinch shows while it
 * scales the grid: `visible` covers `[visibleTop, visibleBottom)`, `preload` `[top, bottom)`.
 */
export function getLibraryWindowsForSpan(geometry, span) {
    const row = (y) => Math.floor((y - geometry.insetTop) / geometry.pitch);
    return {
        visible: rowRange(geometry, row(span.visibleTop + geometry.gap), row(span.visibleBottom - 1)),
        preload: rowRange(geometry, row(span.top), row(span.bottom)),
    };
}
function rowRange(geometry, from, to) {
    if (geometry.count === 0)
        return { start: 0, end: -1, firstRow: 0, lastRow: -1 };
    const lastRow = Math.max(0, geometry.rows - 1);
    const firstRow = clamp(from, 0, lastRow);
    const last = clamp(Math.max(to, firstRow), 0, lastRow);
    return {
        firstRow,
        lastRow: last,
        start: Math.min(geometry.count - 1, firstRow * geometry.columns),
        end: Math.min(geometry.count - 1, (last + 1) * geometry.columns - 1),
    };
}
/** Scroll offset that shows a photo: at the top, centred, or (`nearest`) moving as little as possible from `scrollTop`. */
export function scrollTopForIndex(index, geometry, align, scrollTop = 0) {
    const rect = getLibraryTileRect(index, geometry);
    const top = rect.y - geometry.insetTop;
    const bottom = rect.maxY - geometry.viewport.height + geometry.insetBottom;
    const target = align === 'start'
        ? top
        : align === 'center'
            ? rect.y + rect.height / 2 - geometry.viewport.height / 2
            : align === 'end'
                ? bottom
                : scrollTop > top
                    ? top
                    : scrollTop < bottom
                        ? bottom
                        : scrollTop;
    return clamp(target, 0, geometry.maxScroll);
}
/** Where a photo of this size sits in a square tile: filling it (`square`, cropped) or fitted whole (`aspect`). */
export function fitPhotoInTile(tile, photoWidth, photoHeight, fit) {
    if (fit === 'square' || photoWidth <= 0 || photoHeight <= 0)
        return tile;
    const scale = Math.min(tile.width / photoWidth, tile.height / photoHeight);
    const width = photoWidth * scale;
    const height = photoHeight * scale;
    return makeBounds(tile.x + (tile.width - width) / 2, tile.y + (tile.height - height) / 2, width, height);
}
/** The next level in `direction` (-1 zooms in) that actually changes the column count. */
export function stepLibraryLevel(level, direction, width, options = defaultLibraryLayoutOptions) {
    const current = getLibraryColumns(width, level, options);
    for (let next = level + direction; next >= 0 && next < libraryLevelCount(options); next += direction) {
        if (getLibraryColumns(width, next, options) !== current)
            return next;
    }
    return level;
}
/** The level whose tile size is closest, on a log scale, to `cellSize`. Used to snap a pinch. */
export function nearestLibraryLevel(cellSize, width, options = defaultLibraryLayoutOptions) {
    let best = 0;
    let bestDistance = Infinity;
    for (let level = 0; level < libraryLevelCount(options); level++) {
        const cell = getLibraryCellSize(width, getLibraryColumns(width, level, options), options);
        const distance = Math.abs(Math.log(cell / cellSize));
        if (distance < bestDistance) {
            best = level;
            bestDistance = distance;
        }
    }
    return best;
}
/**
 * Plan a level change around a focus photo.
 *
 * @param from Where the focus photo is on screen now (may include a pinch in progress).
 * @param focusY Screen y of the focus point (pointer, or the photo's centre).
 */
export function planLibraryZoom(next, index, from, focusY) {
    const fy = clamp((focusY - from.y) / from.size, 0, 1);
    const rect = getLibraryTileRect(index, next);
    const scrollTop = clamp(rect.y + fy * next.cell - focusY, 0, next.maxScroll);
    const scale = next.cell / from.size;
    return { scrollTop, scale, translateX: rect.x - scale * from.x, translateY: rect.y - scrollTop - scale * from.y };
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
//# sourceMappingURL=library-layout.js.map