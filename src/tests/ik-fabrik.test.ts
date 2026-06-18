import { describe, it, expect } from 'vitest';
import {
  solveFABRIK,
  reconstructRotations,
  IK_POSITION_TOLERANCE_SQ,
  IK_FABRIK_DEFAULT_ITERATIONS,
} from '../animation/ik';

describe('solveFABRIK — research worked example', () => {
  it('reaches target {5,5} in 1 iteration (2-segment chain)', () => {
    const positions = [{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 10 }];
    const boneLengths = [5, 5];
    const res = solveFABRIK(positions, boneLengths, { x: 5, y: 5 }, { iterations: 1 });
    const end = res.positions[res.positions.length - 1];
    const dx = end.x - 5;
    const dy = end.y - 5;
    expect(dx * dx + dy * dy).toBeLessThan(IK_POSITION_TOLERANCE_SQ);
    expect(res.solved).toBe(true);
  });

  it('preserves every bone length after solve', () => {
    const positions = [{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 10 }];
    const boneLengths = [5, 5];
    const res = solveFABRIK(positions, boneLengths, { x: 5, y: 5 }, { iterations: 1 });
    for (let i = 0; i < boneLengths.length; i++) {
      const a = res.positions[i];
      const b = res.positions[i + 1];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      expect(d).toBeCloseTo(boneLengths[i], 6);
    }
  });
});

describe('solveFABRIK — unreachable', () => {
  it('stretches straight toward an unreachable target with no overshoot', () => {
    const positions = [{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 10 }];
    const boneLengths = [5, 5];
    const res = solveFABRIK(positions, boneLengths, { x: 100, y: 100 }, { iterations: 4 });
    const root = res.positions[0];
    const end = res.positions[2];
    const span = Math.hypot(end.x - root.x, end.y - root.y);
    // Total chain length = 10; unreachable -> end-to-root span == total length.
    expect(span).toBeCloseTo(10, 6);
    expect(res.solved).toBe(false);
  });
});

describe('solveFABRIK — iterations', () => {
  it('default iteration count equals IK_FABRIK_DEFAULT_ITERATIONS', () => {
    const positions = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
    const boneLengths = [10, 10];
    const target = { x: 10, y: 15 };
    const def = solveFABRIK(positions, boneLengths, target);
    const exp = solveFABRIK(positions, boneLengths, target, {
      iterations: IK_FABRIK_DEFAULT_ITERATIONS,
    });
    expect(def.positions).toEqual(exp.positions);
  });

  it('honors the iterations option (1 vs 4 produce different convergence)', () => {
    const positions = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
    const boneLengths = [10, 10];
    const target = { x: 10, y: 15 };
    const r1 = solveFABRIK(positions, boneLengths, target, { iterations: 1 });
    const r4 = solveFABRIK(positions, boneLengths, target, { iterations: 4 });
    const end1 = r1.positions[2];
    const end4 = r4.positions[2];
    const d1 = Math.hypot(end1.x - target.x, end1.y - target.y);
    const d4 = Math.hypot(end4.x - target.x, end4.y - target.y);
    expect(d4).toBeLessThan(d1);
  });
});

describe('solveFABRIK — purity', () => {
  it('does not mutate the input positions array or its elements', () => {
    const positions = [{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 10 }];
    const boneLengths = [5, 5];
    const snap = JSON.parse(JSON.stringify(positions));
    solveFABRIK(positions, boneLengths, { x: 5, y: 5 }, { iterations: 4 });
    expect(positions).toEqual(snap);
  });

  it('returns a freshly-allocated positions array (not the input)', () => {
    const positions = [{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 10 }];
    const res = solveFABRIK(positions, [5, 5], { x: 5, y: 5 }, { iterations: 1 });
    expect(res.positions).not.toBe(positions);
  });
});

describe('solveFABRIK — defensive', () => {
  it('never throws on a degenerate (too-short) chain', () => {
    expect(() => solveFABRIK([{ x: 0, y: 0 }], [], { x: 5, y: 5 }, { iterations: 4 })).not.toThrow();
  });
});

describe('reconstructRotations', () => {
  it('returns +90 deg (PI/2) for bone 1 of the L-shape {0,0}->{1,0}->{1,1} (BIT-EXACT)', () => {
    const rotations = reconstructRotations([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(rotations).toHaveLength(2);
    expect(rotations[0]).toBeCloseTo(0, 10);
    expect(rotations[1]).toBeCloseTo(Math.PI / 2, 10);
  });

  it('returns an empty array for a single position (no bones)', () => {
    expect(reconstructRotations([{ x: 0, y: 0 }])).toEqual([]);
  });

  it('inherits parent angle (local 0) for a zero-length bone', () => {
    expect(reconstructRotations([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toEqual([0]);
  });

  it('does not mutate the input array', () => {
    const positions = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    const snap = JSON.parse(JSON.stringify(positions));
    reconstructRotations(positions);
    expect(positions).toEqual(snap);
  });
});
