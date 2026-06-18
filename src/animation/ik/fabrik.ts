import type { Vec2 } from '../types';
import {
  IK_COLLINEAR_THRESHOLD_SQ,
  IK_FABRIK_DEFAULT_ITERATIONS,
  IK_POSITION_TOLERANCE_SQ,
} from './constants';
import type { IkResult, IterativeSolveOptions } from './types';

/**
 * Reconstruct per-bone local rotations from solved world-space joint
 * positions.
 *
 * For each bone `i`, computes `atan2(dy, dx)` of the bone vector
 * `(positions[i+1] - positions[i])` and subtracts the running parent absolute
 * angle to produce a LOCAL rotation (relative to parent). The root bone's
 * rotation is absolute (parent angle starts at `0`, i.e. facing world `+X`).
 *
 * **Pillar rotation convention:** angles measured from `+X`, positive
 * `+X -> +Y` (appears clockwise on-screen; matches `ctx.rotate()`).
 *
 * Collinear / zero-length bones (`lenSq < IK_COLLINEAR_THRESHOLD_SQ`) emit a
 * local rotation of `0` and leave the parent angle unchanged (the degenerate
 * bone inherits its parent's facing).
 *
 * Pure: never mutates the input array. Never throws.
 *
 * @param positions - joint positions `[root, ..., effector]`
 * @returns local rotation per bone (`length === positions.length - 1`)
 *
 * @example
 * ```ts
 * // L-shape {0,0} -> {1,0} -> {1,1}: bone 0 faces +X (local 0),
 * // bone 1 faces +Y (local +PI/2).
 * reconstructRotations([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
 * // => [0, Math.PI / 2]
 * ```
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
 * Position-based solver: each iteration performs a backward sweep (pin the
 * effector to the target, pull each joint back to its bone length) then a
 * forward sweep (re-anchor the root, push each joint out to its bone length).
 * Rotations are reconstructed in a post-pass via `reconstructRotations`
 * (shared with `solveCCD`).
 *
 * Best for multi-joint chains where positional accuracy matters more than
 * angular control (arachnid legs, spines, complex arms).
 *
 * **Determinism:** FIXED iteration count only (default
 * `IK_FABRIK_DEFAULT_ITERATIONS`); NEVER a convergence-epsilon loop.
 *
 * **Purity:** clones the input positions once at entry, mutates only that
 * local clone during iteration, and returns it inside the `IkResult`. The
 * input array (and its elements) are never mutated.
 *
 * If the target is unreachable (`dist >= totalLength`), the chain stretches
 * straight toward it and `solved` is `false`.
 *
 * Never throws. Degenerate chains (`length < 2` or mismatched bone lengths)
 * return a defensive clone with empty rotations and `solved: false`.
 *
 * @param positions - current joint positions `[root, ..., effector]`
 * @param boneLengths - segment lengths (`length === positions.length - 1`)
 * @param target - world-space target for the end effector
 * @param opts - `{ iterations }` (default `IK_FABRIK_DEFAULT_ITERATIONS`)
 * @returns solved positions, reconstructed rotations, diagnostic solved flag
 */
export function solveFABRIK(
  positions: readonly Vec2[],
  boneLengths: readonly number[],
  target: Vec2,
  opts?: IterativeSolveOptions,
): IkResult {
  const n = positions.length;
  const iterations = opts?.iterations ?? IK_FABRIK_DEFAULT_ITERATIONS;

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
    // Backward sweep: pin effector to target, pull each joint back to length.
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
    // Forward sweep: re-anchor root, push each joint out to length.
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
