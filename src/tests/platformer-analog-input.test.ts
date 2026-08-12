import { describe, it, expect } from 'vitest';
import { stepPlatformer, createPlatformerState } from '../platformer/kernel';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import { wallSlideAbility } from '../platformer/abilities/wall-slide-ability';
import { makeInput, DT } from './platformer-trace-harness';
import type { Solid } from '../collision/types';
import type { PolledEdge } from '../input/types';
import type {
  AbilityContext,
  ActorCore,
  PlatformerInput,
  WallSlideAbilityState,
} from '../platformer/types';

/**
 * Phase 9 — analog input (`moveX: number`) integration + unit tests.
 *
 * `PlatformerInput.moveX` was widened from `-1 | 0 | 1` to `number` so analog
 * controllers (gamepad sticks) can drive partial-speed movement. The cardinal
 * rule is that DIGITAL behavior (`moveX ∈ {-1, 0, 1}`) is byte-identical to v8
 * — the comprehensive regression guard for that is the `traceHash` canaries in
 * `platformer-traces.test.ts` (unchanged by Phase 9). These tests cover the
 * NEW analog surface: partial-speed target, sign-based facing/dash/wall-intent,
 * and edge detection that is magnitude-independent.
 *
 * All magnitudes peg to `DEFAULT_PLATFORMER_CONFIG`: moveSpeed 200, dashSpeed
 * 420, runAccel 2220. dt = 1/60.
 */

// ---------------------------------------------------------------------------
// Geometry + edge helpers.
// ---------------------------------------------------------------------------

/** A wide floor so ground tests never walk off the edge (feet rest on y=300). */
const FLOOR: Solid = { id: 'floor', x: 0, y: 300, width: 4000, height: 16 };

const BODY_W = 16;
const BODY_H = 24;

/** Right wall flush against a body at x=0 (body right edge at 16). */
const WALL_RIGHT: Solid = {
  id: 'wall-r',
  x: BODY_W,
  y: 0,
  width: BODY_W,
  height: 100,
};

function idleEdge(): PolledEdge {
  return { held: false, pressed: false, released: false };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 9 — analog moveX', () => {
  // =========================================================================
  // 1. Partial move: moveX = 0.5 on ground → target vx = 0.5 × moveSpeed (100),
  //    rate-based accel toward it, settling at ~100.
  // =========================================================================
  it('partial move (moveX=0.5) targets half moveSpeed and settles at vx≈100', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const target = 0.5 * config.moveSpeed; // 100
    expect(target).toBe(100);

    const initial = createPlatformerState(100, 276, config); // feet rest on FLOOR
    let state = initial;
    // Hold the analog deflection; ground accel approaches the SCALED target.
    for (let i = 0; i < 8; i++) {
      state = stepPlatformer(state, makeInput({ moveX: 0.5 }), [FLOOR], DT, config).state;
    }
    // Settled at the partial target (100), NOT the full moveSpeed (200).
    expect(state.core.vx).toBeCloseTo(target, 4);
    expect(state.core.vx).toBeLessThan(config.moveSpeed);
  });

  // =========================================================================
  // 2. Facing derivation is sign-based: moveX = -0.3 → facing === -1 (a partial
  //    left deflection still faces left).
  // =========================================================================
  it('facing from analog: moveX=-0.3 → facing === -1', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const initial = createPlatformerState(100, 276, config);
    const state = stepPlatformer(
      initial,
      makeInput({ moveX: -0.3 }),
      [FLOOR],
      DT,
      config,
    ).state;
    expect(state.core.facing).toBe(-1);
  });

  it('facing from analog: moveX=0.2 → facing === 1', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const initial = createPlatformerState(100, 276, config);
    const state = stepPlatformer(
      initial,
      makeInput({ moveX: 0.2 }),
      [FLOOR],
      DT,
      config,
    ).state;
    expect(state.core.facing).toBe(1);
  });

  // =========================================================================
  // 3. Dash direction is sign-based: moveX = 0.7 (no moveY) → dash dirX = 1
  //    (sign), and the dash speed is the FULL dashSpeed (magnitude does not
  //    scale the dash — dash is a sign intent, never a magnitude).
  // =========================================================================
  it('dash direction from analog: moveX=0.7 → dirX=1 (sign), full dashSpeed', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    // Airborne with no solids so the dash runs uninterrupted and there is no
    // ground-dash hyper conversion.
    const initial = createPlatformerState(100, 100, config);

    // Tick 0 — dash press: direction is captured as the SIGN of moveX.
    const pressState = stepPlatformer(
      initial,
      makeInput({ moveX: 0.7, dash: 'press' }),
      [],
      DT,
      config,
    ).state;
    const dash0 = pressState.abilities['dash'];
    expect(dash0).toBeDefined();
    expect(dash0!.kind).toBe('dash');
    if (dash0!.kind === 'dash') {
      // Captured dirX is the sign (1), NOT the raw magnitude (0.7).
      expect(dash0.dirX).toBe(1);
      expect(dash0.dirY).toBe(0);
    }

    // Step past the startup freeze (dashStartupTime 0.05 ≈ 3 ticks) into the
    // active phase and assert the FULL dash speed applies (not 0.7 × dashSpeed).
    let state = pressState;
    for (let i = 0; i < 4; i++) {
      state = stepPlatformer(state, makeInput({ moveX: 0.7 }), [], DT, config).state;
    }
    // During active dash, |vx| is the full dashSpeed (420), unscaled by 0.7.
    expect(Math.abs(state.core.vx)).toBeCloseTo(config.dashSpeed, 4);
    expect(Math.abs(state.core.vx)).toBeGreaterThan(0.9 * config.dashSpeed);
  });

  // =========================================================================
  // 4. Wall intent is sign-based: a partial deflection toward a wall engages
  //    wall-slide; moveX = 0 does NOT (release). Unit-tested at the ability
  //    level (the sign-based intent gate lives in `wallSlideAbility`).
  // =========================================================================
  describe('wall intent from analog (wallSlideAbility unit)', () => {
    function makeCore(overrides: Partial<ActorCore> = {}): ActorCore {
      return {
        x: 0,
        y: 50,
        width: BODY_W,
        height: BODY_H,
        vx: 0,
        vy: 200, // falling (vy > 0) — required for slide engage
        facing: 1,
        onGround: false,
        contacts: {
          groundId: null,
          leftWallId: null,
          rightWallId: null,
          ceilingId: null,
        },
        ...overrides,
      };
    }
    function makeCtx(
      core: ActorCore,
      input: PlatformerInput,
      solids: readonly Solid[] = [WALL_RIGHT],
    ): AbilityContext {
      return {
        core,
        input,
        dt: DT,
        config: DEFAULT_PLATFORMER_CONFIG,
        solids,
      };
    }
    function makeState(): WallSlideAbilityState {
      return {
        kind: 'wallSlide',
        sliding: false,
        side: null,
        lockTimer: 0,
        slideTimer: 0,
      };
    }

    it('moveX=0.4 toward a right wall → slide engages (sign-based intent)', () => {
      const core = makeCore();
      const input: PlatformerInput = { moveX: 0.4, moveY: 0, jump: idleEdge(), dash: null };
      const r = wallSlideAbility.advance(makeCtx(core, input), makeState());
      expect(r.state.sliding).toBe(true);
      expect(r.state.side).toBe('right');
    });

    it('moveX=0 (release) → no slide', () => {
      const core = makeCore();
      const input: PlatformerInput = { moveX: 0, moveY: 0, jump: idleEdge(), dash: null };
      const r = wallSlideAbility.advance(makeCtx(core, input), makeState());
      expect(r.state.sliding).toBe(false);
    });

    it('moveX=-0.2 (away from the right wall) → no slide', () => {
      const core = makeCore();
      const input: PlatformerInput = { moveX: -0.2, moveY: 0, jump: idleEdge(), dash: null };
      const r = wallSlideAbility.advance(makeCtx(core, input), makeState());
      expect(r.state.sliding).toBe(false);
    });
  });

  // =========================================================================
  // 5. Digital unchanged: moveX ∈ {-1, 0, 1} produces the SAME vx/facing as
  //    before (regression guard — the traceHash canaries are the comprehensive
  //    check; these explicit assertions document the contract).
  // =========================================================================
  it('digital moveX=1 on ground → vx settles at full moveSpeed (200)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const initial = createPlatformerState(100, 276, config);
    let state = initial;
    for (let i = 0; i < 8; i++) {
      state = stepPlatformer(state, makeInput({ moveX: 1 }), [FLOOR], DT, config).state;
    }
    expect(state.core.vx).toBeCloseTo(config.moveSpeed, 4);
    expect(state.core.facing).toBe(1);
  });

  it('digital moveX=-1 → facing === -1 and vx settles at -moveSpeed', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const initial = createPlatformerState(100, 276, config);
    let state = initial;
    for (let i = 0; i < 8; i++) {
      state = stepPlatformer(state, makeInput({ moveX: -1 }), [FLOOR], DT, config).state;
    }
    expect(state.core.facing).toBe(-1);
    expect(state.core.vx).toBeCloseTo(-config.moveSpeed, 4);
  });

  it('analog 0.5 reaches a DIFFERENT vx than digital 1 (analog actually scales)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const analogStart = createPlatformerState(100, 276, config);
    let analog = analogStart;
    for (let i = 0; i < 8; i++) {
      analog = stepPlatformer(analog, makeInput({ moveX: 0.5 }), [FLOOR], DT, config).state;
    }
    const digitalStart = createPlatformerState(100, 276, config);
    let digital = digitalStart;
    for (let i = 0; i < 8; i++) {
      digital = stepPlatformer(digital, makeInput({ moveX: 1 }), [FLOOR], DT, config).state;
    }
    expect(analog.core.vx).toBeCloseTo(100, 4);
    expect(digital.core.vx).toBeCloseTo(200, 4);
    expect(analog.core.vx).not.toBeCloseTo(digital.core.vx, 4);
  });

  // =========================================================================
  // 6. Edge detection is magnitude-independent: jump/dash fire regardless of
  //    the moveX magnitude (edges read jump.pressed / dash.pressed, never the
  //    moveX magnitude).
  // =========================================================================
  it('jump fires with a fractional moveX (moveX=0.2 + jump press → justLaunched)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const initial = createPlatformerState(100, 276, config);
    let state = initial;
    let launched = false;
    // Press jump (held) with a small analog deflection; step through the
    // anticipation window. The jump MUST fire (justLaunched) regardless of the
    // 0.2 stick magnitude.
    for (let i = 0; i < 8; i++) {
      const input: PlatformerInput =
        i === 0
          ? makeInput({ moveX: 0.2, jump: 'press' })
          : makeInput({ moveX: 0.2, jump: 'hold' });
      state = stepPlatformer(state, input, [FLOOR], DT, config).state;
      if (state.events.justLaunched) launched = true;
    }
    expect(launched).toBe(true);
  });

  it('dash fires with a fractional moveX (moveX=0.9 + dash press → dashStarting)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const initial = createPlatformerState(100, 100, config); // airborne
    const state = stepPlatformer(
      initial,
      makeInput({ moveX: 0.9, dash: 'press' }),
      [],
      DT,
      config,
    ).state;
    // The dash edge fired on the press tick despite the non-unit moveX.
    expect(state.events.dashStarting).toBe(true);
  });
});
