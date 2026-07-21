import { describe, it, expect } from 'vitest';
import { turretBehavior } from '../platformer/enemy/registry';
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

describe('turretBehavior', () => {
  it('spawns a projectile in "fixed" mode when fireCooldown has elapsed', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ data: { fireCooldown: 0 } });
    const ctx = makeDefaultContext({ dt });

    const result = turretBehavior.step(state, ctx, {
      fireRate: 1,
      projectileSpeed: 120,
      projectileSize: 6,
      aimMode: 'fixed',
      aimDirection: { x: 1, y: 0 },
    });

    expect(result.projectile).toBeDefined();
    expect(result.projectile!.vx).toBe(120);
    expect(result.projectile!.vy).toBe(0);
    expect(result.projectile!.width).toBe(6);
    expect(result.projectile!.height).toBe(6);
  });

  it('does NOT spawn a projectile when fireCooldown has NOT elapsed', () => {
    const dt = 1 / 60;
    // fireCooldown is still positive (not ready yet)
    const state = makeDefaultState({ data: { fireCooldown: 0.5 } });
    const ctx = makeDefaultContext({ dt });

    const result = turretBehavior.step(state, ctx, {
      fireRate: 1,
      projectileSpeed: 120,
      projectileSize: 6,
      aimMode: 'fixed',
      aimDirection: { x: 1, y: 0 },
    });

    expect(result.projectile).toBeUndefined();
  });

  it('spawns projectile at correct position (center of enemy + half size offset)', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({
      x: 100,
      y: 100,
      data: { fireCooldown: 0 },
    });
    const ctx = makeDefaultContext({ dt });

    const result = turretBehavior.step(state, ctx, {
      fireRate: 1,
      projectileSpeed: 120,
      projectileSize: 6,
      aimMode: 'fixed',
      aimDirection: { x: 1, y: 0 },
    });

    // Enemy is implicitly 16x16 (default). Projectile spawns at center.
    // Projectile x = enemy.x + enemyWidth/2 - projectileSize/2 = 100 + 8 - 3 = 105
    // Projectile y = enemy.y + enemyHeight/2 - projectileSize/2 = 100 + 8 - 3 = 105
    expect(result.projectile!.x).toBeCloseTo(105, 5);
    expect(result.projectile!.y).toBeCloseTo(105, 5);
  });

  it('resets fireCooldown to 1/fireRate after firing', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ data: { fireCooldown: 0 } });
    const ctx = makeDefaultContext({ dt });

    const result = turretBehavior.step(state, ctx, {
      fireRate: 2,
      projectileSpeed: 120,
      projectileSize: 6,
      aimMode: 'fixed',
      aimDirection: { x: 1, y: 0 },
    });

    // fireRate=2 → cooldown = 1/2 = 0.5
    expect(result.data.fireCooldown).toBeCloseTo(0.5, 5);
  });

  it('"aimed" mode: fires toward player when within detectionRadius', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ x: 100, y: 100, data: { fireCooldown: 0 } });
    // Player is to the right and slightly below
    const ctx = makeDefaultContext({
      dt,
      playerRect: { x: 200, y: 110, width: 16, height: 16 },
    });

    const result = turretBehavior.step(state, ctx, {
      fireRate: 1,
      projectileSpeed: 120,
      projectileSize: 6,
      aimMode: 'aimed',
      detectionRadius: 200,
    });

    expect(result.projectile).toBeDefined();
    // Projectile should be aimed toward the player (positive vx, small positive vy)
    expect(result.projectile!.vx).toBeGreaterThan(0);
  });

  it('"aimed" mode: does NOT fire when player is outside detectionRadius', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ x: 100, y: 100, data: { fireCooldown: 0 } });
    // Player is far away
    const ctx = makeDefaultContext({
      dt,
      playerRect: { x: 500, y: 500, width: 16, height: 16 },
    });

    const result = turretBehavior.step(state, ctx, {
      fireRate: 1,
      projectileSpeed: 120,
      projectileSize: 6,
      aimMode: 'aimed',
      detectionRadius: 100,
    });

    expect(result.projectile).toBeUndefined();
  });

  it('"aimed" mode: does NOT fire when playerRect is null', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ x: 100, y: 100, data: { fireCooldown: 0 } });
    const ctx = makeDefaultContext({ dt, playerRect: null });

    const result = turretBehavior.step(state, ctx, {
      fireRate: 1,
      projectileSpeed: 120,
      projectileSize: 6,
      aimMode: 'aimed',
      detectionRadius: 200,
    });

    expect(result.projectile).toBeUndefined();
  });

  it('is pure: same input produces same output', () => {
    const dt = 1 / 60;
    const state = makeDefaultState({ data: { fireCooldown: 0 } });
    const ctx = makeDefaultContext({ dt });
    const props = {
      fireRate: 1,
      projectileSpeed: 120,
      projectileSize: 6,
      aimMode: 'fixed' as const,
      aimDirection: { x: 1, y: 0 },
    };

    const result1 = turretBehavior.step(state, ctx, props);
    const result2 = turretBehavior.step(state, ctx, props);

    expect(result1).toEqual(result2);
  });
});
