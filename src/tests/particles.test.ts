import { describe, it, expect } from 'vitest';
import { spawn, advance, cull, step } from '../particles';
import type { Particle } from '../particles';

describe('spawn', () => {
  it('returns count particles', () => {
    const ps = spawn(0, 0, { count: 8, speed: 3, life: 24, size: 4 });
    expect(ps).toHaveLength(8);
  });

  it('all particles start at the origin', () => {
    const ps = spawn(10, 20, { count: 5, speed: 3, life: 24, size: 4 });
    for (const p of ps) {
      expect(p.x).toBe(10);
      expect(p.y).toBe(20);
    }
  });

  it('all particles carry the requested life and maxLife', () => {
    const ps = spawn(0, 0, { count: 3, speed: 3, life: 30, size: 4 });
    for (const p of ps) {
      expect(p.life).toBe(30);
      expect(p.maxLife).toBe(30);
    }
  });

  it('distributes velocities evenly around the circle (count=4)', () => {
    const ps = spawn(0, 0, { count: 4, speed: 1, life: 10, size: 1 });
    expect(ps[0].vx).toBeCloseTo(1, 5);
    expect(ps[0].vy).toBeCloseTo(0, 5);
    expect(ps[1].vx).toBeCloseTo(0, 5);
    expect(ps[1].vy).toBeCloseTo(1, 5);
    expect(ps[2].vx).toBeCloseTo(-1, 5);
    expect(ps[2].vy).toBeCloseTo(0, 5);
    expect(ps[3].vx).toBeCloseTo(0, 5);
    expect(ps[3].vy).toBeCloseTo(-1, 5);
  });

  it('is deterministic when speedJitter is 0 (default)', () => {
    const a = spawn(0, 0, { count: 8, speed: 3, life: 24, size: 4 });
    const b = spawn(0, 0, { count: 8, speed: 3, life: 24, size: 4 });
    expect(a).toEqual(b);
  });

  it('throws when speedJitter > 0 without rng', () => {
    expect(() =>
      spawn(0, 0, { count: 1, speed: 3, speedJitter: 0.2, life: 10, size: 1 }),
    ).toThrow();
  });

  it('returns empty array for count <= 0', () => {
    expect(spawn(0, 0, { count: 0, speed: 3, life: 24, size: 4 })).toEqual([]);
    expect(spawn(0, 0, { count: -5, speed: 3, life: 24, size: 4 })).toEqual([]);
  });

  it('returns empty array for life <= 0', () => {
    expect(spawn(0, 0, { count: 8, speed: 3, life: 0, size: 4 })).toEqual([]);
  });

  it('respects angleOffset', () => {
    const a = spawn(0, 0, { count: 1, speed: 1, life: 10, size: 1, angleOffset: 0 });
    const b = spawn(0, 0, { count: 1, speed: 1, life: 10, size: 1, angleOffset: Math.PI / 2 });
    expect(a[0].vx).toBeCloseTo(1, 5);
    expect(b[0].vy).toBeCloseTo(1, 5);
  });
});

describe('advance', () => {
  it('reduces life by dt', () => {
    const ps = spawn(0, 0, { count: 1, speed: 1, life: 10, size: 1, angleOffset: 0 });
    const next = advance(ps, 1);
    expect(next[0].life).toBe(9);
  });

  it('applies velocity to position', () => {
    const ps = spawn(0, 0, { count: 1, speed: 2, life: 10, size: 1, angleOffset: 0 });
    const next = advance(ps, 1);
    expect(next[0].x).toBeCloseTo(2, 5);
    expect(next[0].y).toBeCloseTo(0, 5);
  });

  it('applies gravity to vy', () => {
    const ps: Particle[] = [
      { x: 0, y: 0, vx: 0, vy: 0, life: 10, maxLife: 10, size: 1 },
    ];
    const next = advance(ps, 1, { gravity: 0.5 });
    expect(next[0].vy).toBeCloseTo(0.5, 5);
    expect(next[0].y).toBeCloseTo(0.5, 5);
  });

  it('applies drag symmetrically to both axes', () => {
    const ps: Particle[] = [
      { x: 0, y: 0, vx: 10, vy: 10, life: 10, maxLife: 10, size: 1 },
    ];
    const next = advance(ps, 1, { drag: 0.5 });
    expect(next[0].vx).toBeCloseTo(5, 5);
    expect(next[0].vy).toBeCloseTo(5, 5);
  });

  it('default drag is 1 (no energy loss)', () => {
    const ps: Particle[] = [
      { x: 0, y: 0, vx: 5, vy: 0, life: 10, maxLife: 10, size: 1 },
    ];
    const next = advance(ps, 1);
    expect(next[0].vx).toBe(5);
  });

  it('does not mutate the input array or its particles', () => {
    const ps = spawn(0, 0, { count: 4, speed: 1, life: 10, size: 1 });
    const original = JSON.parse(JSON.stringify(ps));
    advance(ps, 1, { gravity: 0.3, drag: 0.95 });
    expect(ps).toEqual(original);
  });

  it('preserves maxLife and size across ticks', () => {
    const ps: Particle[] = [
      { x: 0, y: 0, vx: 0, vy: 0, life: 5, maxLife: 10, size: 3, color: '#ff0000' },
    ];
    const next = advance(ps, 1);
    expect(next[0].maxLife).toBe(10);
    expect(next[0].size).toBe(3);
    expect(next[0].color).toBe('#ff0000');
  });
});

describe('cull', () => {
  it('removes dead particles (life <= 0)', () => {
    const ps: Particle[] = [
      { x: 0, y: 0, vx: 0, vy: 0, life: 5, maxLife: 10, size: 1 },
      { x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 10, size: 1 },
      { x: 0, y: 0, vx: 0, vy: 0, life: -3, maxLife: 10, size: 1 },
    ];
    expect(cull(ps)).toHaveLength(1);
  });

  it('keeps particles with life > 0', () => {
    const ps: Particle[] = [
      { x: 0, y: 0, vx: 0, vy: 0, life: 1, maxLife: 10, size: 1 },
    ];
    expect(cull(ps)).toHaveLength(1);
  });

  it('does not mutate the input array', () => {
    const ps: Particle[] = [
      { x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 10, size: 1 },
    ];
    cull(ps);
    expect(ps).toHaveLength(1);
  });
});

describe('step', () => {
  it('advances and culls in one call', () => {
    const ps = spawn(0, 0, { count: 4, speed: 1, life: 1, size: 1 });
    const next = step(ps, 1);
    expect(next).toHaveLength(0);
  });

  it('keeps alive particles', () => {
    const ps = spawn(0, 0, { count: 4, speed: 1, life: 10, size: 1 });
    const next = step(ps, 1);
    expect(next).toHaveLength(4);
    expect(next[0].life).toBe(9);
  });

  it('is pure — input array is unchanged', () => {
    const ps = spawn(0, 0, { count: 4, speed: 1, life: 10, size: 1 });
    const original = JSON.parse(JSON.stringify(ps));
    step(ps, 1, { gravity: 0.2 });
    expect(ps).toEqual(original);
  });
});
