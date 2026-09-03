import { describe, it, expect } from 'vitest';
import { wallSlideAbility } from '../platformer/abilities/wall-slide-ability';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import { createPlatformerState } from '../platformer/kernel';
import type { Solid } from '../collision/types';
import type {
  AbilityContext,
  ActorCore,
  LocomotionState,
  PlatformerConfig,
  PlatformerInput,
  WallSlideAbilityState,
} from '../platformer/types';
import type { PolledEdge } from '../input/types';

const DT = 1 / 60;

// ---------------------------------------------------------------------------
// Fixtures
//
// Phase 0e: wall-presence detection uses `probeWall` (a geometry query against
// `ctx.solids`), NOT `core.contacts.leftWallId`/`rightWallId`. The wall solids
// below are positioned flush against the body's leading edge (gap 0, which
// `probeWall` counts as contact) with full Y-overlap, so the ability detects
// them within the default `wallProbeDistance` of 3 px.
// ---------------------------------------------------------------------------

const BODY_W = 16;
const BODY_H = 24;

/** Left wall flush against the body's left edge (body.x=0 ⇒ wall right edge at 0). */
const WALL_LEFT: Solid = { id: 'wall-l', x: -BODY_W, y: 0, width: BODY_W, height: 100 };
/** Right wall flush against the body's right edge (body.x=0, body right=16 ⇒ wall left edge at 16). */
const WALL_RIGHT: Solid = { id: 'wall-r', x: BODY_W, y: 0, width: BODY_W, height: 100 };

function idleEdge(): PolledEdge {
  return { held: false, pressed: false, released: false };
}

function pressEdge(held = true): PolledEdge {
  return { held, pressed: true, released: false };
}

function makeInput(
  jump: PolledEdge,
  moveX: -1 | 0 | 1 = 0,
  moveY: -1 | 0 | 1 = 0,
): PlatformerInput {
  return { moveX, moveY, jump, dash: null };
}

function makeCtx(
  core: ActorCore,
  input: PlatformerInput,
  config: PlatformerConfig = DEFAULT_PLATFORMER_CONFIG,
  solids: readonly Solid[] = [],
  locomotion?: LocomotionState,
): AbilityContext {
  return { core, input, dt: DT, config, solids, locomotion };
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
    contacts: {
      groundId: null,
      leftWallId: null,
      rightWallId: null,
      ceilingId: null,
    },
    ...overrides,
  };
}

function makeState(overrides: Partial<WallSlideAbilityState> = {}): WallSlideAbilityState {
  return {
    kind: 'wallSlide',
    sliding: false,
    side: null,
    lockTimer: 0,
    slideTimer: 0,
    graceTimer: 0,
    ...overrides,
  };
}

/** A real, fully-initialized `LocomotionState` (all required fields) via
 * `createPlatformerState`, with just `coyoteTimer` overridden — the field the
 * proximity-leap path reads. */
function makeLocomotion(coyoteTimer: number): LocomotionState {
  return { ...createPlatformerState(0, 0).locomotion, coyoteTimer };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wallSlideAbility', () => {
  it('activates: airborne + left wall + holding into it + vy > 0 → sliding=true, side=left, startedWallSlide event', () => {
    const core = makeCore({ vy: 200 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge(), -1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), makeState());
    expect(r.state.sliding).toBe(true);
    expect(r.state.side).toBe('left');
    expect(r.events.startedWallSlide).toBe(true);
  });

  it('activates on right wall: airborne + right wall + holding into it → sliding=true, side=right', () => {
    const core = makeCore({ vy: 200 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge(), 1), DEFAULT_PLATFORMER_CONFIG, [WALL_RIGHT]), makeState());
    expect(r.state.sliding).toBe(true);
    expect(r.state.side).toBe('right');
    expect(r.events.startedWallSlide).toBe(true);
  });

  it('no slide on ground: onGround=true → sliding stays false even with a wall and intent', () => {
    const core = makeCore({ onGround: true, vy: 200 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge(), -1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), makeState());
    expect(r.state.sliding).toBe(false);
    expect(r.state.side).toBe(null);
    expect(r.events.startedWallSlide).toBe(false);
  });

  it('no slide when vy <= 0: rising actor does not slide', () => {
    const core = makeCore({ vy: -50 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge(), -1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), makeState());
    expect(r.state.sliding).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Phase 3b — intent requirement. Celeste: slide needs `(moveX == Facing ||
  // (moveX == 0 && Grab.Check))`. Grab is reserved for Phase 6, so today slide
  // engages ONLY on explicit directional intent toward the wall. Releasing
  // (moveX=0) or holding away → no slide (fall normally).
  // -------------------------------------------------------------------------
  it('no slide without intent: wall present, moveX=0 → sliding=false (Phase 6 grab branch reserved)', () => {
    const core = makeCore({ vy: 200 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge(), 0), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), makeState());
    expect(r.state.sliding).toBe(false);
    expect(r.core.vy).toBe(200); // clamp never applied — falls normally
  });

  it('no slide when holding away from the wall (moveX toward opposite side)', () => {
    const core = makeCore({ vy: 200 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge(), 1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), makeState());
    expect(r.state.sliding).toBe(false);
    expect(r.core.vy).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Phase 4 — fast-fall suppression. Celeste `Player.cs:2933` gates slide on
  // `Input.MoveY.Value != 1`: holding DOWN suppresses wall-slide entirely so
  // the actor fast-falls past the wall instead of gripping it.
  // -------------------------------------------------------------------------
  it('fast-fall suppresses slide: wall + holding into it + moveY=1 → sliding=false', () => {
    // Same conditions as the activation test (left wall, holding left, vy>0),
    // but moveY=1 (down held). Celeste suppresses slide → the actor falls past.
    const core = makeCore({ vy: 200 });
    const r = wallSlideAbility.advance(
      makeCtx(core, makeInput(idleEdge(), -1, 1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]),
      makeState(),
    );
    expect(r.state.sliding).toBe(false);
    expect(r.state.side).toBe(null);
    expect(r.events.startedWallSlide).toBe(false);
    // Clamp never applied — falls at full vy (the kernel's fast-fall cap owns it).
    expect(r.core.vy).toBe(200);
  });

  it('fast-fall suppresses slide on right wall too (moveY=1)', () => {
    const core = makeCore({ vy: 200 });
    const r = wallSlideAbility.advance(
      makeCtx(core, makeInput(idleEdge(), 1, 1), DEFAULT_PLATFORMER_CONFIG, [WALL_RIGHT]),
      makeState(),
    );
    expect(r.state.sliding).toBe(false);
    expect(r.core.vy).toBe(200);
  });

  it('moveY=-1 (up held) does NOT suppress slide (only down does)', () => {
    // Only `moveY === 1` suppresses slide; holding up (moveY=-1) still slides.
    const core = makeCore({ vy: 200 });
    const r = wallSlideAbility.advance(
      makeCtx(core, makeInput(idleEdge(), -1, -1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]),
      makeState(),
    );
    expect(r.state.sliding).toBe(true);
    expect(r.state.side).toBe('left');
  });

  it('vy clamped to the decaying slide max on engage (eases from wallSlideStartMax toward maxFallSpeed)', () => {
    const core = makeCore({ vy: 500 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge(), -1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), makeState());
    expect(r.state.sliding).toBe(true);
    // Phase 3b: on the engage tick slideTimer=dt, so
    //   max = lerp(wallSlideStartMax, maxFallSpeed, dt/wallSlideTime)
    //       = lerp(75, 600, (1/60)/1.2) ≈ 82.291667
    // The clamp is ABOVE the old permanent wallSlideSpeed (60) and far below 500.
    expect(r.core.vy).toBeLessThan(500);
    expect(r.core.vy).toBeGreaterThan(DEFAULT_PLATFORMER_CONFIG.wallSlideStartMax);
    expect(r.core.vy).toBeCloseTo(82.291667, 4);
  });

  it('vy not clamped below the decaying slide max if already slower', () => {
    const core = makeCore({ vy: 30 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge(), -1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), makeState());
    expect(r.state.sliding).toBe(true);
    // 30 < engage-tick max (≈82), so the clamp does not apply.
    expect(r.core.vy).toBe(30);
  });

  // -------------------------------------------------------------------------
  // Direction-aware wall-jump (physics v13). The slide only stays engaged
  // while the player holds INTO the wall, so an active-slide jump press is by
  // definition into-wall → STRAIGHT UP (`vx = 0`, facing the wall — the actor
  // can chimney-climb a single wall instead of being flung off it). The
  // classic away-from-wall leap fires from the post-slide grace window
  // (`wallJumpGraceTime`, coyote-style) with neutral or away input.
  // -------------------------------------------------------------------------
  it('wall-jump (into-wall): sliding + holding into wall + jump.pressed + lockTimer=0 → STRAIGHT UP (vx=0), facing the wall', () => {
    const core = makeCore({ vx: 0, vy: 60, facing: -1 });
    const state = makeState({ sliding: true, side: 'left', lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true), -1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), state);
    // Phase 0b: wall-jump emits a LaunchIntent (kernel applies vy/vx) instead
    // of writing core.vx/core.vy directly. Facing is still set here. v13: the
    // slide gate requires into-wall input, so the launch is a straight-up hop.
    expect(r.launch).toBeDefined();
    expect(r.launch?.vy).toBe(DEFAULT_PLATFORMER_CONFIG.wallJumpVy);
    expect(r.launch?.vx).toBe(0);
    expect(r.launch?.source).toBe('wallJump');
    expect(r.core.facing).toBe(-1); // facing the LEFT wall
    expect(r.events.wallJumpLaunched).toBe(true);
    expect(r.state.sliding).toBe(false);
    expect(r.state.side).toBe(null);
    expect(r.state.lockTimer).toBe(DEFAULT_PLATFORMER_CONFIG.wallJumpLockTime);
    expect(r.state.graceTimer).toBe(0);
  });

  it('wall-jump (into-wall) on right wall: straight up, facing the right wall', () => {
    const core = makeCore({ vx: 0, vy: 60, facing: 1 });
    const state = makeState({ sliding: true, side: 'right', lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1), DEFAULT_PLATFORMER_CONFIG, [WALL_RIGHT]), state);
    expect(r.launch).toBeDefined();
    expect(r.launch?.vx).toBe(0);
    expect(r.launch?.vy).toBe(DEFAULT_PLATFORMER_CONFIG.wallJumpVy);
    expect(r.core.facing).toBe(1); // facing the RIGHT wall
    expect(r.events.wallJumpLaunched).toBe(true);
  });

  // -------------------------------------------------------------------------
  // `wallJumpAlwaysAway` opt-out (physics v15) — Celeste's actual `WallJump`
  // pushes away from the wall unconditionally, regardless of held input. With
  // the flag on, an into-wall press takes the away-leap branch instead of the
  // straight-up hop above; the grace-window leap paths are untouched either
  // way (they already fire the away leap).
  // -------------------------------------------------------------------------
  it('wall-jump (into-wall) with wallJumpAlwaysAway: true → away leap, not a straight-up hop', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallJumpAlwaysAway: true };
    const core = makeCore({ vx: 0, vy: 60, facing: -1 });
    const state = makeState({ sliding: true, side: 'left', lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true), -1), config, [WALL_LEFT]), state);
    expect(r.launch).toBeDefined();
    expect(r.launch?.vy).toBe(config.wallJumpVy);
    expect(r.launch?.vx).toBe(config.wallJumpVx); // pushed AWAY from the left wall (rightward), not 0
    expect(r.launch?.source).toBe('wallJump');
    expect(r.core.facing).toBe(1); // faces the push, not the wall
    expect(r.events.wallJumpLaunched).toBe(true);
  });

  it('wall-jump (into-wall) with wallJumpAlwaysAway: true on the right wall → pushed left', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallJumpAlwaysAway: true };
    const core = makeCore({ vx: 0, vy: 60, facing: 1 });
    const state = makeState({ sliding: true, side: 'right', lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1), config, [WALL_RIGHT]), state);
    expect(r.launch).toBeDefined();
    expect(r.launch?.vx).toBe(-config.wallJumpVx);
    expect(r.core.facing).toBe(-1);
    expect(r.events.wallJumpLaunched).toBe(true);
  });

  it('wall-jump (into-wall) with wallJumpAlwaysAway explicitly false behaves like the default (straight up)', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallJumpAlwaysAway: false };
    const core = makeCore({ vx: 0, vy: 60, facing: -1 });
    const state = makeState({ sliding: true, side: 'left', lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true), -1), config, [WALL_LEFT]), state);
    expect(r.launch?.vx).toBe(0);
    expect(r.core.facing).toBe(-1);
  });

  // -------------------------------------------------------------------------
  // `wallJumpAlwaysAway` proximity leap (physics v15) — Celeste's wall-jump
  // has no "must have been sliding" precondition: `jumpGraceTimer > 0`
  // (ground/coyote) is checked FIRST, and `WallJumpCheck(dir)` (pure
  // proximity, either side, no held-direction or vy requirement) fires only
  // once that fails. A ground jump taken beside a wall, followed by a second
  // press while still RISING and still beside it, should wall-jump away —
  // the actor never engaged `sliding` at all (`state` stays fully idle/never
  // touched: `sliding: false, side: null, graceTimer: 0`).
  // -------------------------------------------------------------------------
  it('proximity leap: never slid, rising, beside a wall, coyote expired, wallJumpAlwaysAway → away leap', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallJumpAlwaysAway: true };
    // vy < 0 = RISING (post-ground-jump ascent), not falling — the case the
    // old `sliding` gate (`core.vy > 0`) could never reach.
    const core = makeCore({ vx: 0, vy: -105, facing: 1, onGround: false });
    const state = makeState(); // never engaged the slide
    const ctx = makeCtx(core, makeInput(pressEdge(true), 0), config, [WALL_RIGHT], makeLocomotion(0));
    const r = wallSlideAbility.advance(ctx, state);
    expect(r.launch).toBeDefined();
    expect(r.launch?.vx).toBe(-config.wallJumpVx); // away from the RIGHT wall (leftward)
    expect(r.launch?.vy).toBe(config.wallJumpVy);
    expect(r.launch?.source).toBe('wallJump');
    expect(r.core.facing).toBe(-1);
    expect(r.events.wallJumpLaunched).toBe(true);
  });

  it('proximity leap: yields to an available ground/coyote jump (coyoteTimer > 0 → no launch)', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallJumpAlwaysAway: true };
    const core = makeCore({ vx: 0, vy: -105, facing: 1, onGround: false });
    const state = makeState();
    // `wallJump` outranks `jump` in launch-priority arbitration — this
    // ability MUST decline so the kernel's coyote jump wins, exactly where
    // Celeste's own `if (jumpGraceTimer > 0) Jump(); else if (...) { ... }`
    // takes the first branch.
    const ctx = makeCtx(core, makeInput(pressEdge(true), 0), config, [WALL_RIGHT], makeLocomotion(0.05));
    const r = wallSlideAbility.advance(ctx, state);
    expect(r.launch).toBeUndefined();
    expect(r.events.wallJumpLaunched).toBe(false);
  });

  it('proximity leap: does NOT fire without wallJumpAlwaysAway (v13 default requires having slid)', () => {
    const core = makeCore({ vx: 0, vy: -105, facing: 1, onGround: false });
    const state = makeState();
    const ctx = makeCtx(core, makeInput(pressEdge(true), 0), DEFAULT_PLATFORMER_CONFIG, [WALL_RIGHT], makeLocomotion(0));
    const r = wallSlideAbility.advance(ctx, state);
    expect(r.launch).toBeUndefined();
  });

  it('proximity leap: does NOT fire while grabbing (the wall-grab ability owns grab+jump)', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallJumpAlwaysAway: true };
    const core = makeCore({ vx: 0, vy: -105, facing: 1, onGround: false });
    const state = makeState();
    const input: PlatformerInput = { ...makeInput(pressEdge(true), 0), grab: pressEdge(true) };
    const ctx = makeCtx(core, input, config, [WALL_RIGHT], makeLocomotion(0));
    const r = wallSlideAbility.advance(ctx, state);
    expect(r.launch).toBeUndefined();
  });

  it('proximity leap: does NOT fire while grounded', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallJumpAlwaysAway: true };
    const core = makeCore({ vx: 0, vy: 0, facing: 1, onGround: true });
    const state = makeState();
    const ctx = makeCtx(core, makeInput(pressEdge(true), 0), config, [WALL_RIGHT], makeLocomotion(0));
    const r = wallSlideAbility.advance(ctx, state);
    expect(r.launch).toBeUndefined();
  });

  it('proximity leap on the left wall → pushed right, facing right', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallJumpAlwaysAway: true };
    const core = makeCore({ vx: 0, vy: -105, facing: -1, onGround: false });
    const state = makeState();
    const ctx = makeCtx(core, makeInput(pressEdge(true), 0), config, [WALL_LEFT], makeLocomotion(0));
    const r = wallSlideAbility.advance(ctx, state);
    expect(r.launch?.vx).toBe(config.wallJumpVx);
    expect(r.core.facing).toBe(1);
  });

  it('grace leap: slide released (neutral input) + jump within grace → away push + facing away', () => {
    // The tick after a sliding tick (direction released): grace is armed and
    // `side` is remembered. Neutral + jump → the classic away-from-wall leap.
    const core = makeCore({ vx: 0, vy: 120, facing: -1 });
    const state = makeState({ sliding: false, side: 'left', graceTimer: 0.09, lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true), 0), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), state);
    expect(r.launch).toBeDefined();
    expect(r.launch?.vx).toBe(DEFAULT_PLATFORMER_CONFIG.wallJumpVx); // away from the LEFT wall = rightward
    expect(r.launch?.vy).toBe(DEFAULT_PLATFORMER_CONFIG.wallJumpVy);
    expect(r.launch?.source).toBe('wallJump');
    expect(r.core.facing).toBe(1); // face the leap
    expect(r.events.wallJumpLaunched).toBe(true);
    expect(r.state.sliding).toBe(false);
    expect(r.state.side).toBe(null);
    expect(r.state.graceTimer).toBe(0);
    expect(r.state.lockTimer).toBe(DEFAULT_PLATFORMER_CONFIG.wallJumpLockTime);
  });

  it('grace leap: holding AWAY + jump within grace → away push (right wall → pushed left)', () => {
    const core = makeCore({ vx: 0, vy: 120, facing: 1 });
    const state = makeState({ sliding: false, side: 'right', graceTimer: 0.09, lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true), -1), DEFAULT_PLATFORMER_CONFIG, [WALL_RIGHT]), state);
    expect(r.launch).toBeDefined();
    expect(r.launch?.vx).toBe(-DEFAULT_PLATFORMER_CONFIG.wallJumpVx);
    expect(r.core.facing).toBe(-1);
    expect(r.events.wallJumpLaunched).toBe(true);
  });

  it('grace expired: jump after the window → no launch (the plain jump owns the press)', () => {
    const core = makeCore({ vx: 0, vy: 120 });
    const state = makeState({ sliding: false, side: 'left', graceTimer: 0, lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true), 0), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), state);
    expect(r.launch).toBeUndefined();
    expect(r.events.wallJumpLaunched).toBe(false);
    expect(r.state.side).toBe(null); // side cleared once the grace window is gone
  });

  it('grace + grounded: a jump on the ground within the window is NOT hijacked', () => {
    // wallJump OUTRANKS jump in launch arbitration, so the grace leap must not
    // fire while grounded — the plain ground jump would be swallowed.
    const core = makeCore({ onGround: true, vy: 0 });
    const state = makeState({ sliding: false, side: 'left', graceTimer: 0.09, lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true), 0), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), state);
    expect(r.launch).toBeUndefined();
    expect(r.events.wallJumpLaunched).toBe(false);
  });

  it('grace + grab held: the wall-grab ability owns the wall (no wallSlide launch)', () => {
    const core = makeCore({ vx: 0, vy: 120 });
    const state = makeState({ sliding: false, side: 'left', graceTimer: 0.09, lockTimer: 0 });
    const input: PlatformerInput = {
      ...makeInput(pressEdge(true), 0),
      grab: { held: true, pressed: false, released: false },
    };
    const r = wallSlideAbility.advance(makeCtx(core, input, DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), state);
    expect(r.launch).toBeUndefined();
  });

  it('grace + fast-fall (moveY=1): no grace leap (mirrors the slide suppression)', () => {
    const core = makeCore({ vx: 0, vy: 120 });
    const state = makeState({ sliding: false, side: 'left', graceTimer: 0.09, lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true), 0, 1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), state);
    expect(r.launch).toBeUndefined();
  });

  it('grace + wall gone: no leap off a wall that is no longer beside the actor', () => {
    const core = makeCore({ vx: 0, vy: 120 });
    const state = makeState({ sliding: false, side: 'left', graceTimer: 0.09, lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true), 0), DEFAULT_PLATFORMER_CONFIG, []), state);
    expect(r.launch).toBeUndefined();
    expect(r.events.wallJumpLaunched).toBe(false);
  });

  it('grace + holding INTO the wall but rising (slide cannot re-engage, vy < 0) → no launch', () => {
    // Into-wall never leaps away; when the slide also cannot re-engage (rising
    // beside the wall), the press is simply not a wall jump.
    const core = makeCore({ vx: 0, vy: -120 });
    const state = makeState({ sliding: false, side: 'left', graceTimer: 0.09, lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true), -1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), state);
    expect(r.launch).toBeUndefined();
  });

  it('grace + lockTimer > 0 → no grace leap (the lock outranks the window)', () => {
    const core = makeCore({ vx: 0, vy: 120 });
    const state = makeState({ sliding: false, side: 'left', graceTimer: 0.09, lockTimer: 0.05 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true), 0), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), state);
    expect(r.launch).toBeUndefined();
  });

  it('grace timer: armed to the full window on every sliding tick', () => {
    const core = makeCore({ vy: 60 });
    const state = makeState({ sliding: true, side: 'left', lockTimer: 0, graceTimer: 0.02 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge(), -1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), state);
    expect(r.state.sliding).toBe(true);
    expect(r.state.graceTimer).toBeCloseTo(DEFAULT_PLATFORMER_CONFIG.wallJumpGraceTime ?? 0.1, 6);
  });

  it('grace timer decays after the slide disengages; side persists through the window', () => {
    // One tick after a sliding tick (grace was armed at full): direction stays
    // released → grace decays again and the remembered side survives.
    const core = makeCore({ vy: 120 });
    const state = makeState({ sliding: false, side: 'left', graceTimer: 0.1 - DT, lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge(), 0), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), state);
    expect(r.state.sliding).toBe(false);
    expect(r.state.graceTimer).toBeCloseTo(0.1 - 2 * DT, 6);
    expect(r.state.side).toBe('left'); // remembered while grace is live
  });

  it('wall-jump lock: lockTimer > 0 → wall-slide cannot reactivate', () => {
    const core = makeCore({ vy: 200 });
    const state = makeState({ sliding: false, side: null, lockTimer: 0.1 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge(), -1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), state);
    expect(r.state.sliding).toBe(false);
    expect(r.state.side).toBe(null);
    expect(r.events.startedWallSlide).toBe(false);
  });

  it('lock timer decrements by dt each tick', () => {
    const core = makeCore();
    const state = makeState({ lockTimer: 0.3 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge()), DEFAULT_PLATFORMER_CONFIG, []), state);
    expect(r.state.lockTimer).toBeCloseTo(0.3 - DT, 6);
  });

  it('lock timer floors at 0 (does not go negative)', () => {
    const core = makeCore();
    const state = makeState({ lockTimer: 0.005 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge()), DEFAULT_PLATFORMER_CONFIG, []), state);
    expect(r.state.lockTimer).toBe(0);
  });

  it('disabled: wallSlideEnabled=false → no-op', () => {
    const core = makeCore({ vy: 200 });
    const state = makeState({ sliding: false, side: null, lockTimer: 0 });
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallSlideEnabled: false };
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge()), config, [WALL_LEFT]), state);
    expect(r.state).toBe(state);
    expect(r.core).toBe(core);
    expect(r.events).toEqual({});
  });

  it('pure: input core is not mutated', () => {
    const core = makeCore({ vy: 200 });
    const state = makeState();
    const coreSnap = JSON.parse(JSON.stringify(core)) as ActorCore;
    const stateSnap = JSON.parse(JSON.stringify(state)) as WallSlideAbilityState;
    wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge(), -1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), state);
    expect(core).toEqual(coreSnap);
    expect(state).toEqual(stateSnap);
  });

  it('continues sliding without re-emitting startedWallSlide event', () => {
    const core = makeCore({ vy: 60 });
    const state = makeState({ sliding: true, side: 'left', lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge(), -1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), state);
    expect(r.state.sliding).toBe(true);
    expect(r.events.startedWallSlide).toBe(false);
  });

  it('no wall in probe range → no slide (probeWall geometry gate)', () => {
    // A wall exists but is beyond wallProbeDistance (3 px): probeWall returns
    // null and slide does not engage, even though contacts might once have
    // reported it.
    const farWall: Solid = { id: 'wall-l-far', x: -BODY_W - 10, y: 0, width: BODY_W, height: 100 };
    const core = makeCore({ vy: 200 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge(), -1), DEFAULT_PLATFORMER_CONFIG, [farWall]), makeState());
    expect(r.state.sliding).toBe(false);
  });

  it('slide resumes the decaying timer from 0 on re-engage (reset on engage)', () => {
    // After a pause (slide stopped with intent released), re-engaging restarts
    // the slow→fast curve from wallSlideStartMax. Verifies slideTimer reset.
    const core = makeCore({ vy: 500 });
    const stale = makeState({ sliding: false, side: null, lockTimer: 0, slideTimer: 1.0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge(), -1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), stale);
    expect(r.state.sliding).toBe(true);
    expect(r.state.slideTimer).toBeCloseTo(DT, 6); // reset to 0 then +dt
  });
});
