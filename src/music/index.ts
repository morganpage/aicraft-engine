/**
 * Procedural music / step-sequencer module.
 *
 * Four-layer architecture (decision-locked,
 * `docs/design/music-sequencer-decision.md`):
 *
 *   1. **Pure music-theory primitives** (`theory.ts`) — note↔freq, scales,
 *      BPM, swing. Pure math, no state, no host. Mirrors `src/palette/`.
 *   2. **Pure seeded pattern generator** (`pattern.ts`) — `generatePattern`
 *      using `mulberry32` + theory. Same `(seed, config)` → same `Pattern`.
 *      Mirrors `generatePalette` / `generateSkinVariants`.
 *   3. **Pure sequencer advance** (`advance.ts`) — `advanceSequencer` is the
 *      determinism seam. Walks the pattern, fires notes, applies swing, all
 *      without touching the host. Mirrors `advanceEmission` / `advanceTween`.
 *   4. **Host-touching sequencer adapter** (`sequencer.ts`) —
 *      `createSequencer` reuses the consumer's `AudioAdapter` (no second
 *      `AudioContext`). Implements Chris Wilson's two-clock lookahead
 *      scheduler and consumes Layer 3's pure advance output.
 *
 * Layers 1–3 are fully deterministic and Node-testable. Layer 4 uses
 * `audio.currentTime` + `setTimeout` — the determinism carve-out for
 * decorative audio output (`docs/architecture.md` §5).
 *
 * @module
 */

export {
  A4_FREQ,
  A4_MIDI,
  SCALES,
  buildScale,
  frequencyToNote,
  noteToFrequency,
  scaleDegree,
  secondsPerBeat,
  secondsPerStep,
  swingLongDuration,
} from './theory';
export {
  DEFAULT_BPM,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_ROOT_MIDI,
  DEFAULT_SCALE_OCTAVES,
  DEFAULT_STEPS_PER_BEAT,
  DEFAULT_STEPS_PER_PATTERN,
  DEFAULT_SWING,
  LOOKAHEAD_MS,
  SCHEDULE_AHEAD_S,
} from './constants';
export { generatePattern } from './pattern';
export { advanceSequencer } from './advance';
export { createSequencer } from './sequencer';
export { createNoteFirePlayer } from './note-fire-player';
export type {
  NoteEvent,
  NoteFire,
  NoteFirePlayer,
  Pattern,
  PatternGenConfig,
  Sequencer,
  SequencerConfig,
  SequencerState,
  Track,
  TrackGenConfig,
} from './types';
