/**
 * `particleColorAt` + the `colorEnd` carry-through (src/particles/lifetime.ts,
 * types.ts, spawn.ts, advance.ts). The fade used to require a game-side tag
 * re-stamped after every advance (advance drops unknown fields); now the field
 * is engine-owned end to end.
 */
import { describe, expect, it } from 'vitest';
import { advance, particleColorAt, spawn, stepSeconds, type Particle } from '../index';

describe('particleColorAt — the color-fade reader', () => {
  it('returns color at spawn and colorEnd at death, lerping between', () => {
    const p: Particle = { x: 0, y: 0, vx: 0, vy: 0, life: 100, maxLife: 100, size: 2, color: '#000000', colorEnd: '#ffffff' };
    expect(particleColorAt(p)).toBe('#000000');
    const half = { ...p, life: 50 };
    expect(particleColorAt(half)).toBe('#808080');
    const dying = { ...p, life: 0 };
    expect(particleColorAt(dying)).toBe('#ffffff');
  });

  it('a shorthand (#rgb) endpoint is not parseable — falls back to the other endpoint', () => {
    // The engine's color utilities parse `#rrggbb` only; a shorthand endpoint
    // degrades to the constant other endpoint instead of throwing.
    const p: Particle = { x: 0, y: 0, vx: 0, vy: 0, life: 50, maxLife: 100, size: 1, color: '#000000', colorEnd: '#fff' };
    expect(particleColorAt(p)).toBe('#000000');
  });

  it('no colorEnd → constant color', () => {
    const p: Particle = { x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 100, size: 1, color: '#ff0000' };
    expect(particleColorAt(p)).toBe('#ff0000');
  });

  it('falls back to the renderer default when neither endpoint parses', () => {
    const p: Particle = { x: 0, y: 0, vx: 0, vy: 0, life: 50, maxLife: 100, size: 1, color: 'red', colorEnd: 'blue' };
    expect(particleColorAt(p, '#abcdef')).toBe('#abcdef');
  });

  it('clamps out-of-range ages (over-life particles fade fully)', () => {
    const p: Particle = { x: 0, y: 0, vx: 0, vy: 0, life: 140, maxLife: 100, size: 1, color: '#000000', colorEnd: '#ffffff' };
    expect(particleColorAt(p)).toBe('#000000');
  });
});

describe('colorEnd — engine-owned carry-through', () => {
  it('spawn stamps it and advance preserves it (no more re-stamp workaround)', () => {
    let live = spawn(0, 0, { count: 2, speed: 1, life: 3, size: 2, color: '#cfd8ea', colorEnd: '#8a94ad' });
    expect(live.every((p) => p.colorEnd === '#8a94ad')).toBe(true);
    live = advance(live, 1, {});
    expect(live.every((p) => p.colorEnd === '#8a94ad')).toBe(true);
    live = advance(live, 1, {});
    expect(live.every((p) => p.colorEnd === '#8a94ad')).toBe(true);
  });

  it('the seconds pipeline preserves it too', () => {
    let live = spawn(0, 0, { count: 1, speed: 0.5, life: 10, size: 1, color: '#ffffff', colorEnd: '#000000' });
    for (let i = 0; i < 4; i += 1) live = stepSeconds(live, 1 / 60);
    expect(live[0].colorEnd).toBe('#000000');
  });
});
