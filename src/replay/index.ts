/**
 * Replay record/playback (Pillar 4 — Runnable Subsystem).
 *
 * The determinism-harness for the library: captures a per-tick input
 * stream + initial state and re-simulates it through a consumer-supplied
 * `step` callback. Pairs with `replayHash` for share-code-style
 * verification and CI smoke tests.
 *
 * The recorder is the **mutable renderer-output-buffer sibling** of the
 * frozen `Replay`. `playReplay` is **pure** (immutable in, fresh state
 * out). `replayHash` is a **pure reader** using the existing
 * `canonicalize` + `fnv1a` pipeline from `src/level/serialize.ts`.
 *
 * Determinism discipline is already paid for by the existing
 * `stepPlatformer` kernel + `PlatformerInput` serializable shape + the
 * `@mulberry32` RNG mandate. This module is the final harness.
 *
 * @module
 */

export type { Replay, ReplayFrame, ReplayConfig, ReplayRecorder } from './types';
export type { ReplayStep } from './player';

export { createReplayRecorder } from './recorder';
export { playReplay } from './player';
export { replayHash } from './hash';
