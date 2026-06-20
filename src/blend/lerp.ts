import type { Pose2D } from './types';

/**
 * General pose-blend primitive: interpolate between two TRS poses by a weight.
 *
 * Pure arithmetic over `Pose2D`. Zero runtime dependencies, no host reads, no
 * global state. Deterministic: identical inputs produce byte-identical output
 * forever.
 *
 * Identity values for missing fields.
 */
/** Identity translation: no offset. */
const IDENTITY_TRANSLATION = { x: 0, y: 0 } as const;
/** Identity rotation: no rotation. */
const IDENTITY_ROTATION = 0;
/** Identity scale: 1:1. */
const IDENTITY_SCALE = 1;

/**
 * Linear interpolation between two scalars.
 *
 * Uses the `a + (b - a) * t` form to match the established convention in
 * `src/animation/locomotion.ts` (`blendAirborneTuck`). At `t = 0` returns `a`;
 * at `t = 1` returns `b`. `t` is assumed pre-clamped to `[0, 1]` by callers.
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Clamp a value to the inclusive range `[lo, hi]`.
 */
function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Blend (interpolate) between two poses by `weight`. Undefined fields are
 * treated as identity (translation `{0,0}`, rotation `0`, scale `1`).
 *
 * - At `weight = 0` the result equals pose A.
 * - At `weight = 1` it equals pose B.
 * - At `weight = 0.5` it is the midpoint of each channel.
 *
 * `weight` is clamped to `[0, 1]`, so values outside that range are silent
 * no-ops (snap to the nearer endpoint) rather than extrapolations or errors.
 *
 * The result always carries all three fields (a fully-specified pose) — there
 * are never any `undefined` channels. This removes the need for null checks in
 * downstream consumers (IK solvers, renderers) reading the blended pose.
 *
 * Pure: returns a new object; never mutates either input. Never throws.
 *
 * @param a      - source pose (`weight = 0`)
 * @param b      - target pose (`weight = 1`)
 * @param weight - blend factor; clamped to `[0, 1]`
 * @returns a new fully-specified `Pose2D` (no undefined fields)
 *
 * @example
 * ```ts
 * const pose = blendPose(idlePose, crouchPose, crouchAmount);
 * // pose.translation, pose.rotation, pose.scale are all defined.
 * ```
 */
export function blendPose(a: Pose2D, b: Pose2D, weight: number): Pose2D {
  const w = clamp(weight, 0, 1);

  const ta = a.translation ?? IDENTITY_TRANSLATION;
  const tb = b.translation ?? IDENTITY_TRANSLATION;
  const ra = a.rotation ?? IDENTITY_ROTATION;
  const rb = b.rotation ?? IDENTITY_ROTATION;
  const sa = a.scale ?? IDENTITY_SCALE;
  const sb = b.scale ?? IDENTITY_SCALE;

  return {
    translation: { x: lerp(ta.x, tb.x, w), y: lerp(ta.y, tb.y, w) },
    rotation: lerp(ra, rb, w),
    scale: lerp(sa, sb, w),
  };
}

/**
 * Blend two arrays of poses element-by-element.
 *
 * If the arrays differ in length, the shorter is padded with empty poses
 * (`{}`, which resolves to full identity under `blendPose`). The result has
 * the length of the longer input array.
 *
 * - Equal lengths → straightforward element-wise blend.
 * - `posesA` longer → trailing elements blend A's value toward identity (B).
 * - `posesB` longer → trailing elements blend identity (A) toward B's value.
 * - Both empty → empty result.
 *
 * Pure: returns a new array of new objects; never mutates either input array
 * or any pose object within it. Never throws.
 *
 * @param posesA - source pose array (`weight = 0`)
 * @param posesB - target pose array (`weight = 1`)
 * @param weight - blend factor; clamped to `[0, 1]`
 * @returns a new array (length = `max(posesA.length, posesB.length)`) of new
 *          fully-specified poses
 *
 * @example
 * ```ts
 * const blended = blendPoses(upperBody, lowerBody, 0.5);
 * ```
 */
export function blendPoses(
  posesA: readonly Pose2D[],
  posesB: readonly Pose2D[],
  weight: number,
): Pose2D[] {
  const len = Math.max(posesA.length, posesB.length);
  const out: Pose2D[] = new Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = blendPose(posesA[i] ?? {}, posesB[i] ?? {}, weight);
  }
  return out;
}
