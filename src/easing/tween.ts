/**
 * Stateless, fixed-step tween driver.
 *
 * Mirrors the pure-progression-ops pattern established by `advanceEmission` /
 * `advanceJump`: the consumer owns a {@link TweenState} and calls
 * {@link advanceTween} each fixed step with `dt` drawn from the fixed-step
 * accumulator (`src/game-loop/fixed-step.ts`). The function is pure — same
 * `(state, dt, config)` always yields byte-identical output — and never throws.
 *
 * Loop / yoyo convention (binding for v1):
 *   - `loops: N` plays the tween `N + 1` times total (one initial pass plus `N`
 *     repeats). `loops: 0` = single play. `loops: -1` = infinite.
 *   - `yoyo: true` makes each iteration a forward + backward leg pair; `done`
 *     fires only after the final backward leg, never at a forward-leg boundary.
 *     Consumers detect intermediate forward-leg completion via
 *     {@link TweenState.direction} flipping `1 → -1`.
 *
 * The `delay` and `loops` fields are seeded from {@link TweenConfig} EXACTLY
 * ONCE by {@link createTweenState}; {@link advanceTween} never re-reads them
 * from config (it counts down `state.delay` and `state.loopCount` instead).
 * This keeps the driver pure and replay-deterministic.
 *
 * @module
 */

/**
 * Persistent tween state. Consumer-owned; passed to {@link advanceTween} each
 * tick. Initialise via {@link createTweenState} so `delay` and `loopCount` are
 * seeded from config exactly once.
 */
export interface TweenState {
  /** Accumulated seconds within the current leg (forward or backward). */
  elapsed: number;
  /** Current leg direction: `1` = forward, `-1` = backward (yoyo). */
  direction: 1 | -1;
  /**
   * Iterations remaining INCLUDING the current one.
   * `0` = lifecycle complete, `-1` = infinite. Seeded once from
   * {@link TweenConfig.loops} by {@link createTweenState} as
   * `max(1, loops + 1)` (or `-1`).
   */
  loopCount: number;
  /** Delay countdown in seconds. Decremented each advance until `0`; never re-seeded. */
  delay: number;
}

/**
 * Immutable tween configuration. The consumer stores one of these alongside
 * their {@link TweenState}. Only `duration`, `ease`, and `yoyo` are read by
 * {@link advanceTween}; `loops` and `delay` are read ONLY by
 * {@link createTweenState}.
 */
export interface TweenConfig {
  /** Duration of one forward (or backward) leg, in seconds. Must be `> 0` for the tween to advance. */
  duration: number;
  /** Easing curve applied to normalized leg progress `t ∈ [0, 1]`. */
  ease: (t: number) => number;
  /** Reverse direction on each leg, making each iteration a forward + backward pair. Default `false`. */
  yoyo?: boolean;
  /** Number of repeat iterations BEYOND the initial pass. `0` = single play, `-1` = infinite. Default `0`. */
  loops?: number;
  /** Seconds to wait before the first leg begins. Default `0`. */
  delay?: number;
}

/** Subset of {@link TweenConfig} that {@link createTweenState} reads. */
export type TweenSeedConfig = Pick<TweenConfig, 'loops' | 'delay'>;

/** Result of advancing a tween by one tick. */
export interface TweenResult {
  /** Brand-new tween state (input never mutated). */
  state: TweenState;
  /** Current eased value. `0` at the start, `1` at the forward endpoint, `0` again at the end of a yoyo backward leg. */
  value: number;
  /** `true` once every iteration (and the final yoyo backward leg, if any) has completed. */
  done: boolean;
}

/** Canonical terminal state returned once the lifecycle is complete. */
const TERMINAL_STATE: TweenState = {
  elapsed: 0,
  direction: 1,
  loopCount: 0,
  delay: 0,
};

/**
 * Create fresh tween state. `delay` and `loopCount` are seeded from the
 * optional config EXACTLY ONCE; {@link advanceTween} only counts them down
 * thereafter.
 *
 * @param config - optional `{ loops?, delay? }`; omit for a single-play,
 *                 no-delay tween (`loops: 0`, `delay: 0`)
 * @returns a fresh {@link TweenState} ready to advance
 *
 * @example
 * ```ts
 * const state = createTweenState({ loops: 2, delay: 0.25 });
 * const config: TweenConfig = { duration: 0.4, ease: easeOutCubic, loops: 2, delay: 0.25 };
 * ```
 */
export function createTweenState(config?: TweenSeedConfig): TweenState {
  const loops = config?.loops ?? 0;
  const delay = config?.delay ?? 0;
  const loopCount = loops === -1 ? -1 : Math.max(1, loops + 1);
  return {
    elapsed: 0,
    direction: 1,
    loopCount,
    delay: delay > 0 && Number.isFinite(delay) ? delay : 0,
  };
}

/**
 * Advance a tween by `dt` seconds. Pure: returns a new {@link TweenState} and
 * the current eased value; never mutates the input; never throws.
 *
 * Call this inside the `step(fixedDt)` callback of the fixed-step loop for
 * replay-deterministic animation. `dt` MUST come from the fixed-step
 * accumulator — never from `performance.now()` or a variable frame delta.
 *
 * Degenerate-input handling (all silent, never throwing):
 *   - `duration <= 0` or non-finite → snaps to `{ value: 1, done: true }` on
 *     the first advance (no division by zero).
 *   - `dt < 0` or non-finite → clamped to `0`; the value is frozen and the
 *     state is returned unchanged.
 *   - already-complete state → stays complete (`done: true`, endpoint value).
 *
 * @param state  - current tween state (not mutated)
 * @param dt     - fixed timestep in seconds (from `advanceAccumulator`)
 * @param config - tween configuration (`duration`, `ease`, `yoyo` are read here;
 *                 `loops`/`delay` were consumed by `createTweenState`)
 * @returns `{ state, value, done }`
 *
 * @example
 * ```ts
 * let tween = createTweenState();
 * const config: TweenConfig = { duration: 0.3, ease: easeOutCubic };
 * // inside step(fixedDt):
 * const result = advanceTween(tween, fixedDt, config);
 * tween = result.state;
 * const alpha = lerp(1.0, 0.0, result.value);
 * if (result.done) { /* tween finished *\/ }
 * ```
 */
export function advanceTween(
  state: TweenState,
  dt: number,
  config: TweenConfig,
): TweenResult {
  const yoyo = config.yoyo === true;

  // dt guard: negative or non-finite dt is a silent no-op (never throw).
  const stepDt = Number.isFinite(dt) && dt > 0 ? dt : 0;

  // duration guard: non-positive or non-finite duration snaps to done. Avoids
  // division by zero and undefined progress.
  if (!(config.duration > 0) || !Number.isFinite(config.duration)) {
    return { state: { ...TERMINAL_STATE }, value: 1, done: true };
  }

  // Already complete? (loopCount exhausted, and not the infinite sentinel.)
  if (state.loopCount === 0) {
    return { state: { ...TERMINAL_STATE }, value: yoyo ? 0 : 1, done: true };
  }

  const dur = config.duration;
  const isInfinite = state.loopCount === -1;

  let elapsed = state.elapsed;
  let direction: 1 | -1 = state.direction;
  let loopCount = state.loopCount;
  let delay = state.delay;
  let done = false;

  // Consume delay exactly once: subtract from the countdown, carry any
  // leftover dt into elapsed. Once delay hits 0 it stays 0 (never re-seeded).
  let remainingDt = stepDt;
  if (delay > 0 && remainingDt > 0) {
    if (remainingDt >= delay) {
      remainingDt -= delay;
      delay = 0;
    } else {
      delay -= remainingDt;
      remainingDt = 0;
    }
  }

  elapsed += remainingDt;

  // Process any whole-leg completions that fit in this step. The loop is
  // guaranteed to terminate: dur > 0 and elapsed is finite, so each iteration
  // subtracts a positive amount until elapsed < dur (or done fires).
  while (elapsed >= dur) {
    const completedDir = direction;
    const legWasLastInIteration = !yoyo || completedDir === -1;
    if (legWasLastInIteration) {
      if (isInfinite) {
        // Infinite: restart the next iteration, direction forward.
        if (yoyo) direction = 1;
      } else if (loopCount <= 1) {
        // This was the final iteration — lifecycle complete.
        done = true;
        break;
      } else {
        loopCount -= 1;
        if (yoyo) direction = 1;
      }
    } else {
      // Yoyo forward leg just finished — flip to backward.
      direction = -1;
    }
    elapsed -= dur;
  }

  if (done) {
    return {
      state: { ...TERMINAL_STATE },
      value: yoyo ? 0 : 1,
      done: true,
    };
  }

  const rawT = elapsed / dur;
  const tf = rawT > 1 ? 1 : rawT < 0 ? 0 : rawT;
  const value = config.ease(direction === 1 ? tf : 1 - tf);

  return {
    state: { elapsed, direction, loopCount, delay },
    value,
    done: false,
  };
}
