import { describe, it, expect } from 'vitest';
import { advanceEmission, type EmissionState, type EmissionRateConfig } from '../particles';

describe('advanceEmission — return shape', () => {
  it('returns { next, spawnCount }', () => {
    const state: EmissionState = { accumulator: 0 };
    const config: EmissionRateConfig = { rate: 1 };
    const out = advanceEmission(state, 1, config);
    expect(out).toHaveProperty('next');
    expect(out).toHaveProperty('spawnCount');
    expect(typeof out.spawnCount).toBe('number');
    expect(Number.isInteger(out.spawnCount)).toBe(true);
    expect(out.next).toHaveProperty('accumulator');
  });
});

describe('advanceEmission — accumulator math', () => {
  it('rate=1, dt=1 spawns exactly 1 and zeroes the accumulator', () => {
    const out = advanceEmission({ accumulator: 0 }, 1, { rate: 1 });
    expect(out.spawnCount).toBe(1);
    expect(out.next.accumulator).toBe(0);
  });

  it('dt multiplies the rate (rate=1, dt=2 → 2 spawns)', () => {
    const out = advanceEmission({ accumulator: 0 }, 2, { rate: 1 });
    expect(out.spawnCount).toBe(2);
    expect(out.next.accumulator).toBe(0);
  });

  it('rate multiplies dt (rate=3, dt=2 → 6 spawns)', () => {
    const out = advanceEmission({ accumulator: 0 }, 2, { rate: 3 });
    expect(out.spawnCount).toBe(6);
    expect(out.next.accumulator).toBe(0);
  });
});

describe('advanceEmission — fractional carryover', () => {
  it('rate=0.5, dt=1 carries 0.5 and spawns 0', () => {
    const out = advanceEmission({ accumulator: 0 }, 1, { rate: 0.5 });
    expect(out.spawnCount).toBe(0);
    expect(out.next.accumulator).toBeCloseTo(0.5, 10);
  });

  it('two ticks at rate=0.5 spawn 1 on the second tick (carryover works)', () => {
    let state: EmissionState = { accumulator: 0 };
    const a = advanceEmission(state, 1, { rate: 0.5 });
    state = a.next;
    expect(a.spawnCount).toBe(0);
    const b = advanceEmission(state, 1, { rate: 0.5 });
    expect(b.spawnCount).toBe(1);
    expect(b.next.accumulator).toBe(0);
  });

  it('long-run average rate matches rate * dt within float drift (no systematic loss)', () => {
    // The carryover accumulator prevents SYSTEMATIC loss: truncation without
    // carryover would yield ~0 spawns here (floor(0.3) = 0 every tick). With
    // carryover the count converges to rate·ticks = 300; floating-point drift
    // on the repeated `+ 0.3` means the realized count is within ~1 of 300.
    let state: EmissionState = { accumulator: 0 };
    let spawned = 0;
    const TICKS = 1000;
    for (let i = 0; i < TICKS; i++) {
      const out = advanceEmission(state, 1, { rate: 0.3 });
      spawned += out.spawnCount;
      state = out.next;
    }
    expect(spawned).toBeGreaterThanOrEqual(298);
    expect(spawned).toBeLessThanOrEqual(302);
  });
});

describe('advanceEmission — rateScale', () => {
  it('rateScale multiplies the effective rate', () => {
    const out = advanceEmission({ accumulator: 0 }, 1, {
      rate: 1,
      rateScale: 0.5,
    });
    expect(out.spawnCount).toBe(0);
    expect(out.next.accumulator).toBeCloseTo(0.5, 10);
  });

  it('rateScale defaults to 1.0 (full rate)', () => {
    const a = advanceEmission({ accumulator: 0 }, 1, { rate: 2 });
    const b = advanceEmission({ accumulator: 0 }, 1, { rate: 2, rateScale: 1 });
    expect(a).toEqual(b);
  });

  it('rateScale=0 halts emission but preserves accumulator state', () => {
    const out = advanceEmission({ accumulator: 0.4 }, 1, {
      rate: 5,
      rateScale: 0,
    });
    expect(out.spawnCount).toBe(0);
    expect(out.next.accumulator).toBeCloseTo(0.4, 10);
  });
});

describe('advanceEmission — purity & defensiveness', () => {
  it('does not mutate the input state', () => {
    const state: EmissionState = { accumulator: 0.7 };
    const snap = { ...state };
    advanceEmission(state, 1, { rate: 1 });
    expect(state).toEqual(snap);
  });

  it('returns a NEW state object (not the input reference)', () => {
    const state: EmissionState = { accumulator: 0 };
    const out = advanceEmission(state, 1, { rate: 1 });
    expect(out.next).not.toBe(state);
  });

  it('negative rate yields 0 spawns and clamps the accumulator to 0', () => {
    const out = advanceEmission({ accumulator: 0 }, 1, { rate: -2 });
    expect(out.spawnCount).toBe(0);
    expect(out.next.accumulator).toBe(0);
  });

  it('negative dt yields 0 spawns and clamps the accumulator to 0', () => {
    const out = advanceEmission({ accumulator: 0.3 }, -1, { rate: 1 });
    expect(out.spawnCount).toBe(0);
    expect(out.next.accumulator).toBe(0);
  });
});
