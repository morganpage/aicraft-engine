# Music Sequencer / Step Sequencer

> Research note for a procedural music / step-sequencer module. Slug: `music-sequencer`.
> Investigated: 2026-07-27.

## TL;DR

Music is the most algorithmic audio: a pattern is a deterministic, serializable description of "what note plays when," and a scheduler is the deterministic-to-wall-clock bridge that turns that description into sound. This note surveys (1) Chris Wilson's canonical **two-clock lookahead scheduler** (the only correct way to schedule WebAudio — `setTimeout` alone drifts, the game tick is wrong, but `audio.currentTime` + a 100 ms lookahead + a 25 ms JS poll is drift-free), (2) the **step-sequencer data model** as it appears in trackers (FastTracker II XM, Sonant, pl_synth), Tone.js `Sequence`/`Part`, and Sokpop's generative soundtracks (tracks × patterns × sequence-arrays), (3) **pure music-theory primitives** (MIDI ↔ Hz under equal temperament `f = 440·2^((n-69)/12)`, scale intervals as semitone arrays, chord builders), (4) **procedural pattern generation** (seeded scale + degree + rhythm → loop), (5) **BPM/timing math** (seconds-per-beat, step durations, swing as a long-short pair ratio), and (6) **fade-out / stop / mute** discipline (gain ramp before stop, master-gain independent of SFX). The top recommendation is a **three-layer split**: (a) a **pure deterministic core** (`noteToFrequency`, scale builders, pattern data shape, seeded pattern generator) that can live in a cosmetic manifest, (b) a **pure scheduler advance function** that walks the pattern and emits `(note, whenS)` events, and (c) a **host-touching sequencer adapter** that takes the pure scheduler output and calls `AudioAdapter.playTone(...)` at the right `audio.currentTime + lookahead` — reusing the existing `AudioAdapter` rather than creating a second `AudioContext`. The determinism carve-out is explicit: pattern data is pure (serializable, testable, swappable as a cosmetic), but the scheduler uses `audio.currentTime` (wall-clock) because audio output cannot leak back into the simulation. The library's "the algorithm IS the art" thesis extends naturally to music — a skin is a pattern preset.

## Why this matters for aicraft-engine

- **Pillars Touched**: Extends **Pillar 1 (Primitives / Audio)** from one-shot SFX to **continuous procedural music**, and pairs with **Pillar 2 (Cosmetics)** — a `SkinPreset` gains an optional `music` field that is itself a serializable pattern preset. This is the literal realization of the library's "the algorithm IS the art" thesis: music becomes a parameter preset, not an asset.
- **Consumer Games**: Spitekeep (idle/menu music, level themes, "chill" cosmetic soundtracks), future Clone-to-Jest titles (Stacklands-style card games want ambient music; Sokpop-style minimalist games want generative soundtracks that respond to gameplay). The Sokpop teardown explicitly lists "chill songs to drive around to" as a Sokpop feature (`passenger-seat`) — generative music is part of the minimalist-procedural canon.
- **Unlocks**:
  - **Asset-less music**: zero audio files, zero samples, zero licenses — every note is synthesized from the existing `AudioAdapter.playTone`/`playNoise` primitives. Matches the library's zero-runtime-dep, zero-asset ethos.
  - **Cosmetic soundtracks**: a `SkinPreset` can carry a `Pattern`; equipping a skin swaps the music. Same `mulberry32`-driven seed stability as palettes.
  - **Drift-free timing**: the two-clock scheduler pattern is the only correct way to do this in WebAudio. The library gets it right on the first try.
  - **Generative ambient music**: a seeded pattern generator can produce infinite, non-repeating-feeling loops from a small seed — Sokpop's "chill" soundtrack technique.

---

## Prior Art Survey

### Pattern 1: Chris Wilson's "A Tale of Two Clocks" Lookahead Scheduler

- **Source**: Chris Wilson, "A Tale of Two Clocks" (web.dev, 2013, still the canonical reference 13 years later); MDN "Advanced techniques: Creating and sequencing audio"; IRCAM Web Audio Tutorials "Timing and Scheduling"; Ableton `web-audio-sequencing` reference impl; `sebpiq/WAAClock` library; `sen-ltd/metronome` minimal reference impl.
- **What it does**: Schedules audio events against `AudioContext.currentTime` (the audio hardware clock, sample-accurate, ~15 decimal digits of precision), but polls with a cheap JS timer (`setTimeout`/`setInterval` at 25 ms) that looks ahead ~100 ms and pre-queues every event whose timestamp falls inside that window. The audio thread then plays each event at exactly the requested sample, regardless of how badly the JS main thread jitters.
- **Algorithmic shape** (canonical Chris Wilson metronome, condensed):

```typescript
// Two knobs — the only magic numbers in the whole subsystem.
const LOOKAHEAD_MS = 25;       // how often the JS timer wakes up
const SCHEDULE_AHEAD_S = 0.1;  // how far into the future we pre-queue

let nextNoteTime = audioCtx.currentTime;
let currentStep = 0;
let timerId: number | null = null;

function nextNote(): void {
  // secondsPerBeat = 60 / BPM; stepDuration = secondsPerBeat / stepsPerBeat
  nextNoteTime += STEP_DURATION_S;
  currentStep = (currentStep + 1) % STEPS_PER_PATTERN;
}

function scheduleNote(step: number, whenS: number): void {
  // Pull the note(s) for this step out of the pattern and call audio.playTone()
  // at audio.currentTime + whenS. The adapter handles the actual oscillator.
  const note = pattern[step];
  if (note !== null) {
    audio.playTone(note.waveform, note.frequency, note.frequency, note.durationMs, note.peak, whenS);
  }
}

function scheduler(): void {
  // While there are notes that will need to play before the next interval,
  // schedule them and advance the pointer.
  while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD_S) {
    scheduleNote(currentStep, nextNoteTime);
    nextNote();
  }
  timerId = setTimeout(scheduler, LOOKAHEAD_MS);
}
```

- **Determinism profile**: **Wall-clock.** The `while` loop compares `nextNoteTime` (a monotonically increasing audio-clock timestamp) against `audioCtx.currentTime` (the audio hardware clock). The JS timer is allowed to jitter — that's the whole point of the lookahead. This is the canonical case where the determinism carve-out in `docs/architecture.md` §5 ("Renderers may relax rules 2-4 only when the result cannot leak back into the simulation") applies: audio output is decorative, it cannot influence game state.
- **Runtime cost**: O(1) per scheduler tick. At 120 BPM with 16th-note steps, ~60% of polls find nothing to schedule (the `while` loop exits immediately). At 240 BPM with 32nd notes, multiple events may schedule per poll. Negligible CPU.
- **Dependencies**: None. Uses only `AudioContext.currentTime` and `setTimeout`.
- **Fit for our constraints**: **Strong — but only if we accept the determinism carve-out.** The pattern is the industry standard for WebAudio scheduling. The library's existing `AudioAdapter` already routes through `audio.currentTime` for `playTone(type, f0, f1, durMs, peak, whenS)` — the `whenS` parameter is exactly the lookahead offset this scheduler needs.
- **What to steal**: The two-knob design (`LOOKAHEAD_MS` + `SCHEDULE_AHEAD_S`). The `while (nextNoteTime < currentTime + lookahead)` loop. The `nextNoteTime` accumulator (never use `Date.now()` or `performance.now()` — always advance from the last scheduled time, so tempo changes don't accumulate drift). The `setTimeout` polling (NOT `setInterval` — `setInterval` can pile up if a callback overruns; `setTimeout` chains cleanly).
- **What to avoid**: Don't use `setInterval` (callback pile-up risk). Don't use `Date.now()` or `performance.now()` for scheduling (drifts relative to audio clock). Don't use the game's fixed-step tick for audio scheduling (the tick is 1/60 s = 16.7 ms; a missed tick drops a note). Don't use `requestAnimationFrame` as the only driver (RAF stops when the tab is backgrounded — the audio clock keeps running, so the scheduler falls behind and fires a burst of catch-up notes when the tab refocuses).

### Pattern 2: Step Sequencer Data Model (Trackers + Tone.js + pl_synth)

- **Source**: FastTracker II XM format spec (MilkyTracker, 1994, still the canonical tracker format); Sonant / js-sonant / Sonant-X / pl_synth (Jake Taylor → Marcus Geelnard → Nicolas Vanhoren → phoboslab); Tone.js `Sequence` + `Part` (Yotam Mann); IRCAM step-sequencer tutorial; Sokpop generative soundtracks (observed in `passenger-seat`, `sok-worlds`).
- **What it does**: A pattern is a 2D grid of `(step, track) → note`. A song is an ordered list of pattern indices per track. The same pattern can be reused across a song (drum loops), and a song chains patterns in sequence. Trackers (XM, Sonant) store this as a packed binary format; Tone.js stores it as nested arrays; Sokpop stores it as a JSON asset per track.
- **Algorithmic shape** (the shape that fits our library — derived from Sonant/pl_synth + Tone.js `Sequence`):

```typescript
// A single note event — the smallest unit of music data. Pure data, serializable.
export interface NoteEvent {
  /** MIDI note number (0-127). null = rest. */
  midi: number | null;
  /** Duration in milliseconds. Defaults to one step if omitted. */
  durationMs?: number;
  /** Peak gain [0, 1]. Defaults to track volume. */
  peak?: number;
  /** Oscillator waveform. Defaults to track waveform. */
  waveform?: OscillatorType;
}

/** A single track (one "voice" — bass, lead, drums, etc.). */
export interface Track {
  /** Track name (display only). */
  name: string;
  /** Default oscillator waveform for this track. */
  waveform: OscillatorType;
  /** Default peak gain [0, 1] for notes on this track. */
  volume: number;
  /** Pattern index into `Track.patterns[]` for each step of the song. */
  sequence: number[];
  /** Reusable patterns. Each is a fixed-length array of NoteEvents. */
  patterns: NoteEvent[][];
}

/** A complete song — multiple tracks sharing a tempo + scale. */
export interface Pattern {
  /** BPM (beats per minute). Quarter-note beats. */
  bpm: number;
  /** Steps per beat. 4 = 16th notes; 2 = 8th notes; 1 = quarter notes. */
  stepsPerBeat: number;
  /** Total steps per pattern (typically 16). Patterns must all match. */
  stepsPerPattern: number;
  /** Optional key/scale — used by the seeded generator, ignored by the player. */
  scale?: { rootMidi: number; intervals: readonly number[] };
  /** Tracks that play simultaneously. */
  tracks: Track[];
}
```

- **Determinism profile**: **Pure.** The `Pattern` is a tree of plain numbers, strings, arrays, and `null`. No functions, no `Date.now()`, no `Math.random()`. JSON-serializable. Same `Pattern` → same music forever, on every JS engine. This is what makes it suitable for embedding in a `SkinPreset`.
- **Runtime cost**: O(steps × tracks) per pattern evaluation. For a 16-step, 4-track pattern, that's 64 note lookups per loop — negligible.
- **Dependencies**: None. Pure data.
- **Fit for our constraints**: **Strong.** Mirrors the `SkinPreset` shape from `src/cosmetics/types.ts` (id, name, rarity, palette, scale, features, gait, particles). A `SkinPreset` gains an optional `music?: Pattern` field. Same `mulberry32`-driven variant generation as palettes.
- **What to steal**: The **track × pattern × sequence** three-layer split from Sonant/pl_synth — it lets a drum loop repeat independently of the melody. The **fixed pattern length** constraint (all patterns in a song must be the same length) — prevents runtime length-mismatch bugs. The **sequence-as-array-of-indices** representation — compact, supports reuse, supports runtime mutation.
- **What to avoid**: Don't ship the full XM format (32 channels, 256 patterns, volume envelopes, vibrato, portamento, ADPCM compression — overkill for our scope). Don't use Tone.js's nested-array notation (`["C4", ["E4", "D4", "E4"], "G4"]` — elegant for the player, hostile to JSON serialization and to a typed `NoteEvent[]` shape). Don't use the XM "note + instrument + volume + effect + parameter" 5-byte packed format — too low-level for our needs.

### Pattern 3: Pure Music Theory Primitives (MIDI ↔ Hz, Scales, Chords)

- **Source**: tonaljs/tonal (Danigb & contributors, MIT — the canonical TS music-theory library); `@tonaljs/midi` (`midiToFreq(midi) = 2^((midi-69)/12) * 440`); octavian (Steve Kinney, branded types); kamasi (zero-dep TS); bunny (emotionl); MDN Web Audio API; standard equal-temperament formula `f = 440·2^((n-69)/12)`.
- **What it does**: Converts MIDI note numbers (0-127, integer) to frequencies in Hz under 12-tone equal temperament with A4 = 440 Hz reference. Builds scales as semitone-offset arrays from a root. Builds chords as simultaneous scale-degree stacks. All pure functions of integers.
- **Algorithmic shape** (the minimum viable theory module — derived from tonaljs/midi + octavian + the demoscene "tracker scale" convention):

```typescript
/** A4 = MIDI 69 = 440 Hz. The universal reference pitch. */
export const A4_MIDI = 69;
export const A4_FREQ = 440;

/** MIDI note number → frequency in Hz. Pure. Equal temperament. */
export function noteToFrequency(midi: number, tuning = A4_FREQ): number {
  return tuning * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** Frequency in Hz → MIDI note number (rounded to nearest 2 decimals). */
export function frequencyToNote(freq: number): number {
  const v = (12 * (Math.log(freq) - Math.log(A4_FREQ))) / Math.log(2) + A4_MIDI;
  return Math.round(v * 100) / 100;
}

/** Canonical scale intervals (semitones from root). */
export const SCALES = {
  major:           [0, 2, 4, 5, 7, 9, 11],
  minor:           [0, 2, 3, 5, 7, 8, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues:           [0, 3, 5, 6, 7, 10],
  dorian:          [0, 2, 3, 5, 7, 9, 10],
} as const;

/** Build a scale as MIDI note numbers within an octave range. */
export function buildScale(rootMidi: number, intervals: readonly number[], octaves = 2): number[] {
  const out: number[] = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (const semi of intervals) {
      out.push(rootMidi + semi + 12 * oct);
    }
  }
  return out;
}

/** Pick a scale degree (0-based) → MIDI note. Pure. */
export function scaleDegree(scale: readonly number[], degree: number): number {
  const n = scale.length;
  const i = ((degree % n) + n) % n;
  return scale[i];
}
```

- **Determinism profile**: **Pure.** All functions are integer math + `Math.pow`/`Math.log`. No `Math.random`, no `Date.now()`, no global state. Same inputs → same outputs forever, on every JS engine. This is the same determinism profile as `src/palette/generate.ts`.
- **Runtime cost**: O(1) per call. `Math.pow` is the most expensive op (~3 ns).
- **Dependencies**: None. Only `Math.pow` and `Math.log` from the standard library.
- **Fit for our constraints**: **Strong.** This is exactly the same shape as our existing `src/palette/` module — pure functions, integer math, no deps. A `Pattern` can carry `{ rootMidi, intervals }` and the seeded generator can use `scaleDegree` to pick notes.
- **What to steal**: The `noteToFrequency(midi, tuning = 440)` signature from `@tonaljs/midi` — the `tuning` parameter lets consumers support non-standard concert pitch (432 Hz, baroque 415 Hz) without changing the formula. The `SCALES` constant-as-object pattern — type-safe, tree-shakeable, no `Map` allocation. The `scaleDegree(scale, degree)` modular-arithmetic helper — handles negative degrees (`-1` = "one below the root") and out-of-range degrees gracefully.
- **What to avoid**: Don't ship a full music-theory library (chord detection, key signatures, roman numerals, ABC notation parsing — overkill). Don't use branded types (`MidiKey`, `Frequency`) — adds ceremony without value at our scale. Don't include enharmonic spelling (`C#` vs `Db`) — we operate on MIDI integers, not note names. Don't include `setInterval`/`setTimeout`/audio scheduling in the theory module — pure data only.

### Pattern 4: Procedural / Generative Music (Sokpop + Sonant + JS13k)

- **Source**: Sokpop `passenger-seat` (6 chill songs, generative); Sokpop `sok-worlds` (8 soundtracks); Sonant Live / Sonant-X Live (tracker + player for 4K intros); phoboslab `pl_synth` (the modern reference — 8 tracks, 10 patterns per track, 32 rows per pattern, sequence array); JS13k winners using Soundbox / ZzFX / ZzFXM (Dante 2022, Underrun 2018, Island Not Found 2020); 2021: a Space Opera (JS13k 2021 — piano-key → frequency mapping for puzzle music).
- **What it does**: Generates a complete loop from a small seed. The pattern is built by (1) choosing a scale, (2) picking notes from the scale at random (or by a Markov chain), (3) choosing a rhythm template (e.g. "drums on 1, 5, 9, 13; bass on 1, 9; melody on odd steps"), (4) repeating the pattern with variation. The result is a `Pattern` data structure that can be played by the same scheduler as a hand-authored pattern.
- **Algorithmic shape** (seeded pattern generator — derived from Sonant's "8 tracks × 10 patterns × 32 rows" + Sokpop's "chill generative" aesthetic):

```typescript
import { mulberry32, nextInt, pick } from '../rng/mulberry32';
import { buildScale, scaleDegree } from './theory';
import type { Pattern, Track, NoteEvent } from './types';

/**
 * Deterministically generate a Pattern from a seed + scale + rhythm template.
 * Same (seed, config) → same Pattern forever, on every JS engine.
 *
 * The generator picks notes from the scale using the PRNG, places them on
 * steps according to a rhythm template, and assigns a waveform per track.
 * The result is a fully-serializable Pattern — embeddable in a SkinPreset.
 */
export function generatePattern(seed: number, config: PatternGenConfig): Pattern {
  const rng = mulberry32(seed >>> 0);
  const scale = buildScale(config.rootMidi, config.scale, 2);  // 2 octaves

  // Fixed draw order — do not reorder; it would change every golden value.
  const tracks: Track[] = config.tracks.map((trackCfg, trackIdx) => {
    const pattern: NoteEvent[] = [];
    for (let step = 0; step < config.stepsPerPattern; step++) {
      const isHit = trackCfg.rhythm[step % trackCfg.rhythm.length];
      if (!isHit) {
        pattern.push({ midi: null });  // rest
        continue;
      }
      // Pick a scale degree. Bass tracks stay low; melody tracks roam.
      const degree = nextInt(rng, trackCfg.degreeMin, trackCfg.degreeMax);
      const midi = scaleDegree(scale, degree);
      pattern.push({
        midi,
        durationMs: trackCfg.noteDurationMs,
        waveform: trackCfg.waveform,
        peak: trackCfg.volume,
      });
    }
    return {
      name: trackCfg.name,
      waveform: trackCfg.waveform,
      volume: trackCfg.volume,
      // Sequence: repeat this single pattern for the whole song.
      sequence: [0],
      patterns: [pattern],
    };
  });

  return {
    bpm: config.bpm,
    stepsPerBeat: config.stepsPerBeat,
    stepsPerPattern: config.stepsPerPattern,
    scale: { rootMidi: config.rootMidi, intervals: config.scale },
    tracks,
  };
}
```

- **Determinism profile**: **Pure.** Uses `mulberry32` exclusively. Same `(seed, config)` → same `Pattern` forever. This is the same determinism profile as `src/palette/generate.ts` and `src/cosmetics/generate.ts`.
- **Runtime cost**: O(steps × tracks). For a 16-step, 4-track pattern, ~64 RNG draws + 64 array pushes. Negligible. One-time cost at skin load.
- **Dependencies**: None. Uses our existing `src/rng/mulberry32.ts` and the pure theory module.
- **Fit for our constraints**: **Strong.** Mirrors the existing `generatePalette` and `generateSkinVariants` patterns exactly. A `SkinPreset` can carry either a hand-authored `Pattern` OR a `(seed, PatternGenConfig)` pair that the consumer resolves at load time.
- **What to steal**: The **rhythm template** pattern (a small array of booleans that says "hit on these steps") — this is how trackers and demoscene tools encode drum patterns. The **per-track degree range** (`degreeMin`/`degreeMax`) — bass tracks stay in the low octave, melody tracks roam. The **scale-aware note picking** — never pick a note outside the scale (preserves musicality).
- **What to avoid**: Don't use `Math.random()` (breaks determinism). Don't use Markov chains or LSTM-generated melodies (overkill, non-deterministic, hard to test). Don't generate the audio samples themselves (that's Sonant's job — we generate the pattern data and let the existing `AudioAdapter` synthesize). Don't ship a full tracker UI (the library is a math/data library, not an editor).

### Pattern 5: BPM & Timing Math (with Swing)

- **Source**: Chris Wilson metronome (`secondsPerBeat = 60 / tempo`); Zoe Blade "Swing" notebook (the canonical swing reference — 50% straight, 66% triplet, 5 useful amounts at 4% increments); SuperCollider `Pattern Guide Cookbook 08: Swing` (the `swingify` pattern — delay weak-position notes by `base_value * swing_amount`); Csound Journal "Swing" article (swing as a long-short pair ratio, tempo-dependent).
- **What it does**: Converts BPM to seconds-per-beat, then to seconds-per-step for the chosen subdivision. Swing modifies the long-short ratio of each pair of steps (50% straight, 66% triplet, anything in between). All pure integer/float math.
- **Algorithmic shape**:

```typescript
/** BPM → seconds per beat. Pure. */
export function secondsPerBeat(bpm: number): number {
  return 60 / bpm;
}

/** BPM + subdivision → seconds per step. Pure. */
export function secondsPerStep(bpm: number, stepsPerBeat: number): number {
  return secondsPerBeat(bpm) / stepsPerBeat;
}

/**
 * Swing: returns the duration of the LONG half of a pair, given a swing
 * ratio in [0.5, 0.75]. 0.5 = straight (50/50), 0.66 = triplet (2/3 + 1/3),
 * 0.75 = hard swing (3/4 + 1/4). Pure.
 *
 * The SHORT half is `pairDuration - longDuration`.
 */
export function swingLongDuration(pairDuration: number, swingRatio: number): number {
  const r = Math.max(0.5, Math.min(0.75, swingRatio));
  return pairDuration * r;
}
```

- **Determinism profile**: **Pure.** Pure arithmetic. Same `(bpm, stepsPerBeat)` → same `secondsPerStep` forever.
- **Runtime cost**: O(1) per call.
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** These are the same kind of pure helpers as `src/primitives/pixel.ts` (`lerp`, `clamp`, `approach`). Pure math, no deps, no state.
- **What to steal**: The **straight 50/50 → triplet 66%** range for swing (Zoe Blade's empirical finding — anything outside this range sounds broken). The **per-pair ratio** model (simpler than per-step offsets — applies to every pair uniformly). The **`secondsPerBeat = 60 / bpm`** formula (universal — every DAW, every tracker, every music library uses this).
- **What to avoid**: Don't use the SuperCollider `swingify` pattern's full event-stream rewriting (overkill for a step sequencer — we know in advance which steps are "weak" positions). Don't support micro-timing swing (sub-millisecond humanization) — that's a different feature (groove templates, not swing). Don't use a `setInterval`/`setTimeout` for timing math — this is pure math, runs once at pattern-load time.

### Pattern 6: Loop Scheduling, Stop, Mute, Fade-Out

- **Source**: Chris Wilson metronome (the `setTimeout` chain + `clearTimeout` for stop); MDN `AudioParam.linearRampToValueAtTime` / `setTargetAtTime` (the canonical fade-out API); StackOverflow "Web Audio API clicking sound when stopping oscillator" (the canonical "always ramp gain before stop" pattern); the existing `src/audio/factory.ts` (`MASTER_RAMP_TC = 0.015` for master-gain mute ramp; `STOP_TAIL_S = 0.02` for envelope tail).
- **What it does**: A loop is a scheduler that wraps back to step 0 when it reaches the end of the pattern. Stop is idempotent — calling it twice is a no-op. Mute ramps the master gain to 0 over a short time constant (no clicks). Fade-out before stop prevents the audible click that happens when an oscillator is stopped mid-cycle.
- **Algorithmic shape** (the sequencer adapter — host-touching layer, reuses `AudioAdapter`):

```typescript
import type { AudioAdapter } from '../audio/types';
import type { Pattern } from './types';
import { secondsPerStep } from './timing';

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.1;
const FADE_OUT_S = 0.05;  // short fade-out to avoid clicks on stop

export interface Sequencer {
  /** Start (or restart) playback. Idempotent. */
  start(): void;
  /** Stop playback with a short fade-out. Idempotent. */
  stop(): void;
  /** True if currently playing. */
  isPlaying(): boolean;
  /** Set BPM. Takes effect on the next scheduled step. */
  setBpm(bpm: number): void;
  /** Dispose: stop + release timer. Idempotent. */
  dispose(): void;
}

export function createSequencer(audio: AudioAdapter, pattern: Pattern): Sequencer {
  // ... (lazy audio.currentTime resolution, scheduler loop, etc.)
  // The scheduler walks the pattern, looks up the note for each step,
  // and calls audio.playTone(note.waveform, freq, freq, durMs, peak, whenS)
  // where whenS = nextNoteTime - audio.currentTime.
}
```

- **Determinism profile**: **Host-touching / wall-clock.** Uses `audio.currentTime` and `setTimeout`. Cannot be replay-deterministic. This is the determinism carve-out — the sequencer's output is audio, which cannot leak back into the simulation.
- **Runtime cost**: O(1) per scheduler tick. Same as Chris Wilson's metronome.
- **Dependencies**: None directly. **Reuses the existing `AudioAdapter`** — does NOT create its own `AudioContext`. This is critical: creating a second `AudioContext` would require a second user gesture to unlock, would double the audio resource cost, and would prevent shared mute/volume state.
- **Fit for our constraints**: **Strong — but only if we reuse `AudioAdapter`.** The existing `AudioAdapter.playTone(type, f0, f1, durMs, peak, whenS)` already supports scheduled playback (the `whenS` parameter is exactly the lookahead offset). The sequencer is a thin wrapper that walks the pattern and calls `playTone` at the right time.
- **What to steal**: The **`whenS` parameter** from `AudioAdapter.playTone` — the sequencer just needs to compute `whenS = nextNoteTime - audio.currentTime` and pass it through. The **`MASTER_RAMP_TC = 0.015`** mute-ramp time constant from `src/audio/factory.ts` — proven click-free. The **`STOP_TAIL_S = 0.02`** envelope tail — proven click-free on oscillator stop. The **`setTimeout` chain** (not `setInterval`) — avoids callback pile-up.
- **What to avoid**: Don't create a second `AudioContext` (double-unlock, double resource cost, breaks shared mute/volume). Don't use `setInterval` for the scheduler (callback pile-up). Don't stop oscillators without a fade-out (audible click). Don't make the sequencer a "god object" that owns the audio context — it borrows the `AudioAdapter` and respects its mute/volume state.

---

## Reference Implementations

| Source | What it teaches | URL |
|---|---|---|
| **Chris Wilson "A Tale of Two Clocks"** | The canonical two-clock lookahead scheduler. The article every WebAudio developer reads first. | https://web.dev/articles/audio-scheduling |
| **MDN "Advanced techniques: Creating and sequencing audio"** | Stripped-down version of Chris Wilson's pattern with a 4-track step sequencer. The closest reference to our use case. | https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques |
| **IRCAM "Building a step sequencer"** | `TrackEngine` class wrapping one track of a score; `Scheduler` with priority queue. Clean separation of pattern data from playback. | https://ircam-ismm.github.io/webaudio-tutorials/scheduling/step-sequencer.html |
| **Ableton `web-audio-sequencing`** | Reference impl of lookahead scheduling with `LeadingEdge`/`TrailingEdge` scheduling window. The most rigorous treatment of the "scheduling window" concept. | https://github.com/Ableton/web-audio-sequencing |
| **phoboslab `pl_synth`** | Modern tracker format: 8 tracks × N patterns × 32 rows × sequence array. The cleanest data model for a step sequencer. | https://phoboslab.org/log/2025/01/synth |
| **Sonant / Sonant-X** | The original 4K-intro tracker. 8 channels, 10 patterns per channel, 32 slots per pattern. Proves the format works at extreme size constraints. | https://github.com/mbitsnbites/js-sonant |
| **Tone.js `Sequence`** | JS event-array notation with subdivision. Shows the "events spaced at subdivision" pattern. | https://tonejs.github.io/docs/15.1.22/classes/Sequence.html |
| **`@tonaljs/midi`** | The canonical `midiToFreq(midi, tuning = 440) = 2^((midi-69)/12) * 440` formula. MIT-licensed reference impl. | https://github.com/tonaljs/tonal/blob/main/packages/midi/index.ts |
| **Zoe Blade "Swing" notebook** | The canonical swing reference. 50% straight, 66% triplet, 5 useful amounts at 4% increments. | https://notebook.zoeblade.com/Swing.html |
| **`sen-ltd/metronome`** | Minimal reference impl of Chris Wilson's pattern with a fake `AudioContext` for testing. Shows how to test the scheduler deterministically. | https://github.com/sen-ltd/metronome |
| **`src/audio/factory.ts`** | Our existing `AudioAdapter`. The `playTone(type, f0, f1, durMs, peak, whenS)` signature is exactly what the sequencer needs. | `src/audio/factory.ts` |
| **`src/palette/generate.ts`** | The seeded-generation pattern we mirror for `generatePattern`. Same `mulberry32` + fixed-draw-order + JSON-serializable output. | `src/palette/generate.ts` |
| **`src/cosmetics/generate.ts`** | The skin-variant generation pattern. Shows how to embed a generated value into a `SkinPreset`. | `src/cosmetics/generate.ts` |

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Chris Wilson scheduling diagram | The "two clocks" visualization: JS timer ticks, audio clock advances continuously, lookahead window overlaps between ticks | https://web.dev/articles/audio-scheduling |
| Ableton scheduling window diagram | The `LeadingEdge`/`TrailingEdge` scheduling window for loop unrolling | https://github.com/Ableton/web-audio-sequencing |
| Zoe Blade swing table | The 5 useful swing amounts (50%, 54%, 58%, 62%, 66%) with terminology and clock-pulse counts | https://notebook.zoeblade.com/Swing.html |
| pl_synth tracker UI | The 8-track × N-pattern × 32-row layout that our `Pattern` data model mirrors | https://phoboslab.org/log/2025/01/synth |
| Sokpop `passenger-seat` | "6 chill songs to drive around to" — generative ambient music in a Sokpop game | https://sokpop.itch.io/passenger-seat |

---

## Determinism Carve-Out: The Boundary Line

This is the single most important design decision for the music module. The library's determinism rules in `docs/architecture.md` §5 say:

> Renderers may relax rules 2-4 only when the result cannot leak back into the simulation.

For music, the boundary is:

| Layer | Determinism | Why |
|---|---|---|
| **`Pattern` data** (notes, BPM, scale, tracks, sequences) | **Pure / serializable** | This is the cosmetic surface. It must be embeddable in a `SkinPreset`, must produce the same music on every machine, must be JSON-serializable for save data. Same `(seed, config)` → same `Pattern` forever. |
| **Music theory primitives** (`noteToFrequency`, `buildScale`, `scaleDegree`, `secondsPerBeat`) | **Pure** | Integer math + `Math.pow`/`Math.log`. No state, no time, no RNG. Same inputs → same outputs forever. |
| **Seeded pattern generator** (`generatePattern`) | **Pure** | Uses `mulberry32` exclusively. Same `(seed, config)` → same `Pattern` forever. Mirrors `generatePalette` exactly. |
| **Scheduler advance function** (`advanceSequencer` — pure walk of the pattern) | **Pure** | Takes `(state, dt, pattern)` → returns `(nextState, events[])`. The `events[]` is a list of `(midi, whenS)` pairs. Consumer applies them to the audio adapter. |
| **Sequencer adapter** (`createSequencer` — the host-touching layer) | **Wall-clock** | Uses `audio.currentTime` + `setTimeout`. This is the determinism carve-out. Audio output cannot leak back into the simulation. |

**The boundary line**: everything ABOVE the scheduler advance function is pure and serializable. The scheduler advance function is pure but its output is a list of `(midi, whenS)` events that the consumer applies to the audio adapter at wall-clock time. The sequencer adapter is the only layer that touches the host.

This mirrors the existing `src/particles/` split: `Particle` data + `advance(particles, dt, opts)` are pure; `stepEmitters(emitters, dt, opts)` is pure; the renderer that draws the particles is renderer-adjacent. Music follows the same pattern: `Pattern` + `advanceSequencer` are pure; the sequencer adapter that schedules audio is renderer-adjacent.

---

## Recommended v1 Shape

### Pattern Data Shape (pure, serializable)

```typescript
export interface NoteEvent {
  midi: number | null;        // null = rest
  durationMs?: number;        // default = one step
  peak?: number;              // default = track volume
  waveform?: OscillatorType;  // default = track waveform
}

export interface Track {
  name: string;
  waveform: OscillatorType;
  volume: number;             // [0, 1]
  sequence: number[];         // pattern indices, one per song step
  patterns: NoteEvent[][];    // reusable patterns, each = stepsPerPattern entries
}

export interface Pattern {
  bpm: number;
  stepsPerBeat: number;       // 4 = 16th notes
  stepsPerPattern: number;    // typically 16
  scale?: { rootMidi: number; intervals: readonly number[] };
  tracks: Track[];
}
```

### Pure Theory Module API

```typescript
export const A4_MIDI = 69;
export const A4_FREQ = 440;
export const SCALES = { major: [...], minor: [...], majorPentatonic: [...], ... } as const;

export function noteToFrequency(midi: number, tuning?: number): number;
export function frequencyToNote(freq: number): number;
export function buildScale(rootMidi: number, intervals: readonly number[], octaves?: number): number[];
export function scaleDegree(scale: readonly number[], degree: number): number;
export function secondsPerBeat(bpm: number): number;
export function secondsPerStep(bpm: number, stepsPerBeat: number): number;
export function swingLongDuration(pairDuration: number, swingRatio: number): number;
```

### Adapter API (reuses `AudioAdapter`)

```typescript
export interface Sequencer {
  start(): void;
  stop(): void;
  isPlaying(): boolean;
  setBpm(bpm: number): void;
  dispose(): void;
}

export function createSequencer(audio: AudioAdapter, pattern: Pattern): Sequencer;
```

### v1 Scope: Seeded Pattern Generator OR Consumer-Supplied Patterns?

**Recommendation: Ship BOTH.** The seeded generator is a pure function that produces a `Pattern` — the consumer can either use it directly (`generatePattern(seed, config)`) or hand-author a `Pattern` and pass it to `createSequencer`. This mirrors how `generatePalette` works: the consumer can either call `generatePalette(seed)` for a seeded palette or supply a hand-authored `Palette` object.

The seeded generator is the v1 "chill ambient music" path — a Sokpop-style generative soundtrack from a single seed. The hand-authored path is the v1 "level theme" path — a designer-authored pattern that ships with the game.

---

## Open Questions

1. **Pattern length constraint enforcement**: Should `createSequencer` validate that all tracks' patterns have the same length? Or should it pad/clip at runtime? Validation is safer; padding is more forgiving. Flag for `@api-designer`.
2. **Swing as a per-track or per-song parameter**: Swing is typically a song-level feel, but some genres (jazz) want per-track swing. v1 should ship song-level swing; per-track swing is a v2 extension. Flag for `@api-designer`.
3. **Note-off / note duration**: Should `NoteEvent.durationMs` be the note's audible duration (envelope decay) or the gap until the next note (gate time)? Tracker convention is gate time. Flag for `@api-designer`.
4. **Polyphony limit**: Should the sequencer cap simultaneous voices (e.g. max 8 notes at once)? The existing `AudioAdapter` already routes everything through a single master gain, so there's no per-voice gain summing issue — but a polyphony cap prevents voice explosion on dense patterns. Flag for `@api-designer`.
5. **Pattern mutation API**: Should the consumer be able to mutate a playing pattern at runtime (live-coding style)? v1 should NOT ship this (out of scope). The pattern is loaded once at `createSequencer` time. Flag for `@coder`.
6. **MIDI input**: Should the sequencer accept MIDI input from a MIDI keyboard? Out of scope for v1 (requires Web MIDI API, host-touching). Flag for `@coder`.
7. **Pattern serialization format**: Should `Pattern` serialize to JSON for save data, or to a more compact binary format (Sonant's `.snt`)? JSON is simpler and matches the rest of the library. Flag for `@api-designer`.

---

## Top 3 Patterns Worth Prototyping

1. **Pure music-theory module (`noteToFrequency`, `buildScale`, `scaleDegree`, `secondsPerBeat`, `swingLongDuration`)** — The foundation everything else builds on. Pure functions, zero deps, zero state, fully testable. Mirrors `src/palette/` exactly. This is the "the algorithm IS the art" thesis applied to music: a scale is a parameter preset, a frequency is a pure function of a MIDI number.

2. **`Pattern` data shape + seeded `generatePattern`** — The serializable, cosmetic-embeddable music surface. A `SkinPreset` gains an optional `music: Pattern` field. The seeded generator produces infinite, non-repeating-feeling loops from a single seed — Sokpop's "chill generative soundtrack" technique. Mirrors `src/cosmetics/generate.ts` exactly.

3. **Sequencer adapter (`createSequencer`) that reuses `AudioAdapter`** — The host-touching layer that turns a `Pattern` into sound. Uses Chris Wilson's two-clock lookahead scheduler (the only correct way). Reuses the existing `AudioAdapter.playTone(type, f0, f1, durMs, peak, whenS)` — does NOT create a second `AudioContext`. The `whenS` parameter is exactly the lookahead offset the scheduler needs. This is the thinnest possible wrapper — the pattern data does the heavy lifting, the scheduler just walks it.

---

## Cross-References

- `docs/architecture.md` — §5 "Renderers may relax rules 2-4 only when the result cannot leak back into the simulation" — the determinism carve-out that justifies `audio.currentTime` in the sequencer adapter
- `docs/conventions.md` — Pure progression ops, no magic numbers, JSDoc requirements, factory-function naming
- `src/audio/factory.ts` — The existing `AudioAdapter` that the sequencer REUSES (does not replace). The `playTone(type, f0, f1, durMs, peak, whenS)` signature is exactly what the scheduler needs. The `MASTER_RAMP_TC = 0.015` and `STOP_TAIL_S = 0.02` constants are the proven click-free mute/stop values.
- `src/audio/types.ts` — The `AudioAdapter` interface contract
- `src/palette/generate.ts` — The seeded-generation pattern that `generatePattern` mirrors (same `mulberry32` + fixed-draw-order + JSON-serializable output)
- `src/cosmetics/generate.ts` — The skin-variant generation pattern that shows how to embed a generated value into a `SkinPreset`
- `src/cosmetics/types.ts` — The `SkinPreset` shape that gains an optional `music: Pattern` field
- `src/rng/mulberry32.ts` — The seeded PRNG used by `generatePattern`
- `src/particles/` — The pure-core / renderer-adjacent split that the music module mirrors
- `src/easing/` — The pure-function + stateless-advance pattern that `advanceSequencer` mirrors
- `ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md` — Sokpop's "chill generative soundtrack" pattern (6 songs in `passenger-seat`, 8 soundtracks in `sok-worlds`)
- `docs/research/easing-tween.md` — The pure-function + stateless-advance pattern (the closest existing research note in shape)
- `docs/research/algorithmic-skin-variation.md` — The cosmetic-embeddable pattern generation that music extends
- `docs/research/particle-emitters.md` — The pure-core / renderer-adjacent split that music mirrors
