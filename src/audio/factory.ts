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

import type { AudioAdapter, NoiseLoopHandle, NoiseLoopOptions } from './types';
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
 * Dezippering time constant (seconds) for sustained-voice filter retargets
 * (`setFrequency`/`setQ`). Frequency is perceptually sensitive to steps (gain
 * steps hide behind the 3 ms linear ramp; frequency steps zipper), and an
 * exponential approach also makes the host's update RATE irrelevant — 60 Hz
 * ticks or 10 Hz ticks converge on the same curve.
 */
const FILTER_PARAM_TC = 0.05;
/** Sustained-voice filter frequency clamp: a biquad at ~0 Hz is meaningless. */
const LOOP_FREQ_MIN_HZ = 10;
/** Sustained-voice filter frequency clamp: the top of hearing. */
const LOOP_FREQ_MAX_HZ = 20000;
/** Sustained-voice Q clamp: below this is inaudibly broad. */
const LOOP_Q_MIN = 0.1;
/** Sustained-voice Q clamp: above this rings like a resonator, not a wind. */
const LOOP_Q_MAX = 20;
/**
 * Noise buffer length (seconds) per color. A one-second loop made every
 * sustained voice exactly 1 Hz-periodic, which the ear tracks as an
 * industrial texture through any filter (a real build's wind read as
 * machinery; the random start-offset added in 0.19.0 only ROTATES the loop
 * and cannot change its period). 2 s is the validated acceptability floor
 * (the scinotes generator ships exactly that); 10 s puts the loop period
 * past auditory memory for noise texture, where the host's slow gust
 * modulation buries what remains. ≈ 1.9 MB mono at 48 kHz per color, built
 * lazily once per adapter — noise next to a tileset PNG.
 */
const NOISE_BUFFER_S = 10;
/**
 * Loop-seam crossfade (seconds). The buffer is generated L + F samples long
 * and the tail is folded into the head with EQUAL-POWER weights — head and
 * tail are uncorrelated noise whose POWERS add, so linear weights would dip
 * the RMS −3 dB at mid-crossfade. The result loops with no click even under
 * resonant filtering (a Q-10 bandpass rings on a plain butt joint).
 */
const CROSSFADE_S = 0.5;
/**
 * Pink warm-up (seconds) discarded before the loop body is recorded: the
 * Kellet filter starts from zero state, so the loop body carries a settled
 * −3 dB/octave spectrum and the seam crossfades two settled segments.
 */
const PINK_WARMUP_S = 0.25;

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
 * Clamp a sustained-voice filter frequency into [10, 20000] Hz. Non-finite
 * input is the caller's ignore case (checked before the clamp).
 */
function clampLoopFreq(hz: number): number {
  if (hz < LOOP_FREQ_MIN_HZ) return LOOP_FREQ_MIN_HZ;
  if (hz > LOOP_FREQ_MAX_HZ) return LOOP_FREQ_MAX_HZ;
  return hz;
}

/**
 * Build a seamless looping noise buffer: fill `L + F` raw samples (the loop
 * body plus a crossfade tail beyond it), then fold the tail into the head —
 * `final[i] = raw[i]·√(1 − i/F) + raw[L+i]·√(i/F)` for `i < F` — so at the
 * loop wrap the continuation that "would have played" is already mixed in.
 *
 * Equal-power weights, not linear: the two folded samples are L SECONDS APART
 * in the stream and therefore uncorrelated — for WHITE by independence, for
 * PINK because the Kellet filter's correlation dies well under a second — so
 * their POWERS add; linear weights would dip the RMS −3 dB at mid-crossfade.
 * (This is why the tail must come from the end of an L+F generation, NOT from
 * adjacent draws: adjacent PINK samples are strongly correlated — that is
 * what pink is — and folding correlated samples under √ weights boosts the
 * low-frequency content up to +3 dB instead of holding the level.)
 *
 * Every sample is clamped to ±1 (rare crossfade sums and pink spikes can
 * exceed it; clipping is inaudible and keeps the sample range clean).
 */
function createSeamlessNoiseBuffer(
  audio: AudioContext,
  fillRaw: (raw: Float32Array) => void,
): AudioBuffer {
  const rate = audio.sampleRate;
  const length = Math.max(1, Math.floor(NOISE_BUFFER_S * rate));
  const fade = Math.min(length, Math.max(0, Math.floor(CROSSFADE_S * rate)));
  const raw = new Float32Array(length + fade);
  fillRaw(raw);
  const buf = audio.createBuffer(1, length, rate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const v =
      i < fade
        ? raw[i] * Math.sqrt(1 - i / fade) + raw[length + i] * Math.sqrt(i / fade)
        : raw[i];
    data[i] = v < -1 ? -1 : v > 1 ? 1 : v;
  }
  return buf;
}

/**
 * Clamp a sustained-voice Q into [0.1, 20]. Non-finite input is the caller's
 * ignore case (checked before the clamp). `undefined` resolves to 1 — the
 * WebAudio default, so an options-less voice is byte-identical to before.
 */
function resolveLoopQ(q: number | undefined): number {
  if (q === undefined || !Number.isFinite(q)) return 1;
  if (q < LOOP_Q_MIN) return LOOP_Q_MIN;
  if (q > LOOP_Q_MAX) return LOOP_Q_MAX;
  return q;
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
    setFrequency(): void {},
    setQ(): void {},
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
  /** One-second pink-noise buffer (−3 dB/octave), built lazily on first use. */
  let pinkNoiseBuffer: AudioBuffer | null = null;

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
   * Create the mono white-noise loop buffer (`NOISE_BUFFER_S` long, seamless
   * crossfaded seam). Reused by every noise-based sound so we don't allocate
   * per shot.
   *
   * Uses `Math.random()` — this is a decorative audio side-effect, NOT
   * deterministic game logic. The noise cannot leak back into the simulation.
   */
  function createNoiseBuffer(audio: AudioContext): AudioBuffer {
    return createSeamlessNoiseBuffer(audio, (raw) => {
      for (let i = 0; i < raw.length; i++) raw[i] = Math.random() * 2 - 1;
    });
  }

  /**
   * Create the pink-noise loop buffer (−3 dB/octave) via the Paul Kellet
   * economy filter — the standard public-domain approximation, six poles over
   * white input. Natural beds (wind, rain, surf) read as weather on pink and
   * as hiss on white.
   *
   * The filter runs `PINK_WARMUP_S` before the loop body is recorded so the
   * body carries a settled spectrum from sample zero (and the seam crossfades
   * two settled segments). Built lazily on the first `noise: 'pink'` voice
   * and reused by every subsequent one, mirroring the white buffer's
   * allocate-once policy. Uses `Math.random()` for the white input — same
   * sanctioned decorative use.
   */
  function createPinkNoiseBuffer(audio: AudioContext): AudioBuffer {
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    const pink = (): number => {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      return (b0 + b1 + b2 + b3 + b4 + b5 + w * 0.5362) * 0.11;
    };
    // Warm-up first (settle the filter), then the L + F stream for the fold.
    const warmup = Math.max(1, Math.floor(PINK_WARMUP_S * audio.sampleRate));
    for (let i = 0; i < warmup; i++) pink();
    return createSeamlessNoiseBuffer(audio, (raw) => {
      for (let i = 0; i < raw.length; i++) raw[i] = pink();
    });
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
        // back to offset 0 when the burst outlasts the noise buffer.
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
      options?: NoiseLoopOptions,
    ): NoiseLoopHandle {
      if (disposed || muted || !unlocked) return createInertNoiseLoopHandle();
      if (!ctx || !master || !noiseBuffer) return createInertNoiseLoopHandle();
      try {
        // Locals so the handle closures never need non-null assertions.
        const audio = ctx;
        const t0 = audio.currentTime;
        const buffer =
          options?.noise === 'pink'
            ? (pinkNoiseBuffer ??= createPinkNoiseBuffer(audio))
            : noiseBuffer;
        const src = audio.createBufferSource();
        src.buffer = buffer;
        src.loop = true; // the crossfaded buffer loops seamlessly at any Q
        const filter = audio.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.value = freq;
        filter.Q.value = resolveLoopQ(options?.q);
        const gain = audio.createGain();
        gain.gain.setValueAtTime(GAIN_FLOOR, t0);
        gain.gain.linearRampToValueAtTime(clamp01(peak), t0 + NOISE_ATTACK_S);
        src.connect(filter).connect(gain).connect(master);
        // Random start offset inside the looping buffer — a ROTATION (spectrum
        // unchanged, a single voice audibly identical), so two simultaneously
        // running voices are time-shifted rather than the same correlated
        // signal in parallel filters. Same rationale as playNoise's offset.
        src.start(t0, Math.random() * buffer.duration);
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
          setFrequency(next: number): void {
            if (!playing) return;
            if (typeof next !== 'number' || !Number.isFinite(next)) return;
            try {
              // Anchor-then-retarget (not cancelAndHoldAtTime, which is not
              // implemented uniformly across browsers): the exponential
              // approach de-zippers the move and absorbs any host update rate.
              const t = audio.currentTime;
              filter.frequency.cancelScheduledValues(t);
              filter.frequency.setValueAtTime(filter.frequency.value, t);
              filter.frequency.setTargetAtTime(clampLoopFreq(next), t, FILTER_PARAM_TC);
            } catch {
              // Swallow.
            }
          },
          setQ(next: number): void {
            if (!playing) return;
            if (typeof next !== 'number' || !Number.isFinite(next)) return;
            try {
              const t = audio.currentTime;
              filter.Q.cancelScheduledValues(t);
              filter.Q.setValueAtTime(filter.Q.value, t);
              filter.Q.setTargetAtTime(resolveLoopQ(next), t, FILTER_PARAM_TC);
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
      pinkNoiseBuffer = null;
      unlocked = false;
    },
  };
}
