'use client'

import { DETAIL_SOURCE_KEY } from '../photo-sources.js'
import type { GallySceneWrappedPhotoTile } from '../scene/photo-scene.js'
import type { GallyPhotoSelection } from '../types.js'

export type GallyDomDetailLayerProps<Metadata = unknown> = {
  tiles: Array<GallySceneWrappedPhotoTile<Metadata>>
  selectedPhotoId?: string | null
  spotlightPhotoId?: string | null
  onSelectPhoto?: (selection: GallyPhotoSelection<Metadata>) => void
}

export function GallyDomDetailLayer<Metadata>({
  tiles,
  selectedPhotoId,
  spotlightPhotoId,
  onSelectPhoto,
}: GallyDomDetailLayerProps<Metadata>) {
  return (
    <>
      {tiles.map((tile) => {
        const src = tile.sources[DETAIL_SOURCE_KEY]
        return (
          <button
            key={tile.id}
            type="button"
            className="gally-hybrid__detail-tile"
            style={{
              left: tile.detailRect.x,
              top: tile.detailRect.y,
              width: tile.detailRect.width,
              height: tile.detailRect.height,
            }}
            aria-label={tile.alt ?? ''}
            data-gally-selected={tile.baseId === selectedPhotoId ? '1' : undefined}
            data-gally-spotlight-selected={tile.baseId === spotlightPhotoId ? '1' : undefined}
            onClick={() =>
              onSelectPhoto?.({
                id: tile.baseId,
                index: tile.index,
                photo: tile.photo,
              })
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Gally is framework-neutral. */}
            <img src={src} alt={tile.alt ?? ''} data-gally-tile-id={tile.id} decoding="async" loading="lazy" draggable={false} />
          </button>
        )
      })}
    </>
  )
}
