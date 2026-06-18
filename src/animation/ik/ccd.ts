import type { Vec2 } from '../types';
import { IK_CCD_DEFAULT_ITERATIONS, IK_POSITION_TOLERANCE_SQ } from './constants';
import { reconstructRotations } from './fabrik';
import type { IkResult, IterativeSolveOptions } from './types';

/**
 * Solve an N-joint chain using Cyclic Coordinate Descent (CCD).
 *
 * Iterates from the effector's parent down to the root. At each joint, rotates
 * that joint (and all descendants) so the effector moves toward the target.
 * Best for organic dragging chains (tails, tentacles, ropes) where angular
 * coiling is acceptable.
 *
 * **Determinism:** FIXED iteration count only (default
 * `IK_CCD_DEFAULT_ITERATIONS`); NEVER a convergence-epsilon loop.
 *
 * **Purity:** clones the input positions once at entry, mutates only that
 * local clone during iteration, and returns it inside the `IkResult`. The
 * input array (and its elements) are never mutated.
 *
 * Unreachable targets (`dist >= totalLength`) short-circuit to a straight
 * stretch toward the target — bit-identical to the converged iterative result
 * but without spending the iteration budget. `solved` is `false` in that
 * case.
 *
 * Per-joint rotation is skipped when the joint-to-effector or joint-to-target
 * vector has zero length (singularity guard); the solver never divides by
 * zero and never throws.
 *
 * @param positions - current joint positions `[root, ..., effector]`
 * @param boneLengths - segment lengths (`length === positions.length - 1`)
 * @param target - world-space target for the end effector
 * @param opts - `{ iterations }` (default `IK_CCD_DEFAULT_ITERATIONS`)
 * @returns solved positions, reconstructed rotations, diagnostic solved flag
 */
export function solveCCD(
  positions: readonly Vec2[],
  boneLengths: readonly number[],
  target: Vec2,
  opts?: IterativeSolveOptions,
): IkResult {
  const n = positions.length;
  const iterations = opts?.iterations ?? IK_CCD_DEFAULT_ITERATIONS;

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

  // Unreachable: stretch straight toward the target (matches converged CCD).
  if (distToTarget >= totalLength && distToTarget > 0) {
    const ux = dxAll / distToTarget;
    const uy = dyAll / distToTarget;
    for (let i = 0; i < n - 1; i++) {
      p[i + 1].x = p[i].x + ux * boneLengths[i];
      p[i + 1].y = p[i].y + uy * boneLengths[i];
    }
    return {
      positions: p,
      rotations: reconstructRotations(p),
      solved: false,
    };
  }

  // Reachable: fixed iteration count, joint-by-joint toward root.
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = n - 2; i >= 0; i--) {
      const joint = p[i];
      const effector = p[n - 1];

      const toEffectorX = effector.x - joint.x;
      const toEffectorY = effector.y - joint.y;
      const toTargetX = target.x - joint.x;
      const toTargetY = target.y - joint.y;

      // Singularity guard: skip when either vector is degenerate.
      const effSq = toEffectorX * toEffectorX + toEffectorY * toEffectorY;
      const tgtSq = toTargetX * toTargetX + toTargetY * toTargetY;
      if (effSq < IK_POSITION_TOLERANCE_SQ || tgtSq < IK_POSITION_TOLERANCE_SQ) {
        continue;
      }

      // Signed angle from effector-direction to target-direction.
      const cross = toEffectorX * toTargetY - toEffectorY * toTargetX;
      const dot = toEffectorX * toTargetX + toEffectorY * toTargetY;
      const theta = Math.atan2(cross, dot);
      if (theta === 0) continue;

      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      // Rotate descendants (i+1 .. n-1) around joint i by theta.
      for (let j = i + 1; j < n; j++) {
        const dx = p[j].x - joint.x;
        const dy = p[j].y - joint.y;
        p[j].x = joint.x + (dx * cosT - dy * sinT);
        p[j].y = joint.y + (dx * sinT + dy * cosT);
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
