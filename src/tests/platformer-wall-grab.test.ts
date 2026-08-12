import { describe, it, expect } from 'vitest';
import { wallGrabAbility } from '../platformer/abilities/wall-grab-ability';
import { createPlatformerState, stepPlatformer } from '../platformer/kernel';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import type { Solid } from '../collision/types';
import type {
  AbilityContext,
  ActorCore,
  LocomotionState,
  PlatformerConfig,
  PlatformerInput,
  WallGrabAbilityState,
} from '../platformer/types';
import type { PolledEdge } from '../input/types';

const DT = 1 / 60;

// ---------------------------------------------------------------------------
// Fixtures
//
// Phase 0e: wall-presence detection uses `probeWall` (a geometry query against
// `ctx.solids`), NOT `core.contacts`. The wall solids below are positioned
// flush against the body's leading edge (gap 0, which `probeWall` counts as
// contact) with full Y-overlap, so the ability detects them within the default
// `wallProbeDistance` of 3 px — independent of the body's velocity.
// ---------------------------------------------------------------------------

const BODY_W = 16;
const BODY_H = 24;

/** Right wall flush against the body's right edge (body.x=0, body right=16 ⇒ wall left edge at 16). */
const WALL_RIGHT: Solid = { id: 'wall-r', x: BODY_W, y: 0, width: BODY_W, height: 100 };
/** Left wall flush against the body's left edge (body.x=0 ⇒ wall right edge at 0). */
const WALL_LEFT: Solid = { id: 'wall-l', x: -BODY_W, y: 0, width: BODY_W, height: 100 };

/** Config with the wall-grab ability enabled (OFF by default in DEFAULTS). */
const GRAB_CONFIG: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };

function idleEdge(): PolledEdge {
  return { held: false, pressed: false, released: false };
}
function holdEdge(): PolledEdge {
  return { held: true, pressed: false, released: false };
}
function pressEdge(held = true): PolledEdge {
  return { held, pressed: true, released: false };
}

function makeInput(
  grab: PolledEdge | null,
  jump: PolledEdge = idleEdge(),
  moveX: -1 | 0 | 1 = 0,
  moveY: -1 | 0 | 1 = 0,
  dash: PolledEdge | null = null,
): PlatformerInput {
  return { moveX, moveY, jump, dash, grab };
}

function makeCtx(
  core: ActorCore,
  input: PlatformerInput,
  config: PlatformerConfig = GRAB_CONFIG,
  solids: readonly Solid[] = [],
  locomotion?: Partial<LocomotionState>,
): AbilityContext {
  const fullLoco: LocomotionState = {
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    varJumpTimer: 0,
    varJumpSpeed: 0,
    forceMoveXTimer: 0,
    forceMoveX: 0,
    maxFallCurrent: config.maxFallSpeed,
    ducking: false,
    lastDashDirX: 0,
    lastDashDirY: 0,
    superJumpGraceTimer: 0,
    dashing: false,
    stamina: config.wallGrabMaxStamina,
    retainedVx: 0,
    wallSpeedRetentionTimer: 0,
    wallSpeedRetaining: false,
    ...locomotion,
  };
  return { core, input, dt: DT, config, solids, locomotion: fullLoco };
}

function makeCore(overrides: Partial<ActorCore> = {}): ActorCore {
  return {
    x: 0,
    y: 50,
    width: BODY_W,
    height: BODY_H,
    vx: 0,
    vy: 200,
    facing: 1,
    onGround: false,
    contacts: { groundId: null, leftWallId: null, rightWallId: null, ceilingId: null },
    ...overrides,
  };
}

function makeState(overrides: Partial<WallGrabAbilityState> = {}): WallGrabAbilityState {
  return { kind: 'wallGrab', grabbing: false, side: null, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wallGrabAbility', () => {
  // -------------------------------------------------------------------------
  // Engage
  // -------------------------------------------------------------------------
  it('engages: grab held + wall on facing side + stamina > 0 → grabbing=true, side=right', () => {
    const core = makeCore({ facing: 1, vy: 200 });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, [WALL_RIGHT]),
      makeState(),
    );
    expect(r.state.grabbing).toBe(true);
    expect(r.state.side).toBe('right');
    // Cling: vy pinned to 0 (moveY=0), vx pinned to 0.
    expect(r.core.vy).toBe(0);
    expect(r.core.vx).toBe(0);
  });

  it('engages on left wall when facing left → side=left', () => {
    const core = makeCore({ facing: -1, vy: 200 });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, [WALL_LEFT]),
      makeState(),
    );
    expect(r.state.grabbing).toBe(true);
    expect(r.state.side).toBe('left');
  });

  it('engage is a no-op when grab is null/absent (grab key unmapped)', () => {
    const core = makeCore({ facing: 1, vy: 200 });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(null), GRAB_CONFIG, [WALL_RIGHT]),
      makeState(),
    );
    expect(r.state.grabbing).toBe(false);
    expect(r.core.vy).toBe(200); // unchanged — falls normally
  });

  // -------------------------------------------------------------------------
  // §0e — read wall via probeWall, NOT contacts. A body flush against the wall
  // with vx=0 still grabs (contacts would have cleared on the prior tick).
  // -------------------------------------------------------------------------
  it('engages with vx=0 via probeWall (§0e — never reads contacts)', () => {
    // Body flush against the right wall, zero horizontal velocity. The old
    // contacts-based design would have cleared rightWallId this tick (vx=0 ⇒
    // no horizontal collision) and the grab would never engage. probeWall
    // answers geometry, so the grab latches.
    const core = makeCore({ facing: 1, vx: 0, vy: 0 });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, [WALL_RIGHT]),
      makeState(),
    );
    expect(r.state.grabbing).toBe(true);
    expect(r.core.vx).toBe(0);
  });

  it('does not engage when the wall is beyond probe distance', () => {
    const farWall: Solid = { id: 'wall-r-far', x: BODY_W + 10, y: 0, width: BODY_W, height: 100 };
    const core = makeCore({ facing: 1, vy: 200 });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, [farWall]),
      makeState(),
    );
    expect(r.state.grabbing).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Climb — vy follows moveY; stamina depletes per the rates.
  // -------------------------------------------------------------------------
  it('climb up: moveY=-1 → vy=-wallClimbUpSpeed, stamina drains at up rate', () => {
    const core = makeCore({ facing: 1, vy: 0 });
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge(), idleEdge(), 0, -1), GRAB_CONFIG, [WALL_RIGHT]),
      state,
    );
    expect(r.state.grabbing).toBe(true);
    expect(r.core.vy).toBe(-GRAB_CONFIG.wallClimbUpSpeed);
    // Up-cost: staminaUpCostPerSec * dt = 45.45 * (1/60) ≈ 0.7575
    expect(r.locomotionPatch?.stamina).toBeCloseTo(
      GRAB_CONFIG.wallGrabMaxStamina - GRAB_CONFIG.staminaUpCostPerSec * DT,
      4,
    );
  });

  it('climb down: moveY=+1 → vy=+wallClimbDownSpeed, stamina does NOT drain (free)', () => {
    const core = makeCore({ facing: 1, vy: 0 });
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge(), idleEdge(), 0, 1), GRAB_CONFIG, [WALL_RIGHT]),
      state,
    );
    expect(r.state.grabbing).toBe(true);
    expect(r.core.vy).toBe(GRAB_CONFIG.wallClimbDownSpeed);
    // Descending is free (Celeste has no DownCost) — stamina patch is absent.
    expect(r.locomotionPatch).toBeUndefined();
  });

  it('cling: moveY=0 → vy=0, stamina drains at the still rate', () => {
    const core = makeCore({ facing: 1, vy: 0 });
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, [WALL_RIGHT]),
      state,
    );
    expect(r.core.vy).toBe(0);
    expect(r.locomotionPatch?.stamina).toBeCloseTo(
      GRAB_CONFIG.wallGrabMaxStamina - GRAB_CONFIG.staminaStillCostPerSec * DT,
      4,
    );
  });

  // -------------------------------------------------------------------------
  // Stamina exhaustion → forced release.
  // -------------------------------------------------------------------------
  it('stamina exhaustion releases the grab (cannot re-engage until refilled)', () => {
    const core = makeCore({ facing: 1, vy: 0 });
    // Stamina below one tick of still-cost — clinging this tick exhausts it.
    const almostEmpty = GRAB_CONFIG.staminaStillCostPerSec * DT - 0.05;
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, [WALL_RIGHT], { stamina: almostEmpty }),
      state,
    );
    expect(r.state.grabbing).toBe(false);
    expect(r.locomotionPatch?.stamina).toBe(0);
  });

  it('does not engage when stamina is already 0', () => {
    const core = makeCore({ facing: 1, vy: 200 });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, [WALL_RIGHT], { stamina: 0 }),
      makeState(),
    );
    expect(r.state.grabbing).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Release — grab let-go / wall gone / dash pressed.
  // -------------------------------------------------------------------------
  it('releases when grab is released', () => {
    const core = makeCore({ facing: 1, vy: 0 });
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(idleEdge()), GRAB_CONFIG, [WALL_RIGHT]),
      state,
    );
    expect(r.state.grabbing).toBe(false);
    expect(r.state.side).toBe(null);
    // No vy write on release — falls normally (kernel gravity owns it).
    expect(r.core.vy).toBe(0);
  });

  it('releases when the wall is gone (probeWall null)', () => {
    const core = makeCore({ facing: 1, vy: 0 });
    const state = makeState({ grabbing: true, side: 'right' });
    // No solids — wall gone.
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, []),
      state,
    );
    expect(r.state.grabbing).toBe(false);
  });

  it('releases when dash is pressed (dash takes over)', () => {
    const core = makeCore({ facing: 1, vy: 0 });
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge(), idleEdge(), 0, 0, pressEdge(true)), GRAB_CONFIG, [WALL_RIGHT]),
      state,
    );
    expect(r.state.grabbing).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Climb-hop — jump while grabbing.
  // -------------------------------------------------------------------------
  it('climb-hop: jump pressed while grabbing → LaunchIntent up+away, grab ends, stamina cost deducted', () => {
    const core = makeCore({ facing: 1, vx: 0, vy: 0 });
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge(), pressEdge(true)), GRAB_CONFIG, [WALL_RIGHT]),
      state,
    );
    // Hop launch: vy up (-climbHopVy), vx away from right wall (-climbHopVx),
    // source 'climbHop', varJumpTime 0 (fixed impulse, no variable height).
    expect(r.launch).toBeDefined();
    expect(r.launch?.source).toBe('climbHop');
    expect(r.launch?.vy).toBe(-GRAB_CONFIG.climbHopVy);
    expect(r.launch?.vx).toBe(-GRAB_CONFIG.climbHopVx);
    expect(r.launch?.varJumpTime).toBe(0);
    // Grab ends.
    expect(r.state.grabbing).toBe(false);
    // Facing flips away from the wall (left).
    expect(r.core.facing).toBe(-1);
    // Stamina cost deducted.
    expect(r.locomotionPatch?.stamina).toBe(
      GRAB_CONFIG.wallGrabMaxStamina - GRAB_CONFIG.staminaClimbJumpCost,
    );
  });

  it('climb-hop on left wall pushes right (vx positive)', () => {
    const core = makeCore({ facing: -1, vx: 0, vy: 0 });
    const state = makeState({ grabbing: true, side: 'left' });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge(), pressEdge(true)), GRAB_CONFIG, [WALL_LEFT]),
      state,
    );
    expect(r.launch?.vx).toBe(GRAB_CONFIG.climbHopVx); // away from left = rightward
    expect(r.launch?.vy).toBe(-GRAB_CONFIG.climbHopVy);
    expect(r.core.facing).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Disabled by default.
  // -------------------------------------------------------------------------
  it('OFF by default: wallGrabEnabled=false → no-op even with grab held + wall', () => {
    const core = makeCore({ facing: 1, vy: 200 });
    const state = makeState();
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), DEFAULT_PLATFORMER_CONFIG, [WALL_RIGHT]),
      state,
    );
    expect(r.state).toBe(state);
    expect(r.core).toBe(core);
    expect(r.events).toEqual({});
  });

  // -------------------------------------------------------------------------
  // Ladder priority.
  // -------------------------------------------------------------------------
  it('ladder takes priority: overlapping a ladder releases / does not engage', () => {
    const ladder: Solid = { id: 'lad', x: 0, y: 0, width: BODY_W, height: 100, ladder: true };
    const core = makeCore({ facing: 1, vy: 0 });
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, [WALL_RIGHT, ladder]),
      state,
    );
    expect(r.state.grabbing).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Purity.
  // -------------------------------------------------------------------------
  it('pure: input core is not mutated', () => {
    const core = makeCore({ facing: 1, vy: 200 });
    const state = makeState();
    const coreSnap = JSON.parse(JSON.stringify(core)) as ActorCore;
    const stateSnap = JSON.parse(JSON.stringify(state)) as WallGrabAbilityState;
    wallGrabAbility.advance(makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, [WALL_RIGHT]), state);
    expect(core).toEqual(coreSnap);
    expect(state).toEqual(stateSnap);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — through the real kernel (mode resolution, gravity skip,
// forceMoveX lockout on hop, stamina refill on ground).
// ---------------------------------------------------------------------------

describe('wallGrabAbility — kernel integration', () => {
  it('engaging claims wallGrab mode: gravity skipped (vy controlled, no fall)', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    const solids: Solid[] = [
      { id: 'wall-r', x: 32, y: 0, width: 16, height: 300 },
    ];
    // Body 16 wide at x=16 → right edge 32, flush against the wall. Airborne.
    // createPlatformerState defaults to facing=1 (right) — toward the wall.
    const state0 = createPlatformerState(16, 100, config);
    const input: PlatformerInput = { moveX: 0, moveY: 0, jump: { held: false, pressed: false, released: false }, dash: null, grab: holdEdge() };

    // Step once — grab should engage, gravity skipped, body does NOT fall.
    const { state } = stepPlatformer(state0, input, solids, DT, config);
    const wg = state.abilities['wallGrab'];
    expect(wg !== undefined && wg.kind === 'wallGrab' && wg.grabbing).toBe(true);
    // Body held at y=100 (vy=0, gravity skipped). Allow float tolerance from
    // the resolver touching the wall.
    expect(state.core.vy).toBe(0);
    expect(state.core.y).toBe(100);
  });

  it('stamina refills to max after landing on ground', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    const solids: Solid[] = [
      { id: 'floor', x: 0, y: 300, width: 400, height: 16 },
      { id: 'wall-r', x: 32, y: 0, width: 16, height: 300 },
    ];
    const initial = createPlatformerState(16, 100, config);
    // Deplete stamina partially by grabbing for a few ticks, then land and
    // confirm it refills to max.
    let state = initial;
    const grabInput: PlatformerInput = { moveX: 0, moveY: 0, jump: { held: false, pressed: false, released: false }, dash: null, grab: holdEdge() };
    for (let i = 0; i < 5; i++) {
      state = stepPlatformer(state, grabInput, solids, DT, config).state;
    }
    // While grabbing, stamina should have drained below max.
    expect(state.locomotion.stamina).toBeLessThan(config.wallGrabMaxStamina);

    // Now release the grab and let the actor fall to the floor.
    const releaseInput: PlatformerInput = { moveX: 0, moveY: 0, jump: { held: false, pressed: false, released: false }, dash: null, grab: null };
    for (let i = 0; i < 60 && !state.core.onGround; i++) {
      state = stepPlatformer(state, releaseInput, solids, DT, config).state;
    }
    expect(state.core.onGround).toBe(true);
    // Refilled to max on landing.
    expect(state.locomotion.stamina).toBe(config.wallGrabMaxStamina);
  });

  it('climb-hop applies launch + forceMoveX lockout (pushed away from wall)', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    const solids: Solid[] = [
      { id: 'wall-r', x: 32, y: 0, width: 16, height: 300 },
    ];
    // createPlatformerState defaults to facing=1 (right) — the wall is on the
    // facing side, so no facing override is needed.
    let state = createPlatformerState(16, 100, config);

    // Engage the grab first (one tick of clinging).
    const grabHold: PlatformerInput = { moveX: 0, moveY: 0, jump: { held: false, pressed: false, released: false }, dash: null, grab: holdEdge() };
    state = stepPlatformer(state, grabHold, solids, DT, config).state;
    const wgAfterEngage = state.abilities['wallGrab'];
    expect(wgAfterEngage !== undefined && wgAfterEngage.kind === 'wallGrab' && wgAfterEngage.grabbing).toBe(true);

    // Press jump while holding grab → climb-hop fires this tick.
    const hopInput: PlatformerInput = { moveX: 0, moveY: 0, jump: pressEdge(false), dash: null, grab: holdEdge() };
    state = stepPlatformer(state, hopInput, solids, DT, config).state;

    // Grab ended.
    const wg = state.abilities['wallGrab'];
    expect(wg !== undefined && wg.kind === 'wallGrab').toBe(true);
    if (wg !== undefined && wg.kind === 'wallGrab') {
      expect(wg.grabbing).toBe(false);
    }
    // The launch set vy up (-climbHopVy); the kernel then applies one tick of
    // gravity (mode is 'normal' on the hop tick, varJumpTime=0 → full gravity),
    // so the post-step vy is slightly decelerated from the raw launch impulse.
    expect(state.core.vy).toBeLessThan(0); // still rising
    expect(state.core.vy).toBeGreaterThan(-config.climbHopVy); // gravity decelerated it
    expect(state.core.vx).toBeLessThan(0); // pushed left (away from right wall)
    // forceMoveX lockout armed for climbHopForceTime, direction = away (left).
    // The kernel's decayLocomotionTimers decrements it by dt on this same tick,
    // so the observed value is climbHopForceTime - DT.
    expect(state.locomotion.forceMoveXTimer).toBeCloseTo(config.climbHopForceTime - DT, 4);
    expect(state.locomotion.forceMoveX).toBe(-1);
    // Stamina cost deducted (not refilled — airborne). The engage tick first
    // drained one tick of still-cost (cling), then the hop deducted the flat
    // climb-jump cost: max - stillCost*dt - climbJumpCost.
    expect(state.locomotion.stamina).toBeCloseTo(
      config.wallGrabMaxStamina -
        config.staminaStillCostPerSec * DT -
        config.staminaClimbJumpCost,
      4,
    );
  });

  // -------------------------------------------------------------------------
  // Wall-grab and wall-slide do not both engage.
  // -------------------------------------------------------------------------
  it('grab+held → grab (not slide); moveX-into-wall without grab → slide', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    const solids: Solid[] = [
      { id: 'wall-r', x: 32, y: 0, width: 16, height: 300 },
    ];

    // (a) Holding grab AND into the wall → wall-grab engages, wall-slide does NOT.
    let state = createPlatformerState(16, 100, config);
    const grabAndInto: PlatformerInput = { moveX: 1, moveY: 0, jump: { held: false, pressed: false, released: false }, dash: null, grab: holdEdge() };
    state = stepPlatformer(state, grabAndInto, solids, DT, config).state;
    const wg = state.abilities['wallGrab'];
    const ws = state.abilities['wallSlide'];
    expect(wg !== undefined && wg.kind === 'wallGrab' && wg.grabbing).toBe(true);
    expect(ws !== undefined && ws.kind === 'wallSlide' ? ws.sliding : false).toBe(false);

    // (b) Holding into the wall WITHOUT grab → wall-slide engages (once falling),
    // wall-grab does NOT.
    let state2 = createPlatformerState(16, 100, config);
    const intoNoGrab: PlatformerInput = { moveX: 1, moveY: 0, jump: { held: false, pressed: false, released: false }, dash: null, grab: null };
    // Fall a couple ticks so vy>0 (wall-slide needs vy>0).
    for (let i = 0; i < 3; i++) {
      state2 = stepPlatformer(state2, intoNoGrab, solids, DT, config).state;
    }
    const ws2 = state2.abilities['wallSlide'];
    const wg2 = state2.abilities['wallGrab'];
    expect(ws2 !== undefined && ws2.kind === 'wallSlide' ? ws2.sliding : false).toBe(true);
    expect(wg2 !== undefined && wg2.kind === 'wallGrab' ? wg2.grabbing : false).toBe(false);
  });
});
