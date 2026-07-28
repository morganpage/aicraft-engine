/**
 * Eight-neighbor terrain connectivity and prepared sparse lookup tables.
 *
 * @module
 */

import type { TileGrid } from '../level/types';
import type {
  TerrainConnectionTable,
  TerrainNeighborhood,
} from './types';

export const TERRAIN_NORTH = 1 << 0;
export const TERRAIN_NORTH_EAST = 1 << 1;
export const TERRAIN_EAST = 1 << 2;
export const TERRAIN_SOUTH_EAST = 1 << 3;
export const TERRAIN_SOUTH = 1 << 4;
export const TERRAIN_SOUTH_WEST = 1 << 5;
export const TERRAIN_WEST = 1 << 6;
export const TERRAIN_NORTH_WEST = 1 << 7;

const EMPTY_NEIGHBORHOOD: TerrainNeighborhood = Object.freeze({
  mask: 0,
  north: false,
  northEast: false,
  east: false,
  southEast: false,
  south: false,
  southWest: false,
  west: false,
  northWest: false,
});

const DIRECTIONS = [
  { dc: 0, dr: -1, bit: TERRAIN_NORTH, key: 'north' },
  { dc: 1, dr: -1, bit: TERRAIN_NORTH_EAST, key: 'northEast' },
  { dc: 1, dr: 0, bit: TERRAIN_EAST, key: 'east' },
  { dc: 1, dr: 1, bit: TERRAIN_SOUTH_EAST, key: 'southEast' },
  { dc: 0, dr: 1, bit: TERRAIN_SOUTH, key: 'south' },
  { dc: -1, dr: 1, bit: TERRAIN_SOUTH_WEST, key: 'southWest' },
  { dc: -1, dr: 0, bit: TERRAIN_WEST, key: 'west' },
  { dc: -1, dr: -1, bit: TERRAIN_NORTH_WEST, key: 'northWest' },
] as const;

interface GridReader {
  readonly cols: number;
  readonly rows: number;
  readonly data: readonly number[];
}

function readGrid(grid: Readonly<TileGrid>): GridReader | null {
  if (grid === null || typeof grid !== 'object') return null;
  const cols = Number.isInteger(grid.cols) && grid.cols > 0 ? grid.cols : 0;
  const rows = Number.isInteger(grid.rows) && grid.rows > 0 ? grid.rows : 0;
  if (cols === 0 || rows === 0 || !Array.isArray(grid.data)) return null;
  if (grid.data.length < cols * rows) return null;
  return { cols, rows, data: grid.data };
}

function valueAt(grid: GridReader, col: number, row: number): number | null {
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null;
  const value = grid.data[row * grid.cols + col];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Sample all eight neighbors with a consumer-supplied connection rule.
 *
 * Malformed grids/indices return an empty neighborhood. Connector errors
 * propagate because callback failures are programmer errors.
 */
export function sampleTerrainNeighborhood(
  grid: Readonly<TileGrid>,
  col: number,
  row: number,
  connects: (centerValue: number, neighborValue: number) => boolean,
): TerrainNeighborhood {
  const readable = readGrid(grid);
  if (
    readable === null ||
    !Number.isInteger(col) ||
    !Number.isInteger(row) ||
    col < 0 ||
    row < 0 ||
    col >= readable.cols ||
    row >= readable.rows
  ) {
    return EMPTY_NEIGHBORHOOD;
  }
  const center = valueAt(readable, col, row);
  if (center === null) return EMPTY_NEIGHBORHOOD;

  let mask = 0;
  const values: Record<(typeof DIRECTIONS)[number]['key'], boolean> = {
    north: false,
    northEast: false,
    east: false,
    southEast: false,
    south: false,
    southWest: false,
    west: false,
    northWest: false,
  };
  for (const direction of DIRECTIONS) {
    const neighbor = valueAt(readable, col + direction.dc, row + direction.dr);
    if (neighbor !== null && connects(center, neighbor)) {
      mask |= direction.bit;
      values[direction.key] = true;
    }
  }
  return { mask, ...values };
}

/** Connect tiles only when their numeric values are identical. */
export function connectsEqualValue(
  centerValue: number,
  neighborValue: number,
): boolean {
  return centerValue === neighborValue;
}

/**
 * Create a connector treating all configured finite values as one family.
 */
export function createTerrainConnector(
  terrainValues: readonly number[],
): (centerValue: number, neighborValue: number) => boolean {
  const values = new Set(
    Array.isArray(terrainValues)
      ? terrainValues.filter((value) => Number.isFinite(value))
      : [],
  );
  return (centerValue, neighborValue) =>
    values.has(centerValue) && values.has(neighborValue);
}

/**
 * Prepare a sparse ordered-pair connection table.
 *
 * Each distinct in-bounds pair is evaluated once. Without `onError`, connector
 * errors propagate; with it, the pair is reported once and stored as
 * disconnected. Unobserved pairs are disconnected.
 */
export function createTerrainConnectionTable(
  grid: Readonly<TileGrid>,
  connects: (centerValue: number, neighborValue: number) => boolean,
  options?: {
    readonly onError?: (
      centerValue: number,
      neighborValue: number,
      error: unknown,
    ) => void;
  },
): TerrainConnectionTable {
  if (typeof connects !== 'function') {
    throw new TypeError('createTerrainConnectionTable: connects must be a function');
  }
  const readable = readGrid(grid);
  const rows = new Map<number, Map<number, boolean>>();
  if (readable === null) return { connects: () => false };

  for (let row = 0; row < readable.rows; row++) {
    for (let col = 0; col < readable.cols; col++) {
      const center = valueAt(readable, col, row);
      if (center === null) continue;
      let centerMap = rows.get(center);
      if (centerMap === undefined) {
        centerMap = new Map<number, boolean>();
        rows.set(center, centerMap);
      }
      for (const direction of DIRECTIONS) {
        const neighbor = valueAt(
          readable,
          col + direction.dc,
          row + direction.dr,
        );
        if (neighbor === null || centerMap.has(neighbor)) continue;
        try {
          centerMap.set(neighbor, Boolean(connects(center, neighbor)));
        } catch (error) {
          if (options?.onError === undefined) throw error;
          options.onError(center, neighbor, error);
          centerMap.set(neighbor, false);
        }
      }
    }
  }

  return {
    connects: (centerValue, neighborValue) =>
      rows.get(centerValue)?.get(neighborValue) ?? false,
  };
}
