import type { Particle } from './types';
import { advance, type AdvanceOptions } from './advance';
import { cull } from './cull';

/**
 * Convenience: `cull(advance(particles, dt, opts))`. The standard per-tick
 * pipeline for particle systems. Pure: returns a new array.
 */
export function step(
  particles: readonly Particle[],
  dt: number,
  opts: AdvanceOptions = {},
): Particle[] {
  return cull(advance(particles, dt, opts));
}
