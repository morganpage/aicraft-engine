import { describe, it, expect } from 'vitest';
import { probeWall, probeGround, probeCeiling } from '../collision/aabb';
import type { Rect, Solid } from '../collision/types';

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, width: w, height: h });
const solid = (
  x: number,
  y: number,
  w: number,
  h: number,
  passthrough = false,
  ladder = false,
): Solid => ({
  x,
  y,
  width: w,
  height: h,
  passthrough,
  ...(ladder ? { ladder: true } : {}),
});
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('collision probes — geometry-only wall/ground/ceiling queries', () => {
  describe('probeWall', () => {
    it('returns the solid a body is flush against on the right (side=+1, gap 0)', () => {
      const body = rect(0, 0, 10, 10);
      const wall = solid(10, 0, 10, 10); // wall left edge at body right edge
      expect(probeWall(body, 1, 5, [wall])).toBe(wall);
    });

    it('finds a left wall (side=-1)', () => {
      const body = rect(10, 0, 10, 10);
      const wall = solid(0, 0, 5, 10); // wall right edge at x=5, body left edge at x=10
      expect(probeWall(body, -1, 10, [wall])).toBe(wall);
    });

    it('returns null when the gap is larger than distance', () => {
      const body = rect(0, 0, 10, 10);
      const wall = solid(20, 0, 10, 10); // gap = 10
      expect(probeWall(body, 1, 5, [wall])).toBeNull();
    });

    it('finds a wall exactly `distance` pixels away (inclusive upper bound)', () => {
      const body = rect(0, 0, 10, 10);
      const wall = solid(15, 0, 10, 10); // gap = 5 == distance
      expect(probeWall(body, 1, 5, [wall])).toBe(wall);
    });

    it('finds a wall flush on the left at exactly distance', () => {
      const body = rect(15, 0, 10, 10);
      const wall = solid(0, 0, 10, 10); // wall right edge at x=10, body left at x=15, gap=5
      expect(probeWall(body, -1, 5, [wall])).toBe(wall);
    });

    it('ignores passthrough solids as walls', () => {
      const body = rect(0, 0, 10, 10);
      const platform = solid(12, 0, 10, 10, true);
      expect(probeWall(body, 1, 5, [platform])).toBeNull();
    });

    it('ignores ladder solids as walls', () => {
      const body = rect(0, 0, 10, 10);
      const ladder = solid(12, 0, 10, 10, false, true);
      expect(probeWall(body, 1, 5, [ladder])).toBeNull();
    });

    it('does not return a wall out of vertical range (no Y overlap)', () => {
      const body = rect(0, 0, 10, 10); // y=[0,10]
      const wall = solid(10, 11, 10, 10); // y=[11,21] — body bottom (10) < wall top (11)
      expect(probeWall(body, 1, 5, [wall])).toBeNull();
    });

    it('counts flush vertical corner contact (body bottom exactly at wall top)', () => {
      const body = rect(0, 0, 10, 10); // y=[0,10]
      const wall = solid(10, 10, 10, 10); // y=[10,20] — inclusive edge contact
      expect(probeWall(body, 1, 5, [wall])).toBe(wall);
    });

    it('returns the nearest of multiple walls, independent of array order', () => {
      const body = rect(0, 0, 10, 10);
      const near = solid(12, 0, 10, 10); // gap 2
      const far = solid(15, 0, 10, 10); // gap 5
      expect(probeWall(body, 1, 10, [near, far])).toBe(near);
      expect(probeWall(body, 1, 10, [far, near])).toBe(near);
    });

    it('distance <= 0 returns null', () => {
      const body = rect(0, 0, 10, 10);
      const wall = solid(10, 0, 10, 10);
      expect(probeWall(body, 1, 0, [wall])).toBeNull();
      expect(probeWall(body, 1, -1, [wall])).toBeNull();
    });

    it('empty solids returns null', () => {
      expect(probeWall(rect(0, 0, 10, 10), 1, 5, [])).toBeNull();
    });

    it('does not mutate its inputs', () => {
      const body = rect(0, 0, 10, 10);
      const wall = solid(12, 0, 10, 10);
      const sBody = clone(body);
      const sWall = clone(wall);
      probeWall(body, 1, 5, [wall]);
      expect(body).toEqual(sBody);
      expect(wall).toEqual(sWall);
    });
  });

  describe('probeGround', () => {
    it('finds a floor within distance below', () => {
      const body = rect(0, 0, 10, 10); // bottom = 10
      const floor = solid(0, 12, 10, 10); // top = 12
      expect(probeGround(body, 5, [floor])).toBe(floor);
    });

    it('finds a floor flush with the body bottom (top exactly at bottom)', () => {
      const body = rect(0, 0, 10, 10); // bottom = 10
      const floor = solid(0, 10, 10, 10); // top = 10
      expect(probeGround(body, 5, [floor])).toBe(floor);
    });

    it('counts passthrough platforms as ground', () => {
      const body = rect(0, 0, 10, 10);
      const platform = solid(0, 12, 10, 4, true);
      expect(probeGround(body, 5, [platform])).toBe(platform);
    });

    it('does not count ladders as ground', () => {
      const body = rect(0, 0, 10, 10);
      const ladder = solid(0, 12, 10, 10, false, true);
      expect(probeGround(body, 5, [ladder])).toBeNull();
    });

    it('returns null when the floor is farther than distance', () => {
      const body = rect(0, 0, 10, 10); // bottom = 10
      const floor = solid(0, 20, 10, 10); // top = 20, distance only reaches 15
      expect(probeGround(body, 5, [floor])).toBeNull();
    });

    it('returns null when there is no horizontal overlap', () => {
      const body = rect(0, 0, 10, 10); // x=[0,10]
      const floor = solid(20, 12, 10, 10); // x=[20,30]
      expect(probeGround(body, 5, [floor])).toBeNull();
    });

    it('returns the highest (nearest) surface among multiple, independent of order', () => {
      const body = rect(0, 0, 10, 10); // bottom = 10
      const higher = solid(0, 12, 10, 10); // top = 12
      const lower = solid(0, 16, 10, 10); // top = 16
      expect(probeGround(body, 10, [higher, lower])).toBe(higher);
      expect(probeGround(body, 10, [lower, higher])).toBe(higher);
    });

    it('distance <= 0 returns null', () => {
      const body = rect(0, 0, 10, 10);
      const floor = solid(0, 10, 10, 10);
      expect(probeGround(body, 0, [floor])).toBeNull();
      expect(probeGround(body, -1, [floor])).toBeNull();
    });

    it('empty solids returns null', () => {
      expect(probeGround(rect(0, 0, 10, 10), 5, [])).toBeNull();
    });

    it('does not mutate its inputs', () => {
      const body = rect(0, 0, 10, 10);
      const floor = solid(0, 12, 10, 10);
      const sBody = clone(body);
      const sFloor = clone(floor);
      probeGround(body, 5, [floor]);
      expect(body).toEqual(sBody);
      expect(floor).toEqual(sFloor);
    });
  });

  describe('probeCeiling', () => {
    it('finds a ceiling within distance above', () => {
      const body = rect(0, 20, 10, 10); // top = 20
      const ceiling = solid(0, 5, 10, 10); // bottom = 15
      expect(probeCeiling(body, 10, [ceiling])).toBe(ceiling);
    });

    it('finds a ceiling flush with the body top (bottom exactly at top)', () => {
      const body = rect(0, 20, 10, 10); // top = 20
      const ceiling = solid(0, 10, 10, 10); // bottom = 20
      expect(probeCeiling(body, 10, [ceiling])).toBe(ceiling);
    });

    it('ignores passthrough solids as ceiling', () => {
      const body = rect(0, 20, 10, 10);
      const platform = solid(0, 12, 10, 8, true); // bottom = 20
      expect(probeCeiling(body, 10, [platform])).toBeNull();
    });

    it('ignores ladder solids as ceiling', () => {
      const body = rect(0, 20, 10, 10);
      const ladder = solid(0, 5, 10, 10, false, true);
      expect(probeCeiling(body, 10, [ladder])).toBeNull();
    });

    it('returns null when the ceiling is out of range', () => {
      const body = rect(0, 20, 10, 10); // top = 20, range [10,20]
      const ceiling = solid(0, 0, 10, 5); // bottom = 5 < 10
      expect(probeCeiling(body, 10, [ceiling])).toBeNull();
    });

    it('returns null when there is no horizontal overlap', () => {
      const body = rect(0, 20, 10, 10); // x=[0,10]
      const ceiling = solid(20, 5, 10, 10); // x=[20,30]
      expect(probeCeiling(body, 10, [ceiling])).toBeNull();
    });

    it('returns the lowest underside (nearest) among multiple, independent of order', () => {
      const body = rect(0, 20, 10, 10); // top = 20, range [5,20]
      const near = solid(0, 8, 10, 10); // bottom = 18
      const far = solid(0, 5, 10, 10); // bottom = 15
      expect(probeCeiling(body, 15, [near, far])).toBe(near);
      expect(probeCeiling(body, 15, [far, near])).toBe(near);
    });

    it('distance <= 0 returns null', () => {
      const body = rect(0, 20, 10, 10);
      const ceiling = solid(0, 10, 10, 10);
      expect(probeCeiling(body, 0, [ceiling])).toBeNull();
      expect(probeCeiling(body, -1, [ceiling])).toBeNull();
    });

    it('empty solids returns null', () => {
      expect(probeCeiling(rect(0, 20, 10, 10), 10, [])).toBeNull();
    });

    it('does not mutate its inputs', () => {
      const body = rect(0, 20, 10, 10);
      const ceiling = solid(0, 5, 10, 10);
      const sBody = clone(body);
      const sCeiling = clone(ceiling);
      probeCeiling(body, 10, [ceiling]);
      expect(body).toEqual(sBody);
      expect(ceiling).toEqual(sCeiling);
    });
  });

  describe('determinism', () => {
    it('probeWall is deterministic across calls with identical inputs', () => {
      const body = rect(0, 0, 10, 10);
      const wall = solid(12, 0, 10, 10);
      const a = probeWall(body, 1, 5, [wall]);
      const b = probeWall(body, 1, 5, [wall]);
      expect(a).toBe(b);
    });

    it('probeGround is deterministic across calls with identical inputs', () => {
      const body = rect(0, 0, 10, 10);
      const floor = solid(0, 12, 10, 10);
      const a = probeGround(body, 5, [floor]);
      const b = probeGround(body, 5, [floor]);
      expect(a).toBe(b);
    });

    it('probeCeiling is deterministic across calls with identical inputs', () => {
      const body = rect(0, 20, 10, 10);
      const ceiling = solid(0, 5, 10, 10);
      const a = probeCeiling(body, 10, [ceiling]);
      const b = probeCeiling(body, 10, [ceiling]);
      expect(a).toBe(b);
    });

    it('all three return null consistently for empty solids', () => {
      const body = rect(0, 0, 10, 10);
      expect(probeWall(body, 1, 5, [])).toBeNull();
      expect(probeWall(body, -1, 5, [])).toBeNull();
      expect(probeGround(body, 5, [])).toBeNull();
      expect(probeCeiling(body, 5, [])).toBeNull();
    });

    it('all three return null consistently for distance <= 0', () => {
      const body = rect(0, 0, 10, 10);
      const wall = solid(10, 0, 10, 10);
      const floor = solid(0, 10, 10, 10);
      const ceiling = solid(0, -10, 10, 10);
      for (const d of [0, -1, -100]) {
        expect(probeWall(body, 1, d, [wall])).toBeNull();
        expect(probeGround(body, d, [floor])).toBeNull();
        expect(probeCeiling(body, d, [ceiling])).toBeNull();
      }
    });
  });
});
