import { describe, it, expect } from 'vitest';
import {
  A4_FREQ,
  A4_MIDI,
  SCALES,
  noteToFrequency,
  frequencyToNote,
  buildScale,
  scaleDegree,
  secondsPerBeat,
  secondsPerStep,
  swingLongDuration,
} from '../music/theory';

/**
 * Layer 1 — pure music-theory primitives. Same inputs → same outputs forever,
 * on every JS engine. No host access, no `Math.random`, no state. Mirrors the
 * determinism profile of `src/palette/` color math.
 */

describe('reference constants', () => {
  it('A4_MIDI === 69 and A4_FREQ === 440', () => {
    expect(A4_MIDI).toBe(69);
    expect(A4_FREQ).toBe(440);
  });
});

describe('noteToFrequency', () => {
  it('A4 (midi 69) → 440 Hz exactly', () => {
    expect(noteToFrequency(69)).toBe(440);
  });

  it('A3 (midi 57) → 220 Hz exactly (one octave below A4)', () => {
    expect(noteToFrequency(57)).toBe(220);
  });

  it('A5 (midi 81) → 880 Hz exactly (one octave above A4)', () => {
    expect(noteToFrequency(81)).toBe(880);
  });

  it('C4 (midi 60) → ~261.6256 Hz (12-TET)', () => {
    expect(noteToFrequency(60)).toBeCloseTo(261.6256, 3);
  });

  it('equal-temperament: each semitone multiplies frequency by 2^(1/12)', () => {
    const a = noteToFrequency(69);
    const aSharp = noteToFrequency(70);
    expect(aSharp / a).toBeCloseTo(Math.pow(2, 1 / 12), 12);
  });

  it('accepts a non-standard tuning reference (432 Hz)', () => {
    expect(noteToFrequency(69, 432)).toBe(432);
  });

  it('is pure / deterministic across calls', () => {
    expect(noteToFrequency(64)).toBe(noteToFrequency(64));
  });
});

describe('frequencyToNote', () => {
  it('440 Hz → 69 (full float, exact)', () => {
    expect(frequencyToNote(440)).toBe(69);
  });

  it('220 Hz → 57 (full float, within epsilon)', () => {
    expect(frequencyToNote(220)).toBeCloseTo(57, 9);
  });

  it('880 Hz → 81 (full float, within epsilon)', () => {
    expect(frequencyToNote(880)).toBeCloseTo(81, 9);
  });

  it('round-trips through noteToFrequency within epsilon', () => {
    for (const midi of [0, 33, 57, 60, 64, 69, 81, 96, 127]) {
      const freq = noteToFrequency(midi);
      const back = frequencyToNote(freq);
      expect(Math.abs(back - midi)).toBeLessThan(1e-9);
    }
  });

  it('returns full float precision (no fixed-2 rounding)', () => {
    // 300 Hz is between MIDI notes; the exact float is not a whole number.
    const n = frequencyToNote(300);
    expect(Number.isInteger(n)).toBe(false);
    // Sanity: round-trip back to frequency within epsilon.
    expect(noteToFrequency(n)).toBeCloseTo(300, 9);
  });
});

describe('SCALES', () => {
  it('exposes the six canonical scales as semitone-interval arrays', () => {
    expect(SCALES.major).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(SCALES.minor).toEqual([0, 2, 3, 5, 7, 8, 10]);
    expect(SCALES.majorPentatonic).toEqual([0, 2, 4, 7, 9]);
    expect(SCALES.minorPentatonic).toEqual([0, 3, 5, 7, 10]);
    expect(SCALES.blues).toEqual([0, 3, 5, 6, 7, 10]);
    expect(SCALES.dorian).toEqual([0, 2, 3, 5, 7, 9, 10]);
  });

  it('every scale starts at the root (interval 0)', () => {
    for (const key of Object.keys(SCALES) as (keyof typeof SCALES)[]) {
      expect(SCALES[key][0]).toBe(0);
    }
  });
});

describe('buildScale', () => {
  it('C major over 1 octave → [60,62,64,65,67,69,71]', () => {
    expect(buildScale(60, SCALES.major, 1)).toEqual([60, 62, 64, 65, 67, 69, 71]);
  });

  it('C major over 2 octaves → 14 notes, second octave starts at 72', () => {
    const scale = buildScale(60, SCALES.major, 2);
    expect(scale).toHaveLength(14);
    expect(scale[0]).toBe(60);
    expect(scale[7]).toBe(72);
    expect(scale[13]).toBe(71 + 12);
  });

  it('minor pentatonic over 2 octaves → 10 notes (5 per octave)', () => {
    expect(buildScale(48, SCALES.minorPentatonic, 2)).toHaveLength(10);
  });

  it('default octave count is 2', () => {
    expect(buildScale(60, SCALES.major)).toHaveLength(14);
  });

  it('is pure / deterministic', () => {
    expect(buildScale(57, SCALES.minor, 2)).toEqual(buildScale(57, SCALES.minor, 2));
  });
});

describe('scaleDegree', () => {
  it('degree 0 returns the root', () => {
    const scale = buildScale(60, SCALES.major, 1);
    expect(scaleDegree(scale, 0)).toBe(60);
  });

  it('degree within range returns the indexed note', () => {
    const scale = buildScale(60, SCALES.major, 1);
    expect(scaleDegree(scale, 1)).toBe(62);
    expect(scaleDegree(scale, 6)).toBe(71);
  });

  it('wraps past the end: degree 7 in a 7-note scale returns the root +1 octave', () => {
    const scale = buildScale(60, SCALES.major, 1); // 7 notes
    expect(scaleDegree(scale, 7)).toBe(60 + 12);
    expect(scaleDegree(scale, 8)).toBe(62 + 12);
  });

  it('wraps in a 5-note scale: degree 7 wraps to octave+2', () => {
    // buildScale(60, minorPentatonic, 1) = [60, 63, 65, 67, 70] — 5 notes.
    const scale = buildScale(60, SCALES.minorPentatonic, 1);
    expect(scale).toHaveLength(5);
    // degree 7 % 5 = 2 → index 2 of the NEXT octave
    expect(scaleDegree(scale, 7)).toBe(scale[2] + 12);
  });

  it('handles negative degrees (one below root)', () => {
    const scale = buildScale(60, SCALES.major, 1); // 7 notes
    // degree -1 → index 6 of the PREVIOUS octave → 71 - 12 = 59
    expect(scaleDegree(scale, -1)).toBe(59);
  });

  it('never throws on a single-note scale', () => {
    expect(() => scaleDegree([60], 1000)).not.toThrow();
    // degree 1000 on a 1-note scale = root + 1000 octaves; the contract is
    // "wraps gracefully without throwing", not "returns the root".
    const result = scaleDegree([60], 1000);
    expect(Number.isFinite(result)).toBe(true);
    // degree 0 always returns the root.
    expect(scaleDegree([60], 0)).toBe(60);
  });
});

describe('secondsPerBeat / secondsPerStep', () => {
  it('secondsPerBeat(120) === 0.5', () => {
    expect(secondsPerBeat(120)).toBe(0.5);
  });

  it('secondsPerBeat(60) === 1', () => {
    expect(secondsPerBeat(60)).toBe(1);
  });

  it('secondsPerBeat(110) === 60/110', () => {
    expect(secondsPerBeat(110)).toBeCloseTo(60 / 110, 12);
  });

  it('secondsPerStep(120, 4) === 0.125 (16th notes at 120 BPM)', () => {
    expect(secondsPerStep(120, 4)).toBe(0.125);
  });

  it('secondsPerStep(120, 2) === 0.25 (8th notes)', () => {
    expect(secondsPerStep(120, 2)).toBe(0.25);
  });

  it('secondsPerStep(120, 1) === secondsPerBeat(120)', () => {
    expect(secondsPerStep(120, 1)).toBe(secondsPerBeat(120));
  });
});

describe('swingLongDuration', () => {
  // Proposal-locked contract: swingRatio ∈ [0.5, 0.75].
  //   0.5 = straight (50/50)  → long half = pair × 0.5
  //   0.66 ≈ triplet (2/3 + 1/3) → long half = pair × 0.66
  //   0.75 = hard swing (3/4 + 1/4) → long half = pair × 0.75
  // Out-of-range ratios clamp into [0.5, 0.75].

  it('swingRatio=0.5 (straight) on a 1s pair → long half = 0.5 (= short half)', () => {
    const pair = 1;
    const long = swingLongDuration(pair, 0.5);
    expect(long).toBe(0.5);
    expect(pair - long).toBe(0.5);
  });

  it('swingRatio=0.66 → long half = pair × 0.66 (literal ratio)', () => {
    const pair = 0.5;
    expect(swingLongDuration(pair, 0.66)).toBeCloseTo(pair * 0.66, 9);
  });

  it('swingRatio=2/3 (exact triplet) → long half = pair × 2/3', () => {
    const pair = 0.5;
    const triplet = 2 / 3;
    expect(swingLongDuration(pair, triplet)).toBeCloseTo(pair * triplet, 9);
  });

  it('swingRatio=0.75 (hard swing) → long half = pair × 3/4', () => {
    const pair = 0.4;
    expect(swingLongDuration(pair, 0.75)).toBeCloseTo(pair * 0.75, 9);
  });

  it('increasing swingRatio lengthens the long half (and shrinks the short half)', () => {
    const pair = 0.5;
    const straight = swingLongDuration(pair, 0.5);
    const triplet = swingLongDuration(pair, 0.66);
    const hard = swingLongDuration(pair, 0.75);
    expect(straight).toBeLessThan(triplet);
    expect(triplet).toBeLessThan(hard);
  });

  it('the short half is pairDuration - longDuration for every ratio in range', () => {
    const pair = 0.4;
    for (const ratio of [0.5, 0.55, 0.6, 0.66, 0.7, 0.75]) {
      const long = swingLongDuration(pair, ratio);
      const short = pair - long;
      expect(long + short).toBeCloseTo(pair, 12);
      expect(long).toBeGreaterThanOrEqual(short);
    }
  });

  it('clamps swingRatio below 0.5 up to 0.5 (no collapse, no throw)', () => {
    expect(() => swingLongDuration(1, 0)).not.toThrow();
    expect(() => swingLongDuration(1, -5)).not.toThrow();
    expect(swingLongDuration(1, 0)).toBe(0.5);
  });

  it('clamps swingRatio above 0.75 down to 0.75 (no throw)', () => {
    expect(() => swingLongDuration(1, 1)).not.toThrow();
    expect(() => swingLongDuration(1, 99)).not.toThrow();
    expect(swingLongDuration(1, 1)).toBe(0.75);
  });

  it('is pure / deterministic', () => {
    expect(swingLongDuration(0.3, 0.6)).toBe(swingLongDuration(0.3, 0.6));
  });
});
