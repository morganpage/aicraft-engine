import {
  DASH_TRAIL_EFFECT,
  DEATH_BURST_EFFECT,
  DEFAULT_PARTICLE_AIR,
  GEM_AMBIENT_SPARKLE_EFFECT,
  LANDING_DUST_EFFECT,
  LANDING_DUST_HARD_EFFECT,
  PICKUP_SPARKLE_EFFECT,
  RESPAWN_FLASH_EFFECT,
  SWEAT_DROP_EFFECT,
  mulberry32,
  sampleConeVelocity,
  spawn,
  stepSeconds,
  particleAlphaCurve,
  particleColorAt,
  type Particle,
  type PlatformerState,
} from 'aicraft-engine';

/**
 * The one-shot feel-effect kit: tuned bursts, the ambient sparkle scheduler,
 * the dash afterimage ring, and one shared step/draw pair — every number
 * engine-owned (the `*_EFFECT` presets, tick-unit by construction).
 *
 * This recipe exists because the feel layer is where two consecutive builds
 * shipped their worst defects: particle speeds authored in px/s against the
 * px/tick solver (every effect crossing the room in three frames), a snow
 * layer simulated but never drawn, a footstep cue consumed before it was
 * produced. The engine presets end the units authoring; this module ends the
 * WIRING authoring — spawn sites, the sparkle stagger, the afterimage ring,
 * and a draw that fades color (`colorEnd`) and alpha together.
 *
 * Determinism: one seeded `rng` stream per kit (pass the seed; the same seed
 * replays the same effects). Reduced motion is the caller's gate — do not
 * spawn ambient effects under a static frame.
 *
 * @example
 * ```ts
 * const fx = createFeelEffects({ seed: 0xce1e5 });
 * // per fixed tick (seconds dt):
 * game.particles = fx.dashTrail(game.particles, player);
 * game.particles = fx.step(game.particles, dt);
 * // per render frame (inside the composed camera transform):
 * fx.draw(ctx, game.particles);
 * ```
 */

/** Options for {@link createFeelEffects}. */
export interface FeelEffectsOptions {
  /** Seed for the shared seeded rng stream. Default `0xce1e5`. */
  readonly seed?: number;
  /**
   * Sparkle period in ticks for {@link FeelEffects.gemSparkle} — one twinkle
   * per gem every period, staggered by gem id. Default `40`.
   */
  readonly gemSparklePeriodTicks?: number;
}

/** The feel-effect kit. Every spawner is pure: `(particles, …) => particles`. */
export interface FeelEffects {
  /** Dash-trail wake — call every tick while the dash timer runs. */
  dashTrail(particles: readonly Particle[], player: PlatformerState): Particle[];
  /** Landing dust — `hard` from the engine `landing` moment's `hard` flag. */
  landingDust(particles: readonly Particle[], feetX: number, feetY: number, hard: boolean): Particle[];
  /** Pickup sparkle at a collectible's center. */
  pickupSparkle(particles: readonly Particle[], x: number, y: number): Particle[];
  /** Death shatter at the body's center. */
  deathBurst(particles: readonly Particle[], x: number, y: number): Particle[];
  /** Respawn flash ring at the spawn point. */
  respawnFlash(particles: readonly Particle[], x: number, y: number): Particle[];
  /** One sweat drop (call on a period while the tired grip holds). */
  sweat(particles: readonly Particle[], x: number, y: number): Particle[];
  /**
   * Ambient gem twinkle: returns the spawn only on the gem's staggered due
   * tick, else the input unchanged. `gemId` is the engine entity id — the
   * stagger keys off it so a room's gems do not twinkle in lockstep. Spawn at
   * the gem's BOBBED visual center (the sparkle rides the bob; the pickup
   * AABB does not).
   */
  gemSparkle(particles: readonly Particle[], gemId: number, x: number, y: number, tick: number): Particle[];
  /** Advance + cull under the shared air medium (seconds dt in). */
  step(particles: readonly Particle[], dt: number): Particle[];
  /**
   * Draw every live mote as an aligned square: `colorEnd` color fade and
   * alpha fade together. Raw world coordinates — call inside the composed
   * camera transform, never screen space.
   */
  draw(ctx: CanvasRenderingContext2D, particles: readonly Particle[]): void;
}

/** Create the feel kit with its own seeded rng stream. */
export function createFeelEffects(opts: FeelEffectsOptions = {}): FeelEffects {
  const rng = mulberry32(opts.seed ?? 0xce1e5);
  const period = opts.gemSparklePeriodTicks ?? 40;

  const coneBurst = (
    particles: readonly Particle[],
    effect: typeof LANDING_DUST_EFFECT,
    x: number,
    y: number,
  ): Particle[] => {
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
    return [...particles, ...born];
  };

  return {
    dashTrail(particles, player) {
      const dash = player.abilities.dash;
      if (dash?.kind !== 'dash' || dash.timer <= 0) return [...particles];
      return [...particles, ...spawn(player.core.x + player.core.width / 2, player.core.y + player.core.height / 2, {
        ...DASH_TRAIL_EFFECT,
        rng,
      })];
    },
    landingDust(particles, feetX, feetY, hard) {
      return coneBurst(particles, hard ? LANDING_DUST_HARD_EFFECT : LANDING_DUST_EFFECT, feetX, feetY);
    },
    pickupSparkle(particles, x, y) {
      return [...particles, ...spawn(x, y, { ...PICKUP_SPARKLE_EFFECT, rng })];
    },
    deathBurst(particles, x, y) {
      return [...particles, ...spawn(x, y, { ...DEATH_BURST_EFFECT, rng })];
    },
    respawnFlash(particles, x, y) {
      return [...particles, ...spawn(x, y, { ...RESPAWN_FLASH_EFFECT, rng })];
    },
    sweat(particles, x, y) {
      return coneBurst(particles, SWEAT_DROP_EFFECT, x, y);
    },
    gemSparkle(particles, gemId, x, y, tick) {
      if (tick % period !== gemId % period) return [...particles];
      return [...particles, ...spawn(x, y, { ...GEM_AMBIENT_SPARKLE_EFFECT, rng })];
    },
    step(particles, dt) {
      return stepSeconds(particles, dt, DEFAULT_PARTICLE_AIR);
    },
    draw(ctx, particles) {
      for (const p of particles) {
        if (p.life <= 0) continue;
        ctx.globalAlpha = particleAlphaCurve(p, 1, 0);
        ctx.fillStyle = particleColorAt(p);
        ctx.fillRect(Math.round(p.x) - (p.size >> 1), Math.round(p.y) - (p.size >> 1), p.size, p.size);
      }
      ctx.globalAlpha = 1;
    },
  };
}

// ---------------------------------------------------------------------------
// The dash afterimage — a ring buffer of past poses, drawn back as ghosts.
// ---------------------------------------------------------------------------

/** One sampled afterimage pose. */
export interface AfterimageSample {
  readonly x: number;
  readonly y: number;
  readonly facing: 1 | -1;
  /** The tick the sample was taken at (age = now − tick). */
  readonly tick: number;
}

/** Ring-buffer state; treat as opaque and drive through the helpers below. */
export interface AfterimageTrail {
  readonly samples: AfterimageSample[];
  head: number;
}

/**
 * Create the afterimage ring buffer. `capacity` is the number of past poses
 * retained (8 at one sample per tick ≈ a 133 ms ghost trail at 60 Hz).
 */
export function createAfterimageTrail(capacity = 8): AfterimageTrail {
  return { samples: new Array<AfterimageSample>(capacity), head: 0 };
}

/**
 * Record the body's current pose (call once per fixed tick while dashing —
 * or always; ghosts older than `drawAfterimages`' cutoff simply never draw).
 */
export function recordAfterimage(
  trail: AfterimageTrail,
  x: number,
  y: number,
  facing: 1 | -1,
  tick: number,
): AfterimageTrail {
  trail.samples[trail.head] = { x, y, facing, tick };
  trail.head = (trail.head + 1) % trail.samples.length;
  return trail;
}

/**
 * The retained samples that are between `minAgeTicks` and `maxAgeTicks` old at
 * `tick` — oldest first. Draw each with YOUR sprite call at a fraction of the
 * per-sample alpha (e.g. `alpha * (1 - age/maxAge)`), behind the body.
 */
export function afterimagesFor(
  trail: AfterimageTrail,
  tick: number,
  minAgeTicks = 2,
  maxAgeTicks = 8,
): readonly AfterimageSample[] {
  const out: AfterimageSample[] = [];
  for (const sample of trail.samples) {
    if (sample === undefined) continue;
    const age = tick - sample.tick;
    if (age >= minAgeTicks && age <= maxAgeTicks) out.push(sample);
  }
  return out.sort((a, b) => a.tick - b.tick);
}

/** Drop every retained sample (respawn/room change — no ghosts across cuts). */
export function clearAfterimages(trail: AfterimageTrail): AfterimageTrail {
  trail.samples.fill(undefined as unknown as AfterimageSample);
  trail.head = 0;
  return trail;
}
