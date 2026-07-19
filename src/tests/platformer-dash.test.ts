import { describe, it, expect } from 'vitest';
import { dashAbility } from '../platformer/abilities/dash-ability';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import type {
  AbilityContext,
  ActorCore,
  DashAbilityState,
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

function makeInput(dash: PolledEdge | null, moveX: -1 | 0 | 1 = 0): PlatformerInput {
  return { moveX, jump: idleEdge(), dash };
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

function makeState(overrides: Partial<DashAbilityState> = {}): DashAbilityState {
  return {
    kind: 'dash',
    timer: 0,
    cooldown: 0,
    dashesRemaining: 1,
    dirX: 0,
    dirY: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dashAbility', () => {
  it('dash starts: pressed + cooldown=0 + dashesRemaining > 0 → timer = dashDuration, dashesRemaining -= 1, dashStarted event', () => {
    const core = makeCore();
    const state = makeState({ timer: 0, cooldown: 0, dashesRemaining: 1 });
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1)), state);
    expect(r.state.timer).toBe(DEFAULT_PLATFORMER_CONFIG.dashDuration);
    expect(r.state.cooldown).toBe(DEFAULT_PLATFORMER_CONFIG.dashCooldown);
    expect(r.state.dashesRemaining).toBe(0);
    expect(r.events.dashStarted).toBe(true);
  });

  it('velocity override during dash: timer > 0 → vx/vy = dir * dashSpeed', () => {
    const core = makeCore({ vx: 50, vy: 200 });
    const state = makeState({ timer: 0.05, cooldown: 0, dashesRemaining: 0, dirX: 1, dirY: 0 });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.core.vx).toBe(DEFAULT_PLATFORMER_CONFIG.dashSpeed);
    expect(r.core.vy).toBe(0);
  });

  it('dash direction captured from moveX when non-zero', () => {
    const core = makeCore({ facing: 1 });
    const state = makeState({ timer: 0, cooldown: 0, dashesRemaining: 1 });
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), -1)), state);
    expect(r.state.dirX).toBe(-1);
    expect(r.state.dirY).toBe(0);
  });

  it('dash direction falls back to facing when moveX=0', () => {
    const core = makeCore({ facing: -1 });
    const state = makeState({ timer: 0, cooldown: 0, dashesRemaining: 1 });
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 0)), state);
    expect(r.state.dirX).toBe(-1);
  });

  it('timer decrements by dt each tick', () => {
    const core = makeCore();
    const state = makeState({ timer: 0.1, cooldown: 0, dashesRemaining: 0, dirX: 1, dirY: 0 });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.state.timer).toBeCloseTo(0.1 - DT, 6);
  });

  it('cooldown decrements by dt each tick', () => {
    const core = makeCore();
    const state = makeState({ timer: 0, cooldown: 0.5, dashesRemaining: 1 });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.state.cooldown).toBeCloseTo(0.5 - DT, 6);
  });

  it('cooldown blocks re-dash: dashesRemaining > 0 but cooldown > 0 → no new dash', () => {
    const core = makeCore();
    const state = makeState({ timer: 0, cooldown: 0.2, dashesRemaining: 1 });
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1)), state);
    expect(r.state.timer).toBe(0);
    expect(r.events.dashStarted).toBe(false);
    expect(r.state.dashesRemaining).toBe(1);
  });

  it('no dashes remaining: dashesRemaining = 0 + pressed → no dash', () => {
    const core = makeCore();
    const state = makeState({ timer: 0, cooldown: 0, dashesRemaining: 0 });
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1)), state);
    expect(r.state.timer).toBe(0);
    expect(r.events.dashStarted).toBe(false);
    expect(r.state.dashesRemaining).toBe(0);
  });

  it('refill on land: onGround + dashesRemaining < maxDashes → dashesRemaining = maxDashes', () => {
    const core = makeCore({ onGround: true });
    const state = makeState({ timer: 0, cooldown: 0, dashesRemaining: 0 });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.state.dashesRemaining).toBe(DEFAULT_PLATFORMER_CONFIG.maxDashes);
  });

  it('refill does not decrement on grounded tick when already at max', () => {
    const core = makeCore({ onGround: true });
    const state = makeState({ timer: 0, cooldown: 0, dashesRemaining: DEFAULT_PLATFORMER_CONFIG.maxDashes });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.state.dashesRemaining).toBe(DEFAULT_PLATFORMER_CONFIG.maxDashes);
  });

  it('disabled: dashEnabled=false → never dashes', () => {
    const core = makeCore();
    const state = makeState({ timer: 0, cooldown: 0, dashesRemaining: 1 });
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, dashEnabled: false };
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1), config), state);
    expect(r.state.timer).toBe(0);
    expect(r.state.dashesRemaining).toBe(1);
    expect(r.events.dashStarted).toBeUndefined();
  });

  it('disabled: returns input core and state by reference (no-op)', () => {
    const core = makeCore();
    const state = makeState({ timer: 0, cooldown: 0, dashesRemaining: 1 });
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, dashEnabled: false };
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1), config), state);
    expect(r.core).toBe(core);
    expect(r.state).toBe(state);
  });

  it('no dash input (null) → no dash even if available', () => {
    const core = makeCore();
    const state = makeState({ timer: 0, cooldown: 0, dashesRemaining: 1 });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.state.timer).toBe(0);
    expect(r.events.dashStarted).toBe(false);
  });

  it('pure: input state is not mutated', () => {
    const core = makeCore();
    const state = makeState({ timer: 0, cooldown: 0, dashesRemaining: 1 });
    const coreSnap = JSON.parse(JSON.stringify(core)) as ActorCore;
    const stateSnap = JSON.parse(JSON.stringify(state)) as DashAbilityState;
    dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1)), state);
    expect(core).toEqual(coreSnap);
    expect(state).toEqual(stateSnap);
  });

  it('pure: result core is a new reference when dash is active', () => {
    const core = makeCore({ vx: 50, vy: 200 });
    const state = makeState({ timer: 0.05, cooldown: 0, dashesRemaining: 0, dirX: 1, dirY: 0 });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.core).not.toBe(core);
  });
});
