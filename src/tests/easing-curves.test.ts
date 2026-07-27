import { describe, it, expect } from 'vitest';
import {
  linear,
  easeOutQuad,
  easeOutCubic,
  easeOutQuart,
  easeOutQuint,
  easeOutSine,
  easeOutExpo,
  easeOutCirc,
  easeOutBack,
  easeOutElastic,
  easeOutBounce,
  powOut,
  easeIn,
  easeInOut,
} from '../easing/curves';

/**
 * Curve-contract tests for the easing module. Per the locked decision
 * (`docs/design/easing-tween-decision.md`), every shipped Out curve is a pure
 * `(t: number) => number` mapping `[0,1] → [0,1]` (with permitted overshoot
 * mid-flight for back/elastic). Endpoints MUST pin to exactly 0 and 1; a tiny
 * epsilon (1e-9) is allowed only where IEEE-754 float error is unavoidable.
 */
const EPS = 1e-9;

const OUT_CURVES: Record<string, (t: number) => number> = {
  linear,
  easeOutQuad,
  easeOutCubic,
  easeOutQuart,
  easeOutQuint,
  easeOutSine,
  easeOutExpo,
  easeOutCirc,
  easeOutBack,
  easeOutElastic,
  easeOutBounce,
};

describe('easing curves — endpoints pin to 0 and 1', () => {
  for (const [name, f] of Object.entries(OUT_CURVES)) {
    it(`${name}: |f(0)| <= ${EPS} and |f(1) - 1| <= ${EPS}`, () => {
      expect(Math.abs(f(0))).toBeLessThanOrEqual(EPS);
      expect(Math.abs(f(1) - 1)).toBeLessThanOrEqual(EPS);
    });
  }

  it('power-family endpoints are exact (no float error)', () => {
    expect(easeOutQuad(0)).toBe(0);
    expect(easeOutQuad(1)).toBe(1);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutQuart(0)).toBe(0);
    expect(easeOutQuart(1)).toBe(1);
    expect(easeOutQuint(0)).toBe(0);
    expect(easeOutQuint(1)).toBe(1);
    expect(linear(0)).toBe(0);
    expect(linear(1)).toBe(1);
  });

  it('easeOutBack endpoints pin within epsilon (1.70158 is not exactly representable)', () => {
    expect(Math.abs(easeOutBack(0))).toBeLessThanOrEqual(EPS);
    expect(Math.abs(easeOutBack(1) - 1)).toBeLessThanOrEqual(EPS);
  });
});

describe('linear', () => {
  it('is the identity function', () => {
    expect(linear(0)).toBe(0);
    expect(linear(0.25)).toBe(0.25);
    expect(linear(0.5)).toBe(0.5);
    expect(linear(0.75)).toBe(0.75);
    expect(linear(1)).toBe(1);
  });
});

describe('powOut', () => {
  it('powOut(t, 2) is bit-identical to easeOutQuad across a sweep', () => {
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      expect(powOut(t, 2)).toBe(easeOutQuad(t));
    }
  });

  it('powOut(t, 3) is bit-identical to easeOutCubic across a sweep', () => {
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      expect(powOut(t, 3)).toBe(easeOutCubic(t));
    }
  });

  it('powOut(t, 4) and powOut(t, 5) match the named quart/quint', () => {
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      expect(powOut(t, 4)).toBe(easeOutQuart(t));
      expect(powOut(t, 5)).toBe(easeOutQuint(t));
    }
  });

  it('pins endpoints exactly for any positive n', () => {
    expect(powOut(0, 2)).toBe(0);
    expect(powOut(1, 2)).toBe(1);
    expect(powOut(0, 7)).toBe(0);
    expect(powOut(1, 7)).toBe(1);
  });
});

describe('easeOutBounce — clamped to [0, 1] across a fine sweep', () => {
  it('never exceeds 1 and never goes below 0', () => {
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000;
      const v = easeOutBounce(t);
      expect(v).toBeGreaterThanOrEqual(-EPS);
      expect(v).toBeLessThanOrEqual(1 + EPS);
    }
  });

  it('starts exactly at 0 and ends at 1 (within epsilon)', () => {
    expect(easeOutBounce(0)).toBeLessThanOrEqual(EPS);
    expect(easeOutBounce(1)).toBeGreaterThanOrEqual(1 - EPS);
  });
});

describe('inversion helpers', () => {
  it('easeIn(outFn) pins endpoints for every shipped Out curve', () => {
    for (const f of Object.values(OUT_CURVES)) {
      const g = easeIn(f);
      expect(Math.abs(g(0))).toBeLessThanOrEqual(EPS);
      expect(Math.abs(g(1) - 1)).toBeLessThanOrEqual(EPS);
    }
  });

  it('easeInOut(outFn) pins endpoints for every shipped Out curve', () => {
    for (const f of Object.values(OUT_CURVES)) {
      const g = easeInOut(f);
      expect(Math.abs(g(0))).toBeLessThanOrEqual(EPS);
      expect(Math.abs(g(1) - 1)).toBeLessThanOrEqual(EPS);
    }
  });

  it('easeInOut of a symmetric base (linear) equals 0.5 at t = 0.5', () => {
    expect(easeInOut(linear)(0.5)).toBeCloseTo(0.5, 9);
  });

  it('easeIn is the mirror of its base: easeIn(f)(t) === 1 - f(1 - t)', () => {
    const f = easeOutCubic;
    const g = easeIn(f);
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      expect(g(t)).toBeCloseTo(1 - f(1 - t), 9);
    }
  });
});

describe('monotonicity (monotone curves only)', () => {
  const monotone: Array<[string, (t: number) => number]> = [
    ['linear', linear],
    ['easeOutQuad', easeOutQuad],
    ['easeOutCubic', easeOutCubic],
    ['easeOutQuart', easeOutQuart],
    ['easeOutQuint', easeOutQuint],
    ['easeOutSine', easeOutSine],
  ];

  for (const [name, f] of monotone) {
    it(`${name} is monotonic increasing on [0, 1]`, () => {
      let prev = f(0);
      for (let i = 1; i <= 200; i++) {
        const t = i / 200;
        const v = f(t);
        expect(v).toBeGreaterThanOrEqual(prev - EPS);
        prev = v;
      }
    });
  }

  it('easeOutBack is NOT monotonic (overshoots) — documents the non-monotone set', () => {
    let prev = easeOutBack(0);
    let decreased = false;
    for (let i = 1; i <= 200; i++) {
      const t = i / 200;
      const v = easeOutBack(t);
      if (v < prev - EPS) decreased = true;
      prev = v;
    }
    expect(decreased).toBe(true);
  });
});

describe('determinism spot-check', () => {
  for (const [name, f] of Object.entries(OUT_CURVES)) {
    it(`${name}: same t produces identical output across repeated calls`, () => {
      const t = 0.37;
      const a = f(t);
      const b = f(t);
      const c = f(t);
      expect(a).toBe(b);
      expect(b).toBe(c);
    });
  }
});
