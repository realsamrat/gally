export type PhotoId = string;
export type Point = {
    x: number;
    y: number;
};
export type Size = {
    width: number;
    height: number;
};
export type Bounds = Point & Size & {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
};
export type Camera = {
    x: number;
    y: number;
    zoom: number;
};
export type Viewport = Size;
export type PhotoSourceKey = 'thumb' | 'small' | 'medium' | 'large' | 'original';
export type PhotoSources = Partial<Record<PhotoSourceKey, string>> & {
    thumb: string;
    small: string;
    medium: string;
};
export type PhotoTile<Metadata = unknown> = {
    id: PhotoId;
    x: number;
    y: number;
    width: number;
    height: number;
    sources: PhotoSources;
    alt?: string;
    dominantColor?: string;
    metadata?: Metadata;
};
export type VisiblePhoto<Metadata = unknown> = {
    tile: PhotoTile<Metadata>;
    bounds: Bounds;
    screenBounds: Bounds;
    sourceKey: PhotoSourceKey;
    src: string;
};
export type InteractionKind = 'pan' | 'zoom';
export type InteractionState = {
    active: boolean;
    kind: InteractionKind | null;
    startedAt: number | null;
};
export type GallySnapshot<Metadata = unknown> = {
    camera: Camera;
    viewport: Viewport;
    visible: Array<VisiblePhoto<Metadata>>;
    preload: Array<VisiblePhoto<Metadata>>;
    interaction: InteractionState;
    stats: GallyStats;
};
export type GallyStats = {
    totalPhotos: number;
    visiblePhotos: number;
    preloadPhotos: number;
    zoom: number;
    sourceCounts: Record<PhotoSourceKey, number>;
};
export type GallyListener<Metadata = unknown> = (snapshot: GallySnapshot<Metadata>) => void;
/** A photo as apps pass it in: its size, and one `src` or several `sources` sizes. */
export type GallyPhoto<Metadata = unknown> = {
    id: string;
    width: number;
    height: number;
    /** One image URL used for every size. `sources` takes precedence for the sizes it names. */
    src?: string;
    sources?: Partial<PhotoSources>;
    alt?: string;
    dominantColor?: string;
    /**
     * Tiny inline preview, e.g. a ~24 px JPEG as a data URL (about 1 KB). Shown instantly, with no
     * network request, until a real size loads, so tiles are never blank on slow networks.
     * Used by `GallyLibrary`.
     */
    placeholder?: string;
    metadata?: Metadata;
};
export type GallyPhotoSelection<Metadata = unknown> = {
    id: string;
    index: number;
    photo: GallyPhoto<Metadata>;
};
/** Metadata a Wrapped Layout tile carries: the group (row) whose horizontal period it repeats with. */
export type WrappedPhotoMetadata = {
    groupId: string;
};
/** A set of tiles that repeats horizontally every `periodX` (one row of a Wrapped Layout). */
export type WrappedPhotoGroup = {
    id: string;
    periodX: number;
};
//# sourceMappingURL=types.d.ts.map