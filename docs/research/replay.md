# Replay record/playback

> Research note. Investigated: 2026-07-26. Slug: `replay`.

## TL;DR

The library enforces determinism across the board (`docs/architecture.md`,
                                              game-loop fixed-step, `mulberry32`-only RNG,
                                              pure-reducer enemies + particles), and the
                                              architecture already pays for replay through
                                              three pre-existing seams: (a) `stepPlatformer(state,
                                              input, solids, dt) → PlatformerState` in
                                              `src/platformer/kernel.ts` is the **pure re-sim
                                              harness** — play back to it and you get the exact
                                              same ending state for the exact same input
                                              sequence; (b) `PlatformerInput` (`{ moveX, jump:
                                              PolledEdge, dash: PolledEdge | null }`) and the
                                              entire `PlatformerState` shape (including
                                              `AnyAbilityState` discriminated union) are
                                              documented at `src/platformer/types.ts:255-257` as
                                              *"used for serialization (replay round-trip)"*;
                                              (c) `canonicalize` + `fnv1a` in
                                              `src/level/serialize.ts` were shipped
                                              *"for future share-code and verified-replay
                                              features"*. The only missing piece is the
                                              **replay harness** itself: a recorder that
                                              captures inputs + initial state, a pure player
                                              that re-simulates them, and a verification hash
                                              that proves the recording reproduces exactly.

The recommendation is the simplest design that exercises all three seams without
redundant surface: a **`createReplayRecorder(seed, initialState)` mutable
recorder** (renderer-output buffer exception: the recorder mutates between
ticks) returning `record(input)` and `finish(config) → Replay`; a pure
**`playReplay(replay, step, dt) → PlatformerState`** that runs the
consumer-supplied `step` (which wraps `stepPlatformer`); and a pure
**`replayHash(replay) → number`** that uses `fnv1a(canonicalize(replay))` for a
deterministic 32-bit fingerprint suitable for share-codes and clear-check
verification.

No new determinism discipline is needed — it is already paid for. The replay
harness is the final slab on the foundation the determinism work already laid.

## Prior Art Survey (condensed)

- **TAS / deterministic emulation** (NES, SNES, emulators): record input
  stream + initial state + RNG seed; replay re-runs the simulator. The
  analog here: `mulberry32` seed + initial `PlatformerState` + platformer
  `step` already yields deterministic outputs (verified at
  `src/tests/platformer-kernel.test.ts:221` and `:101` byte-identity on
  snapshots). The architecture has already absorbed this discipline.

- **Redis AOF / WAL**: replay = log of deterministic boundary inputs.
  Here the log is the per-tick `PlatformerInput` stream.

- **Hardcore mode in roguelikes** (Spelunky, Dark Souls): deterministic
  collision + RNG → recorded inputs reproduce identical runs. Same pattern,
  smaller scope.

- **Spitekeep / IMP - Not a Troll**: the canonical sibling codebase
  already records+replays via FNV-1a hashing. This module ports that
  pattern to the library.

## Why this matters for aicraft-engine

- **Pillar Touched:** extends **Pillar 4 (Level Schema / Runtime)**; the
  replay surface complements the consumer-facing ability to share
  arbitrary-difficulty levels (`LevelData` is reproducible from
  `canonicalize` + FNV-1a hash).
- **Consumer Games:** Spitekeep "share my best run" feature, Clone-to-Jest
  marketing (deterministic run GIFs, bug-report reproducibility).
- **Determinism Discipline:** unlocks **verifiable replays** (hash the
  final state; compare against an expected hash) — the @architect's
  "explicit, auditable determinism boundary" criterion, finally consumable
  by consumer code.

## Architecture Decisions (resolved in `docs/design/replay-decision.md`)

1. **Layer split:** recorder is **host-touching renderer-output buffer**
   (mutable state between polls — mutates `frames` array internally);
   `playReplay` is **pure** (immutable in, fresh state out); `replayHash`
   is a pure reader.
2. **Seam:** the recorder wraps the existing
   `PlatformerInput`/`PlatformerState` types. No new types for the
   simulation; only `Replay`, `ReplayFrame`, `ReplayConfig`, and
   `ReplayRecorder`.
3. **No `step` inside the module:** the consumer supplies their own
   `step(state, input, dt) → state` (which wraps `stepPlatformer` in a
   typical consumer). This keeps the module decoupled from collision /
   enemy / particle integration.
4. **No `solids` capture:** the consumer's `step` already knows its
   solids/level; the replay only captures inputs + initial state +
   config. A clear contract: "Replay requires the same `step` to replay
   it that ran to record it" — matches deterministic-tas conventions.
5. **Hash:** `fnv1a(canonicalize(replay))` — full canonical JSON over
   `{ seed, initial, config, frames }`. 32-bit unsigned value suitable
   for share-codes. Deterministic across engines.
6. **Implementation constraint:** recorder must NEVER throw on bad
   inputs; `playReplay` must NEVER throw on malformed replay data
   (treated as a no-step sequence → returns initial state).

## Cross-References

- `src/platformer/kernel.ts` — `stepPlatformer` is the re-sim target.
- `src/platformer/types.ts:255-257` — `AnyAbilityState` already designed for
  replay serialization.
- `src/level/serialize.ts` — `canonicalize` + `fnv1a` ready to consume Replay.
- `docs/architecture.md:42-51` — pure-progression-ops + renderer-output
  buffer exception.
- `src/tests/platformer-kernel.test.ts:221` — byte-identity-of-final-state
  already in the test suite (replay reuses this guarantee).
