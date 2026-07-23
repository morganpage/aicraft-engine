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

  // ---------------------------------------------------------------------------
  // Directional deterministic roll — spinAngle accumulation from displacement.
  //
  // spinAngle is persisted on state.data.spinAngle and accumulated from
  // actual horizontal displacement: nextAngle = wrap(prevAngle + dx / RADIUS).
  // Stationary ticks (wall/ledge reversal) preserve the angle. The constant
  // SPINNY_ROLL_RADIUS = 8px (half the 16px default body width).
  // ---------------------------------------------------------------------------

  it('accumulates positive spinAngle for rightward movement (simple patrol)', () => {
    const dt = 1 / 60;
    const speed = 60; // 60 px/s → 1 px per tick
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt });

    const result = spinnyBehavior.step(state, ctx, { speed });

    // dx = speed * dt = 1 px. RADIUS = 8. angle = 1/8 = 0.125 rad.
    const expectedAngle = (speed * dt) / 8;
    expect(typeof result.data.spinAngle).toBe('number');
    expect(result.data.spinAngle).toBeCloseTo(expectedAngle, 10);
  });

  it('accumulates negative spinAngle for leftward movement', () => {
    const dt = 1 / 60;
    const speed = 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: -1 });
    const ctx = makeDefaultContext({ dt });

    const result = spinnyBehavior.step(state, ctx, { speed });

    // dx = -speed * dt = -1 px. raw angle = -1/8 = -0.125 rad.
    // Wrapped into [0, 2π): ((-0.125 % 2π) + 2π) % 2π ≈ 6.158...
    const TWO_PI = Math.PI * 2;
    const rawAngle = -(speed * dt) / 8;
    const expectedAngle = ((rawAngle % TWO_PI) + TWO_PI) % TWO_PI;
    expect(result.data.spinAngle).toBeCloseTo(expectedAngle, 10);
  });

  it('preserves spinAngle on stationary wall-reversal tick (no x change)', () => {
    const dt = 1 / 60;
    const speed = 60;
    // Start with a known accumulated angle
    const initialAngle = 2.5;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1, data: { spinAngle: initialAngle } });
    // Wall directly ahead — forces reversal, no x movement
    const solids = [{ x: 101, y: 90, width: 16, height: 32 }];
    const ctx = makeDefaultContext({ dt, solids });

    const result = spinnyBehavior.step(state, ctx, { speed });

    // Wall reversal: facing flips but x stays at 100 → dx = 0 → angle preserved.
    // Use toBeCloseTo to handle floating-point precision from the wrapping modulo.
    expect(result.data.spinAngle).toBeCloseTo(initialAngle, 10);
  });

  it('preserves spinAngle on stationary ledge-reversal tick (no x change)', () => {
    const dt = 1 / 60;
    const speed = 60;
    const initialAngle = 1.2;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1, data: { spinAngle: initialAngle } });
    const tileQuery = () => 'empty' as const;
    const ctx = makeDefaultContext({ dt, tileQuery, tileSize: 16 });

    const result = spinnyBehavior.step(state, ctx, { speed, ledgeTurnAround: true });

    // Ledge reversal: facing flips but x stays → dx = 0 → angle preserved.
    // Use toBeCloseTo to handle floating-point precision from the wrapping modulo.
    expect(result.data.spinAngle).toBeCloseTo(initialAngle, 10);
  });

  it('deterministic out-and-back: 2 steps forward + 2 steps backward returns to angle 0', () => {
    const dt = 1 / 60;
    const speed = 60;
    const ctx = makeDefaultContext({ dt });

    // Step right 2 ticks
    let state: EnemyState = makeDefaultState({ x: 100, y: 100, facing: 1 });
    state = spinnyBehavior.step(state, ctx, { speed });
    state = spinnyBehavior.step(state, ctx, { speed });
    const angleAfterForward = state.data.spinAngle as number;
    expect(angleAfterForward).toBeCloseTo(2 * (speed * dt) / 8, 10);

    // Step left 2 ticks (flip facing first)
    state = { ...state, facing: -1 as const };
    state = spinnyBehavior.step(state, ctx, { speed });
    state = spinnyBehavior.step(state, ctx, { speed });

    // Net angle should be ~0 (same magnitude, opposite direction).
    expect(state.data.spinAngle).toBeCloseTo(0, 10);
  });

  it('spinAngle wraps into [0, 2π) when crossing 2π boundary', () => {
    const twoPi = Math.PI * 2;
    // Set initial angle close to 2π so one step pushes it over.
    // RADIUS = 8, speed = 60, dt = 1/60 → dx = 1 → dθ = 1/8 = 0.125
    const initialAngle = twoPi - 0.05; // just under 2π
    const dt = 1 / 60;
    const speed = 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1, data: { spinAngle: initialAngle } });
    const ctx = makeDefaultContext({ dt });

    const result = spinnyBehavior.step(state, ctx, { speed });

    const angle = result.data.spinAngle as number;
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThan(twoPi);
    // The angle should have wrapped: initialAngle + 0.125 - 2π
    expect(angle).toBeCloseTo(initialAngle + 0.125 - twoPi, 10);
  });

  it('spinAngle is 0 on first step from default state (no data.spinAngle)', () => {
    const dt = 1 / 60;
    const speed = 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1 });
    const ctx = makeDefaultContext({ dt });

    const result = spinnyBehavior.step(state, ctx, { speed });

    // First step from empty data: prevAngle defaults to 0.
    // angle = 0 + dx/8 = 0.125
    expect(result.data.spinAngle).toBeCloseTo((speed * dt) / 8, 10);
  });

  it('patrolPath mode also accumulates spinAngle from displacement', () => {
    const dt = 1;
    const speed = 60;
    const path = [
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ];
    const state = makeDefaultState({ x: 0, y: 100, facing: 1, data: { waypointIndex: 1 } });
    const ctx = makeDefaultContext({ dt });

    const result = spinnyBehavior.step(state, ctx, { speed, patrolPath: path });

    // dx = 60 (moves 60px toward waypoint 1 at speed 60 for 1s)
    // angle = 0 + 60/8 = 7.5, but wrapped into [0, 2π):
    // 7.5 % (2π) ≈ 1.2168...
    const TWO_PI = Math.PI * 2;
    const rawAngle = 60 / 8;
    const expectedAngle = ((rawAngle % TWO_PI) + TWO_PI) % TWO_PI;
    expect(result.data.spinAngle).toBeCloseTo(expectedAngle, 5);
  });

  it('is pure with spinAngle: same input produces same output', () => {
    const dt = 1 / 60;
    const speed = 60;
    const state = makeDefaultState({ x: 100, y: 100, facing: 1, data: { spinAngle: 1.5 } });
    const ctx = makeDefaultContext({ dt });

    const result1 = spinnyBehavior.step(state, ctx, { speed });
    const result2 = spinnyBehavior.step(state, ctx, { speed });

    expect(result1.data.spinAngle).toBe(result2.data.spinAngle);
    expect(state.data.spinAngle).toBe(1.5); // original not mutated
  });
});
