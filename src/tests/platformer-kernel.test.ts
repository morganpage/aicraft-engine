import { describe, it, expect } from 'vitest';
import {
  createPlatformerController,
  createPlatformerState,
  stepPlatformer,
} from '../platformer/kernel';
import { defaultPrecisionPipeline } from '../platformer/pipelines';
import {
  DEFAULT_PLATFORMER_CONFIG,
  DEFAULT_PLAYER_WIDTH,
  DEFAULT_PLAYER_HEIGHT,
  EMPTY_CONTACTS,
  EMPTY_EVENTS,
} from '../platformer/constants';
import { createJumpState, DEFAULT_JUMP } from '../animation/jump';
import type { Solid } from '../collision/types';
import type {
  ActorCore,
  AnyAbilityState,
  PlatformerInput,
  PlatformerState,
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

function idleInput(): PlatformerInput {
  return { moveX: 0, jump: idleEdge(), dash: null };
}

/**
 * Build a full PlatformerState from a partial core, useful for tests that need
 * the actor to start in a specific kinematic configuration (e.g. already
 * grounded on a platform, or rising with non-zero vy).
 */
function makeState(
  coreOverrides: Partial<ActorCore> = {},
  abilitiesOverrides: Record<string, AnyAbilityState> = {},
): PlatformerState {
  const base = createPlatformerState(
    coreOverrides.x ?? 0,
    coreOverrides.y ?? 0,
    DEFAULT_PLATFORMER_CONFIG,
    coreOverrides.width ?? DEFAULT_PLAYER_WIDTH,
    coreOverrides.height ?? DEFAULT_PLAYER_HEIGHT,
  );
  return {
    ...base,
    core: { ...base.core, ...coreOverrides },
    abilities: { ...base.abilities, ...abilitiesOverrides },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createPlatformerState', () => {
  it('produces valid initial state with all fields populated, airborne, tick=0', () => {
    const s = createPlatformerState(100, 200);
    expect(s.core.x).toBe(100);
    expect(s.core.y).toBe(200);
    expect(s.core.width).toBe(DEFAULT_PLAYER_WIDTH);
    expect(s.core.height).toBe(DEFAULT_PLAYER_HEIGHT);
    expect(s.core.vx).toBe(0);
    expect(s.core.vy).toBe(0);
    expect(s.core.facing).toBe(1);
    expect(s.core.onGround).toBe(false);
    expect(s.core.contacts).toEqual(EMPTY_CONTACTS);
    expect(s.tick).toBe(0);
    expect(s.events).toEqual(EMPTY_EVENTS);
    expect(Object.keys(s.abilities).sort()).toEqual([
      'dash',
      'doubleJump',
      'jump',
      'wallSlide',
    ]);
  });

  it('respects custom width/height', () => {
    const s = createPlatformerState(0, 0, DEFAULT_PLATFORMER_CONFIG, 24, 32);
    expect(s.core.width).toBe(24);
    expect(s.core.height).toBe(32);
  });

  it('initial dash budget equals config.maxDashes when dash is enabled', () => {
    const s = createPlatformerState(0, 0);
    const dash = s.abilities['dash'];
    expect(dash).toBeDefined();
    if (dash && dash.kind === 'dash') {
      expect(dash.dashesRemaining).toBe(DEFAULT_PLATFORMER_CONFIG.maxDashes);
    }
  });
});

describe('stepPlatformer (integration)', () => {
  it('returns a valid PlatformerState with tick incremented', () => {
    const solids: Solid[] = [{ id: 'floor', x: 0, y: 300, width: 400, height: 16 }];
    const s0 = createPlatformerState(100, 100);
    const r = stepPlatformer(s0, idleInput(), solids, DT);
    expect(r.state.tick).toBe(1);
    expect(r.state.core).toBeDefined();
    expect(r.state.events).toBeDefined();
    expect(r.state.abilities).toBeDefined();
  });

  it('does not mutate the input state', () => {
    const solids: Solid[] = [{ id: 'floor', x: 0, y: 300, width: 400, height: 16 }];
    const s0 = createPlatformerState(100, 100);
    const snap = JSON.parse(JSON.stringify(s0)) as PlatformerState;
    stepPlatformer(s0, idleInput(), solids, DT);
    expect(s0).toEqual(snap);
  });

  it('landing on solid: falling actor → contacts.groundId set, justLanded=true', () => {
    const solids: Solid[] = [{ id: 'floor', x: 0, y: 200, width: 400, height: 16 }];
    let state = createPlatformerState(100, 150);
    let landedTick = -1;
    for (let i = 0; i < 40; i++) {
      const result = stepPlatformer(state, idleInput(), solids, DT);
      state = result.state;
      if (state.events.justLanded) {
        landedTick = i;
        break;
      }
    }
    expect(landedTick).toBeGreaterThanOrEqual(0);
    expect(state.core.onGround).toBe(true);
    expect(state.core.contacts.groundId).toBe('floor');
    expect(state.core.vy).toBe(0);
  });

  it('wall contact: actor moving right into wall → rightWallId set, hitWall=true, vx=0', () => {
    const solids: Solid[] = [
      { id: 'floor', x: 0, y: 200, width: 400, height: 16 },
      { id: 'wall', x: 250, y: 0, width: 16, height: 200 },
    ];
    // Start actor on the floor, well left of the wall, moving right.
    let state = makeState({ x: 100, y: 176, onGround: true, vx: 0, vy: 0 });
    let hitWallTick = -1;
    for (let i = 0; i < 120; i++) {
      const input: PlatformerInput = { moveX: 1, jump: idleEdge(), dash: null };
      const result = stepPlatformer(state, input, solids, DT);
      state = result.state;
      if (state.events.hitWall) {
        hitWallTick = i;
        break;
      }
    }
    expect(hitWallTick).toBeGreaterThanOrEqual(0);
    expect(state.core.contacts.rightWallId).toBe('wall');
    expect(state.core.vx).toBe(0);
  });

  it('ceiling contact: rising actor → ceilingId set, hitCeiling=true, vy=0', () => {
    // Floor low, ceiling just above the actor's apex so it bonks.
    const solids: Solid[] = [
      { id: 'floor', x: 0, y: 300, width: 400, height: 16 },
      { id: 'ceiling', x: 0, y: 250, width: 400, height: 16 },
    ];
    // Actor grounded on floor, then jump on tick 1.
    let state = makeState({ x: 100, y: 276, onGround: true });
    let hitCeilTick = -1;
    for (let i = 0; i < 60; i++) {
      const input: PlatformerInput = {
        moveX: 0,
        jump: i === 1 ? pressEdge(true) : i > 1 ? { held: true, pressed: false, released: false } : idleEdge(),
        dash: null,
      };
      const result = stepPlatformer(state, input, solids, DT);
      state = result.state;
      if (state.events.hitCeiling) {
        hitCeilTick = i;
        break;
      }
    }
    expect(hitCeilTick).toBeGreaterThanOrEqual(0);
    expect(state.core.contacts.ceilingId).toBe('ceiling');
    expect(state.core.vy).toBe(0);
  });

  it('moving-platform carry: actor grounded on plat-1, provider returns displacement → x/y adjust', () => {
    // Platform moved from y=200 to y=197 between ticks (dy=-3, dx=5).
    const solids: Solid[] = [{ id: 'plat-1', x: 0, y: 197, width: 400, height: 16 }];
    const state = makeState({
      x: 100,
      y: 176, // bottom = 200 = platform's previous top
      onGround: true,
      contacts: {
        groundId: 'plat-1',
        leftWallId: null,
        rightWallId: null,
        ceilingId: null,
      },
    });
    const input = idleInput();
    const result = stepPlatformer(state, input, solids, DT, DEFAULT_PLATFORMER_CONFIG, (id) => {
      if (id === 'plat-1') return { dx: 5, dy: -3 };
      return null;
    });
    // After carry: x=105, y=173. Collision snaps bottom to new platform top (197),
    // so actor's y stays at 173 (= 197 - 24).
    expect(result.state.core.x).toBe(105);
    expect(result.state.core.y).toBe(173);
    expect(result.state.core.onGround).toBe(true);
    expect(result.state.core.contacts.groundId).toBe('plat-1');
  });

  it('replay determinism (basic): two runs from same initial state + same inputs → identical state', () => {
    const solids: Solid[] = [
      { id: 'floor', x: 0, y: 300, width: 400, height: 16 },
      { id: 'wall-l', x: 0, y: 0, width: 16, height: 300 },
      { id: 'wall-r', x: 384, y: 0, width: 16, height: 300 },
    ];
    const inputFor = (i: number): PlatformerInput => ({
      moveX: i % 20 < 10 ? 1 : -1,
      jump: i % 50 === 0 ? pressEdge(true) : idleEdge(),
      dash: null,
    });
    let a = createPlatformerState(100, 100);
    let b = createPlatformerState(100, 100);
    for (let i = 0; i < 100; i++) {
      const input = inputFor(i);
      a = stepPlatformer(a, input, solids, DT).state;
      b = stepPlatformer(b, input, solids, DT).state;
    }
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('justLaunched event fires when a grounded jump press is processed', () => {
    const solids: Solid[] = [{ id: 'floor', x: 0, y: 200, width: 400, height: 16 }];
    let state = makeState({ x: 100, y: 176, onGround: true });
    let launched = false;
    for (let i = 0; i < 12; i++) {
      const input: PlatformerInput = {
        moveX: 0,
        jump: i === 0 ? pressEdge(true) : { held: true, pressed: false, released: false },
        dash: null,
      };
      const result = stepPlatformer(state, input, solids, DT);
      state = result.state;
      if (state.events.justLaunched) {
        launched = true;
        break;
      }
    }
    expect(launched).toBe(true);
  });

  it('controller equals convenience wrapper: same result for same input', () => {
    const solids: Solid[] = [{ id: 'floor', x: 0, y: 300, width: 400, height: 16 }];
    const controller = createPlatformerController(
      defaultPrecisionPipeline(),
      DEFAULT_PLATFORMER_CONFIG,
    );
    const a0 = createPlatformerState(50, 50);
    const b0 = createPlatformerState(50, 50);
    const input = idleInput();
    const ra = controller.step(a0, input, solids, DT);
    const rb = stepPlatformer(b0, input, solids, DT);
    expect(JSON.stringify(ra.state)).toEqual(JSON.stringify(rb.state));
  });

  it('config with disabled abilities still steps cleanly', () => {
    const config = {
      ...DEFAULT_PLATFORMER_CONFIG,
      dashEnabled: false,
      wallSlideEnabled: false,
      doubleJumpEnabled: false,
    };
    const solids: Solid[] = [{ id: 'floor', x: 0, y: 200, width: 400, height: 16 }];
    let state = createPlatformerState(50, 100, config);
    expect(() => {
      for (let i = 0; i < 10; i++) {
        state = stepPlatformer(state, idleInput(), solids, DT, config).state;
      }
    }).not.toThrow();
    expect(state.tick).toBe(10);
  });

  it('JSON-serializable state round-trips (no functions or undefined sneaks)', () => {
    const solids: Solid[] = [{ id: 'floor', x: 0, y: 300, width: 400, height: 16 }];
    let state = createPlatformerState(50, 100);
    state = stepPlatformer(state, idleInput(), solids, DT).state;
    const json = JSON.stringify(state);
    const parsed = JSON.parse(json) as PlatformerState;
    expect(parsed.tick).toBe(state.tick);
    expect(parsed.core.x).toBe(state.core.x);
  });

  it('dash fires in the kernel when dash input is provided airborne', () => {
    const solids: Solid[] = [{ id: 'floor', x: 0, y: 300, width: 400, height: 16 }];
    let state = makeState({ x: 100, y: 200, onGround: false, vy: 0 });
    let dashStartedTick = -1;
    for (let i = 0; i < 20; i++) {
      const input: PlatformerInput = {
        moveX: 1,
        jump: idleEdge(),
        dash: i === 0 ? pressEdge(true) : null,
      };
      const result = stepPlatformer(state, input, solids, DT);
      state = result.state;
      if (state.events.dashStarted) {
        dashStartedTick = i;
        break;
      }
    }
    expect(dashStartedTick).toBe(0);
    const dash = state.abilities['dash'];
    if (dash && dash.kind === 'dash') {
      expect(dash.dashesRemaining).toBe(0);
    }
  });

  it('double-jump fires when enabled and actor is airborne with budget', () => {
    const config: typeof DEFAULT_PLATFORMER_CONFIG = {
      ...DEFAULT_PLATFORMER_CONFIG,
      doubleJumpEnabled: true,
      maxDoubleJumps: 1,
    };
    const solids: Solid[] = [{ id: 'floor', x: 0, y: 300, width: 400, height: 16 }];
    // Airborne + rising (mimic just-after-first-jump state).
    let state = makeState(
      { x: 100, y: 200, onGround: false, vy: -100 },
      {
        jump: { kind: 'jump', jump: { ...createJumpState(DEFAULT_JUMP), phase: 'rising', vy: -100 } },
        doubleJump: { kind: 'doubleJump', jumpsRemaining: 1 },
      },
    );
    state = stepPlatformer(
      state,
      { moveX: 0, jump: pressEdge(true), dash: null },
      solids,
      DT,
      config,
    ).state;
    expect(state.events.doubleJumped).toBe(true);
    const dj = state.abilities['doubleJump'];
    if (dj && dj.kind === 'doubleJump') {
      expect(dj.jumpsRemaining).toBe(0);
    }
  });
});
