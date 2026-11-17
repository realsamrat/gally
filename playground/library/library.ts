import { benchRunPending, config, simulatedNetwork } from '../config'
import fixtures from '../../fixtures.json'

export type LibraryPhoto = {
  id: string
  index: number
  width: number
  height: number
}

type SourceKey = keyof typeof fixtures.sizes
const SOURCE_KEYS = Object.keys(fixtures.sizes) as SourceKey[]
/** Short-edge pixel size of each source, shared with `scripts/fixtures.mjs`. */
export const SOURCE_SIZES = fixtures.sizes

/**
 * Images come from picsum, or from the benchmark fixtures (`npm run fixtures`): through the dev
 * server's simulated network locally, straight from the CDN when deployed.
 */
const local = config.images === 'local'
const fixtureUrl = (file: string) => (simulatedNetwork ? `/fixtures/${config.net}/${file}` : `/fixtures/${file}`)
/**
 * Benchmark runs measure a cold load, so they get image URLs the browser hasn't cached (fixtures
 * are cached for a year, which would otherwise make repeat runs look instant). The browser caches
 * by full URL; Vercel's CDN serves static files ignoring the query, so the warmed CDN copy is used.
 */
const coldToken = benchRunPending ? `&cold=${Date.now().toString(36)}` : ''

function random(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A deterministic sample library: `count` photos in a fixed mix of aspect ratios. */
export function createLibrary(count: number): LibraryPhoto[] {
  const rand = random(17)
  const ratios = fixtures.ratios
  return Array.from({ length: count }, (_, index) => {
    // Fixture files repeat every `fixtures.count` photos and have their own aspect ratios.
    const [w, h] = local ? ratios[(index % fixtures.count) % ratios.length]! : ratios[Math.floor(rand() * ratios.length)]!
    return { id: `lib-${index}`, index, width: w! * 1000, height: h! * 1000 }
  })
}

/**
 * Local fixtures come with a manifest carrying a ~1 KB inline preview per photo, loaded first as an
 * app loads its photo metadata. It goes through the simulated network like the images.
 */
export async function loadPreviews(): Promise<string[]> {
  if (!local) return []
  try {
    const response = await fetch(fixtureUrl('manifest.json'))
    return response.ok ? (((await response.json()) as { previews?: string[] }).previews ?? []) : []
  } catch {
    return []
  }
}

export function previewFor(previews: string[], photo: LibraryPhoto): string | undefined {
  return previews[photo.index % fixtures.count]
}

/** Every fixture image a benchmark run can touch, for warming the CDN before a run. */
export function fixtureWarmUrls() {
  const urls: string[] = []
  for (let i = 0; i < fixtures.count; i++) for (const key of SOURCE_KEYS) urls.push(fixtureUrl(`${i}-${key}.webp`))
  return urls
}

/** Picsum URL sized so its short edge is at least `shortEdge` pixels. */
function picsumUrl(photo: LibraryPhoto, shortEdge: number) {
  const ratio = photo.width / photo.height
  const w = ratio >= 1 ? Math.round(shortEdge * ratio) : shortEdge
  const h = ratio >= 1 ? shortEdge : Math.round(shortEdge / ratio)
  return `https://picsum.photos/seed/gally-${photo.id}/${w}/${h}`
}

/** Gally photo sources: each fixture size of the same photo. */
export function sourcesFor(photo: LibraryPhoto): Record<SourceKey, string> {
  // Distinct URL per photo (the query) so caches treat 1,200 photos as 1,200 images.
  const url = (key: SourceKey) =>
    local ? `${fixtureUrl(`${photo.index % fixtures.count}-${key}.webp`)}?p=${photo.id}${coldToken}` : picsumUrl(photo, fixtures.sizes[key])
  return Object.fromEntries(SOURCE_KEYS.map((key) => [key, url(key)])) as Record<SourceKey, string>
}
