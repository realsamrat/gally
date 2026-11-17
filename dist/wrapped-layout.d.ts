import { type RowLayoutOptions } from './row-layout.js';
import type { GallyPhoto, PhotoTile, WrappedPhotoGroup, WrappedPhotoMetadata } from './types.js';
export type GallyRowTile = {
    index: number;
    x: number;
    width: number;
};
export type GallyRow = {
    tiles: GallyRowTile[];
    /** The row's period: its photos and gaps, including the gap before it repeats. */
    width: number;
};
export type GallyWrappedPhotoMetadata<Metadata = unknown> = WrappedPhotoMetadata & {
    index: number;
    row: number;
    vy: number;
    hx: number;
    userMetadata?: Metadata;
};
export type GallyWrappedLayout<Metadata = unknown> = {
    rows: GallyRow[];
    groups: WrappedPhotoGroup[];
    tiles: Array<PhotoTile<GallyWrappedPhotoMetadata<Metadata>>>;
    periodY: number;
};
export type GallyLayoutOptions = RowLayoutOptions & {
    horizontalCopies: number;
    verticalCopies: number;
};
export declare const defaultLayoutOptions: GallyLayoutOptions;
/** Id of a row's wrapping group: the wrapped engine repeats every tile in a group by its period. */
export declare const rowGroupId: (rowIndex: number) => string;
/** Id of one copy of a photo in the wrapped surface. */
export declare const wrappedTileId: (vy: number, rowIndex: number, hx: number, photoId: string) => string;
export declare function buildWrappedPhotoLayout<Metadata = unknown>(photos: Array<GallyPhoto<Metadata>>, options?: Partial<GallyLayoutOptions>): GallyWrappedLayout<Metadata>;
//# sourceMappingURL=wrapped-layout.d.ts.map