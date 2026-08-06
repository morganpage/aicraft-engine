import { describe, expect, it } from 'vitest';
import type { TileGrid } from '../level';
import {
  DUAL_GRID_NORTH_EAST,
  DUAL_GRID_NORTH_WEST,
  DUAL_GRID_SOUTH_EAST,
  DUAL_GRID_SOUTH_WEST,
  dualGridCellsForLogicalCell,
  prepareTerrainArtDualGrid,
  resolveTerrainArtDualTile,
} from '../terrain-art';

function grid(rows: readonly (readonly number[])[]): TileGrid {
  return {
    cols: rows[0]?.length ?? 0,
    rows: rows.length,
    tileSize: 16,
    data: rows.flat(),
  };
}

const kinds = [
  {
    id: 'empty',
    label: 'Empty',
    tileValue: 0,
    collision: 'empty' as const,
    materialId: null,
    connectGroup: 'empty',
    renderPriority: 0,
  },
  {
    id: 'grass',
    label: 'Grass',
    tileValue: 1,
    collision: 'solid' as const,
    materialId: 'grass',
    connectGroup: 'ground',
    renderPriority: 10,
  },
  {
    id: 'rock',
    label: 'Rock',
    tileValue: 2,
    collision: 'solid' as const,
    materialId: 'rock',
    connectGroup: 'ground',
    renderPriority: 20,
  },
] as const;

describe('terrain-art dual-grid topology', () => {
  it('uses the canonical clockwise NW, NE, SE, SW bit order', () => {
    expect(DUAL_GRID_NORTH_WEST).toBe(1);
    expect(DUAL_GRID_NORTH_EAST).toBe(2);
    expect(DUAL_GRID_SOUTH_EAST).toBe(4);
    expect(DUAL_GRID_SOUTH_WEST).toBe(8);

    for (let expected = 0; expected < 16; expected++) {
      const tile = resolveTerrainArtDualTile(grid([
        [
          expected & DUAL_GRID_NORTH_WEST ? 1 : 0,
          expected & DUAL_GRID_NORTH_EAST ? 1 : 0,
        ],
        [
          expected & DUAL_GRID_SOUTH_WEST ? 1 : 0,
          expected & DUAL_GRID_SOUTH_EAST ? 1 : 0,
        ],
      ]), kinds, 1, 1);

      expect(tile.occupancyMask).toBe(expected);
      expect(tile.materials[0]?.mask ?? 0).toBe(expected);
    }
  });

  it('prepares one visual tile per logical vertex with empty boundaries', () => {
    const prepared = prepareTerrainArtDualGrid(grid([[1]]), kinds);

    expect({ cols: prepared.cols, rows: prepared.rows, tileSize: prepared.tileSize })
      .toEqual({ cols: 2, rows: 2, tileSize: 16 });
    expect(prepared.tiles.map((tile) => tile.occupancyMask)).toEqual([
      DUAL_GRID_SOUTH_EAST,
      DUAL_GRID_SOUTH_WEST,
      DUAL_GRID_NORTH_EAST,
      DUAL_GRID_NORTH_WEST,
    ]);
  });

  it('resolves multiple materials independently and sorts their passes', () => {
    const tile = resolveTerrainArtDualTile(grid([
      [1, 2],
      [2, 1],
    ]), kinds, 1, 1);

    expect(tile.occupancyMask).toBe(15);
    expect(tile.materials).toEqual([
      { materialId: 'grass', mask: 5, priority: 10 },
      { materialId: 'rock', mask: 10, priority: 20 },
    ]);
  });

  it('treats unknown and malformed logical values as empty', () => {
    expect(resolveTerrainArtDualTile(grid([
      [99, Number.NaN],
      [0, 0],
    ]), kinds, 1, 1)).toEqual({
      dualX: 1,
      dualY: 1,
      occupancyMask: 0,
      materials: [],
    });
    expect(prepareTerrainArtDualGrid(
      { cols: 2, rows: 2, tileSize: 16, data: [] },
      kinds,
    )).toEqual({ cols: 0, rows: 0, tileSize: 0, tiles: [] });
  });

  it('identifies exactly four visual tiles affected by one logical edit', () => {
    expect(dualGridCellsForLogicalCell(3, 5)).toEqual([
      { col: 3, row: 5 },
      { col: 4, row: 5 },
      { col: 3, row: 6 },
      { col: 4, row: 6 },
    ]);
    expect(dualGridCellsForLogicalCell(1.5, 2)).toEqual([]);
  });
});
