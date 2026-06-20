/**
 * Hit-stop (freeze-frame) game-feel helper.
 *
 * Hit-stop is the #1 temporal-juice technique for impacts: when a hit,
 * landing, or attack connects, the simulation clock freezes for a few ticks
 * while visual effects (particles, screen shake, flash) keep advancing. This
 * separates the moment of impact from the resume of motion, creating weight.
 *
 * The library already ships **spatial** juice (squash/stretch on landing via
 * `animation/jump.ts` + `animation/squash-stretch.ts`); this module supplies
 * the **temporal** counterpart.
 *
 * All functions are pure and deterministic: no `Math.random`, no `Date.now()`,
 * no global state. Inputs are never mutated; a fresh `HitStopState` is returned
 * on every transition. The simulation clock is advanced by the consumer via the
 * fixed `dt` it passes to `stepHitStop`.
 *
 * @example
 * ```ts
 * // On impact (landing, hit, etc.):
 * hitStop = triggerHitStop(hitStop, 6);  // 6-tick freeze
 *
 * // In the game loop:
 * if (!isHitStopActive(hitStop)) {
 *   world = stepWorld(world, dt);        // sim frozen during hit-stop
 * }
 * particles = step(particles, dt);       // FX continue during freeze
 * screenShake = stepShake(screenShake);  // shake continues during freeze
 * hitStop = stepHitStop(hitStop, dt);    // decrement the freeze timer
 * ```
 */

/** Hit-stop state. Tracks whether the sim should freeze and for how long. */
export interface HitStopState {
  /** Remaining ticks of freeze. 0 = inactive (sim runs normally). */
  remaining: number;
}

/**
 * Default freeze duration in ticks. ~6 ticks at 60fps ≈ 100ms — the
 * canonical "light hit" freeze. Heavier impacts (boss hits, big landings)
 * can pass a longer duration to `triggerHitStop`. Sourced from game-feel
 * best practices (Jan Willem Nijman "The Art of Screenshake", Vlambeer
 * "Juice It or Lose It").
 */
export const DEFAULT_HIT_STOP_DURATION = 6;

/**
 * Create a fresh hit-stop state (inactive — no freeze).
 *
 * @returns a new `HitStopState` with `remaining: 0`
 */
export function createHitStop(): HitStopState {
  return { remaining: 0 };
}

/**
 * Trigger a hit-stop freeze. Returns a NEW state with the specified duration.
 *
 * If a freeze is already active, the longer duration wins (the max of the
 * current `remaining` and the new `duration`) — so a rapid combo landing
 * during a heavy boss-hit freeze never cuts that freeze short.
 *
 * Pure: returns a new `HitStopState`, never mutates the input.
 *
 * @param state    - current hit-stop state
 * @param duration - freeze duration in ticks (defaults to
 *                   {@link DEFAULT_HIT_STOP_DURATION}); `0` is a no-op
 * @returns a new `HitStopState` whose `remaining` is `max(state.remaining, duration)`
 */
export function triggerHitStop(
  state: HitStopState,
  duration: number = DEFAULT_HIT_STOP_DURATION,
): HitStopState {
  const next = duration > state.remaining ? duration : state.remaining;
  return { remaining: next };
}

/**
 * Advance the hit-stop state by `dt` ticks. Decrements `remaining`. When it
 * reaches 0, the freeze ends. `remaining` is clamped at 0 — it never goes
 * negative, regardless of how large `dt` is.
 *
 * Pure: returns a new `HitStopState`.
 *
 * @param state - current hit-stop state
 * @param dt    - tick delta to advance by (typically 1; pass the sim's fixed dt)
 * @returns a new `HitStopState` with `remaining: max(0, state.remaining - dt)`
 */
export function stepHitStop(state: HitStopState, dt: number): HitStopState {
  const next = state.remaining - dt;
  return { remaining: next < 0 ? 0 : next };
}

/**
 * Check whether the simulation should freeze this tick. When `true`, the
 * consumer skips (or heavily slows) world advancement — but still renders and
 * advances visual effects (particles, screen shake, flash) so the freeze
 * reads as weight rather than a dropped frame.
 *
 * @param state - current hit-stop state
 * @returns `true` if `remaining > 0` (the sim should freeze)
 */
export function isHitStopActive(state: HitStopState): boolean {
  return state.remaining > 0;
}
