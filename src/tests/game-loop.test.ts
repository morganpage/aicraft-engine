import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  advanceAccumulator,
  createGameLoop,
  DEFAULT_FIXED_DT,
  DEFAULT_MAX_FRAME_DELTA,
} from '../game-loop';

describe('DEFAULT_* constants', () => {
  it('exports DEFAULT_FIXED_DT = 1/60', () => {
    expect(DEFAULT_FIXED_DT).toBe(1 / 60);
  });

  it('exports DEFAULT_MAX_FRAME_DELTA = 1/6', () => {
    expect(DEFAULT_MAX_FRAME_DELTA).toBe(1 / 6);
  });
});

describe('advanceAccumulator', () => {
  const FIXED_DT = 1 / 60;
  const MAX = 1 / 6;

  it('zero delta: no steps, accumulator unchanged, alpha = accumulator / fixedDt', () => {
    const step = vi.fn();
    const accIn = 0.3 * FIXED_DT;
    const result = advanceAccumulator(accIn, 0, FIXED_DT, MAX, step);
    expect(step).not.toHaveBeenCalled();
    expect(result.accumulator).toBe(accIn);
    expect(result.alpha).toBeCloseTo(0.3);
  });

  it('delta = exactly fixedDt: one step, accumulator -> 0, alpha -> 0', () => {
    const step = vi.fn();
    const result = advanceAccumulator(0, FIXED_DT, FIXED_DT, MAX, step);
    expect(step).toHaveBeenCalledTimes(1);
    expect(step).toHaveBeenCalledWith(FIXED_DT);
    expect(result.accumulator).toBe(0);
    expect(result.alpha).toBe(0);
  });

  it('delta = 2 x fixedDt: two steps, accumulator -> 0', () => {
    const step = vi.fn();
    const result = advanceAccumulator(0, 2 * FIXED_DT, FIXED_DT, MAX, step);
    expect(step).toHaveBeenCalledTimes(2);
    expect(result.accumulator).toBe(0);
  });

  it('delta = 2.5 x fixedDt: two steps, accumulator -> 0.5*fixedDt, alpha -> 0.5', () => {
    const step = vi.fn();
    const result = advanceAccumulator(0, 2.5 * FIXED_DT, FIXED_DT, MAX, step);
    expect(step).toHaveBeenCalledTimes(2);
    expect(result.accumulator).toBeCloseTo(0.5 * FIXED_DT);
    expect(result.alpha).toBeCloseTo(0.5);
  });

  it('delta = 0: zero steps', () => {
    const step = vi.fn();
    const result = advanceAccumulator(0, 0, FIXED_DT, MAX, step);
    expect(step).not.toHaveBeenCalled();
    expect(result.accumulator).toBe(0);
    expect(result.alpha).toBe(0);
  });

  it('delta > maxFrameDelta is clamped to maxFrameDelta (spiral-of-death guard)', () => {
    const stepHuge = vi.fn();
    advanceAccumulator(0, 5, FIXED_DT, MAX, stepHuge); // 5s, far over MAX
    const stepMax = vi.fn();
    advanceAccumulator(0, MAX, FIXED_DT, MAX, stepMax); // exactly MAX
    // Clamped case runs the SAME number of steps as the max-clamped case...
    expect(stepHuge).toHaveBeenCalledTimes(stepMax.mock.calls.length);
    // ...which is ~10 at 60Hz, NOT the ~300 an unclamped 5s burst would run.
    expect(stepHuge.mock.calls.length).toBeLessThan(50);
    expect(stepHuge.mock.calls.length).toBe(Math.floor(MAX / FIXED_DT));
  });

  it('step callback receives exactly fixedDt each call (never a variable dt)', () => {
    const step = vi.fn();
    advanceAccumulator(0, 3.7 * FIXED_DT, FIXED_DT, MAX, step);
    expect(step).toHaveBeenCalledTimes(3);
    for (const call of step.mock.calls) {
      expect(call[0]).toBe(FIXED_DT);
    }
  });

  it('purity: same inputs -> same outputs and same step count', () => {
    const step1 = vi.fn();
    const step2 = vi.fn();
    const r1 = advanceAccumulator(0.2 * FIXED_DT, 2.3 * FIXED_DT, FIXED_DT, MAX, step1);
    const r2 = advanceAccumulator(0.2 * FIXED_DT, 2.3 * FIXED_DT, FIXED_DT, MAX, step2);
    expect(step1).toHaveBeenCalledTimes(step2.mock.calls.length);
    expect(r1.accumulator).toBe(r2.accumulator);
    expect(r1.alpha).toBe(r2.alpha);
  });

  it('carries leftover accumulator across calls (sub-step remainder)', () => {
    const step = vi.fn();
    // Frame 1: 2.5*fixedDt -> 2 steps, leftover 0.5*fixedDt.
    const r1 = advanceAccumulator(0, 2.5 * FIXED_DT, FIXED_DT, MAX, step);
    expect(step).toHaveBeenCalledTimes(2);
    expect(r1.accumulator).toBeCloseTo(0.5 * FIXED_DT);
    // Frame 2: +0.6*fixedDt -> 0.5 + 0.6 = 1.1*fixedDt -> 1 step, leftover 0.1.
    step.mockClear();
    const r2 = advanceAccumulator(r1.accumulator, 0.6 * FIXED_DT, FIXED_DT, MAX, step);
    expect(step).toHaveBeenCalledTimes(1);
    expect(r2.accumulator).toBeCloseTo(0.1 * FIXED_DT);
  });

  it('alpha stays in [0, 1) regardless of delta', () => {
    const step = vi.fn();
    const r = advanceAccumulator(0.9 * FIXED_DT, 0.05 * FIXED_DT, FIXED_DT, MAX, step);
    expect(r.alpha).toBeGreaterThanOrEqual(0);
    expect(r.alpha).toBeLessThan(1);
  });
});

describe('createGameLoop', () => {
  const FIXED_DT = 1 / 60;

  let mockTimeMs: number;
  let rafCb: ((time: number) => void) | null;
  let rafMock: ReturnType<typeof vi.fn>;
  let cancelMock: ReturnType<typeof vi.fn>;
  let docMock: {
    hidden: boolean;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockTimeMs = 1000;
    rafCb = null;
    let handle = 0;
    rafMock = vi.fn((cb: (time: number) => void) => {
      rafCb = cb;
      return ++handle;
    });
    cancelMock = vi.fn();
    docMock = {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('requestAnimationFrame', rafMock);
    vi.stubGlobal('cancelAnimationFrame', cancelMock);
    vi.stubGlobal('performance', { now: () => mockTimeMs });
    vi.stubGlobal('document', docMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('start() is a silent no-op without requestAnimationFrame (Node env)', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const step = vi.fn();
    const render = vi.fn();
    const loop = createGameLoop({ step, render });
    expect(() => loop.start()).not.toThrow();
    expect(loop.isRunning()).toBe(false);
    expect(step).not.toHaveBeenCalled();
  });

  it('start() schedules the first RAF frame', () => {
    const step = vi.fn();
    const render = vi.fn();
    const loop = createGameLoop({ step, render });
    loop.start();
    expect(loop.isRunning()).toBe(true);
    expect(rafMock).toHaveBeenCalledTimes(1);
    loop.dispose();
  });

  it('stop() cancels the RAF', () => {
    const step = vi.fn();
    const render = vi.fn();
    const loop = createGameLoop({ step, render });
    loop.start();
    loop.stop();
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(loop.isRunning()).toBe(false);
  });

  it('simulated frames call step the right number of times and render once per frame', () => {
    const step = vi.fn();
    const render = vi.fn();
    const loop = createGameLoop({ step, render, fixedDt: FIXED_DT });
    loop.start();

    // Advance 2.5 fixed steps of real time, fire one frame -> 2 steps.
    mockTimeMs += 2.5 * FIXED_DT * 1000;
    rafCb!(mockTimeMs);
    expect(step).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenCalledTimes(1);

    // Advance 0.6 fixed steps more (leftover carries), fire one frame -> 1 step.
    mockTimeMs += 0.6 * FIXED_DT * 1000;
    rafCb!(mockTimeMs);
    expect(step).toHaveBeenCalledTimes(3);
    expect(render).toHaveBeenCalledTimes(2);

    loop.dispose();
  });

  it('start() when already running is a no-op (no double RAF)', () => {
    const step = vi.fn();
    const render = vi.fn();
    const loop = createGameLoop({ step, render });
    loop.start();
    expect(rafMock).toHaveBeenCalledTimes(1);
    loop.start(); // no-op
    expect(rafMock).toHaveBeenCalledTimes(1);
    loop.dispose();
  });

  it('stop() when already stopped is a no-op', () => {
    const step = vi.fn();
    const render = vi.fn();
    const loop = createGameLoop({ step, render });
    loop.start();
    loop.stop();
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(() => loop.stop()).not.toThrow();
    expect(cancelMock).toHaveBeenCalledTimes(1); // still just one cancel
  });

  it('dispose() removes the visibility listener', () => {
    const step = vi.fn();
    const render = vi.fn();
    const loop = createGameLoop({ step, render });
    expect(docMock.addEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
    loop.dispose();
    expect(docMock.removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
    expect(loop.isRunning()).toBe(false);
  });

  it('start() after dispose() is a no-op', () => {
    const step = vi.fn();
    const render = vi.fn();
    const loop = createGameLoop({ step, render });
    loop.start();
    const callsBefore = rafMock.mock.calls.length;
    loop.dispose();
    loop.start(); // disposed -> no-op
    expect(rafMock.mock.calls.length).toBe(callsBefore);
    expect(loop.isRunning()).toBe(false);
  });

  it('visibility hidden cancels RAF and resets accumulator; visible resumes', () => {
    const step = vi.fn();
    const render = vi.fn();
    const loop = createGameLoop({ step, render, fixedDt: FIXED_DT });
    loop.start();

    // Fire one frame: 2.5 fixed steps -> 2 steps, leftover 0.5*fixedDt.
    mockTimeMs += 2.5 * FIXED_DT * 1000;
    rafCb!(mockTimeMs);
    expect(step).toHaveBeenCalledTimes(2);

    const visHandler = docMock.addEventListener.mock.calls.find(
      (call) => call[0] === 'visibilitychange',
    )?.[1] as (() => void) | undefined;
    expect(visHandler).toBeTruthy();

    // Tab hidden -> RAF cancelled, accumulator reset to 0.
    docMock.hidden = true;
    (visHandler as () => void)();
    expect(cancelMock).toHaveBeenCalled();

    // Tab visible again -> RAF rescheduled.
    const rafCallsBefore = rafMock.mock.calls.length;
    docMock.hidden = false;
    (visHandler as () => void)();
    expect(rafMock.mock.calls.length).toBeGreaterThan(rafCallsBefore);

    // First post-resume frame with a 0.5*fixedDt delta. If the accumulator
    // was reset on hide, this yields 0 new steps (0.5 < 1). If it had leaked
    // (0.5 leftover + 0.5 = 1.0), it would yield 1 step -> step count would
    // rise to 3. Asserting 2 confirms the reset.
    mockTimeMs += 0.5 * FIXED_DT * 1000;
    rafCb!(mockTimeMs);
    expect(step).toHaveBeenCalledTimes(2);

    loop.dispose();
  });

  it('never throws if performance.now() throws (degrades gracefully)', () => {
    vi.stubGlobal('performance', {
      now: () => {
        throw new Error('performance unavailable');
      },
    });
    const step = vi.fn();
    const render = vi.fn();
    const loop = createGameLoop({ step, render });
    expect(() => loop.start()).not.toThrow();
    expect(loop.isRunning()).toBe(true);
    // Fire a frame — must not throw; render still called (loop stays alive).
    expect(() => rafCb!(mockTimeMs)).not.toThrow();
    expect(render).toHaveBeenCalled();
    loop.dispose();
  });
});
