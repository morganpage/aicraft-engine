/**
 * Two-clock lookahead sequencer adapter (Layer 4 — host-touching).
 *
 * Implements Chris Wilson's canonical "A Tale of Two Clocks" scheduler:
 *   - A `setTimeout` chain polls every `LOOKAHEAD_MS` (25 ms).
 *   - Each poll pre-queues every note whose `nextNoteTime` falls within
 *     `SCHEDULE_AHEAD_S` (0.1 s) of `audio.currentTime`.
 *   - Each queued note becomes an `audio.playTone(type, freq, freq, durMs,
 *     peak × musicVolume, whenS)` call.
 *
 * Reuses the consumer's {@link AudioAdapter} — does NOT create a second
 * `AudioContext`. The consumer calls `audio.unlock()` once on a user gesture;
 * the sequencer reuses the unlocked context (decision §7).
 *
 * Layer-contract: the host adapter CONSUMES the pure advance layer
 * ({@link advanceSequencer}). It owns a {@link SequencerState} in lockstep
 * with the audio-clock cursor `nextNoteTime` via the invariant
 * `nextNoteTime === patternStartClock + advanceState.elapsedS`. Each event's
 * absolute audio-clock fire time is therefore `nextNoteTime + ev.whenOffset`,
 * and the `whenS` passed to `playTone` is `(nextNoteTime + ev.whenOffset) −
 * now`. The advance layer supplies the NoteFire data (midi / waveform / peak
 * / gateS) plus the swing-delayed `whenOffset` — the host adapter only adds
 * wall-clock translation and the music-volume scaling.
 *
 * Defensive contract (mirrors `src/audio/factory.ts`):
 *   - Lazy `audio.currentTime` resolution inside the scheduler tick — never
 *     at module load or factory call.
 *   - Swallow all errors. Never-throw public API.
 *   - No-op when audio is not unlocked, when disposed, or when WebAudio is
 *     unavailable.
 *   - Idempotent `stop()` and `dispose()`.
 *
 * `setVolume(v)` scales the `peak` argument of every subsequent `playTone`
 * call by the music-volume factor — pure multiplication, independent of the
 * AudioAdapter's own SFX volume (decision §8). No extra gain nodes, no
 * second context.
 *
 * @module
 */

import type { AudioAdapter } from '../audio/types';
import {
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SWING,
  LOOKAHEAD_MS,
  SCHEDULE_AHEAD_S,
} from './constants';
import { advanceSequencer } from './advance';
import { noteToFrequency, secondsPerStep } from './theory';
import type { NoteFire, Pattern, Sequencer, SequencerConfig, SequencerState } from './types';

/** Cap on consecutive steps scheduled in a single tick — defends against a runaway loop if the audio clock jumps backward. */
const MAX_STEPS_PER_TICK = 1024;

/**
 * Create a sequencer that plays a {@link Pattern} via the supplied
 * {@link AudioAdapter}. Reuses the adapter — does NOT create a second
 * `AudioContext`. Uses Chris Wilson's two-clock lookahead scheduler.
 *
 * The sequencer is defensive: every method is a no-op when audio is locked,
 * disposed, or unavailable; every error is swallowed; `stop()` and
 * `dispose()` are idempotent.
 *
 * @param audio   - The consumer's unlocked AudioAdapter (shared with SFX).
 * @param pattern - The pattern to play (looped indefinitely until `stop`).
 * @param config  - Optional scheduler tuning. All fields have proven defaults.
 * @returns A {@link Sequencer} instance.
 *
 * @example
 * ```ts
 * const audio = createAudioAdapter();
 * audio.unlock();
 * const seq = createSequencer(audio, generatePattern(42));
 * seq.play();
 * // ... later, on scene exit:
 * seq.stop();
 * seq.dispose();
 * ```
 */
export function createSequencer(
  audio: AudioAdapter,
  pattern: Pattern,
  config?: SequencerConfig,
): Sequencer {
  const lookaheadMs = config?.lookaheadMs ?? LOOKAHEAD_MS;
  const scheduleAheadS = config?.scheduleAheadS ?? SCHEDULE_AHEAD_S;
  const swing = config?.swing ?? DEFAULT_SWING;

  /** Music volume multiplier — scales `peak` on every `playTone` call. */
  let musicVolume = DEFAULT_MUSIC_VOLUME;
  /** Whether playback is armed. */
  let playing = false;
  /** Hard kill-switch set by `dispose()`. */
  let disposed = false;
  /** Active `setTimeout` handle for the scheduler chain. */
  let timerId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Audio-clock cursor — absolute time at which the NEXT step's nominal
   * boundary falls. Anchored at `patternStartClock` on `play()` and advanced
   * by `stepDur` after each scheduled step. Mirrors Chris Wilson's
   * `nextNoteTime`.
   */
  let nextNoteTime = 0;
  /**
   * The audio-clock time at which playback started (= the value of
   * `audio.currentTime` when `play()` was called). Combined with
   * `advanceState.elapsedS` it preserves the invariant
   * `nextNoteTime === patternStartClock + advanceState.elapsedS`.
   */
  let patternStartClock = 0;
  /**
   * Pure-advance state mirror, kept in lockstep with `nextNoteTime`. The
   * advance layer computes NoteFire events (with swing applied) and resolves
   * note vs. track defaults; the host adapter only translates timing.
   */
  let advanceState: SequencerState = { elapsedS: 0, stepIndex: 0, loopCount: 0 };

  /**
   * Read the audio clock defensively. Returns `0` (treated as "not ready")
   * if `audio.currentTime` is unavailable or throws. The `AudioAdapter`
   * interface doesn't declare `currentTime` (it's an implementation detail
   * of the WebAudio context), so we cast through `unknown` to read it
   * lazily.
   */
  function readClock(): number {
    try {
      const t = (audio as unknown as { currentTime?: number }).currentTime;
      return typeof t === 'number' && Number.isFinite(t) ? t : 0;
    } catch {
      return 0;
    }
  }

  /** Defensive `isUnlocked` — never throws. */
  function isUnlocked(): boolean {
    try {
      return audio.isUnlocked();
    } catch {
      return false;
    }
  }

  /**
   * Lookahead scheduler tick. Schedules every step whose nominal time falls
   * within `[now, now + scheduleAheadS]`, then re-arms the `setTimeout`
   * chain. Swallows all errors.
   *
   * For each step:
   *   1. Call {@link advanceSequencer} with `dt = stepDur` starting from
   *      `advanceState`. The advance layer emits the step's NoteFire events
   *      (with swing applied to off-beats) plus the next state.
   *   2. For each event: `whenS = (nextNoteTime + ev.whenOffset) − now`.
   *      Schedule via `audio.playTone(..., peak × musicVolume, whenS)`.
   *   3. Advance `nextNoteTime += stepDur` and `advanceState = result.next`.
   */
  function scheduler(): void {
    if (disposed || !playing) return;
    if (!isUnlocked()) {
      armTimer();
      return;
    }

    try {
      const now = readClock();
      const stepDur = secondsPerStep(pattern.bpm, pattern.stepsPerBeat);
      if (!(stepDur > 0)) {
        armTimer();
        return;
      }

      let stepsThisTick = 0;
      while (nextNoteTime < now + scheduleAheadS && stepsThisTick < MAX_STEPS_PER_TICK) {
        // Drive the pure advance layer one step at a time. dt = stepDur
        // ensures exactly one step boundary is crossed per call (we always
        // start at a boundary), so `result.events` holds exactly this step's
        // notes.
        const result = advanceSequencer(advanceState, stepDur, pattern, { swing });
        for (const ev of result.events) {
          // ev.whenOffset is seconds-from-advanceState.elapsedS; absolute
          // audio-clock fire time = nextNoteTime + ev.whenOffset (invariant).
          const whenS = nextNoteTime + ev.whenOffset - now;
          scheduleNote(ev, whenS);
        }
        advanceState = result.next;
        nextNoteTime += stepDur;
        stepsThisTick += 1;
      }
    } catch {
      // Swallow — audio is decorative.
    }

    armTimer();
  }

  /**
   * Schedule one NoteFire as a `playTone` call. Translates MIDI → Hz, scales
   * peak by the music volume, and passes the gate as `durMs`. Clamps
   * negative `whenS` to 0 (defensive — should never happen with a correct
   * lookahead, but guards against audio-clock jumps). Swallows all errors.
   */
  function scheduleNote(ev: NoteFire, whenS: number): void {
    if (ev.midi === null) return;
    try {
      const freq = noteToFrequency(ev.midi);
      const peak = ev.peak * musicVolume;
      const durMs = ev.gateS * 1000;
      const clampedWhenS = whenS > 0 ? whenS : 0;
      audio.playTone(ev.waveform, freq, freq, durMs, peak, clampedWhenS);
    } catch {
      // Swallow — audio is decorative.
    }
  }

  /** Re-arm the setTimeout chain if still playing and not disposed. */
  function armTimer(): void {
    if (disposed || !playing) return;
    try {
      timerId = setTimeout(scheduler, lookaheadMs);
    } catch {
      // setTimeout can throw in rare environments (e.g. removed globals).
      timerId = null;
    }
  }

  /** Clear any pending setTimeout. Idempotent. */
  function clearTimer(): void {
    if (timerId !== null) {
      try {
        clearTimeout(timerId);
      } catch {
        // Swallow.
      }
      timerId = null;
    }
  }

  return {
    play(): void {
      if (disposed) return;
      if (playing) return;
      // No-op when audio is not unlocked — the consumer must call
      // `audio.unlock()` first (browser autoplay policy). Matches the
      // proposal usage pattern: `audio.unlock(); seq.play();`.
      if (!isUnlocked()) return;
      playing = true;
      // Reset the cursor + state so playback starts from step 0.
      advanceState = { elapsedS: 0, stepIndex: 0, loopCount: 0 };
      // Anchor nextNoteTime at the current audio clock. readClock() is lazy
      // — it touches the host only here, inside play(), never at module load
      // or factory-call time.
      patternStartClock = readClock();
      nextNoteTime = patternStartClock;
      // Kick the scheduler immediately (no need to wait one lookahead).
      scheduler();
    },

    stop(): void {
      if (disposed) return;
      if (!playing) return;
      playing = false;
      clearTimer();
    },

    isPlaying(): boolean {
      return playing && !disposed;
    },

    setVolume(value: number): void {
      if (disposed) return;
      const v = Number.isFinite(value) ? value : 0;
      musicVolume = v < 0 ? 0 : v > 1 ? 1 : v;
    },

    getVolume(): number {
      return musicVolume;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      playing = false;
      clearTimer();
    },
  };
}
