/**
 * Directional cone descriptor for initial particle velocity.
 *
 * Used by `EmitterConfig.cone` (Approach B) and standalone
 * `sampleConeVelocity` (Approach A).
 */
import { warnImplausibleSpeed } from './plausibility';

export interface ConeConfig {
  /**
   * Direction of cone center in radians. `-π/2` = straight up (Canvas2D, where
   * +y is down). `0` = rightward.
   */
  baseAngle: number;
  /** Total angular width of the cone in radians, centered on `baseAngle`. */
  spread: number;
  /** Minimum spawn speed (inclusive). */
  speedMin: number;
  /** Maximum spawn speed (the effective upper bound; sampled speed < speedMax). */
  speedMax: number;
}

/**
 * Deterministically sample a velocity vector inside an angular cone. Pure;
 * consumes exactly 2 RNG draws (one for angle, one for speed).
 *
 * Angle is sampled uniformly in `[baseAngle - spread/2, baseAngle + spread/2]`.
 * Speed is sampled uniformly in `[speedMin, speedMax)`. Decoupling the two
 * (per the research note) gives full artistic control over the burst shape.
 *
 * @param config - cone descriptor
 * @param rng - seeded RNG function
 * @returns a sampled `{vx, vy}` velocity
 *
 * @example
 * ```ts
 * import { mulberry32 } from '../rng';
 * import { sampleConeVelocity } from './cone';
 * // Narrow upward cone (fire): -π/2 ± 0.25 rad, speed 1.5–3.0
 * const v = sampleConeVelocity(
 *   { baseAngle: -Math.PI / 2, spread: 0.5, speedMin: 1.5, speedMax: 3.0 },
 *   mulberry32(42),
 * );
 * ```
 */
export function sampleConeVelocity(
  config: ConeConfig,
  rng: () => number,
): { vx: number; vy: number } {
  // Dev-time units tripwire (warn once per process — see plausibility.ts).
  warnImplausibleSpeed('sampleConeVelocity (speedMax)', config.speedMax);
  const halfSpread = config.spread / 2;
  const angle = config.baseAngle + (rng() * 2 - 1) * halfSpread;
  const speed = config.speedMin + rng() * (config.speedMax - config.speedMin);
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}
