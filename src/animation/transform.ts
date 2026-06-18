import type { Rig, Vec2 } from './types';
import { SINGULAR_MATRIX_DET_THRESHOLD } from './constants';

/**
 * Transform a point from a bone's local space to world space.
 *
 * Uses the bone's current world transform (`rig.worldTransforms[boneIndex]`).
 * The caller MUST ensure `computeWorldTransforms(rig)` has been run with
 * up-to-date `localPoses` before calling.
 *
 * @param point - the point in the bone's local coordinate system
 * @param rig - the rig (must have current `worldTransforms`)
 * @param boneIndex - the bone whose local space to transform from; must be a
 *   valid index into `template.bones`
 * @returns the point in world space
 */
export function localToWorld(point: Vec2, rig: Rig, boneIndex: number): Vec2 {
  const m = rig.worldTransforms[boneIndex];
  const a = m[0];
  const b = m[1];
  const c = m[2];
  const d = m[3];
  const tx = m[4];
  const ty = m[5];
  return {
    x: a * point.x + c * point.y + tx,
    y: b * point.x + d * point.y + ty,
  };
}

/**
 * Transform a point from world space to a bone's local space.
 *
 * Uses the closed-form 2×3 inverse of the bone's world transform. For
 * non-degenerate transforms (non-zero scale, no extreme shear), this is exact.
 *
 * **Singular case:** if `|det| < SINGULAR_MATRIX_DET_THRESHOLD` (e.g. a
 * zero-scale bone), the transform is non-invertible and this returns
 * `{x: 0, y: 0}` rather than dividing by ~0. This is a deterministic,
 * platform-independent fallback — the threshold is a named constant, not an
 * epsilon comparison against computed error.
 *
 * @param point - the point in world space
 * @param rig - the rig (must have current `worldTransforms`)
 * @param boneIndex - the bone whose local space to transform into; must be a
 *   valid index into `template.bones`
 * @returns the point in the bone's local coordinate system, or `{x: 0, y: 0}`
 *   if the bone's world transform is singular
 */
export function worldToLocal(point: Vec2, rig: Rig, boneIndex: number): Vec2 {
  const m = rig.worldTransforms[boneIndex];
  const a = m[0];
  const b = m[1];
  const c = m[2];
  const d = m[3];
  const tx = m[4];
  const ty = m[5];
  const det = a * d - b * c;
  if (Math.abs(det) < SINGULAR_MATRIX_DET_THRESHOLD) {
    return { x: 0, y: 0 };
  }
  const inv = 1 / det;
  const ix = point.x - tx;
  const iy = point.y - ty;
  return {
    x: (d * ix - c * iy) * inv,
    y: (-b * ix + a * iy) * inv,
  };
}
