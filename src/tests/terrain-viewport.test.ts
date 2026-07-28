import { describe, expect, it } from 'vitest';
import type { TileGrid } from '../level/types';
import { visibleTileRange } from '../terrain';
import { createTopologyRoomScene } from '../../showcase/sections/tile-room-fixtures';

const GRID: TileGrid = {
  data: new Array(100).fill(0),
  cols: 10,
  rows: 10,
  tileSize: 16,
};

describe('visibleTileRange', () => {
  it('returns exclusive indices for an interior fractional view', () => {
    expect(visibleTileRange(GRID, { x: 16.5, y: 32.25, width: 31, height: 32 }))
      .toEqual({ startCol: 1, endCol: 3, startRow: 2, endRow: 5 });
  });

  it('clamps views crossing every grid boundary', () => {
    expect(visibleTileRange(GRID, { x: -8, y: -8, width: 32, height: 32 }))
      .toEqual({ startCol: 0, endCol: 2, startRow: 0, endRow: 2 });
    expect(visibleTileRange(GRID, { x: 150, y: 150, width: 32, height: 32 }))
      .toEqual({ startCol: 9, endCol: 10, startRow: 9, endRow: 10 });
  });

  it('returns empty for fully disjoint or malformed input', () => {
    expect(visibleTileRange(GRID, { x: 200, y: 0, width: 10, height: 10 }))
      .toEqual({ startCol: 0, endCol: 0, startRow: 0, endRow: 0 });
    expect(visibleTileRange(GRID, { x: 0, y: 0, width: 0, height: 10 }))
      .toEqual({ startCol: 0, endCol: 0, startRow: 0, endRow: 0 });
    expect(visibleTileRange({ ...GRID, tileSize: 0 }, { x: 0, y: 0, width: 10, height: 10 }))
      .toEqual({ startCol: 0, endCol: 0, startRow: 0, endRow: 0 });
    expect(visibleTileRange({ ...GRID, data: [] }, { x: 0, y: 0, width: 10, height: 10 }))
      .toEqual({ startCol: 0, endCol: 0, startRow: 0, endRow: 0 });
  });

  it('adds clamped overscan, including shake allowance', () => {
    const shakeMagnitude = 20;
    const overscan = Math.ceil(shakeMagnitude / GRID.tileSize);
    expect(visibleTileRange(
      GRID,
      { x: 48, y: 48, width: 16, height: 16 },
      overscan,
    )).toEqual({ startCol: 1, endCol: 6, startRow: 1, endRow: 6 });
  });

  it('handles a tile larger than the view', () => {
    expect(visibleTileRange(GRID, { x: 1, y: 1, width: 2, height: 2 }))
      .toEqual({ startCol: 0, endCol: 1, startRow: 0, endRow: 1 });
  });

  it('demonstrates culling invariance against the Phase 0 topology room', () => {
    const scene = createTopologyRoomScene();
    const left = visibleTileRange(
      scene.level.tiles,
      { x: 0, y: 100, width: 600, height: 400 },
      1,
    );
    const right = visibleTileRange(
      scene.level.tiles,
      { x: 360, y: 100, width: 600, height: 400 },
      1,
    );
    expect(left.startCol).toBe(0);
    expect(right.startCol).toBeGreaterThan(left.startCol);
    expect(left.endCol - left.startCol).toBeLessThan(scene.level.tiles.cols);
    expect(right.endCol - right.startCol).toBeLessThan(scene.level.tiles.cols);
  });
});
