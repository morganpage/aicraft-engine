/**
 * Pure visible-tile range calculation.
 *
 * @module
 */

import type { TileGrid } from '../level/types';
import type { TerrainViewport, VisibleTileRange } from './types';

const EMPTY_RANGE: VisibleTileRange = Object.freeze({
  startCol: 0,
  endCol: 0,
  startRow: 0,
  endRow: 0,
});

/**
 * Compute the half-open tile indices intersecting a world-space view.
 *
 * Shake and other transform-only offsets must not be folded into `view`.
 * Increase `overscanTiles` instead when an offset can reveal an edge tile.
 */
export function visibleTileRange(
  grid: Readonly<TileGrid>,
  view: Readonly<TerrainViewport>,
  overscanTiles: number = 0,
): VisibleTileRange {
  if (grid === null || view === null || typeof grid !== 'object' || typeof view !== 'object') {
    return EMPTY_RANGE;
  }
  const cols = Number.isInteger(grid.cols) && grid.cols > 0 ? grid.cols : 0;
  const rows = Number.isInteger(grid.rows) && grid.rows > 0 ? grid.rows : 0;
  const tileSize = Number.isFinite(grid.tileSize) && grid.tileSize > 0
    ? grid.tileSize
    : 0;
  if (cols === 0 || rows === 0 || tileSize === 0 || !Array.isArray(grid.data)) {
    return EMPTY_RANGE;
  }
  if (grid.data.length < cols * rows) return EMPTY_RANGE;

  const { x, y, width, height } = view;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return EMPTY_RANGE;
  }
  const right = x + width;
  const bottom = y + height;
  if (!Number.isFinite(right) || !Number.isFinite(bottom)) return EMPTY_RANGE;

  const gridWidth = cols * tileSize;
  const gridHeight = rows * tileSize;
  if (right <= 0 || bottom <= 0 || x >= gridWidth || y >= gridHeight) {
    return EMPTY_RANGE;
  }

  const overscan = Number.isFinite(overscanTiles)
    ? Math.max(0, Math.floor(overscanTiles))
    : 0;
  const startCol = Math.max(0, Math.floor(x / tileSize) - overscan);
  const endCol = Math.min(cols, Math.ceil(right / tileSize) + overscan);
  const startRow = Math.max(0, Math.floor(y / tileSize) - overscan);
  const endRow = Math.min(rows, Math.ceil(bottom / tileSize) + overscan);

  if (startCol >= endCol || startRow >= endRow) return EMPTY_RANGE;
  return { startCol, endCol, startRow, endRow };
}
