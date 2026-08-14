/**
 * Type contract for the WebAudio SFX adapter.
 *
 * @module
 */

/**
 * WebAudio synthesized SFX adapter. Zero audio assets — every sound is
 * generated on the fly from oscillators + a reused white-noise buffer.
 *
 * Defensive by design: every playback method is a no-op when muted,
 * pre-unlock, or when WebAudio is unavailable (Node/SSR/old browsers).
 * All synthesis errors are swallowed. Audio is decorative — a game never
 * crashes because audio failed.
 *
 * Create via {@link createAudioAdapter}. Call `unlock()` on the first user
 * gesture (browser autoplay policy). Then call `playTone`/`playNoise`
 * one-shots from event edges, and `startNoiseLoop` for sustained sounds
 * (wall scrapes, wind) that run until their handle is stopped.
 */
export interface AudioAdapter {
  /**
   * Create/resume the `AudioContext` on a user gesture. Idempotent — safe to
   * call on every keydown/pointerdown/touchstart. After the first successful
   * call, playback is armed. No-op without WebAudio.
   */
  unlock(): void;

  /** Whether the context has been unlocked (armed for playback). */
  isUnlocked(): boolean;

  /**
   * Play a synthesized oscillator tone with attack/decay envelope and an
   * optional frequency sweep. No-op when muted, pre-unlock, or without WebAudio.
   *
   * @param type   - oscillator waveform: 'sine' | 'square' | 'sawtooth' | 'triangle'
   * @param f0     - start frequency (Hz)
   * @param f1     - end frequency (Hz); same as f0 for no sweep
   * @param durMs  - duration in milliseconds
   * @param peak   - peak gain [0, 1] (loudness)
   * @param whenS  - seconds offset from "now" for scheduling sequential notes. Default 0.
   */
  playTone(
    type: OscillatorType,
    f0: number,
    f1: number,
    durMs: number,
    peak: number,
    whenS?: number,
  ): void;

  /**
   * Play a filtered white-noise burst. No-op when muted, pre-unlock, or without WebAudio.
   *
   * Each burst starts at a RANDOM offset inside the shared noise buffer, so
   * overlapping/retriggered bursts de-correlate instead of comb-filtering —
   * a rate-limited burst pattern never phase-locks into a retrigger buzz.
   *
   * @param durMs      - duration in milliseconds
   * @param filterType - biquad filter type: 'lowpass' | 'highpass' | 'bandpass'
   * @param freq       - filter cutoff frequency (Hz)
   * @param peak       - peak gain [0, 1]
   * @param whenS      - seconds offset from "now". Default 0.
   */
  playNoise(
    durMs: number,
    filterType: BiquadFilterType,
    freq: number,
    peak: number,
    whenS?: number,
  ): void;

  /**
   * Start a sustained, looping filtered-noise voice — scrapes, wind, hums,
   * anything that sounds until switched off. Returns a {@link NoiseLoopHandle};
   * call `stop()` on it when the sustained state ends. Start it on the state's
   * onset edge, NEVER once per tick.
   *
   * Always returns a usable handle — an inert no-op handle when muted,
   * pre-unlock, disposed, or without WebAudio — so callers never null-check.
   *
   * @param filterType - biquad filter type: 'lowpass' | 'highpass' | 'bandpass'
   * @param freq       - filter cutoff frequency (Hz)
   * @param peak       - sustained gain [0, 1]
   */
  startNoiseLoop(
    filterType: BiquadFilterType,
    freq: number,
    peak: number,
  ): NoiseLoopHandle;

  /** Set the global mute flag. Applied to master gain with a short ramp (no clicks). */
  setMuted(value: boolean): void;

  /** Current mute flag. */
  isMuted(): boolean;

  /** Set SFX volume [0, 1]. Clamped. Applied to master gain immediately. */
  setVolume(value: number): void;

  /** Current volume [0, 1]. */
  getVolume(): number;

  /** Tear down: close the AudioContext, release resources. Idempotent. */
  dispose(): void;
}

/**
 * Control handle for a sustained noise loop started by
 * {@link AudioAdapter.startNoiseLoop}. Every method is safe to call in any
 * state (pre-unlock, muted, disposed, after adapter teardown) — audio is
 * decorative, the handle never throws.
 */
export interface NoiseLoopHandle {
  /**
   * Fade the loop out over ~0.1 s and release it (a natural tail — no click).
   * Idempotent; a handle from an inert (no-op) start is permanently stopped.
   */
  stop(): void;

  /**
   * Update the loop's loudness (clamped to [0, 1]) with a short ramp — e.g.
   * scrape volume following slide speed. No-op after `stop()`.
   */
  setPeak(peak: number): void;

  /** Whether the loop is still sounding (false after `stop()`). */
  isPlaying(): boolean;
}
