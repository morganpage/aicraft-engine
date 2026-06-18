/**
 * Default iteration count for the CCD solver.
 *
 * 8 iterations provides good convergence for chains of 3-8 joints without
 * excessive CPU cost. Higher values improve accuracy for very long chains
 * but are rarely needed. This is a FIXED count — never a convergence epsilon
 * (which would be a cross-engine desync hazard).
 */
export const IK_CCD_DEFAULT_ITERATIONS = 8;

/**
 * Default iteration count for the FABRIK solver.
 *
 * 4 iterations is sufficient for most chains (FABRIK converges faster than
 * CCD; the research recommends 3-5). FIXED count only — never a convergence
 * epsilon.
 */
export const IK_FABRIK_DEFAULT_ITERATIONS = 4;

/**
 * Squared position tolerance for the diagnostic `IkResult.solved` flag.
 *
 * `0.01 ** 2 = 0.0001` — sub-pixel accuracy. Used ONLY to derive `solved`
 * after the fixed-iteration solve completes; it NEVER controls loop
 * termination. The `solved` flag itself is diagnostic-only and may vary
 * across JS engines due to float precision.
 */
export const IK_POSITION_TOLERANCE_SQ = 0.0001;

/**
 * Dead-zone floor for the perpendicular height `h` in the analytical
 * 2-bone limb solver.
 *
 * As the target approaches full extension (`dist` near `lengthA + lengthB`),
 * `h` collapses toward zero and the joint would jitter / pop onto the
 * root-target line. Clamping `h` to this floor keeps the joint slightly off
 * the line, producing a stable straight-but-not-degenerate pose. Units are
 * world-space units (typically pixels).
 */
export const IK_LIMB_DEAD_ZONE = 0.001;

/**
 * Squared length below which a bone vector is treated as collinear-degenerate
 * by `reconstructRotations`.
 *
 * When `|positions[i+1] - positions[i]| ** 2` is below this threshold the
 * bone has no meaningful direction; its local rotation is emitted as `0`
 * (inherits the parent's angle) instead of computing `atan2` of a near-zero
 * vector (which would yield an arbitrary angle). `1e-12` is well below any
 * practical bone length.
 */
export const IK_COLLINEAR_THRESHOLD_SQ = 1e-12;
