import { describe, it, expect } from 'vitest';
import { createPlatformerState, stepPlatformer } from '../platformer/kernel';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import { DT, idleInput, makeInput } from './platformer-trace-harness';
import type { PlatformerConfig } from '../platformer/types';

/**
 * Phase 4 — fast-fall (mutable max-fall easing), Celeste `Player.cs:2910-2924`.
 *
 * The terminal-fall cap is no longer the static `config.maxFallSpeed`. It is
 * mutable state on `LocomotionState.maxFallCurrent` that EASES between
 * `maxFallSpeed` and `fastMaxFallSpeed` at `fastMaxAccel`/sec in BOTH
 * directions: while `moveY === 1` (down held) it eases UP toward
 * `fastMaxFallSpeed`; otherwise it eases DOWN toward `maxFallSpeed`. The gravity
 * step clamps `vy` to this dynamic cap, so holding down lets terminal vy exceed
 * `maxFallSpeed` (fast-fall) without ever exceeding `fastMaxFallSpeed`.
 *
 * These tests drive the full kernel (`stepPlatformer`) with the actor falling
 * in open space (no solids) so the cap is exercised every tick, and inspect
 * both `core.vy` and `locomotion.maxFallCurrent`.
 */

describe('platformer fast-fall (mutable max-fall easing)', () => {
  const config: PlatformerConfig = DEFAULT_PLATFORMER_CONFIG;

  it('holding moveY=1 eases the cap UP toward fastMaxFallSpeed at fastMaxAccel/sec', () => {
    // One tick: the cap starts at maxFallSpeed (600) and eases up by
    // fastMaxAccel * dt = 327 * (1/60) ≈ 5.45 toward fastMaxFallSpeed (900).
    const initial = createPlatformerState(0, 0, config);
    const next = stepPlatformer(initial, makeInput({ moveY: 1 }), [], DT, config).state;
    const expectedCap = config.maxFallSpeed + config.fastMaxAccel * DT;
    expect(next.locomotion.maxFallCurrent).toBeCloseTo(expectedCap, 6);
  });

  it('fast-fall: terminal vy can exceed maxFallSpeed but never fastMaxFallSpeed', () => {
    // Hold down (moveY=1) for 70 ticks of free fall. The cap eases from 600 up
    // toward 900 (reaching it after ~55 ticks since (900-600)/(327/60) ≈ 55),
    // and vy accelerates to track the rising cap. After 70 ticks vy exceeds the
    // normal maxFallSpeed (600) but is clamped at the eased cap ≤ fastMaxFallSpeed.
    let state = createPlatformerState(0, 0, config);
    let maxVy = 0;
    for (let i = 0; i < 70; i++) {
      state = stepPlatformer(state, makeInput({ moveY: 1 }), [], DT, config).state;
      if (state.core.vy > maxVy) maxVy = state.core.vy;
      // Invariant: vy never exceeds the current cap (which itself ≤ fastMaxFallSpeed).
      expect(state.core.vy).toBeLessThanOrEqual(config.fastMaxFallSpeed + 1e-6);
    }
    // The cap has reached fastMaxFallSpeed (eased all the way up).
    expect(state.locomotion.maxFallCurrent).toBe(config.fastMaxFallSpeed);
    // vy exceeded the normal terminal (fast-fall is active) ...
    expect(maxVy).toBeGreaterThan(config.maxFallSpeed);
    // ... but never exceeded the fast-fall cap.
    expect(maxVy).toBeLessThanOrEqual(config.fastMaxFallSpeed);
  });

  it('releasing moveY eases the cap BACK DOWN toward maxFallSpeed at the same rate', () => {
    // Fast-fall to pump the cap up to 900, then release (moveY absent → 0) and
    // confirm the cap eases back down to 600 at the same fastMaxAccel/sec rate.
    let state = createPlatformerState(0, 0, config);
    for (let i = 0; i < 70; i++) {
      state = stepPlatformer(state, makeInput({ moveY: 1 }), [], DT, config).state;
    }
    expect(state.locomotion.maxFallCurrent).toBe(config.fastMaxFallSpeed); // pumped to 900

    // One release tick: cap eases down by fastMaxAccel * dt.
    const eased = stepPlatformer(state, idleInput(), [], DT, config).state;
    expect(eased.locomotion.maxFallCurrent).toBeCloseTo(
      config.fastMaxFallSpeed - config.fastMaxAccel * DT,
      6,
    );

    // Hold release long enough and the cap returns to maxFallSpeed.
    for (let i = 0; i < 70; i++) {
      state = stepPlatformer(state, idleInput(), [], DT, config).state;
    }
    expect(state.locomotion.maxFallCurrent).toBe(config.maxFallSpeed); // back to 600
  });

  it('without moveY=1 the cap stays at maxFallSpeed (no spurious fast-fall)', () => {
    // Holding no down key: target is always maxFallSpeed, so the cap never
    // rises above its starting value even after a long fall.
    let state = createPlatformerState(0, 0, config);
    for (let i = 0; i < 40; i++) {
      state = stepPlatformer(state, idleInput(), [], DT, config).state;
    }
    expect(state.locomotion.maxFallCurrent).toBe(config.maxFallSpeed);
    // And vy is clamped at maxFallSpeed (normal terminal velocity).
    expect(state.core.vy).toBeLessThanOrEqual(config.maxFallSpeed);
  });
});
