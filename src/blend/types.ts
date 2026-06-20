/**
 * Type definitions for the blend module — a general pose-blend primitive
 * independent of the animation pillar.
 *
 * This module lives in `src/blend/` (not `src/animation/`) so it can evolve
 * without entangling with the skeletal-rig types. The `Pose2D` interface is
 * structurally compatible with `BonePose` from `src/animation/types.ts` for the
 * `translation` and `rotation` fields (duck typing); consumers may pass those
 * objects directly. It is defined here — NOT imported — to keep this module
 * dependency-free and independently compilable.
 */

/**
 * A blendable 2D bone pose. All fields are optional; `undefined` means the
 * identity transform for that channel. The identity values are:
 *   - translation: `{x: 0, y: 0}`
 *   - rotation: `0`
 *   - scale: `1`
 *
 * Unlike `BonePose.scale` (which is a `{x, y}` vector for non-uniform
 * scaling), `Pose2D.scale` is a single uniform scalar — this module models
 * a pure blend between two TRS poses, not full skeletal deformation.
 *
 * @example
 * ```ts
 * import { blendPose, type Pose2D } from '../blend';
 *
 * const idle: Pose2D = { translation: { x: 0, y: 0 }, rotation: 0, scale: 1 };
 * const crouch: Pose2D = { translation: { x: 0, y: 6 }, rotation: 0, scale: 0.9 };
 * const pose = blendPose(idle, crouch, crouchAmount);
 * ```
 */
export interface Pose2D {
  /** Local translation offset. Default identity: `{x: 0, y: 0}`. */
  translation?: { x: number; y: number };
  /** Local rotation in radians. Default identity: `0`. */
  rotation?: number;
  /** Local uniform scale. Default identity: `1`. */
  scale?: number;
}
