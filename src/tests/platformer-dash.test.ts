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

function makeInput(
  dash: PolledEdge | null,
  moveX: -1 | 0 | 1 = 0,
  moveY: -1 | 0 | 1 = 0,
): PlatformerInput {
  return { moveX, moveY, jump: idleEdge(), dash };
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

/**
 * Default dash state: idle, full budget, zero timers. Tests override only the
 * fields relevant to the scenario. The new Phase 2b fields (`phase`,
 * `startupTimer`, `beforeDashVx`) default to their idle values.
 */
function makeState(overrides: Partial<DashAbilityState> = {}): DashAbilityState {
  return {
    kind: 'dash',
    phase: 'idle',
    startupTimer: 0,
    timer: 0,
    cooldown: 0,
    dashesRemaining: 1,
    dirX: 0,
    dirY: 0,
    beforeDashVx: 0,
    dashStartedOnGround: false,
    hyperSlide: false,
    ...overrides,
  };
}

/**
 * Advance the dash ability through its startup freeze until the tick it
 * transitions to `'active'` (i.e. the tick `dashStarted` fires and velocity is
 * applied). Returns each per-tick result so tests can assert the freeze
 * mid-flight. Stops after `maxTicks` advances to avoid an infinite loop on a
 * logic regression.
 *
 * The first advance uses `pressInput` (the dash press); every subsequent
 * advance uses `noPressInput` (dash held released / null) so only the startup
 * countdown drives the transition.
 */
function advanceThroughStartup(
  core: ActorCore,
  state: DashAbilityState,
  pressInput: PlatformerInput,
  noPressInput: PlatformerInput,
  ctxConfig: PlatformerConfig = DEFAULT_PLATFORMER_CONFIG,
): { steps: Array<{ core: ActorCore; state: DashAbilityState; events: Record<string, unknown> }> } {
  const steps: Array<{ core: ActorCore; state: DashAbilityState; events: Record<string, unknown> }> = [];
  let currentCore = core;
  let currentState = state;
  const maxTicks = 20;
  for (let i = 0; i < maxTicks; i++) {
    const input = i === 0 ? pressInput : noPressInput;
    const r = dashAbility.advance(makeCtx(currentCore, input, ctxConfig), currentState);
    currentCore = r.core;
    currentState = r.state;
    steps.push({ core: r.core, state: r.state, events: r.events as Record<string, unknown> });
    if (currentState.phase === 'active') break;
  }
  return { steps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// Phase 2b rebaseline: the dash is now a three-phase state machine
// (idle → startup → active). On a dash PRESS the dash enters `'startup'` and
// FREEZES the actor (vx=vy=0) for `config.dashStartupTime`; `dashStarting`
// fires on that press tick. The dash velocity is applied (and `dashStarted`
// fires) only on the tick the startup timer elapses — NOT on the press tick.
// The press-tick assertions below were re-baselined accordingly.
describe('dashAbility', () => {
  it('press enters startup (freeze): phase=startup, dashStarting=true, dashStarted=false, velocity ZEROED, budget+cooldown consumed', () => {
    // BEFORE: a press set timer=dashDuration and emitted dashStarted on the
    // same tick. NOW: the press enters the freeze — no dash velocity, no
    // dashStarted yet; dashStarting marks the freeze entry.
    const core = makeCore({ vx: 123, vy: -200 });
    const state = makeState({ phase: 'idle', cooldown: 0, dashesRemaining: 1 });
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1)), state);

    // Phase machine: entered startup, NOT active.
    expect(r.state.phase).toBe('startup');
    expect(r.state.timer).toBe(0); // active timer not set until startup ends
    // startupTimer = dashStartupTime - dt (one tick elapsed this advance).
    expect(r.state.startupTimer).toBeCloseTo(DEFAULT_PLATFORMER_CONFIG.dashStartupTime - DT, 6);

    // Budget + cooldown consumed on the press tick (unchanged from legacy).
    expect(r.state.cooldown).toBe(DEFAULT_PLATFORMER_CONFIG.dashCooldown);
    expect(r.state.dashesRemaining).toBe(0);

    // Direction captured at press.
    expect(r.state.dirX).toBe(1);
    expect(r.state.dirY).toBe(0);

    // beforeDashVx captured for the same-direction preservation rule.
    expect(r.state.beforeDashVx).toBe(123);

    // Events: dashStarting fired, dashStarted did NOT (the freeze, not motion).
    expect(r.events.dashStarting).toBe(true);
    expect(r.events.dashStarted).toBe(false);

    // The freeze: core velocity pinned to zero on the press tick.
    expect(r.core.vx).toBe(0);
    expect(r.core.vy).toBe(0);
  });

  it('(a) actor stays FROZEN at zero velocity for the whole startup duration', () => {
    // dashStartupTime = 0.05s, DT = 1/60 → the freeze is visible for 3 ticks
    // (the press tick + 2 more) before the startup→active transition fires.
    const core = makeCore({ vx: 300, vy: 50 });
    const state = makeState({ phase: 'idle', cooldown: 0, dashesRemaining: 1 });
    const { steps } = advanceThroughStartup(
      core,
      state,
      makeInput(pressEdge(true), 1),
      makeInput(null, 1),
    );

    // The press tick (index 0) froze the actor.
    expect(steps[0].core.vx).toBe(0);
    expect(steps[0].core.vy).toBe(0);
    expect(steps[0].events.dashStarting).toBe(true);

    // Every tick strictly before the transition keeps velocity at zero and
    // does NOT emit dashStarted.
    for (let i = 0; i < steps.length - 1; i++) {
      expect(steps[i].state.phase).toBe('startup');
      expect(steps[i].core.vx).toBe(0);
      expect(steps[i].core.vy).toBe(0);
      expect(steps[i].events.dashStarted).toBe(false);
    }

    // 0.05s @ 60Hz ⇒ 3 frozen ticks (press + 2), transition on the 4th advance
    // (the residual float in startupTimer after 3 decrements needs one more
    // tick to cross zero). Assert the freeze spanned exactly 3 ticks.
    expect(steps.length).toBe(4);
  });

  it('(b) after dashStartupTime: dashStarted=true and core.vx === dirX * dashSpeed', () => {
    const core = makeCore({ vx: 0, vy: 0 });
    const state = makeState({ phase: 'idle', cooldown: 0, dashesRemaining: 1 });
    const { steps } = advanceThroughStartup(
      core,
      state,
      makeInput(pressEdge(true), 1),
      makeInput(null, 1),
    );

    // The final step is the startup→active transition tick.
    const transition = steps[steps.length - 1];
    expect(transition.state.phase).toBe('active');
    expect(transition.events.dashStarted).toBe(true);
    // dashStarting is NOT re-fired on the transition tick (it only fires on
    // the press tick).
    expect(transition.events.dashStarting).toBe(false);
    // Dash velocity now applies: vx = dirX * dashSpeed, vy = dirY * dashSpeed
    // (this is a horizontal dash — no moveY ⇒ dirY = 0 ⇒ vy = 0).
    expect(transition.core.vx).toBe(DEFAULT_PLATFORMER_CONFIG.dashSpeed);
    expect(transition.core.vy).toBe(0);
    // The active timer is initialized to dashDuration on the transition tick.
    expect(transition.state.timer).toBe(DEFAULT_PLATFORMER_CONFIG.dashDuration);
  });

  it('(c) same-direction preservation: faster pre-dash vx is kept (dash never slows you)', () => {
    // Pre-dash vx (500) > dashSpeed (420), same direction (right). The dash
    // must NOT slow the actor: post-startup vx === 500 (the captured
    // beforeDashVx), not the slower dashSpeed.
    const fasterThanDash = DEFAULT_PLATFORMER_CONFIG.dashSpeed + 80;
    const core = makeCore({ vx: fasterThanDash, vy: 0, facing: 1 });
    const state = makeState({ phase: 'idle', cooldown: 0, dashesRemaining: 1 });
    const { steps } = advanceThroughStartup(
      core,
      state,
      makeInput(pressEdge(true), 1),
      makeInput(null, 1),
    );

    const transition = steps[steps.length - 1];
    expect(transition.state.beforeDashVx).toBe(fasterThanDash);
    // [C: Celeste Player.cs:3557] Preserved, not slowed:
    expect(transition.core.vx).toBe(fasterThanDash);
    expect(transition.core.vx).not.toBe(DEFAULT_PLATFORMER_CONFIG.dashSpeed);

    // The preserved faster speed survives into the sustained active phase (the
    // "never slows you" invariant holds for the whole dash, not one tick).
    const activeTick = dashAbility.advance(
      makeCtx(transition.core, makeInput(null, 1)),
      transition.state,
    );
    expect(activeTick.core.vx).toBe(fasterThanDash);
  });

  it('(d) opposite-direction dash OVERRIDES (sets core.vx = -dashSpeed)', () => {
    // Pre-dash vx is large and positive (moving right); the dash goes LEFT.
    // Signs differ ⇒ no preservation ⇒ the dash overrides to -dashSpeed.
    const core = makeCore({ vx: 500, vy: 0, facing: 1 });
    const state = makeState({ phase: 'idle', cooldown: 0, dashesRemaining: 1 });
    const { steps } = advanceThroughStartup(
      core,
      state,
      makeInput(pressEdge(true), -1),
      makeInput(null, -1),
    );

    const transition = steps[steps.length - 1];
    expect(transition.state.dirX).toBe(-1);
    expect(transition.state.beforeDashVx).toBe(500);
    // Overridden to the dash speed in the dash direction (negative), NOT the
    // captured +500 and NOT a preserved magnitude.
    expect(transition.core.vx).toBe(-DEFAULT_PLATFORMER_CONFIG.dashSpeed);
  });

  it('velocity override during active: phase=active, timer>0 → vx/vy = dir * dashSpeed', () => {
    // Re-baselined: the active branch only runs when phase === 'active'
    // (timer > 0 alone is no longer sufficient — timer is only meaningful in
    // the active phase).
    const core = makeCore({ vx: 50, vy: 200 });
    const state = makeState({
      phase: 'active',
      timer: 0.05,
      cooldown: 0,
      dashesRemaining: 0,
      dirX: 1,
      dirY: 0,
    });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.core.vx).toBe(DEFAULT_PLATFORMER_CONFIG.dashSpeed);
    expect(r.core.vy).toBe(0);
  });

  it('dash direction captured from moveX when non-zero', () => {
    const core = makeCore({ facing: 1 });
    const state = makeState({ phase: 'idle', cooldown: 0, dashesRemaining: 1 });
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), -1)), state);
    expect(r.state.dirX).toBe(-1);
    expect(r.state.dirY).toBe(0);
  });

  it('dash direction falls back to facing when moveX=0', () => {
    const core = makeCore({ facing: -1 });
    const state = makeState({ phase: 'idle', cooldown: 0, dashesRemaining: 1 });
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 0)), state);
    expect(r.state.dirX).toBe(-1);
  });

  it('active timer decrements by dt each active tick', () => {
    const core = makeCore();
    const state = makeState({
      phase: 'active',
      timer: 0.1,
      cooldown: 0,
      dashesRemaining: 0,
      dirX: 1,
      dirY: 0,
    });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.state.timer).toBeCloseTo(0.1 - DT, 6);
    expect(r.state.phase).toBe('active');
  });

  it('active → idle transition: when timer reaches 0, phase returns to idle', () => {
    const core = makeCore();
    const state = makeState({
      phase: 'active',
      timer: DT, // one more tick of active
      cooldown: 0,
      dashesRemaining: 0,
      dirX: 1,
      dirY: 0,
    });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.state.timer).toBe(0);
    expect(r.state.phase).toBe('idle');
  });

  it('cooldown decrements by dt each tick (regardless of phase)', () => {
    const core = makeCore();
    const state = makeState({ phase: 'idle', timer: 0, cooldown: 0.5, dashesRemaining: 1 });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.state.cooldown).toBeCloseTo(0.5 - DT, 6);
  });

  it('cooldown blocks re-dash: phase=idle, cooldown>0, press → no new dash', () => {
    const core = makeCore();
    const state = makeState({ phase: 'idle', timer: 0, cooldown: 0.2, dashesRemaining: 1 });
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1)), state);
    expect(r.state.phase).toBe('idle');
    expect(r.state.startupTimer).toBe(0);
    expect(r.state.timer).toBe(0);
    expect(r.events.dashStarting).toBe(false);
    expect(r.events.dashStarted).toBe(false);
    expect(r.state.dashesRemaining).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Physics v16: dashCooldown corrected 0.3 → 0.2 (Celeste `DashCooldown =
  // .2f`, `Player.cs:79`). A dash-refill crystal only restores
  // `dashesRemaining` — Celeste's own `RefillDash()` (`Player.cs:2002-2010`)
  // never touches the cooldown timer either — so a full charge from a
  // crystal does NOT bypass a cooldown still running from the actor's last
  // dash press. This is genuine Celeste behavior, not a bug; the v16 fix was
  // that the old 0.3s window was 50% wider than Celeste's, not that the gate
  // itself is wrong.
  // -------------------------------------------------------------------------
  it('dashCooldown matches Celeste (0.2s) — the old default was an uncited 0.3', () => {
    expect(DEFAULT_PLATFORMER_CONFIG.dashCooldown).toBe(0.2);
  });

  it('a dash-refill crystal restoring dashesRemaining does NOT reset the cooldown — a full-charge press mid-cooldown still fails', () => {
    const core = makeCore();
    // Simulates the tick right after a crystal overlap: full budget, but the
    // cooldown from the actor's OWN last dash press is still running (the
    // kernel's dash-refill detection only ever writes `dashesRemaining`).
    const state = makeState({ phase: 'idle', timer: 0, cooldown: 0.05, dashesRemaining: 1 });
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1)), state);
    expect(r.state.phase).toBe('idle');
    expect(r.events.dashStarting).toBe(false);
    expect(r.state.dashesRemaining).toBe(1); // untouched — the press never consumed it
  });

  it('...but the SAME full-charge press succeeds the instant the cooldown clears', () => {
    const core = makeCore();
    const state = makeState({ phase: 'idle', timer: 0, cooldown: 0, dashesRemaining: 1 });
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1)), state);
    expect(r.state.phase).toBe('startup');
    expect(r.events.dashStarting).toBe(true);
    expect(r.state.dashesRemaining).toBe(0);
  });

  it('startup blocks re-press: phase=startup, press → no second dash', () => {
    // While in the freeze, a second press must NOT start another dash (the
    // phase guard, not just cooldown, prevents it).
    const core = makeCore();
    const state = makeState({
      phase: 'startup',
      startupTimer: 0.03,
      timer: 0,
      cooldown: 0.2,
      dashesRemaining: 1,
      dirX: 1,
      dirY: 0,
      beforeDashVx: 0,
    });
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1)), state);
    // Still in the same startup (no second dash consumed, no dashStarting).
    expect(r.state.phase).toBe('startup');
    expect(r.state.dashesRemaining).toBe(1);
    expect(r.events.dashStarting).toBe(false);
  });

  it('no dashes remaining: dashesRemaining = 0 + pressed → no dash', () => {
    const core = makeCore();
    const state = makeState({ phase: 'idle', cooldown: 0, dashesRemaining: 0 });
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1)), state);
    expect(r.state.phase).toBe('idle');
    expect(r.state.startupTimer).toBe(0);
    expect(r.events.dashStarting).toBe(false);
    expect(r.events.dashStarted).toBe(false);
    expect(r.state.dashesRemaining).toBe(0);
  });

  it('refill on land: onGround + dashesRemaining < maxDashes → dashesRemaining = maxDashes', () => {
    const core = makeCore({ onGround: true });
    const state = makeState({ phase: 'idle', cooldown: 0, dashesRemaining: 0 });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.state.dashesRemaining).toBe(DEFAULT_PLATFORMER_CONFIG.maxDashes);
  });

  it('refill does not decrement on grounded tick when already at max', () => {
    const core = makeCore({ onGround: true });
    const state = makeState({
      phase: 'idle',
      cooldown: 0,
      dashesRemaining: DEFAULT_PLATFORMER_CONFIG.maxDashes,
    });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.state.dashesRemaining).toBe(DEFAULT_PLATFORMER_CONFIG.maxDashes);
  });

  it('disabled: dashEnabled=false → never dashes', () => {
    const core = makeCore();
    const state = makeState({ phase: 'idle', cooldown: 0, dashesRemaining: 1 });
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, dashEnabled: false };
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1), config), state);
    expect(r.state.timer).toBe(0);
    expect(r.state.startupTimer).toBe(0);
    expect(r.state.dashesRemaining).toBe(1);
    expect(r.events.dashStarting).toBeUndefined();
    expect(r.events.dashStarted).toBeUndefined();
  });

  it('disabled: returns input core and state by reference (no-op)', () => {
    const core = makeCore();
    const state = makeState({ phase: 'idle', cooldown: 0, dashesRemaining: 1 });
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, dashEnabled: false };
    const r = dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1), config), state);
    expect(r.core).toBe(core);
    expect(r.state).toBe(state);
  });

  it('no dash input (null) → no dash even if available', () => {
    const core = makeCore();
    const state = makeState({ phase: 'idle', cooldown: 0, dashesRemaining: 1 });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.state.phase).toBe('idle');
    expect(r.state.startupTimer).toBe(0);
    expect(r.events.dashStarting).toBe(false);
    expect(r.events.dashStarted).toBe(false);
  });

  it('pure: input state is not mutated', () => {
    const core = makeCore();
    const state = makeState({ phase: 'idle', cooldown: 0, dashesRemaining: 1 });
    const coreSnap = JSON.parse(JSON.stringify(core)) as ActorCore;
    const stateSnap = JSON.parse(JSON.stringify(state)) as DashAbilityState;
    dashAbility.advance(makeCtx(core, makeInput(pressEdge(true), 1)), state);
    expect(core).toEqual(coreSnap);
    expect(state).toEqual(stateSnap);
  });

  it('pure: result core is a new reference when dash is active (velocity written)', () => {
    const core = makeCore({ vx: 50, vy: 200 });
    const state = makeState({
      phase: 'active',
      timer: 0.05,
      cooldown: 0,
      dashesRemaining: 0,
      dirX: 1,
      dirY: 0,
    });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.core).not.toBe(core);
  });

  // =========================================================================
  // Phase 4 — 8-directional dash (§4b) + end-dash velocity (§4c).
  //
  // The dash now captures both axes from input. Diagonals are normalized by
  // 1/√2 so the dash speed is constant (≈ dashSpeed) regardless of direction.
  // A non-downward dash sets an ABSOLUTE end-dash velocity at expiry
  // (`dashSpeed × endDashSpeedFactor`, upward carry × `endDashUpMult`); a
  // downward dash keeps its accumulated vy.
  // =========================================================================

  it('(Phase 4a) upward dash: dirX=0, dirY=-1 → vy = -dashSpeed (pure vertical up)', () => {
    // Holding Up only (moveX=0, moveY=-1). Celeste `GetAimVector(Facing)` does
    // NOT fall back to facing when moveY is set, so this is a PURE upward dash
    // (dirX=0, dirY=-1), not a diagonal. vy is the full -dashSpeed.
    const core = makeCore({ facing: 1 });
    const state = makeState({ phase: 'idle', cooldown: 0, dashesRemaining: 1 });
    const { steps } = advanceThroughStartup(
      core,
      state,
      makeInput(pressEdge(true), 0, -1), // up only
      makeInput(null),
    );
    const transition = steps[steps.length - 1];
    expect(transition.state.phase).toBe('active');
    expect(transition.state.dirX).toBe(0); // pure vertical — no facing fallback
    expect(transition.state.dirY).toBe(-1);
    expect(transition.core.vx).toBe(0);
    expect(transition.core.vy).toBe(-DEFAULT_PLATFORMER_CONFIG.dashSpeed);
  });

  it('(Phase 4b) downward dash: dirY=1 → vy = +dashSpeed (pure vertical down)', () => {
    const core = makeCore({ facing: 1 });
    const state = makeState({ phase: 'idle', cooldown: 0, dashesRemaining: 1 });
    const { steps } = advanceThroughStartup(
      core,
      state,
      makeInput(pressEdge(true), 0, 1), // down only
      makeInput(null),
    );
    const transition = steps[steps.length - 1];
    expect(transition.state.dirX).toBe(0);
    expect(transition.state.dirY).toBe(1);
    expect(transition.core.vy).toBe(DEFAULT_PLATFORMER_CONFIG.dashSpeed);
    expect(transition.core.vx).toBe(0);
  });

  it('(Phase 4c) diagonal dash magnitude === dashSpeed (normalized, not 1.41×)', () => {
    // Up-right diagonal (moveX=1, moveY=-1). Without normalization a diagonal
    // would be √2 × dashSpeed ≈ 594; the 1/√2 factor keeps the magnitude at
    // exactly dashSpeed (420), with each component = dashSpeed/√2 ≈ 297.
    const core = makeCore({ facing: 1 });
    const state = makeState({ phase: 'idle', cooldown: 0, dashesRemaining: 1 });
    const { steps } = advanceThroughStartup(
      core,
      state,
      makeInput(pressEdge(true), 1, -1), // up-right diagonal
      makeInput(null),
    );
    const transition = steps[steps.length - 1];
    expect(transition.state.dirX).toBe(1);
    expect(transition.state.dirY).toBe(-1);
    const comp = DEFAULT_PLATFORMER_CONFIG.dashSpeed / Math.SQRT2;
    expect(transition.core.vx).toBeCloseTo(comp, 6);
    expect(transition.core.vy).toBeCloseTo(-comp, 6);
    // The proof: hypot(vx,vy) === dashSpeed, NOT √2 × dashSpeed.
    expect(Math.hypot(transition.core.vx, transition.core.vy)).toBeCloseTo(
      DEFAULT_PLATFORMER_CONFIG.dashSpeed,
      5,
    );
  });

  it('(Phase 4d) horizontal dash end velocity = dirX × endDashSpeed (≈281), vy=0', () => {
    // On expiry a non-downward dash sets an ABSOLUTE end velocity along the
    // (normalized) dash axis: dirX × (dashSpeed × endDashSpeedFactor). For a
    // horizontal dash that is vx ≈ 281.4 (420 × 0.67), vy = 0. Same-direction
    // preservation does NOT apply (it is an absolute set, per Celeste).
    const core = makeCore();
    const state = makeState({
      phase: 'active',
      timer: DT, // expires this tick
      cooldown: 0,
      dashesRemaining: 0,
      dirX: 1,
      dirY: 0,
      beforeDashVx: 0,
    });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.state.phase).toBe('idle');
    const endDashSpeed =
      DEFAULT_PLATFORMER_CONFIG.dashSpeed * DEFAULT_PLATFORMER_CONFIG.endDashSpeedFactor;
    expect(r.core.vx).toBeCloseTo(endDashSpeed, 6); // ≈ 281.4
    expect(r.core.vy).toBe(0);
  });

  it('(Phase 4e) upward-dash end velocity: vy *= endDashUpMult (0.75)', () => {
    // An upward dash (dirY=-1) expires with vy = dirY × endDashSpeed ×
    // endDashUpMult — the upward carry is reduced so the dash does not fling
    // the actor as high afterward. vx = 0 (dirX=0).
    const core = makeCore();
    const state = makeState({
      phase: 'active',
      timer: DT,
      cooldown: 0,
      dashesRemaining: 0,
      dirX: 0,
      dirY: -1,
      beforeDashVx: 0,
    });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.state.phase).toBe('idle');
    const endDashSpeed =
      DEFAULT_PLATFORMER_CONFIG.dashSpeed * DEFAULT_PLATFORMER_CONFIG.endDashSpeedFactor;
    const expectedVy = -endDashSpeed * DEFAULT_PLATFORMER_CONFIG.endDashUpMult;
    expect(r.core.vy).toBeCloseTo(expectedVy, 6); // ≈ -211.05
    expect(r.core.vx).toBe(0);
  });

  it('(Phase 4f) downward dash expiry: no end-set, keeps accumulated vy', () => {
    // A downward dash (dirY=1 > 0) skips the end-dash set entirely — the
    // accumulated dash velocity (full dashSpeed) is kept so gravity continues
    // from the dash speed. This is the Celeste `DashDir.Y > 0` gate.
    const core = makeCore();
    const state = makeState({
      phase: 'active',
      timer: DT,
      cooldown: 0,
      dashesRemaining: 0,
      dirX: 0,
      dirY: 1,
      beforeDashVx: 0,
    });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    expect(r.state.phase).toBe('idle');
    // Full dash speed retained (no end-set reduction).
    expect(r.core.vy).toBe(DEFAULT_PLATFORMER_CONFIG.dashSpeed); // 420
    expect(r.core.vx).toBe(0);
  });

  it('(Phase 4) diagonal same-direction preservation compares against the reduced X component', () => {
    // A diagonal dash's X component is dirX/√2 × dashSpeed ≈ 297. If the actor
    // was already moving faster than THAT (but slower than full dashSpeed) in
    // the dash's X direction, the faster speed is kept — preservation compares
    // against the reduced component, not the full dashSpeed. Here beforeDashVx
    // = 350 (> 297 diagonal X component, < 420 full dashSpeed): preserved.
    const core = makeCore({ vx: 350, vy: 0, facing: 1 });
    const state = makeState({
      phase: 'active',
      timer: 0.05, // still active (not expiring) — preservation applies
      cooldown: 0,
      dashesRemaining: 0,
      dirX: 1,
      dirY: -1, // diagonal up-right → X component = dashSpeed/√2 ≈ 297
      beforeDashVx: 350,
    });
    const r = dashAbility.advance(makeCtx(core, makeInput(null)), state);
    // Preserved: 350 > 297 (the diagonal X component), same direction.
    expect(r.core.vx).toBe(350);
  });
});
