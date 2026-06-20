import { describe, it, expect } from 'vitest';
import { aabbOverlap } from '../collision/aabb';
import { resolveAxisX, resolveAxisY } from '../collision/resolve';
import type { Rect, Solid } from '../collision/types';

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, width: w, height: h });
const solid = (x: number, y: number, w: number, h: number, passthrough = false): Solid => ({
  x,
  y,
  width: w,
  height: h,
  passthrough,
});
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('aabbOverlap', () => {
  it('returns true for overlapping rects', () => {
    expect(aabbOverlap(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toBe(true);
  });

  it('returns false when right edge touches left edge (strict on X)', () => {
    expect(aabbOverlap(rect(0, 0, 10, 10), rect(10, 0, 10, 10))).toBe(false);
  });

  it('returns false when bottom edge touches top edge (strict on Y)', () => {
    expect(aabbOverlap(rect(0, 0, 10, 10), rect(0, 10, 10, 10))).toBe(false);
  });

  it('returns false when separated on X', () => {
    expect(aabbOverlap(rect(0, 0, 5, 5), rect(10, 0, 5, 5))).toBe(false);
  });

  it('returns false when separated on Y', () => {
    expect(aabbOverlap(rect(0, 0, 5, 5), rect(0, 10, 5, 5))).toBe(false);
  });

  it('returns true when one rect fully contains the other', () => {
    expect(aabbOverlap(rect(0, 0, 20, 20), rect(5, 5, 5, 5))).toBe(true);
  });

  it('returns true for identical rects', () => {
    expect(aabbOverlap(rect(1, 2, 3, 4), rect(1, 2, 3, 4))).toBe(true);
  });

  it('is symmetric: a vs b equals b vs a', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(8, 8, 10, 10);
    expect(aabbOverlap(a, b)).toBe(aabbOverlap(b, a));
  });

  it('does not mutate its inputs', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(5, 5, 10, 10);
    const sa = clone(a);
    const sb = clone(b);
    aabbOverlap(a, b);
    expect(a).toEqual(sa);
    expect(b).toEqual(sb);
  });
});

describe('resolveAxisX', () => {
  it('moving right into a wall: snaps right edge to wall left, zeros vx, sets hitWall', () => {
    const body = rect(0, 0, 10, 10);
    const wall = solid(15, 0, 10, 10);
    const r = resolveAxisX(body, 10, [wall]);
    expect(r.x).toBe(5);
    expect(r.vx).toBe(0);
    expect(r.hitWall).toBe(true);
  });

  it('moving left into a wall: snaps left edge to wall right, zeros vx', () => {
    const body = rect(10, 0, 10, 10);
    const wall = solid(0, 0, 5, 10);
    const r = resolveAxisX(body, -10, [wall]);
    expect(r.x).toBe(5);
    expect(r.vx).toBe(0);
    expect(r.hitWall).toBe(true);
  });

  it('no collision: advances by vx, leaves vx unchanged, hitWall false', () => {
    const body = rect(0, 0, 10, 10);
    const r = resolveAxisX(body, 5, []);
    expect(r).toEqual({ x: 5, vx: 5, hitWall: false });
  });

  it('no collision with a distant solid leaves vx unchanged', () => {
    const body = rect(0, 0, 10, 10);
    const far = solid(100, 0, 10, 10);
    const r = resolveAxisX(body, 5, [far]);
    expect(r).toEqual({ x: 5, vx: 5, hitWall: false });
  });

  it('vx = 0 is a no-op even when body overlaps a wall', () => {
    const body = rect(5, 0, 10, 10);
    const wall = solid(10, 0, 10, 10);
    const r = resolveAxisX(body, 0, [wall]);
    expect(r).toEqual({ x: 5, vx: 0, hitWall: false });
  });

  it('passthrough solids are ignored on the X axis', () => {
    const body = rect(0, 0, 10, 10);
    const platform = solid(5, 0, 10, 2, true);
    const r = resolveAxisX(body, 10, [platform]);
    expect(r).toEqual({ x: 10, vx: 10, hitWall: false });
  });

  it('resolves against multiple solids, settling at the nearest blocking wall', () => {
    const body = rect(0, 0, 10, 10);
    const wallA = solid(28, 0, 10, 10);
    const wallB = solid(22, 0, 10, 10);
    const rOrderAB = resolveAxisX(body, 25, [wallA, wallB]);
    const rOrderBA = resolveAxisX(body, 25, [wallB, wallA]);
    expect(rOrderAB.x).toBe(12);
    expect(rOrderBA.x).toBe(12);
    expect(rOrderAB).toEqual(rOrderBA);
    expect(rOrderAB.hitWall).toBe(true);
    expect(rOrderAB.vx).toBe(0);
  });

  it('does not mutate body or solids', () => {
    const body = rect(0, 0, 10, 10);
    const wall = solid(15, 0, 10, 10);
    const sBody = clone(body);
    const sWall = clone(wall);
    resolveAxisX(body, 10, [wall]);
    expect(body).toEqual(sBody);
    expect(wall).toEqual(sWall);
  });
});

describe('resolveAxisY', () => {
  it('falling onto a solid: lands on top, zeros vy, sets landed', () => {
    const body = rect(0, 0, 10, 10);
    const floor = solid(0, 25, 10, 10);
    const r = resolveAxisY(body, 20, [floor], 10);
    expect(r.y).toBe(15);
    expect(r.vy).toBe(0);
    expect(r.landed).toBe(true);
    expect(r.hitCeiling).toBe(false);
  });

  it('rising into a ceiling: snaps to its bottom, zeros vy, sets hitCeiling', () => {
    const body = rect(0, 20, 10, 10);
    const ceiling = solid(0, 0, 10, 10);
    const r = resolveAxisY(body, -15, [ceiling], 30);
    expect(r.y).toBe(10);
    expect(r.vy).toBe(0);
    expect(r.hitCeiling).toBe(true);
    expect(r.landed).toBe(false);
  });

  it('falling onto passthrough from above (prevBottom <= platform.y) lands', () => {
    const body = rect(0, 0, 10, 10);
    const platform = solid(0, 12, 10, 4, true);
    const r = resolveAxisY(body, 5, [platform], 10);
    expect(r.y).toBe(2);
    expect(r.vy).toBe(0);
    expect(r.landed).toBe(true);
    expect(r.hitCeiling).toBe(false);
  });

  it('falling onto passthrough from below (prevBottom > platform.y) passes through', () => {
    const body = rect(0, 0, 10, 10);
    const platform = solid(0, 5, 10, 4, true);
    const r = resolveAxisY(body, 5, [platform], 10);
    expect(r.y).toBe(5);
    expect(r.vy).toBe(5);
    expect(r.landed).toBe(false);
    expect(r.hitCeiling).toBe(false);
  });

  it('prevBottom exactly at platform.y counts as "from above" and lands', () => {
    const body = rect(0, 0, 10, 10);
    const platform = solid(0, 10, 10, 4, true);
    const r = resolveAxisY(body, 5, [platform], 10);
    expect(r.y).toBe(0);
    expect(r.landed).toBe(true);
  });

  it('rising through a passthrough platform passes through', () => {
    const body = rect(0, 20, 10, 10);
    const platform = solid(0, 15, 10, 4, true);
    const r = resolveAxisY(body, -10, [platform], 30);
    expect(r.y).toBe(10);
    expect(r.vy).toBe(-10);
    expect(r.landed).toBe(false);
    expect(r.hitCeiling).toBe(false);
  });

  it('no collision: advances by vy, leaves vy unchanged', () => {
    const body = rect(0, 0, 10, 10);
    const r = resolveAxisY(body, 5, [], 10);
    expect(r).toEqual({ y: 5, vy: 5, landed: false, hitCeiling: false });
  });

  it('vy = 0 is a no-op even when body overlaps a solid', () => {
    const body = rect(0, 5, 10, 10);
    const floor = solid(0, 10, 10, 10);
    const r = resolveAxisY(body, 0, [floor], 15);
    expect(r).toEqual({ y: 5, vy: 0, landed: false, hitCeiling: false });
  });

  it('lands on the highest of two overlapping platforms regardless of order', () => {
    const body = rect(0, 0, 10, 10);
    const higher = solid(0, 32, 10, 8);
    const lower = solid(0, 35, 10, 8);
    const rHiFirst = resolveAxisY(body, 30, [higher, lower], 10);
    const rLoFirst = resolveAxisY(body, 30, [lower, higher], 10);
    expect(rHiFirst.y).toBe(22);
    expect(rLoFirst.y).toBe(22);
    expect(rHiFirst).toEqual(rLoFirst);
    expect(rHiFirst.landed).toBe(true);
    expect(rHiFirst.vy).toBe(0);
  });

  it('does not mutate body or solids', () => {
    const body = rect(0, 0, 10, 10);
    const floor = solid(0, 25, 10, 10);
    const sBody = clone(body);
    const sFloor = clone(floor);
    resolveAxisY(body, 20, [floor], 10);
    expect(body).toEqual(sBody);
    expect(floor).toEqual(sFloor);
  });
});

describe('determinism', () => {
  it('resolveAxisX is deterministic across calls with identical inputs', () => {
    const body = rect(0, 0, 10, 10);
    const wall = solid(15, 0, 10, 10);
    const a = resolveAxisX(body, 10, [wall]);
    const b = resolveAxisX(body, 10, [wall]);
    expect(a).toEqual(b);
  });

  it('resolveAxisY is deterministic across calls with identical inputs', () => {
    const body = rect(0, 0, 10, 10);
    const floor = solid(0, 25, 10, 10);
    const a = resolveAxisY(body, 20, [floor], 10);
    const b = resolveAxisY(body, 20, [floor], 10);
    expect(a).toEqual(b);
  });
});
