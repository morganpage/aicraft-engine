/**
 * Pure seeded pattern generator (Layer 2).
 *
 * Deterministically produces a complete {@link Pattern} from a 32-bit seed +
 * optional config. Same `(seed, config)` → same {@link Pattern} forever, on
 * every JS engine. Mirrors `generatePalette` / `generateSkinVariants`.
 *
 * Determinism discipline:
 *   - Uses `mulberry32` exclusively (never `Math.random`).
 *   - Fixed RNG draw order — reordering would change every golden value.
 *   - Output is JSON-serializable plain data.
 *
 * `pick` guard (decision §10): this generator MUST NOT call `pick(rng, arr)`
 * on a potentially-empty array — `pick` throws on empty arrays
 * (`src/rng/mulberry32.ts`). All note selection goes through `scaleDegree`,
 * which wraps gracefully and never throws, so the generator is safe for any
 * seed and any config.
 *
 * @module
 */

import { mulberry32, nextInt } from '../rng/mulberry32';
import {
  DEFAULT_BPM,
  DEFAULT_ROOT_MIDI,
  DEFAULT_SCALE_OCTAVES,
  DEFAULT_STEPS_PER_BEAT,
  DEFAULT_STEPS_PER_PATTERN,
} from './constants';
import { SCALES, buildScale, scaleDegree } from './theory';
import type {
  NoteEvent,
  Pattern,
  PatternGenConfig,
  Track,
  TrackGenConfig,
} from './types';

/**
 * Default bass track config — used when `PatternGenConfig.tracks` is omitted.
 * Root-range minor-pentatonic, sparse rhythm, sawtooth bass.
 */
const DEFAULT_BASS: TrackGenConfig = {
  name: 'bass',
  waveform: 'sawtooth',
  volume: 0.25,
  rhythm: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
  degreeMin: 0,
  degreeMax: 4,
  noteDurationSteps: 2,
};

/**
 * Default melody track config — used when `PatternGenConfig.tracks` is
 * omitted. Mid-range minor-pentatonic, off-beat 8th-note pulse, sine lead.
 */
const DEFAULT_MELODY: TrackGenConfig = {
  name: 'melody',
  waveform: 'sine',
  volume: 0.18,
  rhythm: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
  degreeMin: 2,
  degreeMax: 8,
  noteDurationSteps: 1,
};

/**
 * Deterministically generate a complete {@link Pattern} from a 32-bit seed.
 *
 * Same `(seed, config)` → same {@link Pattern} forever, on every JS engine.
 * With no config, ships a complete usable minor-pentatonic bass + melody
 * loop (decision-locked).
 *
 * Note selection uses {@link scaleDegree} exclusively — never `pick`. This
 * makes the generator safe for any seed and any (even degenerate) config
 * (decision §10).
 *
 * @param seed   - 32-bit integer seed for the PRNG. Coerced via `>>> 0`.
 * @param config - Optional tuning. Every field has a musical default.
 * @returns A complete, JSON-serializable {@link Pattern}.
 *
 * @example
 * ```ts
 * // Default chill loop — no config required.
 * const pat = generatePattern(42);
 *
 * // Custom config — C2 dorian at 130 BPM.
 * const fast = generatePattern(7, {
 *   rootMidi: 36,
 *   scale: SCALES.dorian,
 *   bpm: 130,
 *   tracks: [{ name: 'lead', waveform: 'square', volume: 0.3,
 *              rhythm: [true, true, false, true], degreeMin: 4, degreeMax: 10 }],
 * });
 * ```
 */
export function generatePattern(seed: number, config?: PatternGenConfig): Pattern {
  const rootMidi = config?.rootMidi ?? DEFAULT_ROOT_MIDI;
  const intervals = config?.scale ?? SCALES.minorPentatonic;
  const bpm = config?.bpm ?? DEFAULT_BPM;
  const stepsPerBeat = config?.stepsPerBeat ?? DEFAULT_STEPS_PER_BEAT;
  const stepsPerPattern = config?.stepsPerPattern ?? DEFAULT_STEPS_PER_PATTERN;
  const trackConfigs = config?.tracks ?? [DEFAULT_BASS, DEFAULT_MELODY];

  const rng = mulberry32(seed >>> 0);
  const scale = buildScale(rootMidi, intervals, DEFAULT_SCALE_OCTAVES);

  const tracks: Track[] = trackConfigs.map((tc) => generateTrack(rng, tc, scale, stepsPerPattern));

  return {
    bpm,
    stepsPerBeat,
    stepsPerPattern,
    scale: { rootMidi, intervals },
    tracks,
  };
}

/**
 * Generate a single track from its config + the resolved scale.
 *
 * Walks `stepsPerPattern` steps; for each step, if the rhythm template says
 * "hit", picks a scale degree in `[degreeMin, degreeMax]` via {@link nextInt}
 * and resolves it to a MIDI note via {@link scaleDegree}. Otherwise emits a
 * rest. The result is a length-`stepsPerPattern` pattern wrapped in a
 * single-pattern, single-index track.
 */
function generateTrack(
  rng: () => number,
  tc: TrackGenConfig,
  scale: readonly number[],
  stepsPerPattern: number,
): Track {
  const rhythmLen = tc.rhythm.length;
  const noteDurationSteps = tc.noteDurationSteps ?? 1;

  const pattern: NoteEvent[] = [];
  for (let step = 0; step < stepsPerPattern; step++) {
    const isHit = rhythmLen > 0 ? tc.rhythm[step % rhythmLen] : false;
    if (!isHit) {
      pattern.push({ midi: null });
      continue;
    }
    // Pick a degree in [degreeMin, degreeMax] — nextInt is inclusive and
    // never throws on valid ranges. scaleDegree wraps gracefully.
    const degree = nextInt(rng, tc.degreeMin, tc.degreeMax);
    const midi = scaleDegree(scale, degree);
    pattern.push({
      midi,
      durationSteps: noteDurationSteps,
      waveform: tc.waveform,
      peak: tc.volume,
    });
  }

  return {
    name: tc.name,
    waveform: tc.waveform,
    volume: tc.volume,
    sequence: [0],
    patterns: [pattern],
  };
}
