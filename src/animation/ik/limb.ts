import type { Vec2 } from '../types';
import { IK_LIMB_DEAD_ZONE } from './constants';
import type { LimbSolveOptions } from './types';

/**
 * Result of the analytical 2-bone limb solver.
 */
export interface LimbResult {
  /** Solved joint (elbow / knee) world position. */
  jointPos: Vec2;
  /** Solved end-effector (hand / foot) world position. */
  endPos: Vec2;
  /**
   * Diagnostic flag. `true` for the standard reachable intersection and for
   * the graceful under-extended fold (when `dist > 0`). `false` when the
   * target is unreachable (fully extended) or coincident with the root
   * (`dist === 0` singularity). Diagnostic only — never branch gameplay on it.
   */
  solved: boolean;
}

/**
 * Determine the bend direction from a pole (bend-hint) vector via the 2D
 * cross-product sign.
 *
 * Computes `(target - root) x (pole - root)`. Returns `+1` when the pole lies
 * on the positive-rotation (`+X -> +Y`) side of the root-target line, `-1`
 * otherwise. A cross product of exactly `0` (pole on the line) tie-breaks to
 * `+1` deterministically.
 *
 * Pure: never mutates inputs. Never throws.
 *
 * @param root - chain root position
 * @param target - end-effector target position
 * @param pole - world-space position the joint should lean toward
 * @returns `+1` or `-1` (typed as `number` for ergonomic use in options bags)
 *
 * @example
 * ```ts
 * const bendDir = calculateBendDir(hip, footTarget, kneeHint);
 * const result = solveLimb(hip, footTarget, thighLen, shinLen, { bendDir });
 * ```
 */
export function calculateBendDir(root: Vec2, target: Vec2, pole: Vec2): number {
  const lineX = target.x - root.x;
  const lineY = target.y - root.y;
  const poleX = pole.x - root.x;
  const poleY = pole.y - root.y;
  const cross = lineX * poleY - lineY * poleX;
  return cross >= 0 ? 1 : -1;
}

/**
 * Solve a two-bone IK chain analytically (closed-form, O(1)) via the law of
 * cosines circle-circle intersection.
 *
 * Handles three cases defensively, never throwing:
 *   1. **Unreachable** (`dist >= lengthA + lengthB`): both bones extend
 *      straight toward the target; the effector is placed at full reach
 *      along the root-target direction (NOT at the target itself); `solved`
 *      is `false`.
 *   2. **Under-extended / singular** (`dist <= |lengthA - lengthB|`, which
 *      includes `dist === 0`): bones collapse along the bend-direction
 *      perpendicular to the root-target line. The effector is placed at the
 *      target; `solved` is `true` for any `dist > 0` (graceful fold) and
 *      `false` for the exact `dist === 0` singularity (per the decision doc:
 *      the flag is diagnostic-only; the under-extended fold is non-degenerate
 *      whenever the target is not exactly on the root).
 *   3. **Standard intersection** (law of cosines): `solved` is `true`.
 *
 * A dead-zone clamps the perpendicular height `h` to `IK_LIMB_DEAD_ZONE` in
 * the standard case so the joint does not collapse onto (and jitter along)
 * the root-target line as the target approaches full extension.
 *
 * Pure: returns a fresh `LimbResult`; never mutates `root` or `target`. Never
 * throws.
 *
 * @param root - world-space chain root (hip / shoulder)
 * @param target - world-space end-effector target
 * @param lengthA - first bone length (read from `template.boneLengths` when
 *   backed by a rig)
 * @param lengthB - second bone length
 * @param opts - `{ bendDir }` (default `+1`); typically from
 *   `calculateBendDir`
 * @returns `{ jointPos, endPos, solved }`
 *
 * @example
 * ```ts
 * // Canonical example: root=(0,0), target=(0,10), bones 6 and 8, bendDir +1
 * // -> jointPos = { x: -4.8, y: 3.6 }, endPos = { x: 0, y: 10 }.
 * const r = solveLimb({ x: 0, y: 0 }, { x: 0, y: 10 }, 6, 8, { bendDir: 1 });
 * ```
 */
export function solveLimb(
  root: Vec2,
  target: Vec2,
  lengthA: number,
  lengthB: number,
  opts?: LimbSolveOptions,
): LimbResult {
  const bendDir = opts?.bendDir ?? 1;

  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const dSq = dx * dx + dy * dy;
  const d = Math.sqrt(dSq);
  const maxReach = lengthA + lengthB;
  const minReach = Math.abs(lengthA - lengthB);

  // Unit direction root -> target; falls back to +X when d === 0.
  const ux = d > 0 ? dx / d : 1;
  const uy = d > 0 ? dy / d : 0;
  // Perpendicular (rotated +90 deg): (-uy, +ux), signed by bendDir.
  const vx = -uy * bendDir;
  const vy = ux * bendDir;

  // Case 1: unreachable (fully extended toward target).
  if (d >= maxReach) {
    return {
      jointPos: { x: root.x + ux * lengthA, y: root.y + uy * lengthA },
      endPos: { x: root.x + ux * maxReach, y: root.y + uy * maxReach },
      solved: false,
    };
  }

  // Case 2: under-extended or singular (target inside the |la-lb| disk).
  if (d <= minReach) {
    return {
      jointPos: { x: root.x + vx * lengthA, y: root.y + vy * lengthA },
      endPos: { x: target.x, y: target.y },
      // d === 0 is a true singularity; any d > 0 here is a graceful fold.
      solved: d > 0,
    };
  }

  // Case 3: standard law-of-cosines intersection.
  const a = (lengthA * lengthA - lengthB * lengthB + dSq) / (2 * d);
  // Dead-zone: clamp h off the floor so the joint does not jitter at full ext.
  const hRaw = Math.sqrt(Math.max(0, lengthA * lengthA - a * a));
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
