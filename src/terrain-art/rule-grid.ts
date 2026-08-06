/**
 * Prepared whole-tile rule topology.
 *
 * Iterates the LOGICAL grid (one cell per `cols × rows`), not the dual-grid
 * vertex grid, and assigns each solid cell the index of the first matching rule
 * for its eight-neighbourhood. Empty cells get `-1` (nothing to draw). This is
 * the LDtk model: a cell's tile is chosen from its 8 neighbours, and each tile
 * is drawn whole at full-cell offsets (`col * size`, no half-tile shift).
 *
 * @module
 */

import type { TileGrid } from '../level/types';
import type { TerrainKindDefinition } from './types';
import type { RuleNeighborhood } from './rule-tiles';
import { createTerrainArtRuleResolver } from './rule-resolver';
import type { TerrainArtRuleSet } from './types';

/** One logical cell's resolved rule, or `-1` when nothing matches. */
export interface ResolvedTerrainArtRuleCell {
  readonly col: number;
  readonly row: number;
  /** Rule index from the material's rule set, or `-1`. */
  readonly ruleIndex: number;
}

/** A logical-grid topology carrying the matched rule index per cell. */
export interface PreparedTerrainArtRuleGrid {
  readonly cols: number;
  readonly rows: number;
  readonly tileSize: number;
  readonly tiles: readonly ResolvedTerrainArtRuleCell[];
}

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

/**
 * The material id a tile value maps to, or `null` when the value has no kind /
 * the kind has no material. Two neighbours "connect" for rule purposes when
 * they resolve to the same non-null material id — so a grass material's edges
 * are detected against air and against a different material alike.
 */
function materialTable(
  kinds: readonly Readonly<TerrainKindDefinition>[],
): ReadonlyMap<number, string | null> {
  const table = new Map<number, string | null>();
  if (!Array.isArray(kinds)) return table;
  for (const kind of kinds) {
    if (kind === null || typeof kind !== 'object' || !Number.isFinite(kind.tileValue)) continue;
    if (table.has(kind.tileValue)) continue;
    table.set(kind.tileValue, kind.materialId ?? null);
  }
  return table;
}

/**
 * Build the length-9 neighbourhood for one cell: `1` where the neighbour is
 * solid AND shares the centre's material, `0` otherwise. Order is
 * `[NW, N, NE, W, C, E, SW, S, SE]` — matching `TerrainArtRulePattern`.
 */
function neighborhood(
  grid: ReadableGrid,
  materials: ReadonlyMap<number, string | null>,
  col: number,
  row: number,
): RuleNeighborhood {
  const centreValue = grid.data[row * grid.cols + col] ?? 0;
  const centreMaterial = materials.get(centreValue) ?? null;
  const dirs: ReadonlyArray<readonly [number, number]> = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [0, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];
  const out: number[] = [];
  for (const [dc, dr] of dirs) {
    const nc = col + dc;
    const nr = row + dr;
    if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) { out.push(0); continue; }
    const value = grid.data[nr * grid.cols + nc] ?? 0;
    const neighborMaterial = materials.get(value) ?? null;
    out.push(value !== 0 && neighborMaterial === centreMaterial ? 1 : 0);
  }
  return out;
}

/**
 * Prepare a whole-tile rule topology: for every solid cell, find the first rule
 * whose 3×3 pattern matches the cell's eight-neighbourhood. Cells that match no
 * rule keep `ruleIndex === -1` and draw nothing. The resolver is memoized per
 * neighbourhood, so a large level with repeating shapes is cheap.
 */
export function prepareTerrainArtRuleGrid(
  grid: Readonly<TileGrid>,
  kinds: readonly Readonly<TerrainKindDefinition>[],
  ruleSet: Readonly<TerrainArtRuleSet>,
): PreparedTerrainArtRuleGrid {
  const readable = readGrid(grid);
  if (readable === null) {
    return Object.freeze({ cols: 0, rows: 0, tileSize: 0, tiles: Object.freeze([]) });
  }
  const resolve = createTerrainArtRuleResolver(ruleSet);
  const materials = materialTable(kinds);
  const tiles: ResolvedTerrainArtRuleCell[] = [];
  for (let row = 0; row < readable.rows; row++) {
    for (let col = 0; col < readable.cols; col++) {
      const value = readable.data[row * readable.cols + col] ?? 0;
      if (value === 0) { tiles.push(Object.freeze({ col, row, ruleIndex: -1 })); continue; }
      const n = neighborhood(readable, materials, col, row);
      const ruleIndex = resolve(n) ?? -1;
      tiles.push(Object.freeze({ col, row, ruleIndex }));
    }
  }
  return Object.freeze({
    cols: readable.cols,
    rows: readable.rows,
    tileSize: readable.tileSize,
    tiles: Object.freeze(tiles),
  });
}
