import { normalizePhotoSources } from './photo-sources.js'
import { defaultRowLayoutOptions, packRows, rowsPeriodY, rowTop, shuffledOrder, type RowLayoutOptions } from './row-layout.js'
import type { GallyPhoto, PhotoTile, WrappedPhotoGroup, WrappedPhotoMetadata } from './types.js'

export type GallyRowTile = {
  index: number
  x: number
  width: number
}

export type GallyRow = {
  tiles: GallyRowTile[]
  /** The row's period: its photos and gaps, including the gap before it repeats. */
  width: number
}

export type GallyWrappedPhotoMetadata<Metadata = unknown> = WrappedPhotoMetadata & {
  index: number
  row: number
  vy: number
  hx: number
  userMetadata?: Metadata
}

export type GallyWrappedLayout<Metadata = unknown> = {
  rows: GallyRow[]
  groups: WrappedPhotoGroup[]
  tiles: Array<PhotoTile<GallyWrappedPhotoMetadata<Metadata>>>
  periodY: number
}

export type GallyLayoutOptions = RowLayoutOptions & {
  horizontalCopies: number
  verticalCopies: number
}

export const defaultLayoutOptions: GallyLayoutOptions = {
  ...defaultRowLayoutOptions,
  horizontalCopies: 3,
  verticalCopies: 3,
}

/** Id of a row's wrapping group: the wrapped engine repeats every tile in a group by its period. */
export const rowGroupId = (rowIndex: number) => `row-${rowIndex}`

/** Id of one copy of a photo in the wrapped surface. */
export const wrappedTileId = (vy: number, rowIndex: number, hx: number, photoId: string) => `${vy}:${rowIndex}:${hx}:${photoId}`

export function buildWrappedPhotoLayout<Metadata = unknown>(
  photos: Array<GallyPhoto<Metadata>>,
  options: Partial<GallyLayoutOptions> = {}
): GallyWrappedLayout<Metadata> {
  const config = { ...defaultLayoutOptions, ...options }
  const rows: GallyRow[] = packRows(photos, shuffledOrder(photos.length, config.seed), config).map((row) => ({
    tiles: row.tiles,
    width: row.period,
  }))
  const periodY = rowsPeriodY(config)
  const groups = rows.map((row, rowIndex) => ({
    id: rowGroupId(rowIndex),
    periodX: row.width,
  }))
  const tiles: Array<PhotoTile<GallyWrappedPhotoMetadata<Metadata>>> = []

  for (let vy = 0; vy < config.verticalCopies; vy++) {
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex]
      if (!row) continue

      for (let hx = 0; hx < config.horizontalCopies; hx++) {
        for (const tile of row.tiles) {
          const photo = photos[tile.index]
          if (!photo) continue
          const metadata: GallyWrappedPhotoMetadata<Metadata> = {
            groupId: rowGroupId(rowIndex),
            index: tile.index,
            row: rowIndex,
            vy,
            hx,
          }
          if (photo.metadata !== undefined) metadata.userMetadata = photo.metadata

          const photoTile: PhotoTile<GallyWrappedPhotoMetadata<Metadata>> = {
            id: wrappedTileId(vy, rowIndex, hx, photo.id),
            x: hx * row.width + tile.x,
            y: vy * periodY + rowTop(rowIndex, config),
            width: tile.width,
            height: config.rowHeight,
            sources: normalizePhotoSources(photo),
            metadata,
          }
          if (photo.alt !== undefined) photoTile.alt = photo.alt
          if (photo.dominantColor !== undefined) photoTile.dominantColor = photo.dominantColor
          tiles.push(photoTile)
        }
      }
    }
  }

  return { rows, groups, tiles, periodY }
}
