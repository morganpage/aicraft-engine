import { describe, it, expect } from 'vitest';
import { clamp, floor, lerp, approach } from '../primitives/pixel';

describe('clamp', () => {
  it('returns value when in range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it('clamps to lower bound', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });
  it('clamps to upper bound', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
  it('handles equal bounds', () => {
    expect(clamp(5, 7, 7)).toBe(7);
  });
});

describe('floor', () => {
  it('floors positive floats', () => {
    expect(floor(3.7)).toBe(3);
  });
  it('floors negative floats', () => {
    expect(floor(-3.2)).toBe(-4);
  });
  it('is identity for integers', () => {
    expect(floor(5)).toBe(5);
  });
});

describe('lerp', () => {
  it('returns a at t=0', () => {
    expect(lerp(5, 10, 0)).toBe(5);
  });
  it('returns b at t=1', () => {
    expect(lerp(5, 10, 1)).toBe(10);
  });
  it('returns midpoint at t=0.5', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
  it('extrapolates for t outside [0,1]', () => {
    expect(lerp(0, 10, 2)).toBe(20);
  });
});

describe('approach', () => {
  it('returns target when within maxDelta', () => {
    expect(approach(5, 7, 3)).toBe(7);
  });
  it('returns target exactly when diff equals maxDelta', () => {
    expect(approach(5, 8, 3)).toBe(8);
  });
  it('advances by +maxDelta when target is far above', () => {
    expect(approach(5, 20, 3)).toBe(8);
  });
  it('advances by -maxDelta when target is far below', () => {
    expect(approach(10, 0, 3)).toBe(7);
  });
  it('handles zero maxDelta (no movement)', () => {
    expect(approach(5, 10, 0)).toBe(5);
  });
});
