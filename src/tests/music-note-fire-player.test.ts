import { describe, expect, it } from 'vitest';
import { createNoteFirePlayer } from '../music/note-fire-player';
import type { AudioAdapter } from '../audio';
import type { NoteFire } from '../music/types';

function fakeAudio(calls: unknown[][]): AudioAdapter {
  return {
    unlock() {},
    isUnlocked: () => true,
    playTone: (...args) => { calls.push(args); },
    playNoise() {},
    startNoiseLoop: () => ({ stop() {}, setPeak() {}, isPlaying: () => false }),
    setMuted() {},
    isMuted: () => false,
    setVolume() {},
    getVolume: () => 1,
    dispose() {},
  };
}

describe('createNoteFirePlayer', () => {
  it('maps MIDI to frequency and gate seconds to milliseconds', () => {
    const calls: unknown[][] = [];
    const player = createNoteFirePlayer(fakeAudio(calls));
    player.play([
      { midi: 69, waveform: 'sine', peak: 0.4, gateS: 0.2, whenOffset: 0.125 },
    ]);
    expect(calls).toEqual([['sine', 440, 440, 200, 0.4, 0.125]]);
  });

  it('clamps negative offsets while forwarding positive offsets', () => {
    const calls: unknown[][] = [];
    const player = createNoteFirePlayer(fakeAudio(calls));
    player.play([
      { midi: 60, waveform: 'square', peak: 1, gateS: 0.1, whenOffset: -1 },
      { midi: 61, waveform: 'triangle', peak: 1, gateS: 0.1, whenOffset: 0.25 },
    ]);
    expect(calls[0][5]).toBe(0);
    expect(calls[1][5]).toBe(0.25);
  });

  it('scales event peak by music volume without changing adapter volume', () => {
    const calls: unknown[][] = [];
    const audio = fakeAudio(calls);
    let adapterVolumeWrites = 0;
    audio.setVolume = () => { adapterVolumeWrites += 1; };
    const player = createNoteFirePlayer(audio);
    player.setVolume(0.25);
    player.play([
      { midi: 60, waveform: 'square', peak: 0.4, gateS: 0.1, whenOffset: 0 },
    ]);
    expect(calls[0][4]).toBeCloseTo(0.1);
    expect(adapterVolumeWrites).toBe(0);
    expect(audio.getVolume()).toBe(1);
  });

  it('clamps finite volume values and treats every non-finite value as zero', () => {
    const player = createNoteFirePlayer(fakeAudio([]));
    player.setVolume(-1);
    expect(player.getVolume()).toBe(0);
    player.setVolume(2);
    expect(player.getVolume()).toBe(1);
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      player.setVolume(value);
      expect(player.getVolume()).toBe(0);
    }
  });

  it('treats an empty event array as a no-op', () => {
    const calls: unknown[][] = [];
    const player = createNoteFirePlayer(fakeAudio(calls));
    expect(() => player.play([])).not.toThrow();
    expect(calls).toEqual([]);
  });

  it('swallows locked and throwing host behavior and continues later events', () => {
    const calls: unknown[][] = [];
    const audio = fakeAudio(calls);
    audio.isUnlocked = () => false;
    let attempts = 0;
    audio.playTone = (...args) => {
      attempts += 1;
      if (attempts === 1) throw new Error('locked');
      calls.push(args);
    };
    const player = createNoteFirePlayer(audio);
    const events: NoteFire[] = [
      { midi: 60, waveform: 'square', peak: 1, gateS: 1, whenOffset: 0 },
      { midi: 61, waveform: 'square', peak: 1, gateS: 1, whenOffset: 0 },
    ];
    expect(() => player.play(events)).not.toThrow();
    expect(attempts).toBe(2);
    expect(calls).toHaveLength(1);
  });

  it('swallows malformed events and hostile event-array iteration', () => {
    const calls: unknown[][] = [];
    const player = createNoteFirePlayer(fakeAudio(calls));
    const hostileEvent = {} as NoteFire;
    Object.defineProperty(hostileEvent, 'midi', {
      get() { throw new Error('hostile midi'); },
    });
    expect(() => player.play([
      null as unknown as NoteFire,
      hostileEvent,
      {
        midi: Number.NaN,
        waveform: 'sine',
        peak: Number.POSITIVE_INFINITY,
        gateS: Number.NaN,
        whenOffset: Number.NaN,
      },
    ])).not.toThrow();
    expect(calls).toEqual([]);
    expect(() => player.play(null as unknown as readonly NoteFire[])).not.toThrow();

    const hostileEvents = new Proxy([] as NoteFire[], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) throw new Error('hostile iterator');
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => player.play(hostileEvents)).not.toThrow();
  });

  it('sanitizes malformed timing and gain fields before calling the host', () => {
    const calls: unknown[][] = [];
    const player = createNoteFirePlayer(fakeAudio(calls));
    player.play([
      {
        midi: 60,
        waveform: 'sine',
        peak: Number.POSITIVE_INFINITY,
        gateS: Number.NaN,
        whenOffset: Number.NEGATIVE_INFINITY,
      },
      {
        midi: 61,
        waveform: 'triangle',
        peak: -1,
        gateS: -1,
        whenOffset: -1,
      },
      {
        midi: 62,
        waveform: 'square',
        peak: 1,
        gateS: Number.MAX_VALUE,
        whenOffset: 0,
      },
      {
        midi: Number.MAX_VALUE,
        waveform: 'square',
        peak: 1,
        gateS: 1,
        whenOffset: 0,
      },
    ]);
    expect(calls).toHaveLength(3);
    expect(calls[0].slice(3)).toEqual([0, 0, 0]);
    expect(calls[1].slice(3)).toEqual([0, 0, 0]);
    expect(calls[2].slice(3)).toEqual([0, 1, 0]);
  });

  it('does not mutate or retain event inputs', () => {
    const calls: unknown[][] = [];
    const player = createNoteFirePlayer(fakeAudio(calls));
    const event = Object.freeze({
      midi: 69,
      waveform: 'sine' as const,
      peak: 0.4,
      gateS: 0.2,
      whenOffset: -1,
    });
    const events = Object.freeze([event]);
    player.play(events);
    expect(events[0]).toBe(event);
    expect(event).toEqual({
      midi: 69,
      waveform: 'sine',
      peak: 0.4,
      gateS: 0.2,
      whenOffset: -1,
    });
    expect(calls).toEqual([['sine', 440, 440, 200, 0.4, 0]]);
  });

  it('repeated disposal is safe and permanently disables playback', () => {
    const calls: unknown[][] = [];
    const player = createNoteFirePlayer(fakeAudio(calls));
    player.dispose();
    expect(() => player.dispose()).not.toThrow();
    expect(() => player.play([
      { midi: 60, waveform: 'square', peak: 1, gateS: 1, whenOffset: 0 },
    ])).not.toThrow();
    expect(calls).toEqual([]);
  });
});
