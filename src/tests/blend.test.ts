import { describe, it, expect } from 'vitest';
import { blendPose, blendPoses, type Pose2D } from '../blend';

const FULL_A: Pose2D = {
  translation: { x: 10, y: 20 },
  rotation: 0.5,
  scale: 2,
};
const FULL_B: Pose2D = {
  translation: { x: 30, y: -10 },
  rotation: 1.7,
  scale: 0.5,
};

describe('blendPose', () => {
  describe('endpoint weights', () => {
    it('returns pose A at weight 0 (all fields)', () => {
      const r = blendPose(FULL_A, FULL_B, 0);
      expect(r.translation).toEqual({ x: 10, y: 20 });
      expect(r.rotation).toBe(0.5);
      expect(r.scale).toBe(2);
    });

    it('returns pose B at weight 1 (all fields)', () => {
      const r = blendPose(FULL_A, FULL_B, 1);
      expect(r.translation).toEqual({ x: 30, y: -10 });
      expect(r.rotation).toBe(1.7);
      expect(r.scale).toBe(0.5);
    });

    it('returns the midpoint at weight 0.5', () => {
      const r = blendPose(FULL_A, FULL_B, 0.5);
      expect(r.translation).toEqual({ x: 20, y: 5 });
      expect(r.rotation).toBeCloseTo(1.1, 10);
      expect(r.scale).toBeCloseTo(1.25, 10);
    });
  });

  describe('both poses fully specified', () => {
    it('interpolates all three fields toward B as weight increases', () => {
      const r0 = blendPose(FULL_A, FULL_B, 0);
      const r1 = blendPose(FULL_A, FULL_B, 1);
      const rMid = blendPose(FULL_A, FULL_B, 0.5);
      // translation monotonically moves A -> B
      expect(r0.translation!.x).toBe(10);
      expect(r1.translation!.x).toBe(30);
      expect(rMid.translation!.x).toBe(20);
      // rotation
      expect(r0.rotation).toBe(0.5);
      expect(r1.rotation).toBe(1.7);
      expect(rMid.rotation).toBeCloseTo((0.5 + 1.7) / 2, 10);
      // scale
      expect(r0.scale).toBe(2);
      expect(r1.scale).toBe(0.5);
      expect(rMid.scale).toBeCloseTo((2 + 0.5) / 2, 10);
    });
  });

  describe('identity fallback for undefined fields', () => {
    it('treats missing translation in A as {0,0}', () => {
      const a: Pose2D = { rotation: 0, scale: 1 };
      const b: Pose2D = { translation: { x: 10, y: 10 }, rotation: 0, scale: 1 };
      const r = blendPose(a, b, 1);
      expect(r.translation).toEqual({ x: 10, y: 10 });
      const half = blendPose(a, b, 0.5);
      expect(half.translation).toEqual({ x: 5, y: 5 });
    });

    it('treats missing rotation in B as 0', () => {
      const a: Pose2D = { rotation: 2, scale: 1, translation: { x: 0, y: 0 } };
      const b: Pose2D = { scale: 1, translation: { x: 0, y: 0 } };
      const r = blendPose(a, b, 1);
      expect(r.rotation).toBe(0);
      const half = blendPose(a, b, 0.5);
      expect(half.rotation).toBeCloseTo(1, 10);
    });

    it('treats both missing scale as identity (result scale = 1)', () => {
      const a: Pose2D = { rotation: 0, translation: { x: 0, y: 0 } };
      const b: Pose2D = { rotation: 0, translation: { x: 0, y: 0 } };
      const r = blendPose(a, b, 0.5);
      expect(r.scale).toBe(1);
    });

    it('returns the full identity pose for two empty poses', () => {
      const r = blendPose({}, {}, 0.5);
      expect(r).toEqual({
        translation: { x: 0, y: 0 },
        rotation: 0,
        scale: 1,
      });
    });
  });

  describe('weight clamping', () => {
    it('treats weight < 0 as 0 (returns pose A)', () => {
      const r = blendPose(FULL_A, FULL_B, -0.5);
      expect(r.translation).toEqual({ x: 10, y: 20 });
      expect(r.rotation).toBe(0.5);
      expect(r.scale).toBe(2);
    });

    it('treats weight > 1 as 1 (returns pose B)', () => {
      const r = blendPose(FULL_A, FULL_B, 1.5);
      expect(r.translation).toEqual({ x: 30, y: -10 });
      expect(r.rotation).toBe(1.7);
      expect(r.scale).toBe(0.5);
    });
  });

  describe('result shape', () => {
    it('always includes all three fields (no undefined)', () => {
      const r = blendPose({}, {}, 0.5);
      expect(r.translation).not.toBeUndefined();
      expect(r.rotation).not.toBeUndefined();
      expect(r.scale).not.toBeUndefined();
    });

    it('includes all three fields even when inputs are partial', () => {
      const r = blendPose({ rotation: 1 }, { scale: 2 }, 0.5);
      expect(typeof r.translation!.x).toBe('number');
      expect(typeof r.translation!.y).toBe('number');
      expect(typeof r.rotation).toBe('number');
      expect(typeof r.scale).toBe('number');
    });
  });

  describe('purity', () => {
    it('does not mutate pose A', () => {
      const a: Pose2D = { translation: { x: 1, y: 2 }, rotation: 0.3, scale: 1.5 };
      const snap = JSON.parse(JSON.stringify(a));
      blendPose(a, FULL_B, 0.5);
      expect(a).toEqual(snap);
    });

    it('does not mutate pose B', () => {
      const b: Pose2D = { translation: { x: 9, y: 8 }, rotation: 0.7, scale: 0.25 };
      const snap = JSON.parse(JSON.stringify(b));
      blendPose(FULL_A, b, 0.5);
      expect(b).toEqual(snap);
    });

    it('returns a new object (not a reference to either input)', () => {
      const a: Pose2D = { translation: { x: 1, y: 2 }, rotation: 0, scale: 1 };
      const b: Pose2D = { translation: { x: 3, y: 4 }, rotation: 0, scale: 1 };
      const r = blendPose(a, b, 0);
      expect(r).not.toBe(a);
      expect(r).not.toBe(b);
      expect(r.translation).not.toBe(a.translation);
      expect(r.translation).not.toBe(b.translation);
    });
  });

  describe('determinism', () => {
    it('produces identical output for identical inputs', () => {
      const a: Pose2D = { translation: { x: 1.1, y: 2.2 }, rotation: 0.3, scale: 1.5 };
      const b: Pose2D = { translation: { x: 3.3, y: 4.4 }, rotation: 0.7, scale: 0.25 };
      const r1 = blendPose(a, b, 0.37);
      const r2 = blendPose(a, b, 0.37);
      expect(r1).toEqual(r2);
    });
  });
});

describe('blendPoses', () => {
  it('blends equal-length arrays element-by-element', () => {
    const a: Pose2D[] = [
      { translation: { x: 0, y: 0 }, rotation: 0, scale: 1 },
      { translation: { x: 10, y: 0 }, rotation: 0, scale: 1 },
    ];
    const b: Pose2D[] = [
      { translation: { x: 20, y: 0 }, rotation: 0, scale: 1 },
      { translation: { x: 30, y: 0 }, rotation: 0, scale: 1 },
    ];
    const r = blendPoses(a, b, 0.5);
    expect(r).toHaveLength(2);
    expect(r[0].translation).toEqual({ x: 10, y: 0 });
    expect(r[1].translation).toEqual({ x: 20, y: 0 });
  });

  it('pads shorter B with identity (A longer than B)', () => {
    const a: Pose2D[] = [
      { translation: { x: 10, y: 0 }, rotation: 0, scale: 1 },
      { translation: { x: 20, y: 0 }, rotation: 0, scale: 1 },
    ];
    const b: Pose2D[] = [
      { translation: { x: 30, y: 0 }, rotation: 0, scale: 1 },
    ];
    const r = blendPoses(a, b, 1);
    expect(r).toHaveLength(2);
    // index 0: blend A[0] -> B[0]
    expect(r[0].translation).toEqual({ x: 30, y: 0 });
    // index 1: B is missing -> identity -> at w=1 result = identity = {0,0}
    expect(r[1].translation).toEqual({ x: 0, y: 0 });
    expect(r[1].rotation).toBe(0);
    expect(r[1].scale).toBe(1);
  });

  it('pads shorter A with identity (B longer than A)', () => {
    const a: Pose2D[] = [
      { translation: { x: 10, y: 0 }, rotation: 0, scale: 1 },
    ];
    const b: Pose2D[] = [
      { translation: { x: 30, y: 0 }, rotation: 0, scale: 1 },
      { translation: { x: 40, y: 5 }, rotation: 0, scale: 1 },
    ];
    const r = blendPoses(a, b, 1);
    expect(r).toHaveLength(2);
    expect(r[0].translation).toEqual({ x: 30, y: 0 });
    // index 1: A missing -> identity; at w=1 result = B[1]
    expect(r[1].translation).toEqual({ x: 40, y: 5 });
  });

  it('midpoint with mismatched lengths blends toward identity', () => {
    const a: Pose2D[] = [
      { translation: { x: 10, y: 10 }, rotation: 0, scale: 1 },
    ];
    const b: Pose2D[] = [];
    const r = blendPoses(a, b, 0.5);
    expect(r).toHaveLength(1);
    // B missing -> identity {0,0}; midpoint of (10,10) and (0,0) = (5,5)
    expect(r[0].translation).toEqual({ x: 5, y: 5 });
  });

  it('returns an empty array for two empty arrays', () => {
    expect(blendPoses([], [], 0.5)).toEqual([]);
  });

  describe('purity', () => {
    it('does not mutate the input array A', () => {
      const a: Pose2D[] = [
        { translation: { x: 1, y: 2 }, rotation: 0, scale: 1 },
      ];
      const snap = JSON.parse(JSON.stringify(a));
      blendPoses(a, [{ translation: { x: 3, y: 4 }, rotation: 0, scale: 1 }], 0.5);
      expect(a).toEqual(snap);
    });

    it('does not mutate the input array B', () => {
      const b: Pose2D[] = [
        { translation: { x: 3, y: 4 }, rotation: 0, scale: 1 },
      ];
      const snap = JSON.parse(JSON.stringify(b));
      blendPoses([{ translation: { x: 1, y: 2 }, rotation: 0, scale: 1 }], b, 0.5);
      expect(b).toEqual(snap);
    });

    it('returns a new array of new objects', () => {
      const a: Pose2D[] = [{ translation: { x: 1, y: 2 }, rotation: 0, scale: 1 }];
      const b: Pose2D[] = [{ translation: { x: 3, y: 4 }, rotation: 0, scale: 1 }];
      const r = blendPoses(a, b, 0.5);
      expect(r).not.toBe(a);
      expect(r).not.toBe(b);
      expect(r[0]).not.toBe(a[0]);
      expect(r[0]).not.toBe(b[0]);
    });
  });
});
