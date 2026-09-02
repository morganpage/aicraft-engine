/**
 * Seeded pseudo-random number generation.
 *
 * Determinism rule (see `docs/architecture.md`): no `Math.random` in code that
 * influences game state, save data, or cosmetic manifests. Use these helpers
 * instead. A seeded RNG produces the same sequence forever from the same seed.
 *
 * Algorithm: mulberry32 — small, fast, statistically good enough for game use,
 * and deterministic across JS engines (no BigInt, no platform-specific math).
 */

import { stepMulberry32 } from './state';

/**
 * Create a deterministic RNG function.
 *
 * The closure is the ergonomic API for setup code and visual randomness.
 * Streams that must survive save/restore or replay should use the
 * serializable pure-state API in `state.ts` instead — both produce the
 * identical stream because they share one internal step.
 *
 * @param seed - 32-bit unsigned integer seed
 * @returns a function that returns floats in `[0, 1)` on each call
 */
export function mulberry32(seed: number): () => number {
  let word = seed >>> 0;
  return function next(): number {
    const step = stepMulberry32(word);
    word = step.word;
    return step.float;
  };
}

/**
 * Inclusive integer in `[min, max]`. Requires a seeded `rng`.
 */
export function nextInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/**
 * Float in `[min, max)`. Requires a seeded `rng`.
 */
export function nextFloat(rng: () => number, min: number, max: number): number {
  return rng() * (max - min) + min;
}

/**
 * Either `-1` or `+1`. Requires a seeded `rng`.
 */
export function nextSign(rng: () => number): number {
  return rng() < 0.5 ? -1 : 1;
}

/**
 * Random element from a non-empty array. Requires a seeded `rng`.
 * Throws on empty input — defensive adapters should pre-check length.
 */
export function pick<T>(rng: () => number, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pick: array is empty');
  return arr[Math.floor(rng() * arr.length)];
}
