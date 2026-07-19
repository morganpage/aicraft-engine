import { describe, it, expect } from 'vitest';
import { wallSlideAbility } from '../platformer/abilities/wall-slide-ability';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
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
// ---------------------------------------------------------------------------

function idleEdge(): PolledEdge {
  return { held: false, pressed: false, released: false };
}

function pressEdge(held = true): PolledEdge {
  return { held, pressed: true, released: false };
}

function makeInput(jump: PolledEdge, moveX: -1 | 0 | 1 = 0): PlatformerInput {
  return { moveX, jump, dash: null };
}

function makeCtx(
  core: ActorCore,
  input: PlatformerInput,
  config: PlatformerConfig = DEFAULT_PLATFORMER_CONFIG,
): AbilityContext {
  return { core, input, dt: DT, config };
}

function makeCore(overrides: Partial<ActorCore> = {}): ActorCore {
  return {
    x: 0,
    y: 50,
    width: 16,
    height: 24,
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wallSlideAbility', () => {
  it('activates: airborne + leftWallId + vy > 0 → sliding=true, side=left, startedWallSlide event', () => {
    const core = makeCore({
      vy: 200,
      contacts: {
        groundId: null,
        leftWallId: 'wall-l',
        rightWallId: null,
        ceilingId: null,
      },
    });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge())), makeState());
    expect(r.state.sliding).toBe(true);
    expect(r.state.side).toBe('left');
    expect(r.events.startedWallSlide).toBe(true);
  });

  it('activates on right wall: airborne + rightWallId → sliding=true, side=right', () => {
    const core = makeCore({
      vy: 200,
      contacts: {
        groundId: null,
        leftWallId: null,
        rightWallId: 'wall-r',
        ceilingId: null,
      },
    });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge())), makeState());
    expect(r.state.sliding).toBe(true);
    expect(r.state.side).toBe('right');
    expect(r.events.startedWallSlide).toBe(true);
  });

  it('no slide on ground: onGround=true → sliding stays false even if touching wall', () => {
    const core = makeCore({
      onGround: true,
      vy: 200,
      contacts: {
        groundId: 'floor',
        leftWallId: 'wall-l',
        rightWallId: null,
        ceilingId: null,
      },
    });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge())), makeState());
    expect(r.state.sliding).toBe(false);
    expect(r.state.side).toBe(null);
    expect(r.events.startedWallSlide).toBe(false);
  });

  it('no slide when vy <= 0: rising actor does not slide', () => {
    const core = makeCore({
      vy: -50,
      contacts: {
        groundId: null,
        leftWallId: 'wall-l',
        rightWallId: null,
        ceilingId: null,
      },
    });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge())), makeState());
    expect(r.state.sliding).toBe(false);
  });

  it('vy clamped to wallSlideSpeed while sliding', () => {
    const core = makeCore({
      vy: 500,
      contacts: {
        groundId: null,
        leftWallId: 'wall-l',
        rightWallId: null,
        ceilingId: null,
      },
    });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge())), makeState());
    expect(r.state.sliding).toBe(true);
    expect(r.core.vy).toBe(DEFAULT_PLATFORMER_CONFIG.wallSlideSpeed);
  });

  it('vy not clamped below wallSlideSpeed if already slower', () => {
    const core = makeCore({
      vy: 30,
      contacts: {
        groundId: null,
        leftWallId: 'wall-l',
        rightWallId: null,
        ceilingId: null,
      },
    });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge())), makeState());
    expect(r.state.sliding).toBe(true);
    expect(r.core.vy).toBe(30);
  });

  it('wall-jump: sliding + jump.pressed + lockTimer=0 → vx pushed away from wall, vy=wallJumpVy, lockTimer set', () => {
    const core = makeCore({
      vx: 0,
      vy: 60,
      facing: -1,
      contacts: {
        groundId: null,
        leftWallId: 'wall-l',
        rightWallId: null,
        ceilingId: null,
      },
    });
    const state = makeState({ sliding: true, side: 'left', lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true))), state);
    expect(r.core.vx).toBe(DEFAULT_PLATFORMER_CONFIG.wallJumpVx);
    expect(r.core.vy).toBe(DEFAULT_PLATFORMER_CONFIG.wallJumpVy);
    expect(r.core.facing).toBe(1);
    expect(r.events.wallJumpLaunched).toBe(true);
    expect(r.state.sliding).toBe(false);
    expect(r.state.side).toBe(null);
    expect(r.state.lockTimer).toBe(DEFAULT_PLATFORMER_CONFIG.wallJumpLockTime);
  });

  it('wall-jump on right wall: vx is negative (pushed left)', () => {
    const core = makeCore({
      vx: 0,
      vy: 60,
      facing: 1,
      contacts: {
        groundId: null,
        leftWallId: null,
        rightWallId: 'wall-r',
        ceilingId: null,
      },
    });
    const state = makeState({ sliding: true, side: 'right', lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(pressEdge(true))), state);
    expect(r.core.vx).toBe(-DEFAULT_PLATFORMER_CONFIG.wallJumpVx);
    expect(r.core.vy).toBe(DEFAULT_PLATFORMER_CONFIG.wallJumpVy);
    expect(r.core.facing).toBe(-1);
    expect(r.events.wallJumpLaunched).toBe(true);
  });

  it('wall-jump lock: lockTimer > 0 → wall-slide cannot reactivate', () => {
    const core = makeCore({
      vy: 200,
      contacts: {
        groundId: null,
        leftWallId: 'wall-l',
        rightWallId: null,
        ceilingId: null,
      },
    });
    const state = makeState({ sliding: false, side: null, lockTimer: 0.1 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge())), state);
    expect(r.state.sliding).toBe(false);
    expect(r.state.side).toBe(null);
    expect(r.events.startedWallSlide).toBe(false);
  });

  it('lock timer decrements by dt each tick', () => {
    const core = makeCore({ contacts: { groundId: null, leftWallId: null, rightWallId: null, ceilingId: null } });
    const state = makeState({ lockTimer: 0.3 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge())), state);
    expect(r.state.lockTimer).toBeCloseTo(0.3 - DT, 6);
  });

  it('lock timer floors at 0 (does not go negative)', () => {
    const core = makeCore({ contacts: { groundId: null, leftWallId: null, rightWallId: null, ceilingId: null } });
    const state = makeState({ lockTimer: 0.005 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge())), state);
    expect(r.state.lockTimer).toBe(0);
  });

  it('disabled: wallSlideEnabled=false → no-op', () => {
    const core = makeCore({
      vy: 200,
      contacts: {
        groundId: null,
        leftWallId: 'wall-l',
        rightWallId: null,
        ceilingId: null,
      },
    });
    const state = makeState({ sliding: false, side: null, lockTimer: 0 });
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallSlideEnabled: false };
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge()), config), state);
    expect(r.state).toBe(state);
    expect(r.core).toBe(core);
    expect(r.events).toEqual({});
  });

  it('pure: input core is not mutated', () => {
    const core = makeCore({
      vy: 200,
      contacts: {
        groundId: null,
        leftWallId: 'wall-l',
        rightWallId: null,
        ceilingId: null,
      },
    });
    const state = makeState();
    const coreSnap = JSON.parse(JSON.stringify(core)) as ActorCore;
    const stateSnap = JSON.parse(JSON.stringify(state)) as WallSlideAbilityState;
    wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge())), state);
    expect(core).toEqual(coreSnap);
    expect(state).toEqual(stateSnap);
  });

  it('continues sliding without re-emitting startedWallSlide event', () => {
    const core = makeCore({
      vy: 60,
      contacts: {
        groundId: null,
        leftWallId: 'wall-l',
        rightWallId: null,
        ceilingId: null,
      },
    });
    const state = makeState({ sliding: true, side: 'left', lockTimer: 0 });
    const r = wallSlideAbility.advance(makeCtx(core, makeInput(idleEdge())), state);
    expect(r.state.sliding).toBe(true);
    expect(r.events.startedWallSlide).toBe(false);
  });
});
