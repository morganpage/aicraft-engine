/**
 * Tuned one-shot burst effect presets (src/particles/effects.ts) — the units
 * contract asserted: every preset's speeds are px/tick, every preset stays
 * room-local under `DEFAULT_PARTICLE_AIR` for its whole life, and the presets
 * spread cleanly into `spawn` / `sampleConeVelocity`.
 */
import { describe, expect, it } from 'vitest';
import {
  DASH_TRAIL_EFFECT,
  DEATH_BURST_EFFECT,
  DEFAULT_PARTICLE_AIR,
  GEM_AMBIENT_SPARKLE_EFFECT,
  IMPLAUSIBLE_SPEED_PX_PER_TICK,
  LANDING_DUST_EFFECT,
  LANDING_DUST_HARD_EFFECT,
  PICKUP_SPARKLE_EFFECT,
  RESPAWN_FLASH_EFFECT,
  SWEAT_DROP_EFFECT,
  advance,
  mulberry32,
  sampleConeVelocity,
  spawn,
  type ConeBurstEffect,
  type Particle,
  type RadialBurstEffect,
} from '../index';

function radialBurst(effect: RadialBurstEffect, x: number, y: number, seed: number): Particle[] {
  // The full preset spreads into spawn (count/speed/jitter/life/size/color/
  // colorEnd/gravityScale/dragScale are all SpawnOptions now).
  return spawn(x, y, { ...effect, rng: mulberry32(seed) });
}

function coneBurst(effect: ConeBurstEffect, x: number, y: number, seed: number): Particle[] {
  const rng = mulberry32(seed);
  const born: Particle[] = [];
  for (let i = 0; i < effect.count; i += 1) {
    const v = sampleConeVelocity(effect.cone, rng);
    born.push({
      x,
      y,
      vx: v.vx,
      vy: v.vy,
      life: effect.life,
      maxLife: effect.life,
      size: effect.size,
      color: effect.color,
      colorEnd: effect.colorEnd,
      gravityScale: effect.gravityScale,
      dragScale: effect.dragScale,
    });
  }
  return born;
}

/** Total displacement over a full life under the shared air medium. */
function maxWander(particles: readonly Particle[], origin: { x: number; y: number }): number {
  let live = particles as Particle[];
  let max = 0;
  for (let tick = 0; tick < 600 && live.length > 0; tick += 1) {
    live = advance(live, 1, DEFAULT_PARTICLE_AIR).filter((p) => p.life > 0);
    for (const p of live) {
      max = Math.max(max, Math.hypot(p.x - origin.x, p.y - origin.y));
    }
  }
  return max;
}

describe('effect presets — tick-unit speeds (the 60× contract)', () => {
  const radialEffects = {
    dashTrail: DASH_TRAIL_EFFECT,
    pickupSparkle: PICKUP_SPARKLE_EFFECT,
    gemAmbient: GEM_AMBIENT_SPARKLE_EFFECT,
    deathBurst: DEATH_BURST_EFFECT,
    respawnFlash: RESPAWN_FLASH_EFFECT,
  } as const;
  const coneEffects = {
    landingDust: LANDING_DUST_EFFECT,
    landingDustHard: LANDING_DUST_HARD_EFFECT,
    sweat: SWEAT_DROP_EFFECT,
  } as const;

  it('every authored speed sits under the plausibility ceiling', () => {
    for (const effect of Object.values(radialEffects)) {
      expect(effect.speed).toBeLessThan(IMPLAUSIBLE_SPEED_PX_PER_TICK);
    }
    for (const effect of Object.values(coneEffects)) {
      expect(effect.cone.speedMax).toBeLessThan(IMPLAUSIBLE_SPEED_PX_PER_TICK);
    }
    // Even jittered peaks stay local.
    expect(DEATH_BURST_EFFECT.speed * (1 + DEATH_BURST_EFFECT.speedJitter))
      .toBeLessThan(IMPLAUSIBLE_SPEED_PX_PER_TICK);
  });

  it('every preset stays within a one-screen room of its origin', () => {
    const origin = { x: 160, y: 92 };
    for (const effect of Object.values(radialEffects)) {
      expect(maxWander(radialBurst(effect, origin.x, origin.y, 42), origin)).toBeLessThan(80);
    }
    for (const effect of Object.values(coneEffects)) {
      expect(maxWander(coneBurst(effect, origin.x, origin.y, 42), origin)).toBeLessThan(80);
    }
  });

  it('the dash trail parks within a few px (it marks the path)', () => {
    const origin = { x: 100, y: 100 };
    expect(maxWander(radialBurst(DASH_TRAIL_EFFECT, origin.x, origin.y, 7), origin)).toBeLessThan(6);
  });

  it('the ambient gem twinkle barely leaves the gem', () => {
    const origin = { x: 40, y: 40 };
    expect(maxWander(radialBurst(GEM_AMBIENT_SPARKLE_EFFECT, origin.x, origin.y, 7), origin)).toBeLessThan(2);
  });

  it('landing dust carries a colorEnd fade (dust greys out as it dies)', () => {
    expect(LANDING_DUST_EFFECT.colorEnd).toMatch(/^#[0-9a-f]{6}$/i);
    const dust = coneBurst(LANDING_DUST_EFFECT, 0, 0, 1);
    expect(dust[0].colorEnd).toBe(LANDING_DUST_EFFECT.colorEnd);
    // ...and advance preserves it (the field the old re-stamp workaround existed for).
    const stepped = advance(dust, 1, DEFAULT_PARTICLE_AIR);
    expect(stepped[0].colorEnd).toBe(LANDING_DUST_EFFECT.colorEnd);
  });
});
