/**
 * Shared foundation types for the animation pillar: skeletal rigging, IK, and
 * procedural locomotion. This is the authoritative definition — sibling
 * proposals (IK, locomotion, springs) import from here. Do not duplicate.
 *
 * **Rotation convention (pillar-wide):** Rotation angles are in radians,
 * measured from the +X axis, positive +X→+Y. Because Canvas2D's Y-axis
 * points DOWN, positive rotation appears clockwise on-screen and matches
 * `ctx.rotate(angle)` exactly. A rotation by θ maps to the affine matrix
 * `[cos θ, sin θ, -sin θ, cos θ, tx, ty]`, i.e.
 * `ctx.transform(cos θ, sin θ, -sin θ, cos θ, tx, ty)`. Verified by the
 * `benchmarks/animation/rig-hierarchy.png` benchmark.
 */

/**
 * 2D vector. Used for positions, offsets, and directions throughout the
 * animation and rendering systems.
 *
 * **Migration note:** Canonical home is now `src/animation/types.ts`. The
 * previous definition in `src/primitives/animation.ts` is deleted; there is
 * no back-compat re-export shim (the library has no consumers yet).
 */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * 2D affine transform as a 6-tuple, matching Canvas2D's
 * `ctx.transform(a, b, c, d, e, f)`.
 *
 * Layout (column-major; the last row `[0, 0, 1]` is implicit and never
 * stored):
 * ```
 * | a  c  tx |
 * | b  d  ty |
 * | 0  0  1  |
 * ```
 *
 * For a rotation by angle θ (radians, per the pillar rotation convention):
 * `a = cos θ, b = sin θ, c = -sin θ, d = cos θ`. This maps directly to
 * `ctx.transform(cos θ, sin θ, -sin θ, cos θ, tx, ty)` with zero conversion
 * — the reason a 2×3 matrix (not a TRS record) is the canonical representation.
 *
 * Composition is standard matrix multiplication: `world = parent · local`
 * (8 mul + 4 add). Stored as a tuple (not an object) for compactness in the
 * per-frame hot path (6 × 8-byte doubles = 48 bytes, no hidden-class overhead).
 */
export type AffineTransform = [
  a: number, b: number,
  c: number, d: number,
  tx: number, ty: number,
];

/**
 * Local-space pose for a single bone. Translation, rotation (radians, per the
 * pillar convention), and scale relative to the bone's parent. This is the
 * consumer's input interface; the engine converts it to an `AffineTransform`
 * during `computeWorldTransforms`.
 *
 * All fields are optional and default to the identity transform. Omitting
 * `translation` is the same as `{x: 0, y: 0}`; omitting `scale` is the same
 * as `{x: 1, y: 1}`; omitting `rotation` is the same as `0`.
 */
export interface BonePose {
  /** Local translation relative to parent. Default `{x: 0, y: 0}`. */
  translation?: Vec2;
  /**
   * Local rotation in radians, measured from the +X axis, positive +X→+Y
   * (appears clockwise on-screen; matches `ctx.rotate()`). Default `0`.
   */
  rotation?: number;
  /** Local scale. Default `{x: 1, y: 1}`. */
  scale?: Vec2;
}

/**
 * A single bone in the skeleton hierarchy. Bones live in a flat array ordered
 * so that every parent precedes its children (topological sort). This lets
 * `computeWorldTransforms` propagate transforms in a single O(N) forward pass
 * with zero recursion.
 */
export interface BoneNode {
  /** Unique identifier within the skeleton (e.g. `"left_upper_arm"`). */
  id: string;
  /**
   * Index of this bone's parent in the bones array, or `-1` for a root bone.
   * An integer index (not a string reference) keeps the hot propagation loop
   * cache-friendly. MUST be `-1` or strictly less than this bone's own index.
   */
  parentIndex: number;
  /** Rest pose — the default local TRS when no animation is applied. */
  restPose: BonePose;
  /**
   * Optional attachment slot name (e.g. `"hand"`, `"foot"`, `"weapon_tip"`).
   * IK and locomotion solvers target bones by slot name (resolved via
   * `SkeletonTemplate.slotMap`), not by bone id. A bone may have zero or one
   * attachment slot. Slot names MUST be unique across the skeleton.
   */
  attachmentSlot?: string;
}

/**
 * A reusable skeleton definition. Shared across all instances of the same
 * body type (e.g. `"humanoid"`, `"quadruped"`). Created via `createSkeleton`
 * and immutable after creation.
 */
export interface SkeletonTemplate {
  /** Flat array of bones, topologically sorted (parents before children). */
  readonly bones: readonly BoneNode[];
  /**
   * Pre-computed rest-pose world transforms for each bone. Cached at template
   * creation so consumers can read default bone positions without running
   * `computeWorldTransforms`.
   */
  readonly restWorldTransforms: readonly AffineTransform[];
  /**
   * Pre-computed bone lengths. `boneLengths[i]` is the distance from bone
   * `i`'s rest-pose origin to its first child's rest-pose origin in world
   * space; `0` for leaf bones. Used by IK solvers.
   */
  readonly boneLengths: readonly number[];
  /**
   * Map from attachment slot name to bone index. Built at template creation
   * for O(1) lookup by IK/locomotion solvers.
   */
  readonly slotMap: Readonly<Record<string, number>>;
}

/**
 * A live rig instance bound to a `SkeletonTemplate`. Contains the current
 * local poses (the consumer's write surface) and the computed world-space
 * transforms (the renderer's read surface).
 *
 * **Mutability contract (Decision 3 — scoped hybrid):**
 * - `localPoses` = mutable consumer workspace. The consumer or locomotion
 *   system writes here each tick without cloning.
 * - `worldTransforms` / `worldPositions` / `worldRotations` = mutable DERIVED
 *   CACHE, recomputed by `computeWorldTransforms(rig)` each frame. Rendering
 *   output; never read by deterministic simulation logic.
 *
 * This hybrid mutability is the sole relaxation of "no state mutation" (the
 * renderer-output buffer exception in `docs/architecture.md`) and is exercised
 * only by `src/animation/rig.ts`. All other animation systems (locomotion,
 * IK, springs, foot-lock) stay pure-clone consistent with
 * `src/particles/advance.ts`.
 */
export interface Rig {
  /** Reference to the shared skeleton definition. */
  readonly template: SkeletonTemplate;
  /**
   * Current local poses for each bone. Indexed identically to
   * `template.bones`. The consumer (or locomotion system) writes here;
   * `computeWorldTransforms` reads from here.
   *
   * Mutable: set poses each tick without cloning.
   */
  localPoses: BonePose[];
  /**
   * Computed world-space transforms. Written by `computeWorldTransforms`.
   * Indexed identically to `template.bones`.
   *
   * Mutable DERIVED CACHE: overwritten in-place each frame by
   * `computeWorldTransforms`. Rendering output; never read by deterministic
   * simulation logic.
   */
  worldTransforms: AffineTransform[];
  /**
   * World-space positions for each bone origin (the `tx, ty` of the world
   * transform). Convenience cache for IK solvers, which need positions more
   * than full matrices.
   *
   * Mutable DERIVED CACHE: overwritten in-place by `computeWorldTransforms`.
   */
  worldPositions: Vec2[];
  /**
   * World-space rotations for each bone (`atan2(b, a)` of the world
   * transform). Convenience cache for locomotion, which reads parent
   * rotations to compute relative offsets.
   *
   * Mutable DERIVED CACHE: overwritten in-place by `computeWorldTransforms`.
   */
  worldRotations: number[];
}

/**
 * An attachment point for IK or locomotion. Identifies a bone by its
 * attachment slot name and specifies a world-space target position.
 *
 * This is the data-only contract between the rig and the solver streams: the
 * solver reads this to know WHERE to aim; the rig provides the bone's world
 * transform so the solver can compute joint angles.
 */
export interface EffectorTarget {
  /** The attachment slot name (e.g. `"left_foot"`, `"right_hand"`). */
  slot: string;
  /** World-space target position for the effector. */
  target: Vec2;
}

/**
 * A skin definition: a mapping from bone index to a draw callback.
 *
 * Each callback receives the canvas context (already transformed to the
 * bone's world position/rotation) and the rig (so it can read
 * `worldTransforms`/`worldPositions` for sibling data) and draws vector
 * primitives for that bone. The skin does NOT own the skeleton — it's a thin
 * rendering layer on top of the rig. Swapping cosmetic variants means
 * swapping the `BoneDrawMap`, not the rig.
 *
 * Array indices correspond to bones: `skin[i]` is the draw entry for bone
 * `i`. A `null` entry means "no draw" (invisible bone) and is skipped by
 * `drawRig`.
 */
export type BoneDrawMap = Array<{
  /** The bone index this draw function is responsible for. */
  boneIndex: number;
  /**
   * Draw callback. Called with the canvas context (already transformed to
   * the bone's world position/rotation) and the rig for reading sibling
   * data. Side-effectful (canvas state); determinism of the draw is the
   * consumer's responsibility.
   */
  draw: (ctx: CanvasRenderingContext2D, rig: Rig) => void;
} | null>;
