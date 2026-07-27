# Decision: Procedural Music / Step Sequencer

> Date: 2026-07-26. Stage 6 (Decide) for the `music-sequencer` technique.

## Decision

**Adopt Approach A from `docs/design/music-sequencer-proposal.md`, refined to a
4-layer split:** pure music-theory → pure seeded pattern generator → **pure
`advanceSequencer` state-walker (the determinism seam)** → host-touching
sequencer adapter that reuses the existing `AudioAdapter`. New module
`src/music/`.

## Rationale

The research note (`docs/research/music-sequencer.md`) confirms music is the
most algorithmic audio and a natural extension of the library's "the algorithm
IS the art" thesis: a `Pattern` is a serializable parameter preset that can
embed in a cosmetic `SkinPreset.music`, and the scheduler is the deterministic-
to-wall-clock bridge. The library already owns every pattern this module needs:
the seeded-generator sibling (`palette/generate`, `cosmetics/generate`), the
pure advance seam (`particles/advance`, `particles/emitter`'s
`advanceEmission`), and the defensive host-adapter pattern
(`audio/factory.ts`'s `AudioAdapter`, whose `playTone(..., whenS)` is exactly
the lookahead offset the two-clock scheduler needs — no second `AudioContext`,
no double-unlock).

The `@architect` returned **APPROVED** after one revision loop. Loop 1's HIGH
objection was that the proposal had silently dropped the pure `advanceSequencer`
layer the research explicitly names as the determinism-boundary pivot (the
analogue of `advance(particles, dt)`); without it the pattern-walk was
untestable in Node and entangled with `audio.currentTime`. Loop 2 confirmed the
4-layer split restored, the `setVolume`-scales-`peak` mechanism documented, and
all 3 lows resolved, with no regressions. No benchmark runs: this is an audio
module — the 3 pure layers are verified deterministically by unit tests, and
the host adapter is verified via a fake `AudioAdapter` that records `playTone`
calls (the benchmarker is vision-capable, not audio; a piano-roll PNG would be
decorative, not a correctness gate).

Approach B (fluent `PatternBuilder` + `playPattern` shortcut) was rejected — it
introduces a builder pattern the library doesn't use elsewhere. Approach C
(single `Music` facade) was rejected — it breaks the pure-core/host-adapter
boundary and makes `Pattern` opaque.

## Resolved questions (binding for implementation)

1. **Pattern-length:** validate at build (generator guarantees equal track
   lengths); sequencer trusts + fails-silent on malformed data.
2. **Swing:** song-level v1; even-indexed steps are on-beat, odd-indexed
   off-beat steps receive the swing delay. Per-track swing deferred (additive).
3. **Note duration:** `NoteEvent.durationSteps` = GATE time (BPM-independent
   data). Adapter maps `durMs = durationSteps × secondsPerStep(bpm,
   stepsPerBeat) × 1000` and passes it to `playTone`; envelope = gate, no extra
   tail.
4. **Polyphony cap:** none in v1; `AudioAdapter` is the bottleneck. Document
   density guidance.
5. **Live mutation / Web MIDI / compact-binary serialization:** all deferred
   (v1 = JSON).
6. **Determinism boundary:** 4 layers — theory, pattern+generator, and
   `advanceSequencer` are PURE (no host, no `audio.currentTime`, no `Math.random`
   — uses `mulberry32`); ONLY the sequencer adapter is host-touching.
7. **`AudioAdapter` reuse:** the adapter takes an `AudioAdapter` (no second
   `AudioContext`); double-unlock avoided via the adapter's idempotent
   `unlock()`.
8. **`Sequencer.setVolume`:** scales the `peak` argument of each `playTone`
   call by the music-volume factor (pure multiplication; no extra gain nodes;
   independent of SFX volume).
9. **`frequencyToNote`:** full float (consumers round if needed).
10. **`generatePattern` `pick` guard:** MUST NOT call `pick` on a potentially-
    empty array; use `scaleDegree` (wraps gracefully) or length-guard.

## Locked architect verdicts
Pattern-length trust; swing even/odd; default `generatePattern(seed)` produces
a complete usable loop (minor-pentatonic bass + melody, no config required);
`frequencyToNote` full float.

## Scope (v1)

- `src/music/theory.ts` (Layer 1) — `noteToFrequency(midi)`, `frequencyToNote(freq)` (float), `buildScale`, `scaleDegree`, `secondsPerBeat`, `secondsPerStep`, `swingLongDuration`, `SCALES`. `@module` header.
- `src/music/pattern.ts` (Layer 2) — `generatePattern(seed, config?)` using `mulberry32` + theory; ships sensible defaults so `generatePattern(42)` just works.
- `src/music/advance.ts` (Layer 3) — `SequencerState` (all `readonly`), `NoteFire`, `advanceSequencer(state, dt, pattern) → { next, events }`. PURE.
- `src/music/sequencer.ts` (Layer 4) — `createSequencer(audio: AudioAdapter, pattern, config?)` returning `{ play, stop, setVolume, getVolume, dispose }`; two-clock lookahead scheduler; defensive (never-throw, idempotent dispose, no-op when audio locked).
- `src/music/constants.ts` — `DEFAULT_SWING`, `DEFAULT_BPM`, `DEFAULT_STEPS_PER_BEAT`, `DEFAULT_STEPS_PER_PATTERN`, `LOOKAHEAD_MS`, `SCHEDULE_AHEAD_S`.
- `src/music/types.ts` — `NoteEvent`, `Track`, `Pattern`, `PatternGenConfig`, `TrackGenConfig`, `SequencerState`, `NoteFire`, `Sequencer`, `SequencerConfig`. `@module` header.
- `src/music/index.ts` — barrel.
- `src/index.ts` — add `export * from './music';`.
- `src/tests/music-theory.test.ts`, `src/tests/music-pattern.test.ts`, `src/tests/music-advance.test.ts`, `src/tests/music-sequencer.test.ts` — TDD: theory math (note↔freq, scales, BPM, swing); generator determinism (same seed → identical pattern) + `pick` guard; `advanceSequencer` purity + step-boundary note firing + swing on odd steps + loop wrap; sequencer via a fake `AudioAdapter` recording `playTone(type,f0,f1,durMs,peak,whenS)` calls (verifies scheduling, `setVolume` scales `peak`, stop/dispose idempotent, no-throw when locked).
- `src/tests/barrel-contract.test.ts` — music assertions.
- `docs/api-surface.md` — flip `src/music/` from PROPOSED to shipped.
- `README.md` — add an Audio-subrow or a new "1. Music" row.

## Inputs that drove this decision

- `docs/research/music-sequencer.md` (two-clock scheduler, tracker data model, theory primitives, Sokpop/JS13k generative music).
- `docs/design/music-sequencer-proposal.md` (Approach A, revised to 4 layers).
- `@architect` critique loop 1 (NEEDS REVISION — HIGH: missing `advanceSequencer` seam) + loop 2 (APPROVED).
