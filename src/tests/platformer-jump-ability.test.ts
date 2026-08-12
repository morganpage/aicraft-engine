import { describe, it, expect } from 'vitest';
import { jumpAbility } from '../platformer/abilities/jump-ability';
import { createJumpState, DEFAULT_JUMP } from '../animation/jump';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import type {
  AbilityContext,
  AbilityResult,
  ActorCore,
  JumpAbilityState,
  PlatformerConfig,
  PlatformerInput,
} from '../platformer/types';
import type { PolledEdge } from '../input/types';

const DT = 1 / 60;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGroundedCore(): ActorCore {
  return {
    x: 0,
    y: 0,
    width: 16,
    height: 24,
    vx: 0,
    vy: 0,
    facing: 1,
    onGround: true,
    contacts: {
      groundId: 'floor',
      leftWallId: null,
      rightWallId: null,
      ceilingId: null,
    },
  };
}

function makeAirborneCore(vy = 100): ActorCore {
  return {
    x: 0,
    y: 50,
    width: 16,
    height: 24,
    vx: 0,
    vy,
    facing: 1,
    onGround: false,
    contacts: {
      groundId: null,
      leftWallId: null,
      rightWallId: null,
      ceilingId: null,
    },
  };
}

function makeJumpState(): JumpAbilityState {
  return { kind: 'jump', jump: createJumpState(DEFAULT_JUMP) };
}

function idleEdge(): PolledEdge {
  return { held: false, pressed: false, released: false };
}

function pressEdge(held = true): PolledEdge {
  return { held, pressed: true, released: false };
}

function heldEdge(held: boolean): PolledEdge {
  return { held, pressed: false, released: false };
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

/**
 * Step the jump ability for `n` ticks, optionally overriding core fields
 * (e.g. onGround to simulate landing mid-run). Returns the per-tick results.
 */
function runAbility(
  initialCore: ActorCore,
  initialState: JumpAbilityState,
  ticks: number,
  tickFn: (i: number) => {
    coreOverrides?: Partial<ActorCore>;
    input: PlatformerInput;
  },
): Array<AbilityResult<JumpAbilityState> & { core: ActorCore }> {
  let core = initialCore;
  let state = initialState;
  const out: Array<AbilityResult<JumpAbilityState> & { core: ActorCore }> = [];
  for (let i = 0; i < ticks; i++) {
    const { coreOverrides, input } = tickFn(i);
    if (coreOverrides) core = { ...core, ...coreOverrides };
    const result = jumpAbility.advance(makeCtx(core, input), state);
    core = result.core;
    state = result.state;
    out.push({ ...result, core });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('jumpAbility', () => {
  it('freezes core and jump state when jumpEnabled is false', () => {
    const core = makeAirborneCore(-123);
    const state = makeJumpState();
    const input = makeInput(pressEdge(true));
    const ctx = makeCtx(core, input, {
      ...DEFAULT_PLATFORMER_CONFIG,
      gravity: -980,
      jumpEnabled: false,
    });
    const snapshot = JSON.parse(JSON.stringify(ctx));
    const result = jumpAbility.advance(ctx, state);
    expect(result.core).toBe(core);
    expect(result.state).toBe(state);
    expect(result.events).toEqual({});
    expect(result.core.vy).toBe(-123);
    expect(ctx).toEqual(snapshot);
  });

  it.each([
    ['explicitly true', { ...DEFAULT_PLATFORMER_CONFIG, jumpEnabled: true }],
    [
      'omitted',
      (({ jumpEnabled: _ignored, ...config }) => config)(DEFAULT_PLATFORMER_CONFIG),
    ],
  ] as const)('preserves launch behavior when jumpEnabled is %s', (_label, config) => {
    let core = makeGroundedCore();
    let state = makeJumpState();
    let launched = false;
    let launchVy = 0;
    for (let i = 0; i < 12; i += 1) {
      const result = jumpAbility.advance(
        makeCtx(core, makeInput(i === 0 ? pressEdge(true) : heldEdge(true)), config),
        state,
      );
      core = result.core;
      state = result.state;
      launched ||= result.events.justLaunched === true;
      if (result.launch) launchVy = result.launch.vy;
    }
    expect(launched).toBe(true);
    // Phase 0b: the ability emits a LaunchIntent (negative vy) instead of
    // writing core.vy. The kernel applies the launch; here we assert the
    // intent was emitted with an upward impulse.
    expect(launchVy).toBeLessThan(0);
  });

  it('ground jump: grounded + jump.pressed → justLaunched fires on launch tick with negative vy', () => {
    const traj = runAbility(makeGroundedCore(), makeJumpState(), 12, (i) => ({
      input: makeInput(i === 0 ? pressEdge(true) : heldEdge(true)),
    }));
    const launchIdx = traj.findIndex((r) => r.events.justLaunched);
    expect(launchIdx).toBeGreaterThanOrEqual(0);
    // Phase 0b: the launch impulse is on `result.launch`, not `core.vy`.
    expect(traj[launchIdx].launch).toBeDefined();
    expect(traj[launchIdx].launch?.vy).toBeLessThan(0);
    expect(traj[launchIdx].launch?.source).toBe('jump');
    expect(traj[launchIdx].state.jump.phase).toBe('rising');
  });

  it('ground jump: first tick after press enters anticipation (no immediate launch)', () => {
    const r = jumpAbility.advance(
      makeCtx(makeGroundedCore(), makeInput(pressEdge(true))),
      makeJumpState(),
    );
    expect(r.events.justLaunched).toBe(false);
    expect(r.state.jump.phase).toBe('anticipating');
  });

  it('coyote window: airborne + coyoteTimer > 0 + jump.pressed → eventually launches', () => {
    const initial: JumpAbilityState = {
      kind: 'jump',
      jump: { ...createJumpState(DEFAULT_JUMP), phase: 'falling', coyoteTimer: 0.05 },
    };
    const traj = runAbility(makeAirborneCore(), initial, 10, () => ({
      input: makeInput(pressEdge(true)),
    }));
    // Tick 0: coyote-active + press → enters anticipation.
    expect(traj[0].state.jump.phase).toBe('anticipating');
    const launchIdx = traj.findIndex((r) => r.events.justLaunched);
    expect(launchIdx).toBeGreaterThanOrEqual(0);
    expect(traj[launchIdx].launch?.vy).toBeLessThan(0);
  });

  it('coyote expired: airborne + coyoteTimer = 0 + jump.pressed → no launch', () => {
    const initial: JumpAbilityState = {
      kind: 'jump',
      jump: { ...createJumpState(DEFAULT_JUMP), phase: 'falling', coyoteTimer: 0 },
    };
    const r = jumpAbility.advance(
      makeCtx(makeAirborneCore(), makeInput(pressEdge(true))),
      initial,
    );
    expect(r.events.justLaunched).toBe(false);
    expect(r.state.jump.phase).toBe('falling');
  });

  it('jump buffer: airborne + press sets bufferTimer; on next grounded tick → launches', () => {
    const initial: JumpAbilityState = {
      kind: 'jump',
      jump: { ...createJumpState(DEFAULT_JUMP), phase: 'falling' },
    };
    const traj = runAbility(makeAirborneCore(200), initial, 12, (i) => ({
      // Tick 0: press in air (no grounded). Tick 1: land. Tick 2+: grounded.
      coreOverrides: { onGround: i >= 1 },
      input: makeInput(i === 0 ? pressEdge(true) : heldEdge(true)),
    }));
    expect(traj[0].state.jump.jumpBufferTimer).toBe(DEFAULT_JUMP.jumpBufferTime);
    // Tick 1: landing with buffer → enters anticipation.
    expect(traj[1].state.jump.phase).toBe('anticipating');
    // Eventually launches.
    const launchIdx = traj.findIndex((r) => r.events.justLaunched);
    expect(launchIdx).toBeGreaterThanOrEqual(0);
    expect(traj[launchIdx].launch?.vy).toBeLessThan(0);
  });

  it('variable height (full): held for entire rise → reaches near-apex height', () => {
    const traj = runAbility(makeGroundedCore(), makeJumpState(), 60, (i) => ({
      input: makeInput(i === 0 ? pressEdge(true) : heldEdge(true)),
    }));
    const ys = traj.map((r) => r.state.jump.y);
    const apexY = Math.min(...ys);
    // Full hop rises to near the configured apex height.
    expect(apexY).toBeLessThan(-DEFAULT_JUMP.apexHeight * 0.7);
  });

  it('variable height (short hop): held for 1 tick then released → much lower apex', () => {
    const traj = runAbility(makeGroundedCore(), makeJumpState(), 60, (i) => ({
      // Press on tick 0 (held). Release from tick 1 onward.
      input: makeInput(i === 0 ? pressEdge(true) : heldEdge(false)),
    }));
    const ys = traj.map((r) => r.state.jump.y);
    const apexY = Math.min(...ys);
    // Short hop apex is well below full apex.
    expect(apexY).toBeGreaterThan(-DEFAULT_JUMP.apexHeight * 0.5);
  });

  it('variable height (short hop): on release tick, vy cut toward jumpCutoffFactor * launch', () => {
    // Phase trajectory: tick 0 press (anticipating), ticks 1-3 anticipation,
    // tick 4 launch (vy = launchVelocity), tick 5 release → cutoff applied.
    // Phase 0b: the ability no longer writes core.vy; the variable-height
    // cutoff is observed on the jump slice's internal pose vy (which
    // `advanceJump` still integrates for the pose). The authoritative physics
    // cutoff is verified at the kernel level (platformer-velocity-authority).
    const traj = runAbility(makeGroundedCore(), makeJumpState(), 8, (i) => ({
      input: makeInput(i === 0 ? pressEdge(true) : heldEdge(i <= 4)),
    }));
    const launchIdx = traj.findIndex((r) => r.events.justLaunched);
    expect(launchIdx).toBeGreaterThanOrEqual(0);
    const releaseIdx = launchIdx + 1;
    const launchVy = traj[launchIdx].state.jump.vy;
    const releaseVy = traj[releaseIdx].state.jump.vy;
    // After release, vy is closer to 0 than launch (cut + gravity).
    expect(Math.abs(releaseVy)).toBeLessThan(Math.abs(launchVy));
    // The cutoff value should be near launch * jumpCutoffFactor + gravity tick.
    // launch * jumpCutoffFactor (launch is negative → result less negative).
    const expectedCutVy = launchVy * DEFAULT_JUMP.jumpCutoffFactor;
    // Release vy should be at least as large (less negative) as the cut value.
    expect(releaseVy).toBeGreaterThan(expectedCutVy - 1);
  });

  it('pure: input core is not mutated', () => {
    const core = makeGroundedCore();
    const state = makeJumpState();
    const input = makeInput(pressEdge(true));
    const coreSnap = JSON.parse(JSON.stringify(core)) as ActorCore;
    const stateSnap = JSON.parse(JSON.stringify(state)) as JumpAbilityState;
    const inputSnap = JSON.parse(JSON.stringify(input)) as PlatformerInput;
    jumpAbility.advance(makeCtx(core, input), state);
    expect(core).toEqual(coreSnap);
    expect(state).toEqual(stateSnap);
    expect(input).toEqual(inputSnap);
  });

  it('pure: core is returned untouched (no velocity written — Phase 0b)', () => {
    // Phase 0b: the jump ability no longer copies core to write vy. It returns
    // the input core by reference (unchanged) and emits a LaunchIntent for the
    // kernel to apply. Purity holds: the input is never mutated.
    const core = makeGroundedCore();
    const coreBefore = JSON.parse(JSON.stringify(core)) as ActorCore;
    jumpAbility.advance(
      makeCtx(core, makeInput(pressEdge(true))),
      makeJumpState(),
    );
    expect(core).toEqual(coreBefore);
  });

  it('hitCeiling input propagates: rising state + ceilingId set → vy zeroed, phase falling', () => {
    const initial: JumpAbilityState = {
      kind: 'jump',
      jump: {
        ...createJumpState(DEFAULT_JUMP),
        phase: 'rising',
        vy: -200,
      },
    };
    const core: ActorCore = {
      ...makeAirborneCore(-200),
      contacts: {
        groundId: null,
        leftWallId: null,
        rightWallId: null,
        ceilingId: 'ceil',
      },
    };
    const r = jumpAbility.advance(makeCtx(core, makeInput(idleEdge())), initial);
    expect(r.state.jump.phase).toBe('falling');
    // Phase 0b: the ability zeroes the jump slice's internal pose vy on a
    // ceiling hit (advanceJump rising→falling). core.vy is owned by the
    // kernel; the ceiling-zeroing of core.vy happens via the collision
    // resolver at the kernel level (ry.hitCeiling → nextVy = 0).
    expect(r.state.jump.vy).toBe(0);
  });

  it('idle grounded state: no input → stays grounded, no launch', () => {
    const r = jumpAbility.advance(
      makeCtx(makeGroundedCore(), makeInput(idleEdge())),
      makeJumpState(),
    );
    expect(r.state.jump.phase).toBe('grounded');
    expect(r.events.justLaunched).toBe(false);
  });
});
