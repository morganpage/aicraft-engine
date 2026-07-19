/**
 * Bridge between level tile data and the collision module's
 * {@link TileSolidityQuery}.
 *
 * Per the level-schema decision §Resolution 2, the bridge lives in
 * `src/level/` (not `src/collision/`) so the collision module stays pure —
 * no upstream dependency on the level module. Consumers discover the bridge
 * via the level module's barrel.
 *
 * The returned query is a reader: it never mutates `grid`. Out-of-bounds and
 * malformed inputs degrade to `'empty'`; the query never throws.
 *
 * @module
 */

import type { TileSolidityQuery, TileType } from '../collision/types';
import type { TileGrid } from './types';

/**
 * Build a {@link TileSolidityQuery} from a {@link TileGrid} and a per-tile-value
 * type-map function.
 *
 * Behavior:
 *  - Out-of-bounds tile coordinates return `'empty'`.
 *  - Non-integer tile coordinates (NaN, fractional) return `'empty'`.
 *  - Invalid indices (negative, ≥ data length) return `'empty'`.
 *  - If `grid.data` is missing or not an array, returns `'empty'` for all
 *    coordinates (never throws).
 *  - If a data slot is non-finite or not a number, it is passed to `typeMap`
 *    as-is — the consumer's `typeMap` decides what to do. (Consumer-supplied
 *    `typeMap` errors propagate; programmer errors should not be silently
 *    swallowed. The library's never-throw contract applies only to the
 *    level-data side, not to consumer-supplied callbacks.)
 *
 * Pure: the returned query is a reader; it never mutates `grid`.
 *
 * @example
 * ```ts
 * import { createTileQuery } from 'aicraft-engine/src/level';
 *
 * const query = createTileQuery(level.tiles, (v) =>
 *   v === 1 ? 'solid' : v === 2 ? 'passthrough' : 'empty',
 * );
 * const type = query(3, 4); // tile at column 3, row 4
 * ```
 *
 * @param grid    - Tile grid (flat data + dimensions).
 * @param typeMap - Maps a tile-value integer to a {@link TileType}.
 * @returns A {@link TileSolidityQuery} function.
 */
export function createTileQuery(
  grid: TileGrid,
  typeMap: (tileValue: number) => TileType,
): TileSolidityQuery {
  const cols =
    typeof grid.cols === 'number' && Number.isFinite(grid.cols) ? Math.floor(grid.cols) : 0;
  const rows =
    typeof grid.rows === 'number' && Number.isFinite(grid.rows) ? Math.floor(grid.rows) : 0;
  const data: readonly unknown[] = Array.isArray(grid.data) ? grid.data : [];

  return (tileX: number, tileY: number): TileType => {
    if (typeof tileX !== 'number' || typeof tileY !== 'number') return 'empty';
    if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) return 'empty';
    if (tileX < 0 || tileY < 0 || tileX >= cols || tileY >= rows) return 'empty';
    const idx = tileY * cols + tileX;
    if (idx < 0 || idx >= data.length) return 'empty';
    const value = data[idx];
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'empty';
    return typeMap(value);
  };
}
