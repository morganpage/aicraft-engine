import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../rng';
import {
  createEmitter,
  stepEmitters,
  type Emitter,
  type EmitterConfig,
  type StepEmittersOptions,
} from '../particles';

function makeEmitterConfig(overrides: Partial<EmitterConfig> = {}): EmitterConfig {
  return {
    rate: 1,
    region: { type: 'point' },
    cone: { baseAngle: -Math.PI / 2, spread: 0, speedMin: 1, speedMax: 1 },
    life: 10,
    size: 2,
    rng: mulberry32(1),
    ...overrides,
  };
}

describe('createEmitter', () => {
  it('returns an Emitter bundling config, a zero accumulator, and no particles', () => {
    const config = makeEmitterConfig();
    const e = createEmitter(config);
    expect(e.config).toBe(config);
    expect(e.accumulator).toBe(0);
    expect(e.particles).toEqual([]);
  });
});

describe('stepEmitters — basic behavior', () => {
  it('returns an empty array for an empty emitter list', () => {
    expect(stepEmitters([], 1)).toEqual([]);
  });

  it('returns a NEW array (does not return the input reference)', () => {
    const emitters = [createEmitter(makeEmitterConfig({ rng: mulberry32(1) }))];
    const out = stepEmitters(emitters, 1);
    expect(out).not.toBe(emitters);
  });

  it('spawns particles over time from a rate-1 emitter', () => {
    const e = createEmitter(makeEmitterConfig({ rate: 1, life: 10 }));
    let emitters = [e];
    for (let i = 0; i < 5; i++) emitters = stepEmitters(emitters, 1);
    expect(emitters[0].particles.length).toBeGreaterThan(0);
  });

  it('culls particles once their life expires', () => {
    const e = createEmitter(makeEmitterConfig({ rate: 1, life: 3 }));
    let emitters = [e];
    for (let i = 0; i < 10; i++) emitters = stepEmitters(emitters, 1);
    for (const p of emitters[0].particles) expect(p.life).toBeGreaterThan(0);
  });
});

describe('stepEmitters — purity', () => {
  it('does not mutate the input emitter (particles array + accumulator intact)', () => {
    const config = makeEmitterConfig({ rate: 2, life: 20, rng: mulberry32(7) });
    const e = createEmitter(config);
    let emitters = [e];
    emitters = stepEmitters(emitters, 1);
    emitters = stepEmitters(emitters, 1);
    // The ORIGINAL emitter object must be untouched.
    expect(e.accumulator).toBe(0);
    expect(e.particles).toEqual([]);
  });
});

describe('stepEmitters — per-call opts', () => {
  it('world gravity pulls spawned particles down (+y)', () => {
    const config = makeEmitterConfig({
      rate: 1,
      life: 30,
      cone: { baseAngle: 0, spread: 0, speedMin: 0, speedMax: 0 },
    });
    let emitters = [createEmitter(config)];
    for (let i = 0; i < 10; i++) {
      emitters = stepEmitters(emitters, 1, { gravity: 0.5 });
    }
    for (const p of emitters[0].particles) {
      expect(p.y).toBeGreaterThan(0);
    }
  });

  it('rateScale reduces the spawn count (reduced-motion hook)', () => {
    const run = (rateScale: number): number => {
      const e = createEmitter(
        makeEmitterConfig({ rate: 2, life: 50, rng: mulberry32(42) }),
      );
      let emitters = [e];
      for (let i = 0; i < 30; i++) {
        emitters = stepEmitters(emitters, 1, { rateScale });
      }
      return emitters[0].particles.length;
    };
    const full = run(1);
    const reduced = run(0.25);
    expect(reduced).toBeLessThan(full);
  });

  it('rateScale defaults to 1.0 (omitting opts ≈ rateScale: 1)', () => {
    const optsA: StepEmittersOptions = {};
    const optsB: StepEmittersOptions = { rateScale: 1 };
    const run = (opts: StepEmittersOptions): Emitter[] => {
      let emitters = [createEmitter(makeEmitterConfig({ rng: mulberry32(5) }))];
      for (let i = 0; i < 20; i++) emitters = stepEmitters(emitters, 1, opts);
      return emitters;
    };
    // Different seeds would diverge, but with identical rng seeds + identical
    // effective rateScale the particle arrays match.
    expect(run(optsA)[0].particles).toEqual(run(optsB)[0].particles);
  });
});

describe('stepEmitters — steady-state convergence', () => {
  it('fire (rate=2, life=30) converges near 60 particles', () => {
    const fire: EmitterConfig = {
      rate: 2.0,
      region: { type: 'line', x1: 0, y1: 0, x2: 60, y2: 0 },
      cone: { baseAngle: -Math.PI / 2, spread: 0.5, speedMin: 1, speedMax: 2.5 },
      gravityScale: 0.6,
      dragScale: 0.98,
      life: 30,
      size: 3,
      rng: mulberry32(42),
    };
    let emitters = [createEmitter(fire)];
    for (let i = 0; i < 120; i++) {
      emitters = stepEmitters(emitters, 1, { gravity: 0.5, drag: 1.0 });
    }
    const count = emitters[0].particles.length;
    expect(count).toBeGreaterThanOrEqual(50);
    expect(count).toBeLessThanOrEqual(65);
  });

  it('smoke (rate=0.8, life=60) converges near 48 particles', () => {
    const smoke: EmitterConfig = {
      rate: 0.8,
      region: { type: 'line', x1: 0, y1: 0, x2: 60, y2: 0 },
      cone: { baseAngle: -Math.PI / 2, spread: 1.0, speedMin: 0.5, speedMax: 1.5 },
      gravityScale: -0.4,
      dragScale: 0.95,
      life: 60,
      size: 6,
      rng: mulberry32(99),
    };
    let emitters = [createEmitter(smoke)];
    for (let i = 0; i < 150; i++) {
      emitters = stepEmitters(emitters, 1, { gravity: 0.5, drag: 1.0 });
    }
    const count = emitters[0].particles.length;
    expect(count).toBeGreaterThanOrEqual(40);
    expect(count).toBeLessThanOrEqual(55);
  });
});

describe('stepEmitters — heterogeneous physics (fire vs smoke)', () => {
  it('smoke (negative gravityScale) rises above the spawn line', () => {
    const LINE_Y = 300;
    const smoke: EmitterConfig = {
      rate: 0.8,
      region: { type: 'line', x1: 0, y1: LINE_Y, x2: 60, y2: LINE_Y },
      cone: { baseAngle: -Math.PI / 2, spread: 1.0, speedMin: 0.5, speedMax: 1.5 },
      gravityScale: -0.4,
      dragScale: 0.95,
      life: 60,
      size: 6,
      rng: mulberry32(99),
    };
    let emitters = [createEmitter(smoke)];
    for (let i = 0; i < 90; i++) {
      emitters = stepEmitters(emitters, 1, { gravity: 0.5, drag: 1.0 });
    }
    const avgY =
      emitters[0].particles.reduce((s, p) => s + p.y, 0) /
      emitters[0].particles.length;
    // Smoke must rise: mean y well above the spawn line (smaller y).
    expect(avgY).toBeLessThan(LINE_Y - 20);
  });

  it('fire (positive gravityScale) launches up and falls back as sparks', () => {
    const LINE_Y = 300;
    const fire: EmitterConfig = {
      rate: 2.0,
      region: { type: 'line', x1: 0, y1: LINE_Y, x2: 60, y2: LINE_Y },
      cone: { baseAngle: -Math.PI / 2, spread: 0.5, speedMin: 1.0, speedMax: 2.5 },
      gravityScale: 0.6,
      dragScale: 0.98,
      life: 30,
      size: 3,
      rng: mulberry32(42),
    };
    // Track a rising-then-falling apex: capture the minimum (highest) mean y
    // reached, then confirm a later tick's mean y is larger (falling back).
    let emitters = [createEmitter(fire)];
    let minMeanY = Infinity;
    let minMeanTick = -1;
    for (let i = 0; i < 90; i++) {
      emitters = stepEmitters(emitters, 1, { gravity: 0.5, drag: 1.0 });
      if (emitters[0].particles.length === 0) continue;
      const meanY =
        emitters[0].particles.reduce((s, p) => s + p.y, 0) /
        emitters[0].particles.length;
      if (meanY < minMeanY) {
        minMeanY = meanY;
        minMeanTick = i;
      }
    }
    // Fire reached above the line at some point...
    expect(minMeanY).toBeLessThan(LINE_Y);
    // ...and that apex was not on the very last tick (it falls back after).
    expect(minMeanTick).toBeLessThan(89);
  });
});

describe('stepEmitters — determinism', () => {
  it('two independent runs with identical configs + seeds produce identical particles', () => {
    const run = (): Emitter => {
      const config: EmitterConfig = {
        rate: 1.5,
        region: { type: 'circle', cx: 30, cy: 30, radius: 10 },
        cone: { baseAngle: -Math.PI / 2, spread: 0.7, speedMin: 0.5, speedMax: 2 },
        gravityScale: 0.3,
        dragScale: 0.97,
        life: 25,
        size: 2,
        rng: mulberry32(777),
      };
      let emitters = [createEmitter(config)];
      for (let i = 0; i < 40; i++) {
        emitters = stepEmitters(emitters, 1, { gravity: 0.4, drag: 1.0 });
      }
      return emitters[0];
    };
    const a = run();
    const b = run();
    expect(a.particles).toEqual(b.particles);
    expect(a.accumulator).toBe(b.accumulator);
  });

  it('is byte-identical across repeated calls with a shared seed (snapshot)', () => {
    const run = () => {
      const e = createEmitter(
        makeEmitterConfig({ rate: 3, life: 8, rng: mulberry32(2024) }),
      );
      let emitters = [e];
      for (let i = 0; i < 12; i++) emitters = stepEmitters(emitters, 1);
      return JSON.stringify(emitters[0].particles);
    };
    expect(run()).toBe(run());
  });
});
