import { normalizePhotoSources } from './photo-sources.js';
import { defaultRowLayoutOptions, packRows, rowsPeriodY, rowTop, shuffledOrder } from './row-layout.js';
export const defaultLayoutOptions = {
    ...defaultRowLayoutOptions,
    horizontalCopies: 3,
    verticalCopies: 3,
};
/** Id of a row's wrapping group: the wrapped engine repeats every tile in a group by its period. */
export const rowGroupId = (rowIndex) => `row-${rowIndex}`;
/** Id of one copy of a photo in the wrapped surface. */
export const wrappedTileId = (vy, rowIndex, hx, photoId) => `${vy}:${rowIndex}:${hx}:${photoId}`;
export function buildWrappedPhotoLayout(photos, options = {}) {
    const config = { ...defaultLayoutOptions, ...options };
    const rows = packRows(photos, shuffledOrder(photos.length, config.seed), config).map((row) => ({
        tiles: row.tiles,
        width: row.period,
    }));
    const periodY = rowsPeriodY(config);
    const groups = rows.map((row, rowIndex) => ({
        id: rowGroupId(rowIndex),
        periodX: row.width,
    }));
    const tiles = [];
    for (let vy = 0; vy < config.verticalCopies; vy++) {
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const row = rows[rowIndex];
            if (!row)
                continue;
            for (let hx = 0; hx < config.horizontalCopies; hx++) {
                for (const tile of row.tiles) {
                    const photo = photos[tile.index];
                    if (!photo)
                        continue;
                    const metadata = {
                        groupId: rowGroupId(rowIndex),
                        index: tile.index,
                        row: rowIndex,
                        vy,
                        hx,
                    };
                    if (photo.metadata !== undefined)
                        metadata.userMetadata = photo.metadata;
                    const photoTile = {
                        id: wrappedTileId(vy, rowIndex, hx, photo.id),
                        x: hx * row.width + tile.x,
                        y: vy * periodY + rowTop(rowIndex, config),
                        width: tile.width,
                        height: config.rowHeight,
                        sources: normalizePhotoSources(photo),
                        metadata,
                    };
                    if (photo.alt !== undefined)
                        photoTile.alt = photo.alt;
                    if (photo.dominantColor !== undefined)
                        photoTile.dominantColor = photo.dominantColor;
                    tiles.push(photoTile);
                }
            }
        }
    }
    return { rows, groups, tiles, periodY };
}
//# sourceMappingURL=wrapped-layout.js.map