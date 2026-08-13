import { describe, it, expect } from 'vitest';
import { wallGrabAbility } from '../platformer/abilities/wall-grab-ability';
import { findMantleRoute } from '../platformer/mantle';
import { createPlatformerState, stepPlatformer } from '../platformer/kernel';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import type { Solid } from '../collision/types';
import type {
  AbilityContext,
  ActorCore,
  LocomotionState,
  PlatformerConfig,
  PlatformerInput,
  PlatformerState,
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
  moveX: number = 0,
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
  // Climb-hop — jump while grabbing + AWAY input (the mantle wave made the
  // grab+jump direction-aware: neutral/toward now climb-JUMPS straight up, so
  // the away hop must be requested with away-signed moveX).
  // -------------------------------------------------------------------------
  it('climb-hop: jump pressed while grabbing + away input → LaunchIntent up+away, grab ends, stamina cost deducted', () => {
    const core = makeCore({ facing: 1, vx: 0, vy: 0 });
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge(), pressEdge(true), -1), GRAB_CONFIG, [WALL_RIGHT]),
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
    // The away hop arms NO re-grab lock (the forced-horizontal interval
    // supplies the separation).
    expect(r.state.regrabTimer).toBe(0);
  });

  it('climb-hop on left wall pushes right (vx positive)', () => {
    const core = makeCore({ facing: -1, vx: 0, vy: 0 });
    const state = makeState({ grabbing: true, side: 'left' });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge(), pressEdge(true), 1), GRAB_CONFIG, [WALL_LEFT]),
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
// Mantle wave — direction-aware grab+jump (Phase A). Direction is read from
// the LATCHED side (state.side), sign-based on moveX; magnitude is ignored.
// ---------------------------------------------------------------------------

describe('wallGrabAbility — direction-aware grab+jump', () => {
  it('right wall + NEUTRAL jump → straight-up climbJump: vx=0, faces the wall, re-grab lock armed', () => {
    const core = makeCore({ facing: 1, vx: 0, vy: 0 });
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge(), pressEdge(true), 0), GRAB_CONFIG, [WALL_RIGHT]),
      state,
    );
    expect(r.launch).toBeDefined();
    expect(r.launch?.source).toBe('climbJump');
    expect(r.launch?.vy).toBe(-GRAB_CONFIG.climbHopVy);
    // Straight up: horizontal velocity explicitly zero, and NO forced-move
    // window will be opened by the kernel for this source.
    expect(r.launch?.vx).toBe(0);
    expect(r.launch?.varJumpTime).toBe(0);
    // Faces the grabbed wall (right).
    expect(r.core.facing).toBe(1);
    // Grab ends + the seconds-based re-grab lock is armed.
    expect(r.state.grabbing).toBe(false);
    expect(r.state.side).toBe(null);
    expect(r.state.regrabTimer).toBe(GRAB_CONFIG.climbJumpRegrabLockTime);
    expect(r.state.mantle).toBeNull();
    // Flat stamina cost identical to the away branch.
    expect(r.locomotionPatch?.stamina).toBe(
      GRAB_CONFIG.wallGrabMaxStamina - GRAB_CONFIG.staminaClimbJumpCost,
    );
  });

  it('right wall + TOWARD jump (moveX=+1) → straight-up climbJump facing the wall', () => {
    const core = makeCore({ facing: 1, vx: 0, vy: 0 });
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge(), pressEdge(true), 1), GRAB_CONFIG, [WALL_RIGHT]),
      state,
    );
    expect(r.launch?.source).toBe('climbJump');
    expect(r.launch?.vx).toBe(0);
    expect(r.core.facing).toBe(1);
    expect(r.state.regrabTimer).toBe(GRAB_CONFIG.climbJumpRegrabLockTime);
  });

  it('left wall + NEUTRAL jump → straight-up climbJump facing LEFT (the wall)', () => {
    const core = makeCore({ facing: -1, vx: 0, vy: 0 });
    const state = makeState({ grabbing: true, side: 'left' });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge(), pressEdge(true), 0), GRAB_CONFIG, [WALL_LEFT]),
      state,
    );
    expect(r.launch?.source).toBe('climbJump');
    expect(r.launch?.vx).toBe(0);
    expect(r.launch?.vy).toBe(-GRAB_CONFIG.climbHopVy);
    // Faces the grabbed wall (left).
    expect(r.core.facing).toBe(-1);
    expect(r.state.regrabTimer).toBe(GRAB_CONFIG.climbJumpRegrabLockTime);
  });

  it('left wall + TOWARD jump (moveX=-1) → straight-up climbJump facing LEFT', () => {
    const core = makeCore({ facing: -1, vx: 0, vy: 0 });
    const state = makeState({ grabbing: true, side: 'left' });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge(), pressEdge(true), -1), GRAB_CONFIG, [WALL_LEFT]),
      state,
    );
    expect(r.launch?.source).toBe('climbJump');
    expect(r.launch?.vx).toBe(0);
    expect(r.core.facing).toBe(-1);
  });

  it('partial analog values follow SIGN, not magnitude (0.25 toward → climbJump; 0.3 away → climbHop)', () => {
    // Right wall: toward is positive, away is negative — any nonzero value
    // with the correct sign counts as directional intent.
    const core = makeCore({ facing: 1, vx: 0, vy: 0 });
    const state = makeState({ grabbing: true, side: 'right' });
    const toward = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge(), pressEdge(true), 0.25), GRAB_CONFIG, [WALL_RIGHT]),
      state,
    );
    expect(toward.launch?.source).toBe('climbJump');
    expect(toward.launch?.vx).toBe(0);
    const away = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge(), pressEdge(true), -0.3), GRAB_CONFIG, [WALL_RIGHT]),
      state,
    );
    expect(away.launch?.source).toBe('climbHop');
    expect(away.launch?.vx).toBe(-GRAB_CONFIG.climbHopVx);
  });

  it('away climb-hop keeps the existing climbHopForceTime behavior (no re-grab timer)', () => {
    const core = makeCore({ facing: 1, vx: 0, vy: 0 });
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge(), pressEdge(true), -1), GRAB_CONFIG, [WALL_RIGHT]),
      state,
    );
    expect(r.launch?.source).toBe('climbHop');
    expect(r.state.regrabTimer).toBe(0);
  });

  it('dash press wins over grab+jump (release, no launch)', () => {
    const core = makeCore({ facing: 1, vx: 0, vy: 0 });
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(
        core,
        makeInput(holdEdge(), pressEdge(true), 0, 0, pressEdge(true)),
        GRAB_CONFIG,
        [WALL_RIGHT],
      ),
      state,
    );
    expect(r.launch).toBeUndefined();
    expect(r.state.grabbing).toBe(false);
    expect(r.state.regrabTimer).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Mantle wave — ledge mantle (Phase B, ability level). The wall's TOP edge is
// the ledge; the body clings near it with the head inside the pre-emptive
// reach (wallClimbUpSpeed·dt + climbUpCheckDist + 0.5 ≈ 4.2 px at 60 Hz).
// ---------------------------------------------------------------------------

/** Ledge wall whose top edge (y=0) is the surface being mantled onto. */
const LEDGE_R: Solid = { id: 'ledge-r', x: BODY_W, y: 0, width: BODY_W, height: 100 };
/** Symmetric left-side ledge. */
const LEDGE_L: Solid = { id: 'ledge-l', x: -BODY_W, y: 0, width: BODY_W, height: 100 };
/** LDtk-style merged room-wide floor whose left face is the grabbed wall. */
const LEDGE_R_WIDE: Solid = { id: 'ledge-wide', x: BODY_W, y: 0, width: 400, height: 100 };

/** Head 2 px below the ledge lip — inside the pre-emptive reach. */
function mantleCore(overrides: Partial<ActorCore> = {}): ActorCore {
  return makeCore({ facing: 1, x: 0, y: 2, vx: 0, vy: 0, ...overrides });
}

/** Grab + Up, no jump — the mantle request. */
function mantleInput(
  moveX: number = 0,
  jump: PolledEdge = idleEdge(),
  dash: PolledEdge | null = null,
): PlatformerInput {
  return { moveX, moveY: -1, jump, dash, grab: holdEdge() };
}

/** The route-derived launch velocity, recomputed independently in the test. */
function expectedMantleLaunchVy(
  core: ActorCore,
  wall: Solid,
  config: PlatformerConfig,
  dt: number,
): number {
  const gravity =
    (2 * config.jump.apexHeight) / (config.jump.timeToApex * config.jump.timeToApex);
  const requiredRise =
    Math.max(0, core.y + core.height - wall.y) + config.mantleApexClearance;
  const clearanceVy = Math.sqrt(2 * gravity * requiredRise) + gravity * dt;
  return -Math.max(config.mantleHopVy, clearanceVy);
}

describe('wallGrabAbility — mantle', () => {
  it('mantles near the top of a clear right wall: launch + assist armed, position untouched on the start tick', () => {
    const core = mantleCore();
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, mantleInput(), GRAB_CONFIG, [LEDGE_R]),
      state,
    );
    expect(r.launch).toBeDefined();
    expect(r.launch?.source).toBe('mantle');
    // Toward-ledge horizontal velocity + the geometry-derived upward impulse.
    expect(r.launch?.vx).toBe(GRAB_CONFIG.mantleHopVx);
    expect(r.launch?.vy).toBe(expectedMantleLaunchVy(core, LEDGE_R, GRAB_CONFIG, DT));
    // The derived impulse must be able to lift the WHOLE body past the lip
    // (26 px of feet-below-top + 6 px clearance at g≈1224 ⇒ ≈-300, above the
    // 267 tuning floor).
    expect(r.launch?.vy).toBeLessThan(-GRAB_CONFIG.mantleHopVy);
    expect(r.launch?.varJumpTime).toBe(0);
    // The start tick performs NO movement: x/y unchanged.
    expect(r.core.x).toBe(core.x);
    expect(r.core.y).toBe(core.y);
    // Grab ends; assist + re-grab lock armed.
    expect(r.state.grabbing).toBe(false);
    expect(r.state.side).toBe(null);
    expect(r.state.mantle).not.toBeNull();
    expect(r.state.mantle?.side).toBe('right');
    expect(r.state.mantle?.wallTopY).toBe(0);
    // Edge-anchored finish marker: wall.x - core.width + inset = 16 - 16 + 8.
    expect(r.state.mantle?.landingX).toBe(8);
    expect(r.state.mantle?.solidId).toBe('ledge-r');
    expect(r.state.mantle?.assistTimer).toBe(GRAB_CONFIG.mantleAssistTime);
    // Re-grab lock covers at least the whole assist interval.
    expect(r.state.regrabTimer).toBe(
      Math.max(GRAB_CONFIG.climbJumpRegrabLockTime, GRAB_CONFIG.mantleAssistTime),
    );
    // Stamina is charged exactly once (the flat climb-jump cost).
    expect(r.locomotionPatch?.stamina).toBe(
      GRAB_CONFIG.wallGrabMaxStamina - GRAB_CONFIG.staminaClimbJumpCost,
    );
  });

  it('mantles symmetrically on the left wall (marker leftward, vx negative)', () => {
    const core = mantleCore({ facing: -1 });
    const state = makeState({ grabbing: true, side: 'left' });
    const r = wallGrabAbility.advance(
      makeCtx(core, mantleInput(), GRAB_CONFIG, [LEDGE_L]),
      state,
    );
    expect(r.launch?.source).toBe('mantle');
    expect(r.launch?.vx).toBe(-GRAB_CONFIG.mantleHopVx);
    expect(r.launch?.vy).toBe(expectedMantleLaunchVy(core, LEDGE_L, GRAB_CONFIG, DT));
    expect(r.state.mantle?.side).toBe('left');
    // wall.x + wall.width - inset = -16 + 16 - 8 = -8.
    expect(r.state.mantle?.landingX).toBe(-8);
    expect(r.core.facing).toBe(-1);
  });

  it('a tall wall mid-climb does NOT mantle (head below the pre-emptive reach)', () => {
    // Wall top at y=0, body head at y=50 — far outside the ≈4.2 px reach.
    const core = makeCore({ facing: 1, x: 0, y: 50, vx: 0, vy: 0 });
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, mantleInput(), GRAB_CONFIG, [LEDGE_R]),
      state,
    );
    expect(r.launch).toBeUndefined();
    expect(r.state.grabbing).toBe(true);
    expect(r.state.mantle).toBeNull();
    // Falls through to the climb branch: vy = -wallClimbUpSpeed.
    expect(r.core.vy).toBe(-GRAB_CONFIG.wallClimbUpSpeed);
  });

  it('a one-tile-thin wall mantles as soon as the head threshold is met', () => {
    // Head already AT the lip (feet 24 px below it): the route helper still
    // derives enough lift, and the 16 px-thin wall is wide enough for the
    // clamped inset foothold.
    const core = mantleCore({ y: -2 });
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, mantleInput(), GRAB_CONFIG, [LEDGE_R]),
      state,
    );
    expect(r.launch?.source).toBe('mantle');
    expect(r.launch?.vy).toBe(expectedMantleLaunchVy(core, LEDGE_R, GRAB_CONFIG, DT));
  });

  it('a wide merged solid uses the edge-relative marker — never width-proportional movement', () => {
    const core = mantleCore();
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, mantleInput(), GRAB_CONFIG, [LEDGE_R_WIDE]),
      state,
    );
    expect(r.launch?.source).toBe('mantle');
    // IDENTICAL marker + launch to the 16 px wall: the 400 px merged floor
    // width never enters the actor's movement distance.
    expect(r.state.mantle?.landingX).toBe(8);
    expect(r.launch?.vx).toBe(GRAB_CONFIG.mantleHopVx);
    expect(r.launch?.vy).toBe(expectedMantleLaunchVy(core, LEDGE_R_WIDE, GRAB_CONFIG, DT));
  });

  it('a ceiling over the starting column blocks the route (conservative decline)', () => {
    // Ceiling intersecting the rise column: body top sweeps 2 → ≈-35, so a
    // slab spanning [-30,-22] on the body's X blocks the sweep.
    const ceiling: Solid = { id: 'ceil', x: -8, y: -30, width: 32, height: 8 };
    const core = mantleCore();
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, mantleInput(), GRAB_CONFIG, [LEDGE_R, ceiling]),
      state,
    );
    expect(r.launch).toBeUndefined();
    expect(r.state.mantle).toBeNull();
    expect(r.state.grabbing).toBe(true);
  });

  it('an overhang above the ledge blocks the transition corridor', () => {
    // Overhang inside the crossing corridor (X 0→8 swept at Y bands above the
    // landing height): a slab at x∈[2,18], y∈[-30,-26] intersects it.
    const overhang: Solid = { id: 'oh', x: 2, y: -30, width: 16, height: 4 };
    const core = mantleCore();
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, mantleInput(), GRAB_CONFIG, [LEDGE_R, overhang]),
      state,
    );
    expect(r.launch).toBeUndefined();
    expect(r.state.mantle).toBeNull();
  });

  it('an occupied landing foothold blocks the mantle', () => {
    // A solid sitting ON the ledge inside the landing AABB (x∈[16,26],
    // y∈[-20,-12]) — below the corridor band, so ONLY the foothold check
    // rejects it.
    const crate: Solid = { id: 'crate', x: 16, y: -20, width: 10, height: 8 };
    const core = mantleCore();
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, mantleInput(), GRAB_CONFIG, [LEDGE_R, crate]),
      state,
    );
    expect(r.launch).toBeUndefined();
    expect(r.state.mantle).toBeNull();
  });

  it('passthrough/ladder/spring/dashRefill volumes never block a mantle route', () => {
    // Non-blocking volumes placed through the rise column + crossing corridor
    // (NOT overlapping the actor's current body — a ladder the body overlaps
    // is a real ladder and legitimately takes priority via the ladder branch).
    const nonBlocking: Solid[] = [
      { id: 'pt', x: -8, y: -30, width: 32, height: 8, passthrough: true },
      { id: 'lad', x: 2, y: -28, width: 4, height: 6, ladder: true },
      { id: 'sp', x: 6, y: -33, width: 6, height: 6, spring: { launch: -460 } },
      { id: 'rf', x: 12, y: -33, width: 6, height: 6, dashRefill: true },
    ];
    const core = mantleCore();
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, mantleInput(), GRAB_CONFIG, [LEDGE_R, ...nonBlocking]),
      state,
    );
    expect(r.launch?.source).toBe('mantle');
    expect(r.state.mantle).not.toBeNull();
  });

  it('zero stamina suppresses the mantle', () => {
    const core = mantleCore();
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, mantleInput(), GRAB_CONFIG, [LEDGE_R], { stamina: 0 }),
      state,
    );
    expect(r.launch).toBeUndefined();
    expect(r.state.grabbing).toBe(false); // exhausted release path
  });

  it('mantleEnabled: false suppresses the transition (climb continues)', () => {
    const config: PlatformerConfig = { ...GRAB_CONFIG, mantleEnabled: false };
    const core = mantleCore();
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, mantleInput(), config, [LEDGE_R]),
      state,
    );
    expect(r.launch).toBeUndefined();
    expect(r.state.mantle).toBeNull();
    expect(r.state.grabbing).toBe(true);
    // Up-climb continues instead.
    expect(r.core.vy).toBe(-config.wallClimbUpSpeed);
  });

  it('jump pressed on the mantle-eligible tick takes the JUMP path, not the mantle', () => {
    const core = mantleCore();
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, mantleInput(0, pressEdge(true)), GRAB_CONFIG, [LEDGE_R]),
      state,
    );
    expect(r.launch?.source).toBe('climbJump');
    expect(r.state.mantle).toBeNull();
    expect(r.state.regrabTimer).toBe(GRAB_CONFIG.climbJumpRegrabLockTime);
  });

  it('dash pressed on the mantle-eligible tick produces NEITHER launch', () => {
    const core = mantleCore();
    const state = makeState({ grabbing: true, side: 'right' });
    const r = wallGrabAbility.advance(
      makeCtx(core, mantleInput(0, idleEdge(), pressEdge(true)), GRAB_CONFIG, [LEDGE_R]),
      state,
    );
    expect(r.launch).toBeUndefined();
    expect(r.state.mantle).toBeNull();
    expect(r.state.grabbing).toBe(false);
  });

  it('regrabTimer > 0 blocks re-engagement while it counts down (decay preserved)', () => {
    // Not grabbing, wall present, grab held, stamina full — but the lock from
    // a recent climb-jump is still armed. Decay runs BEFORE the engage gate,
    // so a lock of 2.5·dt blocks exactly two ticks and the third may engage
    // (a non-multiple of dt avoids the float-exact zero boundary).
    const core = mantleCore({ y: 50 });
    let state: WallGrabAbilityState = makeState({
      grabbing: false,
      side: null,
      regrabTimer: 2.5 * DT,
    });
    let r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, [LEDGE_R]),
      state,
    );
    expect(r.state.grabbing).toBe(false);
    expect(r.state.regrabTimer).toBeCloseTo(1.5 * DT, 6);
    state = r.state;
    r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, [LEDGE_R]),
      state,
    );
    expect(r.state.grabbing).toBe(false);
    expect(r.state.regrabTimer).toBeCloseTo(0.5 * DT, 6);
    state = r.state;
    r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, [LEDGE_R]),
      state,
    );
    // Lock fully decayed — the engage gate opens on this same tick.
    expect(r.state.grabbing).toBe(true);
    expect(r.state.regrabTimer).toBe(0);
  });

  it('the in-flight assist re-applies ONLY toward-ledge vx and decays its timer', () => {
    const core = mantleCore({ y: 20, vy: -140 });
    const state = WallGrabAbilityStateWithMantle({
      side: 'right',
      wallTopY: 0,
      landingX: 8,
      solidId: 'ledge-r',
      assistTimer: GRAB_CONFIG.mantleAssistTime,
    });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, [LEDGE_R]),
      state,
    );
    // Toward-ledge vx re-applied…
    expect(r.core.vx).toBe(GRAB_CONFIG.mantleHopVx);
    // …vy preserved (gravity owns it)…
    expect(r.core.vy).toBe(-140);
    // …and position is NEVER written by mantle code.
    expect(r.core.x).toBe(core.x);
    expect(r.core.y).toBe(core.y);
    // Timer decayed, still in flight.
    expect(r.state.mantle?.assistTimer).toBeCloseTo(
      GRAB_CONFIG.mantleAssistTime - DT,
      6,
    );
  });

  it('reaching the finish marker ends the assist WITHOUT snapping the actor to it', () => {
    // Actor already at/past the marker (x=9 ≥ 8) mid-hop: the assist ends and
    // NO velocity or position write happens this tick.
    const core = mantleCore({ y: -10, x: 9, vx: 60, vy: -50 });
    const state = WallGrabAbilityStateWithMantle({
      side: 'right',
      wallTopY: 0,
      landingX: 8,
      solidId: 'ledge-r',
      assistTimer: 0.2,
    });
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, [LEDGE_R]),
      state,
    );
    expect(r.state.mantle).toBeNull();
    // Position + velocity untouched by the ending tick.
    expect(r.core.x).toBe(9);
    expect(r.core.vx).toBe(60);
  });

  it('landing / ceiling / dash cancel the assist and preserve the resolved position', () => {
    const assist = () =>
      WallGrabAbilityStateWithMantle({
        side: 'right',
        wallTopY: 0,
        landingX: 8,
        solidId: 'ledge-r',
        assistTimer: 0.2,
      });
    // (a) Landed (prev-tick support): assist ends, no vx write.
    const landed = wallGrabAbility.advance(
      makeCtx(mantleCore({ y: -10, x: 2, vx: 80, vy: 0, onGround: true }), makeInput(holdEdge()), GRAB_CONFIG, [LEDGE_R]),
      assist(),
    );
    expect(landed.state.mantle).toBeNull();
    expect(landed.core.vx).toBe(80);
    // (b) Ceiling bonk (prev-tick contact): assist ends.
    const bonked = wallGrabAbility.advance(
      makeCtx(
        mantleCore({
          y: -10,
          x: 2,
          vx: 80,
          contacts: { groundId: null, leftWallId: null, rightWallId: null, ceilingId: 'ceil' },
        }),
        makeInput(holdEdge()),
        GRAB_CONFIG,
        [LEDGE_R],
      ),
      assist(),
    );
    expect(bonked.state.mantle).toBeNull();
    // (c) Dash pressed: assist ends (dash takes over).
    const dashed = wallGrabAbility.advance(
      makeCtx(mantleCore({ y: -10, x: 2, vx: 80 }), makeInput(holdEdge(), idleEdge(), 0, 0, pressEdge(true)), GRAB_CONFIG, [LEDGE_R]),
      assist(),
    );
    expect(dashed.state.mantle).toBeNull();
  });

  it('the assist expires after mantleAssistTime and stops owning vx', () => {
    // Two ticks of assist left: the first applies vx and decays to one tick;
    // a tick whose remaining time cannot outlast the step (≤ dt) expires
    // WITHOUT applying — so the assist owns vx for its full remaining window
    // and then stops.
    let state: WallGrabAbilityState = WallGrabAbilityStateWithMantle({
      side: 'right',
      wallTopY: 0,
      landingX: 8,
      solidId: 'ledge-r',
      assistTimer: 2 * DT,
    });
    const core = mantleCore({ y: 20 });
    let r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, [LEDGE_R]),
      state,
    );
    expect(r.core.vx).toBe(GRAB_CONFIG.mantleHopVx);
    expect(r.state.mantle?.assistTimer).toBeCloseTo(DT, 6);
    state = r.state;
    r = wallGrabAbility.advance(
      makeCtx(mantleCore({ y: 15, x: 1, vx: 30 }), makeInput(holdEdge()), GRAB_CONFIG, [LEDGE_R]),
      state,
    );
    expect(r.state.mantle).toBeNull(); // expired
    expect(r.core.vx).toBe(30); // untouched on the expiry tick
  });

  it('ladder overlap ends the assist AND preserves the decaying re-grab lock', () => {
    const ladder: Solid = { id: 'lad', x: 0, y: -30, width: BODY_W, height: 60, ladder: true };
    const core = mantleCore({ y: -10, x: 0 });
    const state: WallGrabAbilityState = {
      kind: 'wallGrab',
      grabbing: false,
      side: null,
      regrabTimer: 0.3,
      mantle: { side: 'right', wallTopY: 0, landingX: 8, solidId: 'ledge-r', assistTimer: 0.2 },
    };
    const r = wallGrabAbility.advance(
      makeCtx(core, makeInput(holdEdge()), GRAB_CONFIG, [LEDGE_R, ladder]),
      state,
    );
    expect(r.state.mantle).toBeNull();
    // The lock survives the ladder early return (decayed, not dropped).
    expect(r.state.regrabTimer).toBeCloseTo(0.3 - DT, 6);
  });

  it('pure: mantle ticks do not mutate the input core, state, or solids', () => {
    const core = mantleCore();
    const state = makeState({ grabbing: true, side: 'right' });
    const solids: Solid[] = [LEDGE_R];
    const coreSnap = JSON.parse(JSON.stringify(core)) as ActorCore;
    const stateSnap = JSON.parse(JSON.stringify(state)) as WallGrabAbilityState;
    const solidsSnap = JSON.parse(JSON.stringify(solids)) as Solid[];
    wallGrabAbility.advance(makeCtx(core, mantleInput(), GRAB_CONFIG, solids), state);
    expect(core).toEqual(coreSnap);
    expect(state).toEqual(stateSnap);
    expect(solids).toEqual(solidsSnap);
  });
});

/** Build a non-grabbing wall-grab state with an active mantle assist. */
function WallGrabAbilityStateWithMantle(mantle: NonNullable<WallGrabAbilityState['mantle']>): WallGrabAbilityState {
  return { kind: 'wallGrab', grabbing: false, side: null, regrabTimer: 0, mantle };
}

// ---------------------------------------------------------------------------
// findMantleRoute — direct pure-geometry tests (module-private helper; NOT a
// public barrel export. It returns feasibility + launch metadata ONLY).
// ---------------------------------------------------------------------------

describe('findMantleRoute', () => {
  it('never returns a replacement actor position — metadata fields only', () => {
    const core = mantleCore();
    const route = findMantleRoute({
      core,
      wall: LEDGE_R,
      side: 'right',
      config: GRAB_CONFIG,
      dt: DT,
      solids: [LEDGE_R],
    });
    expect(route).not.toBeNull();
    // Exactly the documented metadata keys — no core/x/y position payload.
    expect(Object.keys(route as object).sort()).toEqual(
      ['landingX', 'launchVy', 'side', 'solidId', 'wallTopY'],
    );
  });

  it('returns null for non-finite / invalid geometry instead of launching', () => {
    const core = mantleCore();
    expect(
      findMantleRoute({
        core,
        wall: { ...LEDGE_R, y: Number.NaN },
        side: 'right',
        config: GRAB_CONFIG,
        dt: DT,
        solids: [LEDGE_R],
      }),
    ).toBeNull();
    expect(
      findMantleRoute({
        core,
        wall: LEDGE_R,
        side: 'right',
        config: GRAB_CONFIG,
        dt: 0,
        solids: [LEDGE_R],
      }),
    ).toBeNull();
  });

  it('declines when the head is below the pre-emptive reach (tall wall)', () => {
    const core = makeCore({ facing: 1, x: 0, y: 50, vx: 0, vy: 0 });
    expect(
      findMantleRoute({
        core,
        wall: LEDGE_R,
        side: 'right',
        config: GRAB_CONFIG,
        dt: DT,
        solids: [LEDGE_R],
      }),
    ).toBeNull();
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

    // Press jump while holding grab (AWAY — moveX=-1 for a right wall; the
    // mantle wave made neutral/toward jump straight up instead) → climb-hop.
    const hopInput: PlatformerInput = { moveX: -1, moveY: 0, jump: pressEdge(false), dash: null, grab: holdEdge() };
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

// ---------------------------------------------------------------------------
// Mantle wave — kernel integration trajectories (Phase C). Full-step
// assertions through the REAL kernel: launch arbitration, mode resolution,
// gravity, and the X/Y resolvers — the mantle's continuous hop is produced
// entirely by velocity integration + collision, never by a position write.
// ---------------------------------------------------------------------------

/** Ledge geometry for kernel tests: body 16 wide at x=16, flush wall at x=32. */
const K_LEDGE: Solid = { id: 'k-ledge', x: 32, y: 0, width: 16, height: 300 };
/** LDtk-style merged room-wide ledge (400 px wide). */
const K_LEDGE_WIDE: Solid = { id: 'k-wide', x: 32, y: 0, width: 400, height: 300 };

function wgSlice(state: PlatformerState): WallGrabAbilityState | null {
  const wg = state.abilities['wallGrab'];
  return wg !== undefined && wg.kind === 'wallGrab' ? wg : null;
}

describe('wallGrabAbility — climb-jump + mantle kernel trajectories', () => {
  it('neutral climb-jump rises straight up: vx=0, no forced-move window, re-grab only after the lock', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    const wall: Solid = { id: 'wall-r', x: 32, y: 0, width: 16, height: 300 };
    let state = createPlatformerState(16, 100, config);
    const grabHold: PlatformerInput = { moveX: 0, moveY: 0, jump: idleEdge(), dash: null, grab: holdEdge() };
    // Engage.
    state = stepPlatformer(state, grabHold, [wall], DT, config).state;
    expect(wgSlice(state)?.grabbing).toBe(true);
    // Neutral jump press while grabbing → climb-jump this tick.
    const jumpPress: PlatformerInput = { moveX: 0, moveY: 0, jump: pressEdge(true), dash: null, grab: holdEdge() };
    state = stepPlatformer(state, jumpPress, [wall], DT, config).state;
    // The straight-up pulse fired; the away pulse did not.
    expect(state.events.climbJumpLaunched).toBe(true);
    expect(state.events.wallJumpLaunched).toBe(false);
    expect(state.events.mantled).toBe(false);
    // No forced-horizontal window: Toward/neutral input can never create
    // sideways velocity through the forced-move subsystem.
    expect(state.locomotion.forceMoveXTimer).toBe(0);
    expect(state.locomotion.forceMoveX).toBe(0);
    // Straight up: vx stays 0, vy rising.
    expect(state.core.vx).toBe(0);
    expect(state.core.vy).toBeLessThan(0);
    // Re-grab lock armed for the full duration (decay starts next tick).
    expect(wgSlice(state)?.regrabTimer).toBeCloseTo(config.climbJumpRegrabLockTime, 6);

    // Rise while holding grab: the lock keeps the grab OFF for its duration…
    const yAtJump = state.core.y;
    let regrabbedTick = -1;
    for (let i = 0; i < 12; i++) {
      state = stepPlatformer(state, grabHold, [wall], DT, config).state;
      const wg = wgSlice(state);
      const lockTicks = Math.ceil(config.climbJumpRegrabLockTime / DT);
      if (i < lockTicks - 1) {
        // Still inside the lock — no re-cling (the 4 px re-cling jitter fix).
        expect(wg?.grabbing).toBe(false);
        // …and the rise is genuinely vertical (input neutral ⇒ vx 0).
        expect(state.core.vx).toBe(0);
        expect(state.locomotion.forceMoveXTimer).toBe(0);
      } else if (wg?.grabbing === true && regrabbedTick < 0) {
        regrabbedTick = i;
      }
    }
    // The actor rose (well above the jump-point y) before re-clinging.
    expect(state.core.y).toBeLessThan(yAtJump);
    // …and the grab chained again once the seconds-based lock expired.
    expect(regrabbedTick).toBeGreaterThan(0);
    expect(wgSlice(state)?.grabbing).toBe(true);
  });

  it('away climb-hop emits the WIDENED wallJumpLaunched pulse, not climbJumpLaunched, and keeps the forced push', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    const wall: Solid = { id: 'wall-r', x: 32, y: 0, width: 16, height: 300 };
    let state = createPlatformerState(16, 100, config);
    const grabHold: PlatformerInput = { moveX: 0, moveY: 0, jump: idleEdge(), dash: null, grab: holdEdge() };
    state = stepPlatformer(state, grabHold, [wall], DT, config).state;
    const awayJump: PlatformerInput = { moveX: -1, moveY: 0, jump: pressEdge(true), dash: null, grab: holdEdge() };
    state = stepPlatformer(state, awayJump, [wall], DT, config).state;
    // Deliberate widening: the away hop reports as a wall jump.
    expect(state.events.wallJumpLaunched).toBe(true);
    expect(state.events.climbJumpLaunched).toBe(false);
    // Keeps the existing away trajectory: pushed left + forced-window armed.
    expect(state.core.vx).toBeLessThan(0);
    expect(state.locomotion.forceMoveXTimer).toBeCloseTo(config.climbHopForceTime - DT, 4);
    expect(state.locomotion.forceMoveX).toBe(-1);
    // No re-grab lock on the away branch (the forced window separates).
    expect(wgSlice(state)?.regrabTimer).toBe(0);
  });

  it('mantle: rises beside the wall over many ticks, crosses only after the feet clear, lands on the ledge — no snap', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    let state = createPlatformerState(16, 2, config);
    const grabHold: PlatformerInput = { moveX: 0, moveY: 0, jump: idleEdge(), dash: null, grab: holdEdge() };
    const grabUp: PlatformerInput = { moveX: 0, moveY: -1, jump: idleEdge(), dash: null, grab: holdEdge() };
    const released: PlatformerInput = { moveX: 0, moveY: 0, jump: idleEdge(), dash: null, grab: idleEdge() };
    // Engage (cling at y=2, head within the pre-emptive reach of the lip).
    state = stepPlatformer(state, grabHold, [K_LEDGE], DT, config).state;
    expect(wgSlice(state)?.grabbing).toBe(true);
    // Grab + Up → mantle launch tick.
    state = stepPlatformer(state, grabUp, [K_LEDGE], DT, config).state;
    expect(state.events.mantled).toBe(true);
    expect(state.events.climbJumpLaunched).toBe(false);
    expect(state.events.justLaunched).toBe(false); // not reported as a normal jump
    const wgLaunch = wgSlice(state);
    expect(wgLaunch?.grabbing).toBe(false);
    expect(wgLaunch?.mantle).not.toBeNull();
    expect(wgLaunch?.mantle?.landingX).toBe(24); // 32 - 16 + 8 (edge-anchored)
    // The launch tick moved the actor ONLY by velocity·dt (X pinned by the
    // resolver beside the wall; Y one integrated step): no destination snap.
    expect(state.core.x).toBe(16);
    expect(state.core.y).toBeGreaterThan(-6);
    expect(state.core.y).toBeLessThan(2);

    // Fly the hop: release grab, let the assist + gravity + resolvers work.
    const startX = 16;
    let crossedTick = -1;
    let landedTick = -1;
    let mantledPulses = 1; // the launch tick above
    const maxYPerTick = config.maxFallSpeed * DT + 0.5;
    const maxXPerTick = config.mantleHopVx * DT + 0.5;
    let prevX = state.core.x;
    let prevY = state.core.y;
    let riseTicksWhilePinned = 0;
    for (let i = 0; i < 60 && landedTick < 0; i++) {
      state = stepPlatformer(state, released, [K_LEDGE], DT, config).state;
      if (state.events.mantled) mantledPulses++;
      // Per-tick displacement is bounded by integrated velocity + the
      // resolver's normal contact correction — no discontinuity anywhere.
      expect(Math.abs(state.core.x - prevX)).toBeLessThanOrEqual(maxXPerTick);
      expect(Math.abs(state.core.y - prevY)).toBeLessThanOrEqual(maxYPerTick);
      if (state.core.x === startX) {
        // Pinned beside the wall — must still be rising.
        expect(state.core.y).toBeLessThan(prevY);
        riseTicksWhilePinned++;
      }
      if (crossedTick < 0 && state.core.x > startX) {
        crossedTick = i;
        // Crossed the lip ONLY after the feet cleared the wall top.
        expect(state.core.y + state.core.height).toBeLessThanOrEqual(0);
      }
      if (state.core.onGround && state.core.contacts.groundId === 'k-ledge') {
        landedTick = i;
      }
      prevX = state.core.x;
      prevY = state.core.y;
    }
    // The hop was continuous and multi-tick, in both phases.
    expect(riseTicksWhilePinned).toBeGreaterThanOrEqual(5);
    expect(crossedTick).toBeGreaterThanOrEqual(4);
    expect(landedTick).toBeGreaterThan(crossedTick);
    // Landed ON TOP of the ledge with the correct ground contact id.
    expect(state.core.onGround).toBe(true);
    expect(state.core.contacts.groundId).toBe('k-ledge');
    expect(state.core.y).toBeCloseTo(-state.core.height, 5); // feet on the lip
    // The actor stopped near the edge-anchored marker — never snapped, and
    // never carried proportionally to the wall's width.
    expect(Math.abs(state.core.x - 24)).toBeLessThanOrEqual(5); // marker-bounded drift: < ~2 ticks of residual vx
    // The pulse lasted exactly one tick.
    expect(mantledPulses).toBe(1);
    // The assist record is gone once the hop resolved.
    expect(wgSlice(state)?.mantle).toBeNull();
  });

  it('a wide merged ledge finishes at the same edge-relative marker (movement never scales with width)', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    let state = createPlatformerState(16, 2, config);
    const grabHold: PlatformerInput = { moveX: 0, moveY: 0, jump: idleEdge(), dash: null, grab: holdEdge() };
    const grabUp: PlatformerInput = { moveX: 0, moveY: -1, jump: idleEdge(), dash: null, grab: holdEdge() };
    const released: PlatformerInput = { moveX: 0, moveY: 0, jump: idleEdge(), dash: null, grab: idleEdge() };
    state = stepPlatformer(state, grabHold, [K_LEDGE_WIDE], DT, config).state;
    state = stepPlatformer(state, grabUp, [K_LEDGE_WIDE], DT, config).state;
    expect(state.events.mantled).toBe(true);
    expect(wgSlice(state)?.mantle?.landingX).toBe(24);
    for (let i = 0; i < 60 && !(state.core.onGround && state.core.contacts.groundId === 'k-wide'); i++) {
      state = stepPlatformer(state, released, [K_LEDGE_WIDE], DT, config).state;
    }
    expect(state.core.contacts.groundId).toBe('k-wide');
    // Edge-relative finish: ≈24 — the 400 px merged width contributed NOTHING
    // to the actor's travel.
    expect(Math.abs(state.core.x - 24)).toBeLessThanOrEqual(5); // marker-bounded drift: < ~2 ticks of residual vx
    expect(state.core.x).toBeLessThan(32);
  });

  it('a dash mid-mantle cancels the assist and keeps dash priority (position continues physically)', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    let state = createPlatformerState(16, 2, config);
    const grabHold: PlatformerInput = { moveX: 0, moveY: 0, jump: idleEdge(), dash: null, grab: holdEdge() };
    const grabUp: PlatformerInput = { moveX: 0, moveY: -1, jump: idleEdge(), dash: null, grab: holdEdge() };
    const released: PlatformerInput = { moveX: 0, moveY: 0, jump: idleEdge(), dash: null, grab: idleEdge() };
    state = stepPlatformer(state, grabHold, [K_LEDGE], DT, config).state;
    state = stepPlatformer(state, grabUp, [K_LEDGE], DT, config).state;
    expect(state.events.mantled).toBe(true);
    // Three assist ticks, then dash toward the ledge.
    for (let i = 0; i < 3; i++) {
      state = stepPlatformer(state, released, [K_LEDGE], DT, config).state;
    }
    const dashInput: PlatformerInput = { moveX: 1, moveY: 0, jump: idleEdge(), dash: pressEdge(true), grab: idleEdge() };
    const prevX = state.core.x;
    const prevY = state.core.y;
    state = stepPlatformer(state, dashInput, [K_LEDGE], DT, config).state;
    // Dash took over (startup freeze this tick)…
    const dash = state.abilities['dash'];
    expect(dash !== undefined && dash.kind === 'dash' ? dash.phase : 'idle').not.toBe('idle');
    expect(state.events.dashStarting).toBe(true);
    // …the assist was cancelled…
    expect(wgSlice(state)?.mantle).toBeNull();
    // …and the position moved only by that tick's physics (freeze ⇒ pinned).
    expect(Math.abs(state.core.x - prevX)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(state.core.y - prevY)).toBeLessThanOrEqual(0.5);
  });

  it('30/60/120 Hz fixed steps agree qualitatively (duration-based, same outcome)', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    const runAt = (dt: number, steps: number) => {
      let state = createPlatformerState(16, 2, config);
      const grabHold: PlatformerInput = { moveX: 0, moveY: 0, jump: idleEdge(), dash: null, grab: holdEdge() };
      const grabUp: PlatformerInput = { moveX: 0, moveY: -1, jump: idleEdge(), dash: null, grab: holdEdge() };
      const released: PlatformerInput = { moveX: 0, moveY: 0, jump: idleEdge(), dash: null, grab: idleEdge() };
      state = stepPlatformer(state, grabHold, [K_LEDGE], dt, config).state;
      state = stepPlatformer(state, grabUp, [K_LEDGE], dt, config).state;
      const mantled = state.events.mantled;
      for (let i = 0; i < steps; i++) {
        state = stepPlatformer(state, released, [K_LEDGE], dt, config).state;
      }
      return { mantled, state };
    };
    for (const [dt, steps] of [
      [1 / 30, 30],
      [1 / 60, 60],
      [1 / 120, 120],
    ] as const) {
      const { mantled, state } = runAt(dt, steps);
      expect(mantled).toBe(true);
      // Same qualitative outcome at every fixed-step rate: landed on the ledge
      // top, standing at the edge-anchored marker.
      expect(state.core.onGround).toBe(true);
      expect(state.core.contacts.groundId).toBe('k-ledge');
      expect(state.core.y).toBeCloseTo(-24, 4);
      expect(Math.abs(state.core.x - 24)).toBeLessThanOrEqual(5);
    }
  });
});
