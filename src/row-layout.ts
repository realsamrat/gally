/**
 * Justified photo rows: photos in a seeded shuffled order, packed into a fixed number of rows of
 * roughly equal width at one row height. Shared by the Wrapped Layout and the hybrid photo scene.
 */

export type RowLayoutOptions = {
  rowHeight: number
  rowGap: number
  columnGap: number
  rowCount: number
  seed: number
}

export const defaultRowLayoutOptions: RowLayoutOptions = {
  rowHeight: 240,
  rowGap: 44,
  columnGap: 44,
  rowCount: 8,
  seed: 73,
}

export type PackedRow = {
  tiles: Array<{ index: number; x: number; width: number }>
  /** Width of the photos and the gaps between them. */
  width: number
  /** Distance after which the row repeats when wrapped: its width plus one gap. */
  period: number
}

/** Top of a row, before wrapping. */
export function rowTop(rowIndex: number, options: Pick<RowLayoutOptions, 'rowHeight' | 'rowGap'>) {
  return rowIndex * (options.rowHeight + options.rowGap)
}

/** Vertical distance after which the rows repeat when wrapped. */
export function rowsPeriodY(options: RowLayoutOptions) {
  return rowTop(options.rowCount, options)
}

export function shuffledOrder(length: number, seed: number) {
  const rng = mulberry32(seed)
  const order = [...Array(length).keys()]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const current = order[i]
    const swap = order[j]
    if (current === undefined || swap === undefined) continue
    order[i] = swap
    order[j] = current
  }
  return order
}

export function packRows(
  photos: ReadonlyArray<{ width: number; height: number } | undefined>,
  order: number[],
  options: RowLayoutOptions,
): PackedRow[] {
  const widths = order.map((index) => {
    const photo = photos[index]
    return photo ? (photo.width / photo.height) * options.rowHeight : options.rowHeight
  })
  const target = widths.reduce((sum, width) => sum + width, 0) / options.rowCount
  const rows: PackedRow['tiles'][] = Array.from({ length: options.rowCount }, () => [])
  let rowIndex = 0
  let rowWidth = 0

  for (let i = 0; i < order.length; i++) {
    const index = order[i]
    const row = rows[rowIndex]
    if (index === undefined || !row) continue
    const width = widths[i] ?? options.rowHeight
    row.push({ index, x: 0, width })
    rowWidth += width

    const remainingRows = options.rowCount - rowIndex - 1
    if (remainingRows > 0 && rowWidth >= target && order.length - i - 1 >= remainingRows) {
      rowIndex += 1
      rowWidth = 0
    }
  }

  return rows.map((tiles) => {
    let x = 0
    for (const tile of tiles) {
      tile.x = x
      x += tile.width + options.columnGap
    }
    return { tiles, width: Math.max(0, x - options.columnGap), period: x }
  })
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), 1 | t)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
