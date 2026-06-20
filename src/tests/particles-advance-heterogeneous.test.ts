import { describe, it, expect } from 'vitest';
import { advance } from '../particles';
import type { Particle } from '../particles';

const baseParticle = (): Particle => ({
  x: 0,
  y: 0,
  vx: 5,
  vy: 0,
  life: 10,
  maxLife: 10,
  size: 1,
});

describe('advance — byte-identity for particles without gravityScale/dragScale', () => {
  it('produces the same numeric output as the pre-extension math', () => {
    const ps: Particle[] = [baseParticle()];
    const out = advance(ps, 1, { gravity: 0.3, drag: 0.9 });
    // dragFactor = 0.9^1 = 0.9
    // vx = 5 * 0.9 = 4.5
    // vy = (0 + 0.3 * 1) * 0.9 = 0.27
    // x  = 0 + 4.5 * 1 = 4.5
    // y  = 0 + 0.27 * 1 = 0.27
    expect(out[0].x).toBeCloseTo(4.5, 10);
    expect(out[0].y).toBeCloseTo(0.27, 10);
    expect(out[0].vx).toBeCloseTo(4.5, 10);
    expect(out[0].vy).toBeCloseTo(0.27, 10);
    expect(out[0].life).toBe(9);
    expect(out[0].maxLife).toBe(10);
    expect(out[0].size).toBe(1);
  });

  it('matches a hand-written snapshot of the pre-extension return shape', () => {
    const ps: Particle[] = [baseParticle()];
    const out = advance(ps, 1, { gravity: 0.3, drag: 0.9 });
    expect(out[0]).toEqual({
      x: 4.5,
      y: 0.27,
      vx: 4.5,
      vy: 0.27,
      life: 9,
      maxLife: 10,
      size: 1,
    });
  });

  it('defers to dt=1, no-opts default (gravity 0, drag 1): pure translation', () => {
    const ps: Particle[] = [baseParticle()];
    const out = advance(ps, 1);
    expect(out[0]).toEqual({
      x: 5,
      y: 0,
      vx: 5,
      vy: 0,
      life: 9,
      maxLife: 10,
      size: 1,
    });
  });

  it('existing fields (color) round-trip when no scales are set', () => {
    const ps: Particle[] = [
      { x: 0, y: 0, vx: 0, vy: 0, life: 5, maxLife: 5, size: 2, color: '#ff0000' },
    ];
    const out = advance(ps, 1);
    expect(out[0].color).toBe('#ff0000');
  });
});

describe('advance — gravityScale', () => {
  it('gravityScale = 0 cancels world gravity entirely', () => {
    const ps: Particle[] = [
      { ...baseParticle(), vx: 0, vy: 0, gravityScale: 0 },
    ];
    const out = advance(ps, 1, { gravity: 0.5 });
    expect(out[0].vy).toBe(0);
    expect(out[0].y).toBe(0);
  });

  it('gravityScale = 2 doubles world gravity', () => {
    const ps0: Particle[] = [{ ...baseParticle(), vx: 0, vy: 0, gravityScale: 1 }];
    const ps2: Particle[] = [{ ...baseParticle(), vx: 0, vy: 0, gravityScale: 2 }];
    const o0 = advance(ps0, 1, { gravity: 0.3 })[0];
    const o2 = advance(ps2, 1, { gravity: 0.3 })[0];
    expect(o2.vy).toBeCloseTo(o0.vy * 2, 10);
  });

  it('negative gravityScale inverts world gravity (rises instead of falls)', () => {
    const ps: Particle[] = [
      { ...baseParticle(), vx: 0, vy: 0, gravityScale: -1 },
    ];
    const out = advance(ps, 1, { gravity: 0.5 });
    // vy = (-1 * 0.5 * 1) = -0.5 → particle moves up (negative y in Canvas2D)
    expect(out[0].vy).toBeCloseTo(-0.5, 10);
    expect(out[0].y).toBeCloseTo(-0.5, 10);
  });
});

describe('advance — dragScale', () => {
  it('dragScale = 0.5 halves the drag effect vs scale=1 at the same world drag', () => {
    const mk = (dragScale: number): Particle[] => [
      { ...baseParticle(), vx: 10, vy: 0, dragScale },
    ];
    const full = advance(mk(1), 1, { drag: 0.5 })[0];
    const half = advance(mk(0.5), 1, { drag: 0.5 })[0];
    // full drag: 0.5^1 = 0.5 → vx = 5; half drag: 0.25^1 = 0.25 → vx = 2.5
    expect(full.vx).toBeCloseTo(5, 10);
    expect(half.vx).toBeCloseTo(2.5, 10);
  });

  it('dragScale = 1 with world drag = 1 produces no energy loss', () => {
    const ps: Particle[] = [{ ...baseParticle(), vx: 7, vy: 0, dragScale: 1 }];
    const out = advance(ps, 1, { drag: 1 });
    expect(out[0].vx).toBe(7);
  });
});

describe('advance — scale field preservation across ticks', () => {
  it('carries gravityScale/dragScale through to the output object', () => {
    const ps: Particle[] = [
      { ...baseParticle(), gravityScale: 0.6, dragScale: 0.98 },
    ];
    const out = advance(ps, 1, { gravity: 0.5, drag: 1.0 });
    expect(out[0].gravityScale).toBe(0.6);
    expect(out[0].dragScale).toBe(0.98);
  });

  it('preserves scales across two chained ticks (the trap the decision warned about)', () => {
    let ps: Particle[] = [
      { ...baseParticle(), vx: 0, vy: -2, gravityScale: -0.4, dragScale: 0.95 },
    ];
    const tick1 = advance(ps, 1, { gravity: 0.5, drag: 1.0 });
    const tick2 = advance(tick1, 1, { gravity: 0.5, drag: 1.0 });
    // If scales were dropped after tick 1, tick 2 would treat the particle as
    // scale=1.0 and its vy would differ. Assert the scales survive.
    expect(tick2[0].gravityScale).toBe(-0.4);
    expect(tick2[0].dragScale).toBe(0.95);
    // And the integrated vy reflects the carried scale (not scale=1.0):
    // after tick1: vy = (-2 + (-0.4*0.5)) * (1.0*0.95)^1 = -2.2 * 0.95 = -2.09
    expect(tick1[0].vy).toBeCloseTo(-2.09, 10);
    // after tick2 from tick1.vy with same scale:
    //   vy = (-2.09 + (-0.2)) * 0.95 = -2.29 * 0.95 = -2.1755
    expect(tick2[0].vy).toBeCloseTo(-2.1755, 10);
  });
});

describe('advance — purity', () => {
  it('does not mutate the input particle', () => {
    const ps: Particle[] = [
      { ...baseParticle(), vx: 3, vy: 4, gravityScale: 0.5, dragScale: 0.9 },
    ];
    const snap = JSON.parse(JSON.stringify(ps));
    advance(ps, 1, { gravity: 0.5, drag: 0.9 });
    expect(ps).toEqual(snap);
  });
});
