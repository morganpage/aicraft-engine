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
import { CURRENT_PHYSICS_VERSION } from './constants';

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
 * Thrown when a replay's `config.physicsVersion` does not equal
 * {@link CURRENT_PHYSICS_VERSION}. The replay was recorded against different
 * physics math (e.g. pre-Phase-0 authority-collapse); re-simulating it under
 * the current engine would NOT reproduce the recorded trajectory, so we
 * reject loudly instead of silently producing a wrong result.
 *
 * Thrown BEFORE any state mutation / ticking — `playReplay` calls
 * {@link assertPhysicsVersion} as its first action.
 */
export class PhysicsVersionMismatchError extends Error {
  readonly expected: number;
  readonly actual: number;

  constructor(expected: number, actual: number) {
    super(
      `Replay physicsVersion mismatch: replay was recorded against physics version ${actual}, ` +
        `but the engine is version ${expected}. Refusing to replay — trajectories would differ.`,
    );
    this.name = 'PhysicsVersionMismatchError';
    this.expected = expected;
    this.actual = actual;
    // Restore the prototype chain across the ES5 transpilation boundary so
    // `instanceof PhysicsVersionMismatchError` works at runtime.
    Object.setPrototypeOf(this, PhysicsVersionMismatchError.prototype);
  }
}

/**
 * Validate that a replay's `physicsVersion` matches the engine's
 * {@link CURRENT_PHYSICS_VERSION}.
 *
 * - Match → silent no-op.
 * - Mismatch (including an absent / non-number `physicsVersion`, treated as
 *   version `0` = pre-collapse) → throws {@link PhysicsVersionMismatchError}.
 * - Malformed replay (null / non-object / no `config`) → silent no-op; the
 *   player's existing defensive path handles those shapes separately (it
 *   returns a fallback state without throwing). This preserves the
 *   "playReplay never throws on null" contract — version rejection only
 *   applies to real replay objects that carry a `config`.
 *
 * Pure + deterministic (no host access). Exposed publicly so callers can
 * validate a replay (e.g. one deserialized from a share-code) before handing
 * it to `playReplay`.
 */
export function assertPhysicsVersion(replay: Replay | null | undefined): void {
  if (replay === null || typeof replay !== 'object') return;
  if (!('config' in replay)) return;
  const config = (replay as { config?: unknown }).config;
  if (config === null || typeof config !== 'object') return;
  const raw = (config as { physicsVersion?: unknown }).physicsVersion;
  // Absent / non-number physicsVersion ⇒ pre-collapse (version 0) ⇒ rejected.
  const actual = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  if (actual !== CURRENT_PHYSICS_VERSION) {
    throw new PhysicsVersionMismatchError(CURRENT_PHYSICS_VERSION, actual);
  }
}

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
 * **Physics-version guard:** as the VERY FIRST action, the player calls
 * {@link assertPhysicsVersion}. A replay whose `config.physicsVersion` differs
 * from {@link CURRENT_PHYSICS_VERSION} (or is absent, treated as version `0`)
 * throws {@link PhysicsVersionMismatchError} BEFORE any state is read or any
 * tick is stepped. This rejects replays recorded under different physics math
 * rather than silently producing a wrong trajectory. Null / non-object replays
 * skip the guard (they have no `config`) and fall through to the defensive
 * fallback below.
 *
 * @param replay - A frozen {@link Replay} from a `ReplayRecorder.finish()`.
 * @param step   - Pure consumer step (typically wrapping `stepPlatformer`).
 * @param dt     - Fixed simulation timestep in seconds. Clamped to `>= 0`.
 * @returns The final `PlatformerState` (a fresh object, owned by the caller).
 * @throws {PhysicsVersionMismatchError} if `replay.config.physicsVersion` is
 *   present and does not equal {@link CURRENT_PHYSICS_VERSION}.
 */
export function playReplay(
  replay: Replay | null | undefined,
  step: ReplayStep | null | undefined,
  dt: number,
): PlatformerState {
  // Physics-version guard — FIRST action, before any state read or tick. A
  // mismatched replay would re-simulate under different math; reject loudly.
  // No-op for null/non-object replays (no config to check) and for matches.
  assertPhysicsVersion(replay);

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
  // Phase 0c: locomotion slice is now part of PlatformerState. The fallback
  // state is never stepped by the platformer runtime, so an empty locomotion
  // slice (all timers zero) is correct and stable.
  locomotion: Object.freeze({
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    varJumpTimer: 0,
    varJumpSpeed: 0,
    forceMoveXTimer: 0,
    forceMoveX: 0,
    maxFallCurrent: 0,
    // Phase 5 — ducking / last-dash-direction / super-jump grace / dashing.
    ducking: false,
    lastDashDirX: 0,
    lastDashDirY: 0,
    superJumpGraceTimer: 0,
    dashing: false,
    // Phase 6 — wall-grab stamina pool (unused by the fallback; never stepped).
    stamina: 0,
    // Phase 7 — wall-speed retention (unused by the fallback; never stepped).
    retainedVx: 0,
    wallSpeedRetentionTimer: 0,
    wallSpeedRetaining: false,
  }),
  events: Object.freeze({
    justLanded: false,
    justLaunched: false,
    hitCeiling: false,
    hitWall: false,
    startedWallSlide: false,
    wallJumpLaunched: false,
    dashStarting: false,
    dashStarted: false,
    doubleJumped: false,
  }),
  // Phase 8 — no surface interactions on the fallback state.
  interactions: Object.freeze([]),
  tick: 0,
});
