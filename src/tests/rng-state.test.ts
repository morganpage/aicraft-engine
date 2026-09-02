import { describe, it, expect } from 'vitest';
import {
  createRngState,
  advanceRng,
  nextRngInt,
  type SerializableRngState,
} from '../rng/state';
import { mulberry32 } from '../rng/mulberry32';

/**
 * Known-answer vectors captured from the original closure `mulberry32`
 * implementation before the pure-state API existed. The pure API must
 * reproduce these byte-for-byte: saves and replays depend on the stream
 * never changing across engine versions.
 */
const KNOWN_FLOAT_VECTORS: Readonly<Record<string, readonly number[]>> = {
  '0': [0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111, 0.46732782293111086, 0.5450490827206522],
  '1': [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849, 0.281103502959013],
  '12345': [0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203, 0.5094283693470061, 0.34747186047025025],
  '4294967295': [0.8964226141106337, 0.189478256739676, 0.7156526781618595, 0.9440599093213677, 0.8452364315744489, 0.5391399988438934],
  '3735928559': [0.9413696140982211, 0.26719574979506433, 0.772033357527107, 0.35816076025366783, 0.47554167779162526, 0.8382313968613744],
};

/** State words after each advance from seed 777 (uint32). */
const KNOWN_WORDS_777: readonly number[] = [1831566590, 3663132403, 1199730920, 3031296733];

const RESUME_SEED = 20260902;

function drain(
  state: SerializableRngState,
  count: number,
): { state: SerializableRngState; values: number[] } {
  let current = state;
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const stepped = advanceRng(current);
    values.push(stepped.value);
    current = stepped.state;
  }
  return { state: current, values };
}

describe('createRngState', () => {
  it('normalizes the seed to an unsigned 32-bit state word', () => {
    expect(createRngState(-1).value).toBe(0xffffffff);
    expect(createRngState(0).value).toBe(0);
    expect(createRngState(Number.NaN).value).toBe(0);
  });
  it('coerces a negative seed to the same stream as its uint32 image', () => {
    const negative = drain(createRngState(-1), 6).values;
    const unsigned = drain(createRngState(0xffffffff), 6).values;
    expect(negative).toEqual(unsigned);
  });
});

describe('advanceRng', () => {
  it('reproduces the pinned mulberry32 float vectors exactly', () => {
    for (const [seedText, expected] of Object.entries(KNOWN_FLOAT_VECTORS)) {
      const seed = Number(seedText);
      const { values } = drain(createRngState(seed), expected.length);
      expect(values).toEqual(expected);
    }
  });
  it('matches the closure mulberry32 draw-for-draw over 100 draws', () => {
    for (const seed of [0, 1, 12345, 0xdeadbeef]) {
      const closure = mulberry32(seed);
      const { values } = drain(createRngState(seed), 100);
      for (let i = 0; i < 100; i++) {
        expect(values[i]).toBe(closure());
      }
    }
  });
  it('produces state words matching the pinned vectors (uint32)', () => {
    let state = createRngState(777);
    for (let i = 0; i < KNOWN_WORDS_777.length; i++) {
      const stepped = advanceRng(state);
      expect(Number.isInteger(stepped.state.value)).toBe(true);
      expect(stepped.state.value).toBeGreaterThanOrEqual(0);
      expect(stepped.state.value).toBeLessThanOrEqual(0xffffffff);
      expect(stepped.state.value).toBe(KNOWN_WORDS_777[i]);
      state = stepped.state;
    }
  });
  it('outputs floats in [0, 1)', () => {
    const { values } = drain(createRngState(424242), 1000);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('is pure: advancing the same state twice yields identical results', () => {
    const state = createRngState(99);
    const first = advanceRng(state);
    const second = advanceRng(state);
    expect(first).toEqual(second);
    expect(state).toEqual(createRngState(99));
  });
  it('supports branching: cloned states continue identically', () => {
    const { state: forkPoint } = drain(createRngState(31337), 5);
    const a = drain(forkPoint, 10).values;
    const b = drain(forkPoint, 10).values;
    expect(a).toEqual(b);
  });
});

describe('SerializableRngState serialization', () => {
  it('round-trips through JSON and resumes the exact stream', () => {
    const { state: midStream } = drain(createRngState(RESUME_SEED), 10);
    const restored: SerializableRngState = JSON.parse(JSON.stringify(midStream));
    const resumed = drain(restored, 10).values;
    const uninterrupted = drain(createRngState(RESUME_SEED), 20).values.slice(10);
    expect(resumed).toEqual(uninterrupted);
  });
  it('survives storage as a plain JSON object with one numeric field', () => {
    const { state } = drain(createRngState(5), 3);
    const parsed = JSON.parse(JSON.stringify(state));
    expect(Object.keys(parsed).sort()).toEqual(['value']);
    expect(typeof parsed.value).toBe('number');
  });
});

describe('nextRngInt', () => {
  it('returns inclusive integers within the range', () => {
    let state = createRngState(777);
    for (let i = 0; i < 100; i++) {
      const stepped = nextRngInt(state, 1, 6);
      expect(Number.isInteger(stepped.value)).toBe(true);
      expect(stepped.value).toBeGreaterThanOrEqual(1);
      expect(stepped.value).toBeLessThanOrEqual(6);
      state = stepped.state;
    }
  });
  it('matches the closure nextInt mapping for mixed ranges', () => {
    const closure = mulberry32(777);
    const expected: number[] = [];
    for (let i = 0; i < 3; i++) expected.push(Math.floor(closure() * 6) + 1);
    for (let i = 0; i < 2; i++) expected.push(Math.floor(closure() * 10000));

    let state = createRngState(777);
    const values: number[] = [];
    const ranges: readonly [number, number][] = [[1, 6], [1, 6], [1, 6], [0, 9999], [0, 9999]];
    for (const [min, max] of ranges) {
      const stepped = nextRngInt(state, min, max);
      values.push(stepped.value);
      state = stepped.state;
    }
    expect(values).toEqual(expected);
  });
  it('consumes exactly one underlying draw', () => {
    const state = createRngState(555);
    const viaInt = nextRngInt(state, 10, 20);
    const viaAdvance = advanceRng(state);
    expect(viaInt.state).toEqual(viaAdvance.state);
    expect(viaInt.value).toBe(Math.floor(viaAdvance.value * 11) + 10);
  });
  it('returns min when min === max', () => {
    const { value } = nextRngInt(createRngState(1), 7, 7);
    expect(value).toBe(7);
  });
  it('returns the coerced min for an inverted range instead of throwing', () => {
    const stepped = nextRngInt(createRngState(1), 9, 2);
    expect(stepped.value).toBe(9);
    expect(stepped.state).toEqual(advanceRng(createRngState(1)).state);
  });
  it('coerces non-finite bounds to zero instead of throwing', () => {
    const stepped = nextRngInt(createRngState(1), Number.NaN, Number.POSITIVE_INFINITY);
    expect(stepped.value).toBe(0);
  });
  it('supports negative ranges', () => {
    let state = createRngState(808);
    for (let i = 0; i < 50; i++) {
      const stepped = nextRngInt(state, -5, 5);
      expect(stepped.value).toBeGreaterThanOrEqual(-5);
      expect(stepped.value).toBeLessThanOrEqual(5);
      state = stepped.state;
    }
  });
});
