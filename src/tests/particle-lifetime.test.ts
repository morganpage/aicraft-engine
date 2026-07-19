import { describe, it, expect } from 'vitest';
import { particleAge, particleSizeCurve, particleAlphaCurve } from '../particles/lifetime';
import type { Particle } from '../particles/types';

/**
 * Contract: lifetime readers are pure functions of `(life, maxLife)`.
 *
 * `particleAge` is the anchor: every other reader (size, alpha) is a linear
 * interpolation keyed off it, so the age invariants (0 at spawn, 1 at death,
 * monotonic non-decreasing as life decreases) propagate everywhere.
 *
 * `maxLife === 0` is the documented malformed-particle guard: age returns 0
 * (no divide-by-zero). The size/alpha curves thus return their `start*` value
 * — the renderer draws the particle at its spawn appearance, never NaN.
 */
function makeParticle(life: number, maxLife: number): Particle {
  return { x: 0, y: 0, vx: 0, vy: 0, life, maxLife, size: 1 };
}

describe('particleAge', () => {
  it('is 0 at spawn (life === maxLife)', () => {
    expect(particleAge(makeParticle(30, 30))).toBe(0);
  });

  it('is 1 at death (life === 0)', () => {
    expect(particleAge(makeParticle(0, 30))).toBe(1);
  });

  it('is 0.5 at the midpoint (life === maxLife / 2)', () => {
    expect(particleAge(makeParticle(15, 30))).toBe(0.5);
  });

  it('is monotonic non-decreasing as life decreases', () => {
    const ages = [30, 25, 20, 15, 10, 5, 0].map((life) =>
      particleAge(makeParticle(life, 30)),
    );
    for (let i = 1; i < ages.length; i++) {
      expect(ages[i]).toBeGreaterThanOrEqual(ages[i - 1]);
    }
  });

  it('clamps above 1 when life goes negative (over-lived particle)', () => {
    expect(particleAge(makeParticle(-5, 30))).toBe(1);
  });

  it('returns 0 when maxLife === 0 (no divide-by-zero; malformed particle)', () => {
    expect(particleAge(makeParticle(0, 0))).toBe(0);
  });

  it('returns 0 when maxLife is negative (defensive guard)', () => {
    expect(particleAge(makeParticle(0, -10))).toBe(0);
  });
});

describe('particleSizeCurve', () => {
  it('returns startSize at age 0 (spawn)', () => {
    expect(particleSizeCurve(makeParticle(30, 30), 4, 12)).toBe(4);
  });

  it('returns endSize at age 1 (death)', () => {
    expect(particleSizeCurve(makeParticle(0, 30), 4, 12)).toBe(12);
  });

  it('linearly interpolates at the midpoint', () => {
    expect(particleSizeCurve(makeParticle(15, 30), 4, 12)).toBe(8);
  });

  it('returns startSize when maxLife === 0 (age clamps to 0)', () => {
    expect(particleSizeCurve(makeParticle(0, 0), 4, 12)).toBe(4);
  });

  it('interpolates downward when endSize < startSize (shrink curve)', () => {
    expect(particleSizeCurve(makeParticle(15, 30), 12, 4)).toBe(8);
  });
});

describe('particleAlphaCurve', () => {
  it('returns startAlpha at age 0 (spawn)', () => {
    expect(particleAlphaCurve(makeParticle(30, 30), 1, 0)).toBe(1);
  });

  it('returns endAlpha at age 1 (death)', () => {
    expect(particleAlphaCurve(makeParticle(0, 30), 1, 0)).toBe(0);
  });

  it('linearly interpolates at the midpoint', () => {
    expect(particleAlphaCurve(makeParticle(15, 30), 1, 0)).toBe(0.5);
  });

  it('clamps result to [0, 1] when startAlpha exceeds 1', () => {
    expect(particleAlphaCurve(makeParticle(30, 30), 2, 0.5)).toBe(1);
  });

  it('clamps result to [0, 1] when endAlpha is below 0', () => {
    expect(particleAlphaCurve(makeParticle(0, 30), 0.5, -1)).toBe(0);
  });

  it('clamps result to [0, 1] at midpoint with out-of-range endpoints', () => {
    // Linear interp 2 + (-1 - 2) * 0.5 = 0.5, within range.
    expect(particleAlphaCurve(makeParticle(15, 30), 2, -1)).toBe(0.5);
  });

  it('returns startAlpha when maxLife === 0 (age clamps to 0)', () => {
    expect(particleAlphaCurve(makeParticle(0, 0), 0.7, 0.1)).toBe(0.7);
  });
});
