import type { Vec2 } from '../types';

/**
 * Solver-local angle-limit descriptor for an IK chain bone.
 *
 * Carries ONLY the optional angle limits the solver needs. Bone LENGTHS are
 * not duplicated here — they are read from `SkeletonTemplate.boneLengths`
 * (indexed by bone index) when the chain is backed by a rig. For standalone
 * chains not backed by a rig, callers pass lengths directly via the
 * `boneLengths` array argument of `solveCCD` / `solveFABRIK` or as the scalar
 * `lengthA` / `lengthB` arguments of `solveLimb`.
 *
 * **Cross-reference:** The rig's authoritative bone definition is `BoneNode`
 * in `src/animation/types.ts` (carries `id`, `parentIndex`, `restPose`,
 * `attachmentSlot`). `IkBone` is a separate, solver-local parameter type and
 * does not overlap with `BoneNode`'s responsibilities.
 *
 * Angle limits are expressed in radians using the pillar rotation convention
 * (from `+X`, positive `+X -> +Y`).
 *
 * **Note:** Angle-limit enforcement is forward-declared for the iterative
 * solvers; the initial ship is position-only for FABRIK and rotation-only
 * (no clamp) for CCD. The limits are accepted on the options surface so the
 * type is stable when enforcement lands.
 */
export interface IkBone {
  /** Minimum local rotation in radians (inclusive). Default unbounded. */
  minAngle?: number;
  /** Maximum local rotation in radians (inclusive). Default unbounded. */
  maxAngle?: number;
}

/**
 * An IK end-effector: identifies a target bone by attachment slot name and
 * specifies the world-space target position the effector should reach.
 *
 * Slot names are resolved to bone indices via `SkeletonTemplate.slotMap`.
 * Slot names are skin-agnostic and stable across cosmetic variants, so a
 * single `IkEffector` works regardless of which skin is bound to the rig.
 */
export interface IkEffector {
  /** Attachment slot name (e.g. `"left_foot"`, `"right_hand"`). */
  slot: string;
  /** World-space target position for the end effector. */
  target: Vec2;
}

/**
 * Result from an iterative IK solver (`solveCCD`, `solveFABRIK`): solved
 * world-space joint positions plus reconstructed local rotations per bone.
 */
export interface IkResult {
  /**
   * Solved world-space joint positions, `[root, ..., effector]`. Same length
   * as the input `positions` array.
   */
  positions: Vec2[];
  /**
   * Local rotation per bone in radians (relative to parent bone; root bone
   * relative to world `+X`). Length = `positions.length - 1`. Reconstructed
   * from the solved positions via `atan2(dy, dx)` (the pillar convention).
   */
  rotations: number[];
  /**
   * Diagnostic flag derived from the effector's final squared distance to the
   * target vs `IK_POSITION_TOLERANCE_SQ`.
   *
   * **DIAGNOSTIC ONLY.** Float-precision may cause this to vary across JS
   * engines / CPUs. NEVER branch game or simulation logic on it — it exists
   * for UI / debug feedback. Loop termination is fixed-iteration-count only
   * and never consults this tolerance.
   */
  solved: boolean;
}

/**
 * Options for the analytical 2-bone limb solver (`solveLimb`).
 */
export interface LimbSolveOptions {
  /**
   * Bend direction: `-1` or `+1`. Selects which side of the root-target line
   * the joint (elbow / knee) bends toward. Derive dynamically via
   * `calculateBendDir(root, target, pole)` from a pole vector, or hardcode.
   * Default `1`.
   */
  bendDir?: number;
}

/**
 * Options for the iterative solvers (`solveCCD`, `solveFABRIK`).
 */
export interface IterativeSolveOptions {
  /**
   * Fixed iteration count. The solver runs EXACTLY this many iterations —
   * never a convergence-epsilon loop (a determinism hazard). Defaults:
   * `IK_CCD_DEFAULT_ITERATIONS` for CCD, `IK_FABRIK_DEFAULT_ITERATIONS` for
   * FABRIK.
   */
  iterations?: number;
  /**
   * Per-bone angle limits (radians, `[min, max]`). Forward-declared; the
   * initial ship does not enforce these (position-only FABRIK, no-clamp CCD).
   * Provided on the surface for type stability when enforcement lands.
   */
  angleLimits?: Array<{ min: number; max: number }>;
}
