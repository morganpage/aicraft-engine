import { describe, expect, it } from 'vitest';
import {
  advance,
  advanceSeconds,
  DEFAULT_FIXED_DT,
  DEFAULT_PARTICLE_AIR,
  secondsToTicks,
  stepSeconds,
  type Particle,
} from '../index';

const dust: Particle = {
  x: 0,
  y: 0,
  vx: 3,
  vy: 0,
  life: 34,
  maxLife: 34,
  size: 2,
};

describe('secondsToTicks', () => {
  it('converts a 60 Hz fixed step to exactly one tick', () => {
    expect(secondsToTicks(1 / 60)).toBe(1);
    expect(secondsToTicks(1 / 60, 1 / 60)).toBe(1);
  });

  it('honors an explicit fixedDt (a 30 Hz step is half a 60 Hz tick)', () => {
    expect(secondsToTicks(1 / 30, 1 / 30)).toBe(1);
    expect(secondsToTicks(1 / 60, 1 / 30)).toBeCloseTo(0.5, 12);
  });

  it('clamps non-finite and non-positive input to 0, and a bad fixedDt to the default', () => {
    expect(secondsToTicks(0)).toBe(0);
    expect(secondsToTicks(-1)).toBe(0);
    expect(secondsToTicks(Number.NaN)).toBe(0);
    expect(secondsToTicks(1, 0)).toBe(secondsToTicks(1, DEFAULT_FIXED_DT));
  });
});

describe('advanceSeconds', () => {
  it('one 60 Hz step is byte-identical to one engine tick', () => {
    const viaSeconds = advanceSeconds([dust], 1 / 60, { gravity: 0.1, drag: 0.9 });
    const viaTicks = advance([dust], 1, { gravity: 0.1, drag: 0.9 });
    expect(viaSeconds[0]).toEqual(viaTicks[0]);
    // The 60× defect this API exists to prevent: a 34-tick life must burn one
    // full tick per step, not 1/60 of one.
    expect(viaSeconds[0].life).toBe(33);
  });

  it('carries a custom fixedDt through the conversion', () => {
    const halfTick = advanceSeconds([dust], 1 / 60, { fixedDt: 1 / 30 });
    expect(halfTick[0].life).toBeCloseTo(33.5, 12);
  });

  it('a non-positive dt is an identity step (new array, same physics)', () => {
    const stepped = advanceSeconds([dust], 0);
    expect(stepped[0].life).toBe(34);
    expect(stepped[0]).not.toBe(dust);
  });
});

describe('stepSeconds', () => {
  it('advances and culls — a 34-tick particle dies within 34 sixty-hertz steps', () => {
    let particles: Particle[] = [dust];
    for (let i = 0; i < 34; i++) particles = stepSeconds(particles, 1 / 60);
    expect(particles).toHaveLength(0);
  });

  it('the air medium composes like any advance options', () => {
    const stepped = stepSeconds([dust], 1 / 60, { ...DEFAULT_PARTICLE_AIR });
    expect(stepped[0].vx).toBeCloseTo(3 * 0.9, 12);
  });
});

describe('DEFAULT_PARTICLE_AIR', () => {
  it('is the tuned shared medium in tick units', () => {
    expect(DEFAULT_PARTICLE_AIR).toEqual({ gravity: 0.1, drag: 0.9 });
  });
});
