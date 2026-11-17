import { sourceKeysByPreference } from './photo-sources.js'
import type { Camera, PhotoSourceKey, PhotoSources, PhotoTile } from './types.js'

export type LodConfig = {
  thumbMaxScreenWidth: number
  smallMaxScreenWidth: number
  mediumMaxScreenWidth: number
  dprCap: number
}

export const defaultLodConfig: LodConfig = {
  thumbMaxScreenWidth: 220,
  smallMaxScreenWidth: 720,
  mediumMaxScreenWidth: 1440,
  dprCap: 2,
}

export function getEffectivePixelWidth(
  tileWidth: number,
  camera: Camera,
  devicePixelRatio = globalThis.devicePixelRatio || 1,
  config: LodConfig = defaultLodConfig
): number {
  return tileWidth * camera.zoom * cappedDevicePixelRatio(config, devicePixelRatio)
}

export function chooseSourceKey(
  tileWidth: number,
  camera: Camera,
  devicePixelRatio?: number,
  config: LodConfig = defaultLodConfig
): PhotoSourceKey {
  return chooseSourceKeyForPixels(getEffectivePixelWidth(tileWidth, camera, devicePixelRatio, config), config)
}

/** The smallest source size that covers a tile this many device pixels wide. */
export function chooseSourceKeyForPixels(pixelWidth: number, config: LodConfig = defaultLodConfig): PhotoSourceKey {
  if (pixelWidth <= config.thumbMaxScreenWidth) return 'thumb'
  if (pixelWidth <= config.smallMaxScreenWidth) return 'small'
  if (pixelWidth <= config.mediumMaxScreenWidth) return 'medium'
  return 'large'
}

/** Device pixel ratio, capped: sharper sources than the cap allows are never chosen. */
export function cappedDevicePixelRatio(config: Pick<LodConfig, 'dprCap'> = defaultLodConfig, devicePixelRatio = globalThis.devicePixelRatio || 1) {
  return Math.max(1, Math.min(devicePixelRatio, config.dprCap))
}

export function getBestAvailableSource(
  sources: PhotoSources,
  preferred: PhotoSourceKey
): { key: PhotoSourceKey; src: string } {
  for (const key of sourceKeysByPreference(preferred)) {
    const src = sources[key]
    if (src) return { key, src }
  }

  return { key: 'thumb', src: sources.thumb }
}

export function resolvePhotoSource(
  tile: PhotoTile,
  camera: Camera,
  devicePixelRatio?: number,
  config?: LodConfig
): { key: PhotoSourceKey; src: string } {
  return getBestAvailableSource(
    tile.sources,
    chooseSourceKey(tile.width, camera, devicePixelRatio, config)
  )
}

export type GallyNetworkQualityLevel = 'fast' | 'normal' | 'slow'

/** On slower networks, smaller sizes cover bigger tiles: each threshold scales up. */
export function lodForNetwork(config: LodConfig, network: GallyNetworkQualityLevel): LodConfig {
  if (network === 'fast') return config
  const factor = network === 'slow' ? 2 : 1.4
  return {
    ...config,
    thumbMaxScreenWidth: config.thumbMaxScreenWidth * factor,
    smallMaxScreenWidth: config.smallMaxScreenWidth * factor,
    mediumMaxScreenWidth: config.mediumMaxScreenWidth * factor,
  }
}
