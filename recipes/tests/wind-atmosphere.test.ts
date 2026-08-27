import { describe, expect, it, vi } from 'vitest';
import type { AudioAdapter, NoiseLoopHandle } from '../../src/index';
import {
  WIND_TUNING,
  createWind,
  gustEnvelope,
  snowWind,
  stepWind,
  windVoices,
  type Wind,
} from '../wind-atmosphere';

const DT = 1 / 60;

/** A recording adapter: unlocked on demand, one fake noise loop. */
function stubAudio(unlocked = true) {
  const handle = {
    setPeak: vi.fn(),
    setFrequency: vi.fn(),
    setQ: vi.fn(),
    stop: vi.fn(),
    isPlaying: vi.fn(() => true),
  } as unknown as NoiseLoopHandle;
  const startNoiseLoop = vi.fn(
    (_type: string, _hz: number, _peak: number, _opts?: unknown): NoiseLoopHandle => handle,
  );
  const audio = {
    isUnlocked: () => unlocked,
    startNoiseLoop,
  } as unknown as AudioAdapter;
  return { audio, handle, startNoiseLoop };
}

function run(wind: Wind, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) stepWind(wind, DT);
}

describe('gustEnvelope', () => {
  it('stays inside [GUST_FLOOR, 1] across a whole cycle', () => {
    for (let i = 0; i <= 200; i += 1) {
      const v = gustEnvelope(i / 200);
      expect(v).toBeGreaterThanOrEqual(WIND_TUNING.GUST_FLOOR - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('never returns still air — the floor keeps the bed alive', () => {
    const min = Math.min(...Array.from({ length: 200 }, (_, i) => gustEnvelope(i / 200)));
    expect(min).toBeGreaterThan(0);
  });

  it('warps toward events: most of the cycle sits below the midpoint', () => {
    const samples = Array.from({ length: 400 }, (_, i) => gustEnvelope(i / 400));
    const below = samples.filter((v) => v < 0.5).length;
    expect(below).toBeGreaterThan(samples.length * 0.5);
  });
});

describe('windVoices', () => {
  it('brightens AND loudens with the gust — amplitude alone reads as a volume knob', () => {
    const { audio } = stubAudio();
    const lull = createWind(audio, 1);
    const peak = createWind(audio, 1);
    lull.gust = 0.1;
    peak.gust = 0.9;
    expect(windVoices(peak).peak).toBeGreaterThan(windVoices(lull).peak);
    expect(windVoices(peak).hz).toBeGreaterThan(windVoices(lull).hz);
  });

  it('scales the peak with intensity but keeps the gust range at any intensity', () => {
    const { audio } = stubAudio();
    const quiet = createWind(audio, 0.2);
    const loud = createWind(audio, 1);
    quiet.gust = loud.gust = 0.8;
    expect(windVoices(quiet).peak).toBeLessThan(windVoices(loud).peak);
    // The FILTER does not care about intensity — that is what keeps the
    // weather audibly moving when you turn it down.
    expect(windVoices(quiet).hz).toBe(windVoices(loud).hz);
  });
});

describe('stepWind', () => {
  it('starts the voice only once, and only after unlock', () => {
    const locked = stubAudio(false);
    const w1 = createWind(locked.audio, 1);
    run(w1, 30);
    expect(locked.startNoiseLoop).not.toHaveBeenCalled();

    const open = stubAudio(true);
    const w2 = createWind(open.audio, 1);
    run(w2, 30);
    expect(open.startNoiseLoop).toHaveBeenCalledTimes(1);
    expect(open.startNoiseLoop.mock.calls[0]?.[0]).toBe('bandpass');
  });

  it('throttles param pushes to every 8th tick, not every tick', () => {
    const { audio, handle } = stubAudio();
    const wind = createWind(audio, 1);
    run(wind, 80);
    expect((handle.setPeak as ReturnType<typeof vi.fn>).mock.calls.length).toBe(10);
  });

  it('pushes the snow leftward and monotonically', () => {
    const { audio } = stubAudio();
    const wind = createWind(audio, 1);
    let previous = 0;
    for (let i = 0; i < 600; i += 1) {
      stepWind(wind, DT);
      expect(wind.driftX).toBeLessThanOrEqual(previous);
      previous = wind.driftX;
    }
    expect(wind.driftX).toBeLessThan(0);
  });

  it('jitters the cycle length without ever going non-positive', () => {
    const { audio } = stubAudio();
    const wind = createWind(audio, 1);
    const periods = new Set<number>();
    for (let i = 0; i < 60 * 120; i += 1) {
      stepWind(wind, DT);
      periods.add(wind.gustPeriod);
      expect(wind.gustPeriod).toBeGreaterThan(0);
    }
    // A fixed period is a metronome the ear finds inside thirty seconds.
    expect(periods.size).toBeGreaterThan(1);
  });

  it('is deterministic — two seeded runs are identical (§12.6)', () => {
    const a = createWind(stubAudio().audio, 0.35);
    const b = createWind(stubAudio().audio, 0.35);
    for (let i = 0; i < 60 * 90; i += 1) {
      stepWind(a, DT);
      stepWind(b, DT);
    }
    expect(a.gust).toBe(b.gust);
    expect(a.driftX).toBe(b.driftX);
    expect(a.gustPeriod).toBe(b.gustPeriod);
  });

  it('honours an injected tuning rather than the module default', () => {
    const frozen = { ...WIND_TUNING, DYNAMICS_AMOUNT: 0, DYNAMICS_HOLD: 0.5 };
    const wind = createWind(stubAudio().audio, 1, frozen);
    run(wind, 300);
    // DYNAMICS_AMOUNT 0 holds the weather perfectly steady — the lab workflow.
    expect(wind.gust).toBeCloseTo(0.5, 10);
  });
});

describe('snowWind', () => {
  it('hands the sky exactly the two numbers it needs', () => {
    const wind = createWind(stubAudio().audio, 1);
    run(wind, 120);
    const handoff = snowWind(wind);
    expect(Object.keys(handoff).sort()).toEqual(['driftX', 'swayGain']);
    expect(handoff.driftX).toBe(wind.driftX);
    expect(handoff.swayGain).toBeGreaterThanOrEqual(1);
  });
});
