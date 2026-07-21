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
