import { boundsIntersect, makeBounds } from './geometry.js';
export class PhotoSpatialIndex {
    cellSize;
    cells = new Map();
    tileCells = new Map();
    tiles = new Map();
    constructor(options = { cellSize: 1024 }) {
        this.cellSize = options.cellSize;
    }
    get size() {
        return this.tiles.size;
    }
    set(tile) {
        this.delete(tile.id);
        this.tiles.set(tile.id, tile);
        const keys = this.getCellKeys(this.getTileBounds(tile));
        this.tileCells.set(tile.id, keys);
        for (const key of keys) {
            let cell = this.cells.get(key);
            if (!cell) {
                cell = new Set();
                this.cells.set(key, cell);
            }
            cell.add(tile.id);
        }
    }
    setMany(tiles) {
        for (const tile of tiles)
            this.set(tile);
    }
    get(id) {
        return this.tiles.get(id);
    }
    getAll() {
        return Array.from(this.tiles.values());
    }
    delete(id) {
        const keys = this.tileCells.get(id);
        if (!keys)
            return;
        for (const key of keys) {
            const cell = this.cells.get(key);
            if (!cell)
                continue;
            cell.delete(id);
            if (cell.size === 0)
                this.cells.delete(key);
        }
        this.tileCells.delete(id);
        this.tiles.delete(id);
    }
    clear() {
        this.cells.clear();
        this.tileCells.clear();
        this.tiles.clear();
    }
    search(bounds) {
        const ids = new Set();
        for (const key of this.getCellKeys(bounds)) {
            const cell = this.cells.get(key);
            if (!cell)
                continue;
            for (const id of cell)
                ids.add(id);
        }
        const result = [];
        for (const id of ids) {
            const tile = this.tiles.get(id);
            if (!tile)
                continue;
            if (boundsIntersect(this.getTileBounds(tile), bounds))
                result.push(tile);
        }
        return result;
    }
    getTileBounds(tile) {
        return makeBounds(tile.x, tile.y, tile.width, tile.height);
    }
    getCellKeys(bounds) {
        const minCellX = Math.floor(bounds.minX / this.cellSize);
        const maxCellX = Math.floor(bounds.maxX / this.cellSize);
        const minCellY = Math.floor(bounds.minY / this.cellSize);
        const maxCellY = Math.floor(bounds.maxY / this.cellSize);
        const keys = new Set();
        for (let x = minCellX; x <= maxCellX; x++) {
            for (let y = minCellY; y <= maxCellY; y++) {
                keys.add(`${x}:${y}`);
            }
        }
        return keys;
    }
}
//# sourceMappingURL=spatial-index.js.map