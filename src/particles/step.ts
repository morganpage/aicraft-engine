import type { Particle } from './types';
import { advance, type AdvanceOptions } from './advance';
import { cull } from './cull';

/**
 * Convenience: `cull(advance(particles, dtTicks, opts))`. The standard per-tick
 * pipeline for particle systems. `dtTicks` is in TICKS — for a fixed step held
 * in SECONDS use `stepSeconds` (`src/particles/seconds.ts`), which converts.
 * Pure: returns a new array.
 */
export function step(
  particles: readonly Particle[],
  dtTicks: number,
  opts: AdvanceOptions = {},
): Particle[] {
  return cull(advance(particles, dtTicks, opts));
}
