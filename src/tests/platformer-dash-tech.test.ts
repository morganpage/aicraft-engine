import { describe, it, expect } from 'vitest';
import { createPlatformerState } from '../platformer/kernel';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import { dashTechAbility } from '../platformer/abilities/dash-tech-ability';
import { jumpLaunchVelocity } from '../animation/jump';
import type { Solid } from '../collision/types';
import type { PolledEdge } from '../input/types';
import type {
  AbilityContext,
  ActorCore,
  DashTechAbilityState,
  LocomotionState,
  PlatformerConfig,
  PlatformerInput,
} from '../platformer/types';
import {
  idleInput,
  makeInput,
  runTraceDetailed,
} from './platformer-trace-harness';

const DT = 1 / 60;

// ---------------------------------------------------------------------------
// Fixed timestep used by every trace in the suite (60 Hz).
// ---------------------------------------------------------------------------
/**
 * Phase 5 dash-tech tests — super jump / super wall jump / hyper / wavedash +
 * ducking. Covers both the `dashTechAbility` launch logic (unit tests with a
 * hand-built `AbilityContext.locomotion`) and the full end-to-end kernel paths
 * (multi-tick traces). All asserted magnitudes are the Celeste-pegged constants
 * from `DEFAULT_PLATFORMER_CONFIG` (roadmap §5); the per-tick gravity /
 * overspeed bleed the kernel applies AFTER a launch is documented inline where
 * an end-of-tick velocity differs from the launch impulse.
 */

// ---------------------------------------------------------------------------
// Fixtures for the unit tests.
// ---------------------------------------------------------------------------

function pressEdge(held = true): PolledEdge {
  return { held, pressed: true, released: false };
}

/** A `PlatformerInput` with only `jump` pressed (no move / dash). */
function jumpPressInput(): PlatformerInput {
  return { moveX: 0, jump: pressEdge(true), dash: null };
}

function makeCore(overrides: Partial<ActorCore> = {}): ActorCore {
  return {
    x: 100,
    y: 276,
    width: 16,
    height: 24,
    vx: 0,
    vy: 0,
    facing: 1,
    onGround: true,
    contacts: { groundId: 'floor', leftWallId: null, rightWallId: null, ceilingId: null },
    ...overrides,
  };
}

/** Build a full `LocomotionState` with Phase-5/6 fields, overriding select bits. */
function makeLocomotion(overrides: Partial<LocomotionState> = {}): LocomotionState {
  return {
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    varJumpTimer: 0,
    varJumpSpeed: 0,
    forceMoveXTimer: 0,
    forceMoveX: 0,
    maxFallCurrent: DEFAULT_PLATFORMER_CONFIG.maxFallSpeed,
    ducking: false,
    lastDashDirX: 0,
    lastDashDirY: 0,
    superJumpGraceTimer: 0,
    dashing: false,
    stamina: DEFAULT_PLATFORMER_CONFIG.wallGrabMaxStamina,
    retainedVx: 0,
    wallSpeedRetentionTimer: 0,
    wallSpeedRetaining: false,
    ...overrides,
  };
}

function makeCtx(
  core: ActorCore,
  input: PlatformerInput,
  locomotion: LocomotionState,
  solids: readonly Solid[] = [],
  config: PlatformerConfig = DEFAULT_PLATFORMER_CONFIG,
): AbilityContext {
  return { core, input, dt: DT, config, solids, locomotion };
}

const dashTechState: DashTechAbilityState = { kind: 'dashTech' };

// Shared geometry: a floor and a right wall flush against a body at x=184.
const FLOOR: Solid = { id: 'floor', x: 0, y: 300, width: 800, height: 16 };
const RIGHT_WALL: Solid = { id: 'wall-r', x: 200, y: 0, width: 16, height: 300 };
const LEFT_WALL: Solid = { id: 'wall-l', x: 100, y: 0, width: 16, height: 300 };

// ===========================================================================
// Unit tests — the `dashTechAbility` launch decisions (precise pegs).
// ===========================================================================
describe('dashTechAbility (unit)', () => {
  it('super jump: horizontal last dash + grace + jump pressed → superJump launch at pegged vx/vy', () => {
    // Last dash was horizontal-right; grace active; grounded; jump pressed.
    const core = makeCore();
    const loco = makeLocomotion({ lastDashDirX: 1, lastDashDirY: 0, superJumpGraceTimer: 0.1 });
    const r = dashTechAbility.advance(makeCtx(core, jumpPressInput(), loco), dashTechState);

    expect(r.launch).toBeDefined();
    expect(r.launch!.source).toBe('superJump');
    // [C: SuperJumpH 260 / MaxRun 90 = 2.89 × moveSpeed 200] → 578.
    expect(r.launch!.vx).toBeCloseTo(DEFAULT_PLATFORMER_CONFIG.superJumpVx, 6);
    // [C: SuperJumpSpeed = JumpSpeed] → jumpLaunchVelocity (≈ -342.857).
    expect(r.launch!.vy).toBeCloseTo(jumpLaunchVelocity(DEFAULT_PLATFORMER_CONFIG.jump), 6);
    expect(r.launch!.varJumpTime).toBeCloseTo(DEFAULT_PLATFORMER_CONFIG.jump.timeToApex, 6);
    // Super jump is jump-class → justLaunched emitted.
    expect(r.events.justLaunched).toBe(true);
    // Facing flips toward the dash direction.
    expect(r.core.facing).toBe(1);
  });

  it('super jump launch direction follows lastDashDirX sign (left dash → negative vx, facing -1)', () => {
    const core = makeCore({ facing: 1 });
    const loco = makeLocomotion({ lastDashDirX: -1, lastDashDirY: 0, superJumpGraceTimer: 0.1 });
    const r = dashTechAbility.advance(makeCtx(core, jumpPressInput(), loco), dashTechState);
    expect(r.launch!.source).toBe('superJump');
    expect(r.launch!.vx).toBeCloseTo(-DEFAULT_PLATFORMER_CONFIG.superJumpVx, 6);
    expect(r.core.facing).toBe(-1);
  });

  it('NO super jump when grace expired (grace gate): last dash horizontal but grace=0 → no launch', () => {
    const loco = makeLocomotion({ lastDashDirX: 1, lastDashDirY: 0, superJumpGraceTimer: 0 });
    const r = dashTechAbility.advance(makeCtx(makeCore(), jumpPressInput(), loco), dashTechState);
    expect(r.launch).toBeUndefined();
    expect(r.events.justLaunched).toBe(false);
  });

  it('NO super jump after a non-horizontal dash (diagonal last dash) → no launch', () => {
    // Diagonal up-right dash: lastDashDirY !== 0 (not horizontal), lastDashDirX
    // !== 0 (not straight up) → neither super branch fires.
    const loco = makeLocomotion({
      lastDashDirX: 1,
      lastDashDirY: -1,
      superJumpGraceTimer: 0.1,
    });
    const r = dashTechAbility.advance(makeCtx(makeCore(), jumpPressInput(), loco), dashTechState);
    expect(r.launch).toBeUndefined();
  });

  it('NO super jump while dashing (mid-dash guard): dashing=true → no launch', () => {
    const loco = makeLocomotion({
      lastDashDirX: 1,
      lastDashDirY: 0,
      superJumpGraceTimer: 0.1,
      dashing: true,
    });
    const r = dashTechAbility.advance(makeCtx(makeCore(), jumpPressInput(), loco), dashTechState);
    expect(r.launch).toBeUndefined();
  });

  it('NO super jump on the same tick a dash is pressed: dash wins the tick', () => {
    const loco = makeLocomotion({ lastDashDirX: 1, lastDashDirY: 0, superJumpGraceTimer: 0.1 });
    const input: PlatformerInput = { moveX: 1, jump: pressEdge(true), dash: pressEdge(true) };
    const r = dashTechAbility.advance(makeCtx(makeCore(), input, loco), dashTechState);
    expect(r.launch).toBeUndefined();
  });

  it('NO launch without a jump press (edge-triggered)', () => {
    const loco = makeLocomotion({ lastDashDirX: 1, lastDashDirY: 0, superJumpGraceTimer: 0.1 });
    const holdInput: PlatformerInput = { moveX: 0, jump: { held: true, pressed: false, released: false }, dash: null };
    const r = dashTechAbility.advance(makeCtx(makeCore(), holdInput, loco), dashTechState);
    expect(r.launch).toBeUndefined();
  });

  it('super wall jump: straight-up last dash + wall present → superWallJump launch away from wall', () => {
    // Body flush against the right wall (right edge 200 = wall x). Last dash
    // straight up. probeWall finds the wall on the right → push left.
    const core = makeCore({ x: 184 }); // 184+16=200 flush against wall-r
    const loco = makeLocomotion({ lastDashDirX: 0, lastDashDirY: -1 });
    const r = dashTechAbility.advance(
      makeCtx(core, jumpPressInput(), loco, [FLOOR, RIGHT_WALL]),
      dashTechState,
    );
    expect(r.launch).toBeDefined();
    expect(r.launch!.source).toBe('superWallJump');
    // Push LEFT (away from the right wall): vx negative.
    expect(r.launch!.vx).toBeCloseTo(-DEFAULT_PLATFORMER_CONFIG.superWallJumpVx, 6);
    // [C: SuperWallJumpSpeed -160 / JumpSpeed -105 = 1.52 × 343] → -523.
    expect(r.launch!.vy).toBeCloseTo(DEFAULT_PLATFORMER_CONFIG.superWallJumpVy, 6);
    expect(r.events.justLaunched).toBe(true);
    expect(r.events.wallJumpLaunched).toBe(true);
    expect(r.core.facing).toBe(-1);
  });

  it('super wall jump: wall on LEFT → push right (positive vx, facing +1)', () => {
    // Body flush against a left wall (x = wall right edge). Last dash straight up.
    const core = makeCore({ x: 116 }); // left wall at x=100..116; body left edge 116 flush
    const loco = makeLocomotion({ lastDashDirX: 0, lastDashDirY: -1 });
    const r = dashTechAbility.advance(
      makeCtx(core, jumpPressInput(), loco, [FLOOR, LEFT_WALL]),
      dashTechState,
    );
    expect(r.launch!.source).toBe('superWallJump');
    expect(r.launch!.vx).toBeCloseTo(DEFAULT_PLATFORMER_CONFIG.superWallJumpVx, 6);
    expect(r.core.facing).toBe(1);
  });

  it('NO super wall jump without a wall present (straight-up dash in open air)', () => {
    const core = makeCore({ x: 400 }); // open air, no wall within probe distance
    const loco = makeLocomotion({ lastDashDirX: 0, lastDashDirY: -1 });
    const r = dashTechAbility.advance(
      makeCtx(core, jumpPressInput(), loco, [FLOOR]),
      dashTechState,
    );
    expect(r.launch).toBeUndefined();
  });

  it('duck super jump: ducking + super jump → vx*=duckSuperJumpXMult (1.25), vy*=duckSuperJumpYMult (0.5), clear ducking', () => {
    const core = makeCore();
    const loco = makeLocomotion({
      lastDashDirX: 1,
      lastDashDirY: 0,
      superJumpGraceTimer: 0.1,
      ducking: true,
    });
    const r = dashTechAbility.advance(makeCtx(core, jumpPressInput(), loco), dashTechState);
    expect(r.launch!.source).toBe('superJump');
    // [C: DuckSuperJumpXMult 1.25] × superJumpVx 578 = 722.5 (fast).
    expect(r.launch!.vx).toBeCloseTo(
      DEFAULT_PLATFORMER_CONFIG.superJumpVx * DEFAULT_PLATFORMER_CONFIG.duckSuperJumpXMult,
      6,
    );
    // [C: DuckSuperJumpYMult 0.5] × jumpLaunchVelocity (≈ -171.43, flat).
    expect(r.launch!.vy).toBeCloseTo(
      jumpLaunchVelocity(DEFAULT_PLATFORMER_CONFIG.jump) * DEFAULT_PLATFORMER_CONFIG.duckSuperJumpYMult,
      6,
    );
    // Ducking cleared via the launch (kernel clears ducking on any launch; the
    // ability also signals the clear via its locomotionPatch).
    expect(r.locomotionPatch).toEqual({ ducking: false });
  });

  it('pure: input core/state are not mutated', () => {
    const core = makeCore();
    const loco = makeLocomotion({ lastDashDirX: 1, lastDashDirY: 0, superJumpGraceTimer: 0.1 });
    const coreSnap = JSON.parse(JSON.stringify(core)) as ActorCore;
    dashTechAbility.advance(makeCtx(core, jumpPressInput(), loco), dashTechState);
    expect(core).toEqual(coreSnap);
    expect(dashTechState).toEqual({ kind: 'dashTech' });
  });
});

// ===========================================================================
// Integration tests — full kernel multi-tick scenarios.
// ===========================================================================
describe('dash-tech integration (full kernel)', () => {
  // =========================================================================
  // SUPER JUMP — horizontal ground dash → jump within grace.
  //
  // Timeline (dash press at tick 1): startup ticks 1-3 (freeze), transition at
  // tick 4 (dashStarted), active ticks 4-11, expiry at tick 12. The actor
  // re-grounds at tick 12 → superJumpGraceTimer refreshed. tick 13 jump press →
  // super jump. The super jump launch (vx=578, vy≈-342.86) is applied to core,
  // then the SAME tick the kernel applies one gravity step (vy += g·dt ≈ +20.4)
  // and one overspeed bleed (vx -= overspeedReduce·dt ≈ -14.83), so the
  // end-of-tick trace values are slightly below the launch impulse — Celeste
  // does the same (RunReduce + gravity run after SuperJump sets Speed).
  // =========================================================================
  it('super jump: horizontal ground dash → jump within grace launches at superJumpVx (NOT a normal jump)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const initial = createPlatformerState(100, 276, config);
    const inputs = [
      idleInput(), // 0 settle (land, onGround=true)
      makeInput({ moveX: 1, dash: 'press' }), // 1 horizontal dash right
      ...Array.from({ length: 11 }, () => makeInput({ moveX: 1 })), // 2-12 dash runs + expires
      makeInput({ moveX: 1, jump: 'press' }), // 13 super jump
      ...Array.from({ length: 6 }, () => makeInput({ jump: 'hold' })), // 14-19 hold
    ];
    const { trace, events, finalState } = runTraceDetailed({
      initial,
      inputs,
      solids: [FLOOR],
      config,
    });

    // Exactly ONE launch (the super jump) — the plain jump's anticipation was
    // cancelled by the kernel's super-source jump-slice reset.
    const launches = events.filter((e) => e.justLaunched);
    expect(launches.length).toBe(1);
    const launchTick = events.findIndex((e) => e.justLaunched);
    expect(launchTick).toBe(13);

    // The launch vy is recorded verbatim on locomotion.varJumpSpeed (NOT yet
    // gravity-affected): equals jumpLaunchVelocity (SuperJumpSpeed = JumpSpeed).
    expect(finalState.locomotion.varJumpSpeed).toBeCloseTo(
      jumpLaunchVelocity(config.jump),
      5,
    );

    // vx at the launch tick is far above moveSpeed (200) — proof of a SUPER
    // jump, not a normal jump (which would be ≤ moveSpeed). The exact end-of-
    // tick value is superJumpVx minus one tick of overspeed bleed
    // (overspeedReduce·dt ≈ 14.83): 578 - 14.83 ≈ 563.17.
    expect(trace[launchTick].vx).toBeGreaterThan(500);
    expect(trace[launchTick].vx).toBeCloseTo(
      config.superJumpVx - config.overspeedReduce * DT,
      4,
    );
    // vy is the launch impulse plus one gravity step (the actor is rising, so
    // gravity makes vy less negative): -342.857 + 20.408 ≈ -322.45.
    const gJump = (2 * config.jump.apexHeight) / (config.jump.timeToApex ** 2);
    expect(trace[launchTick].vy).toBeCloseTo(
      jumpLaunchVelocity(config.jump) + gJump * DT,
      4,
    );
    // The actor is airborne immediately after.
    expect(trace[launchTick].onGround).toBe(false);
  });

  it('super jump consumes the press: no second (normal) launch 3 ticks later', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const initial = createPlatformerState(100, 276, config);
    const inputs = [
      idleInput(),
      makeInput({ moveX: 1, dash: 'press' }),
      ...Array.from({ length: 11 }, () => makeInput({ moveX: 1 })),
      makeInput({ moveX: 1, jump: 'press' }), // super jump at tick 13
      ...Array.from({ length: 8 }, () => makeInput({ jump: 'hold' })), // 14-21
    ];
    const { events } = runTraceDetailed({ initial, inputs, solids: [FLOOR], config });
    // Exactly one launch across the whole window — the plain jump never fires.
    expect(events.filter((e) => e.justLaunched).length).toBe(1);
  });

  it('super wall jump: straight-up dash against a wall → jump launches away at superWallJumpVx/Vy', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    // Start flush against the right wall, on the floor.
    const initial = createPlatformerState(184, 276, config);
    const inputs = [
      idleInput(), // 0 settle
      makeInput({ moveY: -1, dash: 'press' }), // 1 straight-UP dash (into the wall)
      ...Array.from({ length: 11 }, () => makeInput({ moveY: -1 })), // 2-12 dash runs + expires
      makeInput({ jump: 'press' }), // 13 super wall jump
      ...Array.from({ length: 4 }, () => makeInput({ jump: 'hold' })),
    ];
    const { trace, events, finalState } = runTraceDetailed({
      initial,
      inputs,
      solids: [FLOOR, RIGHT_WALL],
      config,
    });
    const launches = events.filter((e) => e.justLaunched);
    expect(launches.length).toBe(1);
    const launchTick = events.findIndex((e) => e.justLaunched);

    // Launched AWAY from the right wall → vx negative. End-of-tick vx is
    // superWallJumpVx (378) ramped by the wall-jump lockout toward -moveSpeed;
    // it stays strongly negative immediately after launch.
    expect(trace[launchTick].vx).toBeLessThan(-200);
    // The launch vy is recorded verbatim on varJumpSpeed = superWallJumpVy.
    expect(finalState.locomotion.varJumpSpeed).toBeCloseTo(config.superWallJumpVy, 5);
    expect(events[launchTick].wallJumpLaunched).toBe(true);
  });

  // =========================================================================
  // HYPER SLIDE — down-diagonal ground dash → ducking horizontal slide.
  //
  // At the startup→active transition (tick 4), the down-right dash converts:
  // direction flattened to horizontal, speed boosted to dashSpeed ×
  // dodgeSlideSpeedMult (420 × 1.2 = 504), vy zeroed, ducking latched. The
  // boosted speed SUSTAINS for the whole active phase (ticks 4-11). At expiry
  // (tick 12) the base end-dash velocity applies (420 × 0.67 ≈ 281.4), then
  // duckFriction bleeds it (1110/s ≈ 18.5/tick).
  // =========================================================================
  it('hyper slide: down-diagonal ground dash → ducking, vy≈0, vx = dashSpeed × dodgeSlideSpeedMult (sustained)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const initial = createPlatformerState(100, 276, config);
    const inputs = [
      idleInput(), // 0 settle
      makeInput({ moveX: 1, moveY: 1, dash: 'press' }), // 1 down-right dash → hyper
      ...Array.from({ length: 14 }, () => makeInput({ moveX: 1, moveY: 1 })), // hold
    ];
    const { trace, finalState } = runTraceDetailed({
      initial,
      inputs,
      solids: [FLOOR],
      config,
    });

    const slideSpeed = config.dashSpeed * config.dodgeSlideSpeedMult; // 504
    // The transition tick (4) and every sustained active tick (5-11) hold the
    // BOOSTED speed — the boost does not decay to base dashSpeed mid-slide.
    for (const t of [4, 5, 6, 7, 8, 9, 10, 11]) {
      expect(trace[t].vx).toBeCloseTo(slideSpeed, 5);
      expect(trace[t].vy).toBe(0);
    }
    // ducking latched true by the hyper (readable on the final state's
    // locomotion, which is post-expiry so still grounded → still ducking).
    expect(finalState.locomotion.ducking).toBe(true);
    // The slide is faster than a normal horizontal dash (dashSpeed 420).
    expect(slideSpeed).toBeGreaterThan(config.dashSpeed);
    expect(trace[4].vx).toBeGreaterThan(config.dashSpeed);
  });

  it('hyper ducking LATCHES: persists after the slide even when down is released (Celeste-faithful)', () => {
    // The hyper sets ducking via the slide; the latch must keep it true after
    // the dash ends even if the player is NOT holding down (Celeste: the hyper
    // slide's duck survives into the follow-up until jump/airborne). This
    // verifies the kernel does not clear ducking mid-dash for the "airborne"
    // rule (onGround reads false during a dash even on a ground slide).
    const config = DEFAULT_PLATFORMER_CONFIG;
    const initial = createPlatformerState(100, 276, config);
    const inputs = [
      idleInput(),
      makeInput({ moveX: 1, moveY: 1, dash: 'press' }), // hyper slide
      ...Array.from({ length: 11 }, () => makeInput({ moveX: 1, moveY: 1 })), // slide
      // dash expired at tick 12; RELEASE down but keep holding right (grounded).
      makeInput({ moveX: 1, moveY: 0 }),
      makeInput({ moveX: 1, moveY: 0 }),
      makeInput({ moveX: 1, moveY: 0 }),
    ];
    const { trace, finalState } = runTraceDetailed({
      initial,
      inputs,
      solids: [FLOOR],
      config,
    });
    // Still grounded, not holding down, no jump → ducking latched true.
    expect(finalState.locomotion.ducking).toBe(true);
    // And vx still bleeds at duckFriction (not the faster runAccel release):
    // from tick 13→14 the bleed is ~18.5 (duckFriction·dt), not ~37 (runAccel).
    expect(trace[13].vx - trace[14].vx).toBeCloseTo(config.duckFriction * DT, 4);
  });

  // =========================================================================
  // DUCK SUPER JUMP (full hyper) — hyper slide → jump → fast + flat.
  //
  // After the hyper slide (ducking), a jump press (tick 13) fires a DUCK super
  // jump: vx = superJumpVx × duckSuperJumpXMult (578 × 1.25 = 722.5), vy =
  // jumpLaunchVelocity × duckSuperJumpYMult (≈ -171.43). End-of-tick values
  // again include one gravity + overspeed step. ducking is cleared on launch.
  // This is the wavedash: fast forward + flat arc.
  // =========================================================================
  it('duck super jump (full hyper): hyper slide → jump → vx ≈ superJumpVx × duckXMult, vy ≈ jumpLaunch × duckYMult, ducking cleared', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const initial = createPlatformerState(100, 276, config);
    const inputs = [
      idleInput(), // 0 settle
      makeInput({ moveX: 1, moveY: 1, dash: 'press' }), // 1 hyper slide
      ...Array.from({ length: 11 }, () => makeInput({ moveX: 1, moveY: 1 })), // 2-12 slide + expiry
      makeInput({ moveX: 1, moveY: 1, jump: 'press' }), // 13 duck super jump
      ...Array.from({ length: 5 }, () => makeInput({ jump: 'hold' })),
    ];
    const { trace, events, finalState } = runTraceDetailed({
      initial,
      inputs,
      solids: [FLOOR],
      config,
    });
    const launches = events.filter((e) => e.justLaunched);
    expect(launches.length).toBe(1);
    const launchTick = events.findIndex((e) => e.justLaunched);
    expect(launchTick).toBe(13);

    // The duck super jump launches at the FLAT+FAST multipliers. The launch vy
    // is recorded verbatim on varJumpSpeed.
    expect(finalState.locomotion.varJumpSpeed).toBeCloseTo(
      jumpLaunchVelocity(config.jump) * config.duckSuperJumpYMult,
      5,
    );
    // vx at launch tick ≈ 722.5 minus one overspeed bleed (≈ 707.67).
    const launchVx =
      config.superJumpVx * config.duckSuperJumpXMult - config.overspeedReduce * DT;
    expect(trace[launchTick].vx).toBeCloseTo(launchVx, 4);
    expect(trace[launchTick].vx).toBeGreaterThan(700); // distinctly FAST

    // Ducking was cleared by the launch.
    expect(finalState.locomotion.ducking).toBe(false);
  });

  // =========================================================================
  // DUCKING FRICTION — holding down on the ground bleeds vx at duckFriction.
  //
  // duckFriction = 1110 px/s² = 18.5/tick. A normal release uses runAccel
  // (2220 px/s² = 37/tick) — Celeste's DuckFriction is HALF RunAccel, so the
  // slide retains its reach (slower bleed).
  // =========================================================================
  it('ducking friction: holding moveY=1 on ground at speed → decelerates at duckFriction (18.5/tick)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const base = createPlatformerState(100, 276, config);
    // Start grounded with a large overspeed vx (e.g. post-dash carry).
    const initial = {
      ...base,
      core: { ...base.core, vx: 500, onGround: true },
    };
    const inputs = Array.from({ length: 6 }, () => makeInput({ moveX: 1, moveY: 1 }));
    const { trace } = runTraceDetailed({ initial, inputs, solids: [FLOOR], config });

    // Each tick bleeds duckFriction·dt = 1110/60 = 18.5 from vx.
    const expectedDecrement = config.duckFriction * DT;
    for (let t = 1; t < 6; t++) {
      expect(trace[t].vx).toBeCloseTo(500 - expectedDecrement * (t + 1), 4);
    }
    // Compare against a NON-ducking release (moveY=0), which uses the higher
    // overspeedReduce (890) → 14.83/tick... actually release uses runAccel
    // (2220) since target=0 and not holding the dir. Either way it differs
    // from duckFriction. Demonstrate ducking bleeds at its own distinct rate.
    const releaseInitial = {
      ...base,
      core: { ...base.core, vx: 500, onGround: true },
    };
    const releaseInputs = Array.from({ length: 6 }, () => makeInput({ moveX: 0, moveY: 0 }));
    const { trace: releaseTrace } = runTraceDetailed({
      initial: releaseInitial,
      inputs: releaseInputs,
      solids: [FLOOR],
      config,
    });
    // The ducking bleed (18.5/tick) differs from the release bleed (37/tick).
    expect(trace[1].vx).not.toBeCloseTo(releaseTrace[1].vx, 4);
    // tick 1 has bled twice (ticks 0 and 1): 500 - 18.5·2 = 463.
    expect(500 - trace[1].vx).toBeCloseTo(expectedDecrement * 2, 4);
  });

  it('ducking clears on jump (any launch clears ducking)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const base = createPlatformerState(100, 276, config);
    // Start ducking on the ground.
    const initial = {
      ...base,
      core: { ...base.core, vx: 0, onGround: true },
      locomotion: { ...base.locomotion, ducking: true },
    };
    // Hold down (stay ducking) then jump. The ground jump spends
    // anticipationDuration (~3 ticks) anticipating before launching, so the
    // window must extend past the launch tick.
    const inputs = [
      makeInput({ moveY: 1 }), // 0 still ducking
      makeInput({ moveY: 1, jump: 'press' }), // 1 jump press (→ anticipating)
      ...Array.from({ length: 7 }, () => makeInput({ jump: 'hold' })), // 2-8 launch + rise
    ];
    const { events, finalState } = runTraceDetailed({
      initial,
      inputs,
      solids: [FLOOR],
      config,
    });
    // The jump fired (normal ground jump — no dash-tech here, lastDashDir 0/0).
    expect(events.some((e) => e.justLaunched)).toBe(true);
    // After the launch tick, ducking is cleared (any launch clears ducking).
    expect(finalState.locomotion.ducking).toBe(false);
  });

  it('ducking clears when airborne', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const base = createPlatformerState(100, 276, config);
    // Ducking, then walk off the floor's edge into open air.
    const initial = {
      ...base,
      core: { ...base.core, vx: 0, onGround: true },
      locomotion: { ...base.locomotion, ducking: true },
    };
    // No floor under the actor after it moves right off a small ledge: use an
    // empty solids list so onGround goes false immediately.
    const inputs = [
      makeInput({ moveY: 1 }),
      makeInput({ moveY: 1 }),
      makeInput({ moveY: 1 }),
    ];
    const { finalState } = runTraceDetailed({
      initial,
      inputs,
      solids: [],
      config,
    });
    // Airborne → ducking cleared.
    expect(finalState.core.onGround).toBe(false);
    expect(finalState.locomotion.ducking).toBe(false);
  });

  // =========================================================================
  // WAVEDASH — the emergent trajectory from hyper slide → duck super jump.
  //
  // Numbers (from the trace): the duck super jump launches at vx ≈ 722.5 (fast)
  // and vy ≈ -171.43 (flat). With jump HELD, the actor rises only ~1.2px in the
  // first tick (vy -171 → -151 after gravity) while covering ~12px forward — a
  // fast, flat forward carry. This IS the wavedash: a ground dash that converts
  // to a slide, then jumps into a flat fast trajectory. Documented here as the
  // composite of the hyper-slide + duck-super-jump scenarios above.
  // =========================================================================
  it('wavedash emerges: hyper → duck super jump trajectory is fast + flat (documented)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const initial = createPlatformerState(100, 276, config);
    const inputs = [
      idleInput(),
      makeInput({ moveX: 1, moveY: 1, dash: 'press' }),
      ...Array.from({ length: 11 }, () => makeInput({ moveX: 1, moveY: 1 })),
      makeInput({ moveX: 1, moveY: 1, jump: 'press' }), // duck super jump at 13
      ...Array.from({ length: 7 }, () => makeInput({ moveX: 1, jump: 'hold' })),
    ];
    const { trace } = runTraceDetailed({ initial, inputs, solids: [FLOOR], config });

    // Over the slide (ticks 4-11) the actor covers slideSpeed·dt per tick.
    const slidePerTick = config.dashSpeed * config.dodgeSlideSpeedMult * DT;
    expect(trace[5].x - trace[4].x).toBeCloseTo(slidePerTick, 4);

    // The duck super jump (tick 13) is FAST + FLAT: large forward dx, small
    // upward dy in the first post-launch tick.
    const launchDx = trace[14].x - trace[13].x;
    const launchDy = trace[14].y - trace[13].y;
    expect(launchDx).toBeGreaterThan(10); // fast forward (>10px/tick)
    expect(launchDy).toBeGreaterThan(-4); // flat (rises < 4px/tick)
    expect(launchDx).toBeGreaterThan(Math.abs(launchDy) * 3); // forward-dominated
  });
});
