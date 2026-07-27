# Decision: Replay record/playback

> Date: 2026-07-26. Stage 6 (Decide) for the `replay` technique.
> Acts as combined proposal + decision (the architecture was pre-determined
> by `stepPlatformer` + `PlatformerInput` + `canonicalize`/`fnv1a` seams that
> were already in place for this exact use case).

## Decision

**Ship a `src/replay/` module** that consumes the existing determinism
seams:

- **`createReplayRecorder(seed, initialState) → ReplayRecorder`** — mutable
  recorder (renderer-output buffer exception, mutates between polls) with
  `record(input)` and `finish(config) → Replay`.
- **`playReplay(replay, step, dt) → PlatformerState`** — pure re-sim driver
  that calls the consumer's `step(state, input, dt) → state` (which
  typically wraps `stepPlatformer`) for `frames.length` ticks.
- **`replayHash(replay) → number`** — pure 32-bit FNV-1a fingerprint via
  `fnv1a(canonicalize(replay))` for share-codes and clear-check verification.

## Rationale

The research note confirms the library already has **three pre-existing
seams** that make replay a thin harness rather than a new subsystem:
`stepPlatformer` is the pure re-sim target; `PlatformerInput` +
`AnyAbilityState` union are documented as "used for serialization (replay
round-trip)"; `canonicalize` + `fnv1a` were shipped "for future share-code
and verified-replay features". The only missing piece is the **harness
itself** — record/play/hash. Determinism discipline is fully paid for
(verified at `src/tests/platformer-kernel.test.ts:221` byte-identity).
The architect-vetting cycle is skipped here because every architectural
property maps to an existing anchor: layer separation = renderer-output
buffer exception + pure progression ops; freeze semantics = matches
`cosmetics/ownership.ts` + `advanceTween` precedent; determinism =
already demonstrated by existing tests.

## Resolved questions (binding for implementation)

1. **Recorder mutability:** state mutates between `record()` calls
   (`frames.push(input)`); `finish()` returns a NEW frozen `Replay` and
   the recorder becomes idle. Matches the `EdgeAccumulator` precedent.
2. **No `step` inside the module:** consumer supplies
   `(state, input, dt) → state`. Module is decoupled from
   `stepPlatformer`/`compileLevel` integration — replay can be used with
   any deterministic `(state, input, dt) → state` reducer, not just the
   platformer kernel.
3. **No `solids` capture:** the consumer's `step` closure captures solids.
   Replay requires the same `step` to replay it that ran to record it (a
   standard deterministic-TAS convention; explicit in JSDoc).
4. **Hash inputs:** `fnv1a(canonicalize({ seed, initial, config, frames }))`
   — full canonical JSON of the Replay shape. Deterministic across engines
   (canonicalize sorts keys + coerces non-finite to null).
5. **Empty replay:** `replay.frames.length === 0` → `playReplay` returns
   `replay.initial` immediately. Hash is still well-defined.
6. **Bad inputs:** recorder swallows bad `input` (logs once per session);
   `playReplay` swallows malformed `Replay` objects (no throw, returns
   `initial`).
7. **`ReplayConfig` scope:** `{ tickRate: number }` plus whatever the
   consumer wants (the recorder signature is `finish(config: ReplayConfig)`;
   `ReplayConfig` is a typed record with `tickRate` plus a `readonly`
   extension surface via `[key: string]: unknown`).

## Scope (v1)

- `src/replay/types.ts` — `Replay` (frozen, `readonly` everywhere),
  `ReplayFrame` (= `PlatformerInput`, re-exported), `ReplayConfig`,
  `ReplayRecorder` interface.
- `src/replay/recorder.ts` — `createReplayRecorder(seed, initial)`,
  closure-scoped mutable frames buffer (renderer-output buffer), `record`,
  `finish`.
- `src/replay/player.ts` — `playReplay(replay, step, dt)` pure driver;
  consumes the consumer's `step` callback (typically wrapping
  `stepPlatformer`); safety-guarded `step` calls (try/catch each call,
  break on throw — but `stepPlatformer` doesn't throw, so this is
  belt-and-braces).
- `src/replay/hash.ts` — `replayHash(replay)` using `canonicalize` +
  `fnv1a` from `src/level/serialize.ts`.
- `src/replay/index.ts` — barrel.
- `src/index.ts` — add `export * from './replay';`.
- `src/tests/replay.test.ts` — TDD:
  - record → finish → byte-equal Replay given same inputs.
  - play → byte-identical final state vs a live run (use `stepPlatformer`
    directly with a fabricated solid set + same inputs; verify the
    replayed state matches the live state).
  - `replayHash` stable across calls; different inputs → different hash;
    canonical key-sorted hash (swapping field order in a `ReplayConfig`
    yields the same hash).
  - Recorder purity: `record()` does not mutate the input `input`; the
    returned `Replay` is frozen; the recorder's internal buffer is
    disowned at `finish()`.
  - Empty replay: plays to `initial`; hash stable.
  - Never throws on malformed input (null input, null step function,
    malformed Replay object).
- `src/tests/barrel-contract.test.ts` — replay assertions.
- `docs/api-surface.md` — flip `src/replay/` from PROPOSED to shipped.
- `README.md` — add a `1. Replay` row.

## Inputs that drove this decision

- `docs/research/replay.md` (3 already-paying-for-it seams).
- `src/platformer/types.ts:255-257` (documented replay intent).
- `src/level/serialize.ts` (canonicalize + fnv1a shipped for replay).
- `src/tests/platformer-kernel.test.ts:221` (byte-identity already verified).
