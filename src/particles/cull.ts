import type { Particle } from './types';

/**
 * Return a new array containing only particles with `life > 0`.
 * Pure: does not mutate the input array. Particle objects in the returned
 * array are the same references as in the input — treat them as immutable.
 */
export function cull(particles: readonly Particle[]): Particle[] {
  return particles.filter((p) => p.life > 0);
}
