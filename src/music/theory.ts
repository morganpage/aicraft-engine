/**
 * Pure music-theory primitives (Layer 1).
 *
 * Same determinism profile as `src/palette/` color math: integer math +
 * `Math.pow` / `Math.log` only. No `Math.random`, no `Date.now`, no host
 * access, no state. Same inputs → same outputs forever, on every JS engine.
 *
 * @module
 */

/**
 * A4 = MIDI 69. The universal reference note number.
 */
export const A4_MIDI = 69;

/**
 * A4 = 440 Hz. The universal reference pitch (concert pitch).
 */
export const A4_FREQ = 440;

/**
 * Canonical scale intervals — semitone offsets from the root. Used by
 * `buildScale` and as the default scale set for `generatePattern`.
 *
 * Reference: standard 12-tone equal temperament scale degrees.
 */
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
} as const;

/**
 * MIDI note number → frequency in Hz under 12-tone equal temperament.
 *
 * Formula: `f = tuning × 2^((midi − 69) / 12)`. With the default `tuning`
 * of `440`, MIDI 69 (A4) returns exactly `440`; MIDI 57 (A3) returns `220`.
 *
 * @param midi   - MIDI note number (integer 0–127; fractional works for
 *                 microtonal pitches).
 * @param tuning - Reference frequency for A4 in Hz. Default `440`. Pass `432`
 *                 for Verdi tuning, `415` for baroque.
 * @returns Frequency in Hz.
 *
 * @example
 * ```ts
 * noteToFrequency(69);     // 440 (A4)
 * noteToFrequency(60);     // ~261.6256 (C4 / middle C)
 * noteToFrequency(57);     // 220 (A3)
 * noteToFrequency(69, 432); // 432 (A4 under Verdi tuning)
 * ```
 */
export function noteToFrequency(midi: number, tuning: number = A4_FREQ): number {
  return tuning * Math.pow(2, (midi - A4_MIDI) / 12);
}

/**
 * Frequency in Hz → MIDI note number. Returns the FULL float — rounding is a
 * lossy operation the consumer can apply at the call site if needed
 * (decision §9; locked).
 *
 * Inverse of {@link noteToFrequency}: `frequencyToNote(noteToFrequency(n))`
 * returns `n` to within floating-point epsilon for any `n`.
 *
 * @param freq - Frequency in Hz.
 * @returns MIDI note number (float).
 *
 * @example
 * ```ts
 * frequencyToNote(440);   // 69
 * frequencyToNote(220);   // 57
 * frequencyToNote(300);   // ~62.86 (full float, not rounded)
 * ```
 */
export function frequencyToNote(freq: number): number {
  return (12 * (Math.log(freq) - Math.log(A4_FREQ))) / Math.log(2) + A4_MIDI;
}

/**
 * Build a scale as MIDI note numbers across `octaves` octaves.
 *
 * @param rootMidi  - Root note of the scale (e.g. `60` for C4).
 * @param intervals - Semitone offsets from the root (one of {@link SCALES}, or
 *                    a hand-authored array).
 * @param octaves   - Number of octaves to span. Default `2`.
 * @returns MIDI note numbers, ascending. Length = `intervals.length × octaves`.
 *
 * @example
 * ```ts
 * buildScale(60, SCALES.major, 1);
 * // [60, 62, 64, 65, 67, 69, 71] — C major, one octave
 * ```
 */
export function buildScale(
  rootMidi: number,
  intervals: readonly number[],
  octaves: number = 2,
): number[] {
  if (octaves < 1) octaves = 1;
  const out: number[] = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (const semi of intervals) {
      out.push(rootMidi + semi + 12 * oct);
    }
  }
  return out;
}

/**
 * Pick a MIDI note from a scale by 0-based degree. Wraps gracefully across
 * octaves using modular arithmetic — degree `n` on a length-`k` scale returns
 * the note at index `((n mod k) + k) mod k`, transposed by `floor(n / k)` (or
 * `ceil` for negatives) octaves.
 *
 * Never throws — not even on a length-1 scale. This is the safe alternative
 * to `pick(rng, scale)` for the seeded pattern generator (decision §10).
 *
 * @param scale  - Scale notes (output of {@link buildScale}, or any ascending
 *                 MIDI note array).
 * @param degree - 0-based degree. Negative degrees wrap to lower octaves.
 * @returns MIDI note number.
 *
 * @example
 * ```ts
 * const cmaj = buildScale(60, SCALES.major, 1); // [60,62,64,65,67,69,71]
 * scaleDegree(cmaj, 0);  // 60
 * scaleDegree(cmaj, 7);  // 72 (root + 1 octave — wraps past the end)
 * scaleDegree(cmaj, -1); // 71 - 12 = 59 (wraps to previous octave)
 * ```
 */
export function scaleDegree(scale: readonly number[], degree: number): number {
  const n = scale.length;
  if (n === 0) return 0;
  const wrapped = ((degree % n) + n) % n;
  const octaveShift = Math.floor(degree / n);
  return scale[wrapped] + 12 * octaveShift;
}

/**
 * BPM → seconds per quarter-note beat. Pure.
 *
 * @param bpm - Beats per minute.
 * @returns Seconds per beat (`60 / bpm`).
 */
export function secondsPerBeat(bpm: number): number {
  return 60 / bpm;
}

/**
 * BPM + subdivision → seconds per step.
 *
 * @param bpm          - Beats per minute.
 * @param stepsPerBeat - Steps per beat (`4` = 16th notes, etc.).
 * @returns Seconds per step (`secondsPerBeat(bpm) / stepsPerBeat`).
 */
export function secondsPerStep(bpm: number, stepsPerBeat: number): number {
  return secondsPerBeat(bpm) / stepsPerBeat;
}

/**
 * Swing: duration of the LONG half of a step pair, given a swing ratio.
 *
 * Convention (proposal-locked): `swingRatio ∈ [0.5, 0.75]`.
 *   - `0.5` = straight (50/50 long-short split)
 *   - `0.66` ≈ triplet feel (2/3 + 1/3)
 *   - `0.75` = hard swing (3/4 + 1/4)
 *
 * The SHORT half of the pair is `pairDuration - longDuration`. Out-of-range
 * ratios clamp into `[0.5, 0.75]` — never throws.
 *
 * @param pairDuration - Total duration of the step pair in any time unit.
 * @param swingRatio   - Swing ratio in `[0.5, 0.75]`.
 * @returns Duration of the long half, in the same unit as `pairDuration`.
 */
export function swingLongDuration(pairDuration: number, swingRatio: number): number {
  const r = Math.max(0.5, Math.min(0.75, swingRatio));
  return pairDuration * r;
}
