import { describe, it, expect } from 'vitest';
import { createTileQuery } from '../level/tiles';
import type { TileGrid } from '../level/types';
import type { TileType } from '../collision/types';

describe('createTileQuery — valid grid', () => {
  it('returns the typeMap output for each tile', () => {
    const grid: TileGrid = {
      data: [0, 1, 2, 0, 1, 1],
      cols: 3,
      rows: 2,
      tileSize: 16,
    };
    const typeMap = (v: number): TileType =>
      v === 1 ? 'solid' : v === 2 ? 'passthrough' : 'empty';
    const query = createTileQuery(grid, typeMap);

    expect(query(0, 0)).toBe('empty');
    expect(query(1, 0)).toBe('solid');
    expect(query(2, 0)).toBe('passthrough');
    expect(query(0, 1)).toBe('empty');
    expect(query(1, 1)).toBe('solid');
    expect(query(2, 1)).toBe('solid');
  });

  it('uses row-major indexing (tileY * cols + tileX)', () => {
    const grid: TileGrid = {
      data: [10, 11, 12, 13, 14, 15],
      cols: 3,
      rows: 2,
      tileSize: 8,
    };
    const query = createTileQuery(grid, (v) => (v === 13 ? 'solid' : 'empty'));
    expect(query(0, 0)).toBe('empty'); // data[0*3 + 0] = data[0] = 10
    expect(query(0, 1)).toBe('solid'); // data[1*3 + 0] = data[3] = 13
    expect(query(2, 1)).toBe('empty'); // data[1*3 + 2] = data[5] = 15
  });

  it('passes the raw tile value to typeMap unchanged', () => {
    const seen: number[] = [];
    const grid: TileGrid = {
      data: [5, 7, 9],
      cols: 3,
      rows: 1,
      tileSize: 1,
    };
    const query = createTileQuery(grid, (v) => {
      seen.push(v);
      return 'empty';
    });
    query(0, 0);
    query(1, 0);
    query(2, 0);
    expect(seen).toEqual([5, 7, 9]);
  });
});

describe('createTileQuery — out of bounds', () => {
  const grid: TileGrid = {
    data: [0, 0, 0, 0],
    cols: 2,
    rows: 2,
    tileSize: 1,
  };
  const query = createTileQuery(grid, () => 'solid');

  it('returns empty for tileX beyond cols', () => {
    expect(query(2, 0)).toBe('empty');
    expect(query(99, 0)).toBe('empty');
  });

  it('returns empty for tileY beyond rows', () => {
    expect(query(0, 2)).toBe('empty');
    expect(query(0, 99)).toBe('empty');
  });

  it('returns empty for negative tileX', () => {
    expect(query(-1, 0)).toBe('empty');
    expect(query(-100, 0)).toBe('empty');
  });

  it('returns empty for negative tileY', () => {
    expect(query(0, -1)).toBe('empty');
    expect(query(0, -100)).toBe('empty');
  });

  it('returns empty for non-integer tile coords', () => {
    expect(query(0.5, 0)).toBe('empty');
    expect(query(0, 1.5)).toBe('empty');
  });

  it('returns empty for NaN tile coords', () => {
    expect(query(NaN, 0)).toBe('empty');
    expect(query(0, NaN)).toBe('empty');
  });
});

describe('createTileQuery — defensive', () => {
  it('returns empty when data array is shorter than cols*rows', () => {
    const grid: TileGrid = {
      data: [0, 0],
      cols: 2,
      rows: 2,
      tileSize: 1,
    };
    const query = createTileQuery(grid, () => 'solid');
    expect(query(0, 0)).toBe('solid');
    expect(query(1, 0)).toBe('solid');
    expect(query(0, 1)).toBe('empty'); // index 2 — out of range
    expect(query(1, 1)).toBe('empty'); // index 3 — out of range
  });

  it('returns empty for every coord when data is missing', () => {
    const grid = {
      cols: 2,
      rows: 2,
      tileSize: 1,
    } as unknown as TileGrid;
    const query = createTileQuery(grid, () => 'solid');
    expect(query(0, 0)).toBe('empty');
    expect(query(1, 1)).toBe('empty');
  });

  it('returns empty for every coord when data is not an array', () => {
    const grid = {
      data: 'nope',
      cols: 2,
      rows: 2,
      tileSize: 1,
    } as unknown as TileGrid;
    const query = createTileQuery(grid, () => 'solid');
    expect(query(0, 0)).toBe('empty');
  });

  it('returns empty for every coord when cols/rows are missing', () => {
    const grid = {
      data: [0, 0, 0, 0],
      tileSize: 1,
    } as unknown as TileGrid;
    const query = createTileQuery(grid, () => 'solid');
    expect(query(0, 0)).toBe('empty');
  });

  it('returns empty when a data slot is non-numeric', () => {
    const grid = {
      data: ['x', 0],
      cols: 2,
      rows: 1,
      tileSize: 1,
    } as unknown as TileGrid;
    const query = createTileQuery(grid, () => 'solid');
    expect(query(0, 0)).toBe('empty');
    expect(query(1, 0)).toBe('solid');
  });

  it('returns empty when a data slot is NaN', () => {
    const grid: TileGrid = {
      data: [Number.NaN, 0],
      cols: 2,
      rows: 1,
      tileSize: 1,
    };
    const query = createTileQuery(grid, () => 'solid');
    expect(query(0, 0)).toBe('empty');
    expect(query(1, 0)).toBe('solid');
  });

  it('does not mutate the grid', () => {
    const grid: TileGrid = {
      data: [0, 1, 2, 3],
      cols: 2,
      rows: 2,
      tileSize: 1,
    };
    const snapshot = JSON.parse(JSON.stringify(grid));
    const query = createTileQuery(grid, (v) => (v === 0 ? 'empty' : 'solid'));
    query(0, 0);
    query(1, 1);
    query(5, 5);
    expect(grid).toEqual(snapshot);
  });
});
