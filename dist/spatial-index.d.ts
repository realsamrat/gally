import type { Bounds, PhotoId, PhotoTile } from './types.js';
export type SpatialIndexOptions = {
    cellSize: number;
};
export declare class PhotoSpatialIndex<Metadata = unknown> {
    private readonly cellSize;
    private readonly cells;
    private readonly tileCells;
    private readonly tiles;
    constructor(options?: SpatialIndexOptions);
    get size(): number;
    set(tile: PhotoTile<Metadata>): void;
    setMany(tiles: Array<PhotoTile<Metadata>>): void;
    get(id: PhotoId): PhotoTile<Metadata> | undefined;
    getAll(): Array<PhotoTile<Metadata>>;
    delete(id: PhotoId): void;
    clear(): void;
    search(bounds: Bounds): Array<PhotoTile<Metadata>>;
    getTileBounds(tile: PhotoTile<Metadata>): Bounds;
    private getCellKeys;
}
//# sourceMappingURL=spatial-index.d.ts.map