/**
 * Replay type definitions (Pillar 4 — Runnable Subsystem).
 *
 * A `Replay` is a deterministic, frozen record of everything required to
 * reproduce a run: the seeded RNG seed, the initial `PlatformerState`, the
 * consumer's per-tick `step` config, and the `PlatformerInput` stream. The
 * shape is fully serializable via `JSON.stringify` (no `Set`/`Map`/closures)
 * AND canonicalizable via `canonicalize()` from `src/level/serialize.ts`
 * for hash stability across orderings.
 *
 * **Renderer-output buffer exception** (per `docs/architecture.md`): the
 * `ReplayRecorder` returned by {@link createReplayRecorder} is the mutable
 * sibling of the pure `Replay`. It owns an internal `ReplayFrame[]` buffer
 * that `record()` appends to; `finish()` returns a fresh frozen `Replay`
 * and the recorder becomes idle. Mirrors the `EdgeAccumulator` precedent
 * exactly.
 *
 * @module
 */

import type { PlatformerInput, PlatformerState } from '../platformer/types';

/**
 * One tick worth of consumer input fed into the platformer kernel.
 *
 * Alias of `PlatformerInput` — re-exported from `replay/types.ts` so
 * consumers who take only the replay dependency don't need to reach into
 * the platformer module. Serializes identically to `PlatformerInput`
 * (`{ moveX, jump: PolledEdge, dash: PolledEdge | null }`).
 */
export type ReplayFrame = PlatformerInput;

/**
 * Configuration captured at `finish()` time. Carries the simulation tick
 * rate so replay can run at the same wall-clock-to-tick ratio the recording
 * session used.
 *
 * The shape is intentionally OPEN (`Record<string, unknown>` extension) so
 * consumers can add their own per-game config (e.g. level id, asset
 * checksum) into the canonical hash without a library update.
 */
export interface ReplayConfig {
  /** Simulation tick rate in Hz (e.g. 60). Default 60. */
  readonly tickRate: number;
  /**
   * Consumer extension surface — consumers can attach their own metadata
   * (level id, physics version, seed-replay-keys, etc.) and it lands in the
   * canonical hash. Library code MUST NOT set anything here.
   */
  readonly [key: string]: unknown;
}

/**
 * Frozen, replayable record. All fields `readonly`; `frames` is
 * `Object.freeze`-d by the recorder on `finish()`.
 *
 * To replay: `playReplay(replay, step, dt)` re-runs the consumer's `step`
 * from `initial` for `frames.length` ticks and returns the final state.
 * To verify: `replayHash(replay) === expectedHash`.
 *
 * Serializes to canonical JSON via `canonicalize` (sorted keys, no
 * insignificant whitespace, non-finite coerced to null).
 */
export interface Replay {
  /** Seed used by the recorded run's seeded RNG streams. */
  readonly seed: number;
  /** `PlatformerState` at tick 0 — the starting point for re-sim. */
  readonly initial: PlatformerState;
  /** Per-tick consumer input stream. Length === number of recorded ticks. */
  readonly frames: readonly ReplayFrame[];
  /** Configuration snapshot at `finish()` time (open-extension). */
  readonly config: ReplayConfig;
}

/**
 * The mutable sibling of {@link Replay}. Owned by the consumer; created via
 * {@link createReplayRecorder}. Mirrors the `EdgeAccumulator` lifecycle:
 *
 *   - `record(input)` between fixed-step polls (renderer-output buffer
 *     mutation — allowed by `docs/architecture.md` rule 5).
 *   - `finish(config)` at session end returns a frozen {@link Replay}; the
 *     recorder's internal buffer is disowned.
 *   - `discard()` aborts recording (no `Replay` returned).
 */
export interface ReplayRecorder {
  /**
   * Append a tick's input. Returns the recorder itself for fluent chaining:
   * `recorder.record(a).record(b).finish(cfg)`. Never throws; bad inputs
   * are silently dropped; `record()` after `finish()`/`discard()` is a
   * silent no-op (still returns the recorder).
   */
  record(input: ReplayFrame): ReplayRecorder;
  /**
   * Freeze the captured stream into a {@link Replay} and return it.
   * After `finish()` the recorder becomes idle; further `record()` calls
   * are silent no-ops.
   *
   * @param config - Per-tick + per-record config snapshot (see {@link ReplayConfig}).
   * @returns A NEW frozen `Replay` (do not mutate the returned object).
   */
  finish(config: ReplayConfig): Replay;
  /** Abort recording without returning a `Replay`. */
  discard(): void;
  /** How many ticks have been captured since `createReplayRecorder`. */
  readonly pending: number;
}
