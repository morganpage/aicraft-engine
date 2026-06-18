/**
 * Named constants shared across the animation pillar.
 *
 * IK-solver-specific iteration/tolerance constants live in
 * `src/animation/ik/constants.ts` (added in a later task). This file holds
 * only the constants used by the foundation (`src/animation/rig.ts`,
 * `src/animation/transform.ts`) and the forward-declared foot-lock default
 * (consumed by `src/animation/foot-lock.ts` in a later task), so the full
 * constant surface ships in one place rather than fragmenting across tasks.
 */

/**
 * Determinant magnitude below which a 2×3 affine transform is treated as
 * singular (non-invertible) by `worldToLocal`.
 *
 * The determinant of the 2×2 linear part is `a*d - b*c`. When its absolute
 * value drops below this threshold (e.g. a zero-scale bone), the closed-form
 * inverse would divide by ~0 and produce garbage; `worldToLocal` returns
 * `{x: 0, y: 0}` instead. The threshold is a named constant — not an epsilon
 * comparison against computed error — so it cannot branch differently across
 * IEEE 754 platforms.
 */
export const SINGULAR_MATRIX_DET_THRESHOLD = 1e-8;

/**
 * Default rate of change of the foot-lock blend weight, in units per second.
 *
 * Consumed by `advanceFootLock` (added in a later task) when no explicit
 * `blendSpeed` is passed. Forward-declared here so the foundation ships the
 * full constant surface in one place.
 */
export const FOOT_LOCK_DEFAULT_BLEND_SPEED = 10;
