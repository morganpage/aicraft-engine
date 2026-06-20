import { describe, it, expect } from 'vitest';
import {
  worldToTile,
  tileToWorld,
  tileRect,
  resolveTileX,
  resolveTileY,
} from '../collision/tiles';
import type { Rect, TileSolidityQuery } from '../collision/types';

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, width: w, height: h });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Build a query over a 2D grid (row-major: grid[tileY][tileX]); 1=solid, else empty. */
const gridQuery = (grid: number[][], tileSize: number): TileSolidityQuery => (tx, ty) => {
  void tileSize;
  if (ty < 0 || ty >= grid.length || tx < 0 || tx >= grid[0].length) return 'empty';
  return grid[ty][tx] === 1 ? 'solid' : 'empty';
};

describe('worldToTile', () => {
  it('maps (0,0) to tile (0,0)', () => {
    expect(worldToTile(0, 0, 16)).toEqual({ tileX: 0, tileY: 0 });
  });

  it('keeps the last pixel of a tile in that tile (15,15 -> 0,0)', () => {
    expect(worldToTile(15, 15, 16)).toEqual({ tileX: 0, tileY: 0 });
  });

  it('maps the first pixel of the next tile correctly (16,16 -> 1,1)', () => {
    expect(worldToTile(16, 16, 16)).toEqual({ tileX: 1, tileY: 1 });
  });

  it('floors negative world coords (-1,-1 -> -1,-1)', () => {
    expect(worldToTile(-1, -1, 16)).toEqual({ tileX: -1, tileY: -1 });
  });

  it('floors across a tile boundary in the negative direction (-17,-17 -> -2,-2)', () => {
    expect(worldToTile(-17, -17, 16)).toEqual({ tileX: -2, tileY: -2 });
  });
});

describe('tileToWorld', () => {
  it('maps tile (0,0) to origin', () => {
    expect(tileToWorld(0, 0, 16)).toEqual({ x: 0, y: 0 });
  });

  it('maps tile (2,3) to (32,48) at tileSize 16', () => {
    expect(tileToWorld(2, 3, 16)).toEqual({ x: 32, y: 48 });
  });

  it('maps negative tile (-1,-1) to (-16,-16)', () => {
    expect(tileToWorld(-1, -1, 16)).toEqual({ x: -16, y: -16 });
  });
});

describe('tileRect', () => {
  it('returns the world-space rect for tile (2,3)', () => {
    expect(tileRect(2, 3, 16)).toEqual({ x: 32, y: 48, width: 16, height: 16 });
  });

  it('returns a unit tile at the origin', () => {
    expect(tileRect(0, 0, 16)).toEqual({ x: 0, y: 0, width: 16, height: 16 });
  });
});

describe('resolveTileX', () => {
  it('moving right into a solid tile: snaps to tile left edge, zeros vx, sets hitWall', () => {
    const query: TileSolidityQuery = (_tx, ty) => (ty === 0 && _tx === 2 ? 'solid' : 'empty');
    const body = rect(10, 0, 10, 10);
    const r = resolveTileX(body, 25, query, 16);
    expect(r.x).toBe(22);
    expect(r.vx).toBe(0);
    expect(r.hitWall).toBe(true);
  });

  it('moving left into a solid tile: snaps to tile right edge, zeros vx, sets hitWall', () => {
    const query: TileSolidityQuery = (tx, ty) => (ty === 0 && tx === 0 ? 'solid' : 'empty');
    const body = rect(40, 0, 10, 10);
    const r = resolveTileX(body, -25, query, 16);
    expect(r.x).toBe(16);
    expect(r.vx).toBe(0);
    expect(r.hitWall).toBe(true);
  });

  it('no solid tiles in path: advances by vx, leaves vx unchanged, hitWall false', () => {
    const query: TileSolidityQuery = () => 'empty';
    const body = rect(0, 0, 10, 10);
    const r = resolveTileX(body, 5, query, 16);
    expect(r).toEqual({ x: 5, vx: 5, hitWall: false });
  });

  it('passthrough tile in path is ignored on the X axis', () => {
    const query: TileSolidityQuery = (tx, ty) => (ty === 0 && tx === 0 ? 'passthrough' : 'empty');
    const body = rect(0, 0, 10, 10);
    const r = resolveTileX(body, 5, query, 16);
    expect(r).toEqual({ x: 5, vx: 5, hitWall: false });
  });

  it('body spanning two tile rows: blocked when only the lower row is solid', () => {
    const query: TileSolidityQuery = (tx, ty) => (tx === 2 && ty === 1 ? 'solid' : 'empty');
    const body = rect(20, 12, 10, 20);
    const r = resolveTileX(body, 20, query, 16);
    expect(r.x).toBe(22);
    expect(r.vx).toBe(0);
    expect(r.hitWall).toBe(true);
  });

  it('vx = 0 is a no-op early return', () => {
    const query: TileSolidityQuery = () => 'solid';
    const body = rect(0, 0, 10, 10);
    const r = resolveTileX(body, 0, query, 16);
    expect(r).toEqual({ x: 0, vx: 0, hitWall: false });
  });
});

describe('resolveTileY', () => {
  it('falling onto a solid tile: lands on top, zeros vy, sets landed', () => {
    const query: TileSolidityQuery = (tx, ty) => (tx === 0 && ty === 4 ? 'solid' : 'empty');
    const body = rect(0, 40, 10, 10);
    const r = resolveTileY(body, 20, query, 16, 50);
    expect(r.y).toBe(54);
    expect(r.vy).toBe(0);
    expect(r.landed).toBe(true);
    expect(r.hitCeiling).toBe(false);
  });

  it('rising into a solid ceiling: snaps to tile bottom, zeros vy, sets hitCeiling', () => {
    const query: TileSolidityQuery = (tx, ty) => (tx === 0 && ty === 0 ? 'solid' : 'empty');
    const body = rect(0, 20, 10, 10);
    const r = resolveTileY(body, -15, query, 16, 30);
    expect(r.y).toBe(16);
    expect(r.vy).toBe(0);
    expect(r.landed).toBe(false);
    expect(r.hitCeiling).toBe(true);
  });

  it('falling onto passthrough from above (prevBottom <= tile top) lands', () => {
    const query: TileSolidityQuery = (tx, ty) => (tx === 0 && ty === 2 ? 'passthrough' : 'empty');
    const body = rect(0, 20, 10, 10);
    const r = resolveTileY(body, 10, query, 16, 30);
    expect(r.y).toBe(22);
    expect(r.vy).toBe(0);
    expect(r.landed).toBe(true);
    expect(r.hitCeiling).toBe(false);
  });

  it('falling onto passthrough from below (prevBottom > tile top) passes through', () => {
    const query: TileSolidityQuery = (tx, ty) => (tx === 0 && ty === 2 ? 'passthrough' : 'empty');
    const body = rect(0, 25, 10, 10);
    const r = resolveTileY(body, 10, query, 16, 35);
    expect(r.y).toBe(35);
    expect(r.vy).toBe(10);
    expect(r.landed).toBe(false);
    expect(r.hitCeiling).toBe(false);
  });

  it('rising through a passthrough platform passes through', () => {
    const query: TileSolidityQuery = (tx, ty) => (tx === 0 && ty === 2 ? 'passthrough' : 'empty');
    const body = rect(0, 48, 10, 10);
    const r = resolveTileY(body, -15, query, 16, 58);
    expect(r.y).toBe(33);
    expect(r.vy).toBe(-15);
    expect(r.landed).toBe(false);
    expect(r.hitCeiling).toBe(false);
  });

  it('no solid tiles in path: advances by vy, leaves vy unchanged', () => {
    const query: TileSolidityQuery = () => 'empty';
    const body = rect(0, 0, 10, 10);
    const r = resolveTileY(body, 5, query, 16, 10);
    expect(r).toEqual({ y: 5, vy: 5, landed: false, hitCeiling: false });
  });

  it('vy = 0 is a no-op early return', () => {
    const query: TileSolidityQuery = () => 'solid';
    const body = rect(0, 0, 10, 10);
    const r = resolveTileY(body, 0, query, 16, 10);
    expect(r).toEqual({ y: 0, vy: 0, landed: false, hitCeiling: false });
  });
});

describe('tile collision purity + determinism', () => {
  it('resolveTileX does not mutate body', () => {
    const query: TileSolidityQuery = (tx, ty) => (ty === 0 && tx === 2 ? 'solid' : 'empty');
    const body = rect(10, 0, 10, 10);
    const snapshot = clone(body);
    resolveTileX(body, 25, query, 16);
    expect(body).toEqual(snapshot);
  });

  it('resolveTileY does not mutate body', () => {
    const query: TileSolidityQuery = (tx, ty) => (tx === 0 && ty === 4 ? 'solid' : 'empty');
    const body = rect(0, 40, 10, 10);
    const snapshot = clone(body);
    resolveTileY(body, 20, query, 16, 50);
    expect(body).toEqual(snapshot);
  });

  it('resolveTileX is deterministic across calls with identical inputs', () => {
    const query: TileSolidityQuery = (tx, ty) => (ty === 0 && tx === 2 ? 'solid' : 'empty');
    const body = rect(10, 0, 10, 10);
    const a = resolveTileX(body, 25, query, 16);
    const b = resolveTileX(body, 25, query, 16);
    expect(a).toEqual(b);
  });

  it('resolveTileY is deterministic across calls with identical inputs', () => {
    const query: TileSolidityQuery = (tx, ty) => (tx === 0 && ty === 4 ? 'solid' : 'empty');
    const body = rect(0, 40, 10, 10);
    const a = resolveTileY(body, 20, query, 16, 50);
    const b = resolveTileY(body, 20, query, 16, 50);
    expect(a).toEqual(b);
  });
});

describe('integration: 2D-array-backed tile grid', () => {
  // 5x5 grid: wall column at tx=0, floor row at ty=4. tileSize 16 -> world [0,80)^2.
  const grid = [
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 1, 1, 1, 1],
  ];
  const query = gridQuery(grid, 16);

  it('body falling onto the floor lands on top', () => {
    const body = rect(20, 40, 10, 10);
    const r = resolveTileY(body, 30, query, 16, 50);
    expect(r.y).toBe(54);
    expect(r.vy).toBe(0);
    expect(r.landed).toBe(true);
    expect(r.hitCeiling).toBe(false);
  });

  it('body moving left into the wall column is blocked', () => {
    const body = rect(20, 40, 10, 10);
    const r = resolveTileX(body, -20, query, 16);
    expect(r.x).toBe(16);
    expect(r.vx).toBe(0);
    expect(r.hitWall).toBe(true);
  });

  it('body sliding right along the floor moves freely (no wall in path)', () => {
    const body = rect(20, 54, 10, 10);
    const r = resolveTileX(body, 10, query, 16);
    expect(r).toEqual({ x: 30, vx: 10, hitWall: false });
  });
});
