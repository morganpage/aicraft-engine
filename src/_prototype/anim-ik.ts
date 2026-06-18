/**
 * Inverse-kinematics prototype: analytical 2-bone limb solver + FABRIK.
 *
 * NOT the production IK module (that lives in `src/animation/ik/`). This file
 * validates the math, the bend-direction ergonomics, and FABRIK convergence
 * before the real TDD implementation.
 *
 * Determinism: fixed iteration counts only (no convergence-epsilon loop
 * termination). The public surface is pure — inputs are never mutated. FABRIK
 * clones its input once and mutates only that local clone during iteration.
 *
 * Rotation convention: radians from +X, positive +X -> +Y, via `atan2(dy, dx)`.
 */

import type { Vec2 } from './anim-rig-min';

/** Default FABRIK iteration count. Loop termination uses this, never epsilon. */
export const IK_FABRIK_DEFAULT_ITERATIONS = 4;

/** Position tolerance squared for the diagnostic `solved` flag only. */
export const IK_POSITION_TOLERANCE_SQ = 0.0001;

/** Dead-zone for the 2-bone limb solver at full extension (prevents jitter). */
export const IK_LIMB_DEAD_ZONE = 0.001;

/** Below this squared bone-vector length, rotations inherit the parent angle. */
export const IK_COLLINEAR_THRESHOLD_SQ = 1e-12;

/** Result of the 2-bone analytical solver. */
export interface LimbResult {
  /** Solved joint (elbow / knee) world position. */
  jointPos: Vec2;
  /** Solved end-effector (hand / foot) world position. */
  endPos: Vec2;
  /** Diagnostic only; true when the target is reachable and non-degenerate. */
  solved: boolean;
}

/** Result of FABRIK: solved positions + reconstructed local rotations. */
export interface FabrikResult {
  /** Solved joint positions `[root, ..., effector]`. */
  positions: Vec2[];
  /** Local rotation per bone (radians), relative to parent. */
  rotations: number[];
  /** Diagnostic only; true when the effector reached the target. */
  solved: boolean;
}

/**
 * Determine bend direction from a pole vector via the 2D cross product sign.
 *
 * Computes `(target - root) x (pole - root)`. Returns +1 when the pole lies on
 * the positive-rotation (+X -> +Y) side of the root-target line, -1 otherwise.
 * A `cross` of exactly 0 resolves to +1 (deterministic tie-break).
 *
 * @param root - chain root position
 * @param target - end-effector target position
 * @param pole - world-space position the joint should lean toward
 * @returns +1 or -1
 */
export function calculateBendDir(root: Vec2, target: Vec2, pole: Vec2): -1 | 1 {
  const lineX = target.x - root.x;
  const lineY = target.y - root.y;
  const poleX = pole.x - root.x;
  const poleY = pole.y - root.y;
  const cross = lineX * poleY - lineY * poleX;
  return cross >= 0 ? 1 : -1;
}

/**
 * Solve a two-bone IK chain analytically (closed-form, O(1)).
 *
 * Handles three cases defensively:
 *   1. Unreachable (`dist >= lenA + lenB`): both bones extend straight toward
 *      the target; `solved: false`.
 *   2. Under-extended / singular (`dist <= |lenA - lenB|`, includes `dist === 0`):
 *      bones collapse along the bend-direction perpendicular; `solved` is true
 *      except at the exact `dist === 0` singularity.
 *   3. Standard intersection (Law of Cosines); `solved: true`.
 *
 * A dead-zone clamps the perpendicular height `h` to `IK_LIMB_DEAD_ZONE` in the
 * standard case so the joint does not collapse onto the root-target line (and
 * jitter) as the target approaches full extension. Never throws.
 *
 * @param root - chain root (hip / shoulder)
 * @param target - end-effector target
 * @param lenA - first bone length
 * @param lenB - second bone length
 * @param bendDir - +1 or -1, typically from `calculateBendDir` (default +1)
 * @returns jointPos, endPos, and a diagnostic solved flag
 */
export function solveLimb(
  root: Vec2,
  target: Vec2,
  lenA: number,
  lenB: number,
  bendDir: -1 | 1 = 1,
): LimbResult {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const dSq = dx * dx + dy * dy;
  const d = Math.sqrt(dSq);
  const maxReach = lenA + lenB;
  const minReach = Math.abs(lenA - lenB);

  // Unit direction root -> target; falls back to +X when d === 0.
  const ux = d > 0 ? dx / d : 1;
  const uy = d > 0 ? dy / d : 0;
  // Perpendicular (rotated +90 deg): (-uy, +ux), signed by bendDir.
  const vx = -uy * bendDir;
  const vy = ux * bendDir;

  // Case 1: unreachable (fully extended toward target).
  if (d >= maxReach) {
    return {
      jointPos: { x: root.x + ux * lenA, y: root.y + uy * lenA },
      endPos: { x: root.x + ux * maxReach, y: root.y + uy * maxReach },
      solved: false,
    };
  }

  // Case 2: under-extended or singular (target inside the |lenA-lenB| disk).
  if (d <= minReach) {
    return {
      jointPos: { x: root.x + vx * lenA, y: root.y + vy * lenA },
      endPos: { x: target.x, y: target.y },
      // d === 0 is a true singularity; any d > 0 here is a graceful fold.
      solved: d > 0,
    };
  }

  // Case 3: standard Law of Cosines intersection.
  const a = (lenA * lenA - lenB * lenB + dSq) / (2 * d);
  // Dead-zone: clamp h off the floor so the joint does not jitter at full ext.
  const hRaw = Math.sqrt(Math.max(0, lenA * lenA - a * a));
  const h = Math.max(hRaw, IK_LIMB_DEAD_ZONE);

  return {
    jointPos: {
      x: root.x + a * ux + h * vx,
      y: root.y + a * uy + h * vy,
    },
    endPos: { x: target.x, y: target.y },
    solved: true,
  };
}

/**
 * Reconstruct per-bone local rotations from solved joint positions.
 *
 * For each bone `i`, computes `atan2(dy, dx)` of the bone vector
 * `(positions[i+1] - positions[i])` and subtracts the parent's absolute angle
 * to get a LOCAL rotation (relative to parent). The root bone's rotation is
 * absolute (parent angle starts at 0, i.e. facing +X). Collinear / zero-length
 * bones (`lenSq < IK_COLLINEAR_THRESHOLD_SQ`) inherit the parent's angle
 * (local rotation 0, parent angle unchanged).
 *
 * @param positions - joint positions `[root, ..., effector]`
 * @returns local rotation per bone (`length === positions.length - 1`)
 */
export function reconstructRotations(positions: readonly Vec2[]): number[] {
  const rotations: number[] = [];
  let parentAngle = 0;
  for (let i = 0; i < positions.length - 1; i++) {
    const dx = positions[i + 1].x - positions[i].x;
    const dy = positions[i + 1].y - positions[i].y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < IK_COLLINEAR_THRESHOLD_SQ) {
      rotations.push(0);
      continue;
    }
    const absAngle = Math.atan2(dy, dx);
    rotations.push(absAngle - parentAngle);
    parentAngle = absAngle;
  }
  return rotations;
}

/**
 * Solve an N-joint chain using FABRIK (Forward And Backward Reaching IK).
 *
 * Fixed iteration count only (default `IK_FABRIK_DEFAULT_ITERATIONS`); NEVER a
 * convergence-epsilon loop. Pure-public: clones the input once, mutates only
 * that local clone during iteration, returns it. The input array is never
 * mutated.
 *
 * If the target is unreachable (`dist >= totalLength`), the chain stretches
 * straight toward it and `solved` is false. Otherwise performs `iterations`
 * forward/backward sweeps; rotations are reconstructed in a post-pass via
 * `reconstructRotations`.
 *
 * @param positions - current joint positions `[root, ..., effector]`
 * @param boneLengths - segment lengths (`length === positions.length - 1`)
 * @param target - world-space target for the end effector
 * @param iterations - fixed sweep count (default `IK_FABRIK_DEFAULT_ITERATIONS`)
 * @returns solved positions, reconstructed rotations, diagnostic solved flag
 */
export function solveFABRIK(
  positions: readonly Vec2[],
  boneLengths: readonly number[],
  target: Vec2,
  iterations: number = IK_FABRIK_DEFAULT_ITERATIONS,
): FabrikResult {
  const n = positions.length;
  if (n < 2 || boneLengths.length < n - 1) {
    return {
      positions: positions.map((p) => ({ x: p.x, y: p.y })),
      rotations: [],
      solved: false,
    };
  }

  // Pure-public contract: single clone, mutated in place during iteration.
  const p: Vec2[] = positions.map((pt) => ({ x: pt.x, y: pt.y }));
  const rootAnchor: Vec2 = { x: p[0].x, y: p[0].y };

  let totalLength = 0;
  for (let i = 0; i < n - 1; i++) totalLength += boneLengths[i];

  const dxAll = target.x - rootAnchor.x;
  const dyAll = target.y - rootAnchor.y;
  const distToTarget = Math.sqrt(dxAll * dxAll + dyAll * dyAll);

  // Unreachable: stretch straight toward the target.
  if (distToTarget >= totalLength) {
    if (distToTarget > 0) {
      const ux = dxAll / distToTarget;
      const uy = dyAll / distToTarget;
      for (let i = 0; i < n - 1; i++) {
        p[i + 1].x = p[i].x + ux * boneLengths[i];
        p[i + 1].y = p[i].y + uy * boneLengths[i];
      }
    }
    return {
      positions: p,
      rotations: reconstructRotations(p),
      solved: false,
    };
  }

  // Reachable: fixed iteration count of forward/backward sweeps.
  for (let iter = 0; iter < iterations; iter++) {
    // Backward sweep: pin effector to target, pull each joint to its length.
    p[n - 1].x = target.x;
    p[n - 1].y = target.y;
    for (let i = n - 2; i >= 0; i--) {
      const dx = p[i].x - p[i + 1].x;
      const dy = p[i].y - p[i + 1].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const len = boneLengths[i];
      if (d > 0) {
        p[i].x = p[i + 1].x + (dx / d) * len;
        p[i].y = p[i + 1].y + (dy / d) * len;
      } else {
        p[i].x = p[i + 1].x + len;
        p[i].y = p[i + 1].y;
      }
    }
    // Forward sweep: pin root to anchor, push each joint to its length.
    p[0].x = rootAnchor.x;
    p[0].y = rootAnchor.y;
    for (let i = 0; i < n - 1; i++) {
      const dx = p[i + 1].x - p[i].x;
      const dy = p[i + 1].y - p[i].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const len = boneLengths[i];
      if (d > 0) {
        p[i + 1].x = p[i].x + (dx / d) * len;
        p[i + 1].y = p[i].y + (dy / d) * len;
      } else {
        p[i + 1].x = p[i].x + len;
        p[i + 1].y = p[i].y;
      }
    }
  }

  const ex = p[n - 1].x - target.x;
  const ey = p[n - 1].y - target.y;
  return {
    positions: p,
    rotations: reconstructRotations(p),
    solved: ex * ex + ey * ey < IK_POSITION_TOLERANCE_SQ,
  };
}
