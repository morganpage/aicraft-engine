import { describe, it, expect } from 'vitest';
import {
  advanceLocomotion,
  evaluateLocomotion,
  scaledGait,
  DEFAULT_GAIT,
  type LocomotionState,
  type GaitConfig,
} from '../animation/locomotion';

const TWO_PI = Math.PI * 2;

describe('advanceLocomotion', () => {
  it('advances phase by speed * dt * baseFrequency * 2π', () => {
    const state: LocomotionState = { phase: 0 };
    const next = advanceLocomotion(state, 1, 1, DEFAULT_GAIT);
    const expected = DEFAULT_GAIT.baseFrequency * TWO_PI;
    expect(next.phase).toBeCloseTo(expected, 10);
  });

  it('scales phase advance by speed', () => {
    const state: LocomotionState = { phase: 0 };
    const a = advanceLocomotion(state, 1, 1, DEFAULT_GAIT);
    const b = advanceLocomotion(state, 3, 1, DEFAULT_GAIT);
    expect(b.phase).toBeCloseTo(a.phase * 3, 10);
  });

  it('wraps phase to [0, 2π) (no unbounded growth)', () => {
    // baseFrequency = 1/(2π) makes one step at speed=1, dt=1 advance phase by exactly 1.
    const cfg: GaitConfig = { ...DEFAULT_GAIT, baseFrequency: 1 / TWO_PI };
    const state: LocomotionState = { phase: 6.0 };
    const next = advanceLocomotion(state, 1, 1, cfg);
    expect(next.phase).toBeLessThan(TWO_PI);
    expect(next.phase).toBeGreaterThanOrEqual(0);
    expect(next.phase).toBeCloseTo((6.0 + 1.0) % TWO_PI, 10);
  });

  it('stays bounded across many advances (no float drift to infinity)', () => {
    let state: LocomotionState = { phase: 0 };
    for (let i = 0; i < 10000; i++) {
      state = advanceLocomotion(state, 5, 1, DEFAULT_GAIT);
    }
    expect(state.phase).toBeLessThan(TWO_PI);
    expect(state.phase).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(state.phase)).toBe(true);
  });

  it('does not mutate the input state (returns a new object)', () => {
    const state: LocomotionState = { phase: 1.2 };
    const snap = { ...state };
    const next = advanceLocomotion(state, 2, 1, DEFAULT_GAIT);
    expect(state).toEqual(snap);
    expect(next).not.toBe(state);
  });

  it('produces continuous phase across a speed change (no reset / phase jump)', () => {
    // Walk at speed=1 for 3 ticks, then run at speed=5 for 2 ticks.
    let state: LocomotionState = { phase: 0 };
    state = advanceLocomotion(state, 1, 1, DEFAULT_GAIT);
    state = advanceLocomotion(state, 1, 1, DEFAULT_GAIT);
    state = advanceLocomotion(state, 1, 1, DEFAULT_GAIT);
    state = advanceLocomotion(state, 5, 1, DEFAULT_GAIT);
    state = advanceLocomotion(state, 5, 1, DEFAULT_GAIT);

    // Cumulative integral of dPhase = speed*freq*2π per tick.
    const expected =
      (3 * (1 * DEFAULT_GAIT.baseFrequency * TWO_PI) +
        2 * (5 * DEFAULT_GAIT.baseFrequency * TWO_PI)) %
      TWO_PI;
    expect(state.phase).toBeCloseTo(expected, 10);

    // A naive broken "phase = totalTicks * currentSpeed * freq * 2π" would give:
    const broken = (5 * 5 * DEFAULT_GAIT.baseFrequency * TWO_PI) % TWO_PI;
    expect(state.phase).not.toBeCloseTo(broken, 1);
  });

  it('at speed=0 phase is unchanged', () => {
    const state: LocomotionState = { phase: 2.0 };
    const next = advanceLocomotion(state, 0, 1, DEFAULT_GAIT);
    expect(next.phase).toBeCloseTo(2.0, 10);
  });
});

describe('evaluateLocomotion', () => {
  it('returns finite offsets for several phases', () => {
    for (let i = 0; i < 12; i++) {
      const phase = (i / 12) * TWO_PI;
      const pose = evaluateLocomotion({ phase }, DEFAULT_GAIT);
      expect(Number.isFinite(pose.hipOffset.x)).toBe(true);
      expect(Number.isFinite(pose.hipOffset.y)).toBe(true);
      expect(Number.isFinite(pose.leftFootOffset.x)).toBe(true);
      expect(Number.isFinite(pose.leftFootOffset.y)).toBe(true);
      expect(Number.isFinite(pose.rightFootOffset.x)).toBe(true);
      expect(Number.isFinite(pose.rightFootOffset.y)).toBe(true);
    }
  });

  it('hip bob is 0 at phase 0 (hip at rest)', () => {
    const pose = evaluateLocomotion({ phase: 0 }, DEFAULT_GAIT);
    expect(pose.hipOffset.y).toBeCloseTo(0, 10);
    expect(pose.hipOffset.x).toBeCloseTo(0, 10);
  });

  it('hip bob is 0 only at multiples of π (bobs twice per cycle)', () => {
    // |sin(φ)| is 0 at 0 and π, max at π/2 and 3π/2 → two dips per cycle.
    const atZero = Math.abs(evaluateLocomotion({ phase: 0 }, DEFAULT_GAIT).hipOffset.y);
    const atPi = Math.abs(evaluateLocomotion({ phase: Math.PI }, DEFAULT_GAIT).hipOffset.y);
    const atHalfPi = Math.abs(evaluateLocomotion({ phase: Math.PI / 2 }, DEFAULT_GAIT).hipOffset.y);
    expect(atZero).toBeCloseTo(0, 10);
    expect(atPi).toBeCloseTo(0, 10);
    expect(atHalfPi).toBeCloseTo(DEFAULT_GAIT.hipBobHeight, 10);
  });

  it('feet lift only in the forward swing phase (foot Y >= 0)', () => {
    for (let i = 0; i < 24; i++) {
      const phase = (i / 24) * TWO_PI;
      const pose = evaluateLocomotion({ phase }, DEFAULT_GAIT);
      expect(pose.leftFootOffset.y).toBeGreaterThanOrEqual(0);
      expect(pose.rightFootOffset.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('left and right feet are π out of phase (x-components sum to 0)', () => {
    for (let i = 0; i < 12; i++) {
      const phase = (i / 12) * TWO_PI;
      const pose = evaluateLocomotion({ phase }, DEFAULT_GAIT);
      // cos(φ) + cos(φ+π) = 0 → the two feet's X offsets are opposites.
      expect(pose.leftFootOffset.x + pose.rightFootOffset.x).toBeCloseTo(0, 10);
    }
  });

  it('at phase 0 left foot is forward (+stride) and right foot is back (-stride)', () => {
    const pose = evaluateLocomotion({ phase: 0 }, DEFAULT_GAIT);
    expect(pose.leftFootOffset.x).toBeCloseTo(DEFAULT_GAIT.strideLength, 10);
    expect(pose.rightFootOffset.x).toBeCloseTo(-DEFAULT_GAIT.strideLength, 10);
    expect(pose.leftFootOffset.y).toBeCloseTo(0, 10);
    expect(pose.rightFootOffset.y).toBeCloseTo(0, 10);
  });

  it('does not mutate the input state', () => {
    const state: LocomotionState = { phase: 1.5 };
    const snap = { ...state };
    evaluateLocomotion(state, DEFAULT_GAIT);
    expect(state).toEqual(snap);
  });
});

describe('scaledGait', () => {
  it('scales every amplitude field by the factor', () => {
    const scaled = scaledGait(DEFAULT_GAIT, 0.2);
    expect(scaled.strideLength).toBeCloseTo(DEFAULT_GAIT.strideLength * 0.2, 10);
    expect(scaled.strideHeight).toBeCloseTo(DEFAULT_GAIT.strideHeight * 0.2, 10);
    expect(scaled.hipBobHeight).toBeCloseTo(DEFAULT_GAIT.hipBobHeight * 0.2, 10);
    expect(scaled.hipSwayWidth).toBeCloseTo(DEFAULT_GAIT.hipSwayWidth * 0.2, 10);
  });

  it('leaves baseFrequency unchanged (only amplitudes scale)', () => {
    const scaled = scaledGait(DEFAULT_GAIT, 0.2);
    expect(scaled.baseFrequency).toBe(DEFAULT_GAIT.baseFrequency);
  });

  it('does not mutate the input config', () => {
    const snap = { ...DEFAULT_GAIT };
    scaledGait(DEFAULT_GAIT, 0.2);
    expect(DEFAULT_GAIT).toEqual(snap);
  });

  it('returns a new object', () => {
    expect(scaledGait(DEFAULT_GAIT, 1)).not.toBe(DEFAULT_GAIT);
  });
});

describe('determinism', () => {
  it('advanceLocomotion contains no Math.random / Date.now (pure)', () => {
    const a = advanceLocomotion({ phase: 0.7 }, 2, 1, DEFAULT_GAIT);
    const b = advanceLocomotion({ phase: 0.7 }, 2, 1, DEFAULT_GAIT);
    expect(a).toEqual(b);
  });
});
