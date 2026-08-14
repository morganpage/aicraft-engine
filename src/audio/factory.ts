/**
 * WebAudio SFX adapter factory.
 *
 * Ports the reference synthesis engine into the library's per-instance
 * factory pattern (matching `createKeyboardAdapter` / `createTouchButton`).
 * Each {@link createAudioAdapter} call creates an independent adapter with
 * its own private closure state — no module-level globals.
 *
 * Defensive adapter (host-touching layer). Follows `src/primitives/motion.ts`:
 *   - Lazy `AudioContext` resolution on first `unlock()` — never at module load
 *     or factory call. Required by browser autoplay policy (user gesture).
 *   - Swallow all errors in every public method. Never throws.
 *   - No-op fallback in Node / SSR / old browsers (no `window` / `AudioContext`).
 *
 * The library ships the generic infrastructure — `playTone` / `playNoise`
 * one-shots plus `startNoiseLoop` for sustained sounds — NOT the
 * game-specific recipe table. Consumers compose sounds from these primitives
 * (see the reference `playSound` switch for the recipe pattern).
 *
 * `Math.random()` fills the white-noise buffer and picks each burst's playback
 * offset. Both are explicitly allowed: they are decorative audio side-effects,
 * NOT deterministic simulation logic. The determinism rules in
 * `docs/architecture.md` only ban `Math.random` in the pure core (color math,
 * RNG seeding, entitlements, save ops). Audio output can never leak back into
 * game state. The random offset exists so overlapping/retriggered bursts
 * de-correlate: identical same-sample-0 restarts phase-lock into a buzz
 * (60 retriggers/s of the same buffer ≈ a 60 Hz tone).
 *
 * @module
 */

import type { AudioAdapter, NoiseLoopHandle } from './types';
import { DEFAULT_AUDIO_VOLUME } from './constants';

/** Time constant (seconds) for the master-gain ramp — prevents click on mute. */
const MASTER_RAMP_TC = 0.015;
/** Attack time (seconds) for the tone envelope. */
const TONE_ATTACK_S = 0.005;
/** Attack time (seconds) for the noise envelope (shorter — sharper transient). */
const NOISE_ATTACK_S = 0.003;
/** Release fade (seconds) for sustained noise loops on stop() — natural tail. */
const LOOP_RELEASE_S = 0.1;
/** Tail (seconds) added after the envelope decay before stop() to avoid clicks. */
const STOP_TAIL_S = 0.02;
/** Sub-audible floor used as the gain envelope baseline (never literal 0). */
const GAIN_FLOOR = 0.0001;

/**
 * Clamp a number into [0, 1]; non-finite input collapses to 0.
 */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * A permanently-stopped {@link NoiseLoopHandle}. Returned by
 * `startNoiseLoop` when no voice could be created (pre-unlock, muted,
 * disposed, no WebAudio, or a swallowed synthesis error), so callers never
 * null-check or special-case the returned handle — audio is decorative.
 */
function createInertNoiseLoopHandle(): NoiseLoopHandle {
  return {
    stop(): void {},
    setPeak(): void {},
    isPlaying(): boolean {
      return false;
    },
  };
}

/**
 * Create a WebAudio SFX adapter. Lazily resolves `window.AudioContext`
 * (or `webkitAudioContext` for older Safari) on first `unlock()` — never
 * at module load or factory call. In Node/SSR/test (no `window`), every
 * method is a silent no-op. Never throws.
 *
 * Each call produces an independent adapter with its own private
 * `AudioContext`, master gain, and noise buffer.
 *
 * @returns The audio adapter.
 *
 * @example
 * ```ts
 * const audio = createAudioAdapter();
 * // on first user gesture:
 * audio.unlock();
 * // from event handlers / game loop:
 * audio.playTone('sine', 200, 400, 80, 0.3);   // jump "boop"
 * audio.playNoise(50, 'lowpass', 420, 0.45);    // land "thud"
 * // sustained sound (start on the onset edge, stop when the state ends):
 * const scrape = audio.startNoiseLoop('lowpass', 600, 0.06); // wall slide
 * scrape.stop();                                             // slide over
 * ```
 */
export function createAudioAdapter(): AudioAdapter {
  /** Resolved lazily by `ensureContext()` on the first `unlock()`. */
  let ctx: AudioContext | null = null;
  /** Master gain every voice passes through. `muted ? 0 : volume`. */
  let master: GainNode | null = null;
  /** One-second white-noise buffer reused by every noise-based sound. */
  let noiseBuffer: AudioBuffer | null = null;

  /** True once `unlock()` has run successfully on a user gesture. */
  let unlocked = false;
  /** Hard kill-switch applied on top of `volume`. */
  let muted = false;
  /** Normalized SFX volume [0, 1]. */
  let volume = DEFAULT_AUDIO_VOLUME;
  /** True after `dispose()` — all subsequent calls are no-ops. */
  let disposed = false;

  /**
   * Lazily create the `AudioContext` + master gain + noise buffer. Returns the
   * context (cached) or `null` when WebAudio is unavailable. Never throws —
   * every failure path collapses to `null` so callers treat audio as best-effort.
   */
  function ensureContext(): AudioContext | null {
    if (ctx) return ctx;
    try {
      const w = (typeof window !== 'undefined' ? window : undefined) as
        | (Window &
            typeof globalThis & { webkitAudioContext?: typeof AudioContext })
        | undefined;
      if (!w) return null;
      const Ctor: typeof AudioContext | undefined = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) return null;
      const audio = new Ctor();
      const gain = audio.createGain();
      gain.connect(audio.destination);
      ctx = audio;
      master = gain;
      noiseBuffer = createNoiseBuffer(audio);
      applyMasterGain();
      return ctx;
    } catch {
      ctx = null;
      master = null;
      noiseBuffer = null;
      return null;
    }
  }

  /**
   * Create a one-second mono white-noise buffer. Reused by every noise-based
   * sound so we don't allocate per shot.
   *
   * Uses `Math.random()` — this is a decorative audio side-effect, NOT
   * deterministic game logic. The noise cannot leak back into the simulation.
   */
  function createNoiseBuffer(audio: AudioContext): AudioBuffer {
    const length = Math.max(1, Math.floor(audio.sampleRate));
    const buf = audio.createBuffer(1, length, audio.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  /**
   * Apply the current `muted` / `volume` to the master gain. Uses a short ramp
   * (`setTargetAtTime`) to avoid clicks when toggling mute mid-sound. Falls back
   * to a hard `.value` set if `setTargetAtTime` throws (e.g. closed context).
   * No-op if the context has not been created yet.
   */
  function applyMasterGain(): void {
    if (!master || !ctx) return;
    const target = muted ? 0 : volume;
    try {
      master.gain.setTargetAtTime(target, ctx.currentTime, MASTER_RAMP_TC);
    } catch {
      try {
        master.gain.value = target;
      } catch {
        // give up silently
      }
    }
  }

  return {
    unlock(): void {
      if (disposed) return;
      const audio = ensureContext();
      if (!audio) return;
      try {
        if (audio.state === 'suspended' && typeof audio.resume === 'function') {
          void audio.resume().catch(() => {});
        }
        unlocked = true;
      } catch {
        // Swallow: audio stays locked, playback stays a no-op.
      }
    },

    isUnlocked(): boolean {
      return unlocked;
    },

    playTone(
      type: OscillatorType,
      f0: number,
      f1: number,
      durMs: number,
      peak: number,
      whenS = 0,
    ): void {
      if (disposed || muted || !unlocked) return;
      if (!ctx || !master) return;
      try {
        const t0 = ctx.currentTime + whenS;
        const dur = durMs / 1000;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(f0, t0);
        if (f1 !== f0) osc.frequency.linearRampToValueAtTime(f1, t0 + dur);
        gain.gain.setValueAtTime(GAIN_FLOOR, t0);
        gain.gain.linearRampToValueAtTime(peak, t0 + TONE_ATTACK_S);
        gain.gain.linearRampToValueAtTime(GAIN_FLOOR, t0 + dur);
        osc.connect(gain).connect(master);
        osc.start(t0);
        osc.stop(t0 + dur + STOP_TAIL_S);
      } catch {
        // Swallow — audio is decorative.
      }
    },

    playNoise(
      durMs: number,
      filterType: BiquadFilterType,
      freq: number,
      peak: number,
      whenS = 0,
    ): void {
      if (disposed || muted || !unlocked) return;
      if (!ctx || !master || !noiseBuffer) return;
      try {
        const t0 = ctx.currentTime + whenS;
        const dur = durMs / 1000;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        const filter = ctx.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.value = freq;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(GAIN_FLOOR, t0);
        gain.gain.linearRampToValueAtTime(peak, t0 + NOISE_ATTACK_S);
        gain.gain.linearRampToValueAtTime(GAIN_FLOOR, t0 + dur);
        src.connect(filter).connect(gain).connect(master);
        // Random start offset inside the shared buffer so overlapping bursts
        // de-correlate: identical sample-0 restarts phase-lock into a retrigger
        // buzz (60 identical restarts/s ≈ a 60 Hz tone + comb filtering). Falls
        // back to offset 0 when the burst outlasts the one-second buffer.
        const usable = noiseBuffer.duration - (dur + STOP_TAIL_S);
        const offset = usable > 0 ? Math.random() * usable : 0;
        src.start(t0, offset, dur + STOP_TAIL_S);
        src.stop(t0 + dur + STOP_TAIL_S);
      } catch {
        // Swallow — audio is decorative.
      }
    },

    startNoiseLoop(
      filterType: BiquadFilterType,
      freq: number,
      peak: number,
    ): NoiseLoopHandle {
      if (disposed || muted || !unlocked) return createInertNoiseLoopHandle();
      if (!ctx || !master || !noiseBuffer) return createInertNoiseLoopHandle();
      try {
        // Locals so the handle closures never need non-null assertions.
        const audio = ctx;
        const t0 = audio.currentTime;
        const src = audio.createBufferSource();
        src.buffer = noiseBuffer;
        src.loop = true; // the one-second buffer loops seamlessly
        const filter = audio.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.value = freq;
        const gain = audio.createGain();
        gain.gain.setValueAtTime(GAIN_FLOOR, t0);
        gain.gain.linearRampToValueAtTime(clamp01(peak), t0 + NOISE_ATTACK_S);
        src.connect(filter).connect(gain).connect(master);
        src.start(t0);
        let playing = true;
        return {
          stop(): void {
            if (!playing) return;
            playing = false;
            try {
              const t = audio.currentTime;
              // Ramp from wherever the voice currently is → no click, a
              // natural ~0.1 s release tail (matches a scrape ringing out).
              gain.gain.cancelScheduledValues(t);
              gain.gain.setValueAtTime(gain.gain.value, t);
              gain.gain.linearRampToValueAtTime(GAIN_FLOOR, t + LOOP_RELEASE_S);
              src.stop(t + LOOP_RELEASE_S + STOP_TAIL_S);
            } catch {
              // Swallow — e.g. the adapter was disposed and the context closed.
            }
          },
          setPeak(next: number): void {
            if (!playing) return;
            try {
              const t = audio.currentTime;
              gain.gain.cancelScheduledValues(t);
              gain.gain.setValueAtTime(gain.gain.value, t);
              gain.gain.linearRampToValueAtTime(clamp01(next), t + NOISE_ATTACK_S);
            } catch {
              // Swallow.
            }
          },
          isPlaying(): boolean {
            return playing;
          },
        };
      } catch {
        // Swallow — inert handle so callers never null-check.
        return createInertNoiseLoopHandle();
      }
    },

    setMuted(value: boolean): void {
      if (disposed) return;
      muted = !!value;
      applyMasterGain();
    },

    isMuted(): boolean {
      return muted;
    },

    setVolume(value: number): void {
      if (disposed) return;
      volume = clamp01(value);
      applyMasterGain();
    },

    getVolume(): number {
      return volume;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (ctx) {
        try {
          void ctx.close().catch(() => {});
        } catch {
          // Swallow — idempotent teardown must not throw.
        }
      }
      ctx = null;
      master = null;
      noiseBuffer = null;
      unlocked = false;
    },
  };
}
