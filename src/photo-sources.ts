import type { GallyPhoto, PhotoSourceKey, PhotoSources } from './types.js'

/** The size DOM photo tiles show at close zoom (GallyCanvas, the hybrid detail layer). */
export const DETAIL_SOURCE_KEY = 'medium' satisfies PhotoSourceKey

/** Source sizes from smallest to largest. */
export const SOURCE_KEYS: readonly PhotoSourceKey[] = ['thumb', 'small', 'medium', 'large', 'original']

/**
 * Every size a photo can be shown at. A photo with only `src` uses it for every size; a photo with
 * some `sources` fills the missing sizes from `src`, then from whichever sizes it has.
 */
export function normalizePhotoSources(photo: GallyPhoto<unknown>): PhotoSources & Record<PhotoSourceKey, string> {
  const fallback =
    photo.src ??
    photo.sources?.medium ??
    photo.sources?.small ??
    photo.sources?.thumb ??
    photo.sources?.large ??
    photo.sources?.original

  if (!fallback) {
    throw new Error(`Gally photo "${photo.id}" needs either src or sources.`)
  }

  return {
    thumb: photo.sources?.thumb ?? fallback,
    small: photo.sources?.small ?? fallback,
    medium: photo.sources?.medium ?? fallback,
    large: photo.sources?.large ?? fallback,
    original: photo.sources?.original ?? fallback,
  }
}

/**
 * The best source that's ready to show: the wanted size or a sharper one, else the sharpest smaller
 * one, else `fallback` (an inline preview, say). `sharp` is false for anything below the wanted size.
 */
export function bestReadySource(
  sources: Partial<Record<PhotoSourceKey, string>>,
  target: PhotoSourceKey,
  isReady: (src: string) => boolean,
  fallback?: string,
): { src: string; sharp: boolean } | undefined {
  const wanted = SOURCE_KEYS.indexOf(target)
  for (const key of PREFERENCE[target]) {
    const src = sources[key]
    if (src && isReady(src)) return { src, sharp: SOURCE_KEYS.indexOf(key) >= wanted }
  }
  return fallback && isReady(fallback) ? { src: fallback, sharp: false } : undefined
}

/** Sizes to try for `target`: it, then each sharper size, then each smaller one from the nearest down. */
export function sourceKeysByPreference(target: PhotoSourceKey): readonly PhotoSourceKey[] {
  return PREFERENCE[target]
}

/** Computed once: renderers ask for every tile on every frame. */
const PREFERENCE = Object.fromEntries(
  SOURCE_KEYS.map((target, wanted) => [target, [...SOURCE_KEYS.slice(wanted), ...SOURCE_KEYS.slice(0, wanted).reverse()]]),
) as unknown as Record<PhotoSourceKey, readonly PhotoSourceKey[]>

/** How many photos use each source size. */
export function countSourceKeys(photos: Iterable<{ sourceKey: PhotoSourceKey }>): Record<PhotoSourceKey, number> {
  const counts = Object.fromEntries(SOURCE_KEYS.map((key) => [key, 0])) as Record<PhotoSourceKey, number>
  for (const photo of photos) counts[photo.sourceKey] += 1
  return counts
}
