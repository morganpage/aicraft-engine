import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../rng';
import { sampleRegion, type SpawnRegion } from '../particles';

function countingRng(rng: () => number): { rng: () => number; draws: () => number } {
  let n = 0;
  return {
    rng: () => {
      n++;
      return rng();
    },
    draws: () => n,
  };
}

describe('sampleRegion — point', () => {
  it('returns the origin relative to the emitter', () => {
    const { rng, draws } = countingRng(mulberry32(1));
    const p = sampleRegion({ type: 'point' }, rng);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
    expect(draws()).toBe(0);
  });
});

describe('sampleRegion — line', () => {
  it('returns a point on the segment between the endpoints', () => {
    const region: SpawnRegion = { type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
    const p = sampleRegion(region, mulberry32(7));
    expect(p.y).toBe(0);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(10);
  });

  it('consumes exactly 1 rng draw per sample', () => {
    const { rng, draws } = countingRng(mulberry32(2));
    sampleRegion({ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }, rng);
    expect(draws()).toBe(1);
  });

  it('is deterministic given the same rng stream', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const region: SpawnRegion = { type: 'line', x1: 5, y1: 3, x2: 9, y2: 7 };
    expect(sampleRegion(region, a)).toEqual(sampleRegion(region, b));
  });

  it('reaches both endpoints for t=0 and t=1 (manual draw injection)', () => {
    let v = 0;
    const zero = () => v;
    const atStart = sampleRegion({ type: 'line', x1: 2, y1: 4, x2: 8, y2: 10 }, zero);
    expect(atStart).toEqual({ x: 2, y: 4 });

    v = 1;
    const atEnd = sampleRegion({ type: 'line', x1: 2, y1: 4, x2: 8, y2: 10 }, zero);
    expect(atEnd).toEqual({ x: 8, y: 10 });
  });
});

describe('sampleRegion — rect', () => {
  it('returns a point within the rectangle bounds', () => {
    const region: SpawnRegion = { type: 'rect', x: 5, y: 6, w: 10, h: 8 };
    for (let i = 0; i < 20; i++) {
      const p = sampleRegion(region, mulberry32(i + 1));
      expect(p.x).toBeGreaterThanOrEqual(5);
      expect(p.x).toBeLessThanOrEqual(15);
      expect(p.y).toBeGreaterThanOrEqual(6);
      expect(p.y).toBeLessThanOrEqual(14);
    }
  });

  it('consumes exactly 2 rng draws per sample', () => {
    const { rng, draws } = countingRng(mulberry32(3));
    sampleRegion({ type: 'rect', x: 0, y: 0, w: 5, h: 5 }, rng);
    expect(draws()).toBe(2);
  });

  it('is deterministic given the same rng stream', () => {
    const region: SpawnRegion = { type: 'rect', x: 1, y: 2, w: 3, h: 4 };
    expect(sampleRegion(region, mulberry32(42))).toEqual(
      sampleRegion(region, mulberry32(42)),
    );
  });
});

describe('sampleRegion — circle', () => {
  it('returns a point within radius of the center', () => {
    const region: SpawnRegion = { type: 'circle', cx: 10, cy: 10, radius: 5 };
    for (let i = 0; i < 30; i++) {
      const p = sampleRegion(region, mulberry32(i + 1));
      const d = Math.hypot(p.x - 10, p.y - 10);
      expect(d).toBeLessThanOrEqual(5);
    }
  });

  it('consumes exactly 2 rng draws per sample', () => {
    const { rng, draws } = countingRng(mulberry32(4));
    sampleRegion({ type: 'circle', cx: 0, cy: 0, radius: 3 }, rng);
    expect(draws()).toBe(2);
  });

  it('with innerRadius produces points in the ring [inner, outer]', () => {
    const region: SpawnRegion = {
      type: 'circle',
      cx: 0,
      cy: 0,
      radius: 10,
      innerRadius: 6,
    };
    for (let i = 0; i < 40; i++) {
      const p = sampleRegion(region, mulberry32(i + 1));
      const d = Math.hypot(p.x, p.y);
      expect(d).toBeGreaterThanOrEqual(6 - 1e-6);
      expect(d).toBeLessThanOrEqual(10 + 1e-6);
    }
  });

  it('is deterministic given the same rng stream', () => {
    const region: SpawnRegion = { type: 'circle', cx: 3, cy: 4, radius: 7 };
    expect(sampleRegion(region, mulberry32(42))).toEqual(
      sampleRegion(region, mulberry32(42)),
    );
  });
});

describe('sampleRegion — determinism across runs', () => {
  it('reproduces an identical sequence of 50 samples from the same seed', () => {
    const region: SpawnRegion = { type: 'circle', cx: 0, cy: 0, radius: 20 };
    const run = () => {
      const rng = mulberry32(123);
      const out = [];
      for (let i = 0; i < 50; i++) out.push(sampleRegion(region, rng));
      return out;
    };
    expect(run()).toEqual(run());
  });
});
