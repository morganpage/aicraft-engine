import { describe, it, expect } from 'vitest';
import { solveCCD, IK_CCD_DEFAULT_ITERATIONS } from '../animation/ik';

describe('solveCCD — convergence', () => {
  it('converges closer to a reachable target over iterations (4-segment chain)', () => {
    const positions = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 15, y: 0 },
    ];
    const boneLengths = [5, 5, 5];
    const target = { x: 0, y: 10 }; // dist 10 < total 15 -> reachable
    const r1 = solveCCD(positions, boneLengths, target, { iterations: 1 });
    const r8 = solveCCD(positions, boneLengths, target, { iterations: 8 });
    const end1 = r1.positions[3];
    const end8 = r8.positions[3];
    const d1 = Math.hypot(end1.x - target.x, end1.y - target.y);
    const d8 = Math.hypot(end8.x - target.x, end8.y - target.y);
    expect(d8).toBeLessThan(d1);
  });

  it('default iteration count equals IK_CCD_DEFAULT_ITERATIONS', () => {
    const positions = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 15, y: 0 },
    ];
    const boneLengths = [5, 5, 5];
    const target = { x: 0, y: 10 };
    const def = solveCCD(positions, boneLengths, target);
    const exp = solveCCD(positions, boneLengths, target, {
      iterations: IK_CCD_DEFAULT_ITERATIONS,
    });
    expect(def.positions).toEqual(exp.positions);
  });
});

describe('solveCCD — unreachable', () => {
  it('aligns the chain straight toward an unreachable target (no overshoot)', () => {
    const positions = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 15, y: 0 },
    ];
    const boneLengths = [5, 5, 5];
    const target = { x: 100, y: 0 }; // already along +X -> straight stretch
    const res = solveCCD(positions, boneLengths, target, { iterations: 8 });
    const end = res.positions[3];
    // Total length = 15; chain points +X -> end at (15, 0).
    expect(end.x).toBeCloseTo(15, 6);
    expect(end.y).toBeCloseTo(0, 6);
    expect(res.solved).toBe(false);
  });
});

describe('solveCCD — defensive', () => {
  it('never throws on a degenerate (all-coincident) chain', () => {
    const positions = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    expect(() => solveCCD(positions, [0, 0], { x: 5, y: 5 }, { iterations: 8 })).not.toThrow();
  });

  it('returns a cloned positions array and rotations for a 2-joint chain', () => {
    const res = solveCCD(
      [{ x: 0, y: 0 }, { x: 5, y: 0 }],
      [5],
      { x: 10, y: 0 },
      { iterations: 4 },
    );
    expect(res.positions).toHaveLength(2);
    expect(res.rotations).toHaveLength(1);
  });

  it('does not mutate the input positions array', () => {
    const positions = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 15, y: 0 },
    ];
    const snap = JSON.parse(JSON.stringify(positions));
    solveCCD(positions, [5, 5, 5], { x: 0, y: 10 }, { iterations: 8 });
    expect(positions).toEqual(snap);
  });

  it('never throws on a single-joint (root only) chain', () => {
    expect(() => solveCCD([{ x: 0, y: 0 }], [], { x: 5, y: 5 }, { iterations: 8 })).not.toThrow();
  });
});
