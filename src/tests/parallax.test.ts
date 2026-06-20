import { describe, it, expect } from 'vitest';
import { parallaxOffset, PARALLAX_FAR, PARALLAX_MID, PARALLAX_NEAR } from '../primitives/parallax';

describe('parallaxOffset', () => {
  it('returns (0,0) when the camera is at the origin, for any factor', () => {
    expect(parallaxOffset(0, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(parallaxOffset(0, 0, 0.5)).toEqual({ x: 0, y: 0 });
    expect(parallaxOffset(0, 0, 1)).toEqual({ x: 0, y: 0 });
    expect(parallaxOffset(0, 0, 2)).toEqual({ x: 0, y: 0 });
  });

  it('applies a half-speed factor to the camera (mid layer)', () => {
    expect(parallaxOffset(100, 50, 0.5)).toEqual({ x: -50, y: -25 });
  });

  it('returns (0,0) regardless of camera when factor is 0 (static layer)', () => {
    expect(parallaxOffset(1000, 2000, 0)).toEqual({ x: 0, y: 0 });
    expect(parallaxOffset(-500, 333, 0)).toEqual({ x: 0, y: 0 });
  });

  it('returns -camera when factor is 1 (gameplay layer scrolls with the world)', () => {
    expect(parallaxOffset(100, 50, 1)).toEqual({ x: -100, y: -50 });
  });

  it('returns -2*camera when factor is 2 (foreground scrolls faster than the camera)', () => {
    expect(parallaxOffset(100, 50, 2)).toEqual({ x: -200, y: -100 });
  });

  it('produces a positive offset for negative camera coords (camera pans up-left)', () => {
    expect(parallaxOffset(-100, -50, 0.5)).toEqual({ x: 50, y: 25 });
  });

  it('reverses scroll direction for a negative factor (unusual but well-defined)', () => {
    expect(parallaxOffset(100, 50, -0.5)).toEqual({ x: 50, y: 25 });
  });

  it('is deterministic: identical inputs yield identical outputs across calls', () => {
    const a = parallaxOffset(123.456, -789.012, 0.37);
    const b = parallaxOffset(123.456, -789.012, 0.37);
    expect(a).toEqual(b);
  });

  it('handles non-integer cameras and fractional factors exactly', () => {
    expect(parallaxOffset(7.5, -3.5, 0.5)).toEqual({ x: -3.75, y: 1.75 });
  });

  it('returns a fresh object each call (no shared mutable return value)', () => {
    const a = parallaxOffset(10, 20, 1);
    const b = parallaxOffset(30, 40, 1);
    expect(a).toEqual({ x: -10, y: -20 });
    expect(b).toEqual({ x: -30, y: -40 });
    expect(a).not.toBe(b);
  });
});

describe('parallax factor constants', () => {
  it('PARALLAX_FAR is the typical far-layer factor', () => {
    expect(PARALLAX_FAR).toBe(0.25);
  });
  it('PARALLAX_MID is the typical mid-depth factor', () => {
    expect(PARALLAX_MID).toBe(0.5);
  });
  it('PARALLAX_NEAR is the gameplay-layer factor', () => {
    expect(PARALLAX_NEAR).toBe(1.0);
  });
});
