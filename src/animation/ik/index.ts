/**
 * Inverse-kinematics sub-module: analytical 2-bone limb, CCD, and FABRIK
 * solvers. Three pure functions mirroring the `particles/` advance/cull/step
 * pattern — pick the solver that fits the chain shape.
 *
 * Determinism: all iterative solvers use FIXED iteration counts (never a
 * convergence epsilon). The `solved` flag is diagnostic-only.
 *
 * Rotation convention: radians from `+X`, positive `+X -> +Y` via
 * `atan2(dy, dx)` — matches `ctx.rotate()`.
 */
export * from './types';
export * from './constants';
export * from './limb';
export * from './ccd';
export * from './fabrik';
