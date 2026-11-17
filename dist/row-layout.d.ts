/**
 * Justified photo rows: photos in a seeded shuffled order, packed into a fixed number of rows of
 * roughly equal width at one row height. Shared by the Wrapped Layout and the hybrid photo scene.
 */
export type RowLayoutOptions = {
    rowHeight: number;
    rowGap: number;
    columnGap: number;
    rowCount: number;
    seed: number;
};
export declare const defaultRowLayoutOptions: RowLayoutOptions;
export type PackedRow = {
    tiles: Array<{
        index: number;
        x: number;
        width: number;
    }>;
    /** Width of the photos and the gaps between them. */
    width: number;
    /** Distance after which the row repeats when wrapped: its width plus one gap. */
    period: number;
};
/** Top of a row, before wrapping. */
export declare function rowTop(rowIndex: number, options: Pick<RowLayoutOptions, 'rowHeight' | 'rowGap'>): number;
/** Vertical distance after which the rows repeat when wrapped. */
export declare function rowsPeriodY(options: RowLayoutOptions): number;
export declare function shuffledOrder(length: number, seed: number): number[];
export declare function packRows(photos: ReadonlyArray<{
    width: number;
    height: number;
} | undefined>, order: number[], options: RowLayoutOptions): PackedRow[];
//# sourceMappingURL=row-layout.d.ts.map