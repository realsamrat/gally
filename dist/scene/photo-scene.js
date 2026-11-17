import { boundsIntersect, expandBounds, getViewportWorldBounds, makeBounds } from '../geometry.js';
import { normalizePhotoSources } from '../photo-sources.js';
import { defaultRowLayoutOptions, packRows, rowsPeriodY, rowTop, shuffledOrder } from '../row-layout.js';
export const defaultHybridLayoutOptions = {
    detailRowHeight: defaultRowLayoutOptions.rowHeight,
    detailRowGap: defaultRowLayoutOptions.rowGap,
    detailColumnGap: defaultRowLayoutOptions.columnGap,
    detailRowCount: defaultRowLayoutOptions.rowCount,
    overviewTileSize: 112,
    overviewGap: 8,
    seed: defaultRowLayoutOptions.seed,
};
export function buildPhotoScene(photos, options = {}) {
    const config = { ...defaultHybridLayoutOptions, ...options };
    const rowOptions = {
        rowHeight: config.detailRowHeight,
        rowGap: config.detailRowGap,
        columnGap: config.detailColumnGap,
        rowCount: config.detailRowCount,
        seed: config.seed,
    };
    const order = shuffledOrder(photos.length, config.seed);
    const detailRows = packRows(photos, order, rowOptions);
    const overviewColumns = config.overviewColumns ?? pickOverviewColumns(photos.length);
    const overviewStep = config.overviewTileSize + config.overviewGap;
    const overviewRows = Math.max(1, Math.ceil(photos.length / overviewColumns));
    const overviewByIndex = new Map();
    order.forEach((index, orderIndex) => {
        const column = orderIndex % overviewColumns;
        const row = Math.floor(orderIndex / overviewColumns);
        overviewByIndex.set(index, makeBounds(column * overviewStep, row * overviewStep, config.overviewTileSize, config.overviewTileSize));
    });
    const tiles = [];
    const rowsSummary = [];
    detailRows.forEach((row, rowIndex) => {
        const y = rowTop(rowIndex, rowOptions);
        const tileIds = [];
        row.tiles.forEach((tile) => {
            const photo = photos[tile.index];
            const overviewRect = overviewByIndex.get(tile.index);
            if (!photo || !overviewRect)
                return;
            const id = photo.id;
            const sceneTile = {
                id,
                index: tile.index,
                photo,
                detailRect: makeBounds(tile.x, y, tile.width, config.detailRowHeight),
                detailRowIndex: rowIndex,
                detailRowWidth: row.width,
                overviewRect,
                sources: normalizePhotoSources(photo),
            };
            if (photo.alt !== undefined)
                sceneTile.alt = photo.alt;
            if (photo.dominantColor !== undefined)
                sceneTile.dominantColor = photo.dominantColor;
            if (photo.metadata !== undefined)
                sceneTile.metadata = photo.metadata;
            tileIds.push(id);
            tiles.push(sceneTile);
        });
        rowsSummary.push({ y, height: config.detailRowHeight, width: row.width, tileIds });
    });
    return {
        tiles,
        detailBounds: unionRects(tiles.map((tile) => tile.detailRect)),
        overviewBounds: unionRects(tiles.map((tile) => tile.overviewRect)),
        detailRows: rowsSummary,
        overviewColumns,
        detailWrapGap: config.detailColumnGap,
        detailPeriodX: Math.max(...detailRows.map((row) => row.width), 1) + config.detailColumnGap,
        detailPeriodY: rowsPeriodY(rowOptions),
        overviewPeriodX: overviewColumns * overviewStep,
        overviewPeriodY: overviewRows * overviewStep,
    };
}
export function getCameraWorldBounds(camera, viewport, overscanScreenPx = 0) {
    const bounds = getViewportWorldBounds(camera, viewport);
    return overscanScreenPx > 0 ? expandBounds(bounds, overscanScreenPx / camera.zoom) : bounds;
}
export function queryPhotoScene(scene, camera, viewport, mode, options = {}) {
    const bounds = getCameraWorldBounds(camera, viewport, options.overscanScreenPx ?? 0);
    const limit = options.limit ?? Number.POSITIVE_INFINITY;
    const matches = [];
    for (const tile of scene.tiles) {
        const rect = mode === 'overview' ? tile.overviewRect : tile.detailRect;
        if (!boundsIntersect(bounds, rect))
            continue;
        matches.push(tile);
        if (matches.length >= limit)
            break;
    }
    return matches;
}
export function queryWrappedPhotoScene(scene, camera, viewport, mode, options = {}) {
    const bounds = getCameraWorldBounds(camera, viewport, options.overscanScreenPx ?? 0);
    const limit = options.limit ?? Number.POSITIVE_INFINITY;
    const periodX = mode === 'overview' ? scene.overviewPeriodX : scene.detailPeriodX;
    const periodY = mode === 'overview' ? scene.overviewPeriodY : scene.detailPeriodY;
    const matches = [];
    if (periodX <= 0 || periodY <= 0)
        return matches;
    if (mode === 'detail') {
        const startY = Math.floor(bounds.minY / periodY) - 1;
        const endY = Math.ceil(bounds.maxY / periodY) + 1;
        for (let wrapY = startY; wrapY <= endY; wrapY++) {
            const offsetY = wrapY * periodY;
            for (const tile of scene.tiles) {
                const rowPeriodX = detailRowPeriodX(scene, tile);
                const startX = Math.floor(bounds.minX / rowPeriodX) - 1;
                const endX = Math.ceil(bounds.maxX / rowPeriodX) + 1;
                for (let wrapX = startX; wrapX <= endX; wrapX++) {
                    const offsetX = wrapX * rowPeriodX;
                    const rect = makeBounds(tile.detailRect.x + offsetX, tile.detailRect.y + offsetY, tile.detailRect.width, tile.detailRect.height);
                    if (!boundsIntersect(bounds, rect))
                        continue;
                    matches.push({
                        ...tile,
                        id: `${tile.id}:${wrapX}:${wrapY}`,
                        baseId: tile.id,
                        wrapX,
                        wrapY,
                        detailRect: rect,
                        overviewRect: makeBounds(tile.overviewRect.x + wrapX * scene.overviewPeriodX, tile.overviewRect.y + wrapY * scene.overviewPeriodY, tile.overviewRect.width, tile.overviewRect.height),
                    });
                }
            }
        }
        return limit === Number.POSITIVE_INFINITY
            ? matches
            : sortByDetailDistanceToCenter(matches, bounds).slice(0, limit);
    }
    const startX = Math.floor(bounds.minX / periodX) - 1;
    const endX = Math.ceil(bounds.maxX / periodX) + 1;
    const startY = Math.floor(bounds.minY / periodY) - 1;
    const endY = Math.ceil(bounds.maxY / periodY) + 1;
    for (let wrapY = startY; wrapY <= endY; wrapY++) {
        for (let wrapX = startX; wrapX <= endX; wrapX++) {
            const offsetX = wrapX * periodX;
            const offsetY = wrapY * periodY;
            for (const tile of scene.tiles) {
                const baseRect = tile.overviewRect;
                const rect = makeBounds(baseRect.x + offsetX, baseRect.y + offsetY, baseRect.width, baseRect.height);
                if (!boundsIntersect(bounds, rect))
                    continue;
                matches.push({
                    ...tile,
                    id: `${tile.id}:${wrapX}:${wrapY}`,
                    baseId: tile.id,
                    wrapX,
                    wrapY,
                    detailRect: makeBounds(tile.detailRect.x + offsetX, tile.detailRect.y + offsetY, tile.detailRect.width, tile.detailRect.height),
                    overviewRect: rect,
                });
                if (matches.length >= limit)
                    return matches;
            }
        }
    }
    return matches;
}
function pickOverviewColumns(length) {
    const preferred = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, length) * 1.45)));
    let best = preferred;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let columns = 1; columns <= Math.max(1, length); columns++) {
        if (length % columns !== 0)
            continue;
        const distance = Math.abs(columns - preferred);
        if (distance >= bestDistance)
            continue;
        best = columns;
        bestDistance = distance;
    }
    return bestDistance <= preferred * 0.5 ? best : preferred;
}
function sortByDetailDistanceToCenter(tiles, bounds) {
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    return [...tiles].sort((a, b) => {
        const rectA = a.detailRect;
        const rectB = b.detailRect;
        const ax = rectA.x + rectA.width / 2 - centerX;
        const ay = rectA.y + rectA.height / 2 - centerY;
        const bx = rectB.x + rectB.width / 2 - centerX;
        const by = rectB.y + rectB.height / 2 - centerY;
        return ax * ax + ay * ay - (bx * bx + by * by);
    });
}
function unionRects(rects) {
    if (rects.length === 0)
        return makeBounds(0, 0, 0, 0);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const rect of rects) {
        minX = Math.min(minX, rect.minX);
        minY = Math.min(minY, rect.minY);
        maxX = Math.max(maxX, rect.maxX);
        maxY = Math.max(maxY, rect.maxY);
    }
    return makeBounds(minX, minY, maxX - minX, maxY - minY);
}
/** Distance after which a tile's detail row repeats horizontally. */
export function detailRowPeriodX(scene, tile) {
    return Math.max(1, tile.detailRowWidth + scene.detailWrapGap);
}
//# sourceMappingURL=photo-scene.js.map