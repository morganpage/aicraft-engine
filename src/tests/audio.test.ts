import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAudioAdapter } from '../audio/factory';
import { DEFAULT_AUDIO_VOLUME } from '../audio/constants';
import type { AudioAdapter } from '../audio/types';

// ---------------------------------------------------------------------------
// Mock WebAudio primitives — minimal fakes sufficient to drive the adapter.
// Each `create*` returns a fresh node so call counts are isolated per test.
// ---------------------------------------------------------------------------

interface MockAudioParam {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  setTargetAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
}

function createMockAudioParam(): MockAudioParam {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

function createMockGainNode() {
  return {
    gain: createMockAudioParam(),
    connect: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
  };
}

function createMockOscillatorNode() {
  return {
    type: 'sine' as OscillatorType,
    frequency: createMockAudioParam(),
    connect: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

function createMockBufferSourceNode() {
  return {
    buffer: null as unknown,
    loop: false,
    connect: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

function createMockBiquadFilterNode() {
  return {
    type: 'lowpass' as BiquadFilterType,
    frequency: createMockAudioParam(),
    Q: createMockAudioParam(),
    connect: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
  };
}

function createMockAudioBuffer(length: number, sampleRate: number) {
  // Expose the backing array so tests can inspect what the adapter FILLED
  // (seam crossfade, RMS continuity) — getChannelData returns the same array.
  const data = new Float32Array(length);
  return {
    length,
    sampleRate,
    duration: length / sampleRate,
    numberOfChannels: 1,
    data,
    getChannelData: vi.fn(() => data),
  };
}

interface MockAudioContext {
  currentTime: number;
  sampleRate: number;
  state: AudioContextState;
  destination: unknown;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  createGain: ReturnType<typeof vi.fn>;
  createOscillator: ReturnType<typeof vi.fn>;
  createBufferSource: ReturnType<typeof vi.fn>;
  createBiquadFilter: ReturnType<typeof vi.fn>;
  createBuffer: ReturnType<typeof vi.fn>;
}

function createMockAudioContext(): MockAudioContext {
  const sampleRate = 44100;
  return {
    currentTime: 10,
    sampleRate,
    state: 'suspended',
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createGain: vi.fn(() => createMockGainNode()),
    createOscillator: vi.fn(() => createMockOscillatorNode()),
    createBufferSource: vi.fn(() => createMockBufferSourceNode()),
    createBiquadFilter: vi.fn(() => createMockBiquadFilterNode()),
    createBuffer: vi.fn((_channels: number, length: number, rate: number) =>
      createMockAudioBuffer(length, rate),
    ),
  };
}

interface MockWindow {
  AudioContext: ReturnType<typeof vi.fn>;
  webkitAudioContext?: ReturnType<typeof vi.fn>;
  context: MockAudioContext;
}

function createMockWindow(): MockWindow {
  const context = createMockAudioContext();
  // Regular function (not arrow) — required so `new AudioContext()` returns
  // the pre-created context. Arrow functions cannot be used as constructors.
  const AudioContext = vi.fn(function MockAudioContext() {
    return context;
  });
  return { AudioContext, context };
}

// ===========================================================================
// No host (Node / SSR) — window is undefined in the vitest node environment.
// ===========================================================================

describe('createAudioAdapter — no host (Node / SSR)', () => {
  it('does not crash when creating without window', () => {
    expect(() => createAudioAdapter()).not.toThrow();
  });

  it('unlock() is a silent no-op and isUnlocked() returns false', () => {
    const adapter = createAudioAdapter();
    expect(() => adapter.unlock()).not.toThrow();
    expect(adapter.isUnlocked()).toBe(false);
  });

  it('playTone is a silent no-op', () => {
    const adapter = createAudioAdapter();
    expect(() => adapter.playTone('sine', 200, 400, 80, 0.3)).not.toThrow();
  });

  it('playNoise is a silent no-op', () => {
    const adapter = createAudioAdapter();
    expect(() => adapter.playNoise(100, 'highpass', 2200, 0.22)).not.toThrow();
  });

  it('startNoiseLoop returns an inert handle whose methods are safe no-ops', () => {
    const adapter = createAudioAdapter();
    const handle = adapter.startNoiseLoop('lowpass', 600, 0.06);
    expect(handle.isPlaying()).toBe(false);
    expect(() => handle.stop()).not.toThrow();
    expect(() => handle.setPeak(0.5)).not.toThrow();
    expect(() => handle.setFrequency(NaN)).not.toThrow();
    expect(() => handle.setQ(Infinity)).not.toThrow();
    expect(handle.isPlaying()).toBe(false);
  });

  it('setMuted and setVolume are silent no-ops', () => {
    const adapter = createAudioAdapter();
    expect(() => adapter.setMuted(true)).not.toThrow();
    expect(() => adapter.setVolume(0.5)).not.toThrow();
  });

  it('getVolume returns the default volume', () => {
    const adapter = createAudioAdapter();
    expect(adapter.getVolume()).toBe(DEFAULT_AUDIO_VOLUME);
  });

  it('isMuted returns false by default', () => {
    const adapter = createAudioAdapter();
    expect(adapter.isMuted()).toBe(false);
  });

  it('dispose is a silent no-op and idempotent', () => {
    const adapter = createAudioAdapter();
    expect(() => adapter.dispose()).not.toThrow();
    expect(() => adapter.dispose()).not.toThrow();
  });
});

// ===========================================================================
// With mock WebAudio.
// ===========================================================================

describe('createAudioAdapter — with mock WebAudio', () => {
  let mockWindow: MockWindow;
  let adapter: AudioAdapter;

  beforeEach(() => {
    mockWindow = createMockWindow();
    vi.stubGlobal('window', mockWindow);
    adapter = createAudioAdapter();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function getCtx(): MockAudioContext {
    return mockWindow.context;
  }

  // --- unlock ---------------------------------------------------------------

  describe('unlock', () => {
    it('arms playback and resumes the context', () => {
      adapter.unlock();
      const ctx = getCtx();
      expect(adapter.isUnlocked()).toBe(true);
      expect(ctx.resume).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — calling unlock twice does not create a second context', () => {
      adapter.unlock();
      adapter.unlock();
      expect(mockWindow.AudioContext).toHaveBeenCalledTimes(1);
    });
  });

  // --- playTone -------------------------------------------------------------

  describe('playTone', () => {
    it('is a no-op before unlock', () => {
      adapter.playTone('sine', 200, 400, 80, 0.3);
      expect(mockWindow.AudioContext).not.toHaveBeenCalled();
    });

    it('creates an oscillator and starts/stops it after unlock', () => {
      adapter.unlock();
      const ctx = getCtx();
      adapter.playTone('sine', 200, 400, 80, 0.3);

      expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
      const osc = ctx.createOscillator.mock.results[0].value;
      expect(osc.type).toBe('sine');
      expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(200, 10);
      expect(osc.start).toHaveBeenCalledWith(10);
      expect(osc.stop).toHaveBeenCalledWith(10.1);
    });

    it('applies a frequency sweep when f0 !== f1', () => {
      adapter.unlock();
      const ctx = getCtx();
      adapter.playTone('square', 300, 100, 200, 0.18);

      const osc = ctx.createOscillator.mock.results[0].value;
      expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(300, 10);
      expect(osc.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(100, 10.2);
    });

    it('does not sweep when f0 === f1', () => {
      adapter.unlock();
      const ctx = getCtx();
      adapter.playTone('sine', 523.25, 523.25, 90, 0.3);

      const osc = ctx.createOscillator.mock.results[0].value;
      expect(osc.frequency.linearRampToValueAtTime).not.toHaveBeenCalled();
    });

    it('is a no-op when muted', () => {
      adapter.unlock();
      const ctx = getCtx();
      adapter.setMuted(true);
      ctx.createOscillator.mockClear();
      adapter.playTone('sine', 200, 400, 80, 0.3);
      expect(ctx.createOscillator).not.toHaveBeenCalled();
    });

    it('applies the whenS scheduling offset to start/stop', () => {
      adapter.unlock();
      const ctx = getCtx();
      adapter.playTone('sine', 200, 400, 80, 0.3, 0.1);

      const osc = ctx.createOscillator.mock.results[0].value;
      expect(osc.start).toHaveBeenCalledWith(10.1);
      expect(osc.stop).toHaveBeenCalledWith(10.2);
    });
  });

  // --- playNoise ------------------------------------------------------------

  describe('playNoise', () => {
    it('is a no-op before unlock', () => {
      adapter.playNoise(100, 'highpass', 2200, 0.22);
      expect(mockWindow.AudioContext).not.toHaveBeenCalled();
    });

    it('creates a buffer source + biquad filter after unlock', () => {
      adapter.unlock();
      // Spy AFTER unlock — the noise-buffer fill during unlock also consumes
      // Math.random draws.
      const rand = vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const ctx = getCtx();
      adapter.playNoise(100, 'highpass', 2200, 0.22);

      expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
      expect(ctx.createBiquadFilter).toHaveBeenCalledTimes(1);
      const src = ctx.createBufferSource.mock.results[0].value;
      const filter = ctx.createBiquadFilter.mock.results[0].value;
      expect(filter.type).toBe('highpass');
      expect(filter.frequency.value).toBe(2200);
      // Random playback offset (0.5 × (10 s buffer − 0.12 s burst+tail) = 4.94)
      // so overlapping bursts de-correlate; duration limited to burst + tail.
      const [when, offset, duration] = src.start.mock.calls[0];
      expect(when).toBe(10);
      expect(offset).toBeCloseTo(4.94, 5);
      expect(duration).toBeCloseTo(0.12, 5);
      expect(src.stop).toHaveBeenCalledWith(10.12);
      rand.mockRestore();
    });

    it('starts successive bursts at different random offsets (de-correlation)', () => {
      adapter.unlock();
      const rand = vi.spyOn(Math, 'random')
        .mockReturnValueOnce(0.25)
        .mockReturnValueOnce(0.75);
      const ctx = getCtx();
      adapter.playNoise(100, 'highpass', 2200, 0.22);
      adapter.playNoise(100, 'highpass', 2200, 0.22);

      const first = ctx.createBufferSource.mock.results[0].value;
      const second = ctx.createBufferSource.mock.results[1].value;
      const [, firstOffset] = first.start.mock.calls[0];
      const [, secondOffset] = second.start.mock.calls[0];
      // usable = 10 s − 0.12 s = 9.88 → offsets ≈ 2.47 / 7.41 — NOT both
      // sample 0, so rapid retriggers can never phase-lock into a buzz.
      expect(firstOffset).toBeCloseTo(2.47, 5);
      expect(secondOffset).toBeCloseTo(7.41, 5);
      rand.mockRestore();
    });

    it('falls back to offset 0 when the burst outlasts the buffer', () => {
      adapter.unlock();
      const rand = vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const ctx = getCtx();
      adapter.playNoise(10500, 'lowpass', 400, 0.3);

      const src = ctx.createBufferSource.mock.results[0].value;
      const [when, offset] = src.start.mock.calls[0];
      expect(when).toBe(10);
      expect(offset).toBe(0);
      rand.mockRestore();
    });

    it('is a no-op when muted', () => {
      adapter.unlock();
      const ctx = getCtx();
      adapter.setMuted(true);
      ctx.createBufferSource.mockClear();
      adapter.playNoise(100, 'highpass', 2200, 0.22);
      expect(ctx.createBufferSource).not.toHaveBeenCalled();
    });
  });

  // --- startNoiseLoop -------------------------------------------------------

  describe('startNoiseLoop', () => {
    it('is a no-op before unlock — inert handle, no nodes', () => {
      const handle = adapter.startNoiseLoop('lowpass', 600, 0.06);
      expect(handle.isPlaying()).toBe(false);
      expect(mockWindow.AudioContext).not.toHaveBeenCalled();
    });

    it('creates a looping buffer source after unlock', () => {
      adapter.unlock();
      // Spy AFTER unlock — the noise-buffer fill during unlock also consumes
      // Math.random draws.
      const rand = vi.spyOn(Math, 'random').mockReturnValue(0.25);
      const ctx = getCtx();
      const handle = adapter.startNoiseLoop('lowpass', 600, 0.06);

      expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
      expect(ctx.createBiquadFilter).toHaveBeenCalledTimes(1);
      const src = ctx.createBufferSource.mock.results[0].value;
      const filter = ctx.createBiquadFilter.mock.results[0].value;
      expect(src.loop).toBe(true);
      expect(filter.type).toBe('lowpass');
      expect(filter.frequency.value).toBe(600);
      // Start at a random offset inside the LOOPING buffer — a rotation, so
      // concurrent voices de-correlate (0.25 × 10 s buffer = 2.5 s).
      expect(src.start).toHaveBeenCalledWith(10, 2.5);
      expect(handle.isPlaying()).toBe(true);
      rand.mockRestore();
    });

    it('attack-ramps the loop gain to the clamped peak', () => {
      adapter.unlock();
      const ctx = getCtx();
      adapter.startNoiseLoop('lowpass', 600, 5); // out-of-range peak clamps to 1

      const gain = ctx.createGain.mock.results[1].value; // [0] = master gain
      expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 10.003);
    });

    it('stop() releases the voice with a fade + tail and is idempotent', () => {
      adapter.unlock();
      const ctx = getCtx();
      const handle = adapter.startNoiseLoop('lowpass', 600, 0.06);
      const src = ctx.createBufferSource.mock.results[0].value;
      const gain = ctx.createGain.mock.results[1].value; // [0] = master gain

      handle.stop();
      // Fade from the current value over 0.1 s, then stop after the tail.
      expect(gain.gain.cancelScheduledValues).toHaveBeenCalledWith(10);
      expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.0001, 10.1);
      expect(src.stop).toHaveBeenCalledWith(10.12);
      expect(handle.isPlaying()).toBe(false);

      handle.stop(); // idempotent — no second release
      expect(src.stop).toHaveBeenCalledTimes(1);
    });

    it('setPeak() ramps to the clamped new peak; no-op after stop()', () => {
      adapter.unlock();
      const ctx = getCtx();
      const handle = adapter.startNoiseLoop('lowpass', 600, 0.06);
      const gain = ctx.createGain.mock.results[1].value; // [0] = master gain

      handle.setPeak(2); // clamps to 1
      expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 10.003);

      handle.stop();
      gain.gain.linearRampToValueAtTime.mockClear();
      handle.setPeak(0.5);
      expect(gain.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    });

    it('is a no-op when muted — inert handle, no nodes', () => {
      adapter.unlock();
      adapter.setMuted(true);
      const ctx = getCtx();
      ctx.createBufferSource.mockClear();
      const handle = adapter.startNoiseLoop('lowpass', 600, 0.06);
      expect(ctx.createBufferSource).not.toHaveBeenCalled();
      expect(handle.isPlaying()).toBe(false);
      expect(() => handle.stop()).not.toThrow();
    });

    it('is a no-op after dispose — inert handle', () => {
      adapter.unlock();
      adapter.dispose();
      const ctx = getCtx();
      ctx.createBufferSource.mockClear();
      const handle = adapter.startNoiseLoop('lowpass', 600, 0.06);
      expect(ctx.createBufferSource).not.toHaveBeenCalled();
      expect(handle.isPlaying()).toBe(false);
    });
  });

  // --- startNoiseLoop — filter modulation + options --------------------------

  describe('startNoiseLoop — filter modulation (setFrequency / setQ)', () => {
    /** Unlock + start one voice; return the handle AND its own filter node. */
    function startedVoice(filterType: BiquadFilterType = 'lowpass') {
      adapter.unlock();
      const ctx = getCtx();
      const handle = adapter.startNoiseLoop(filterType, 600, 0.06);
      const filter = ctx.createBiquadFilter.mock.results[0].value;
      return { filter, handle };
    }

    it('setFrequency retargets the cutoff de-zippered: anchor, then setTargetAtTime (~50 ms)', () => {
      const { filter, handle } = startedVoice();
      handle.setFrequency(800);

      expect(filter.frequency.cancelScheduledValues).toHaveBeenCalledWith(10);
      expect(filter.frequency.setValueAtTime).toHaveBeenCalledWith(filter.frequency.value, 10);
      expect(filter.frequency.setTargetAtTime).toHaveBeenCalledWith(800, 10, 0.05);
    });

    it('setFrequency clamps into [10, 20000] Hz — never a meaningless/negative cutoff', () => {
      const { filter, handle } = startedVoice();
      handle.setFrequency(-5);
      expect(filter.frequency.setTargetAtTime).toHaveBeenLastCalledWith(10, 10, 0.05);
      handle.setFrequency(1e9);
      expect(filter.frequency.setTargetAtTime).toHaveBeenLastCalledWith(20000, 10, 0.05);
    });

    it('setFrequency ignores non-finite input without touching the graph', () => {
      const { filter, handle } = startedVoice();
      handle.setFrequency(NaN);
      handle.setFrequency(Infinity);
      handle.setFrequency(-Infinity);
      expect(filter.frequency.cancelScheduledValues).not.toHaveBeenCalled();
    });

    it('setQ retargets Q with the same anchor-then-approach contract', () => {
      const { filter, handle } = startedVoice('bandpass');
      handle.setQ(4);

      expect(filter.Q.cancelScheduledValues).toHaveBeenCalledWith(10);
      expect(filter.Q.setValueAtTime).toHaveBeenCalledWith(filter.Q.value, 10);
      expect(filter.Q.setTargetAtTime).toHaveBeenCalledWith(4, 10, 0.05);
    });

    it('setQ clamps into [0.1, 20]', () => {
      const { filter, handle } = startedVoice('bandpass');
      handle.setQ(0.01);
      expect(filter.Q.setTargetAtTime).toHaveBeenLastCalledWith(0.1, 10, 0.05);
      handle.setQ(100);
      expect(filter.Q.setTargetAtTime).toHaveBeenLastCalledWith(20, 10, 0.05);
    });

    it('setFrequency and setQ are no-ops after stop()', () => {
      const { filter, handle } = startedVoice();
      handle.stop();
      handle.setFrequency(800);
      handle.setQ(4);
      expect(filter.frequency.cancelScheduledValues).not.toHaveBeenCalled();
      expect(filter.Q.cancelScheduledValues).not.toHaveBeenCalled();
    });
  });

  describe('startNoiseLoop — options (q, noise color)', () => {
    it('defaults reproduce the pre-options voice exactly: white buffer, Q 1', () => {
      adapter.unlock();
      const ctx = getCtx();
      adapter.startNoiseLoop('lowpass', 600, 0.06);
      const src = ctx.createBufferSource.mock.results[0].value;
      const filter = ctx.createBiquadFilter.mock.results[0].value;
      expect(src.buffer).toBe(ctx.createBuffer.mock.results[0].value); // the white buffer
      expect(filter.Q.value).toBe(1); // the WebAudio default
    });

    it('q sets the biquad Q at voice start — a resonant peak, clamped', () => {
      adapter.unlock();
      const ctx = getCtx();
      adapter.startNoiseLoop('bandpass', 900, 0.05, { q: 10 });
      let filter = ctx.createBiquadFilter.mock.results[0].value;
      expect(filter.Q.value).toBe(10);

      adapter.startNoiseLoop('bandpass', 900, 0.05, { q: 99 });
      filter = ctx.createBiquadFilter.mock.results[1].value;
      expect(filter.Q.value).toBe(20); // clamped high

      adapter.startNoiseLoop('bandpass', 900, 0.05, { q: Number.NaN });
      filter = ctx.createBiquadFilter.mock.results[2].value;
      expect(filter.Q.value).toBe(1); // non-finite resolves to the default
    });

    it('pink noise builds ONE long buffer lazily, shared by every pink voice', () => {
      adapter.unlock();
      const ctx = getCtx();
      expect(ctx.createBuffer).toHaveBeenCalledTimes(1); // white, at unlock

      adapter.startNoiseLoop('lowpass', 300, 0.1, { noise: 'pink' });
      expect(ctx.createBuffer).toHaveBeenCalledTimes(2); // pink, lazily
      const pinkBuffer = ctx.createBuffer.mock.results[1].value;
      const pinkSrc = ctx.createBufferSource.mock.results[0].value;
      expect(pinkSrc.buffer).toBe(pinkBuffer);

      adapter.startNoiseLoop('bandpass', 1200, 0.08, { noise: 'pink' });
      expect(ctx.createBuffer).toHaveBeenCalledTimes(2); // shared, not rebuilt
      const secondPinkSrc = ctx.createBufferSource.mock.results[1].value;
      expect(secondPinkSrc.buffer).toBe(pinkBuffer);

      // A white voice still routes to the white buffer.
      adapter.startNoiseLoop('lowpass', 500, 0.1);
      const whiteSrc = ctx.createBufferSource.mock.results[2].value;
      expect(whiteSrc.buffer).toBe(ctx.createBuffer.mock.results[0].value);
    });

    it('concurrent voices start at different random offsets (decorrelation)', () => {
      adapter.unlock();
      const rand = vi.spyOn(Math, 'random')
        .mockReturnValueOnce(0.2)
        .mockReturnValueOnce(0.8);
      const ctx = getCtx();
      adapter.startNoiseLoop('lowpass', 500, 0.1);
      adapter.startNoiseLoop('bandpass', 1600, 0.08);
      const first = ctx.createBufferSource.mock.results[0].value;
      const second = ctx.createBufferSource.mock.results[1].value;
      const [, firstOffset] = first.start.mock.calls[0];
      const [, secondOffset] = second.start.mock.calls[0];
      // Offsets 2.0 s / 8.0 s into the ten-second loop: same buffer, different
      // rotation — time-shifted, not the identical correlated signal.
      expect(firstOffset).toBeCloseTo(2.0, 5);
      expect(secondOffset).toBeCloseTo(8.0, 5);
      expect(firstOffset).not.toBe(secondOffset);
      rand.mockRestore();
    });
  });

  // --- noise buffers — length + seamless seam (§3.9, 0.19.1) -----------------

  describe('noise buffers — 10 s length, equal-power seam, laziness', () => {
    const RATE = 44100;

    it('the white buffer is 10 s and is built exactly once, at unlock', () => {
      adapter.unlock();
      const ctx = getCtx();
      expect(ctx.createBuffer).toHaveBeenCalledTimes(1);
      const [channels, length, rate] = ctx.createBuffer.mock.calls[0];
      expect(channels).toBe(1);
      expect(length).toBeGreaterThanOrEqual(10 * RATE);
      expect(rate).toBe(RATE);
      const white = ctx.createBuffer.mock.results[0].value;
      expect(white.duration).toBeGreaterThanOrEqual(10);

      // No further allocation however many sounds fire — every noise voice
      // reuses the one buffer.
      adapter.playNoise(50, 'lowpass', 400, 0.2);
      adapter.startNoiseLoop('lowpass', 500, 0.1);
      expect(ctx.createBuffer).toHaveBeenCalledTimes(1);
    });

    it('the pink buffer is 10 s, built lazily on the first pink voice, at most once', () => {
      adapter.unlock();
      const ctx = getCtx();
      adapter.startNoiseLoop('lowpass', 300, 0.1, { noise: 'pink' });
      expect(ctx.createBuffer).toHaveBeenCalledTimes(2);
      const [channels, length] = ctx.createBuffer.mock.calls[1];
      expect(channels).toBe(1);
      expect(length).toBeGreaterThanOrEqual(10 * RATE);
      adapter.startNoiseLoop('bandpass', 800, 0.05, { noise: 'pink', q: 4 });
      expect(ctx.createBuffer).toHaveBeenCalledTimes(2); // shared
    });

    /** Deterministic Math.random replacement (LCG) — pins the fill for seam tests. */
    function seededRandom(seed: number): () => number {
      let s = seed;
      return () => {
        // Numerical-Recipes-style LCG; deterministic and adequate for a fill.
        s = (1664525 * s + 1013904223) % 4294967296;
        return s / 4294967296;
      };
    }

    /** RMS helper over [from, to). */
    function rmsOf(data: Float32Array, from: number, to: number): number {
      let acc = 0;
      for (let i = from; i < to; i++) acc += data[i] * data[i];
      return Math.sqrt(acc / (to - from));
    }

    it('the WHITE seam is continuous: no wrap step, RMS at the seam within ±0.5 dB of the body', () => {
      const rand = vi.spyOn(Math, 'random').mockImplementation(seededRandom(1234));
      try {
        adapter.unlock();
        const ctx = getCtx();
        const data: Float32Array = ctx.createBuffer.mock.results[0].value.data;
        const n = data.length;
        const fade = Math.floor(0.5 * RATE);

        // No step: the wrap difference sits within the buffer's own adjacent-
        // sample difference distribution (compare against the body max).
        let maxStep = 0;
        for (let i = 1; i < n; i++) {
          const d = Math.abs(data[i] - data[i - 1]);
          if (d > maxStep) maxStep = d;
        }
        const wrapStep = Math.abs(data[0] - data[n - 1]);
        expect(wrapStep).toBeLessThanOrEqual(maxStep);

        // Level: the crossfaded head region vs the FULL untouched body
        // (~9 s — a stable reference). Equal-power weights hold the level;
        // linear weights would dip −3 dB at mid-crossfade.
        const seamDb = 20 * Math.log10(rmsOf(data, 0, fade) / rmsOf(data, fade, n - fade));
        expect(Math.abs(seamDb)).toBeLessThan(0.5);
      } finally {
        rand.mockRestore();
      }
    });

    it('the PINK seam holds the level (settled warm-up, no seam dip)', () => {
      const rand = vi.spyOn(Math, 'random').mockImplementation(seededRandom(4321));
      try {
        adapter.unlock();
        const ctx = getCtx();
        adapter.startNoiseLoop('lowpass', 300, 0.1, { noise: 'pink' });
        const data: Float32Array = ctx.createBuffer.mock.results[1].value.data;
        const n = data.length;
        const fade = Math.floor(0.5 * RATE);
        // Pink's low-frequency content makes any short window's RMS wander;
        // the body reference is the full untouched body and the tolerance
        // admits that wander while still catching a −3 dB crossfade dip.
        const seamDb = 20 * Math.log10(rmsOf(data, 0, fade) / rmsOf(data, fade, n - fade));
        expect(Math.abs(seamDb)).toBeLessThan(1.5);
        // And every sample is in range (the fill clamps crossfade sums).
        for (let i = 0; i < n; i += 997) {
          expect(Math.abs(data[i])).toBeLessThanOrEqual(1);
        }
      } finally {
        rand.mockRestore();
      }
    });
  });

  // --- mute / volume --------------------------------------------------------

  describe('mute / volume', () => {
    it('setMuted(true) ramps master gain toward 0', () => {
      adapter.unlock();
      const ctx = getCtx();
      const master = ctx.createGain.mock.results[0].value;
      master.gain.setTargetAtTime.mockClear();

      adapter.setMuted(true);
      expect(master.gain.setTargetAtTime).toHaveBeenCalledWith(0, ctx.currentTime, 0.015);
    });

    it('setMuted(false) ramps master gain toward the volume', () => {
      adapter.unlock();
      adapter.setMuted(true);
      const ctx = getCtx();
      const master = ctx.createGain.mock.results[0].value;
      master.gain.setTargetAtTime.mockClear();

      adapter.setMuted(false);
      expect(master.gain.setTargetAtTime).toHaveBeenCalledWith(
        DEFAULT_AUDIO_VOLUME,
        ctx.currentTime,
        0.015,
      );
    });

    it('setVolume(0.3) ramps master gain toward 0.3', () => {
      adapter.unlock();
      const ctx = getCtx();
      const master = ctx.createGain.mock.results[0].value;
      master.gain.setTargetAtTime.mockClear();

      adapter.setVolume(0.3);
      expect(adapter.getVolume()).toBe(0.3);
      expect(master.gain.setTargetAtTime).toHaveBeenCalledWith(0.3, ctx.currentTime, 0.015);
    });

    it('clamps setVolume(-1) to 0', () => {
      adapter.setVolume(-1);
      expect(adapter.getVolume()).toBe(0);
    });

    it('clamps setVolume(2) to 1', () => {
      adapter.setVolume(2);
      expect(adapter.getVolume()).toBe(1);
    });

    it('clamps non-finite setVolume to 0', () => {
      adapter.setVolume(NaN);
      expect(adapter.getVolume()).toBe(0);
      adapter.setVolume(Infinity);
      expect(adapter.getVolume()).toBe(0);
    });
  });

  // --- dispose --------------------------------------------------------------

  describe('dispose', () => {
    it('closes the AudioContext', () => {
      adapter.unlock();
      const ctx = getCtx();
      adapter.dispose();
      expect(ctx.close).toHaveBeenCalledTimes(1);
    });

    it('makes all subsequent method calls no-ops', () => {
      adapter.unlock();
      const ctx = getCtx();
      adapter.dispose();

      ctx.createOscillator.mockClear();
      adapter.playTone('sine', 200, 400, 80, 0.3);
      expect(ctx.createOscillator).not.toHaveBeenCalled();
    });

    it('is idempotent — calling twice does not crash', () => {
      adapter.unlock();
      adapter.dispose();
      expect(() => adapter.dispose()).not.toThrow();
    });
  });
});

// ===========================================================================
// Defensive error handling.
// ===========================================================================

describe('createAudioAdapter — defensive error handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unlock is a no-op when AudioContext constructor throws', () => {
    vi.stubGlobal('window', {
      AudioContext: vi.fn(function () {
        throw new Error('blocked');
      }),
    });
    const adapter = createAudioAdapter();
    expect(() => adapter.unlock()).not.toThrow();
    expect(adapter.isUnlocked()).toBe(false);
  });

  it('playTone swallows errors from createOscillator', () => {
    const ctx = createMockAudioContext();
    ctx.createOscillator.mockImplementation(() => {
      throw new Error('boom');
    });
    vi.stubGlobal('window', {
      AudioContext: vi.fn(function () {
        return ctx;
      }),
    });
    const adapter = createAudioAdapter();
    adapter.unlock();
    expect(() => adapter.playTone('sine', 200, 400, 80, 0.3)).not.toThrow();
  });

  it('playNoise swallows errors from createBufferSource', () => {
    const ctx = createMockAudioContext();
    ctx.createBufferSource.mockImplementation(() => {
      throw new Error('boom');
    });
    vi.stubGlobal('window', {
      AudioContext: vi.fn(function () {
        return ctx;
      }),
    });
    const adapter = createAudioAdapter();
    adapter.unlock();
    expect(() => adapter.playNoise(100, 'highpass', 2200, 0.22)).not.toThrow();
  });

    it('startNoiseLoop returns an inert handle when createBufferSource throws', () => {
      const ctx = createMockAudioContext();
      ctx.createBufferSource.mockImplementation(() => {
        throw new Error('boom');
      });
      vi.stubGlobal('window', {
        AudioContext: vi.fn(function () {
          return ctx;
        }),
      });
      const adapter = createAudioAdapter();
      adapter.unlock();
      const handle = adapter.startNoiseLoop('lowpass', 600, 0.06);
      expect(() => handle.stop()).not.toThrow();
      expect(() => handle.setPeak(0.5)).not.toThrow();
      expect(() => handle.setFrequency(800)).not.toThrow();
      expect(() => handle.setQ(4)).not.toThrow();
      expect(handle.isPlaying()).toBe(false);
    });

  it('falls back to webkitAudioContext when AudioContext is missing', () => {
    const ctx = createMockAudioContext();
    vi.stubGlobal('window', {
      webkitAudioContext: vi.fn(function () {
        return ctx;
      }),
    });
    const adapter = createAudioAdapter();
    adapter.unlock();
    expect(adapter.isUnlocked()).toBe(true);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('unlock is a no-op when neither AudioContext nor webkitAudioContext exists', () => {
    vi.stubGlobal('window', {});
    const adapter = createAudioAdapter();
    expect(() => adapter.unlock()).not.toThrow();
    expect(adapter.isUnlocked()).toBe(false);
  });
});
