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

/**
 * Create a deterministic RNG function.
 *
 * @param seed - 32-bit unsigned integer seed
 * @returns a function that returns floats in `[0, 1)` on each call
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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
