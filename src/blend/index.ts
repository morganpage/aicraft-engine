/**
 * Blend pillar — general pose-blend primitives.
 *
 * A standalone pure-arithmetic module for interpolating between two TRS
 * (`Pose2D`) poses by a weight. Independent of the animation pillar; defined
 * here so it can evolve without entangling the skeletal-rig types. The
 * `Pose2D` interface is structurally compatible with `BonePose` from
 * `src/animation/types.ts` (duck typing) for the `translation` and `rotation`
 * channels.
 *
 * - `blendPose(a, b, w)` — interpolate two single-bone poses.
 * - `blendPoses(a[], b[], w)` — element-wise blend of pose arrays (pads the
 *   shorter array with identity).
 *
 * All exports are pure, deterministic, and never throw.
 */
export type { Pose2D } from './types';
export { blendPose, blendPoses } from './lerp';
