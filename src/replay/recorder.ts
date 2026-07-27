/**
 * Replay recorder (Pillar 4 — Runnable Subsystem).
 *
 * The mutable sibling of `Replay`. Lives in the **renderer-output buffer
 * exception** layer (per `docs/architecture.md`) — between fixed-step
 * polls, the recorder accumulates `input`s into a private `ReplayFrame[]`
 * buffer. At `finish()` time it freezes the buffer into an immutable
 * `Replay`. Mirrors the `EdgeAccumulator` lifecycle exactly.
 *
 * Closure-scoped state (no module-level globals), matching the
 * `KeyboardAdapter` and `GamepadAdapter` discipline even though this is a
 * data-only recorder (no host-touching code).
 *
 * **Never throws.** Bad inputs are silently dropped (`record(undefined)`
 * is a no-op). `finish()` against an empty buffer returns a valid
 * `Replay` with zero frames; `discard()` releases the buffer without
 * producing a `Replay`.
 *
 * `record()` returns the {@link ReplayRecorder} itself for fluent chaining:
 *
 *   recorder.record(a).record(b).finish(cfg)
 *
 * The double function-arrow pattern is used so `record` can reference
 * `recorder` in its return position (TS handles the late-bound `const`).
 *
 * @module
 */

import type { Replay, ReplayConfig, ReplayFrame, ReplayRecorder } from './types';
import type { PlatformerState } from '../platformer/types';

/**
 * Defensive clamp + fallback for the seed. Mirrors the
 * "invalid input → sensible no-op" discipline.
 */
function normalizeSeed(seed: unknown): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed;
  // Fallback so the seed never breaks the hash. A consumer-supplied non-finite
  // seed still produces a deterministic (non-random) replay — fine for
  // navigation tests; not advisable for actual capture.
  return 0;
}

/**
 * Create a `ReplayRecorder` bound to a seed + initial state.
 *
 * Captures inputs via `record(input)` between fixed-step polls. At
 * `finish(config)` time, freezes the stream into an immutable `Replay`.
 *
 * Example (consumer-side, in the loop):
 *
 * ```ts
 * const recorder = createReplayRecorder(rngSeed, world.tick0);
 * const replay = recorder
 *   .record(currentInput)
 *   .record(nextInput)
 *   .finish({ tickRate: 60 });
 * // Later, in a verifier:
 * const final = playReplay(replay, (s, i, dt) => stepPlatformer(s, i, solids, dt).state, 1 / 60);
 * assert(replayHash(replay) === expectedHash);
 * ```
 *
 * @param seed      - Seed for the recorded session's RNG streams.
 * @param initial   - `PlatformerState` at tick 0.
 * @returns a defensive {@link ReplayRecorder} (never throws).
 */
export function createReplayRecorder(
  seed: number,
  initial: PlatformerState,
): ReplayRecorder {
  const frames: ReplayFrame[] = [];
  const settledSeed = normalizeSeed(seed);
  let finished = false;
  let discarded = false;

  // The mutable recorder object — late-bound `const` so methods that return
  // it (for fluent chaining) can reference `recorder` before its
  // initializer completes.
  const recorder: ReplayRecorder = {
    record(input: ReplayFrame): ReplayRecorder {
      if (finished || discarded) return recorder;
      // Defensive: drop null / non-object inputs silently; never throw.
      if (input === null || typeof input !== 'object') return recorder;
      // The mutable buffer pattern (renderer-output buffer exception): we push
      // into a privately-held array; the consumer never sees the array
      // until `finish()` freezes it.
      frames.push(input as ReplayFrame);
      // Return `recorder` for fluent chaining
      // (`recorder.record(a).record(b).finish(cfg)`).
      return recorder;
    },

    finish(config: ReplayConfig): Replay {
      finished = true;
      // Freeze the frames buffer so the returned Replay is truly immutable.
      const frozenFrames: readonly ReplayFrame[] = Object.freeze(frames.slice());
      const replay: Replay = {
        seed: settledSeed,
        initial,
        frames: frozenFrames,
        config,
      };
      // Object.freeze the whole Replay so consumers can't accidentally
      // mutate the returned object.
      return Object.freeze(replay) as Replay;
    },

    discard(): void {
      discarded = true;
      // Deliberately do NOT free the buffer — it remains alive until the
      // closure is GC'd, but no further `record` calls will mutate it.
      // Important for consumers who want to inspect `pending` after discard.
    },

    get pending(): number {
      return frames.length;
    },
  };

  return recorder;
}
