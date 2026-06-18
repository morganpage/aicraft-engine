import { describe, it, expect } from 'vitest';
import { bob, pulse, sineShake, shakeEnvelope } from '../animation/oscillators';

describe('bob', () => {
  it('returns 0 at tick 0', () => {
    expect(bob(0, 0.1, 5)).toBe(0);
  });
  it('amplitude bounds the displacement', () => {
    for (let t = 0; t < 200; t++) {
      const v = bob(t, 0.07, 5);
      expect(Math.abs(v)).toBeLessThanOrEqual(5 + 1e-9);
    }
  });
  it('is deterministic — same inputs produce same output', () => {
    expect(bob(42, 0.1, 5)).toBe(bob(42, 0.1, 5));
  });
  it('returns 0 amplitude for 0 amplitude input', () => {
    expect(bob(50, 0.1, 0)).toBe(0);
  });
});

describe('pulse', () => {
  it('output stays in [0, amplitude]', () => {
    for (let t = 0; t < 200; t++) {
      const v = pulse(t, 0.07, 5);
      expect(v).toBeGreaterThanOrEqual(-1e-9);
      expect(v).toBeLessThanOrEqual(5 + 1e-9);
    }
  });
  it('reaches amplitude at quarter cycle', () => {
    // speed=0.25 means 4-tick period; peak at t=1
    expect(pulse(1, 0.25, 10)).toBeCloseTo(10, 5);
  });
});

describe('sineShake', () => {
  it('magnitude bounds both axes', () => {
    for (let t = 0; t < 200; t++) {
      const { x, y } = sineShake(t, 4);
      expect(Math.abs(x)).toBeLessThanOrEqual(4 + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(4 + 1e-9);
    }
  });
  it('is deterministic', () => {
    expect(sineShake(42, 4)).toEqual(sineShake(42, 4));
  });
  it('returns 0,0 for 0 magnitude', () => {
    expect(sineShake(42, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('shakeEnvelope', () => {
  it('returns initial magnitude at tick 0', () => {
    expect(shakeEnvelope(0, 30, 5)).toBe(5);
  });
  it('returns 0 after duration', () => {
    expect(shakeEnvelope(31, 30, 5)).toBe(0);
  });
  it('returns 0 at exactly duration', () => {
    expect(shakeEnvelope(30, 30, 5)).toBe(0);
  });
  it('decays linearly — half magnitude at half duration', () => {
    expect(shakeEnvelope(15, 30, 10)).toBeCloseTo(5, 5);
  });
  it('handles duration=0 (no shake ever)', () => {
    expect(shakeEnvelope(0, 0, 5)).toBe(0);
    expect(shakeEnvelope(10, 0, 5)).toBe(0);
  });
});
