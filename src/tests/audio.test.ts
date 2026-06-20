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
    connect: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
  };
}

function createMockAudioBuffer(length: number, sampleRate: number) {
  return {
    length,
    sampleRate,
    numberOfChannels: 1,
    getChannelData: vi.fn().mockReturnValue(new Float32Array(length)),
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
    createBuffer: vi.fn(() => createMockAudioBuffer(sampleRate, sampleRate)),
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
      const ctx = getCtx();
      adapter.playNoise(100, 'highpass', 2200, 0.22);

      expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
      expect(ctx.createBiquadFilter).toHaveBeenCalledTimes(1);
      const src = ctx.createBufferSource.mock.results[0].value;
      const filter = ctx.createBiquadFilter.mock.results[0].value;
      expect(filter.type).toBe('highpass');
      expect(filter.frequency.value).toBe(2200);
      expect(src.start).toHaveBeenCalledWith(10);
      expect(src.stop).toHaveBeenCalledWith(10.12);
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
