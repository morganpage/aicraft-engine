import { describe, it, expect } from 'vitest';
import { doubleJumpAbility } from '../platformer/abilities/double-jump-ability';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import { DEFAULT_JUMP } from '../animation/jump';
import type {
  AbilityContext,
  ActorCore,
  DoubleJumpAbilityState,
  PlatformerConfig,
  PlatformerInput,
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
    vy: 100,
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

function makeState(overrides: Partial<DoubleJumpAbilityState> = {}): DoubleJumpAbilityState {
  return {
    kind: 'doubleJump',
    jumpsRemaining: 1,
    ...overrides,
  };
}

function enabledConfig(maxDoubleJumps = 1): PlatformerConfig {
  return {
    ...DEFAULT_PLATFORMER_CONFIG,
    doubleJumpEnabled: true,
    maxDoubleJumps,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('doubleJumpAbility', () => {
  it('disabled: doubleJumpEnabled=false → state unchanged, no event', () => {
    const core = makeCore();
    const state = makeState({ jumpsRemaining: 1 });
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, doubleJumpEnabled: false };
    const r = doubleJumpAbility.advance(makeCtx(core, makeInput(pressEdge(true)), config), state);
    expect(r.core).toBe(core);
    expect(r.state).toBe(state);
    expect(r.events).toEqual({});
  });

  it('second jump fires: airborne + jump.pressed + jumpsRemaining > 0 → emits launch, jumpsRemaining -= 1, event', () => {
    const core = makeCore({ vy: 100 });
    const state = makeState({ jumpsRemaining: 1 });
    const expectedLaunch = -(2 * DEFAULT_JUMP.apexHeight) / DEFAULT_JUMP.timeToApex;
    const r = doubleJumpAbility.advance(
      makeCtx(core, makeInput(pressEdge(true)), enabledConfig(1)),
      state,
    );
    expect(r.state.jumpsRemaining).toBe(0);
    // Phase 0b: the impulse is emitted as a LaunchIntent (kernel applies it),
    // not written to core.vy.
    expect(r.launch).toBeDefined();
    expect(r.launch?.vy).toBeCloseTo(expectedLaunch, 5);
    expect(r.launch?.source).toBe('doubleJump');
    expect(r.events.doubleJumped).toBe(true);
  });

  it('refill on land: onGround → jumpsRemaining = maxDoubleJumps', () => {
    const core = makeCore({ onGround: true });
    const state = makeState({ jumpsRemaining: 0 });
    const r = doubleJumpAbility.advance(
      makeCtx(core, makeInput(idleEdge()), enabledConfig(2)),
      state,
    );
    expect(r.state.jumpsRemaining).toBe(2);
  });

  it('exhausted: jumpsRemaining = 0 + jump.pressed → no double jump', () => {
    const core = makeCore();
    const state = makeState({ jumpsRemaining: 0 });
    const r = doubleJumpAbility.advance(
      makeCtx(core, makeInput(pressEdge(true)), enabledConfig(1)),
      state,
    );
    expect(r.events.doubleJumped).toBe(false);
    expect(r.state.jumpsRemaining).toBe(0);
  });

  it('does not fire from ground: onGround + jump.pressed → no double jump (main jump handles)', () => {
    const core = makeCore({ onGround: true });
    const state = makeState({ jumpsRemaining: 1 });
    const r = doubleJumpAbility.advance(
      makeCtx(core, makeInput(pressEdge(true)), enabledConfig(1)),
      state,
    );
    expect(r.events.doubleJumped).toBe(false);
    // Jumps remaining refilled to max on ground tick (so a future air tick can fire).
    expect(r.state.jumpsRemaining).toBe(1);
  });

  it('no press → no double jump', () => {
    const core = makeCore();
    const state = makeState({ jumpsRemaining: 1 });
    const r = doubleJumpAbility.advance(
      makeCtx(core, makeInput(idleEdge()), enabledConfig(1)),
      state,
    );
    expect(r.events.doubleJumped).toBe(false);
    expect(r.state.jumpsRemaining).toBe(1);
  });

  it('multiple double jumps: with maxDoubleJumps=2, can fire twice before exhaust', () => {
    let core = makeCore();
    let state = makeState({ jumpsRemaining: 2 });
    const config = enabledConfig(2);

    const r1 = doubleJumpAbility.advance(makeCtx(core, makeInput(pressEdge(true)), config), state);
    expect(r1.events.doubleJumped).toBe(true);
    expect(r1.state.jumpsRemaining).toBe(1);

    core = r1.core;
    state = r1.state;
    // Edge polls are single-tick; simulate a fresh press on the next tick.
    const r2 = doubleJumpAbility.advance(makeCtx(core, makeInput(pressEdge(true)), config), state);
    expect(r2.events.doubleJumped).toBe(true);
    expect(r2.state.jumpsRemaining).toBe(0);

    core = r2.core;
    state = r2.state;
    const r3 = doubleJumpAbility.advance(makeCtx(core, makeInput(pressEdge(true)), config), state);
    expect(r3.events.doubleJumped).toBe(false);
    expect(r3.state.jumpsRemaining).toBe(0);
  });

  it('pure: input state is not mutated', () => {
    const core = makeCore();
    const state = makeState({ jumpsRemaining: 1 });
    const coreSnap = JSON.parse(JSON.stringify(core)) as ActorCore;
    const stateSnap = JSON.parse(JSON.stringify(state)) as DoubleJumpAbilityState;
    doubleJumpAbility.advance(makeCtx(core, makeInput(pressEdge(true)), enabledConfig(1)), state);
    expect(core).toEqual(coreSnap);
    expect(state).toEqual(stateSnap);
  });

  it('pure: core returned untouched + launch emitted when double jump fires (Phase 0b)', () => {
    const core = makeCore({ vy: 100 });
    const state = makeState({ jumpsRemaining: 1 });
    const r = doubleJumpAbility.advance(
      makeCtx(core, makeInput(pressEdge(true)), enabledConfig(1)),
      state,
    );
    // Phase 0b: the ability no longer writes core.vy — it emits a launch.
    expect(r.launch).toBeDefined();
    expect(r.launch?.vy).toBeLessThan(0);
  });
});
