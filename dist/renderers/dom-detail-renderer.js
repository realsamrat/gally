'use client';
import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { DETAIL_SOURCE_KEY } from '../photo-sources.js';
export function GallyDomDetailLayer({ tiles, selectedPhotoId, spotlightPhotoId, onSelectPhoto, }) {
    return (_jsx(_Fragment, { children: tiles.map((tile) => {
            const src = tile.sources[DETAIL_SOURCE_KEY];
            return (_jsx("button", { type: "button", className: "gally-hybrid__detail-tile", style: {
                    left: tile.detailRect.x,
                    top: tile.detailRect.y,
                    width: tile.detailRect.width,
                    height: tile.detailRect.height,
                }, "aria-label": tile.alt ?? '', "data-gally-selected": tile.baseId === selectedPhotoId ? '1' : undefined, "data-gally-spotlight-selected": tile.baseId === spotlightPhotoId ? '1' : undefined, onClick: () => onSelectPhoto?.({
                    id: tile.baseId,
                    index: tile.index,
                    photo: tile.photo,
                }), children: _jsx("img", { src: src, alt: tile.alt ?? '', "data-gally-tile-id": tile.id, decoding: "async", loading: "lazy", draggable: false }) }, tile.id));
        }) }));
}
//# sourceMappingURL=dom-detail-renderer.js.map