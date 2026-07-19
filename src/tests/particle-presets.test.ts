import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../rng';
import { createEmitter } from '../particles/emitter';
import { parseHex } from '../primitives/color';
import {
  LAVA_FIRE_PARTICLES,
  LAVA_SMOKE_PARTICLES,
  WATER_BUBBLE_PARTICLES,
  LAVA_SURFACE_COLOR,
  LAVA_BODY_COLOR,
  WATER_SURFACE_COLOR,
} from '../particles/presets';

/**
 * Contract: the six particle-preset exports ship the exact showcase-tuned
 * values documented in `docs/api-surface.md` (lines 167-172) and in each
 * preset's JSDoc. Drift here changes the consumer's visual look silently.
 *
 * Each preset must also be SPREADABLE into `createEmitter` with only `region`
 * + `rng` added — that's the whole point of the preset shape
 * (`Omit<EmitterConfig, 'region' | 'rng'>`).
 */
function isValidHex(hex: string): boolean {
  try {
    parseHex(hex);
    return true;
  } catch {
    return false;
  }
}

describe('LAVA_FIRE_PARTICLES (showcase verbatim)', () => {
  it('matches documented scalar fields', () => {
    expect(LAVA_FIRE_PARTICLES.rate).toBe(2);
    expect(LAVA_FIRE_PARTICLES.gravityScale).toBe(0.4);
    expect(LAVA_FIRE_PARTICLES.dragScale).toBe(0.99);
    expect(LAVA_FIRE_PARTICLES.life).toBe(30);
    expect(LAVA_FIRE_PARTICLES.size).toBe(3);
    expect(LAVA_FIRE_PARTICLES.color).toBe('#FFAA00');
  });

  it('cone points up with a narrow 60° column at showcase speed', () => {
    const cone = LAVA_FIRE_PARTICLES.cone;
    expect(cone.baseAngle).toBe(-Math.PI / 2);
    expect(cone.spread).toBe(Math.PI / 3);
    expect(cone.speedMin).toBe(3.0);
    expect(cone.speedMax).toBe(5.0);
  });

  it('color parses as a valid #rrggbb hex', () => {
    expect(isValidHex(LAVA_FIRE_PARTICLES.color!)).toBe(true);
  });
});

describe('LAVA_SMOKE_PARTICLES (showcase verbatim)', () => {
  it('matches documented scalar fields', () => {
    expect(LAVA_SMOKE_PARTICLES.rate).toBe(0.8);
    expect(LAVA_SMOKE_PARTICLES.gravityScale).toBe(-0.4);
    expect(LAVA_SMOKE_PARTICLES.dragScale).toBe(0.99);
    expect(LAVA_SMOKE_PARTICLES.life).toBe(60);
    expect(LAVA_SMOKE_PARTICLES.size).toBe(6);
    expect(LAVA_SMOKE_PARTICLES.color).toBe('#888888');
  });

  it('cone points up with a wide 90° billow at slow drift speed', () => {
    const cone = LAVA_SMOKE_PARTICLES.cone;
    expect(cone.baseAngle).toBe(-Math.PI / 2);
    expect(cone.spread).toBe(Math.PI / 2);
    expect(cone.speedMin).toBe(0.5);
    expect(cone.speedMax).toBe(1.5);
  });

  it('color parses as a valid #rrggbb hex', () => {
    expect(isValidHex(LAVA_SMOKE_PARTICLES.color!)).toBe(true);
  });
});

describe('WATER_BUBBLE_PARTICLES (derived, not showcase-tuned)', () => {
  it('matches documented scalar fields', () => {
    expect(WATER_BUBBLE_PARTICLES.rate).toBe(0.5);
    expect(WATER_BUBBLE_PARTICLES.gravityScale).toBe(-0.2);
    expect(WATER_BUBBLE_PARTICLES.dragScale).toBe(0.95);
    expect(WATER_BUBBLE_PARTICLES.life).toBe(40);
    expect(WATER_BUBBLE_PARTICLES.size).toBe(2);
    expect(WATER_BUBBLE_PARTICLES.color).toBe('#a0d8ff');
  });

  it('cone points up with a 45° wobble at slow rise speed', () => {
    const cone = WATER_BUBBLE_PARTICLES.cone;
    expect(cone.baseAngle).toBe(-Math.PI / 2);
    expect(cone.spread).toBe(Math.PI / 4);
    expect(cone.speedMin).toBe(0.5);
    expect(cone.speedMax).toBe(1.5);
  });

  it('color parses as a valid #rrggbb hex', () => {
    expect(isValidHex(WATER_BUBBLE_PARTICLES.color!)).toBe(true);
  });
});

describe('surface color constants', () => {
  it('LAVA_SURFACE_COLOR is a valid #rrggbb hex string', () => {
    expect(LAVA_SURFACE_COLOR).toBe('#ff6a00');
    expect(isValidHex(LAVA_SURFACE_COLOR)).toBe(true);
  });

  it('LAVA_BODY_COLOR is a valid #rrggbb hex string', () => {
    expect(LAVA_BODY_COLOR).toBe('#7a0a0a');
    expect(isValidHex(LAVA_BODY_COLOR)).toBe(true);
  });

  it('WATER_SURFACE_COLOR is a valid #rrggbb hex string', () => {
    expect(WATER_SURFACE_COLOR).toBe('#2a7ad4');
    expect(isValidHex(WATER_SURFACE_COLOR)).toBe(true);
  });
});

describe('preset spreadability into createEmitter', () => {
  it('LAVA_FIRE_PARTICLES spreads without throwing', () => {
    const emitter = createEmitter({
      ...LAVA_FIRE_PARTICLES,
      region: { type: 'point' },
      rng: mulberry32(1),
    });
    expect(emitter).toBeDefined();
    expect(emitter.particles).toEqual([]);
  });

  it('LAVA_SMOKE_PARTICLES spreads without throwing', () => {
    const emitter = createEmitter({
      ...LAVA_SMOKE_PARTICLES,
      region: { type: 'point' },
      rng: mulberry32(1),
    });
    expect(emitter).toBeDefined();
    expect(emitter.particles).toEqual([]);
  });

  it('WATER_BUBBLE_PARTICLES spreads without throwing', () => {
    const emitter = createEmitter({
      ...WATER_BUBBLE_PARTICLES,
      region: { type: 'point' },
      rng: mulberry32(1),
    });
    expect(emitter).toBeDefined();
    expect(emitter.particles).toEqual([]);
  });
});
