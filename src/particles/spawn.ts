import type { Particle } from './types';
import { warnImplausibleLife, warnImplausibleSpeed } from './plausibility';

export interface SpawnOptions {
  /** Number of particles to emit. */
  count: number;
  /** Base radial speed per tick. */
  speed: number;
  /**
   * Fraction of `speed` to jitter by, in `[0, 1]`. Default `0` (deterministic).
   * When `> 0`, an `rng` function must be provided.
   */
  speedJitter?: number;
  /** Initial life in ticks. */
  life: number;
  /** Render size (pixel radius or width — renderer-defined). */
  size: number;
  /** Optional color override. */
  color?: string;
  /**
   * Optional fade-out color. When set, a renderer can read
   * `particleColorAt(p)` to lerp from `color` toward `colorEnd` as the
   * particle dies. Carried on the particle and preserved by `advance`.
   */
  colorEnd?: string;
  /**
   * Per-particle gravity multiplier stamped onto every emitted particle
   * (negative = buoyant; see `Particle.gravityScale`). Lets a tuned preset
   * spread into `spawn` whole instead of `.map(p => ({ ...p, gravityScale }))`.
   */
  gravityScale?: number;
  /**
   * Per-particle drag multiplier stamped onto every emitted particle (see
   * `Particle.dragScale`). NOTE: it multiplies the WORLD drag — with
   * `DEFAULT_PARTICLE_AIR`'s `drag: 0.9`, values above ~1.11 AMPLIFY velocity
   * per tick instead of dragging.
   */
  dragScale?: number;
  /** Starting angle in radians. Default `0`. */
  angleOffset?: number;
  /**
   * Seeded RNG. Required when `speedJitter > 0` (currently the only jittered
   * option). Use a seeded rng such as `mulberry32(seed)` for deterministic
   * particles; `Math.random` is only acceptable for purely decorative effects
   * that never feed back into simulation state.
   */
  rng?: () => number;
}

/**
 * Spawn `count` particles evenly distributed around a circle centered at
 * `(x, y)`. Deterministic when `speedJitter` is `0` (default): the same call
 * always produces the same particles, given the same inputs.
 *
 * Matches the reference burst pattern (8 particles, evenly distributed
 * angles, deterministic by default).
 *
 * The `rng` option is required when `speedJitter > 0` (currently the only
 * jittered option). Use a seeded rng such as `mulberry32(seed)` for
 * deterministic particles; `Math.random` is only acceptable for purely
 * decorative effects that never feed back into simulation state.
 *
 * @returns a new array of particles. Empty if `count <= 0` or `life <= 0`.
 * @throws when `speedJitter > 0` and no `rng` is provided — jittered velocity
 *   requires an explicit rng for determinism.
 * @example
 * // Seeded jittered burst — the same seed always yields the same velocities.
 * import { mulberry32 } from '../rng';
 * const ps = spawn(x, y, {
 *   count: 12,
 *   speed: 2,
 *   speedJitter: 0.25,
 *   life: 30,
 *   size: 3,
 *   rng: mulberry32(42),
 * });
 */
export function spawn(x: number, y: number, opts: SpawnOptions): Particle[] {
  const {
    count,
    speed,
    speedJitter = 0,
    life,
    size,
    color,
    colorEnd,
    gravityScale,
    dragScale,
    angleOffset = 0,
    rng,
  } = opts;

  if (speedJitter > 0 && !rng) {
    throw new Error(
      'spawn: option "speedJitter" is greater than 0 but no "rng" was provided. ' +
        'Jittered particle velocity requires an explicit rng for determinism — pass rng: mulberry32(seed).',
    );
  }
  if (count <= 0) return [];
  if (life <= 0) return [];

  // Dev-time units tripwires (warn once per process — see plausibility.ts).
  warnImplausibleSpeed('spawn', speed);
  warnImplausibleLife('spawn', life);

  const result: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = angleOffset + (i / count) * Math.PI * 2;
    let particleSpeed = speed;
    if (speedJitter > 0 && rng) {
      const jitter = (rng() * 2 - 1) * speedJitter;
      particleSpeed = speed * (1 + jitter);
    }
    result.push({
      x,
      y,
      vx: Math.cos(angle) * particleSpeed,
      vy: Math.sin(angle) * particleSpeed,
      life,
      maxLife: life,
      size,
      color,
      colorEnd,
      gravityScale,
      dragScale,
    });
  }
  return result;
}
