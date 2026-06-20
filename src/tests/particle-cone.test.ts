import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../rng';
import { sampleConeVelocity, type ConeConfig } from '../particles';

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

describe('sampleConeVelocity — base angle', () => {
  it('with zero spread produces velocity exactly along baseAngle', () => {
    const config: ConeConfig = {
      baseAngle: -Math.PI / 2,
      spread: 0,
      speedMin: 2,
      speedMax: 2,
    };
    const v = sampleConeVelocity(config, mulberry32(1));
    expect(v.vx).toBeCloseTo(0, 5);
    expect(v.vy).toBeCloseTo(-2, 5);
  });

  it('with zero spread ignores the angle rng draw magnitude', () => {
    let v = 0.99;
    const config: ConeConfig = {
      baseAngle: 0,
      spread: 0,
      speedMin: 1,
      speedMax: 1,
    };
    const out = sampleConeVelocity(config, () => (v = (v + 0.1) % 1));
    expect(out.vx).toBeCloseTo(1, 5);
    expect(out.vy).toBeCloseTo(0, 5);
  });
});

describe('sampleConeVelocity — speed range', () => {
  it('produces speeds within [speedMin, speedMax]', () => {
    const config: ConeConfig = {
      baseAngle: 0,
      spread: Math.PI,
      speedMin: 1.5,
      speedMax: 3.0,
    };
    for (let i = 0; i < 50; i++) {
      const v = sampleConeVelocity(config, mulberry32(i + 1));
      const speed = Math.hypot(v.vx, v.vy);
      expect(speed).toBeGreaterThanOrEqual(1.5);
      expect(speed).toBeLessThanOrEqual(3.0);
    }
  });
});

describe('sampleConeVelocity — angle range', () => {
  it('produces angles within [base - spread/2, base + spread/2]', () => {
    const base = -Math.PI / 2;
    const spread = 0.5;
    const config: ConeConfig = { baseAngle: base, spread, speedMin: 1, speedMax: 1 };
    for (let i = 0; i < 50; i++) {
      const v = sampleConeVelocity(config, mulberry32(i + 1));
      const angle = Math.atan2(v.vy, v.vx);
      expect(angle).toBeGreaterThanOrEqual(base - spread / 2 - 1e-9);
      expect(angle).toBeLessThanOrEqual(base + spread / 2 + 1e-9);
    }
  });

  it('full circle (spread = 2π) does not throw and yields valid speeds', () => {
    const config: ConeConfig = {
      baseAngle: 0,
      spread: Math.PI * 2,
      speedMin: 2,
      speedMax: 4,
    };
    for (let i = 0; i < 20; i++) {
      const v = sampleConeVelocity(config, mulberry32(i + 1));
      const speed = Math.hypot(v.vx, v.vy);
      expect(speed).toBeGreaterThanOrEqual(2);
      expect(speed).toBeLessThanOrEqual(4);
    }
  });
});

describe('sampleConeVelocity — rng discipline', () => {
  it('consumes exactly 2 rng draws per sample', () => {
    const { rng, draws } = countingRng(mulberry32(5));
    sampleConeVelocity(
      { baseAngle: 0, spread: 0.3, speedMin: 1, speedMax: 2 },
      rng,
    );
    expect(draws()).toBe(2);
  });
});

describe('sampleConeVelocity — determinism', () => {
  it('reproduces an identical velocity sequence from the same seed', () => {
    const config: ConeConfig = {
      baseAngle: -Math.PI / 2,
      spread: 0.8,
      speedMin: 0.5,
      speedMax: 2.5,
    };
    const run = () => {
      const rng = mulberry32(99);
      const out = [];
      for (let i = 0; i < 30; i++) out.push(sampleConeVelocity(config, rng));
      return out;
    };
    expect(run()).toEqual(run());
  });
});
