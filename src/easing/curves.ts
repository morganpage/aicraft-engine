/**
 * Pure Robert Penner easing curves.
 *
 * Every export is a pure `(t: number) => number` function mapping normalized
 * progress `t ∈ [0, 1]` to an eased value. Endpoints pin exactly: `f(0) === 0`
 * and `f(1) === 1` for every shipped curve (back/elastic may overshoot
 * mid-flight, but they settle to the endpoints). No `Math.random`, no
 * `Date.now`, no host reads, no global state — fully deterministic and
 * replay-safe.
 *
 * Only `Math` from the standard library is used. The Penner constants
 * (`1.70158`, `13`, the bounce piecewise coefficients) are mathematical
 * definitions tuned by decades of engine use — they are inlined with a named
 * rationale rather than exposed as tunables (precedent: `oscillators.ts`
 * inlines `Math.PI * 2`).
 *
 * @module
 */

/**
 * Linear easing — the identity function. `f(t) = t`.
 *
 * @param t - normalized progress in `[0, 1]`
 * @returns `t` unchanged
 *
 * @example
 * ```ts
 * const v = linear(0.5); // 0.5
 * ```
 */
export function linear(t: number): number {
  return t;
}

/**
 * Generic power-out easing: `1 - (1 - t)^n`.
 *
 * Covers the quad/cubic/quart/quint family by parameter. `powOut(t, 2)` is
 * `easeOutQuad`, `powOut(t, 3)` is `easeOutCubic`, and so on — the named
 * curves delegate here, so the two are bit-identical for matching `n`.
 *
 * @param t - normalized progress in `[0, 1]`
 * @param n - power exponent (2 = quad, 3 = cubic, 4 = quart, 5 = quint)
 * @returns eased value in `[0, 1]`
 *
 * @example
 * ```ts
 * const v = powOut(progress, 6); // a steeper-than-quint snap
 * ```
 */
export function powOut(t: number, n: number): number {
  return 1 - Math.pow(1 - t, n);
}

/**
 * Ease-out quad: `1 - (1 - t)²`. Gentle deceleration.
 *
 * Equivalent to `powOut(t, 2)`.
 *
 * @param t - normalized progress in `[0, 1]`
 */
export function easeOutQuad(t: number): number {
  return powOut(t, 2);
}

/**
 * Ease-out cubic: `1 - (1 - t)³`. Fast start, gentle settle. The most common
 * game easing.
 *
 * Equivalent to `powOut(t, 3)`.
 *
 * @param t - normalized progress in `[0, 1]`
 */
export function easeOutCubic(t: number): number {
  return powOut(t, 3);
}

/**
 * Ease-out quart: `1 - (1 - t)⁴`. Aggressive start, soft landing.
 *
 * Equivalent to `powOut(t, 4)`.
 *
 * @param t - normalized progress in `[0, 1]`
 */
export function easeOutQuart(t: number): number {
  return powOut(t, 4);
}

/**
 * Ease-out quint: `1 - (1 - t)⁵`. Maximum snap of the power family.
 *
 * Equivalent to `powOut(t, 5)`.
 *
 * @param t - normalized progress in `[0, 1]`
 */
export function easeOutQuint(t: number): number {
  return powOut(t, 5);
}

/**
 * Ease-out sine: `sin(t · π/2)`. Smooth, zero-velocity-at-endpoint feel.
 *
 * @param t - normalized progress in `[0, 1]`
 */
export function easeOutSine(t: number): number {
  return Math.sin((t * Math.PI) / 2);
}

/**
 * Ease-out exponential: `1 - 2^(-10t)`, with `t === 1` pinned to exactly `1`
 * (the closed form approaches 1 asymptotically; the ternary guarantees the
 * endpoint pins exactly). Sharper than quint near the start.
 *
 * @param t - normalized progress in `[0, 1]`
 */
export function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/**
 * Ease-out circular: `sqrt(1 - (1 - t)²)`. Slow ease-out with a steep
 * deceleration curve, clamped to `[0, 1]`.
 *
 * @param t - normalized progress in `[0, 1]`
 */
export function easeOutCirc(t: number): number {
  return Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
}

/**
 * Ease-out back: overshoots past `1` then settles back. The Penner back
 * constant `s = 1.70158` controls the pullback magnitude before the overshoot.
 *
 * @param t - normalized progress in `[0, 1]`
 *
 * @example
 * ```ts
 * // Camera punch: scale snaps past the target and settles.
 * const scale = 1.0 + (1.2 - 1.0) * easeOutBack(progress);
 * ```
 */
export function easeOutBack(t: number): number {
  // s = 1.70158 — the canonical Penner "back" overshoot constant.
  const s = 1.70158;
  const t1 = t - 1;
  return t1 * t1 * ((s + 1) * t1 + s) + 1;
}

/**
 * Ease-out elastic: a damped sinusoidal spring. The value oscillates around
 * `1` with exponentially decaying amplitude — 13 half-cycles with exponential
 * decay (frequency constant `13`, decay base `2^(-10t)`).
 *
 * @param t - normalized progress in `[0, 1]`
 */
export function easeOutElastic(t: number): number {
  // 13 = half-cycle count of the spring oscillation (Penner elastic frequency).
  return (Math.sin((-13 * (t + 1) * Math.PI) / 2) * Math.pow(2, -10 * t)) + 1;
}

/**
 * Ease-out bounce: a piecewise-quadratic floor-bounce simulation. Four
 * parabolic segments approximate a ball bouncing to rest. This is the only
 * curve that cannot be expressed as a single closed form.
 *
 * The segment thresholds and coefficients (`4/11`, `8/11`, `9/10`, and the
 * derived parabola constants) are the canonical mattdesl/eases set; they
 * ensure C0 continuity at each segment boundary.
 *
 * @param t - normalized progress in `[0, 1]`
 */
export function easeOutBounce(t: number): number {
  // Piecewise thresholds — canonical bounce segment boundaries.
  const a = 4 / 11;
  const b = 8 / 11;
  const c = 9 / 10;
  const t2 = t * t;
  if (t < a) return 7.5625 * t2;
  if (t < b) return 9.075 * t2 - 9.9 * t + 3.4;
  if (t < c) {
    // 4356/361, 35442/1805, 16061/1805 — derived parabola coefficients.
    return (4356 / 361) * t2 - (35442 / 1805) * t + 16061 / 1805;
  }
  return 10.8 * t2 - 20.52 * t + 10.72;
}

/**
 * Derive the In variant of an Out curve: `easeIn(f)(t) = 1 - f(1 - t)`.
 *
 * Given any Out easing `f`, returns its mirror that accelerates from rest.
 * Endpoints are preserved: `easeIn(f)(0) === 0` and `easeIn(f)(1) === 1`.
 *
 * @param f - any Out easing `(t: number) => number` with `f(0) === 0`, `f(1) === 1`
 * @returns the In variant
 *
 * @example
 * ```ts
 * const easeInCubic = easeIn(easeOutCubic);
 * ```
 */
export function easeIn(f: (t: number) => number): (t: number) => number {
  return (t: number): number => 1 - f(1 - t);
}

/**
 * Derive the InOut variant of an Out curve, symmetric around `t = 0.5`.
 *
 * `easeInOut(f)(t) = t < 0.5 ? 0.5 · (1 - f(1 - 2t)) : 0.5 · f(2t - 1) + 0.5`.
 * The first half runs the In form; the second half runs the Out form. Endpoints
 * pin exactly and, for a symmetric base, the midpoint is `0.5`.
 *
 * @param f - any Out easing `(t: number) => number` with `f(0) === 0`, `f(1) === 1`
 * @returns the InOut variant
 *
 * @example
 * ```ts
 * const easeInOutCubic = easeInOut(easeOutCubic);
 * ```
 */
export function easeInOut(f: (t: number) => number): (t: number) => number {
  return (t: number): number =>
    t < 0.5 ? 0.5 * (1 - f(1 - 2 * t)) : 0.5 * f(2 * t - 1) + 0.5;
}
