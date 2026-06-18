/**
 * Small numeric helpers used throughout the engine.
 *
 * All functions are pure and deterministic. No `Math.random`.
 */

/** Clamp `v` to the closed range `[lo, hi]`. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Alias for `Math.floor`, used to signal pixel-grid intent at call sites. */
export function floor(v: number): number {
  return Math.floor(v);
}

/** Linear interpolation: `t=0` returns `a`, `t=1` returns `b`. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Move `current` toward `target` by at most `maxDelta`. Returns `target`
 * exactly if within `maxDelta`. Used for frame-rate-independent smoothing
 * (cameras, scroll positions, tween followers).
 */
export function approach(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}
