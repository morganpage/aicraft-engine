/**
 * Type definitions for the procedural music / step-sequencer module.
 *
 * Pure data shapes (Layers 1–3) + the host-touching sequencer interface
 * (Layer 4). The four-layer split is documented in
 * `docs/design/music-sequencer-decision.md`:
 *
 *   1. `theory.ts`     — pure music-theory primitives (note↔freq, scales).
 *   2. `pattern.ts`    — pure seeded pattern generator (mulberry32 + theory).
 *   3. `advance.ts`    — pure sequencer state walker (the determinism seam).
 *   4. `sequencer.ts`  — host-touching adapter (reuses `AudioAdapter`).
 *
 * Layers 1–3 are pure: no host access, no `Math.random`, no `Date.now`,
 * no `setTimeout`. Layer 4 uses `audio.currentTime` + `setTimeout` — the
 * determinism carve-out for decorative audio output
 * (`docs/architecture.md` §5).
 *
 * @module
 */

/**
 * A single note event. Pure data, JSON-serializable.
 */
export interface NoteEvent {
  /** MIDI note number (0–127). `null` = rest (silent step). */
  readonly midi: number | null;
  /**
   * Gate duration in steps (BPM-independent data). Defaults to `1` (one step).
   * The adapter maps this to audible ms via
   * `durMs = durationSteps × secondsPerStep(bpm, stepsPerBeat) × 1000`.
   * The `AudioAdapter` envelope handles audible decay; envelope duration
   * equals the gate.
   */
  readonly durationSteps?: number;
  /** Peak gain `[0, 1]`. Defaults to the track volume. */
  readonly peak?: number;
  /** Oscillator waveform. Defaults to the track waveform. */
  readonly waveform?: OscillatorType;
}

/**
 * One voice in a pattern (bass, lead, drums, etc.).
 */
export interface Track {
  /** Track name (display only — not read by the player). */
  readonly name: string;
  /** Default oscillator waveform for notes on this track. */
  readonly waveform: OscillatorType;
  /** Default peak gain `[0, 1]` for notes on this track. */
  readonly volume: number;
  /**
   * Pattern indices: one per song step, referencing `patterns[]`. A length-1
   * sequence `[0]` repeats `patterns[0]` for the entire song. Wraps modulo
   * length when shorter than `stepsPerPattern`.
   */
  readonly sequence: readonly number[];
  /**
   * Reusable patterns. Each is a fixed-length array of `NoteEvent`s of length
   * `Pattern.stepsPerPattern`. The generator guarantees all patterns on every
   * track match `stepsPerPattern`; the sequencer trusts that contract.
   */
  readonly patterns: readonly (readonly NoteEvent[])[];
}

/**
 * A complete song: multiple tracks sharing a tempo + optional scale metadata.
 * JSON-serializable — embeddable in a `SkinPreset` as a music preset.
 */
export interface Pattern {
  /** BPM (quarter-note beats per minute). */
  readonly bpm: number;
  /** Steps per beat. `4` = 16th notes; `2` = 8th notes; `1` = quarter notes. */
  readonly stepsPerBeat: number;
  /** Total steps per pattern (typically 16). All tracks must match. */
  readonly stepsPerPattern: number;
  /** Optional scale metadata — used by the generator, ignored by the player. */
  readonly scale?: { readonly rootMidi: number; readonly intervals: readonly number[] };
  /** Tracks that play simultaneously. */
  readonly tracks: readonly Track[];
}

/**
 * Per-track generation config consumed by `generatePattern`. Each track gets
 * its own rhythm template and degree range; the generator picks notes from
 * the resolved scale via `scaleDegree` (never `pick` — decision §10).
 */
export interface TrackGenConfig {
  /** Track name (display only). */
  readonly name: string;
  /** Default oscillator waveform. */
  readonly waveform: OscillatorType;
  /** Default peak gain `[0, 1]`. */
  readonly volume: number;
  /** Hit/miss per step. Wraps modulo length when shorter than `stepsPerPattern`. */
  readonly rhythm: readonly boolean[];
  /** Minimum scale degree (0-based) this track will pick from. */
  readonly degreeMin: number;
  /** Maximum scale degree (0-based, inclusive) this track will pick from. */
  readonly degreeMax: number;
  /** Gate duration in steps for every generated note. Defaults to `1`. */
  readonly noteDurationSteps?: number;
}

/**
 * Seeded pattern generator config. Every field is optional with musical
 * defaults so `generatePattern(seed)` (no config) produces a complete usable
 * minor-pentatonic bass + melody loop.
 */
export interface PatternGenConfig {
  /** Root MIDI note. Defaults to `48` (C3 — bass range). */
  readonly rootMidi?: number;
  /** Scale intervals (semitones from root). Defaults to minor pentatonic. */
  readonly scale?: readonly number[];
  /** Tempo. Defaults to `110` BPM. */
  readonly bpm?: number;
  /** Subdivision. Defaults to `4` (16th notes). */
  readonly stepsPerBeat?: number;
  /** Pattern length. Defaults to `16`. */
  readonly stepsPerPattern?: number;
  /** Per-track configs. When omitted, ships default bass + melody tracks. */
  readonly tracks?: readonly TrackGenConfig[];
}

/**
 * Pure sequencer playback state. All fields are `readonly` — the consumer
 * owns the state object and receives a fresh one from `advanceSequencer`.
 */
export interface SequencerState {
  /** Elapsed time in seconds since playback started. */
  readonly elapsedS: number;
  /** Current step index within the pattern (0-based, wraps at `stepsPerPattern`). */
  readonly stepIndex: number;
  /** Number of times the pattern has looped. */
  readonly loopCount: number;
}

/**
 * A single note fired by the sequencer advance. Pure data — the host adapter
 * maps each event to an `audio.playTone(...)` call.
 */
export interface NoteFire {
  /** MIDI note number (0–127). Rests are filtered out before firing. */
  readonly midi: number;
  /** Oscillator waveform (resolved from note or track default). */
  readonly waveform: OscillatorType;
  /**
   * Peak gain `[0, 1]` (resolved from `note.peak ?? track.volume`). The host
   * adapter multiplies this by the music volume before calling `playTone`.
   */
  readonly peak: number;
  /**
   * Gate duration in seconds = `durationSteps × secondsPerStep(bpm,
   * stepsPerBeat)`. The host adapter passes `gateS × 1000` as `durMs` to
   * `audio.playTone`.
   */
  readonly gateS: number;
  /**
   * Offset in seconds from the start of the current advance window when this
   * note should fire. The host adapter adds this to its scheduling baseline.
   */
  readonly whenOffset: number;
}

/**
 * Optional advance-time config: carries the swing ratio so the pure advance
 * layer can apply swing without holding host state. Defaults to straight
 * (`DEFAULT_SWING = 0.5`).
 */
export interface AdvanceOptions {
  /** Swing ratio `[0.5, 0.75]`. `0.5` = straight, `0.66` = triplet. */
  readonly swing?: number;
}

/**
 * Sequencer playback controls. Defensive adapter — every method is a no-op
 * when audio is locked, disposed, or unavailable. Never throws.
 */
export interface Sequencer {
  /** Start (or restart) playback from step 0. Idempotent. */
  play(): void;
  /** Stop playback with a short fade-out. Idempotent. */
  stop(): void;
  /** Whether the sequencer is currently playing. */
  isPlaying(): boolean;
  /**
   * Set music volume `[0, 1]`. Independent of the `AudioAdapter`'s own SFX
   * volume. Mechanism: scales the `peak` argument of every subsequent
   * `audio.playTone(...)` call by the music-volume factor (pure
   * multiplication — no extra gain nodes, no second context).
   */
  setVolume(value: number): void;
  /** Current music volume `[0, 1]`. */
  getVolume(): number;
  /** Dispose: stop + clear the scheduler timer. Idempotent. */
  dispose(): void;
}

/** Defensive host adapter for externally advanced {@link NoteFire} events. */
export interface NoteFirePlayer {
  play(events: readonly NoteFire[]): void;
  setVolume(value: number): void;
  getVolume(): number;
  dispose(): void;
}

/**
 * Sequencer tuning. All optional with proven defaults from
 * Chris Wilson's "A Tale of Two Clocks".
 */
export interface SequencerConfig {
  /** Lookahead poll interval in ms. Default `25`. */
  readonly lookaheadMs?: number;
  /** How far ahead to pre-queue (seconds). Default `0.1`. */
  readonly scheduleAheadS?: number;
  /** Swing ratio `[0.5, 0.75]`. Default `0.5` (straight). */
  readonly swing?: number;
}
