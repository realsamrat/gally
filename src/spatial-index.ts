import { boundsIntersect, makeBounds } from './geometry.js'
import type { Bounds, PhotoId, PhotoTile } from './types.js'

type CellKey = `${number}:${number}`

export type SpatialIndexOptions = {
  cellSize: number
}

export class PhotoSpatialIndex<Metadata = unknown> {
  private readonly cellSize: number
  private readonly cells = new Map<CellKey, Set<PhotoId>>()
  private readonly tileCells = new Map<PhotoId, Set<CellKey>>()
  private readonly tiles = new Map<PhotoId, PhotoTile<Metadata>>()

  constructor(options: SpatialIndexOptions = { cellSize: 1024 }) {
    this.cellSize = options.cellSize
  }

  get size(): number {
    return this.tiles.size
  }

  set(tile: PhotoTile<Metadata>): void {
    this.delete(tile.id)
    this.tiles.set(tile.id, tile)

    const keys = this.getCellKeys(this.getTileBounds(tile))
    this.tileCells.set(tile.id, keys)

    for (const key of keys) {
      let cell = this.cells.get(key)
      if (!cell) {
        cell = new Set()
        this.cells.set(key, cell)
      }
      cell.add(tile.id)
    }
  }

  setMany(tiles: Array<PhotoTile<Metadata>>): void {
    for (const tile of tiles) this.set(tile)
  }

  get(id: PhotoId): PhotoTile<Metadata> | undefined {
    return this.tiles.get(id)
  }

  getAll(): Array<PhotoTile<Metadata>> {
    return Array.from(this.tiles.values())
  }

  delete(id: PhotoId): void {
    const keys = this.tileCells.get(id)
    if (!keys) return

    for (const key of keys) {
      const cell = this.cells.get(key)
      if (!cell) continue

      cell.delete(id)
      if (cell.size === 0) this.cells.delete(key)
    }

    this.tileCells.delete(id)
    this.tiles.delete(id)
  }

  clear(): void {
    this.cells.clear()
    this.tileCells.clear()
    this.tiles.clear()
  }

  search(bounds: Bounds): Array<PhotoTile<Metadata>> {
    const ids = new Set<PhotoId>()
    for (const key of this.getCellKeys(bounds)) {
      const cell = this.cells.get(key)
      if (!cell) continue
      for (const id of cell) ids.add(id)
    }

    const result: Array<PhotoTile<Metadata>> = []
    for (const id of ids) {
      const tile = this.tiles.get(id)
      if (!tile) continue
      if (boundsIntersect(this.getTileBounds(tile), bounds)) result.push(tile)
    }

    return result
  }

  getTileBounds(tile: PhotoTile<Metadata>): Bounds {
    return makeBounds(tile.x, tile.y, tile.width, tile.height)
  }

  private getCellKeys(bounds: Bounds): Set<CellKey> {
    const minCellX = Math.floor(bounds.minX / this.cellSize)
    const maxCellX = Math.floor(bounds.maxX / this.cellSize)
    const minCellY = Math.floor(bounds.minY / this.cellSize)
    const maxCellY = Math.floor(bounds.maxY / this.cellSize)
    const keys = new Set<CellKey>()

    for (let x = minCellX; x <= maxCellX; x++) {
      for (let y = minCellY; y <= maxCellY; y++) {
        keys.add(`${x}:${y}`)
      }
    }

    return keys
  }
}
