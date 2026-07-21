import { describe, it, expect } from 'vitest';
import * as aicraft from '../index';
import {
  advanceLocomotion,
  advanceLocomotionByDisplacement,
  evaluateLocomotion,
  blendAirborneTuck,
  blendLocomotionToStance,
  scaledGait,
  DEFAULT_GAIT,
  DEFAULT_TUCK,
  type LocomotionState,
  type LocomotionPose,
  type GaitConfig,
  type TuckConfig,
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

  it('left foot is grounded during stance phase [0, π] (cos falling = front→back)', () => {
    // The stance phase: foot is planted while cos(phase) goes from +stride (front)
    // to -stride (back). Y lift must be 0 throughout this half.
    for (let i = 0; i <= 12; i++) {
      const phase = (i / 12) * Math.PI; // [0, π]
      const pose = evaluateLocomotion({ phase }, DEFAULT_GAIT);
      expect(pose.leftFootOffset.y).toBeCloseTo(0, 10);
    }
  });

  it('left foot lifts during swing phase (π, 2π) (cos rising = back→front)', () => {
    // The swing phase: foot is airborne while cos(phase) goes from -stride (back)
    // to +stride (front). Y lift must be > 0 for interior points.
    for (let i = 1; i < 12; i++) {
      const phase = Math.PI + (i / 12) * Math.PI; // (π, 2π)
      const pose = evaluateLocomotion({ phase }, DEFAULT_GAIT);
      expect(pose.leftFootOffset.y).toBeGreaterThan(0);
    }
  });

  it('right foot complements left: lifts during (0, π), grounded during (π, 2π)', () => {
    // Right foot is π out of phase — when left is in stance, right is in swing.
    for (let i = 1; i < 12; i++) {
      const phase = (i / 12) * Math.PI; // (0, π) — right should be lifted
      const pose = evaluateLocomotion({ phase }, DEFAULT_GAIT);
      expect(pose.rightFootOffset.y).toBeGreaterThan(0);
    }
    for (let i = 1; i < 12; i++) {
      const phase = Math.PI + (i / 12) * Math.PI; // (π, 2π) — right should be grounded
      const pose = evaluateLocomotion({ phase }, DEFAULT_GAIT);
      expect(pose.rightFootOffset.y).toBeCloseTo(0, 10);
    }
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

describe('advanceLocomotionByDisplacement', () => {
  it('dx = 0 → phase unchanged (feet planted)', () => {
    const state: LocomotionState = { phase: 1.5 };
    const next = advanceLocomotionByDisplacement(state, 0, DEFAULT_GAIT);
    expect(next.phase).toBeCloseTo(1.5, 10);
  });

  it('dx = strideLength · π → phase advances by exactly 1.0 radian', () => {
    // dPhase = dx / (strideLength · π). At dx = strideLength·π → dPhase = 1.
    // (Per the approved proposal formula and its test plan line 783.)
    const state: LocomotionState = { phase: 0.2 };
    const dx = DEFAULT_GAIT.strideLength * Math.PI;
    const next = advanceLocomotionByDisplacement(state, dx, DEFAULT_GAIT);
    expect(next.phase).toBeCloseTo(0.2 + 1.0, 10);
  });

  it('negative dx walks backward (phase decreases, wraps into [0, 2π))', () => {
    const state: LocomotionState = { phase: 0.5 };
    const dx = -DEFAULT_GAIT.strideLength * Math.PI;
    const next = advanceLocomotionByDisplacement(state, dx, DEFAULT_GAIT);
    // 0.5 - 1.0 = -0.5 → wrapped into [0, 2π) → 2π - 0.5.
    expect(next.phase).toBeCloseTo(Math.PI * 2 - 0.5, 10);
    expect(next.phase).toBeGreaterThanOrEqual(0);
    expect(next.phase).toBeLessThan(Math.PI * 2);
  });

  it('accumulated single-tick calls equal one batched call', () => {
    const dx = DEFAULT_GAIT.strideLength * 0.3;
    let batched = advanceLocomotionByDisplacement({ phase: 0 }, dx * 4, DEFAULT_GAIT);
    let stepwise: LocomotionState = { phase: 0 };
    for (let i = 0; i < 4; i++) {
      stepwise = advanceLocomotionByDisplacement(stepwise, dx, DEFAULT_GAIT);
    }
    expect(stepwise.phase).toBeCloseTo(batched.phase, 10);
    // sanity: both moved at all
    expect(batched.phase).not.toBeCloseTo(0, 6);
    void batched;
  });

  it('returns a new object (input never mutated)', () => {
    const state: LocomotionState = { phase: 2.0 };
    const snap = { ...state };
    const next = advanceLocomotionByDisplacement(state, 3, DEFAULT_GAIT);
    expect(state).toEqual(snap);
    expect(next).not.toBe(state);
  });

  it('stays bounded over many advances (no float drift)', () => {
    let state: LocomotionState = { phase: 0 };
    for (let i = 0; i < 10000; i++) {
      state = advanceLocomotionByDisplacement(state, 5, DEFAULT_GAIT);
    }
    expect(state.phase).toBeGreaterThanOrEqual(0);
    expect(state.phase).toBeLessThan(Math.PI * 2);
    expect(Number.isFinite(state.phase)).toBe(true);
  });
});

describe('blendAirborneTuck', () => {
  it('airborneBlend = 0 → returns the walk-cycle foot offset unchanged', () => {
    const foot = { x: 3, y: 1 };
    const out = blendAirborneTuck(foot, 0, DEFAULT_TUCK);
    expect(out.x).toBeCloseTo(3, 10);
    expect(out.y).toBeCloseTo(1, 10);
  });

  it('airborneBlend = 1 → returns the tuck offset', () => {
    const foot = { x: 3, y: 1 };
    const out = blendAirborneTuck(foot, 1, DEFAULT_TUCK);
    expect(out.x).toBeCloseTo(DEFAULT_TUCK.tuckOffset.x, 10);
    expect(out.y).toBeCloseTo(DEFAULT_TUCK.tuckOffset.y, 10);
  });

  it('airborneBlend = 0.5 → returns the midpoint', () => {
    const foot = { x: 4, y: 0 };
    const out = blendAirborneTuck(foot, 0.5, DEFAULT_TUCK);
    expect(out.x).toBeCloseTo((4 + DEFAULT_TUCK.tuckOffset.x) / 2, 10);
    expect(out.y).toBeCloseTo((0 + DEFAULT_TUCK.tuckOffset.y) / 2, 10);
  });

  it('is pure (same inputs → same output, fresh object)', () => {
    const foot = { x: 1, y: 2 };
    const a = blendAirborneTuck(foot, 0.3, DEFAULT_TUCK);
    const b = blendAirborneTuck(foot, 0.3, DEFAULT_TUCK);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('does not mutate the input foot offset', () => {
    const foot = { x: 5, y: 7 };
    const snap = { ...foot };
    blendAirborneTuck(foot, 0.8, DEFAULT_TUCK);
    expect(foot).toEqual(snap);
  });

  it('respects a custom TuckConfig', () => {
    const cfg: TuckConfig = { tuckOffset: { x: -1, y: -4 }, hipRaise: -2 };
    const out = blendAirborneTuck({ x: 0, y: 0 }, 1, cfg);
    expect(out.x).toBeCloseTo(-1, 10);
    expect(out.y).toBeCloseTo(-4, 10);
  });
});

describe('blendLocomotionToStance', () => {
  /** Canonical hand-built pose with distinct non-zero values on every field. */
  const POSE: LocomotionPose = {
    hipOffset: { x: 1.5, y: -0.5 },
    leftFootOffset: { x: 4, y: 3 },
    rightFootOffset: { x: -4, y: 0 },
  };

  /** Hero-scale total center-to-center foot distance (footW 28 + gap 2). */
  const HERO_SPREAD = 30;
  /** Playground-scale total center-to-center foot distance (footW 7 + gap 1). */
  const PLAYGROUND_SPREAD = 8;

  it('is exported from the top-level public surface', () => {
    expect(typeof aicraft.blendLocomotionToStance).toBe('function');
    expect(typeof blendLocomotionToStance).toBe('function');
  });

  it('stanceBlend = 0 → returns every input pose field unchanged (identity at zero)', () => {
    const out = blendLocomotionToStance(POSE, 0, HERO_SPREAD);
    expect(out.hipOffset.x).toBeCloseTo(POSE.hipOffset.x, 10);
    expect(out.hipOffset.y).toBeCloseTo(POSE.hipOffset.y, 10);
    expect(out.leftFootOffset.x).toBeCloseTo(POSE.leftFootOffset.x, 10);
    expect(out.leftFootOffset.y).toBeCloseTo(POSE.leftFootOffset.y, 10);
    expect(out.rightFootOffset.x).toBeCloseTo(POSE.rightFootOffset.x, 10);
    expect(out.rightFootOffset.y).toBeCloseTo(POSE.rightFootOffset.y, 10);
  });

  it('stanceBlend = 1 → feet at ±spread/2, foot Y = 0, hip = (0, 0) (full stance target)', () => {
    const out = blendLocomotionToStance(POSE, 1, HERO_SPREAD);
    expect(out.hipOffset.x).toBeCloseTo(0, 10);
    expect(out.hipOffset.y).toBeCloseTo(0, 10);
    expect(out.leftFootOffset.x).toBeCloseTo(-HERO_SPREAD / 2, 10);
    expect(out.leftFootOffset.y).toBeCloseTo(0, 10);
    expect(out.rightFootOffset.x).toBeCloseTo(HERO_SPREAD / 2, 10);
    expect(out.rightFootOffset.y).toBeCloseTo(0, 10);
  });

  it('full stance at playground scale → feet at ±4 (spread 8 / 2)', () => {
    const out = blendLocomotionToStance(POSE, 1, PLAYGROUND_SPREAD);
    expect(out.leftFootOffset.x).toBeCloseTo(-4, 10);
    expect(out.rightFootOffset.x).toBeCloseTo(4, 10);
  });

  it('stanceBlend = 0.5 → lerp midpoint between walk pose and stance target', () => {
    const halfSpread = HERO_SPREAD / 2;
    const t = 0.5;
    const out = blendLocomotionToStance(POSE, t, HERO_SPREAD);
    expect(out.hipOffset.x).toBeCloseTo(POSE.hipOffset.x * (1 - t), 10);
    expect(out.hipOffset.y).toBeCloseTo(POSE.hipOffset.y * (1 - t), 10);
    expect(out.leftFootOffset.x).toBeCloseTo(
      POSE.leftFootOffset.x + (-halfSpread - POSE.leftFootOffset.x) * t,
      10,
    );
    expect(out.leftFootOffset.y).toBeCloseTo(POSE.leftFootOffset.y * (1 - t), 10);
    expect(out.rightFootOffset.x).toBeCloseTo(
      POSE.rightFootOffset.x + (halfSpread - POSE.rightFootOffset.x) * t,
      10,
    );
    expect(out.rightFootOffset.y).toBeCloseTo(POSE.rightFootOffset.y * (1 - t), 10);
  });

  it('full stance is symmetric: leftFoot.x + rightFoot.x = 0 (midline symmetry)', () => {
    const out = blendLocomotionToStance(POSE, 1, HERO_SPREAD);
    expect(out.leftFootOffset.x + out.rightFootOffset.x).toBeCloseTo(0, 10);
  });

  it('midpoint is symmetric: leftFoot.x + rightFoot.x = 0 when the input is symmetric', () => {
    const symmetric: LocomotionPose = {
      hipOffset: { x: 0, y: -1 },
      leftFootOffset: { x: 5, y: 2 },
      rightFootOffset: { x: -5, y: 3 },
    };
    const out = blendLocomotionToStance(symmetric, 0.5, HERO_SPREAD);
    expect(out.leftFootOffset.x + out.rightFootOffset.x).toBeCloseTo(0, 10);
  });

  it('at blend 0 the walk-cycle endpoint is unchanged (IK parity preserved)', () => {
    // A phase-0 pose from evaluateLocomotion: feet at ±strideLength (IK parity).
    const walkPose = evaluateLocomotion({ phase: 0 }, DEFAULT_GAIT);
    const out = blendLocomotionToStance(walkPose, 0, HERO_SPREAD);
    expect(out.leftFootOffset.x).toBeCloseTo(walkPose.leftFootOffset.x, 10);
    expect(out.rightFootOffset.x).toBeCloseTo(walkPose.rightFootOffset.x, 10);
    expect(out.leftFootOffset.y).toBeCloseTo(walkPose.leftFootOffset.y, 10);
    expect(out.rightFootOffset.y).toBeCloseTo(walkPose.rightFootOffset.y, 10);
    expect(out.hipOffset.x).toBeCloseTo(walkPose.hipOffset.x, 10);
    expect(out.hipOffset.y).toBeCloseTo(walkPose.hipOffset.y, 10);
  });

  it('does not mutate the input pose (pure progression op)', () => {
    const pose: LocomotionPose = {
      hipOffset: { x: 1, y: 2 },
      leftFootOffset: { x: 3, y: 4 },
      rightFootOffset: { x: 5, y: 6 },
    };
    const snap = JSON.parse(JSON.stringify(pose));
    blendLocomotionToStance(pose, 0.7, HERO_SPREAD);
    expect(pose).toEqual(snap);
  });

  it('is pure: same inputs → equal but independent output objects (fresh each call)', () => {
    const a = blendLocomotionToStance(POSE, 0.3, HERO_SPREAD);
    const b = blendLocomotionToStance(POSE, 0.3, HERO_SPREAD);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.hipOffset).not.toBe(b.hipOffset);
    expect(a.leftFootOffset).not.toBe(b.leftFootOffset);
    expect(a.rightFootOffset).not.toBe(b.rightFootOffset);
    // Output sub-objects are NOT aliases of the input sub-objects (deep copy).
    expect(a.hipOffset).not.toBe(POSE.hipOffset);
    expect(a.leftFootOffset).not.toBe(POSE.leftFootOffset);
    expect(a.rightFootOffset).not.toBe(POSE.rightFootOffset);
  });

  // -----------------------------------------------------------------------
  // Defensive handling (locked semantics §8 of the decision)
  // -----------------------------------------------------------------------

  it('treats NaN stanceBlend as 0 (pure walk pose)', () => {
    const out = blendLocomotionToStance(POSE, NaN, HERO_SPREAD);
    expect(out.hipOffset.x).toBeCloseTo(POSE.hipOffset.x, 10);
    expect(out.hipOffset.y).toBeCloseTo(POSE.hipOffset.y, 10);
    expect(out.leftFootOffset.x).toBeCloseTo(POSE.leftFootOffset.x, 10);
    expect(out.rightFootOffset.x).toBeCloseTo(POSE.rightFootOffset.x, 10);
  });

  it('treats +Infinity stanceBlend as 0 (defensive, never throws)', () => {
    const out = blendLocomotionToStance(POSE, Infinity, HERO_SPREAD);
    expect(out.leftFootOffset.x).toBeCloseTo(POSE.leftFootOffset.x, 10);
    expect(out.rightFootOffset.x).toBeCloseTo(POSE.rightFootOffset.x, 10);
  });

  it('treats -Infinity stanceBlend as 0 (defensive, never throws)', () => {
    const out = blendLocomotionToStance(POSE, -Infinity, HERO_SPREAD);
    expect(out.leftFootOffset.x).toBeCloseTo(POSE.leftFootOffset.x, 10);
    expect(out.rightFootOffset.x).toBeCloseTo(POSE.rightFootOffset.x, 10);
  });

  it('clamps stanceBlend > 1 to 1 (full stance)', () => {
    const out = blendLocomotionToStance(POSE, 1.5, HERO_SPREAD);
    expect(out.leftFootOffset.x).toBeCloseTo(-HERO_SPREAD / 2, 10);
    expect(out.rightFootOffset.x).toBeCloseTo(HERO_SPREAD / 2, 10);
    expect(out.leftFootOffset.y).toBeCloseTo(0, 10);
    expect(out.hipOffset.x).toBeCloseTo(0, 10);
  });

  it('clamps stanceBlend < 0 to 0 (pure walk pose)', () => {
    const out = blendLocomotionToStance(POSE, -0.5, HERO_SPREAD);
    expect(out.leftFootOffset.x).toBeCloseTo(POSE.leftFootOffset.x, 10);
    expect(out.rightFootOffset.x).toBeCloseTo(POSE.rightFootOffset.x, 10);
  });

  it('treats NaN idleFootSpread as 0 (feet converge at the midline at full blend)', () => {
    const out = blendLocomotionToStance(POSE, 1, NaN);
    expect(out.leftFootOffset.x).toBeCloseTo(0, 10);
    expect(out.rightFootOffset.x).toBeCloseTo(0, 10);
  });

  it('treats +Infinity idleFootSpread as 0 (defensive, never throws)', () => {
    const out = blendLocomotionToStance(POSE, 1, Infinity);
    expect(out.leftFootOffset.x).toBeCloseTo(0, 10);
    expect(out.rightFootOffset.x).toBeCloseTo(0, 10);
  });

  it('treats -Infinity idleFootSpread as 0 (defensive, never throws)', () => {
    const out = blendLocomotionToStance(POSE, 1, -Infinity);
    expect(out.leftFootOffset.x).toBeCloseTo(0, 10);
    expect(out.rightFootOffset.x).toBeCloseTo(0, 10);
  });

  it('clamps negative idleFootSpread to 0 (defensive)', () => {
    const out = blendLocomotionToStance(POSE, 1, -10);
    expect(out.leftFootOffset.x).toBeCloseTo(0, 10);
    expect(out.rightFootOffset.x).toBeCloseTo(0, 10);
  });

  it('zero idleFootSpread at full blend → both feet at the midline (Y = 0)', () => {
    const out = blendLocomotionToStance(POSE, 1, 0);
    expect(out.leftFootOffset.x).toBeCloseTo(0, 10);
    expect(out.rightFootOffset.x).toBeCloseTo(0, 10);
    expect(out.leftFootOffset.y).toBeCloseTo(0, 10);
    expect(out.rightFootOffset.y).toBeCloseTo(0, 10);
  });

  it('never throws on any numeric input (defensive contract)', () => {
    expect(() => blendLocomotionToStance(POSE, NaN, NaN)).not.toThrow();
    expect(() => blendLocomotionToStance(POSE, Infinity, -Infinity)).not.toThrow();
    expect(() => blendLocomotionToStance(POSE, -Infinity, Infinity)).not.toThrow();
    expect(() => blendLocomotionToStance(POSE, 1e308, 1e308)).not.toThrow();
    expect(() => blendLocomotionToStance(POSE, -1e308, -1e308)).not.toThrow();
  });

  it('composition: stance blend FIRST then airborne tuck → idle+grounded then jump works', () => {
    // The documented composition: blendLocomotionToStance FIRST, then
    // blendAirborneTuck on each foot from the stance-blended pose. At
    // idle+grounded (stanceBlend=1, airborneBlend=0) the feet are at
    // ±spread/2; at walking+airborne (stanceBlend=0, airborneBlend=1) the
    // feet are at the tuck offset.
    const stancePose = blendLocomotionToStance(POSE, 1, HERO_SPREAD);
    const idleGroundedLeft = blendAirborneTuck(
      stancePose.leftFootOffset,
      0,
      DEFAULT_TUCK,
    );
    expect(idleGroundedLeft.x).toBeCloseTo(-HERO_SPREAD / 2, 10);

    const walkingAirbornePose = blendLocomotionToStance(POSE, 0, HERO_SPREAD);
    const walkingAirborneLeft = blendAirborneTuck(
      walkingAirbornePose.leftFootOffset,
      1,
      DEFAULT_TUCK,
    );
    expect(walkingAirborneLeft.x).toBeCloseTo(DEFAULT_TUCK.tuckOffset.x, 10);
    expect(walkingAirborneLeft.y).toBeCloseTo(DEFAULT_TUCK.tuckOffset.y, 10);
  });
});
