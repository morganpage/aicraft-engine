import { describe, it, expect } from 'vitest';
import { generatePattern } from '../music/pattern';
import { SCALES } from '../music/theory';
import type { Pattern, PatternGenConfig, TrackGenConfig } from '../music/types';

/**
 * Layer 2 — pure seeded pattern generator. Determinism contract: same
 * `(seed, config)` → same `Pattern` forever, on every JS engine. Mirrors
 * `generatePalette` / `generateSkinVariants`. Uses `mulberry32` exclusively.
 *
 * The `pick` guard (decision §10): the generator MUST NOT call `pick` on a
 * potentially-empty array. `pick` throws on empty arrays (`src/rng/mulberry32.ts`).
 * The generator must use `scaleDegree` (wraps gracefully) or length-guard.
 */

/** Build a config with the defaults overridden piecemeal. */
function cfg(overrides: Partial<PatternGenConfig> = {}): PatternGenConfig {
  return {
    rootMidi: 48,
    scale: SCALES.minorPentatonic,
    bpm: 110,
    stepsPerBeat: 4,
    stepsPerPattern: 16,
    ...overrides,
  };
}

describe('generatePattern — determinism', () => {
  it('same seed → byte-identical Pattern (deep equal)', () => {
    const a = generatePattern(42);
    const b = generatePattern(42);
    expect(a).toEqual(b);
  });

  it('same seed + same config → byte-identical Pattern', () => {
    const config = cfg({ rootMidi: 36, bpm: 120 });
    expect(generatePattern(7, config)).toEqual(generatePattern(7, config));
  });

  it('different seeds (likely) produce different patterns', () => {
    const a = generatePattern(42);
    const b = generatePattern(43);
    expect(a).not.toEqual(b);
  });

  it('different configs with the same seed (likely) produce different patterns', () => {
    const a = generatePattern(42, cfg({ bpm: 110 }));
    const b = generatePattern(42, cfg({ bpm: 140 }));
    expect(a).not.toEqual(b);
  });

  it('seed is coerced to uint32 (negative seeds still deterministic)', () => {
    // -1 >>> 0 === 4294967295 — must be stable.
    expect(generatePattern(-1)).toEqual(generatePattern(-1));
    expect(generatePattern(-1)).toEqual(generatePattern(4294967295));
  });
});

describe('generatePattern — defaults (no config)', () => {
  it('generatePattern(42) returns a complete usable Pattern', () => {
    const p = generatePattern(42);
    expect(p).toBeDefined();
    expect(p.tracks.length).toBeGreaterThanOrEqual(1);
    expect(p.stepsPerPattern).toBeGreaterThan(0);
    expect(p.bpm).toBeGreaterThan(0);
    expect(p.stepsPerBeat).toBeGreaterThan(0);
  });

  it('default output ships a minor-pentatonic bass + melody (≥2 tracks)', () => {
    // Decision-locked: generatePattern(seed) with no config produces a complete
    // usable loop (minor-pentatonic bass + melody).
    const p = generatePattern(42);
    expect(p.tracks.length).toBeGreaterThanOrEqual(2);
  });

  it('all tracks in a generated pattern share the same stepsPerPattern', () => {
    const p = generatePattern(42);
    for (const track of p.tracks) {
      for (const pat of track.patterns) {
        expect(pat).toHaveLength(p.stepsPerPattern);
      }
    }
  });

  it('every NoteEvent.midi is null or within a sensible MIDI range', () => {
    const p = generatePattern(42);
    for (const track of p.tracks) {
      for (const pat of track.patterns) {
        for (const ev of pat) {
          if (ev.midi !== null) {
            expect(ev.midi).toBeGreaterThanOrEqual(0);
            expect(ev.midi).toBeLessThanOrEqual(127);
          }
        }
      }
    }
  });

  it('every track has at least one pattern and a non-empty sequence', () => {
    const p = generatePattern(42);
    for (const track of p.tracks) {
      expect(track.patterns.length).toBeGreaterThanOrEqual(1);
      expect(track.sequence.length).toBeGreaterThanOrEqual(1);
      // sequence indices must be valid pattern indices
      for (const idx of track.sequence) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(track.patterns.length);
      }
    }
  });

  it('each pattern has at least one non-rest note somewhere (music plays)', () => {
    const p = generatePattern(42);
    for (const track of p.tracks) {
      const hasNote = track.patterns.some((pat) => pat.some((ev) => ev.midi !== null));
      expect(hasNote).toBe(true);
    }
  });
});

describe('generatePattern — pick guard (decision §10)', () => {
  // The generator must NEVER call `pick` on a potentially-empty array.
  // `pick` throws on empty arrays. We assert the generator never throws for
  // any 32-bit seed — including seeds that exercise every branch.

  it('never throws for the first 1000 non-negative seeds', () => {
    for (let s = 0; s < 1000; s++) {
      expect(() => generatePattern(s)).not.toThrow();
    }
  });

  it('never throws for an extreme-rhythm custom config', () => {
    const allRest: TrackGenConfig = {
      name: 'silent',
      waveform: 'sine',
      volume: 0.2,
      rhythm: [false, false, false, false],
      degreeMin: 0,
      degreeMax: 4,
    };
    expect(() => generatePattern(42, cfg({ tracks: [allRest] }))).not.toThrow();
  });

  it('never throws with a degenerate degree range (min === max)', () => {
    const single: TrackGenConfig = {
      name: 'pedal',
      waveform: 'sine',
      volume: 0.2,
      rhythm: [true, true, true, true],
      degreeMin: 2,
      degreeMax: 2,
    };
    expect(() => generatePattern(42, cfg({ tracks: [single] }))).not.toThrow();
  });

  it('never throws with a single-step pattern', () => {
    expect(() => generatePattern(42, cfg({ stepsPerPattern: 1 }))).not.toThrow();
  });
});

describe('generatePattern — custom config honored', () => {
  it('rootMidi is reflected in the scale metadata', () => {
    const p = generatePattern(42, cfg({ rootMidi: 36 }));
    expect(p.scale?.rootMidi).toBe(36);
  });

  it('scale intervals are reflected in the scale metadata', () => {
    const p = generatePattern(42, cfg({ scale: SCALES.major }));
    expect(p.scale?.intervals).toEqual(SCALES.major);
  });

  it('bpm is preserved on the pattern', () => {
    const p = generatePattern(42, cfg({ bpm: 140 }));
    expect(p.bpm).toBe(140);
  });

  it('stepsPerBeat is preserved on the pattern', () => {
    const p = generatePattern(42, cfg({ stepsPerBeat: 2 }));
    expect(p.stepsPerBeat).toBe(2);
  });

  it('stepsPerPattern is preserved and every track matches it', () => {
    const p = generatePattern(42, cfg({ stepsPerPattern: 8 }));
    expect(p.stepsPerPattern).toBe(8);
    for (const track of p.tracks) {
      for (const pat of track.patterns) {
        expect(pat).toHaveLength(8);
      }
    }
  });

  it('custom tracks override the default bass+melody', () => {
    const custom: TrackGenConfig = {
      name: 'lead',
      waveform: 'square',
      volume: 0.3,
      rhythm: [true, false, true, false],
      degreeMin: 4,
      degreeMax: 10,
      noteDurationSteps: 1,
    };
    const p = generatePattern(42, cfg({ tracks: [custom] }));
    expect(p.tracks).toHaveLength(1);
    expect(p.tracks[0].name).toBe('lead');
    expect(p.tracks[0].waveform).toBe('square');
    expect(p.tracks[0].volume).toBe(0.3);
  });

  it('noteDurationSteps is honored on generated notes', () => {
    const custom: TrackGenConfig = {
      name: 'bass',
      waveform: 'sawtooth',
      volume: 0.25,
      rhythm: [true, false, false, false],
      degreeMin: 0,
      degreeMax: 4,
      noteDurationSteps: 2,
    };
    const p = generatePattern(42, cfg({ tracks: [custom], stepsPerPattern: 4 }));
    const notes = p.tracks[0].patterns[0].filter((ev) => ev.midi !== null);
    expect(notes.length).toBeGreaterThanOrEqual(1);
    for (const ev of notes) {
      expect(ev.durationSteps).toBe(2);
    }
  });

  it('rhythm wraps when shorter than stepsPerPattern', () => {
    const custom: TrackGenConfig = {
      name: 'pulse',
      waveform: 'sine',
      volume: 0.2,
      rhythm: [true, false], // length 2, applied across 8 steps
      degreeMin: 0,
      degreeMax: 4,
    };
    const p = generatePattern(42, cfg({ tracks: [custom], stepsPerPattern: 8 }));
    expect(p.tracks[0].patterns[0]).toHaveLength(8);
    // Hits at even indices, rests at odd indices.
    for (let i = 0; i < 8; i++) {
      const ev = p.tracks[0].patterns[0][i];
      const expectHit = i % 2 === 0;
      expect(ev.midi !== null).toBe(expectHit);
    }
  });
});

describe('generatePattern — purity / shape', () => {
  it('returns a fresh object each call (no shared references)', () => {
    const a = generatePattern(42);
    const b = generatePattern(42);
    expect(a).not.toBe(b);
    expect(a.tracks).not.toBe(b.tracks);
    expect(a.tracks[0]).not.toBe(b.tracks[0]);
    expect(a.tracks[0].patterns).not.toBe(b.tracks[0].patterns);
    expect(a.tracks[0].patterns[0]).not.toBe(b.tracks[0].patterns[0]);
  });

  it('the pattern is JSON-serializable (no functions, no cycles)', () => {
    const p: Pattern = generatePattern(42);
    expect(() => JSON.stringify(p)).not.toThrow();
    const round: Pattern = JSON.parse(JSON.stringify(p));
    expect(round).toEqual(p);
  });
});
