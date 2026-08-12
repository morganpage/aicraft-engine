import { describe, it, expect } from 'vitest';
import { wallSlideAbility } from '../platformer/abilities/wall-slide-ability';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import type { Solid } from '../collision/types';
import type {
  AbilityContext,
  ActorCore,
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
): AbilityContext {
  return { core, input, dt: DT, config, solids };
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
    ...overrides,
  };
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

  it('wall-jump: sliding + holding into wall + jump.pressed + lockTimer=0 → emits launch (vy/vx) + facing, lockTimer set', () => {
    const core = makeCore({ vx: 0, vy: 60, facing: -1 });
    const state = makeState({ sliding: true, side: 'left', lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true), -1), DEFAULT_PLATFORMER_CONFIG, [WALL_LEFT]), state);
    // Phase 0b: wall-jump emits a LaunchIntent (kernel applies vy/vx) instead
    // of writing core.vx/core.vy directly. Facing is still set here.
    expect(r.launch).toBeDefined();
    expect(r.launch?.vy).toBe(DEFAULT_PLATFORMER_CONFIG.wallJumpVy);
    expect(r.launch?.vx).toBe(DEFAULT_PLATFORMER_CONFIG.wallJumpVx);
    expect(r.launch?.source).toBe('wallJump');
    expect(r.core.facing).toBe(1);
    expect(r.events.wallJumpLaunched).toBe(true);
    expect(r.state.sliding).toBe(false);
    expect(r.state.side).toBe(null);
    expect(r.state.lockTimer).toBe(DEFAULT_PLATFORMER_CONFIG.wallJumpLockTime);
  });

  it('wall-jump on right wall: vx is negative (pushed left)', () => {
    const core = makeCore({ vx: 0, vy: 60, facing: 1 });
    const state = makeState({ sliding: true, side: 'right', lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1), DEFAULT_PLATFORMER_CONFIG, [WALL_RIGHT]), state);
    expect(r.launch).toBeDefined();
    expect(r.launch?.vx).toBe(-DEFAULT_PLATFORMER_CONFIG.wallJumpVx);
    expect(r.launch?.vy).toBe(DEFAULT_PLATFORMER_CONFIG.wallJumpVy);
    expect(r.core.facing).toBe(-1);
    expect(r.events.wallJumpLaunched).toBe(true);
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
