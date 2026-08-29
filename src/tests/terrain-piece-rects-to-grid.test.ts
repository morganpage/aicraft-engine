/**
 * TE.1a prototype tests — rect → `TileGrid` rasterizer.
 */

import { describe, it, expect } from 'vitest';
import { rectsToTileGrid } from '../terrain-art/piece';

const BOUNDS = { x: 0, y: 0, width: 96, height: 64 } as const;

describe('rectsToTileGrid — aligned input', () => {
  it('rasterizes an aligned rect exactly', () => {
    const { grid, unalignedRects } = rectsToTileGrid(
      [{ x: 16, y: 16, width: 32, height: 16 }], 16, BOUNDS,
    );
    expect(grid.cols).toBe(6);
    expect(grid.rows).toBe(4);
    expect(unalignedRects).toBe(0);
    // Row 1, cols 1-2 solid; everything else empty.
    expect(grid.data.filter((v) => v !== 0)).toHaveLength(2);
    expect(grid.data[1 * 6 + 1]).toBe(1);
    expect(grid.data[1 * 6 + 2]).toBe(1);
  });

  it('is idempotent under overlapping rects', () => {
    const a = rectsToTileGrid([{ x: 0, y: 0, width: 32, height: 16 }], 16, BOUNDS);
    const b = rectsToTileGrid([
      { x: 0, y: 0, width: 32, height: 16 },
      { x: 16, y: 0, width: 16, height: 16 },
    ], 16, BOUNDS);
    expect(b.grid.data).toEqual(a.grid.data);
  });

  it('honours a custom tileValue and rejects 0', () => {
    const ok = rectsToTileGrid([{ x: 0, y: 0, width: 16, height: 16 }], 16, BOUNDS, 7);
    expect(ok.grid.data[0]).toBe(7);
    // 0 is conventionally empty — fall back to 1 rather than produce a grid
    // that claims to be solid but reads as air.
    const zero = rectsToTileGrid([{ x: 0, y: 0, width: 16, height: 16 }], 16, BOUNDS, 0);
    expect(zero.grid.data[0]).toBe(1);
  });

  it('offsets cells against non-zero bounds origin', () => {
    const { grid } = rectsToTileGrid(
      [{ x: 112, y: 48, width: 16, height: 16 }], 16, { x: 96, y: 32, width: 64, height: 64 },
    );
    expect(grid.data[1 * 4 + 1]).toBe(1);
    expect(grid.data.filter((v) => v !== 0)).toHaveLength(1);
  });
});

describe('rectsToTileGrid — the center-coverage rule', () => {
  it('claims a cell whose center is covered', () => {
    // Spans x 0..12 — covers cell 0's center (x=8) but not cell 1's (x=24).
    const { grid } = rectsToTileGrid([{ x: 0, y: 0, width: 12, height: 16 }], 16, BOUNDS);
    expect(grid.data[0]).toBe(1);
    expect(grid.data[1]).toBe(0);
  });

  it('drops a sliver that covers no center', () => {
    // x 0..4 — misses cell 0's center at x=8 entirely.
    const { grid, unalignedRects } = rectsToTileGrid(
      [{ x: 0, y: 0, width: 4, height: 16 }], 16, BOUNDS,
    );
    expect(grid.data.every((v) => v === 0)).toBe(true);
    expect(unalignedRects).toBe(1);
  });

  it('counts misalignment without refusing to rasterize', () => {
    const { grid, unalignedRects, skippedRects } = rectsToTileGrid([
      { x: 0, y: 0, width: 32, height: 16 },  // aligned
      { x: 5, y: 0, width: 32, height: 16 },  // not
    ], 16, BOUNDS);
    expect(unalignedRects).toBe(1);
    expect(skippedRects).toBe(0);
    expect(grid.data.filter((v) => v !== 0).length).toBeGreaterThan(0);
  });
});

describe('rectsToTileGrid — never throws', () => {
  it('returns an empty grid for invalid tileSize or bounds', () => {
    const rect = [{ x: 0, y: 0, width: 16, height: 16 }];
    for (const size of [0, -16, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rectsToTileGrid(rect, size, BOUNDS).grid.cols).toBe(0);
    }
    expect(rectsToTileGrid(rect, 16, { x: 0, y: 0, width: 0, height: 64 }).grid.cols).toBe(0);
    expect(rectsToTileGrid(rect, 16, null as never).grid.cols).toBe(0);
  });

  it('skips unusable rects and reports them', () => {
    const { grid, skippedRects } = rectsToTileGrid([
      { x: 0, y: 0, width: 16, height: 16 },
      { x: Number.NaN, y: 0, width: 16, height: 16 },
      { x: 0, y: 0, width: -16, height: 16 },
      { x: 0, y: 0, width: 0, height: 16 },
      null as never,
    ], 16, BOUNDS);
    expect(skippedRects).toBe(4);
    expect(grid.data[0]).toBe(1);
  });

  it('accepts an empty rect list', () => {
    const { grid } = rectsToTileGrid([], 16, BOUNDS);
    expect(grid.cols).toBe(6);
    expect(grid.data.every((v) => v === 0)).toBe(true);
  });

  it('is deterministic — same input, identical output', () => {
    const rects = [{ x: 16, y: 0, width: 48, height: 32 }, { x: 5, y: 7, width: 20, height: 20 }];
    expect(rectsToTileGrid(rects, 16, BOUNDS).grid.data)
      .toEqual(rectsToTileGrid(rects, 16, BOUNDS).grid.data);
  });
});
