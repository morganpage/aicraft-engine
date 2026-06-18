/**
 * Cached probe for the host's `prefers-reduced-motion: reduce` setting.
 *
 * The probe is read once at first call and cached for the lifetime of the
 * module. This mirrors Spitekeep's `render/renderer.ts:40-43` pattern.
 *
 * Returns `false` in any of these cases:
 *   - `window` is undefined (Node unit tests, SSR, workers)
 *   - `window.matchMedia` is missing (very old browsers)
 *   - `matchMedia` throws (rare; treated as no-preference)
 *
 * Defensive by design: a missing or broken media query never crashes a game.
 */

let cachedPreference: boolean | null = null;

/**
 * Returns `true` if the user has requested reduced motion. Result is cached.
 */
export function prefersReducedMotion(): boolean {
  if (cachedPreference !== null) return cachedPreference;
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      cachedPreference = false;
    } else {
      cachedPreference = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
  } catch {
    cachedPreference = false;
  }
  return cachedPreference;
}

/**
 * Reset the cached preference. Exposed for tests that need to simulate
 * both preference states in the same process. Not intended for game code.
 */
export function resetMotionCacheForTests(): void {
  cachedPreference = null;
}
