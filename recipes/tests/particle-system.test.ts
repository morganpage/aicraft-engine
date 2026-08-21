import { describe, expect, it, vi } from 'vitest';
import { advance as engineAdvance, type Particle } from 'aicraft-engine';
import { createParticleSystem, DEFAULT_PARTICLE_AIR } from '../particle-system';

const dust: Particle = {
  x: 0,
  y: 0,
  vx: 3,
  vy: 0,
  life: 34,
  maxLife: 34,
  size: 2,
};

describe('createParticleSystem (seconds → ticks)', () => {
  it('a 60 Hz seconds step advances exactly one engine tick', () => {
    const fx = createParticleSystem({ fixedDt: 1 / 60 });
    const viaRecipe = fx.advance([dust], 1 / 60);
    const viaEngine = engineAdvance([dust], 1, DEFAULT_PARTICLE_AIR);
    expect(viaRecipe[0].life).toBe(viaEngine[0].life);
    expect(viaRecipe[0].vx).toBeCloseTo(viaEngine[0].vx, 12);
    // The 60× bug this recipe exists to prevent: passing seconds straight to
    // the engine would have burned life 34/60 of a tick instead of a full tick.
    expect(viaRecipe[0].life).toBe(33);
  });

  it('a 34-tick particle is fully dead after 34 sixty-hertz steps', () => {
    const fx = createParticleSystem({ fixedDt: 1 / 60 });
    let particles: Particle[] = [dust];
    for (let i = 0; i < 34; i++) particles = fx.step(particles, 1 / 60);
    expect(particles).toHaveLength(0);
  });

  it('the default air medium applies (drag decays velocity, gravity pulls)', () => {
    const fx = createParticleSystem({ fixedDt: 1 / 60 });
    const stepped = fx.advance([dust], 1 / 60);
    // drag 0.9 per tick: vx 3 → 2.7; gravity feeds vy BEFORE drag multiplies
    // it (engine order): vy = (0 + 0.1 × 1) × 0.9 = 0.09.
    expect(stepped[0].vx).toBeCloseTo(2.7, 12);
    expect(stepped[0].vy).toBeCloseTo(0.09, 12);
  });

  it('a neutral custom air gives pure linear motion', () => {
    const fx = createParticleSystem({ fixedDt: 1 / 60, air: { gravity: 0, drag: 1 } });
    const stepped = fx.advance([dust], 1 / 60);
    expect(stepped[0].x).toBe(3);
    expect(stepped[0].vx).toBe(3);
  });

  it('ticksFrom converts and clamps', () => {
    const fx = createParticleSystem({ fixedDt: 1 / 60 });
    expect(fx.ticksFrom(1 / 60)).toBe(1);
    expect(fx.ticksFrom(0)).toBe(0);
    expect(fx.ticksFrom(-5)).toBe(0);
  });

  it('warns once when dt looks like TICKS handed to a seconds API', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fx = createParticleSystem({ fixedDt: 1 / 60 });
      fx.step([dust], 1);
      fx.step([dust], 1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('SECONDS');
    } finally {
      warn.mockRestore();
    }
  });

  it('an invalid fixedDt falls back to the engine default instead of throwing', () => {
    const fx = createParticleSystem({ fixedDt: 0 });
    expect(fx.ticksFrom(1 / 60)).toBe(1);
  });
});
