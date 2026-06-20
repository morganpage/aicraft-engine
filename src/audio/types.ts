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
 * from event handlers or the game loop.
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
