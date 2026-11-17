import type { GallyPhoto, PhotoSourceKey, PhotoSources } from './types.js';
/** The size DOM photo tiles show at close zoom (GallyCanvas, the hybrid detail layer). */
export declare const DETAIL_SOURCE_KEY = "medium";
/** Source sizes from smallest to largest. */
export declare const SOURCE_KEYS: readonly PhotoSourceKey[];
/**
 * Every size a photo can be shown at. A photo with only `src` uses it for every size; a photo with
 * some `sources` fills the missing sizes from `src`, then from whichever sizes it has.
 */
export declare function normalizePhotoSources(photo: GallyPhoto<unknown>): PhotoSources & Record<PhotoSourceKey, string>;
/**
 * The best source that's ready to show: the wanted size or a sharper one, else the sharpest smaller
 * one, else `fallback` (an inline preview, say). `sharp` is false for anything below the wanted size.
 */
export declare function bestReadySource(sources: Partial<Record<PhotoSourceKey, string>>, target: PhotoSourceKey, isReady: (src: string) => boolean, fallback?: string): {
    src: string;
    sharp: boolean;
} | undefined;
/** Sizes to try for `target`: it, then each sharper size, then each smaller one from the nearest down. */
export declare function sourceKeysByPreference(target: PhotoSourceKey): readonly PhotoSourceKey[];
/** How many photos use each source size. */
export declare function countSourceKeys(photos: Iterable<{
    sourceKey: PhotoSourceKey;
}>): Record<PhotoSourceKey, number>;
//# sourceMappingURL=photo-sources.d.ts.map