import type { TileGrid } from '../level/types';
import type {
  PreparedTerrainArtDualGrid,
  ResolvedTerrainArtDualTile,
  ResolvedTerrainArtMaterial,
  TerrainArtDualGridMask,
  TerrainArtGridCell,
  TerrainKindDefinition,
} from './types';

/** North-west logical-corner bit. */
export const DUAL_GRID_NORTH_WEST = 1;

/** North-east logical-corner bit. */
export const DUAL_GRID_NORTH_EAST = 2;

/** South-east logical-corner bit. */
export const DUAL_GRID_SOUTH_EAST = 4;

/** South-west logical-corner bit. */
export const DUAL_GRID_SOUTH_WEST = 8;

interface ReadableGrid {
  readonly cols: number;
  readonly rows: number;
  readonly tileSize: number;
  readonly data: readonly number[];
}

function readGrid(grid: Readonly<TileGrid>): ReadableGrid | null {
  if (grid === null || typeof grid !== 'object') return null;
  if (
    !Number.isInteger(grid.cols) || grid.cols <= 0 ||
    !Number.isInteger(grid.rows) || grid.rows <= 0 ||
    !Number.isFinite(grid.tileSize) || grid.tileSize <= 0 ||
    !Array.isArray(grid.data) || grid.data.length < grid.cols * grid.rows
  ) return null;
  return grid;
}

function kindTable(
  kinds: readonly Readonly<TerrainKindDefinition>[],
): ReadonlyMap<number, Readonly<TerrainKindDefinition>> {
  const table = new Map<number, Readonly<TerrainKindDefinition>>();
  if (!Array.isArray(kinds)) return table;
  for (const kind of kinds) {
    if (
      kind === null || typeof kind !== 'object' ||
      !Number.isFinite(kind.tileValue) || table.has(kind.tileValue)
    ) continue;
    table.set(kind.tileValue, kind);
  }
  return table;
}

function emptyTile(dualX: number, dualY: number): ResolvedTerrainArtDualTile {
  return Object.freeze({
    dualX,
    dualY,
    occupancyMask: 0 as const,
    materials: Object.freeze([]),
  });
}

/** Resolve one visual dual-grid tile from its four surrounding logical cells. */
export function resolveTerrainArtDualTile(
  grid: Readonly<TileGrid>,
  kinds: readonly Readonly<TerrainKindDefinition>[],
  dualX: number,
  dualY: number,
): ResolvedTerrainArtDualTile {
  const readable = readGrid(grid);
  if (
    readable === null ||
    !Number.isInteger(dualX) || !Number.isInteger(dualY) ||
    dualX < 0 || dualY < 0 ||
    dualX > readable.cols || dualY > readable.rows
  ) return emptyTile(dualX, dualY);

  const definitions = kindTable(kinds);
  const samples = [
    { x: dualX - 1, y: dualY - 1, bit: DUAL_GRID_NORTH_WEST },
    { x: dualX, y: dualY - 1, bit: DUAL_GRID_NORTH_EAST },
    { x: dualX, y: dualY, bit: DUAL_GRID_SOUTH_EAST },
    { x: dualX - 1, y: dualY, bit: DUAL_GRID_SOUTH_WEST },
  ] as const;
  let occupancyMask = 0;
  const contributions = new Map<string, { mask: number; priority: number }>();

  for (const sample of samples) {
    if (
      sample.x < 0 || sample.y < 0 ||
      sample.x >= readable.cols || sample.y >= readable.rows
    ) continue;
    const value = readable.data[sample.y * readable.cols + sample.x];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const kind = definitions.get(value);
    if (kind?.materialId === null || kind?.materialId === undefined) continue;
    occupancyMask |= sample.bit;
    const contribution = contributions.get(kind.materialId) ?? {
      mask: 0,
      priority: kind.renderPriority,
    };
    contribution.mask |= sample.bit;
    contribution.priority = Math.max(contribution.priority, kind.renderPriority);
    contributions.set(kind.materialId, contribution);
  }

  const materials: ResolvedTerrainArtMaterial[] = [...contributions]
    .map(([materialId, contribution]) => Object.freeze({
      materialId,
      mask: contribution.mask as TerrainArtDualGridMask,
      priority: contribution.priority,
    }))
    .sort((first, second) =>
      first.priority - second.priority || first.materialId.localeCompare(second.materialId));

  return Object.freeze({
    dualX,
    dualY,
    occupancyMask: occupancyMask as TerrainArtDualGridMask,
    materials: Object.freeze(materials),
  });
}

/** Prepare the complete `(cols + 1) × (rows + 1)` derived visual topology. */
export function prepareTerrainArtDualGrid(
  grid: Readonly<TileGrid>,
  kinds: readonly Readonly<TerrainKindDefinition>[],
): PreparedTerrainArtDualGrid {
  const readable = readGrid(grid);
  if (readable === null) {
    return Object.freeze({ cols: 0, rows: 0, tileSize: 0, tiles: Object.freeze([]) });
  }
  const cols = readable.cols + 1;
  const rows = readable.rows + 1;
  const tiles: ResolvedTerrainArtDualTile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tiles.push(resolveTerrainArtDualTile(grid, kinds, col, row));
    }
  }
  return Object.freeze({
    cols,
    rows,
    tileSize: readable.tileSize,
    tiles: Object.freeze(tiles),
  });
}

/** Return the four visual tiles invalidated by one logical-cell edit. */
export function dualGridCellsForLogicalCell(
  col: number,
  row: number,
): readonly Readonly<TerrainArtGridCell>[] {
  if (!Number.isInteger(col) || !Number.isInteger(row)) return Object.freeze([]);
  return Object.freeze([
    Object.freeze({ col, row }),
    Object.freeze({ col: col + 1, row }),
    Object.freeze({ col, row: row + 1 }),
    Object.freeze({ col: col + 1, row: row + 1 }),
  ]);
}
