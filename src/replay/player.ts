/**
 * Pure replay player (Pillar 4 — Runnable Subsystem).
 *
 * Drives a recorded {@link Replay} through a consumer-supplied `step`
 * callback for `frames.length` ticks and returns the final state.
 *
 * This is the **determinism verification primitive**. Paired with
 * `replayHash`, it lets consumers assert byte-identity between a recorded
 * run and a later-verified replay (e.g. a "share my best run" feature or a
 * CI smoke test that pins the engine's behavior to a known-good hash).
 *
 * **Pure:**
 *   - Same `(replay, step, dt)` → identical output, byte-for-byte.
 *   - `replay` is treated as immutable (it is post-`finish()`); the
 *     function never mutates the input.
 *   - The consumer's `step(idx, input, dt) → state` is invoked from this
 *     pure core, so `step` MUST itself be pure (a thrown or impure `step`
 *     would break the determinism contract; we swallow throws defensively
 *     to keep the loop alive).
 *
 * **Empty replay:** `frames.length === 0` → returns `replay.initial`
 * immediately without invoking `step`. The hash of an empty replay is
 * still well-defined (see `replayHash`).
 *
 * **Replay contract:** the consumer's `step` must run the same logic on
 * replay that ran to record the replay (typically a closure over the
 * `stepPlatformer` kernel + the level's compiled solids). This is a
 * standard deterministic-TAS convention; documented in the {@link Replay}
 * JSDoc.
 *
 * @module
 */

import type { Replay, ReplayFrame } from './types';
import type { PlatformerState } from '../platformer/types';

/**
 * Step function the consumer supplies for re-sim. Typically a closure
 * over `stepPlatformer(state, input, solids, dt)`. MUST be pure for the
 * replay contract to hold.
 */
export type ReplayStep = (
  state: PlatformerState,
  input: ReplayFrame,
  dt: number,
) => PlatformerState;

/**
 * Run a recorded {@link Replay} through `step` for `frames.length` ticks.
 *
 * If `dt < 0` or `dt` is not a finite number, the consumer treats that as a
 * config error — we clamp to `0` (a silent no-op for the loop but `step`
 * still gets called to keep the determinism contract uniform). The
 * recorder covers this same case at capture time (the recorder swallows
 * non-finite inputs upstream of `stepPlatformer`).
 *
 * If `step` throws, the loop short-circuits and the function returns the
 * last successfully-returned state (never throws). This is
 * belt-and-braces — `stepPlatformer` doesn't throw — but it preserves a
 * well-defined "highest reached state" rather than crashing the
 * verifier.
 *
 * If `replay` is null or non-object, returns a frozen empty-state default
 * (`{ core: zero-init, abilities: empty, events: zeroed, tick: 0 }`).
 *
 * @param replay - A frozen {@link Replay} from a `ReplayRecorder.finish()`.
 * @param step   - Pure consumer step (typically wrapping `stepPlatformer`).
 * @param dt     - Fixed simulation timestep in seconds. Clamped to `>= 0`.
 * @returns The final `PlatformerState` (a fresh object, owned by the caller).
 */
export function playReplay(
  replay: Replay | null | undefined,
  step: ReplayStep | null | undefined,
  dt: number,
): PlatformerState {
  // Defensive: malformed replay → well-defined default state.
  const initial = replayInitialState(replay);
  const safeStep =
    typeof step === 'function' ? step : (s: PlatformerState): PlatformerState => s;
  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;

  // Defensive: malformed replay → no frames; return initial directly.
  if (!replay || typeof replay !== 'object') return initial;
  const frames = Array.isArray(replay.frames) ? replay.frames : [];
  if (frames.length === 0) return initial;

  let state = initial;
  for (let i = 0; i < frames.length; i++) {
    try {
      state = safeStep(state, frames[i], safeDt);
    } catch {
      // Defensive clamp: stop advancing at the throw boundary, return the
      // highest state we reached. Better than corrupting the consumer's
      // "expected last state."
      break;
    }
  }
  return state;
}

/**
 * Extract the `initial` field of a replay, defending against null /
 * non-object / missing-`initial` shapes.
 */
function replayInitialState(replay: Replay | null | undefined): PlatformerState {
  if (
    replay !== null &&
    typeof replay === 'object' &&
    'initial' in replay &&
    replay.initial !== null &&
    typeof replay.initial === 'object'
  ) {
    return replay.initial;
  }
  // Well-defined fallback: an empty PlatformerState-shaped object (not a
  // valid replay state, but never throws and is stable).
  return FALLBACK_EMPTY_STATE;
}

/**
 * Stable empty state used when the replay is malformed. The platformer
 * runtime never reads this — it only matters for callers who replay an
 * obviously-bad replay blob.
 */
const FALLBACK_EMPTY_STATE: PlatformerState = Object.freeze({
  core: Object.freeze({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    vx: 0,
    vy: 0,
    facing: 1 as const,
    onGround: false,
    contacts: Object.freeze({
      groundId: null,
      leftWallId: null,
      rightWallId: null,
      ceilingId: null,
    }),
  }),
  abilities: Object.freeze({}),
  events: Object.freeze({
    justLanded: false,
    justLaunched: false,
    hitCeiling: false,
    hitWall: false,
    startedWallSlide: false,
    wallJumpLaunched: false,
    dashStarted: false,
    doubleJumped: false,
  }),
  tick: 0,
});
