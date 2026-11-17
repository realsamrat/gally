import type { GallySceneWrappedPhotoTile } from '../scene/photo-scene.js';
import type { GallyPhotoSelection } from '../types.js';
export type GallyDomDetailLayerProps<Metadata = unknown> = {
    tiles: Array<GallySceneWrappedPhotoTile<Metadata>>;
    selectedPhotoId?: string | null;
    spotlightPhotoId?: string | null;
    onSelectPhoto?: (selection: GallyPhotoSelection<Metadata>) => void;
};
export declare function GallyDomDetailLayer<Metadata>({ tiles, selectedPhotoId, spotlightPhotoId, onSelectPhoto, }: GallyDomDetailLayerProps<Metadata>): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=dom-detail-renderer.d.ts.map