import { GallyImageLoader } from '../src/index.js'
import type { GallyCanvasPhoto } from '../src/react/index.js'
import fixtures from '../fixtures.json'

/*
 * The site's photos are the fixtures in public/ (`npm run fixtures`): 240 photos, each in three
 * sizes, served from this site so the loader can fetch and decode them in a worker.
 */

type SourceKey = keyof typeof fixtures.sizes
export const SOURCE_KEYS = Object.keys(fixtures.sizes) as SourceKey[]
/** Short-edge pixels of each size. */
export const SOURCE_SIZES = fixtures.sizes
export const PHOTO_COUNT = fixtures.count

export const sourceUrl = (index: number, key: SourceKey) => `/fixtures/${index}-${key}.webp`

/** Each size is used up to 10% past its short edge. */
export const LOD = {
  thumbMaxScreenWidth: SOURCE_SIZES.thumb * 1.1,
  smallMaxScreenWidth: SOURCE_SIZES.small * 1.1,
  mediumMaxScreenWidth: SOURCE_SIZES.medium * 1.1,
}

/** One loader, so the three demos share a cache. */
export const loader = new GallyImageLoader({ mode: 'blob' })

export function ratioOf(index: number): [number, number] {
  return fixtures.ratios[index % fixtures.ratios.length] as [number, number]
}

function photo(index: number, id: string, placeholder?: string): GallyCanvasPhoto {
  const [w, h] = ratioOf(index)
  return {
    id,
    width: w * 400,
    height: h * 400,
    alt: `Photo ${index + 1}`,
    // What a tile shows before its image: a shade just above the page, not the default light grey.
    dominantColor: '#1e1e1e',
    sources: Object.fromEntries(SOURCE_KEYS.map((key) => [key, sourceUrl(index, key)])),
    ...(placeholder ? { placeholder } : {}),
  }
}

/** The 240 photos, once each: what the canvases show. */
export const canvasPhotos: GallyCanvasPhoto[] = Array.from({ length: PHOTO_COUNT }, (_, i) => photo(i, `photo-${i}`))

function random(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A longer library: the photos four times over, each pass in its own order. */
export function libraryPhotos(previews: string[]): GallyCanvasPhoto[] {
  const rand = random(29)
  const photos: GallyCanvasPhoto[] = []
  for (let pass = 0; pass < 4; pass++) {
    const order = Array.from({ length: PHOTO_COUNT }, (_, i) => i)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[order[i], order[j]] = [order[j]!, order[i]!]
    }
    for (const index of order) photos.push(photo(index, `library-${pass}-${index}`, previews[index]))
  }
  return photos
}

let previews: Promise<string[]> | undefined

/** A ~1 KB inline preview per photo, so library tiles are never blank while a size loads. */
export function loadPreviews(): Promise<string[]> {
  return (previews ??= fetch('/fixtures/manifest.json')
    .then((response) => (response.ok ? response.json() : { previews: [] }))
    .then((manifest: { previews?: string[] }) => manifest.previews ?? [])
    .catch(() => []))
}
