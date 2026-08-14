import { describe, it, expect } from 'vitest';
import { stepPlatformer } from '../platformer/kernel';
import { createPlatformerState } from '../platformer/kernel';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import { wallSlideAbility } from '../platformer/abilities/wall-slide-ability';
import { lerp } from '../primitives/pixel';
import { makeInput } from './platformer-trace-harness';
import type { Solid } from '../collision/types';
import type {
  ActorCore,
  AbilityContext,
  PlatformerConfig,
  PlatformerInput,
  PlatformerState,
  WallSlideAbilityState,
} from '../platformer/types';

/**
 * Phase 3 focused tests — rate-based run/air acceleration, overspeed bleed,
 * release decel, and the decaying wall-slide clamp.
 *
 * These exercise the PUBLIC kernel (`stepPlatformer`) for the horizontal
 * behaviors and the `wallSlideAbility` directly for the decaying clamp (so the
 * easing formula is asserted gravity-independently). All rates are pegged to
 * `DEFAULT_PLATFORMER_CONFIG`: runAccel 2220, overspeedReduce 890,
 * airAccelMultiplier 0.65, moveSpeed 200, wallSlideStartMax 75,
 * wallSlideTime 1.2, maxFallSpeed 600. dt = 1/60.
 */

const DT = 1 / 60;

/** A wide floor so ground tests never walk off the edge. */
const FLOOR: Solid = { id: 'floor', x: 0, y: 300, width: 4000, height: 16 };

/**
 * Step `state` through `n` ticks holding a fixed input, returning the per-tick
 * `vx` series. Used to assert rate-based accel/decel progressions.
 */
function vxSeries(
  state: PlatformerState,
  input: PlatformerInput,
  n: number,
  config: PlatformerConfig = DEFAULT_PLATFORMER_CONFIG,
  solids: readonly Solid[] = [FLOOR],
): number[] {
  let s = state;
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    s = stepPlatformer(s, input, solids, DT, config).state;
    out.push(s.core.vx);
  }
  return out;
}

describe('Phase 3 acceleration', () => {
  // =========================================================================
  // 1. Ground accel is rate-based (approach at runAccel), NOT an instant snap.
  // =========================================================================
  it('ground accel approaches moveSpeed at runAccel*dt per tick (not instant snap)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const initial = createPlatformerState(100, 276, config); // feet rest on FLOOR
    const vxs = vxSeries(initial, makeInput({ moveX: 1 }), 8, config);

    const perTick = config.runAccel * DT; // 2220 / 60 = 37
    // NOT an instant snap: after 1 tick vx is one rate-step, not moveSpeed.
    expect(vxs[0]).toBeCloseTo(perTick, 4);
    expect(vxs[0]).toBeLessThan(config.moveSpeed);
    // Follows approach: min(moveSpeed, runAccel * (k+1) * dt) until it saturates.
    for (let k = 0; k < 6; k += 1) {
      const expected = Math.min(config.moveSpeed, config.runAccel * (k + 1) * DT);
      expect(vxs[k]).toBeCloseTo(expected, 4);
    }
    // Saturates exactly at moveSpeed (approach returns target once within range).
    expect(vxs[5]).toBeCloseTo(config.moveSpeed, 4);
    expect(vxs[6]).toBeCloseTo(config.moveSpeed, 4);
  });

  // =========================================================================
  // 2. Overspeed bleed: vx above moveSpeed in the held direction decays toward
  //    moveSpeed at overspeedReduce*dt/tick — NOT instantly, NOT at runAccel.
  // =========================================================================
  it('overspeed vx bleeds toward moveSpeed at overspeedReduce (not instant, not runAccel)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const base = createPlatformerState(100, 276, config);
    // Construct a grounded state already moving faster than moveSpeed (e.g. the
    // frame a dash just ended). Facing matches the held direction.
    const overspeed: PlatformerState = {
      ...base,
      core: { ...base.core, vx: 500, facing: 1 },
    };
    const vxs = vxSeries(overspeed, makeInput({ moveX: 1 }), 5, config);

    const bleedPerTick = config.overspeedReduce * DT; // 890 / 60 ≈ 14.833
    const runAccelPerTick = config.runAccel * DT; // 37 — the WRONG rate it must not use
    // NOT instant: still above moveSpeed after one tick.
    expect(vxs[0]).toBeGreaterThan(config.moveSpeed);
    // Decays at overspeedReduce, NOT runAccel.
    expect(vxs[0]).toBeCloseTo(500 - bleedPerTick, 3);
    expect(500 - vxs[0]).toBeLessThan(runAccelPerTick);
    // Continues bleeding at the same per-tick rate while still overspeed.
    for (let k = 0; k < 5; k += 1) {
      expect(vxs[k]).toBeCloseTo(500 - bleedPerTick * (k + 1), 3);
      expect(vxs[k]).toBeGreaterThan(config.moveSpeed); // still bleeding, not yet at moveSpeed
    }
  });

  // =========================================================================
  // 3. Release decelerates at runAccel (no separate ground decel): from
  //    moveSpeed, releasing → vx approaches 0 at runAccel*dt/tick.
  // =========================================================================
  it('release decelerates toward 0 at runAccel (not a separate decel, not instant)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const base = createPlatformerState(100, 276, config);
    const atMoveSpeed: PlatformerState = {
      ...base,
      core: { ...base.core, vx: config.moveSpeed, facing: 1 },
    };
    const vxs = vxSeries(atMoveSpeed, makeInput({ moveX: 0 }), 8, config);

    const perTick = config.runAccel * DT; // 37 — release uses full runAccel (Celeste Player.cs:2891)
    for (let k = 0; k < 5; k += 1) {
      const expected = Math.max(0, config.moveSpeed - perTick * (k + 1));
      expect(vxs[k]).toBeCloseTo(expected, 4);
    }
    // NOT instant: still moving after one tick.
    expect(vxs[0]).toBeGreaterThan(0);
    // Reaches 0 after enough ticks (moveSpeed / perTick ≈ 5.4 → 0 by tick 6).
    expect(vxs[5]).toBeCloseTo(0, 4);
  });

  // =========================================================================
  // 4. Air accel uses airAccelMultiplier: from rest in air, vx approaches the
  //    target at runAccel*airAccelMultiplier*dt/tick (slower than ground).
  // =========================================================================
  it('air accel approaches target at runAccel*airAccelMultiplier (slower than ground)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const initial = createPlatformerState(100, 100, config); // airborne, no floor
    const vxs = vxSeries(initial, makeInput({ moveX: 1 }), 10, config, []);

    const airPerTick = config.runAccel * config.airAccelMultiplier * DT; // 2220*0.65/60 ≈ 24.05
    const groundPerTick = config.runAccel * DT; // 37
    expect(airPerTick).toBeLessThan(groundPerTick); // sanity: air is slower
    // Follows approach at the air rate.
    for (let k = 0; k < 8; k += 1) {
      const expected = Math.min(config.moveSpeed, airPerTick * (k + 1));
      expect(vxs[k]).toBeCloseTo(expected, 3);
    }
    // Slower than the ground rate would be (proves the multiplier applied).
    expect(vxs[0]).toBeLessThan(groundPerTick);
    expect(vxs[0]).toBeCloseTo(airPerTick, 3);
    // Eventually saturates at moveSpeed.
    expect(vxs[9]).toBeCloseTo(config.moveSpeed, 3);
  });

  // =========================================================================
  // 5. Wall-slide decay: the clamp eases from wallSlideStartMax toward
  //    maxFallSpeed over wallSlideTime; per-tick max INCREASES across the
  //    window. Releasing direction stops the slide (vy unconstrained).
  // =========================================================================
  describe('wall-slide decay', () => {
    const BODY_W = 16;
    const BODY_H = 24;
    /** Right wall flush against the body's right edge. */
    const WALL_RIGHT: Solid = { id: 'wall-r', x: BODY_W, y: 0, width: BODY_W, height: 200 };

    function makeCore(overrides: Partial<ActorCore> = {}): ActorCore {
      return {
        x: 0,
        y: 50,
        width: BODY_W,
        height: BODY_H,
        vx: 0,
        vy: 1000, // far above any slide max so the clamp always bites
        facing: 1,
        onGround: false,
        contacts: { groundId: null, leftWallId: null, rightWallId: null, ceilingId: null },
        ...overrides,
      };
    }
    function makeState(overrides: Partial<WallSlideAbilityState> = {}): WallSlideAbilityState {
      return { kind: 'wallSlide', sliding: false, side: null, lockTimer: 0, slideTimer: 0, graceTimer: 0, ...overrides };
    }
    function makeCtx(core: ActorCore, input: PlatformerInput = makeInput({ moveX: 1 })): AbilityContext {
      return { core, input, dt: DT, config: DEFAULT_PLATFORMER_CONFIG, solids: [WALL_RIGHT] };
    }

    it('clamp eases from wallSlideStartMax toward maxFallSpeed (per-tick max increases)', () => {
      const config = DEFAULT_PLATFORMER_CONFIG;
      const intoWall = makeInput({ moveX: 1 });
      // For each prior slideTimer T (already sliding, so slideTimer becomes T+dt),
      // the clamp max = lerp(wallSlideStartMax, maxFallSpeed, (T+dt)/wallSlideTime).
      const priors = [0, 0.3, 0.6, 0.9, 1.2];
      const clamped: number[] = [];
      for (const T of priors) {
        const core = makeCore({ vy: 1000 });
        const state = makeState({ sliding: true, side: 'right', lockTimer: 0, slideTimer: T });
        const r = wallSlideAbility.advance(makeCtx(core, intoWall), state);
        expect(r.state.sliding).toBe(true);
        const t = Math.min(1, (T + DT) / config.wallSlideTime);
        const expectedMax = lerp(config.wallSlideStartMax, config.maxFallSpeed, t);
        expect(r.core.vy).toBeCloseTo(expectedMax, 3);
        clamped.push(r.core.vy);
      }
      // Strictly increasing across the window: starts slow, accelerates.
      for (let i = 1; i < clamped.length; i += 1) {
        expect(clamped[i]).toBeGreaterThan(clamped[i - 1]);
      }
      // Bounded: first clamp near wallSlideStartMax, last at maxFallSpeed.
      expect(clamped[0]).toBeGreaterThan(config.wallSlideStartMax); // +dt of easing
      expect(clamped[clamped.length - 1]).toBeCloseTo(config.maxFallSpeed, 3);
    });

    it('releasing direction (moveX=0) stops the slide → vy unconstrained (falls normally)', () => {
      const core = makeCore({ vy: 1000 });
      const state = makeState({ sliding: true, side: 'right', lockTimer: 0, slideTimer: 0.5 });
      // moveX=0 → no intent toward the wall → sliding re-derives false → no clamp.
      const r = wallSlideAbility.advance(
        { ...makeCtx(core), input: makeInput({ moveX: 0 }) },
        state,
      );
      expect(r.state.sliding).toBe(false);
      expect(r.core.vy).toBe(1000); // unclamped — falls normally
    });

    it('holding away from the wall stops the slide', () => {
      const core = makeCore({ vy: 1000 });
      const state = makeState({ sliding: true, side: 'right', lockTimer: 0, slideTimer: 0.5 });
      // Wall is on the RIGHT; holding LEFT (away) → no intent → no slide.
      const r = wallSlideAbility.advance(
        { ...makeCtx(core), input: makeInput({ moveX: -1 }) },
        state,
      );
      expect(r.state.sliding).toBe(false);
      expect(r.core.vy).toBe(1000);
    });
  });
});
