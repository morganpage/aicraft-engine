import { describe, it, expect } from 'vitest';
import {
  createPlatformerController,
  createPlatformerState,
  stepPlatformer,
} from '../platformer/kernel';
import { defaultPrecisionPipeline } from '../platformer/pipelines';
import { jumpAbility } from '../platformer/abilities/jump-ability';
import { compileLevel } from '../platformer/level-runtime';
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
  JumpAbilityState,
  PlatformerInput,
  PlatformerState,
} from '../platformer/types';
import type { PolledEdge } from '../input/types';
import type { LevelData } from '../level/types';

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
  it('updates gravity-relative onGround before abilities execute', () => {
    let seenOnGround: boolean | null = null;
    const probe = {
      kind: 'jump' as const,
      advance(ctx: Parameters<typeof jumpAbility.advance>[0], ability: JumpAbilityState) {
        seenOnGround = ctx.core.onGround;
        return { core: ctx.core, state: ability, events: {} };
      },
    };
    const controller = createPlatformerController([probe], {
      ...DEFAULT_PLATFORMER_CONFIG,
      gravity: -980,
    });
    const state = makeState({
      y: 176,
      onGround: true,
      contacts: {
        groundId: 'floor',
        leftWallId: null,
        rightWallId: null,
        ceilingId: null,
      },
    });
    controller.step(
      state,
      idleInput(),
      [{ id: 'floor', x: 0, y: 200, width: 300, height: 16 }],
      DT,
    );
    expect(seenOnGround).toBe(false);
  });

  it('recognizes anonymous ceiling support from geometry', () => {
    const controller = createPlatformerController([], {
      ...DEFAULT_PLATFORMER_CONFIG,
      gravity: -980,
    });
    const state = makeState({
      x: 20,
      y: 36,
      onGround: true,
      contacts: EMPTY_CONTACTS,
    });
    const solid: Solid = { x: 0, y: 20, width: 100, height: 16 };
    const next = controller.step(state, idleInput(), [solid], DT).state;
    expect(next.core.onGround).toBe(true);
    expect(next.events.justLanded).toBe(false);
    expect(next.events.hitCeiling).toBe(true);

    const sustained = controller.step(next, idleInput(), [solid], DT).state;
    expect(sustained.core.onGround).toBe(true);
    expect(sustained.events.justLanded).toBe(false);
    expect(sustained.events.hitCeiling).toBe(true);
  });

  it('round-trips support across positive, negative, then positive gravity', () => {
    const floor: Solid = { id: 'floor', x: 0, y: 200, width: 300, height: 16 };
    const ceiling: Solid = { id: 'ceiling', x: 0, y: 20, width: 300, height: 16 };
    const solids = [floor, ceiling];
    const positive = createPlatformerController([], {
      ...DEFAULT_PLATFORMER_CONFIG,
      gravity: 980,
      jumpEnabled: false,
    });
    const negative = createPlatformerController([], {
      ...DEFAULT_PLATFORMER_CONFIG,
      gravity: -980,
      jumpEnabled: false,
    });
    let state = makeState({
      x: 80,
      y: 176,
      onGround: true,
      contacts: {
        groundId: 'floor',
        leftWallId: null,
        rightWallId: null,
        ceilingId: null,
      },
    });

    state = negative.step(state, idleInput(), solids, DT).state;
    expect(state.core.onGround).toBe(false);
    expect(state.core.contacts.groundId).toBe(null);

    for (let i = 0; i < 120 && !state.core.onGround; i += 1) {
      state = negative.step(state, idleInput(), solids, DT).state;
    }
    expect(state.core.onGround).toBe(true);
    expect(state.core.contacts.ceilingId).toBe('ceiling');
    expect(state.events.justLanded).toBe(true);

    state = positive.step(state, idleInput(), solids, DT).state;
    expect(state.core.onGround).toBe(false);
    expect(state.core.contacts.ceilingId).toBe(null);

    for (let i = 0; i < 120 && !state.core.onGround; i += 1) {
      state = positive.step(state, idleInput(), solids, DT).state;
    }
    expect(state.core.onGround).toBe(true);
    expect(state.core.contacts.groundId).toBe('floor');
    expect(state.events.justLanded).toBe(true);
  });

  it('is byte-identical across repeated runs of the same signed-gravity sequence', () => {
    const signs: readonly (1 | -1)[] = [
      ...Array<1 | -1>(24).fill(1),
      ...Array<1 | -1>(48).fill(-1),
      ...Array<1 | -1>(72).fill(1),
    ];
    const solids: Solid[] = [
      { id: 'floor', x: 0, y: 200, width: 300, height: 16 },
      { id: 'ceiling', x: 0, y: 20, width: 300, height: 16 },
    ];
    const run = (): string => {
      const positive = createPlatformerController([], {
        ...DEFAULT_PLATFORMER_CONFIG,
        gravity: 980,
        jumpEnabled: false,
      });
      const negative = createPlatformerController([], {
        ...DEFAULT_PLATFORMER_CONFIG,
        gravity: -980,
        jumpEnabled: false,
      });
      let state = makeState({
        x: 80,
        y: 176,
        onGround: true,
        contacts: {
          groundId: 'floor',
          leftWallId: null,
          rightWallId: null,
          ceilingId: null,
        },
      });
      const trace: PlatformerState[] = [];
      for (const sign of signs) {
        const controller = sign === 1 ? positive : negative;
        state = controller.step(state, idleInput(), solids, DT).state;
        trace.push(state);
      }
      return JSON.stringify(trace);
    };

    expect(run()).toBe(run());
  });

  it('clamps positive-gravity velocity to positive terminal speed', () => {
    const controller = createPlatformerController([], {
      ...DEFAULT_PLATFORMER_CONFIG,
      gravity: 1_000,
      maxFallSpeed: 75,
      jumpEnabled: false,
    });
    const next = controller.step(
      makeState({ vy: 74 }),
      idleInput(),
      [],
      1,
    ).state;
    expect(next.core.vy).toBe(75);
  });

  it('snapshots positive-gravity freefall progression', () => {
    const controller = createPlatformerController([], {
      ...DEFAULT_PLATFORMER_CONFIG,
      gravity: 120,
      maxFallSpeed: 500,
      jumpEnabled: false,
    });
    let state = makeState({ x: 12, y: 34, vx: 6, vy: 0 });
    const trace = [];
    for (let tick = 0; tick < 3; tick += 1) {
      state = controller.step(state, idleInput(), [], 0.25).state;
      trace.push({
        tick: state.tick,
        x: state.core.x,
        y: state.core.y,
        vx: state.core.vx,
        vy: state.core.vy,
        onGround: state.core.onGround,
        contacts: state.core.contacts,
      });
    }
    expect(trace).toMatchInlineSnapshot(`
      [
        {
          "contacts": {
            "ceilingId": null,
            "groundId": null,
            "leftWallId": null,
            "rightWallId": null,
          },
          "onGround": false,
          "tick": 1,
          "vx": 6,
          "vy": 30,
          "x": 13.5,
          "y": 41.5,
        },
        {
          "contacts": {
            "ceilingId": null,
            "groundId": null,
            "leftWallId": null,
            "rightWallId": null,
          },
          "onGround": false,
          "tick": 2,
          "vx": 6,
          "vy": 60,
          "x": 15,
          "y": 56.5,
        },
        {
          "contacts": {
            "ceilingId": null,
            "groundId": null,
            "leftWallId": null,
            "rightWallId": null,
          },
          "onGround": false,
          "tick": 3,
          "vx": 6,
          "vy": 90,
          "x": 16.5,
          "y": 79,
        },
      ]
    `);
  });

  it('clamps negative-gravity velocity to negative terminal speed', () => {
    const controller = createPlatformerController([], {
      ...DEFAULT_PLATFORMER_CONFIG,
      gravity: -1_000,
      maxFallSpeed: 75,
      jumpEnabled: false,
    });
    const next = controller.step(
      makeState({ vy: -74 }),
      idleInput(),
      [],
      1,
    ).state;
    expect(next.core.vy).toBe(-75);
  });

  it('emits justLanded when gravity flips directly from floor to ceiling support', () => {
    const state = makeState({
      x: 40,
      y: 38,
      vy: 0,
      onGround: true,
      contacts: {
        groundId: 'old-floor',
        leftWallId: null,
        rightWallId: null,
        ceilingId: null,
      },
    });
    const controller = createPlatformerController([], {
      ...DEFAULT_PLATFORMER_CONFIG,
      gravity: -14_400,
      jumpEnabled: false,
    });
    const result = controller.step(
      state,
      idleInput(),
      [{ id: 'new-ceiling', x: 0, y: 20, width: 200, height: 16 }],
      DT,
    ).state;
    expect(result.core.onGround).toBe(true);
    expect(result.core.contacts.ceilingId).toBe('new-ceiling');
    expect(result.events.justLanded).toBe(true);
  });

  it('supports and carries an actor from a ceiling under negative gravity', () => {
    const config = { ...DEFAULT_PLATFORMER_CONFIG, gravity: -600, maxFallSpeed: 120, jumpEnabled: false };
    const ceiling: Solid[] = [{ id: 'ceiling', x: 0, y: 20, width: 300, height: 16 }];
    let state = makeState({ x: 80, y: 60, vy: 0 });
    for (let i = 0; i < 60 && !state.core.onGround; i += 1) {
      state = stepPlatformer(state, idleInput(), ceiling, DT, config).state;
    }
    expect(state.core.onGround).toBe(true);
    expect(state.core.contacts.ceilingId).toBe('ceiling');
    expect(state.events.justLanded).toBe(true);
    const carried = stepPlatformer(
      state,
      idleInput(),
      [{ ...ceiling[0], x: 3 }],
      DT,
      config,
      (id) => id === 'ceiling' ? { dx: 3, dy: 0 } : null,
    ).state;
    expect(carried.core.x).toBe(state.core.x + 3);
    expect(carried.core.onGround).toBe(true);
  });

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

  it('lands on tile-authored terrain compiled by compileLevel', () => {
    const level: LevelData = {
      version: 1,
      id: 'tile-landing',
      name: 'Tile landing',
      width: 64,
      height: 64,
      tileSize: 16,
      spawn: { x: 16, y: 0 },
      tiles: {
        data: [
          0, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
          1, 1, 1, 1,
        ],
        cols: 4,
        rows: 4,
        tileSize: 16,
      },
      entities: [],
      nextEntityId: 1,
    };
    const compiled = compileLevel(level, {
      tileTypeMap: (tile) => tile === 1 ? 'solid' : 'empty',
    });
    let state = compiled.initialState;
    for (let i = 0; i < 120 && !state.core.onGround; i += 1) {
      state = stepPlatformer(state, idleInput(), compiled.staticSolids, DT).state;
    }
    expect(state.core.onGround).toBe(true);
    expect(state.core.y).toBe(24);
    expect(state.core.contacts.groundId).toBe('tile-0-48-64-16');
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
