import { describe, it, expect } from 'vitest';
import { spinnyBehavior } from '../platformer/enemy/registry';
import type { EnemyState, EnemyUpdateContext } from '../platformer/enemy/types';

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

describe('spinnyBehavior', () => {
  it('moves along x-axis at given speed when no patrolPath', () => {
    const dt = 1 / 60;
    const speed = 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt });

    const result = spinnyBehavior.step(state, ctx, { speed });

    expect(result.x).toBeCloseTo(100 + speed * dt, 5);
    expect(result.y).toBe(100);
    expect(result.facing).toBe(1);
  });

  it('reverses facing when ledgeTurnAround=true and empty tile ahead', () => {
    const dt = 1 / 60;
    const speed = 60;
    // Tile query returns 'empty' for the tile ahead and below (no ground)
    const tileQuery = (_tx: number, _ty: number) => 'empty' as const;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt, tileQuery, tileSize: 16 });

    const result = spinnyBehavior.step(state, ctx, {
      speed,
      ledgeTurnAround: true,
    });

    // Facing should have reversed because there is no solid tile ahead+below
    expect(result.facing).toBe(-1);
  });

  it('does not reverse facing when ledgeTurnAround=true but solid ahead', () => {
    const dt = 1 / 60;
    const speed = 60;
    // Tile query returns 'solid' everywhere (ground present)
    const tileQuery = (_tx: number, _ty: number) => 'solid' as const;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt, tileQuery, tileSize: 16 });

    const result = spinnyBehavior.step(state, ctx, {
      speed,
      ledgeTurnAround: true,
    });

    expect(result.facing).toBe(1);
  });

  it('follows patrolPath waypoints', () => {
    const dt = 1;
    const speed = 60;
    const path = [
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ];
    // Enemy starts at waypoint 0, targeting waypoint 1
    const state = makeDefaultState({ x: 0, y: 100, facing: 1, data: { waypointIndex: 1 } });
    const ctx = makeDefaultContext({ dt });

    const result = spinnyBehavior.step(state, ctx, { speed, patrolPath: path });

    // Should move toward waypoint 1 at speed 60 for 1 second => x=60
    expect(result.x).toBeCloseTo(60, 5);
    expect(result.y).toBe(100);
  });

  it('wraps waypointIndex to 0 after reaching the last waypoint', () => {
    const dt = 1;
    const speed = 200;
    const path = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ];
    // Enemy is at waypoint 1 (last), very close — should snap and wrap to 0
    const state = makeDefaultState({ x: 5, y: 0, facing: 1, data: { waypointIndex: 1 } });
    const ctx = makeDefaultContext({ dt });

    const result = spinnyBehavior.step(state, ctx, { speed, patrolPath: path });

    expect(result.data.waypointIndex).toBe(0);
  });

  it('advances to next waypoint when reaching current target', () => {
    const dt = 1;
    const speed = 100;
    const path = [
      { x: 0, y: 100 },
      { x: 5, y: 100 },
      { x: 10, y: 100 },
    ];
    // Enemy is very close to waypoint 1, should snap and advance to waypoint 2
    const state = makeDefaultState({ x: 5, y: 100, facing: 1, data: { waypointIndex: 1 } });
    const ctx = makeDefaultContext({ dt });

    const result = spinnyBehavior.step(state, ctx, { speed, patrolPath: path });

    expect(result.data.waypointIndex).toBe(2);
  });

  it('is pure: same input produces same output', () => {
    const dt = 1 / 60;
    const speed = 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt });

    const result1 = spinnyBehavior.step(state, ctx, { speed });
    const result2 = spinnyBehavior.step(state, ctx, { speed });

    expect(result1).toEqual(result2);
    // Original state not mutated
    expect(state.x).toBe(100);
    expect(state.facing).toBe(1);
  });

  it('reverses at walls when hitWall detected via solids', () => {
    const dt = 1 / 60;
    const speed = 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    // Simulate a wall directly ahead
    const solids = [{ x: 101, y: 90, width: 16, height: 32 }];
    const ctx = makeDefaultContext({ dt, solids });

    const result = spinnyBehavior.step(state, ctx, { speed });

    // After hitting wall, facing should reverse
    expect(result.facing).toBe(-1);
  });
});
