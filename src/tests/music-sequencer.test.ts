import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSequencer } from '../music/sequencer';
import { generatePattern } from '../music/pattern';
import { noteToFrequency } from '../music/theory';
import { LOOKAHEAD_MS, SCHEDULE_AHEAD_S } from '../music/constants';
import type { AudioAdapter } from '../audio/types';
import type { Pattern } from '../music/types';

/**
 * Layer 4 — host-touching sequencer adapter. Verified via a FAKE AudioAdapter
 * that records every `playTone(type, f0, f1, durMs, peak, whenS)` call.
 *
 * The adapter implements Chris Wilson's two-clock lookahead scheduler:
 *   - A `setTimeout` chain polls every `LOOKAHEAD_MS` (25 ms).
 *   - Each poll pre-queues every note whose `nextNoteTime` falls within
 *     `SCHEDULE_AHEAD_S` (0.1 s) of `audio.currentTime`.
 *   - Each queued note becomes a `audio.playTone(type, freq, freq, durMs,
 *     peak * musicVolume, whenS)` call.
 *
 * Defensive contract: never throws. Idempotent `dispose`. No-op when audio
 * is not unlocked. `setVolume(v)` scales the `peak` argument of every
 * subsequent `playTone` call (pure multiplication — independent of the
 * AudioAdapter's own SFX volume).
 */

interface ToneCall {
  type: OscillatorType;
  f0: number;
  f1: number;
  durMs: number;
  peak: number;
  whenS: number;
}

interface FakeAudio extends AudioAdapter {
  calls: ToneCall[];
  currentTime: number;
  locked: boolean;
  muted: boolean;
  volume: number;
  disposed: boolean;
  /** Advance the fake audio clock by `s` seconds (test-only). */
  tick(s: number): void;
}

function createFakeAudio(): FakeAudio {
  const calls: ToneCall[] = [];
  let currentTime = 100;
  let locked = false;
  let muted = false;
  let volume = 0.7;
  let disposed = false;

  return {
    calls,
    get currentTime() {
      return currentTime;
    },
    get locked() {
      return locked;
    },
    get muted() {
      return muted;
    },
    get volume() {
      return volume;
    },
    get disposed() {
      return disposed;
    },
    tick(s: number) {
      currentTime += s;
    },
    unlock() {
      locked = true;
    },
    isUnlocked() {
      return locked;
    },
    playTone(type, f0, f1, durMs, peak, whenS = 0) {
      calls.push({ type, f0, f1, durMs, peak, whenS });
    },
    playNoise() {
      // intentionally empty — not used by the sequencer
    },
    startNoiseLoop() {
      // intentionally inert — not used by the sequencer
      return { stop() {}, setPeak() {}, setFrequency() {}, setQ() {}, isPlaying: () => false };
    },
    setMuted(v) {
      muted = !!v;
    },
    isMuted() {
      return muted;
    },
    setVolume(v) {
      volume = v;
    },
    getVolume() {
      return volume;
    },
    dispose() {
      disposed = true;
    },
  };
}

/** Minimal hand-authored 1-note pattern: a single A4 (midi 69) at step 0. */
function oneNotePattern(): Pattern {
  return {
    bpm: 120,
    stepsPerBeat: 4,
    stepsPerPattern: 4,
    tracks: [
      {
        name: 'lead',
        waveform: 'sine',
        volume: 0.5,
        sequence: [0],
        patterns: [
          [
            { midi: 69, durationSteps: 1 },
            { midi: null },
            { midi: null },
            { midi: null },
          ],
        ],
      },
    ],
  };
}

describe('createSequencer — defensive shape', () => {
  it('returns the Sequencer interface', () => {
    const audio = createFakeAudio();
    const seq = createSequencer(audio, oneNotePattern());
    expect(typeof seq.play).toBe('function');
    expect(typeof seq.stop).toBe('function');
    expect(typeof seq.isPlaying).toBe('function');
    expect(typeof seq.setVolume).toBe('function');
    expect(typeof seq.getVolume).toBe('function');
    expect(typeof seq.dispose).toBe('function');
    seq.dispose();
  });

  it('starts with volume 1 and isPlaying=false', () => {
    const audio = createFakeAudio();
    const seq = createSequencer(audio, oneNotePattern());
    expect(seq.getVolume()).toBe(1);
    expect(seq.isPlaying()).toBe(false);
    seq.dispose();
  });
});

describe('createSequencer — locked-audio no-op', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('play() schedules NOTHING when audio is not unlocked', () => {
    const audio = createFakeAudio();
    expect(audio.isUnlocked()).toBe(false);
    const seq = createSequencer(audio, oneNotePattern());
    seq.play();
    // Run several scheduler polls.
    vi.advanceTimersByTime(LOOKAHEAD_MS * 10);
    expect(audio.calls).toHaveLength(0);
    expect(seq.isPlaying()).toBe(false);
    seq.dispose();
  });
});

describe('createSequencer — scheduling when unlocked', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('play() arms playback and the first poll schedules the step-0 note', () => {
    const audio = createFakeAudio();
    audio.unlock();
    const pat = oneNotePattern();
    const seq = createSequencer(audio, pat);

    seq.play();
    expect(seq.isPlaying()).toBe(true);

    // First scheduler poll (LOOKAHEAD_MS) — should schedule step 0.
    vi.advanceTimersByTime(LOOKAHEAD_MS);
    expect(audio.calls.length).toBeGreaterThanOrEqual(1);

    // The note's frequency matches noteToFrequency(midi 69) = 440 Hz.
    expect(audio.calls[0].f0).toBeCloseTo(noteToFrequency(69), 3);
    expect(audio.calls[0].f1).toBeCloseTo(noteToFrequency(69), 3);
    expect(audio.calls[0].type).toBe('sine');
    seq.dispose();
  });

  it('whenS is within the lookahead window (0 ≤ whenS ≤ SCHEDULE_AHEAD_S)', () => {
    const audio = createFakeAudio();
    audio.unlock();
    const seq = createSequencer(audio, oneNotePattern());
    seq.play();
    vi.advanceTimersByTime(LOOKAHEAD_MS);
    for (const call of audio.calls) {
      expect(call.whenS).toBeGreaterThanOrEqual(0);
      expect(call.whenS).toBeLessThanOrEqual(SCHEDULE_AHEAD_S + 1e-6);
    }
    seq.dispose();
  });

  it('multiple steps are scheduled as the audio clock advances', () => {
    const audio = createFakeAudio();
    audio.unlock();
    // 4-step pattern with notes at every step.
    const pat: Pattern = {
      bpm: 600, // very fast: 10 s⁻¹ → stepDur (4 spb) = 0.025 s = 25 ms
      stepsPerBeat: 4,
      stepsPerPattern: 4,
      tracks: [
        {
          name: 'a',
          waveform: 'sine',
          volume: 0.3,
          sequence: [0],
          patterns: [
            [
              { midi: 60 },
              { midi: 62 },
              { midi: 64 },
              { midi: 65 },
            ],
          ],
        },
      ],
    };
    const seq = createSequencer(audio, pat);
    seq.play();
    // 4 polls × 25 ms covers ~all 4 steps (each 25 ms apart).
    vi.advanceTimersByTime(LOOKAHEAD_MS * 5);
    // We should see frequencies for at least the first few notes.
    expect(audio.calls.length).toBeGreaterThanOrEqual(2);
    seq.dispose();
  });

  it('the step-0 note is fired again on loop wrap', () => {
    const audio = createFakeAudio();
    audio.unlock();
    const pat: Pattern = {
      bpm: 600, // stepDur = 25 ms; full 4-step pattern = 100 ms
      stepsPerBeat: 4,
      stepsPerPattern: 4,
      tracks: [
        {
          name: 'a',
          waveform: 'sine',
          volume: 0.3,
          sequence: [0],
          patterns: [
            [{ midi: 69 }, { midi: null }, { midi: null }, { midi: null }],
          ],
        },
      ],
    };
    const seq = createSequencer(audio, pat);
    seq.play();
    // Chris Wilson's scheduler is driven by the AUDIO CLOCK, not the JS
    // timer. Advance both in lockstep: each LOOKAHEAD_MS (25 ms) of wall
    // time = 25 ms of audio-clock time. Over ~300 ms we cover ≥2 full loops
    // of the 100 ms pattern.
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(LOOKAHEAD_MS);
      audio.tick(LOOKAHEAD_MS / 1000);
    }
    const a4Calls = audio.calls.filter((c) => c.f0 === noteToFrequency(69));
    expect(a4Calls.length).toBeGreaterThanOrEqual(2);
    seq.dispose();
  });
});

describe('createSequencer — setVolume scales peak', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('setVolume(0.5) halves the peak passed to playTone', () => {
    const audio = createFakeAudio();
    audio.unlock();
    // Track volume 0.4 → note peak 0.4; music volume 0.5 → scaled 0.2.
    const pat: Pattern = {
      bpm: 120,
      stepsPerBeat: 4,
      stepsPerPattern: 4,
      tracks: [
        {
          name: 'a',
          waveform: 'sine',
          volume: 0.4,
          sequence: [0],
          patterns: [[{ midi: 69 }, { midi: null }, { midi: null }, { midi: null }]],
        },
      ],
    };
    const seq = createSequencer(audio, pat);
    seq.setVolume(0.5);
    expect(seq.getVolume()).toBe(0.5);
    seq.play();
    vi.advanceTimersByTime(LOOKAHEAD_MS);
    expect(audio.calls.length).toBeGreaterThanOrEqual(1);
    expect(audio.calls[0].peak).toBeCloseTo(0.4 * 0.5, 9);
    seq.dispose();
  });

  it('setVolume is independent of the AudioAdapter SFX volume', () => {
    const audio = createFakeAudio();
    audio.unlock();
    audio.setVolume(0.9); // SFX volume — should NOT affect music peak scaling
    const pat = oneNotePattern(); // track volume 0.5
    const seq = createSequencer(audio, pat);
    seq.setVolume(0.5);
    seq.play();
    vi.advanceTimersByTime(LOOKAHEAD_MS);
    // Music peak = track volume × music volume = 0.5 × 0.5 = 0.25.
    expect(audio.calls[0].peak).toBeCloseTo(0.25, 9);
    // AudioAdapter's own volume is unchanged.
    expect(audio.getVolume()).toBe(0.9);
    seq.dispose();
  });

  it('default music volume (1) leaves peak at the track volume', () => {
    const audio = createFakeAudio();
    audio.unlock();
    const pat = oneNotePattern();
    const seq = createSequencer(audio, pat);
    seq.play();
    vi.advanceTimersByTime(LOOKAHEAD_MS);
    expect(audio.calls[0].peak).toBeCloseTo(0.5, 9);
    seq.dispose();
  });

  it('clamps setVolume into [0, 1]', () => {
    const audio = createFakeAudio();
    const seq = createSequencer(audio, oneNotePattern());
    seq.setVolume(-1);
    expect(seq.getVolume()).toBe(0);
    seq.setVolume(2);
    expect(seq.getVolume()).toBe(1);
    seq.dispose();
  });

  it('setVolume(0) mutes the music (peak === 0) without throwing', () => {
    const audio = createFakeAudio();
    audio.unlock();
    const seq = createSequencer(audio, oneNotePattern());
    seq.setVolume(0);
    seq.play();
    vi.advanceTimersByTime(LOOKAHEAD_MS);
    expect(audio.calls[0].peak).toBe(0);
    seq.dispose();
  });
});

describe('createSequencer — stop / dispose', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stop() halts scheduling — no new playTone calls after stop', () => {
    const audio = createFakeAudio();
    audio.unlock();
    const seq = createSequencer(audio, oneNotePattern());
    seq.play();
    vi.advanceTimersByTime(LOOKAHEAD_MS);
    const callsBefore = audio.calls.length;
    seq.stop();
    expect(seq.isPlaying()).toBe(false);
    vi.advanceTimersByTime(LOOKAHEAD_MS * 10);
    expect(audio.calls.length).toBe(callsBefore);
    seq.dispose();
  });

  it('stop() is idempotent (no throw on repeated calls)', () => {
    const audio = createFakeAudio();
    audio.unlock();
    const seq = createSequencer(audio, oneNotePattern());
    seq.play();
    seq.stop();
    expect(() => seq.stop()).not.toThrow();
    seq.dispose();
  });

  it('play() after stop() resumes scheduling', () => {
    const audio = createFakeAudio();
    audio.unlock();
    const seq = createSequencer(audio, oneNotePattern());
    seq.play();
    vi.advanceTimersByTime(LOOKAHEAD_MS);
    const beforeStop = audio.calls.length;
    seq.stop();
    seq.play();
    vi.advanceTimersByTime(LOOKAHEAD_MS);
    expect(audio.calls.length).toBeGreaterThan(beforeStop);
    seq.dispose();
  });

  it('dispose() is idempotent', () => {
    const audio = createFakeAudio();
    audio.unlock();
    const seq = createSequencer(audio, oneNotePattern());
    seq.play();
    expect(() => seq.dispose()).not.toThrow();
    expect(() => seq.dispose()).not.toThrow();
  });

  it('dispose() clears the setTimeout chain — no further playTone calls', () => {
    const audio = createFakeAudio();
    audio.unlock();
    const seq = createSequencer(audio, oneNotePattern());
    seq.play();
    vi.advanceTimersByTime(LOOKAHEAD_MS);
    const beforeDispose = audio.calls.length;
    seq.dispose();
    vi.advanceTimersByTime(LOOKAHEAD_MS * 20);
    expect(audio.calls.length).toBe(beforeDispose);
  });

  it('all sequencer methods are silent no-ops after dispose', () => {
    const audio = createFakeAudio();
    audio.unlock();
    const seq = createSequencer(audio, oneNotePattern());
    seq.dispose();
    expect(() => seq.play()).not.toThrow();
    expect(() => seq.stop()).not.toThrow();
    expect(() => seq.setVolume(0.5)).not.toThrow();
    expect(seq.isPlaying()).toBe(false);
    vi.advanceTimersByTime(LOOKAHEAD_MS * 5);
    expect(audio.calls.length).toBe(0);
  });
});

describe('createSequencer — defensive error handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('swallows errors thrown by audio.playTone', () => {
    const audio = createFakeAudio();
    audio.unlock();
    audio.playTone = () => {
      throw new Error('boom');
    };
    const seq = createSequencer(audio, oneNotePattern());
    seq.play();
    expect(() => vi.advanceTimersByTime(LOOKAHEAD_MS)).not.toThrow();
    seq.dispose();
  });

  it('swallows errors thrown by audio.isUnlocked', () => {
    const audio = createFakeAudio();
    audio.isUnlocked = () => {
      throw new Error('locked-error');
    };
    const seq = createSequencer(audio, oneNotePattern());
    expect(() => seq.play()).not.toThrow();
    vi.advanceTimersByTime(LOOKAHEAD_MS);
    seq.dispose();
  });

  it('never throws on a generated pattern (smoke test)', () => {
    const audio = createFakeAudio();
    audio.unlock();
    const pat = generatePattern(42);
    const seq = createSequencer(audio, pat);
    expect(() => {
      seq.play();
      vi.advanceTimersByTime(LOOKAHEAD_MS * 4);
    }).not.toThrow();
    expect(audio.calls.length).toBeGreaterThanOrEqual(1);
    seq.dispose();
  });
});
