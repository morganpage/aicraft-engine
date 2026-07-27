import { describe, it, expect } from 'vitest';
import { advanceSequencer } from '../music/advance';
import { generatePattern } from '../music/pattern';
import { secondsPerStep } from '../music/theory';
import type { NoteFire, Pattern, SequencerState } from '../music/types';

/**
 * Layer 3 — pure sequencer advance (the determinism seam). Mirrors
 * `advanceEmission(state, dt, config) → { next, spawnCount }` and the tween
 * driver `advanceTween(state, dt, config) → { state, value, done }`.
 *
 * Contract: takes `(state, dt, pattern)`, returns `{ next, events }`.
 *   - NEVER mutates input state. Returns a fresh state object.
 *   - NEVER throws (degenerate dt→0, empty pattern→no events).
 *   - No host access. No `audio.currentTime`. No `Math.random`.
 *   - Same `(state, dt, pattern)` → byte-identical `events` forever.
 *
 * Step firing rule: when the elapsed-time window crosses a step boundary,
 * every non-rest note at that step on every track fires. Each NoteFire
 * carries its `whenOffset` (seconds from the start of the advance window
 * when the note should be scheduled) and `gateS` (audible duration).
 *
 * Swing: odd-indexed off-beat steps receive the swing delay relative to
 * their nominal position (song-level swing, decision §2). With swingRatio
 * of 0.5 the feel is straight; with 0.66 the off-beat is pushed late.
 */

/** Initial state factory for tests. */
function state0(): SequencerState {
  return { elapsedS: 0, stepIndex: 0, loopCount: 0 };
}

/** A minimal 4-step, 1-track pattern with one note at step 0. */
function minimalPattern(): Pattern {
  return {
    bpm: 120,
    stepsPerBeat: 4,
    stepsPerPattern: 4,
    tracks: [
      {
        name: 'lead',
        waveform: 'sine',
        volume: 0.3,
        sequence: [0],
        patterns: [
          [
            { midi: 69, durationSteps: 1 },
            { midi: null },
            { midi: 71, durationSteps: 1 },
            { midi: null },
          ],
        ],
      },
    ],
  };
}

describe('advanceSequencer — purity & shape', () => {
  it.each([0, -120, Number.POSITIVE_INFINITY, Number.NaN])(
    'treats invalid bpm %s as silent and never emits non-finite events',
    (bpm) => {
      const pattern = { ...minimalPattern(), bpm };
      const result = advanceSequencer(state0(), 1, pattern);
      expect(result.events).toEqual([]);
      expect(result.next).toEqual(state0());
    },
  );

  it('returns a fresh state object (distinct reference from input)', () => {
    const s = state0();
    const r = advanceSequencer(s, 0.1, minimalPattern());
    expect(r.next).not.toBe(s);
  });

  it('does NOT mutate the input state (deep-equal before/after)', () => {
    const s = state0();
    const snapshot = JSON.parse(JSON.stringify(s));
    advanceSequencer(s, 0.125, minimalPattern());
    advanceSequencer(s, 0.25, minimalPattern());
    expect(s).toEqual(snapshot);
  });

  it('returns an events array (possibly empty)', () => {
    const r = advanceSequencer(state0(), 0.01, minimalPattern());
    expect(Array.isArray(r.events)).toBe(true);
  });

  it('never throws on degenerate dt=0', () => {
    expect(() => advanceSequencer(state0(), 0, minimalPattern())).not.toThrow();
  });

  it('never throws on negative dt (treated as 0)', () => {
    expect(() => advanceSequencer(state0(), -1, minimalPattern())).not.toThrow();
  });

  it('never throws on NaN dt (treated as 0)', () => {
    expect(() => advanceSequencer(state0(), NaN, minimalPattern())).not.toThrow();
  });

  it('never throws on an empty pattern (no tracks → no events)', () => {
    const empty: Pattern = {
      bpm: 120,
      stepsPerBeat: 4,
      stepsPerPattern: 4,
      tracks: [],
    };
    const r = advanceSequencer(state0(), 1, empty);
    expect(r.events).toEqual([]);
  });

  it('never throws on a pattern with empty patterns[]', () => {
    const weird: Pattern = {
      bpm: 120,
      stepsPerBeat: 4,
      stepsPerPattern: 4,
      tracks: [
        {
          name: 'ghost',
          waveform: 'sine',
          volume: 0.2,
          sequence: [0],
          patterns: [[]],
        },
      ],
    };
    expect(() => advanceSequencer(state0(), 0.5, weird)).not.toThrow();
  });
});

describe('advanceSequencer — note firing', () => {
  it('fires step zero once across repeated fixed sub-step advances', () => {
    const pat = minimalPattern();
    let state = state0();
    const fired: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const result = advanceSequencer(state, 1 / 60, pat);
      state = result.next;
      fired.push(...result.events.map((event) => event.midi));
    }
    expect(fired).toEqual([69]);
    const boundary = advanceSequencer(state, 1 / 60, pat);
    expect(boundary.events).toEqual([]);
    const crossed = advanceSequencer(boundary.next, 1 / 60, pat);
    expect(crossed.next.stepIndex).toBe(2);
  });

  it('a note at step 0 fires when advancing from elapsed=0 by ≥ one step', () => {
    const pat = minimalPattern(); // 120 BPM, 4 steps/beat → 0.125 s/step
    const stepDur = secondsPerStep(120, 4);
    const r = advanceSequencer(state0(), stepDur, pat);
    expect(r.events.length).toBeGreaterThanOrEqual(1);
    // The first event is the step-0 note (midi 69).
    const stepZero = r.events.find((e) => e.midi === 69);
    expect(stepZero).toBeDefined();
  });

  it("events[0].midi matches the pattern's first non-rest note at step 0", () => {
    const pat = minimalPattern();
    const r = advanceSequencer(state0(), secondsPerStep(120, 4), pat);
    expect(r.events[0].midi).toBe(69);
    expect(r.events[0].waveform).toBe('sine');
  });

  it('rests (midi===null) are NOT fired as NoteFire events', () => {
    const pat = minimalPattern();
    const r = advanceSequencer(state0(), secondsPerStep(120, 4), pat);
    for (const ev of r.events) {
      // A NoteFire may carry null midi only if explicitly chosen; for rests we
      // expect the advance layer to omit them entirely (no silent fires).
      expect(ev.midi).not.toBeNull();
    }
  });

  it('multiple notes on multiple tracks at the same step all fire', () => {
    const pat: Pattern = {
      bpm: 120,
      stepsPerBeat: 4,
      stepsPerPattern: 4,
      tracks: [
        {
          name: 'a',
          waveform: 'sine',
          volume: 0.2,
          sequence: [0],
          patterns: [[{ midi: 60 }, { midi: null }, { midi: null }, { midi: null }]],
        },
        {
          name: 'b',
          waveform: 'square',
          volume: 0.2,
          sequence: [0],
          patterns: [[{ midi: 72 }, { midi: null }, { midi: null }, { midi: null }]],
        },
      ],
    };
    const r = advanceSequencer(state0(), secondsPerStep(120, 4), pat);
    const midis = r.events.map((e) => e.midi).sort();
    expect(midis).toEqual([60, 72]);
  });

  it('advancing by N×stepDur fires N steps (in order)', () => {
    const pat = minimalPattern(); // notes at 0 and 2
    const stepDur = secondsPerStep(120, 4);
    const r = advanceSequencer(state0(), stepDur * 3, pat);
    const midis = r.events.map((e) => e.midi);
    // Step 0 (midi 69), step 1 (rest, skipped), step 2 (midi 71).
    expect(midis).toEqual([69, 71]);
  });

  it('whenOffset of the first step is ≥ 0 (never schedule in the past)', () => {
    const pat = minimalPattern();
    const r = advanceSequencer(state0(), secondsPerStep(120, 4), pat);
    for (const ev of r.events) {
      expect(ev.whenOffset).toBeGreaterThanOrEqual(0);
    }
  });

  it('whenOffset increases monotonically across steps in one advance', () => {
    const pat = minimalPattern(); // notes at 0 and 2
    const r = advanceSequencer(state0(), secondsPerStep(120, 4) * 3, pat);
    expect(r.events.length).toBe(2);
    expect(r.events[1].whenOffset).toBeGreaterThan(r.events[0].whenOffset);
  });
});

describe('advanceSequencer — gateS mapping', () => {
  it('gateS === durationSteps × secondsPerStep(bpm, stepsPerBeat)', () => {
    const pat: Pattern = {
      bpm: 100,
      stepsPerBeat: 4,
      stepsPerPattern: 2,
      tracks: [
        {
          name: 'a',
          waveform: 'sine',
          volume: 0.2,
          sequence: [0],
          patterns: [
            [
              { midi: 60, durationSteps: 2 },
              { midi: null },
            ],
          ],
        },
      ],
    };
    const r = advanceSequencer(state0(), 0.5, pat);
    const expected = 2 * secondsPerStep(100, 4);
    expect(r.events[0].gateS).toBeCloseTo(expected, 9);
  });

  it('default durationSteps (1) → gateS === secondsPerStep', () => {
    const pat = minimalPattern();
    const r = advanceSequencer(state0(), secondsPerStep(120, 4), pat);
    expect(r.events[0].gateS).toBeCloseTo(secondsPerStep(120, 4), 9);
  });
});

describe('advanceSequencer — swing', () => {
  // Song-level swing (decision §2): even-indexed steps are on-beat, odd-indexed
  // off-beat steps receive the swing delay. With swingRatio 0.5 the feel is
  // straight (even split); with 0.66 the off-beat is pushed late (long-short).

  function twoStepPattern(): Pattern {
    return {
      bpm: 120,
      stepsPerBeat: 2,
      stepsPerPattern: 2,
      tracks: [
        {
          name: 'a',
          waveform: 'sine',
          volume: 0.2,
          sequence: [0],
          patterns: [
            [
              { midi: 60, durationSteps: 1 },
              { midi: 67, durationSteps: 1 },
            ],
          ],
        },
      ],
    };
  }

  it('odd-indexed off-beat note gets a later whenOffset than the on-beat note', () => {
    const pat = twoStepPattern();
    const stepDur = secondsPerStep(120, 2); // 0.25 s
    const r = advanceSequencer(state0(), stepDur * 2, pat, { swing: 0.66 });
    expect(r.events.length).toBe(2);
    const [onBeat, offBeat] = r.events;
    expect(onBeat.midi).toBe(60); // step 0
    expect(offBeat.midi).toBe(67); // step 1
    expect(offBeat.whenOffset).toBeGreaterThan(onBeat.whenOffset);
  });

  it('at swing=0.5 (straight) the off-beat lands exactly one step after the on-beat', () => {
    const pat = twoStepPattern();
    const stepDur = secondsPerStep(120, 2);
    const r = advanceSequencer(state0(), stepDur * 2, pat, { swing: 0.5 });
    expect(r.events.length).toBe(2);
    const gap = r.events[1].whenOffset - r.events[0].whenOffset;
    expect(gap).toBeCloseTo(stepDur, 9);
  });

  it('at swing=0.66 (triplet) the off-beat lands later than one step', () => {
    const pat = twoStepPattern();
    const stepDur = secondsPerStep(120, 2);
    const r = advanceSequencer(state0(), stepDur * 2, pat, { swing: 0.66 });
    const straightGap = stepDur;
    const swingGap = r.events[1].whenOffset - r.events[0].whenOffset;
    expect(swingGap).toBeGreaterThan(straightGap);
  });

  it('swing defaults to straight (0.5) when omitted', () => {
    const pat = twoStepPattern();
    const stepDur = secondsPerStep(120, 2);
    const withSwing = advanceSequencer(state0(), stepDur * 2, pat, { swing: 0.5 });
    const noSwing = advanceSequencer(state0(), stepDur * 2, pat);
    expect(noSwing.events.map((e) => e.whenOffset)).toEqual(
      withSwing.events.map((e) => e.whenOffset),
    );
  });

  it('does NOT apply swing to even-indexed (on-beat) steps', () => {
    // Step 0 is on-beat; its whenOffset must be 0 regardless of swing.
    const pat = twoStepPattern();
    const stepDur = secondsPerStep(120, 2);
    const straight = advanceSequencer(state0(), stepDur * 2, pat, { swing: 0.5 });
    const swung = advanceSequencer(state0(), stepDur * 2, pat, { swing: 0.75 });
    expect(straight.events[0].whenOffset).toBeCloseTo(swung.events[0].whenOffset, 9);
  });

  it('applies an exact swing delay inside a nonzero advance window', () => {
    const pat = twoStepPattern();
    const stepDur = secondsPerStep(120, 2);
    const windowStart = stepDur / 2;
    const swing = 0.66;
    const r = advanceSequencer(
      { elapsedS: windowStart, stepIndex: 1, loopCount: 0 },
      stepDur,
      pat,
      { swing },
    );
    expect(r.events).toHaveLength(1);
    expect(r.events[0].midi).toBe(67);
    expect(r.events[0].whenOffset).toBeCloseTo(
      stepDur - windowStart + (stepDur * 2 * swing - stepDur),
      9,
    );
  });
});

describe('advanceSequencer — loop wrap', () => {
  it('advancing past stepsPerPattern increments loopCount', () => {
    const pat = minimalPattern(); // 4 steps
    const stepDur = secondsPerStep(120, 4);
    let s = state0();
    // Advance one full pattern length.
    s = advanceSequencer(s, stepDur * pat.stepsPerPattern, pat).next;
    expect(s.loopCount).toBe(1);
    expect(s.stepIndex).toBe(0);
  });

  it('stepIndex wraps into [0, stepsPerPattern)', () => {
    const pat = minimalPattern();
    const stepDur = secondsPerStep(120, 4);
    let s = state0();
    s = advanceSequencer(s, stepDur * (pat.stepsPerPattern + 2), pat).next;
    expect(s.stepIndex).toBeGreaterThanOrEqual(0);
    expect(s.stepIndex).toBeLessThan(pat.stepsPerPattern);
  });

  it('notes fire again on the second loop (the pattern repeats)', () => {
    const pat = minimalPattern();
    const stepDur = secondsPerStep(120, 4);
    let s = state0();
    const collected: NoteFire[] = [];
    // Two full loops.
    for (let i = 0; i < 2; i++) {
      const r = advanceSequencer(s, stepDur * pat.stepsPerPattern, pat);
      collected.push(...r.events);
      s = r.next;
    }
    // The pattern has notes at steps 0 and 2 → 2 notes per loop → 4 total.
    expect(collected.length).toBe(4);
  });
});

describe('advanceSequencer — determinism', () => {
  it('clamps tolerance-included boundary offsets to zero', () => {
    const pattern = minimalPattern();
    const result = advanceSequencer(
      { elapsedS: 0.25000000000000006, stepIndex: 2, loopCount: 0 },
      0.01,
      pattern,
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].whenOffset).toBe(0);
  });

  it('does not drift across repeated fractional deltas at an exact boundary', () => {
    const pattern = minimalPattern();
    const whole = advanceSequencer(state0(), 0.25, pattern);
    let state = state0();
    const events: NoteFire[] = [];
    for (let index = 0; index < 25; index += 1) {
      const part = advanceSequencer(state, 0.01, pattern);
      state = part.next;
      events.push(...part.events);
    }
    expect(events).toEqual(whole.events);
    expect(state.stepIndex).toBe(whole.next.stepIndex);
    expect(state.loopCount).toBe(whole.next.loopCount);
    expect(state.elapsedS).toBeCloseTo(whole.next.elapsedS, 12);
  });

  it('keeps huge finite inputs finite and safe-integer bounded', () => {
    const pattern = minimalPattern();
    const result = advanceSequencer(
      {
        elapsedS: Number.MAX_VALUE,
        stepIndex: Number.MAX_SAFE_INTEGER,
        loopCount: Number.MAX_SAFE_INTEGER,
      },
      Number.MAX_VALUE,
      pattern,
    );
    expect(Number.isFinite(result.next.elapsedS)).toBe(true);
    expect(Number.isSafeInteger(result.next.stepIndex)).toBe(true);
    expect(Number.isSafeInteger(result.next.loopCount)).toBe(true);
    for (const event of result.events) {
      expect(Number.isFinite(event.whenOffset)).toBe(true);
      expect(Number.isFinite(event.gateS)).toBe(true);
    }
  });

  it('sanitizes unsafe finite ordinals even when no time advances', () => {
    const result = advanceSequencer(
      {
        elapsedS: 10,
        stepIndex: 1e100,
        loopCount: 1e200,
      },
      0,
      minimalPattern(),
    );
    expect(result.next.elapsedS).toBe(10);
    expect(Number.isSafeInteger(result.next.stepIndex)).toBe(true);
    expect(Number.isSafeInteger(result.next.loopCount)).toBe(true);
  });

  it('keeps swung event offsets and gates finite at extreme finite tempos', () => {
    const pattern: Pattern = {
      bpm: 4e-307,
      stepsPerBeat: 1,
      stepsPerPattern: 2,
      tracks: [{
        name: 'lead',
        waveform: 'sine',
        volume: 0.2,
        sequence: [0],
        patterns: [[{ midi: null }, { midi: 60, durationSteps: 2 }]],
      }],
    };
    const result = advanceSequencer(state0(), Number.MAX_VALUE, pattern, { swing: 0.75 });
    expect(result.events).toHaveLength(1);
    expect(Number.isFinite(result.events[0].whenOffset)).toBe(true);
    expect(Number.isFinite(result.events[0].gateS)).toBe(true);
    expect(Number.isSafeInteger(result.next.stepIndex)).toBe(true);
    expect(Number.isSafeInteger(result.next.loopCount)).toBe(true);
  });

  it('sanitizes non-finite swing to the straight default', () => {
    const pattern = minimalPattern();
    const stepDur = secondsPerStep(pattern.bpm, pattern.stepsPerBeat);
    const invalid = advanceSequencer(state0(), stepDur * 3, pattern, { swing: Number.NaN });
    const straight = advanceSequencer(state0(), stepDur * 3, pattern, { swing: 0.5 });
    expect(invalid).toEqual(straight);
  });

  it('keeps final state correct when the event iteration cap is reached', () => {
    const pattern: Pattern = {
      bpm: 60,
      stepsPerBeat: 1,
      stepsPerPattern: 1,
      tracks: [{
        name: 'lead',
        waveform: 'sine',
        volume: 0.2,
        sequence: [0],
        patterns: [[{ midi: 60 }]],
      }],
    };
    const steps = 65_540;
    const result = advanceSequencer(state0(), steps, pattern);
    expect(result.events).toHaveLength(65_536);
    expect(result.next).toEqual({ elapsedS: steps, stepIndex: 0, loopCount: steps });
  });

  it('matches a large advance with equivalent fixed advances', () => {
    const pattern = minimalPattern();
    const stepDur = secondsPerStep(pattern.bpm, pattern.stepsPerBeat);
    const whole = advanceSequencer(state0(), stepDur * 20, pattern);
    let state = state0();
    const events: NoteFire[] = [];
    for (let index = 0; index < 20; index += 1) {
      const part = advanceSequencer(state, stepDur, pattern);
      state = part.next;
      events.push(...part.events);
    }
    expect(events.map(({ midi, waveform, peak, gateS }) => ({ midi, waveform, peak, gateS })))
      .toEqual(whole.events.map(({ midi, waveform, peak, gateS }) => ({ midi, waveform, peak, gateS })));
    expect(state).toEqual(whole.next);
  });

  it('same (state, dt, pattern) → byte-identical events', () => {
    const pat = generatePattern(42);
    const stepDur = secondsPerStep(pat.bpm, pat.stepsPerBeat);
    const a = advanceSequencer(state0(), stepDur * 4, pat);
    const b = advanceSequencer(state0(), stepDur * 4, pat);
    expect(a.events).toEqual(b.events);
    expect(a.next).toEqual(b.next);
  });

  it('a long dt sequence produces identical event streams across two runs', () => {
    const pat = generatePattern(42);
    const stepDur = secondsPerStep(pat.bpm, pat.stepsPerBeat);
    const dts = [stepDur * 0.5, stepDur, stepDur * 2, stepDur * 3, stepDur * 0.25];
    let sa = state0();
    let sb = state0();
    const ea: NoteFire[] = [];
    const eb: NoteFire[] = [];
    for (const dt of dts) {
      const ra = advanceSequencer(sa, dt, pat);
      const rb = advanceSequencer(sb, dt, pat);
      ea.push(...ra.events);
      eb.push(...rb.events);
      sa = ra.next;
      sb = rb.next;
    }
    expect(ea).toEqual(eb);
    expect(sa).toEqual(sb);
  });

  it('peak resolves to (note.peak ?? track.volume) — deterministic', () => {
    const pat: Pattern = {
      bpm: 120,
      stepsPerBeat: 4,
      stepsPerPattern: 2,
      tracks: [
        {
          name: 'a',
          waveform: 'sine',
          volume: 0.4,
          sequence: [0],
          patterns: [
            [
              { midi: 60, peak: 0.7 },
              { midi: 61 },
            ],
          ],
        },
      ],
    };
    const r = advanceSequencer(state0(), secondsPerStep(120, 4) * 2, pat);
    const explicit = r.events.find((e) => e.midi === 60);
    const inherited = r.events.find((e) => e.midi === 61);
    expect(explicit?.peak).toBeCloseTo(0.7, 9);
    expect(inherited?.peak).toBeCloseTo(0.4, 9);
  });
});

describe('advanceSequencer — state progression', () => {
  it('elapsedS increases by dt', () => {
    const pat = minimalPattern();
    const r = advanceSequencer(state0(), 0.3, pat);
    expect(r.next.elapsedS).toBeCloseTo(0.3, 9);
  });

  it('dt=0 leaves elapsedS unchanged', () => {
    const pat = minimalPattern();
    const r = advanceSequencer({ elapsedS: 1, stepIndex: 2, loopCount: 0 }, 0, pat);
    expect(r.next.elapsedS).toBe(1);
  });
});
