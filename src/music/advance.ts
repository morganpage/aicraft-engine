/**
 * Pure sequencer state + step walker (Layer 3).
 *
 * Mirrors the pure-progression-ops pattern established by `advanceEmission`
 * (`src/particles/emitter.ts`) and `advanceTween` (`src/easing/tween.ts`):
 *   - The consumer owns a {@link SequencerState}.
 *   - Each call to {@link advanceSequencer} advances the state by `dt`
 *     seconds and returns `{ next, events }`.
 *   - Input state is NEVER mutated; `next` is a brand-new object.
 *   - NEVER throws — degenerate `dt`, empty patterns, and out-of-range state
 *     all collapse to silent no-ops.
 *
 * Determinism contract (the seam):
 *   - No host access. No `audio.currentTime`. No `Math.random`. No `Date.now`.
 *   - No `setTimeout`. Same `(state, dt, pattern, opts)` → byte-identical
 *     `events` forever, on every JS engine.
 *   - The host adapter (Layer 4) consumes the returned `events` and maps each
 *     to an `audio.playTone(...)` call at wall-clock time.
 *
 * Step firing rule:
 *   - Each step occupies `secondsPerStep(bpm, stepsPerBeat)` seconds.
 *   - When the elapsed-time window `(state.elapsedS, state.elapsedS + dt]`
 *     crosses a step boundary, every non-rest note at that step on every
 *     track fires once.
 *   - `events[i].whenOffset` is the seconds-from-window-start when the step
 *     begins; `events[i].gateS` is `note.durationSteps × secondsPerStep`.
 *
 * Swing (decision §2, song-level):
 *   - Even-indexed steps (0, 2, 4, …) are "on-beat" — no swing offset.
 *   - Odd-indexed off-beat steps receive the swing delay relative to their
 *     nominal position. With `swingRatio = 0.5` the feel is straight; with
 *     `0.66` the off-beat is pushed late (long-short).
 *
 * Loop wrap:
 *   - `stepIndex` wraps modulo `pattern.stepsPerPattern`.
 *   - `loopCount` increments each time the walk crosses the pattern boundary.
 *
 * @module
 */

import { DEFAULT_SWING } from './constants';
import { secondsPerStep, swingLongDuration } from './theory';
import type {
  AdvanceOptions,
  NoteEvent,
  NoteFire,
  Pattern,
  SequencerState,
  Track,
} from './types';

/** Empty events array singleton — returned when no notes fire. */
const NO_EVENTS: readonly NoteFire[] = Object.freeze([]);
const MAX_SAFE_ORDINAL = Number.MAX_SAFE_INTEGER - 1;
const MAX_EVENT_ITERATIONS = 65_536;

function safeNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_SAFE_ORDINAL, Math.max(0, Math.floor(value)));
}

function finiteResult(value: number, fallbackSign = 1): number {
  if (Number.isFinite(value)) return value;
  return fallbackSign < 0 ? -Number.MAX_VALUE : Number.MAX_VALUE;
}

function boundaryTolerance(timeS: number, stepDur: number): number {
  return Number.EPSILON * 16 * Math.max(1, Math.abs(timeS), stepDur);
}

function ordinalAtOrAfter(timeS: number, stepDur: number): number {
  const adjusted = Math.max(0, timeS - boundaryTolerance(timeS, stepDur));
  const ordinal = Math.ceil(adjusted / stepDur);
  if (!Number.isSafeInteger(ordinal)) return MAX_SAFE_ORDINAL;
  return Math.max(0, Math.min(MAX_SAFE_ORDINAL, ordinal));
}

/**
 * Advance the sequencer by `dt` seconds. Returns the next state plus any note
 * events whose step boundary was crossed during the advance.
 *
 * Pure: input state is never mutated; `next` is a fresh object; the function
 * never throws (degenerate `dt`, empty patterns, malformed state all
 * collapse to silent no-ops).
 *
 * @param state   - Current sequencer state (consumer-owned).
 * @param dt      - Time delta in seconds (from the scheduler tick or
 *                  fixed-step loop). Negative / NaN / non-finite → treated as 0.
 * @param pattern - The pattern to walk. Empty / malformed → no events.
 * @param opts    - Optional swing ratio (`[0.5, 0.75]`). Default straight.
 * @returns `{ next, events }`. `events` is empty when no step boundary is
 *          crossed.
 *
 * @example
 * ```ts
 * let state: SequencerState = { elapsedS: 0, stepIndex: 0, loopCount: 0 };
 * const stepDur = secondsPerStep(pattern.bpm, pattern.stepsPerBeat);
 * // each scheduler tick:
 * const { next, events } = advanceSequencer(state, stepDur, pattern);
 * for (const ev of events) {
 *   audio.playTone(ev.waveform, freq(ev.midi), freq(ev.midi),
 *                  ev.gateS * 1000, ev.peak * musicVolume, ev.whenOffset);
 * }
 * state = next;
 * ```
 */
export function advanceSequencer(
  state: SequencerState,
  dt: number,
  pattern: Pattern,
  opts?: AdvanceOptions,
): { readonly next: SequencerState; readonly events: readonly NoteFire[] } {
  try {
    return advanceSequencerUnsafe(state, dt, pattern, opts);
  } catch {
    return { next: sanitizeState(state), events: NO_EVENTS };
  }
}

function sanitizeState(state: SequencerState): SequencerState {
  try {
    return {
      elapsedS: Number.isFinite(state?.elapsedS) && state.elapsedS >= 0 ? state.elapsedS : 0,
      stepIndex: safeNonNegativeInteger(state?.stepIndex),
      loopCount: safeNonNegativeInteger(state?.loopCount),
    };
  } catch {
    return { elapsedS: 0, stepIndex: 0, loopCount: 0 };
  }
}

function advanceSequencerUnsafe(
  state: SequencerState,
  dt: number,
  pattern: Pattern,
  opts?: AdvanceOptions,
): { readonly next: SequencerState; readonly events: readonly NoteFire[] } {
  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const stepsPerPattern = safeNonNegativeInteger(pattern?.stepsPerPattern);
  const tracks = Array.isArray(pattern?.tracks) ? pattern.tracks : [];
  const hasSteps =
    stepsPerPattern > 0 &&
    tracks.length > 0 &&
    tracks.every((t) => Array.isArray(t?.patterns) && t.patterns.length > 0);

  const { elapsedS, stepIndex, loopCount } = sanitizeState(state);

  if (!hasSteps || safeDt === 0) {
    return {
      next: { elapsedS, stepIndex, loopCount },
      events: NO_EVENTS,
    };
  }

  const stepDur = secondsPerStep(pattern.bpm, pattern.stepsPerBeat);
  if (!Number.isFinite(stepDur) || !(stepDur > 0)) {
    return {
      next: { elapsedS, stepIndex, loopCount },
      events: NO_EVENTS,
    };
  }

  const requestedSwing = opts?.swing;
  const swingRatio = Number.isFinite(requestedSwing) ? requestedSwing! : DEFAULT_SWING;

  const maxElapsedForStep = Math.min(Number.MAX_VALUE, MAX_SAFE_ORDINAL * stepDur);
  const windowStart = Math.min(elapsedS, maxElapsedForStep);
  const rawWindowEnd = windowStart + safeDt;
  const windowEnd = Math.min(
    maxElapsedForStep,
    Number.isFinite(rawWindowEnd) ? rawWindowEnd : maxElapsedForStep,
  );
  if (!(windowEnd > windowStart)) {
    return {
      next: { elapsedS: windowStart, stepIndex, loopCount },
      events: NO_EVENTS,
    };
  }

  const events: NoteFire[] = [];
  const rawOrdinal = loopCount * stepsPerPattern + (stepIndex % stepsPerPattern);
  let ordinal = Number.isSafeInteger(rawOrdinal)
    ? Math.max(0, rawOrdinal)
    : MAX_SAFE_ORDINAL;
  const firstWindowOrdinal = ordinalAtOrAfter(windowStart, stepDur);
  if (ordinal < firstWindowOrdinal) ordinal = firstWindowOrdinal;
  const endOrdinal = Math.max(ordinal, ordinalAtOrAfter(windowEnd, stepDur));
  let iter = 0;

  while (ordinal < endOrdinal && iter < MAX_EVENT_ITERATIONS) {
    const boundaryS = ordinal * stepDur;

    const localStep = ordinal % stepsPerPattern;
    const isOffBeat = localStep % 2 === 1;
    // Odd-indexed off-beat steps get pushed late by the swing excess
    // (longDuration − stepDur) of a 2-step pair. Even-indexed on-beats are
    // untouched (decision §2).
    const swingDelay = isOffBeat ? swingLongDuration(stepDur * 2, swingRatio) - stepDur : 0;
    const firedAt = finiteResult(boundaryS + swingDelay);
    const rawOffset = firedAt - windowStart;
    // Tolerance-based boundary inclusion can deliberately include a boundary
    // a few ulps behind windowStart. Host scheduling offsets are never
    // negative, so collapse that floating-point residue to an immediate fire.
    const whenOffset = Math.max(
      0,
      finiteResult(rawOffset, firedAt < windowStart ? -1 : 1),
    );

    fireStep(pattern, localStep, whenOffset, events);

    ordinal += 1;
    iter += 1;
  }

  const finalStepIndex = endOrdinal % stepsPerPattern;
  const finalLoopCount = Math.floor(endOrdinal / stepsPerPattern);

  return {
    next: {
      elapsedS: windowEnd,
      stepIndex: finalStepIndex,
      loopCount: finalLoopCount,
    },
    events,
  };
}

/**
 * Fire every non-rest note at `stepIndex` on every track of `pattern`.
 *
 * Each fired note becomes a {@link NoteFire} with:
 *   - `midi` / `waveform` / `peak` resolved from the note (or track default).
 *   - `gateS = (note.durationSteps ?? 1) × secondsPerStep(bpm, stepsPerBeat)`.
 *   - `whenOffset` = the supplied firing time relative to the window start.
 */
function fireStep(
  pattern: Pattern,
  stepIndex: number,
  whenOffset: number,
  out: NoteFire[],
): void {
  const stepDur = secondsPerStep(pattern.bpm, pattern.stepsPerBeat);
  for (const track of pattern.tracks) {
    try {
      const ev = noteAt(track, stepIndex);
      if (ev === null || ev.midi === null || !Number.isFinite(ev.midi)) continue;
      const durationSteps = Number.isFinite(ev.durationSteps) ? Math.max(0, ev.durationSteps!) : 1;
      const rawGateS = durationSteps * stepDur;
      out.push({
        midi: ev.midi,
        waveform: ev.waveform ?? track.waveform,
        peak: Number.isFinite(ev.peak) ? ev.peak! : track.volume,
        gateS: finiteResult(rawGateS),
        whenOffset,
      });
    } catch {
      // A malformed track is silent; advancing the song remains never-throwing.
    }
  }
}

/**
 * Resolve the {@link NoteEvent} at `stepIndex` on `track`, or `null` if the
 * step is out of range or the track has no pattern at the active sequence
 * index.
 *
 * The sequence wraps modulo its length; the pattern index it points at is
 * used directly (clamped to `patterns.length - 1` if out of range to fail
 * silent rather than throw).
 */
function noteAt(track: Track, stepIndex: number): NoteEvent | null {
  if (track.sequence.length === 0) return null;
  const seqIdx = track.sequence[stepIndex % track.sequence.length];
  if (seqIdx < 0 || seqIdx >= track.patterns.length) return null;
  const pat = track.patterns[seqIdx];
  if (stepIndex < 0 || stepIndex >= pat.length) return null;
  return pat[stepIndex] ?? null;
}
