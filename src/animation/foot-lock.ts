import type { Vec2 } from './types';
import { FOOT_LOCK_DEFAULT_BLEND_SPEED } from './constants';

/**
 * Foot-lock state: tracks whether a foot is pinned to the ground and the
 * blend weight for smooth lock/unlock transitions.
 *
 * Owned by the locomotion layer; advanced each tick via `advanceFootLock`
 * (pure — returns a new state) and read via `getFootLockTarget` to derive
 * the effective IK target.
 */
export interface FootLockState {
  /** `true` while the foot is grounded and the lock is being held. */
  isLocked: boolean;
  /** World-space position the foot is locked to. Captured on the first grounded tick after an unlock. */
  lockPos: Vec2;
  /** Blend weight in `[0, 1]`: `0` = fully animated, `1` = fully locked. */
  blendWeight: number;
}

/**
 * Advance foot-lock state by one tick.
 *
 * - When **grounded**: if not yet locked, captures `lockPos` from the current
 *   animated foot position; then ramps `blendWeight` toward `1` at
 *   `blendSpeed` per second (clamped to `1`).
 * - When **airborne**: clears `isLocked` and ramps `blendWeight` toward `0`
 *   (clamped to `0`). `lockPos` is retained so a quick re-grounding resumes
 *   smoothly.
 *
 * Pure: returns a brand-new `FootLockState`; the input is never mutated.
 * Never throws.
 *
 * **Determinism note:** pass a FIXED `dt` (e.g. `1/60`) for cross-platform
 * determinism. Variable `dt` is tolerated because foot-lock output feeds the
 * renderer / IK target (not the simulation), but fixed `dt` is recommended.
 *
 * @param state - current foot-lock state
 * @param isGrounded - whether the foot is touching the ground this tick
 * @param animatedFootPosWorld - the foot position from the animation cycle (world space)
 * @param dt - timestep in seconds (fixed recommended)
 * @param blendSpeed - blend-weight change per second; defaults to
 *   `FOOT_LOCK_DEFAULT_BLEND_SPEED` (`10`)
 * @returns the next `FootLockState`
 *
 * @example
 * ```ts
 * footLock = advanceFootLock(footLock, isGrounded, worldFootPos, 1 / 60);
 * const ikTarget = getFootLockTarget(footLock, worldFootPos);
 * const leg = solveLimb(hip, ikTarget, thighLen, shinLen, { bendDir });
 * ```
 */
export function advanceFootLock(
  state: FootLockState,
  isGrounded: boolean,
  animatedFootPosWorld: Vec2,
  dt: number,
  blendSpeed: number = FOOT_LOCK_DEFAULT_BLEND_SPEED,
): FootLockState {
  const delta = blendSpeed * dt;

  if (isGrounded) {
    if (state.isLocked) {
      return {
        isLocked: true,
        lockPos: state.lockPos,
        blendWeight: Math.min(1, state.blendWeight + delta),
      };
    }
    // First grounded tick after an unlock: capture the lock position.
    return {
      isLocked: true,
      lockPos: { x: animatedFootPosWorld.x, y: animatedFootPosWorld.y },
      blendWeight: Math.min(1, state.blendWeight + delta),
    };
  }

  return {
    isLocked: false,
    lockPos: state.lockPos,
    blendWeight: Math.max(0, state.blendWeight - delta),
  };
}

/**
 * Compute the effective IK target by blending between the animated foot
 * position and the locked position.
 *
 * `blendWeight` of `0` returns the animated position; `1` returns `lockPos`;
 * `0.5` returns the midpoint. Deterministic linear interpolation.
 *
 * Pure: returns a fresh `Vec2`; never mutates the input state or animated
 * position. Never throws.
 *
 * @param state - current foot-lock state
 * @param animatedFootPosWorld - foot position from the animation cycle
 * @returns blended world-space target for the IK solver
 */
export function getFootLockTarget(
  state: FootLockState,
  animatedFootPosWorld: Vec2,
): Vec2 {
  const w = state.blendWeight;
  return {
    x: (1 - w) * animatedFootPosWorld.x + w * state.lockPos.x,
    y: (1 - w) * animatedFootPosWorld.y + w * state.lockPos.y,
  };
}
