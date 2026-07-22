import { describe, it, expect } from 'vitest';
import { spiderBehavior } from '../platformer/enemy/registry';
import type { EnemyState, EnemyUpdateContext } from '../platformer/enemy/types';
import type { SpiderState } from '../animation/spider/spider-state';

function makeDefaultContext(overrides?: Partial<EnemyUpdateContext>): EnemyUpdateContext {
  return {
    dt: 1 / 60,
    solids: [],
    tileQuery: null,
    tileSize: 16,
    playerRect: null,
    ...overrides,
  };
}

function makeDefaultState(overrides?: Partial<EnemyState>): EnemyState {
  return {
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    facing: 1,
    alive: true,
    data: {},
    ...overrides,
  };
}

describe('spiderBehavior', () => {
  // ─── Patrol movement ─────────────────────────────────────────────

  it('moves along x-axis at given speed', () => {
    const dt = 1 / 60;
    const speed = 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt });

    const result = spiderBehavior.step(state, ctx, { speed });

    expect(result.x).toBeCloseTo(100 + speed * dt, 5);
    expect(result.y).toBe(100);
    expect(result.facing).toBe(1);
  });

  it('sets vx = speed * facing (right)', () => {
    const dt = 1 / 60;
    const speed = 50;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt });

    const result = spiderBehavior.step(state, ctx, { speed });

    expect(result.vx).toBe(speed);
    expect(result.vy).toBe(0);
  });

  it('sets vx = speed * facing (left)', () => {
    const dt = 1 / 60;
    const speed = 50;
    const state = makeDefaultState({ x: 100, y: 100, facing: -1 });
    const ctx = makeDefaultContext({ dt });

    const result = spiderBehavior.step(state, ctx, { speed });

    expect(result.vx).toBe(-speed);
  });

  it('uses default speed of 50 when speed param is missing', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt });

    const result = spiderBehavior.step(state, ctx, {});

    expect(result.x).toBeCloseTo(100 + 50 * dt, 5);
  });

  // ─── Wall turnaround ─────────────────────────────────────────────

  it('reverses facing when hitting a solid', () => {
    const dt = 1 / 60;
    const speed = 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const solids = [{ x: 101, y: 90, width: 16, height: 32 }];
    const ctx = makeDefaultContext({ dt, solids });

    const result = spiderBehavior.step(state, ctx, { speed });

    expect(result.facing).toBe(-1);
  });

  // ─── Spider state persisted ──────────────────────────────────────

  it('produces SpiderState with 8 legs after step', () => {
    const dt = 1 / 60;
    const speed = 50;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt });

    const result = spiderBehavior.step(state, ctx, { speed });

    const spider = result.data.spider as SpiderState;
    expect(spider).toBeDefined();
    expect(spider.gait).toBeDefined();
    expect(spider.gait.legs).toHaveLength(8);
    expect(spider.jitterSeed).toBeDefined();
    expect(typeof spider.jitterSeed).toBe('number');
  });

  it('increments data.tick', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1, data: { tick: 5 } });
    const ctx = makeDefaultContext({ dt });

    const result = spiderBehavior.step(state, ctx, {});

    expect(result.data.tick).toBe(6);
  });

  // ─── First-tick init ─────────────────────────────────────────────

  it('initializes spider state on first tick (data.spider undefined)', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1, data: {} });
    const ctx = makeDefaultContext({ dt });

    const result = spiderBehavior.step(state, ctx, {});

    expect(result.data.spider).toBeDefined();
    const spider = result.data.spider as SpiderState;
    expect(spider.gait).toBeDefined();
    expect(spider.palpL).toBeDefined();
    expect(spider.palpR).toBeDefined();
  });

  // ─── Deterministic jitterSeed ────────────────────────────────────

  it('same initial state produces identical spider state across calls', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt });

    const result1 = spiderBehavior.step(state, ctx, { speed: 50 });
    const result2 = spiderBehavior.step(state, ctx, { speed: 50 });

    expect(result1.data.spider).toEqual(result2.data.spider);
    expect(result1.data.tick).toEqual(result2.data.tick);
  });

  it('input state is not mutated', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt });
    const originalData = { ...state.data };

    spiderBehavior.step(state, ctx, { speed: 50 });

    expect(state.x).toBe(100);
    expect(state.y).toBe(100);
    expect(state.facing).toBe(1);
    expect(state.data).toEqual(originalData);
  });

  it('uses jitterSeed from params when provided', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt });
    const seed = 42;

    const result = spiderBehavior.step(state, ctx, { jitterSeed: seed });

    const spider = result.data.spider as SpiderState;
    expect(spider.jitterSeed).toBe(seed);
  });

  it('derives jitterSeed deterministically from initial x when not provided', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt });

    const result = spiderBehavior.step(state, ctx, {});

    const spider = result.data.spider as SpiderState;
    // Expected: (Math.abs(Math.floor(100)) * 2654435761) >>> 0
    const expectedSeed = (Math.abs(Math.floor(100)) * 2654435761) >>> 0;
    expect(spider.jitterSeed).toBe(expectedSeed);
  });

  // ─── Null tileQuery ──────────────────────────────────────────────

  it('does not throw when ctx.tileQuery is null', () => {
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ tileQuery: null });

    expect(() => spiderBehavior.step(state, ctx, {})).not.toThrow();
  });

  it('still patrols and produces spider state when tileQuery is null', () => {
    const dt = 1 / 60;
    const speed = 50;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt, tileQuery: null });

    const result = spiderBehavior.step(state, ctx, { speed });

    expect(result.x).toBeCloseTo(100 + speed * dt, 5);
    expect(result.data.spider).toBeDefined();
  });

  // ─── tileQuery throwing ──────────────────────────────────────────

  it('does not throw when tileQuery throws internally', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const tileQuery = () => { throw new Error('tile error'); };
    const ctx = makeDefaultContext({ dt, tileQuery, tileSize: 16 });

    expect(() => spiderBehavior.step(state, ctx, {})).not.toThrow();
  });

  it('still produces valid result when tileQuery throws', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const tileQuery = () => { throw new Error('tile error'); };
    const ctx = makeDefaultContext({ dt, tileQuery, tileSize: 16 });

    const result = spiderBehavior.step(state, ctx, { speed: 50 });

    expect(result.data.spider).toBeDefined();
    expect(result.x).toBeCloseTo(100 + 50 * dt, 5);
  });

  // ─── Frantic mode ────────────────────────────────────────────────

  it('accepts frantic gaitMode without throwing', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt });

    expect(() => spiderBehavior.step(state, ctx, { gaitMode: 'frantic' })).not.toThrow();
  });

  it('produces spider state with frantic gait mode', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt });

    const result = spiderBehavior.step(state, ctx, { gaitMode: 'frantic' });

    expect(result.data.spider).toBeDefined();
    const spider = result.data.spider as SpiderState;
    expect(spider.gait).toBeDefined();
  });

  // ─── Alive preserved ─────────────────────────────────────────────

  it('preserves alive=false', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1, alive: false });
    const ctx = makeDefaultContext({ dt });

    const result = spiderBehavior.step(state, ctx, {});

    expect(result.alive).toBe(false);
  });

  // ─── Patrol path mode ────────────────────────────────────────────

  it('follows patrolPath waypoints', () => {
    const dt = 1;
    const speed = 60;
    const path = [
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ];
    const state = makeDefaultState({ x: 0, y: 100, facing: 1, data: { waypointIndex: 1 } });
    const ctx = makeDefaultContext({ dt });

    const result = spiderBehavior.step(state, ctx, { speed, patrolPath: path });

    expect(result.x).toBeCloseTo(60, 5);
    expect(result.y).toBe(100);
  });

  it('wraps waypointIndex after reaching last waypoint', () => {
    const dt = 1;
    const speed = 200;
    const path = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ];
    const state = makeDefaultState({ x: 5, y: 0, facing: 1, data: { waypointIndex: 1 } });
    const ctx = makeDefaultContext({ dt });

    const result = spiderBehavior.step(state, ctx, { speed, patrolPath: path });

    expect(result.data.waypointIndex).toBe(0);
  });

  // ─── Ledge turnaround ────────────────────────────────────────────

  it('reverses facing when ledgeTurnAround=true and no ground ahead', () => {
    const dt = 1 / 60;
    const speed = 60;
    const tileQuery = () => 'empty' as const;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt, tileQuery, tileSize: 16 });

    const result = spiderBehavior.step(state, ctx, {
      speed,
      ledgeTurnAround: true,
    });

    expect(result.facing).toBe(-1);
  });

  it('does not reverse facing when ledgeTurnAround=true but solid ahead', () => {
    const dt = 1 / 60;
    const speed = 60;
    const tileQuery = () => 'solid' as const;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt, tileQuery, tileSize: 16 });

    const result = spiderBehavior.step(state, ctx, {
      speed,
      ledgeTurnAround: true,
    });

    expect(result.facing).toBe(1);
  });
});
