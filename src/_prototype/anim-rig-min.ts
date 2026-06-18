/**
 * MINIMAL skeletal-rig prototype.
 *
 * This is NOT the production rig (that lives in `src/animation/rig.ts` and uses
 * the full `BoneNode` / `SkeletonTemplate` / `Rig` types from the approved
 * proposal). This file contains just enough math to host the IK and spring
 * prototypes and to render sample scenes: a flat bone array, a single-pass
 * world-transform propagation, and point transforms.
 *
 * Rotation convention (pillar-wide): radians from the +X axis, positive
 * rotation +X -> +Y. Because Canvas2D's Y axis points DOWN, positive rotation
 * appears clockwise on-screen and matches `ctx.rotate(angle)` exactly. A
 * rotation by theta maps to the affine matrix `[cos, sin, -sin, cos, tx, ty]`,
 * i.e. `ctx.transform(cos, sin, -sin, cos, tx, ty)`.
 *
 * Coordinate space for samples: 256x256, origin TOP-LEFT, +X right, +Y down.
 */

/** Determinant magnitude below which a 2x2 is treated as singular. */
export const SINGULAR_MATRIX_DET_THRESHOLD = 1e-8;

/** 2D vector. */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * 2x3 affine transform as a 6-tuple, matching `ctx.transform(a, b, c, d, e, f)`.
 *
 * Layout:
 * ```
 * | a  c  tx |
 * | b  d  ty |
 * | 0  0  1  |
 * ```
 */
export type AffineTransform = [
  a: number, b: number,
  c: number, d: number,
  tx: number, ty: number,
];

/**
 * Local-space pose for a single bone. All fields optional (identity defaults).
 * Flat (`tx` / `ty` / `scaleX` / `scaleY`) for prototype ergonomics; the
 * production type uses nested `translation` / `scale` Vec2 fields per the
 * approved proposal. Rotation is radians from +X (see file header).
 */
export interface BonePose {
  tx?: number;
  ty?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
}

/**
 * Minimal bone definition for the prototype. The production type (`BoneNode`)
 * also carries an `id`, `attachmentSlot`, and lives inside a `SkeletonTemplate`.
 */
export interface Bone {
  /** Parent bone index, or -1 for a root. Must be less than this bone's index. */
  parentIndex: number;
  /** Rest pose (used to seed localPoses; not read during propagation). */
  rest: BonePose;
}

/**
 * Build a local affine matrix from a BonePose (TRS: translate * rotate * scale).
 *
 * For rotation `theta` and scale `(sx, sy)`:
 *   `a = cos*sx, b = sin*sx, c = -sin*sy, d = cos*sy`.
 *
 * @param pose - the bone's local pose (missing fields default to identity)
 * @returns a new 6-tuple AffineTransform
 */
export function poseToMatrix(pose: BonePose): AffineTransform {
  const theta = pose.rotation ?? 0;
  const sx = pose.scaleX ?? 1;
  const sy = pose.scaleY ?? 1;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [
    cos * sx,
    sin * sx,
    -sin * sy,
    cos * sy,
    pose.tx ?? 0,
    pose.ty ?? 0,
  ];
}

/**
 * Compose two affine matrices as `parent * local` (parent on the left).
 *
 * @returns a new 6-tuple AffineTransform
 */
export function compose(parent: AffineTransform, local: AffineTransform): AffineTransform {
  const [pa, pb, pc, pd, ptx, pty] = parent;
  const [la, lb, lc, ld, ltx, lty] = local;
  return [
    pa * la + pc * lb,
    pb * la + pd * lb,
    pa * lc + pc * ld,
    pb * lc + pd * ld,
    pa * ltx + pc * lty + ptx,
    pb * ltx + pd * lty + pty,
  ];
}

/**
 * Compute world-space transforms for every bone in a single O(N) forward pass.
 *
 * Parents MUST precede children in the array (topological order). Root bones
 * (`parentIndex === -1`) compose against identity. Pure: returns a new array
 * and reads inputs as readonly.
 *
 * @param bones - flat bone array (parents before children)
 * @param localPoses - per-bone local pose; index aligns with `bones`. Missing
 *   entries fall back to the bone's rest pose.
 * @returns world affine transform per bone
 */
export function computeWorldTransforms(
  bones: readonly Bone[],
  localPoses: readonly BonePose[],
): AffineTransform[] {
  const world: AffineTransform[] = new Array(bones.length);
  for (let i = 0; i < bones.length; i++) {
    const local = poseToMatrix(localPoses[i] ?? bones[i].rest);
    const parentIndex = bones[i].parentIndex;
    world[i] = parentIndex === -1 ? local : compose(world[parentIndex], local);
  }
  return world;
}

/**
 * Transform a point from a bone's local space to world space.
 *
 * @param point - point in the bone's local space
 * @param world - world transforms (from `computeWorldTransforms`)
 * @param boneIndex - which bone's space to transform from
 * @returns the point in world space
 */
export function localToWorld(
  point: Vec2,
  world: readonly AffineTransform[],
  boneIndex: number,
): Vec2 {
  const [a, b, c, d, tx, ty] = world[boneIndex];
  return {
    x: a * point.x + c * point.y + tx,
    y: b * point.x + d * point.y + ty,
  };
}

/**
 * Transform a point from world space into a bone's local space.
 *
 * Uses the closed-form 2x3 inverse. Returns `{x: 0, y: 0}` when the transform
 * is singular (`|det| < SINGULAR_MATRIX_DET_THRESHOLD`). Pure.
 *
 * @param point - point in world space
 * @param world - world transforms (from `computeWorldTransforms`)
 * @param boneIndex - which bone's space to transform into
 * @returns the point in the bone's local space (or origin on singular input)
 */
export function worldToLocal(
  point: Vec2,
  world: readonly AffineTransform[],
  boneIndex: number,
): Vec2 {
  const [a, b, c, d, tx, ty] = world[boneIndex];
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
