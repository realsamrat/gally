/** The size DOM photo tiles show at close zoom (GallyCanvas, the hybrid detail layer). */
export const DETAIL_SOURCE_KEY = 'medium';
/** Source sizes from smallest to largest. */
export const SOURCE_KEYS = ['thumb', 'small', 'medium', 'large', 'original'];
/**
 * Every size a photo can be shown at. A photo with only `src` uses it for every size; a photo with
 * some `sources` fills the missing sizes from `src`, then from whichever sizes it has.
 */
export function normalizePhotoSources(photo) {
    const fallback = photo.src ??
        photo.sources?.medium ??
        photo.sources?.small ??
        photo.sources?.thumb ??
        photo.sources?.large ??
        photo.sources?.original;
    if (!fallback) {
        throw new Error(`Gally photo "${photo.id}" needs either src or sources.`);
    }
    return {
        thumb: photo.sources?.thumb ?? fallback,
        small: photo.sources?.small ?? fallback,
        medium: photo.sources?.medium ?? fallback,
        large: photo.sources?.large ?? fallback,
        original: photo.sources?.original ?? fallback,
    };
}
/**
 * The best source that's ready to show: the wanted size or a sharper one, else the sharpest smaller
 * one, else `fallback` (an inline preview, say). `sharp` is false for anything below the wanted size.
 */
export function bestReadySource(sources, target, isReady, fallback) {
    const wanted = SOURCE_KEYS.indexOf(target);
    for (const key of PREFERENCE[target]) {
        const src = sources[key];
        if (src && isReady(src))
            return { src, sharp: SOURCE_KEYS.indexOf(key) >= wanted };
    }
    return fallback && isReady(fallback) ? { src: fallback, sharp: false } : undefined;
}
/** Sizes to try for `target`: it, then each sharper size, then each smaller one from the nearest down. */
export function sourceKeysByPreference(target) {
    return PREFERENCE[target];
}
/** Computed once: renderers ask for every tile on every frame. */
const PREFERENCE = Object.fromEntries(SOURCE_KEYS.map((target, wanted) => [target, [...SOURCE_KEYS.slice(wanted), ...SOURCE_KEYS.slice(0, wanted).reverse()]]));
/** How many photos use each source size. */
export function countSourceKeys(photos) {
    const counts = Object.fromEntries(SOURCE_KEYS.map((key) => [key, 0]));
    for (const photo of photos)
        counts[photo.sourceKey] += 1;
    return counts;
}
//# sourceMappingURL=photo-sources.js.map