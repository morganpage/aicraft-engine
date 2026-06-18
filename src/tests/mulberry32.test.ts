import { describe, it, expect } from 'vitest';
import { mulberry32, nextInt, nextFloat, nextSign, pick } from '../rng/mulberry32';

describe('mulberry32', () => {
  it('produces deterministic sequence from same seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });
  it('produces different sequences from different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let differences = 0;
    for (let i = 0; i < 100; i++) {
      if (a() !== b()) differences++;
    }
    expect(differences).toBeGreaterThan(90);
  });
  it('outputs are in [0, 1)', () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('handles seed of 0', () => {
    const rng = mulberry32(0);
    expect(rng()).toBeGreaterThanOrEqual(0);
    expect(rng()).toBeLessThan(1);
  });
  it('handles negative seeds (coerces to unsigned)', () => {
    const a = mulberry32(-1);
    const b = mulberry32(0xffffffff);
    expect(a()).toBe(b());
  });
});

describe('nextInt', () => {
  it('returns inclusive integer in range', () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 100; i++) {
      const v = nextInt(rng, 1, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });
  it('returns min when min === max', () => {
    const rng = mulberry32(12345);
    expect(nextInt(rng, 5, 5)).toBe(5);
  });
  it('covers the full range over many draws', () => {
    const rng = mulberry32(99999);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      seen.add(nextInt(rng, 1, 6));
    }
    expect(seen.size).toBe(6);
  });
});

describe('nextFloat', () => {
  it('returns float in [min, max)', () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 100; i++) {
      const v = nextFloat(rng, 10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });
});

describe('nextSign', () => {
  it('returns -1 or +1 only', () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 100; i++) {
      const v = nextSign(rng);
      expect(v === -1 || v === 1).toBe(true);
    }
  });
  it('produces both signs over many draws', () => {
    const rng = mulberry32(12345);
    const counts: Record<string, number> = { '-1': 0, '1': 0 };
    for (let i = 0; i < 200; i++) {
      counts[nextSign(rng).toString()]++;
    }
    expect(counts['-1']).toBeGreaterThan(0);
    expect(counts['1']).toBeGreaterThan(0);
  });
});

describe('pick', () => {
  it('returns an element of the array', () => {
    const rng = mulberry32(12345);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 20; i++) {
      expect(arr).toContain(pick(rng, arr));
    }
  });
  it('is deterministic given the same rng state', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const arr = ['x', 'y', 'z'];
    for (let i = 0; i < 10; i++) {
      expect(pick(a, arr)).toBe(pick(b, arr));
    }
  });
  it('throws on empty array', () => {
    const rng = mulberry32(12345);
    expect(() => pick(rng, [])).toThrow();
  });
});
