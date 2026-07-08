/**
 * Foot-plant detection: pure progression op that detects the per-foot
 * zero-crossing edge of the locomotion lift signal.
 *
 * A foot "plants" when its lift transitions from airborne (`> 0`, mid-swing)
 * to grounded (`=== 0`, stance phase). Consumers use these edges to fire dust
 * puffs and footstep audio. This module detects the edge only — the speed
 * gate (minimum horizontal velocity) and any side effects stay consumer-side.
 *
 * Lift heights come from `evaluateLocomotion` (`pose.leftFootOffset.y` /
 * `pose.rightFootOffset.y`), which clamps via `Math.max(0, ...)` so the
 * signal is non-negative.
 *
 * Zero runtime dependencies. Pure + deterministic: same `(state, leftLift,
 * rightLift)` → same result, forever. Never throws.
 *
 * @see `docs/design/foot-plant-detection-proposal.md` for the design rationale.
 */

/**
 * Foot-plant state: previous-tick lift heights, one per foot.
 *
 * Threaded through `advanceFootPlant` each tick so the detector can observe
 * the `>0 → 0` descent edge. Owned by the consumer (e.g. the locomotion /
 * FX layer); advanced purely by `advanceFootPlant`.
 */
export interface FootPlantState {
  /** Previous-tick left-foot lift height (`pose.leftFootOffset.y`). */
  readonly prevLeftLift: number;
  /** Previous-tick right-foot lift height (`pose.rightFootOffset.y`). */
  readonly prevRightLift: number;
}

/**
 * Per-tick plant-edge flags. `true` on the tick a foot transitions from
 * airborne to planted.
 */
export interface FootPlantEvents {
  /**
   * `true` when the left foot transitioned from airborne (lift > 0) to
   * planted (lift === 0) this tick.
   */
  readonly leftPlanted: boolean;
  /**
   * `true` when the right foot transitioned from airborne (lift > 0) to
   * planted (lift === 0) this tick.
   */
  readonly rightPlanted: boolean;
}

/**
 * Return of `advanceFootPlant`: the next state plus the events detected on
 * the transition into it.
 */
export interface FootPlantResult {
  /** Next state (for the following tick). */
  readonly state: FootPlantState;
  /** Plant-edge events detected this tick. */
  readonly events: FootPlantEvents;
}

/**
 * Factory: fresh foot-plant state with both prev-lift values at `0`.
 *
 * Zero prev-lift means the first tick after construction (or after a reset)
 * never fires a spurious plant event — there is no `>0` history to descend
 * from. This mirrors the playground's initial `prevLeftFootY = 0` /
 * `prevRightFootY = 0` and is the correct default for "standing still".
 * Consumers should also re-invoke this when horizontal motion stops, to
 * clear any airborne history so a stationary foot does not re-fire.
 *
 * @returns a new `FootPlantState` with `prevLeftLift` and `prevRightLift`
 *   both set to `0`
 */
export function createFootPlantState(): FootPlantState {
  return { prevLeftLift: 0, prevRightLift: 0 };
}

/**
 * Detect foot-plant transitions and advance state by one tick.
 *
 * A foot "plants" when its lift transitions from `> 0` (airborne, mid-swing)
 * to exactly `0` (grounded, stance phase) — the zero-crossing edge of the
 * locomotion lift signal, i.e. the moment a visible step lands. The strict
 * `> 0` guard means a foot that was already planted (prev `0`) or any
 * non-positive history never fires: the edge fires only on a genuine
 * airborne-to-grounded descent.
 *
 * **Speed gate is CONSUMER-SIDE.** This function detects the edge only.
 * Different games gate on different minimum horizontal velocities (the
 * playground uses `1` px/tick; a hero character may use `0.5` or skip
 * gating entirely). Do NOT bake a threshold in here — apply it at the call
 * site:
 *
 * ```ts
 * if (result.events.leftPlanted && Math.abs(player.vx) > MIN_SPEED) { ... }
 * ```
 *
 * Pure: returns a brand-new `FootPlantResult`; the input `state` is never
 * mutated. Deterministic: same inputs always yield the same outputs. Fixed-
 * tick agnostic — this op carries no `dt` because it is purely a function of
 * the current and previous lift values (no integration). Never throws.
 *
 * @param state - current foot-plant state (previous-tick lift heights)
 * @param leftLift - current left-foot lift height (`pose.leftFootOffset.y`)
 * @param rightLift - current right-foot lift height (`pose.rightFootOffset.y`)
 * @returns plant-edge events + the next `FootPlantState` carrying the
 *   current lift values forward
 *
 * @example
 * ```ts
 * // After evaluateLocomotion:
 * const result = advanceFootPlant(plantState, pose.leftFootOffset.y, pose.rightFootOffset.y);
 * plantState = result.state;
 * if (result.events.leftPlanted && Math.abs(player.vx) > MIN_SPEED) {
 *   spawnDust(leftFootWorldX);
 *   audio.playTap();
 * }
 * ```
 */
export function advanceFootPlant(
  state: FootPlantState,
  leftLift: number,
  rightLift: number,
): FootPlantResult {
  return {
    state: { prevLeftLift: leftLift, prevRightLift: rightLift },
    events: {
      leftPlanted: state.prevLeftLift > 0 && leftLift === 0,
      rightPlanted: state.prevRightLift > 0 && rightLift === 0,
    },
  };
}
