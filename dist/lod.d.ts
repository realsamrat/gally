import type { Camera, PhotoSourceKey, PhotoSources, PhotoTile } from './types.js';
export type LodConfig = {
    thumbMaxScreenWidth: number;
    smallMaxScreenWidth: number;
    mediumMaxScreenWidth: number;
    dprCap: number;
};
export declare const defaultLodConfig: LodConfig;
export declare function getEffectivePixelWidth(tileWidth: number, camera: Camera, devicePixelRatio?: number, config?: LodConfig): number;
export declare function chooseSourceKey(tileWidth: number, camera: Camera, devicePixelRatio?: number, config?: LodConfig): PhotoSourceKey;
/** The smallest source size that covers a tile this many device pixels wide. */
export declare function chooseSourceKeyForPixels(pixelWidth: number, config?: LodConfig): PhotoSourceKey;
/** Device pixel ratio, capped: sharper sources than the cap allows are never chosen. */
export declare function cappedDevicePixelRatio(config?: Pick<LodConfig, 'dprCap'>, devicePixelRatio?: number): number;
export declare function getBestAvailableSource(sources: PhotoSources, preferred: PhotoSourceKey): {
    key: PhotoSourceKey;
    src: string;
};
export declare function resolvePhotoSource(tile: PhotoTile, camera: Camera, devicePixelRatio?: number, config?: LodConfig): {
    key: PhotoSourceKey;
    src: string;
};
export type GallyNetworkQualityLevel = 'fast' | 'normal' | 'slow';
/** On slower networks, smaller sizes cover bigger tiles: each threshold scales up. */
export declare function lodForNetwork(config: LodConfig, network: GallyNetworkQualityLevel): LodConfig;
//# sourceMappingURL=lod.d.ts.map