import type { Particle } from './types';

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
  /** Starting angle in radians. Default `0`. */
  angleOffset?: number;
  /** Seeded RNG. Required when `speedJitter > 0`. */
  rng?: () => number;
}

/**
 * Spawn `count` particles evenly distributed around a circle centered at
 * `(x, y)`. Deterministic when `speedJitter` is `0` (default): the same call
 * always produces the same particles, given the same inputs.
 *
 * Matches Spitekeep's `core/update.ts:43-74` pattern (8 particles, evenly
 * distributed angles, deterministic by default).
 *
 * @returns a new array of particles. Empty if `count <= 0` or `life <= 0`.
 * @throws if `speedJitter > 0` and no `rng` is provided.
 */
export function spawn(x: number, y: number, opts: SpawnOptions): Particle[] {
  const {
    count,
    speed,
    speedJitter = 0,
    life,
    size,
    color,
    angleOffset = 0,
    rng,
  } = opts;

  if (speedJitter > 0 && !rng) {
    throw new Error('spawn: speedJitter > 0 requires an rng function');
  }
  if (count <= 0) return [];
  if (life <= 0) return [];

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
    });
  }
  return result;
}
