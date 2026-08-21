import { describe, it, expect } from 'vitest';
import {
  createHitStop,
  triggerHitStop,
  stepHitStop,
  isHitStopActive,
  DEFAULT_HIT_STOP_DURATION,
} from '../primitives/hit-stop';
import type { HitStopState } from '../primitives/hit-stop';

describe('DEFAULT_HIT_STOP_DURATION', () => {
  it('is exported as the canonical light-hit freeze (6 ticks ≈ 100ms at 60fps)', () => {
    expect(DEFAULT_HIT_STOP_DURATION).toBe(6);
  });
});

describe('createHitStop', () => {
  it('returns an inactive state with remaining 0', () => {
    expect(createHitStop()).toEqual({ remaining: 0 });
  });

  it('returns a fresh object each call (no shared reference)', () => {
    const a = createHitStop();
    const b = createHitStop();
    expect(a).not.toBe(b);
  });
});

describe('isHitStopActive', () => {
  it('returns false when remaining is 0', () => {
    expect(isHitStopActive({ remaining: 0 })).toBe(false);
  });

  it('returns true when remaining is greater than 0', () => {
    expect(isHitStopActive({ remaining: 1 })).toBe(true);
    expect(isHitStopActive({ remaining: 6 })).toBe(true);
  });
});

describe('triggerHitStop', () => {
  it('applies the default duration from an inactive state', () => {
    expect(triggerHitStop(createHitStop())).toEqual({ remaining: DEFAULT_HIT_STOP_DURATION });
    expect(triggerHitStop(createHitStop()).remaining).toBe(6);
  });

  it('applies a custom duration', () => {
    expect(triggerHitStop(createHitStop(), 12)).toEqual({ remaining: 12 });
  });

  it('is a no-op (remaining 0) when duration is 0', () => {
    expect(triggerHitStop(createHitStop(), 0)).toEqual({ remaining: 0 });
  });

  it('takes the max when the new duration exceeds the current remaining', () => {
    const active: HitStopState = { remaining: 3 };
    expect(triggerHitStop(active, 6)).toEqual({ remaining: 6 });
  });

  it('keeps the longer current remaining when the new duration is shorter', () => {
    const active: HitStopState = { remaining: 10 };
    expect(triggerHitStop(active, 6)).toEqual({ remaining: 10 });
  });

  it('keeps the current remaining when the new duration equals it', () => {
    const active: HitStopState = { remaining: 6 };
    expect(triggerHitStop(active, 6)).toEqual({ remaining: 6 });
  });

  it('returns a new object, not the input reference', () => {
    const state: HitStopState = { remaining: 0 };
    expect(triggerHitStop(state, 6)).not.toBe(state);
  });
});

describe('stepHitStop', () => {
  it('decrements remaining by dt=1', () => {
    expect(stepHitStop({ remaining: 6 }, 1)).toEqual({ remaining: 5 });
  });

  it('ends the freeze when the last tick elapses', () => {
    expect(stepHitStop({ remaining: 1 }, 1)).toEqual({ remaining: 0 });
  });

  it('stays inactive when already at 0', () => {
    expect(stepHitStop({ remaining: 0 }, 1)).toEqual({ remaining: 0 });
  });

  it('decrements by a multi-tick dt', () => {
    expect(stepHitStop({ remaining: 6 }, 3)).toEqual({ remaining: 3 });
  });

  it('clamps to 0 and never goes negative when dt exceeds remaining', () => {
    expect(stepHitStop({ remaining: 2 }, 5)).toEqual({ remaining: 0 });
  });

  it('clamps to 0 on a large dt from a long freeze', () => {
    expect(stepHitStop({ remaining: 10 }, 100)).toEqual({ remaining: 0 });
  });

  it('handles dt=0 as an identity step', () => {
    expect(stepHitStop({ remaining: 4 }, 0)).toEqual({ remaining: 4 });
  });

  it('returns a new object, not the input reference', () => {
    const state: HitStopState = { remaining: 6 };
    expect(stepHitStop(state, 1)).not.toBe(state);
  });
});

describe('units guard (durations are whole ticks)', () => {
  it('throws on a fractional positive duration — the seconds/ticks mixup', () => {
    expect(() => triggerHitStop(createHitStop(), 0.1)).toThrow(/TICKS, not seconds/);
    expect(() => triggerHitStop(createHitStop(), 6.5)).toThrow(/whole number of ticks/);
  });

  it('the message names the correct ~100 ms value for 60 Hz', () => {
    try {
      triggerHitStop(createHitStop(), 0.1);
      expect.unreachable('must throw');
    } catch (error) {
      expect(String(error)).toContain('pass 6');
    }
  });

  it('whole ticks, zero, and negatives do not throw', () => {
    expect(() => triggerHitStop(createHitStop(), 6)).not.toThrow();
    expect(() => triggerHitStop(createHitStop(), 0)).not.toThrow();
    expect(() => triggerHitStop(createHitStop(), -3)).not.toThrow();
  });
});

describe('purity (inputs never mutated)', () => {
  it('triggerHitStop does not mutate its input', () => {
    const state: HitStopState = { remaining: 3 };
    const snapshot = { ...state };
    triggerHitStop(state, 6);
    expect(state).toEqual(snapshot);
  });

  it('stepHitStop does not mutate its input', () => {
    const state: HitStopState = { remaining: 6 };
    const snapshot = { ...state };
    stepHitStop(state, 2);
    expect(state).toEqual(snapshot);
  });
});

describe('determinism (same inputs → same outputs)', () => {
  it('triggerHitStop is deterministic', () => {
    const state: HitStopState = { remaining: 3 };
    expect(triggerHitStop(state, 6)).toEqual(triggerHitStop(state, 6));
  });

  it('stepHitStop is deterministic', () => {
    const state: HitStopState = { remaining: 6 };
    expect(stepHitStop(state, 2)).toEqual(stepHitStop(state, 2));
  });
});

describe('documented usage pattern (end-to-end)', () => {
  it('freezes the sim for the configured duration then releases', () => {
    let hitStop = createHitStop();
    hitStop = triggerHitStop(hitStop, 6);

    let frozenTicks = 0;
    for (let tick = 0; tick < 10; tick++) {
      if (isHitStopActive(hitStop)) {
        frozenTicks++;
      }
      hitStop = stepHitStop(hitStop, 1);
    }

    expect(frozenTicks).toBe(6);
    expect(hitStop).toEqual({ remaining: 0 });
    expect(isHitStopActive(hitStop)).toBe(false);
  });
});
