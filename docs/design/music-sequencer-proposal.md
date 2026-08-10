# API Proposal: Procedural Music / Step-Sequencer

> Target pillar: Pillar 1 (extends audio). Module: `src/music/`.
> Builds on research: `docs/research/music-sequencer.md`.
> Status: DRAFT.

## Consumer Need

the reference implementation (idle/menu music, level themes) and future consumer titles (Stacklands-style ambient, Sokpop-style generative soundtracks) need asset-less procedural music: zero audio files, zero samples, zero licenses — every note synthesized from the existing `AudioAdapter.playTone`/`playNoise`. The library's "the algorithm IS the art" thesis extends to music: a `SkinPreset` can carry a serializable `Pattern` that generates a unique soundtrack per skin seed. Without this module, consumers must hand-roll Chris Wilson's two-clock scheduler, reimplement MIDI→Hz math, and invent a pattern data model — all error-prone, all non-deterministic if done naively.

---

## Approach A: Four-Layer Separation (Pure Theory + Pure Data + Pure Advance + Host Adapter)

**Source pattern:** The research note's recommended 4-layer split, mirroring the existing `src/particles/` (pure spawn/advance/cull → pure stepEmitters → renderer-adjacent step) and `src/palette/` (pure OKLCH math → seeded generator → serializable Palette) patterns.

**Signature sketch:**

```ts
// ── Layer 1: src/music/theory.ts ── Pure, zero-state, fully testable ──

/** A4 = MIDI 69 = 440 Hz. The universal reference pitch. */
export const A4_MIDI = 69;
export const A4_FREQ = 440;

/** Canonical scale intervals (semitones from root). */
export const SCALES = {
  major:           [0, 2, 4, 5, 7, 9, 11],
  minor:           [0, 2, 3, 5, 7, 8, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues:           [0, 3, 5, 6, 7, 10],
  dorian:          [0, 2, 3, 5, 7, 9, 10],
} as const;

/** MIDI note number → frequency in Hz. Equal temperament. */
export function noteToFrequency(midi: number, tuning?: number): number;

/** Frequency in Hz → MIDI note number (float). Returns full float precision —
 *  rounding is lossy; consumers round at the call site if needed. */
export function frequencyToNote(freq: number): number;

/** Build a scale as MIDI note numbers across `octaves` octaves. */
export function buildScale(rootMidi: number, intervals: readonly number[], octaves?: number): number[];

/** Pick a scale degree (0-based, wraps). Handles negative degrees. */
export function scaleDegree(scale: readonly number[], degree: number): number;

/** BPM → seconds per beat. */
export function secondsPerBeat(bpm: number): number;

/** BPM + subdivision → seconds per step. */
export function secondsPerStep(bpm: number, stepsPerBeat: number): number;

/**
 * Swing: duration of the LONG half of a pair. 0.5 = straight, 0.66 = triplet.
 * Pure.
 */
export function swingLongDuration(pairDuration: number, swingRatio: number): number;

// ── Layer 2: src/music/pattern.ts ── Pure data + seeded generator ──

/** A single note event. Pure data, serializable. */
export interface NoteEvent {
  /** MIDI note number (0–127). null = rest. */
  readonly midi: number | null;
  /** Duration in steps (GATE time, BPM-independent data). Defaults to 1 step.
   *  Fractional allowed (0.5 = half step). The adapter converts to ms:
   *  `durMs = durationSteps × secondsPerStep(bpm, stepsPerBeat) × 1000`.
   *  The AudioAdapter envelope handles audible decay (attack + decay to silence);
   *  envelope duration equals the gate. */
  readonly durationSteps?: number;
  /** Peak gain [0, 1]. Defaults to track volume. */
  readonly peak?: number;
  /** Oscillator waveform. Defaults to track waveform. */
  readonly waveform?: OscillatorType;
}

/** A single track — one "voice" (bass, lead, drums, etc.). */
export interface Track {
  /** Track name (display only). */
  readonly name: string;
  /** Default oscillator waveform for notes on this track. */
  readonly waveform: OscillatorType;
  /** Default peak gain [0, 1] for notes on this track. */
  readonly volume: number;
  /** Pattern indices: one per song step, referencing `patterns[]`. */
  readonly sequence: readonly number[];
  /** Reusable patterns. Each is a fixed-length array of NoteEvents. */
  readonly patterns: readonly (readonly NoteEvent[])[];
}

/** A complete song — multiple tracks sharing a tempo + scale. */
export interface Pattern {
  /** BPM (quarter-note beats per minute). */
  readonly bpm: number;
  /** Steps per beat. 4 = 16th notes; 2 = 8th notes; 1 = quarter notes. */
  readonly stepsPerBeat: number;
  /** Total steps per pattern (typically 16). All tracks must match. */
  readonly stepsPerPattern: number;
  /** Optional key/scale metadata — used by the generator, ignored by the player. */
  readonly scale?: { readonly rootMidi: number; readonly intervals: readonly number[] };
  /** Tracks that play simultaneously. */
  readonly tracks: readonly Track[];
}

/** Seeded pattern generator config. Every field optional with musical defaults. */
export interface PatternGenConfig {
  readonly rootMidi?: number;          // default 48 (C3 — bass range)
  readonly scale?: readonly number[];  // default SCALES.minorPentatonic
  readonly bpm?: number;               // default 110
  readonly stepsPerBeat?: number;      // default 4 (16th notes)
  readonly stepsPerPattern?: number;   // default 16
  readonly swing?: number;             // default 0.5 (straight)
  readonly tracks?: readonly TrackGenConfig[];
}

/** Per-track generation config. */
export interface TrackGenConfig {
  readonly name: string;
  readonly waveform: OscillatorType;
  readonly volume: number;
  readonly rhythm: readonly boolean[];  // hit/miss per step (wraps if shorter)
  readonly degreeMin: number;
  readonly degreeMax: number;
  readonly noteDurationSteps?: number;  // default 1
}

/**
 * Deterministically generate a Pattern from a seed + config.
 * Same (seed, config) → same Pattern forever. Uses mulberry32.
 *
 * Implementation constraint: `generatePattern` MUST NOT call `pick` on a
 * potentially-empty array. `pick` throws on empty arrays (src/rng/mulberry32.ts).
 * Use `scaleDegree` (wraps gracefully) for note selection, or guard with a
 * length check before calling `pick`. If `pick` is used anywhere, pre-check
 * length and degrade silently (return a rest / skip the track).
 */
export function generatePattern(seed: number, config?: PatternGenConfig): Pattern;

// ── Layer 3: src/music/advance.ts ── Pure sequencer state + step walker ──

/**
 * Pure sequencer playback state. All fields are readonly — the consumer
 * owns the state object and receives a new one from `advanceSequencer`.
 * No host access, no `Math.random`, no `Date.now()`, no `setTimeout`.
 * Fully unit-testable in Node.
 */
export interface SequencerState {
  /** Elapsed time in seconds since playback started. */
  readonly elapsedS: number;
  /** Current step index within the pattern (0-based, wraps at stepsPerPattern). */
  readonly stepIndex: number;
  /** Number of times the pattern has looped. */
  readonly loopCount: number;
}

/**
 * A single note event fired by the sequencer advance. Pure data — the
 * host adapter maps each event to an `audio.playTone(...)` call.
 */
export interface NoteFire {
  /** MIDI note number (0–127). null = rest (track voice active but silent). */
  readonly midi: number | null;
  /** Oscillator waveform (resolved from note or track default). */
  readonly waveform: OscillatorType;
  /** Peak gain [0, 1] (resolved from note peak × track volume × music volume). */
  readonly peak: number;
  /** Gate duration in seconds (= durationSteps × secondsPerStep(bpm, stepsPerBeat)).
   *  The host adapter passes `gateS × 1000` as `durMs` to `audio.playTone(...)`.
   *  The AudioAdapter envelope handles audible decay; envelope duration equals the gate. */
  readonly gateS: number;
  /** Offset in seconds from the current scheduler tick when this note should fire.
   *  The host adapter passes this as `whenS` to `audio.playTone(...)`. */
  readonly whenOffset: number;
}

/**
 * Pure sequencer advance. Walks the pattern deterministically, advances
 * elapsed time by `dt` seconds, and returns any notes whose step boundary
 * is crossed during the advance. Applies swing to odd-indexed off-beat steps.
 *
 * No host access — this function is fully testable in Node. The host adapter
 * (Layer 4) consumes the returned `events` and schedules them via `audio.playTone`.
 *
 * Mirrors `advance(particles, dt, opts)` in `src/particles/advance.ts` and
 * `advanceEmission(state, dt, config)` in `src/particles/emitter.ts`.
 *
 * @param state - Current sequencer state (consumer-owned).
 * @param dt - Time delta in seconds (from the scheduler tick or fixed-step loop).
 * @param pattern - The pattern to walk. Must have at least one track with valid sequences.
 * @returns New state + any note-fire events. Empty `events` = no notes crossed a step boundary.
 */
export function advanceSequencer(
  state: SequencerState,
  dt: number,
  pattern: Pattern,
): { readonly next: SequencerState; readonly events: readonly NoteFire[] };

// ── Layer 4: src/music/sequencer.ts ── Host-touching adapter ──

/** Sequencer playback controls. Defensive adapter — never throws. */
export interface Sequencer {
  /** Start (or restart) playback from step 0. Idempotent. */
  play(): void;
  /** Stop playback with a short fade-out. Idempotent. */
  stop(): void;
  /** Whether the sequencer is currently playing. */
  isPlaying(): boolean;
  /** Set BPM. Takes effect on the next scheduled step. */
  setBpm(bpm: number): void;
  /** Set music volume [0, 1]. Independent of AudioAdapter SFX volume.
   *  Mechanism: scales the `peak` argument passed to each `audio.playTone(...)` call
   *  by the music-volume factor (pure multiplication, no extra gain nodes, no second context).
   *  The AudioAdapter's master gain covers all voices; this is a software-level volume. */
  setVolume(value: number): void;
  /** Current music volume [0, 1]. */
  getVolume(): number;
  /** Dispose: stop + release timer. Idempotent. */
  dispose(): void;
}

/** Sequencer configuration. */
export interface SequencerConfig {
  /** Lookahead poll interval in ms. Default 25. */
  readonly lookaheadMs?: number;
  /** How far ahead to pre-queue (seconds). Default 0.1. */
  readonly scheduleAheadS?: number;
  /** Swing ratio [0.5, 0.75]. Default 0.5 (straight). */
  readonly swing?: number;
}

/**
 * Create a sequencer that plays a Pattern via the existing AudioAdapter.
 * Reuses AudioAdapter — does NOT create a second AudioContext.
 * Uses Chris Wilson's two-clock lookahead scheduler.
 */
export function createSequencer(
  audio: AudioAdapter,
  pattern: Pattern,
  config?: SequencerConfig,
): Sequencer;
```

**Usage example:**

```ts
import { createAudioAdapter } from 'aicraft-engine/src/audio';
import { createSequencer } from 'aicraft-engine/src/music/sequencer';
import { generatePattern } from 'aicraft-engine/src/music/pattern';
import { SCALES } from 'aicraft-engine/src/music/theory';

// 1. Create audio adapter (shared with SFX)
const audio = createAudioAdapter();

// 2. Generate a looping pentatonic bassline + melody from a seed
const pattern = generatePattern(42, {
  rootMidi: 36,  // C2
  scale: SCALES.minorPentatonic,
  bpm: 110,
  tracks: [
    {
      name: 'bass',
      waveform: 'sawtooth',
      volume: 0.25,
      rhythm: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      degreeMin: 0,
      degreeMax: 4,
      noteDurationSteps: 2,
    },
    {
      name: 'melody',
      waveform: 'sine',
      volume: 0.18,
      rhythm: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      degreeMin: 2,
      degreeMax: 8,
    },
  ],
});

// 3. Create sequencer — borrows the AudioAdapter
const seq = createSequencer(audio, pattern);

// 4. Play on user gesture (after audio.unlock())
audio.unlock();
seq.play();

// 5. Stop on menu exit — short fade-out, no click
seq.stop();

// 6. Cleanup on scene dispose
seq.dispose();
```

**Trade-offs:**

- **Ergonomics:** Four imports, explicit layering. Consumer must understand the theory→pattern→advance→sequencer pipeline. More ceremony than Approach C, but each layer is independently useful.
- **Determinism:** Perfect. Layers 1–3 are pure (Node-testable, no host). Layer 4 is host-touching but isolated. The determinism boundary is explicit and auditable — `advanceSequencer` is the seam.
- **Runtime cost:** Negligible. Pattern generation is O(steps × tracks), one-shot at load. Sequencer advance is O(tracks × stepsPerPattern) per tick (bounded by pattern size). Host adapter is O(1) per tick.
- **Consumer complexity:** Moderate. Consumer must wire the four layers together. But this is the same complexity as particles (`createEmitter` + `stepEmitters` + renderer) — proven pattern.
- **Tree-shake-ability:** Excellent. Each layer is a separate module. A consumer can import only `theory.ts` for MIDI math without pulling in the sequencer.
- **Convention fit:** Mirrors `src/palette/` (pure OKLCH → seeded generator → serializable Palette) and `src/particles/` (pure advance → stepEmitters → renderer). Factory-function naming (`createSequencer`), no magic numbers, JSDoc on every export.

**What this makes easy:**
- Testing theory functions in isolation (Node, no DOM).
- Testing `advanceSequencer` in isolation (Node, no host — the determinism seam).
- Embedding a `Pattern` in a `SkinPreset` as serializable data.
- Swapping generators or hand-authoring patterns.
- Using only the theory module for MIDI math (tree-shake the rest).

**What this makes hard:**
- Quick prototyping: four imports + wiring for a "just play music" use case.
- The consumer must understand the layer model.

---

## Approach B: Pattern Builder + Bundled Sequencer

**Source pattern:** Extends Approach A with a builder/fluent API on the pattern layer and a convenience `playPattern` shortcut that bundles create+start.

**Signature sketch:**

```ts
// ── Layer 1: src/music/theory.ts ── Same as Approach A ──

// ── Layer 2: src/music/pattern.ts ── Same types + builder ──

// Same NoteEvent, Track, Pattern types as Approach A.

/**
 * Fluent pattern builder. Builds a Pattern step-by-step.
 * More ergonomic for hand-authored patterns than raw object literals.
 */
export function createPatternBuilder(bpm: number, stepsPerBeat?: number): PatternBuilder;

export interface PatternBuilder {
  /** Add a track. Returns this (chainable). */
  addTrack(config: TrackBuilderConfig): PatternBuilder;
  /** Build the final Pattern. Validates equal track lengths. */
  build(): Pattern;
}

export interface TrackBuilderConfig {
  readonly name: string;
  readonly waveform?: OscillatorType;  // default 'sine'
  readonly volume?: number;             // default 0.3
  /** Note events per step. null = rest. Supports chaining. */
  readonly steps: readonly (NoteEvent | number | null)[];
}

// generatePattern same as Approach A.

// ── Layer 3: src/music/sequencer.ts ── Same Sequencer interface ──

// createSequencer same as Approach A.

/**
 * Convenience: generate + create + start in one call.
 * Returns the Sequencer (caller must call stop/dispose).
 */
export function playPattern(
  audio: AudioAdapter,
  seed: number,
  config?: PatternGenConfig,
  seqConfig?: SequencerConfig,
): Sequencer;
```

**Usage example:**

```ts
import { createAudioAdapter } from 'aicraft-engine/src/audio';
import { playPattern, SCALES } from 'aicraft-engine/src/music';

const audio = createAudioAdapter();
audio.unlock();

// One call: generate + create + start
const seq = playPattern(audio, 42, {
  rootMidi: 36,
  scale: SCALES.minorPentatonic,
  bpm: 110,
});

// Stop on menu exit
seq.stop();
seq.dispose();
```

**Trade-offs:**

- **Ergonomics:** Better for quick start (`playPattern` is one call). Builder is nicer for hand-authored patterns than raw object literals.
- **Determinism:** Same as A — layers 1–2 are pure. `playPattern` is a convenience wrapper that hides no determinism violations.
- **Runtime cost:** Same as A. Builder adds trivial allocation overhead.
- **Consumer complexity:** Lower for the common case. But `playPattern` obscures the create/start lifecycle — consumer might forget to `dispose()`.
- **Tree-shake-ability:** Slightly worse. `playPattern` pulls in both `pattern.ts` and `sequencer.ts`. But individual imports still tree-shake.
- **Convention fit:** Builder is a new pattern for the library (no existing builder APIs). The library's existing pattern is plain config objects + factory functions. Builder adds conceptual weight.

**What this makes easy:**
- One-call startup for generative music.
- Hand-authored patterns via fluent API.

**What this makes hard:**
- Builder is a new concept — no precedent in the library.
- `playPattern` hides lifecycle — consumer might not `dispose()`.
- Two ways to do the same thing (raw Pattern vs builder) — potential confusion.

---

## Approach C: Single High-Level `Music` Facade

**Source pattern:** The Tone.js `Player` / Sokpop "just load the song" pattern — one object that owns everything.

**Signature sketch:**

```ts
// All theory, pattern, and sequencer internals are private.
// The consumer sees one interface:

export interface Music {
  /** Start playing. Idempotent. */
  play(): void;
  /** Stop with fade-out. Idempotent. */
  stop(): void;
  /** Whether playing. */
  isPlaying(): boolean;
  /** Set BPM. */
  setBpm(bpm: number): void;
  /** Set volume [0, 1]. */
  setVolume(value: number): void;
  /** Get volume [0, 1]. */
  getVolume(): number;
  /** Generate a new pattern from seed + config, replacing the current one. */
  setPattern(seed: number, config?: PatternGenConfig): void;
  /** Load a hand-authored Pattern. */
  loadPattern(pattern: Pattern): void;
  /** Dispose everything. */
  dispose(): void;
}

/**
 * Create a music player. Generates a pattern from seed, or accepts
 * a hand-authored Pattern.
 */
export function createMusic(
  audio: AudioAdapter,
  seed: number,
  config?: PatternGenConfig,
): Music;
```

**Usage example:**

```ts
import { createAudioAdapter } from 'aicraft-engine/src/audio';
import { createMusic } from 'aicraft-engine/src/music';

const audio = createAudioAdapter();
audio.unlock();

const music = createMusic(audio, 42, { bpm: 110 });
music.play();

// Swap pattern at runtime (e.g. skin change)
music.setPattern(99, { rootMidi: 48, bpm: 120 });

// Menu exit
music.stop();
music.dispose();
```

**Trade-offs:**

- **Ergonomics:** Best for simple use cases. One import, one object, one call to play.
- **Determinism:** Problematic. `setPattern` at runtime implies the pattern can be swapped while playing — this creates a complex state-transition problem (fade out old, crossfade to new, handle mid-pattern swaps). The determinism boundary is muddier because the facade owns the pattern lifecycle.
- **Runtime cost:** Same O(1) per tick. But internal state management is more complex.
- **Consumer complexity:** Lowest surface area. But the consumer has no access to the pure layers — can't use `noteToFrequency` without importing theory separately, can't embed a `Pattern` in a `SkinPreset` without understanding the internal shape.
- **Tree-shake-ability:** Worst. The facade pulls in everything. Theory-only usage requires a separate import anyway.
- **Convention fit:** Breaks the library's pattern. Every existing module exposes pure ops + factory functions, not opaque facades. The `Music` object owns too much state — it's a god object compared to the library's lean compositional style.

**What this makes easy:**
- "Just play music" in 3 lines.

**What this makes hard:**
- Accessing pure theory functions (need separate import).
- Embedding patterns in `SkinPreset` (opaque internals).
- Testing (can't test pattern generation without the host adapter).
- Runtime pattern swapping (crossfade complexity).

---

## Comparison Table

| Criterion | A: Four-Layer | B: Builder + Bundled | C: Facade |
|---|---|---|---|
| **Ergonomics** | Moderate (3 imports) | Good (builder + shortcut) | Best (1 import) |
| **Determinism** | Perfect (explicit boundary) | Perfect (same boundary) | Muddy (runtime swap) |
| **Runtime cost** | Negligible | Negligible | Negligible |
| **Consumer complexity** | Moderate | Low–Moderate | Lowest |
| **Tree-shake-ability** | Excellent | Good | Poor |
| **Convention fit** | Strong (mirrors palette + particles) | Moderate (new builder pattern) | Weak (god object) |
| **Testability** | Excellent (pure layers isolated) | Excellent | Poor (facade needs host) |
| **SkinPreset embeddability** | Excellent (Pattern is plain data) | Excellent | Poor (opaque) |
| **Risk** | Low (proven patterns) | Medium (new conventions) | High (architecture break) |

---

## Recommendation

**Approach A: Four-Layer Separation.**

The research note's 4-layer split is the right architecture. It mirrors the library's existing patterns exactly: `src/palette/` has pure OKLCH math + seeded generator + serializable Palette; `src/particles/` has pure advance + pure stepEmitters + renderer-adjacent step. The music module follows the same shape: pure theory + pure pattern generator + serializable Pattern + pure sequencer advance + host-touching sequencer adapter.

Approach A wins because:
1. **Each layer is independently useful.** A consumer can import only `theory.ts` for MIDI→Hz math (tree-shake the rest). A consumer can embed a `Pattern` in a `SkinPreset` without pulling in the sequencer. A consumer can test `advanceSequencer` in isolation (Node, no host). A consumer can hand-author a pattern without the generator.
2. **The determinism boundary is explicit and auditable.** Layers 1–3 are pure (Node-testable). Layer 4 is host-touching but isolated. The determinism seam is at `advanceSequencer` → `createSequencer`: everything above is pure, everything below touches the host.
3. **It follows proven conventions.** Factory functions (`createSequencer`), pure advance functions (`advanceSequencer`), plain config objects, pure ops — all patterns the library already uses.
4. **Public API is stable and extensible.** Adding a builder (Approach B) later is non-breaking. Adding a facade (Approach C) later is non-breaking. Starting with the minimal composable surface avoids painted-in corners.

Approach B's builder is a nice-to-have but adds a new pattern the library doesn't use. The convenience `playPattern` shortcut obscures lifecycle. Approach C's facade is actively harmful — it breaks the pure-core/host-adapter boundary and makes the Pattern type opaque.

The consumer who wants "just play music" gets it with:
```ts
import { generatePattern, createSequencer } from 'aicraft-engine/src/music';
const seq = createSequencer(audio, generatePattern(42));
seq.play();
```
That's two imports and three lines. Approach C saves one import and one line — not worth the architectural cost.

---

## Open Questions for @architect

1. **Pattern-length validation:** `build()` in the generator validates that all tracks' patterns have the same length. Should `createSequencer` also validate at play-time (throw/silent-no-op on mismatch), or trust the generator's output? I recommend: generator validates, sequencer trusts (fail-silent if somehow violated).

2. **Swing step assignment:** For 16th-note patterns (stepsPerBeat=4), even-indexed steps (0, 2, 4, …) are "on-beat" and odd-indexed (1, 3, 5, …) are "off-beat" and receive the swing delay. Is this the correct generalization for arbitrary stepsPerBeat values? For stepsPerBeat=2 (8th notes), steps 0,2,4,… are on-beat and 1,3,5,… are off-beat — same pattern. For stepsPerBeat=1 (quarter notes), there are no off-beat steps, so swing has no effect — correct behavior.

3. **Note durationSteps default:** Should the default `durationSteps` be 1 (one full step) or should it vary by track type? I recommend 1 — simple, predictable, consumer overrides as needed.

4. **Swing on the sequencer vs on the pattern:** The proposal puts swing on `SequencerConfig` (song-level, applied at scheduling time). An alternative is putting it on `Pattern` (serialized with the pattern). I recommend sequencer-level — swing is a playback feel, not a composition choice, and it should be changeable at runtime without regenerating the pattern.

5. **`frequencyToNote` precision:** The research note rounds to 2 decimal places. Is this sufficient for all use cases, or should we return the full float? I recommend full float — rounding is a lossy operation the consumer can apply if needed.

6. **Default PatternGenConfig:** The proposal ships defaults that produce a sensible minor-pentatonic loop out of the box. Should the defaults be more minimal (just bpm + scale, no tracks) or more complete (include a default bass + melody track configuration)? I recommend complete defaults — the module should be usable with `generatePattern(seed)` and no config, producing music immediately.

---

## Open Question Verdicts (Decided)

### 1. Pattern-length constraint — validate at build
**Validate at build time.** `generatePattern` ensures all tracks produce patterns of exactly `stepsPerPattern` length. `createSequencer` trusts the Pattern shape (fail-silent on malformed data, never throw). Document that consumers hand-authoring patterns must ensure equal track lengths.

### 2. Swing scope — song-level v1
**Song-level in v1.** Swing is a playback feel, not a per-track composition choice. The `SequencerConfig.swing` parameter applies uniformly to all tracks. Per-track swing is a v2 extension (add a `swing` field to `Track` — non-breaking).

### 3. Note duration semantics — gate time in steps
**`durationSteps` is gate time (in steps).** The sequencer computes audible ms from `durationSteps × secondsPerStep(bpm, stepsPerBeat) × 1000`. The existing `AudioAdapter.playTone` envelope handles the audible decay (attack + decay to silence). The consumer controls note length via `durationSteps`; the envelope shape is the AudioAdapter's domain.

### 4. Polyphony cap — no hard cap in v1
**No hard cap.** The consumer's `AudioAdapter` is the bottleneck (it creates oscillators per note). Document that dense patterns with many simultaneous notes will create many oscillators — the consumer should tune track volumes and note density to taste. A polyphony limiter is a v2 feature.

### 5. Pattern mutation (live-coding) — defer
**Defer to v2.** v1 loads a Pattern at `createSequencer` time. Runtime pattern replacement requires crossfade logic and complex state management. Non-breaking to add later (new method on `Sequencer`).

### 6. Web MIDI input — defer
**Defer.** Requires Web MIDI API, host-touching, out of scope for v1. The sequencer is output-only (generates audio from pattern data).

### 7. Serialization — JSON
**JSON.** `Pattern` is a tree of readonly primitives and plain objects — JSON-serializable by construction. Matches the library's save/load pattern (`JSON.parse`/`JSON.stringify`). Binary formats deferred.

### 8. Determinism boundary — confirmed 4-layer split
**Confirmed.** Layers 1–3 (theory, pattern, generator, advance) are pure — no `Math.random`, no `Date.now()`, no host access. `advanceSequencer(state, dt, pattern)` is the determinism seam: everything above is pure and Node-testable; everything below touches the host. Layer 4 (sequencer adapter) is host-touching — uses `audio.currentTime` + `setTimeout`. Audio output cannot leak back into the simulation. This mirrors the existing determinism carve-out in `docs/architecture.md` §5.

### 9. AudioAdapter reuse — confirmed
**Confirmed.** `createSequencer(audio: AudioAdapter, ...)` takes the existing AudioAdapter. It does NOT create a second AudioContext. The consumer calls `audio.unlock()` once; the sequencer reuses the unlocked context. Double-unlock is avoided by the AudioAdapter's idempotent `unlock()`.

---

## File Layout

```
src/music/
├── types.ts            # NoteEvent, Track, Pattern, PatternGenConfig, TrackGenConfig, SequencerConfig, SequencerState, NoteFire
├── theory.ts           # Layer 1 — noteToFrequency, buildScale, scaleDegree, secondsPerBeat, swingLongDuration, SCALES
├── pattern.ts          # Layer 2 — generatePattern (seeded, uses mulberry32 + theory)
├── advance.ts          # Layer 3 — advanceSequencer (pure state walker, NO host access)
├── sequencer.ts        # Layer 4 — createSequencer (host-touching, uses AudioAdapter + advanceSequencer)
├── constants.ts        # Tunables: DEFAULT_SWING, DEFAULT_BPM, DEFAULT_STEPS_PER_BEAT, DEFAULT_STEPS_PER_PATTERN, LOOKAHEAD_MS, SCHEDULE_AHEAD_S
├── index.ts            # Barrel export
└── tests/
    ├── theory.test.ts
    ├── pattern.test.ts
    ├── advance.test.ts
    └── sequencer.test.ts
```

**Module barrel (`src/music/index.ts`) re-exports:**
```ts
export { A4_MIDI, A4_FREQ, SCALES, noteToFrequency, frequencyToNote, buildScale, scaleDegree, secondsPerBeat, secondsPerStep, swingLongDuration } from './theory';
export type { NoteEvent, Track, Pattern, PatternGenConfig, TrackGenConfig } from './types';
export { generatePattern } from './pattern';
export type { SequencerState, NoteFire } from './types';
export { advanceSequencer } from './advance';
export type { Sequencer, SequencerConfig } from './types';
export { createSequencer } from './sequencer';
```

**Top-level barrel (`src/index.ts`) gains:**
```ts
export * from './music';
```

---

## API Surface Addition

New section in `docs/api-surface.md`:

```markdown
### `src/music/`

Procedural music: pure music-theory primitives, seeded pattern generator, and
a two-clock lookahead sequencer that reuses the existing `AudioAdapter`.

Four-layer architecture: Layer 1 (pure theory) → Layer 2 (pure pattern data + seeded generator) → Layer 3 (pure sequencer advance — the determinism seam) → Layer 4 (host-touching sequencer adapter). Layers 1–3 are fully deterministic and Node-testable. Layer 4 uses `audio.currentTime` for sample-accurate scheduling — the determinism carve-out for decorative audio output.

> Research: `docs/research/music-sequencer.md`.
> Proposal: `docs/design/music-sequencer-proposal.md`.

#### `src/music/theory.ts` — Pure music-theory primitives

| Export | Kind | Summary | Source |
|---|---|---|---|
| `A4_MIDI` | const | `69` — MIDI note number for A4 | `src/music/theory.ts` |
| `A4_FREQ` | const | `440` — reference frequency in Hz | `src/music/theory.ts` |
| `SCALES` | const | Canonical scale intervals (semitones from root): `major`, `minor`, `majorPentatonic`, `minorPentatonic`, `blues`, `dorian` | `src/music/theory.ts` |
| `noteToFrequency(midi, tuning?)` | function | MIDI note → frequency in Hz. Equal temperament. `tuning` defaults to `A4_FREQ` (440) | `src/music/theory.ts` |
| `frequencyToNote(freq)` | function | Frequency in Hz → MIDI note number (float) | `src/music/theory.ts` |
| `buildScale(rootMidi, intervals, octaves?)` | function | Build a scale as MIDI note numbers across `octaves` octaves (default 2) | `src/music/theory.ts` |
| `scaleDegree(scale, degree)` | function | Pick a scale degree (0-based, wraps, handles negatives) → MIDI note | `src/music/theory.ts` |
| `secondsPerBeat(bpm)` | function | BPM → seconds per quarter-note beat | `src/music/theory.ts` |
| `secondsPerStep(bpm, stepsPerBeat)` | function | BPM + subdivision → seconds per step | `src/music/theory.ts` |
| `swingLongDuration(pairDuration, swingRatio)` | function | Duration of the LONG half of a swing pair. `0.5` = straight, `0.66` = triplet | `src/music/theory.ts` |

#### `src/music/pattern.ts` — Seeded pattern generator

| Export | Kind | Summary | Source |
|---|---|---|---|
| `NoteEvent` | type | `{ midi, durationSteps?, peak?, waveform? }` — single note event (pure data, serializable) | `src/music/types.ts` |
| `Track` | type | `{ name, waveform, volume, sequence, patterns }` — one voice in a pattern | `src/music/types.ts` |
| `Pattern` | type | `{ bpm, stepsPerBeat, stepsPerPattern, scale?, tracks }` — complete song (serializable) | `src/music/types.ts` |
| `PatternGenConfig` | type | Seeded generator config: `rootMidi`, `scale`, `bpm`, `stepsPerBeat`, `stepsPerPattern`, `swing`, `tracks` | `src/music/types.ts` |
| `TrackGenConfig` | type | Per-track generation config: `name`, `waveform`, `volume`, `rhythm`, `degreeMin`, `degreeMax`, `noteDurationSteps` | `src/music/types.ts` |
| `generatePattern(seed, config?)` | function | Deterministically generate a Pattern from a 32-bit seed. Uses `mulberry32`. Same `(seed, config)` → same Pattern forever | `src/music/pattern.ts` |

#### `src/music/advance.ts` — Pure sequencer state + step walker

| Export | Kind | Summary | Source |
|---|---|---|---|
| `SequencerState` | type | `{ elapsedS, stepIndex, loopCount }` — pure playback state (all readonly) | `src/music/types.ts` |
| `NoteFire` | type | `{ midi, waveform, peak, gateS, whenOffset }` — fired note event (pure data) | `src/music/types.ts` |
| `advanceSequencer(state, dt, pattern)` | function | Pure: advance sequencer by `dt` seconds, return new state + any notes whose step boundary is crossed. No host access, no `Math.random`, fully Node-testable | `src/music/advance.ts` |

#### `src/music/sequencer.ts` — Two-clock lookahead sequencer (host-touching adapter)

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Sequencer` | type | `{ play, stop, isPlaying, setBpm, setVolume, getVolume, dispose }` — playback controls (defensive, never-throw) | `src/music/types.ts` |
| `SequencerConfig` | type | `{ lookaheadMs?, scheduleAheadS?, swing? }` — scheduler tuning (all optional with defaults) | `src/music/types.ts` |
| `createSequencer(audio, pattern, config?)` | function | Factory: create a sequencer that plays `pattern` via the existing `AudioAdapter`. Uses Chris Wilson's two-clock lookahead scheduler. Reuses `AudioAdapter` — no second AudioContext | `src/music/sequencer.ts` |

#### `src/music/constants.ts` — Named tunables

| Export | Kind | Summary | Source |
|---|---|---|---|
| `DEFAULT_SWING` | const | `0.5` — straight (no swing) | `src/music/constants.ts` |
| `DEFAULT_BPM` | const | `110` — default tempo | `src/music/constants.ts` |
| `DEFAULT_STEPS_PER_BEAT` | const | `4` — 16th notes | `src/music/constants.ts` |
| `DEFAULT_STEPS_PER_PATTERN` | const | `16` — one bar of 16th notes | `src/music/constants.ts` |
| `LOOKAHEAD_MS` | const | `25` — JS timer poll interval (ms) | `src/music/constants.ts` |
| `SCHEDULE_AHEAD_S` | const | `0.1` — pre-queue window (seconds) | `src/music/constants.ts` |
```
