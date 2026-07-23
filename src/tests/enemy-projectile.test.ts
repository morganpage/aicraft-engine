import { describe, it, expect } from 'vitest';
import { stepProjectile } from '../platformer/enemy/projectile';
import type { ProjectileState } from '../platformer/enemy/types';

function makeProjectile(overrides?: Partial<ProjectileState>): ProjectileState {
  return {
    x: 100,
    y: 100,
    vx: 120,
    vy: 0,
    width: 6,
    height: 6,
    alive: true,
    ...overrides,
  };
}

describe('stepProjectile', () => {
  it('moves by vx * dt on x-axis', () => {
    const p = makeProjectile({ x: 100, vx: 120 });
    const result = stepProjectile(p, 1 / 60, []);

    expect(result.x).toBeCloseTo(100 + 120 * (1 / 60), 5);
    expect(result.y).toBe(100);
  });

  it('moves by vy * dt on y-axis', () => {
    const p = makeProjectile({ y: 100, vx: 0, vy: -60 });
    const result = stepProjectile(p, 1 / 60, []);

    expect(result.y).toBeCloseTo(100 + -60 * (1 / 60), 5);
  });

  it('deactivates on solid collision (alive=false)', () => {
    const p = makeProjectile({ x: 100, vx: 120 });
    // Solid overlapping with the projectile's next position
    const solids = [{ x: 100, y: 99, width: 20, height: 8 }];
    const result = stepProjectile(p, 1 / 60, solids);

    expect(result.alive).toBe(false);
  });

  it('returns hitPlayer=true on overlap with player rect', () => {
    const p = makeProjectile({ x: 100, y: 100, vx: 0, vy: 0 });
    const playerRect = { x: 99, y: 99, width: 16, height: 16 };
    const result = stepProjectile(p, 1 / 60, [], playerRect);

    expect(result.hitPlayer).toBe(true);
  });

  it('returns hitPlayer=false when no overlap with player rect', () => {
    const p = makeProjectile({ x: 100, y: 100, vx: 0, vy: 0 });
    const playerRect = { x: 500, y: 500, width: 16, height: 16 };
    const result = stepProjectile(p, 1 / 60, [], playerRect);

    expect(result.hitPlayer).toBe(false);
  });

  it('returns hitPlayer=false when no playerRect provided', () => {
    const p = makeProjectile({ x: 100, y: 100, vx: 0, vy: 0 });
    const result = stepProjectile(p, 1 / 60, []);

    expect(result.hitPlayer).toBe(false);
  });

  it('alive=false projectile passes through unchanged', () => {
    const p = makeProjectile({ x: 100, y: 100, vx: 120, alive: false });
    const result = stepProjectile(p, 1 / 60, []);

    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
    expect(result.alive).toBe(false);
  });

  it('is pure: same input produces same output', () => {
    const p = makeProjectile({ x: 100, vx: 120 });
    const result1 = stepProjectile(p, 1 / 60, []);
    const result2 = stepProjectile(p, 1 / 60, []);

    expect(result1).toEqual(result2);
    // Original not mutated
    expect(p.x).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Range clamping tests — maxRange / distanceTraveled
// ---------------------------------------------------------------------------

describe('stepProjectile — range clamping', () => {
  it('legacy projectile (no maxRange) has no distanceTraveled on result', () => {
    const p = makeProjectile({ x: 100, y: 100, vx: 120, vy: 0 });
    const result = stepProjectile(p, 1 / 60, []);
    expect(result.maxRange).toBeUndefined();
    expect(result.distanceTraveled).toBeUndefined();
  });

  it('range-limited projectile accumulates distanceTraveled', () => {
    const p = makeProjectile({
      x: 100, y: 100, vx: 120, vy: 0,
      maxRange: 200, distanceTraveled: 0,
    });
    const dt = 1 / 60;
    const expectedDist = 120 * dt; // vx * dt
    const result = stepProjectile(p, dt, []);
    expect(result.alive).toBe(true);
    expect(result.distanceTraveled).toBeCloseTo(expectedDist, 5);
    expect(result.maxRange).toBeCloseTo(200, 5);
  });

  it('distance accumulates across multiple ticks', () => {
    let p = makeProjectile({
      x: 100, y: 100, vx: 120, vy: 0,
      maxRange: 200, distanceTraveled: 0,
    });
    const dt = 1 / 60;
    for (let i = 0; i < 10; i++) {
      const result = stepProjectile(p, dt, []);
      expect(result.alive).toBe(true);
      p = result;
    }
    // 10 ticks × (120 px/s × 1/60 s) = 20px
    expect(p.distanceTraveled).toBeCloseTo(20, 3);
  });

  it('deactivates when distanceTraveled exceeds maxRange (range exceeded)', () => {
    const p = makeProjectile({
      x: 100, y: 100, vx: 120, vy: 0,
      maxRange: 1, distanceTraveled: 0,
    });
    const dt = 1 / 60;
    // One tick travels 2px, which exceeds maxRange=1
    const result = stepProjectile(p, dt, []);
    expect(result.alive).toBe(false);
    // Fields preserved on deactivation
    expect(result.maxRange).toBeCloseTo(1, 5);
  });

  it('clamps final position exactly to remaining range (zero overshoot) — horizontal', () => {
    // Projectile at x=100, maxRange=10, already traveled 8 → remaining=2
    // Velocity = (120, 0), dt=1/60 → tick distance=2 → should land exactly at range boundary
    const p = makeProjectile({
      x: 100, y: 100, vx: 120, vy: 0,
      maxRange: 10, distanceTraveled: 8,
    });
    const dt = 1 / 60;
    const result = stepProjectile(p, dt, []);
    expect(result.alive).toBe(false);
    // Final position should be exactly at range boundary
    // remaining range = 10 - 8 = 2px along direction (1,0)
    // final x = 100 + (120/120) * 2 = 102
    const expectedFinalX = 100 + 1 * 2;
    expect(result.x).toBeCloseTo(expectedFinalX, 5);
    expect(result.y).toBeCloseTo(100, 5);
  });

  it('clamps final position exactly to remaining range (zero overshoot) — vertical', () => {
    const p = makeProjectile({
      x: 100, y: 100, vx: 0, vy: -200,
      maxRange: 10, distanceTraveled: 7,
    });
    const dt = 1 / 60;
    const result = stepProjectile(p, dt, []);
    expect(result.alive).toBe(false);
    // remaining = 3px along direction (0, -1)
    // final y = 100 + (-1) * 3 = 97
    const expectedFinalY = 100 + (-1) * 3;
    expect(result.x).toBeCloseTo(100, 5);
    expect(result.y).toBeCloseTo(expectedFinalY, 5);
  });

  it('clamps final position exactly to remaining range (zero overshoot) — diagonal', () => {
    const dirX = 1 / Math.sqrt(2);
    const dirY = 1 / Math.sqrt(2);
    const speed = 100;
    const p = makeProjectile({
      x: 100, y: 100,
      vx: dirX * speed, vy: dirY * speed,
      maxRange: 20, distanceTraveled: 19,
    });
    const dt = 1 / 60;
    const result = stepProjectile(p, dt, []);
    expect(result.alive).toBe(false);
    // remaining = 1px along direction
    const expectedFinalX = 100 + dirX * 1;
    const expectedFinalY = 100 + dirY * 1;
    expect(result.x).toBeCloseTo(expectedFinalX, 5);
    expect(result.y).toBeCloseTo(expectedFinalY, 5);
  });

  it('player hit deactivates projectile', () => {
    const p = makeProjectile({
      x: 100, y: 100, vx: 0, vy: 0,
    });
    const playerRect = { x: 95, y: 95, width: 16, height: 16 };
    const result = stepProjectile(p, 1 / 60, [], playerRect);
    expect(result.hitPlayer).toBe(true);
    expect(result.alive).toBe(false);
  });

  it('player hit preserves maxRange and distanceTraveled', () => {
    const p = makeProjectile({
      x: 100, y: 100, vx: 0, vy: 0,
      maxRange: 50, distanceTraveled: 10,
    });
    const playerRect = { x: 95, y: 95, width: 16, height: 16 };
    const result = stepProjectile(p, 1 / 60, [], playerRect);
    expect(result.hitPlayer).toBe(true);
    expect(result.alive).toBe(false);
    expect(result.maxRange).toBeCloseTo(50, 5);
    expect(result.distanceTraveled).toBeCloseTo(10, 5);
  });

  it('solid hit preserves maxRange and distanceTraveled', () => {
    const p = makeProjectile({
      x: 100, y: 100, vx: 120, vy: 0,
      maxRange: 50, distanceTraveled: 10,
    });
    const solids = [{ x: 101, y: 99, width: 20, height: 8 }];
    const result = stepProjectile(p, 1 / 60, solids);
    expect(result.alive).toBe(false);
    expect(result.maxRange).toBeCloseTo(50, 5);
    // distanceTraveled includes the current tick: 10 + 120*(1/60) = 12
    expect(result.distanceTraveled).toBeCloseTo(12, 5);
  });

  it('precedence: solid hit takes priority over player hit', () => {
    const p = makeProjectile({
      x: 100, y: 100, vx: 0, vy: 0,
    });
    const solids = [{ x: 99, y: 99, width: 16, height: 16 }];
    const playerRect = { x: 99, y: 99, width: 16, height: 16 };
    const result = stepProjectile(p, 1 / 60, solids, playerRect);
    expect(result.alive).toBe(false);
    // hitPlayer should be false because solid deactivates first
    expect(result.hitPlayer).toBe(false);
  });

  it('dead projectile preserves maxRange/distanceTraveled on pass-through', () => {
    const p = makeProjectile({
      x: 100, y: 100, vx: 120, alive: false,
      maxRange: 50, distanceTraveled: 30,
    });
    const result = stepProjectile(p, 1 / 60, []);
    expect(result.alive).toBe(false);
    expect(result.maxRange).toBeCloseTo(50, 5);
    expect(result.distanceTraveled).toBeCloseTo(30, 5);
    expect(result.x).toBe(100);
  });
});
