import { describe, expect, it, vi } from 'vitest';
import type { TileGrid } from '../level/types';
import {
  TERRAIN_EAST,
  TERRAIN_NORTH,
  TERRAIN_NORTH_EAST,
  TERRAIN_NORTH_WEST,
  TERRAIN_SOUTH,
  TERRAIN_SOUTH_EAST,
  TERRAIN_SOUTH_WEST,
  TERRAIN_WEST,
  connectsEqualValue,
  createTerrainConnectionTable,
  createTerrainConnector,
  sampleTerrainNeighborhood,
} from '../terrain';

function grid(rows: readonly (readonly number[])[]): TileGrid {
  return {
    cols: rows[0]?.length ?? 0,
    rows: rows.length,
    tileSize: 16,
    data: rows.flat(),
  };
}

const ALL =
  TERRAIN_NORTH |
  TERRAIN_NORTH_EAST |
  TERRAIN_EAST |
  TERRAIN_SOUTH_EAST |
  TERRAIN_SOUTH |
  TERRAIN_SOUTH_WEST |
  TERRAIN_WEST |
  TERRAIN_NORTH_WEST;

describe('sampleTerrainNeighborhood', () => {
  it('returns an empty mask for an isolated or malformed query', () => {
    expect(sampleTerrainNeighborhood(grid([[1]]), 0, 0, connectsEqualValue).mask).toBe(0);
    expect(sampleTerrainNeighborhood(grid([[1]]), -1, 0, connectsEqualValue).mask).toBe(0);
    expect(sampleTerrainNeighborhood(
      { data: [], cols: 2, rows: 2, tileSize: 16 },
      0,
      0,
      connectsEqualValue,
    ).mask).toBe(0);
  });

  it('samples horizontal, vertical, corner, and filled neighborhoods', () => {
    expect(sampleTerrainNeighborhood(grid([[1, 1, 1]]), 1, 0, connectsEqualValue).mask)
      .toBe(TERRAIN_EAST | TERRAIN_WEST);
    expect(sampleTerrainNeighborhood(grid([[1], [1], [1]]), 0, 1, connectsEqualValue).mask)
      .toBe(TERRAIN_NORTH | TERRAIN_SOUTH);
    expect(sampleTerrainNeighborhood(
      grid([[1, 1], [1, 1]]),
      0,
      0,
      connectsEqualValue,
    ).mask).toBe(TERRAIN_EAST | TERRAIN_SOUTH | TERRAIN_SOUTH_EAST);
    expect(sampleTerrainNeighborhood(
      grid([[1, 1, 1], [1, 1, 1], [1, 1, 1]]),
      1,
      1,
      connectsEqualValue,
    ).mask).toBe(ALL);
  });

  it('lets several tile values connect as one family', () => {
    const connects = createTerrainConnector([1, 2]);
    const neighborhood = sampleTerrainNeighborhood(
      grid([[0, 2, 0], [1, 1, 2], [0, 2, 0]]),
      1,
      1,
      connects,
    );
    expect(neighborhood.mask).toBe(
      TERRAIN_NORTH | TERRAIN_EAST | TERRAIN_SOUTH | TERRAIN_WEST,
    );
  });

  it('propagates connector errors', () => {
    expect(() => sampleTerrainNeighborhood(grid([[1, 1]]), 0, 0, () => {
      throw new Error('connector');
    })).toThrow('connector');
  });
});

describe('createTerrainConnectionTable', () => {
  it('evaluates each observed ordered pair once and never on lookup', () => {
    const connector = vi.fn((a: number, b: number) => a === b);
    const table = createTerrainConnectionTable(grid([[1, 2], [2, 1]]), connector);

    expect(connector).toHaveBeenCalledTimes(4);
    expect(table.connects(1, 1)).toBe(true);
    expect(table.connects(1, 2)).toBe(false);
    expect(table.connects(99, 1)).toBe(false);
    expect(connector).toHaveBeenCalledTimes(4);
  });

  it('propagates errors without onError', () => {
    expect(() => createTerrainConnectionTable(grid([[1, 2]]), () => {
      throw new Error('bad pair');
    })).toThrow('bad pair');
  });

  it('reports a failing pair once and records it as disconnected', () => {
    const onError = vi.fn();
    const table = createTerrainConnectionTable(
      grid([[1, 2, 1]]),
      (a, b) => {
        if (a === 1 && b === 2) throw new Error('bad pair');
        return true;
      },
      { onError },
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.slice(0, 2)).toEqual([1, 2]);
    expect(table.connects(1, 2)).toBe(false);
    expect(table.connects(2, 1)).toBe(true);
  });

  it('never calls the connector for unobserved pairs', () => {
    const connector = vi.fn((a: number, b: number) => {
      if (a === 7 && b === 9) throw new Error('unobserved');
      return a === b;
    });
    const table = createTerrainConnectionTable(grid([[1, 1]]), connector);
    expect(table.connects(7, 9)).toBe(false);
    expect(connector).toHaveBeenCalledTimes(1);
  });

  it('performs at most eight connector calls per cell with unique values', () => {
    const values = Array.from({ length: 25 }, (_, index) => index + 1);
    const connector = vi.fn(() => false);
    createTerrainConnectionTable(
      { data: values, cols: 5, rows: 5, tileSize: 16 },
      connector,
    );
    expect(connector.mock.calls.length).toBeLessThanOrEqual(values.length * 8);
  });

  it('rejects a non-function connector at preparation', () => {
    expect(() => createTerrainConnectionTable(
      grid([[1]]),
      null as unknown as (a: number, b: number) => boolean,
    )).toThrow(TypeError);
  });
});
