import { describe, it, expect } from 'vitest';
import { solveLimb, calculateBendDir, IK_LIMB_DEAD_ZONE } from '../animation/ik';

describe('calculateBendDir', () => {
  it('returns +1 when the pole is on the positive-rotation side of root->target', () => {
    // root->target points +Y. Pole at (-1, 5) is to the -X side -> cross > 0 -> +1.
    expect(calculateBendDir({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: -1, y: 5 })).toBe(1);
  });

  it('returns -1 when the pole is on the negative-rotation side', () => {
    expect(calculateBendDir({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 1, y: 5 })).toBe(-1);
  });

  it('tie-breaks to +1 when the pole is exactly on the root->target line', () => {
    expect(calculateBendDir({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 5 })).toBe(1);
  });

  it('returns a Number (not a branded literal)', () => {
    expect(typeof calculateBendDir({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 })).toBe('number');
  });
});

describe('solveLimb — research worked example (law of cosines)', () => {
  it('places the joint at {-4.8, 3.6} for the canonical setup (BIT-EXACT)', () => {
    // root=(0,0), target=(0,10), lengthA=6, lengthB=8, bendDir=+1.
    // Per research Pattern 1: a=3.6, h=4.8 -> joint = root + a*u + h*v = (-4.8, 3.6).
    const res = solveLimb({ x: 0, y: 0 }, { x: 0, y: 10 }, 6, 8, { bendDir: 1 });
    expect(res.jointPos.x).toBe(-4.8);
    expect(res.jointPos.y).toBe(3.6);
    expect(res.endPos).toEqual({ x: 0, y: 10 });
    expect(res.solved).toBe(true);
  });

  it('preserves both bone lengths exactly (root->joint = 6, joint->end = 8)', () => {
    const res = solveLimb({ x: 0, y: 0 }, { x: 0, y: 10 }, 6, 8, { bendDir: 1 });
    const d1 = Math.hypot(res.jointPos.x, res.jointPos.y);
    const d2 = Math.hypot(res.endPos.x - res.jointPos.x, res.endPos.y - res.jointPos.y);
    expect(d1).toBeCloseTo(6, 10);
    expect(d2).toBeCloseTo(8, 10);
  });

  it('mirrors the joint across the root->target line when bendDir flips to -1', () => {
    const pos = solveLimb({ x: 0, y: 0 }, { x: 0, y: 10 }, 6, 8, { bendDir: 1 });
    const neg = solveLimb({ x: 0, y: 0 }, { x: 0, y: 10 }, 6, 8, { bendDir: -1 });
    expect(neg.jointPos.x).toBe(-pos.jointPos.x);
    expect(neg.jointPos.y).toBe(pos.jointPos.y);
    expect(neg.solved).toBe(true);
  });
});

describe('solveLimb — defensive cases', () => {
  it('clamps straight toward an unreachable target with solved=false', () => {
    const res = solveLimb({ x: 0, y: 0 }, { x: 0, y: 100 }, 6, 8, { bendDir: 1 });
    expect(res.jointPos).toEqual({ x: 0, y: 6 });
    expect(res.endPos).toEqual({ x: 0, y: 14 });
    expect(res.solved).toBe(false);
  });

  it('folds gracefully when the target is under-extended (inside |la-lb| disk)', () => {
    // d=1 < |6-8|=2 -> under-extended. Joint on the perpendicular; no NaN.
    const res = solveLimb({ x: 0, y: 0 }, { x: 0, y: 1 }, 6, 8, { bendDir: 1 });
    expect(Number.isFinite(res.jointPos.x)).toBe(true);
    expect(Number.isFinite(res.jointPos.y)).toBe(true);
    expect(res.endPos).toEqual({ x: 0, y: 1 });
  });

  it('handles target exactly on root without producing NaN', () => {
    const res = solveLimb({ x: 0, y: 0 }, { x: 0, y: 0 }, 6, 8, { bendDir: 1 });
    expect(Number.isFinite(res.jointPos.x)).toBe(true);
    expect(Number.isFinite(res.jointPos.y)).toBe(true);
    expect(Number.isFinite(res.endPos.x)).toBe(true);
    expect(Number.isFinite(res.endPos.y)).toBe(true);
  });

  it('dead-zone at near-full-extension prevents NaN/jitter (joint stays finite, off the line)', () => {
    // d=13.999, just inside maxReach=14. Without the dead-zone, h -> 0.
    const res = solveLimb({ x: 0, y: 0 }, { x: 0, y: 13.999 }, 6, 8, { bendDir: 1 });
    expect(Number.isFinite(res.jointPos.x)).toBe(true);
    expect(Number.isFinite(res.jointPos.y)).toBe(true);
    // The dead-zone pins the joint at least IK_LIMB_DEAD_ZONE off the root->target line.
    // For target straight up + bendDir +1, joint.x = -h, so |joint.x| >= dead-zone.
    expect(Math.abs(res.jointPos.x)).toBeGreaterThanOrEqual(IK_LIMB_DEAD_ZONE * 0.999);
  });

  it('defaults bendDir to +1 when opts are omitted', () => {
    const withDefault = solveLimb({ x: 0, y: 0 }, { x: 0, y: 10 }, 6, 8);
    const explicit = solveLimb({ x: 0, y: 0 }, { x: 0, y: 10 }, 6, 8, { bendDir: 1 });
    expect(withDefault).toEqual(explicit);
  });

  it('does not mutate the input root or target', () => {
    const root = { x: 1, y: 2 };
    const target = { x: 3, y: 9 };
    const rootSnap = { ...root };
    const targetSnap = { ...target };
    solveLimb(root, target, 6, 8, { bendDir: 1 });
    expect(root).toEqual(rootSnap);
    expect(target).toEqual(targetSnap);
  });

  it('places the joint on the same side as the pole (integration with calculateBendDir)', () => {
    // Pole to the -X side of the root->target line -> bendDir +1 -> joint bends -X.
    const pole = { x: -1, y: 5 };
    const bendDir = calculateBendDir({ x: 0, y: 0 }, { x: 0, y: 10 }, pole);
    const res = solveLimb({ x: 0, y: 0 }, { x: 0, y: 10 }, 6, 8, { bendDir });
    expect(bendDir).toBe(1);
    expect(res.jointPos.x).toBeLessThan(0);
  });

  it('never throws on degenerate zero-length bones', () => {
    expect(() => solveLimb({ x: 0, y: 0 }, { x: 5, y: 5 }, 0, 0, { bendDir: 1 })).not.toThrow();
  });
});
