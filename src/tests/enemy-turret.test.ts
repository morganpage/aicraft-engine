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

// ---------------------------------------------------------------------------
// shootTo resolution tests — direction + range from params.shootTo
// ---------------------------------------------------------------------------

describe('turretBehavior — shootTo resolution (fixed mode)', () => {
  it('uses shootTo for direction and attaches maxRange + distanceTraveled', () => {
    const state = makeDefaultState({ data: { fireCooldown: 0 } });
    const ctx = makeDefaultContext();
    const result = turretBehavior.step(state, ctx, {
      fireRate: 1,
      projectileSpeed: 120,
      projectileSize: 6,
      aimMode: 'fixed',
      shootTo: { x: 128, y: 0 },
    });
    expect(result.projectile).toBeDefined();
    // shootTo magnitude = 128, direction = (1, 0)
    expect(result.projectile!.vx).toBeCloseTo(120, 5);
    expect(result.projectile!.vy).toBeCloseTo(0, 5);
    expect(result.projectile!.maxRange).toBeCloseTo(128, 5);
    expect(result.projectile!.distanceTraveled).toBe(0);
  });

  it('normalizes diagonal shootTo and sets correct maxRange', () => {
    const state = makeDefaultState({ data: { fireCooldown: 0 } });
    const ctx = makeDefaultContext();
    const result = turretBehavior.step(state, ctx, {
      fireRate: 1,
      projectileSpeed: 100,
      projectileSize: 6,
      aimMode: 'fixed',
      shootTo: { x: 100, y: 100 },
    });
    expect(result.projectile).toBeDefined();
    const mag = Math.hypot(100, 100);
    expect(result.projectile!.vx).toBeCloseTo((100 / mag) * 100, 5);
    expect(result.projectile!.vy).toBeCloseTo((100 / mag) * 100, 5);
    expect(result.projectile!.maxRange).toBeCloseTo(mag, 5);
  });

  it('preserves zero x-component in shootTo {x:0, y:120}', () => {
    const state = makeDefaultState({ data: { fireCooldown: 0 } });
    const ctx = makeDefaultContext();
    const result = turretBehavior.step(state, ctx, {
      fireRate: 1,
      projectileSpeed: 60,
      projectileSize: 6,
      aimMode: 'fixed',
      shootTo: { x: 0, y: 120 },
    });
    expect(result.projectile).toBeDefined();
    // Direction should be (0, 1), not (1, 0) — zero x preserved
    expect(result.projectile!.vx).toBeCloseTo(0, 5);
    expect(result.projectile!.vy).toBeCloseTo(60, 5);
    expect(result.projectile!.maxRange).toBeCloseTo(120, 5);
  });

  it('falls back to aimDirection when shootTo is missing', () => {
    const state = makeDefaultState({ data: { fireCooldown: 0 } });
    const ctx = makeDefaultContext();
    const result = turretBehavior.step(state, ctx, {
      fireRate: 1,
      projectileSpeed: 120,
      projectileSize: 6,
      aimMode: 'fixed',
      aimDirection: { x: -1, y: 0 },
    });
    expect(result.projectile).toBeDefined();
    expect(result.projectile!.vx).toBeCloseTo(-120, 5);
    expect(result.projectile!.vy).toBeCloseTo(0, 5);
    expect(result.projectile!.maxRange).toBeUndefined();
    expect(result.projectile!.distanceTraveled).toBeUndefined();
  });

  it('falls back to aimDirection when shootTo is zero-length {x:0, y:0}', () => {
    const state = makeDefaultState({ data: { fireCooldown: 0 } });
    const ctx = makeDefaultContext();
    const result = turretBehavior.step(state, ctx, {
      fireRate: 1,
      projectileSpeed: 120,
      projectileSize: 6,
      aimMode: 'fixed',
      aimDirection: { x: 0, y: -1 },
      shootTo: { x: 0, y: 0 },
    });
    expect(result.projectile).toBeDefined();
    expect(result.projectile!.vx).toBeCloseTo(0, 5);
    expect(result.projectile!.vy).toBeCloseTo(-120, 5);
    expect(result.projectile!.maxRange).toBeUndefined();
  });

  it('falls back to aimDirection when shootTo has NaN component', () => {
    const state = makeDefaultState({ data: { fireCooldown: 0 } });
    const ctx = makeDefaultContext();
    const result = turretBehavior.step(state, ctx, {
      fireRate: 1,
      projectileSpeed: 120,
      projectileSize: 6,
      aimMode: 'fixed',
      aimDirection: { x: 1, y: 0 },
      shootTo: { x: NaN, y: 50 },
    });
    expect(result.projectile).toBeDefined();
    expect(result.projectile!.vx).toBeCloseTo(120, 5);
    expect(result.projectile!.maxRange).toBeUndefined();
  });

  it('falls back to aimDirection when shootTo is not an object', () => {
    const state = makeDefaultState({ data: { fireCooldown: 0 } });
    const ctx = makeDefaultContext();
    const result = turretBehavior.step(state, ctx, {
      fireRate: 1,
      projectileSpeed: 120,
      projectileSize: 6,
      aimMode: 'fixed',
      aimDirection: { x: 1, y: 0 },
      shootTo: 'invalid',
    });
    expect(result.projectile).toBeDefined();
    expect(result.projectile!.vx).toBeCloseTo(120, 5);
    expect(result.projectile!.maxRange).toBeUndefined();
  });

  it('aimed mode ignores shootTo completely', () => {
    const state = makeDefaultState({ x: 100, y: 100, data: { fireCooldown: 0 } });
    const ctx = makeDefaultContext({
      playerRect: { x: 200, y: 100, width: 16, height: 16 },
    });
    const result = turretBehavior.step(state, ctx, {
      fireRate: 1,
      projectileSpeed: 120,
      projectileSize: 6,
      aimMode: 'aimed',
      detectionRadius: 200,
      shootTo: { x: 0, y: 128 },
    });
    expect(result.projectile).toBeDefined();
    // Should fire toward player (right), NOT downward per shootTo
    expect(result.projectile!.vx).toBeGreaterThan(0);
    // Aimed mode: maxRange always 0 (unbounded)
    expect(result.projectile!.maxRange).toBeUndefined();
  });

  it('aimed mode: projectile has no maxRange (always unbounded)', () => {
    const state = makeDefaultState({ x: 100, y: 100, data: { fireCooldown: 0 } });
    const ctx = makeDefaultContext({
      playerRect: { x: 200, y: 100, width: 16, height: 16 },
    });
    const result = turretBehavior.step(state, ctx, {
      fireRate: 1,
      projectileSpeed: 120,
      projectileSize: 6,
      aimMode: 'aimed',
      detectionRadius: 200,
    });
    expect(result.projectile).toBeDefined();
    expect(result.projectile!.maxRange).toBeUndefined();
    expect(result.projectile!.distanceTraveled).toBeUndefined();
  });
});
