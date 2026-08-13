import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGameLoop } from '../game-loop';

/**
 * Workstream F1: callback error handling.
 *
 * Before this work, `frame()` called the consumer's `step` (via
 * `advanceAccumulator`) and `render` with NO try/catch. A throwing callback
 * killed the rAF chain silently, freezing the last frame on screen. These
 * tests cover the new `onError` / `errorPolicy` config and the `lastError` /
 * `stoppedDueToError` handle fields.
 *
 * The rAF / `performance.now()` / `document` harness mirrors
 * `game-loop.test.ts`. Frame deltas use a comfortably multi-step window
 * (rather than an exact 1× fixedDt) to avoid floating-point boundary effects
 * in `now - lastFrameTime`; the throwing callbacks abort after their first
 * invocation regardless, so exact counts stay deterministic.
 */
describe('createGameLoop — callback error handling', () => {
  const FIXED_DT = 1 / 60;
  // A real-time delta spanning several fixed steps (well under the
  // maxFrameDelta clamp). Guarantees >= 1 step fires per frame without sitting
  // on the 1× fixedDt floating-point boundary.
  const FRAME_MS = 3 * FIXED_DT * 1000;

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

  it('step throws, default policy, no onError -> loop stops; lastError recorded; no throw escapes; no re-fire', () => {
    const stepError = new Error('boom-step');
    const step = vi.fn(() => {
      throw stepError;
    });
    const render = vi.fn();
    const loop = createGameLoop({ step, render, fixedDt: FIXED_DT });

    // start() only schedules; it never calls step synchronously.
    expect(() => loop.start()).not.toThrow();
    expect(loop.isRunning()).toBe(true);

    // Fire the first frame: step throws on its first invocation. The throw
    // must be contained — it must not escape frame() nor kill the caller.
    mockTimeMs += FRAME_MS;
    expect(() => rafCb!(mockTimeMs)).not.toThrow();

    // step threw immediately, so exactly one call regardless of how many fixed
    // steps the delta would otherwise span.
    expect(step).toHaveBeenCalledTimes(1);
    expect(loop.stoppedDueToError).toBe(true);
    expect(loop.lastError).toBe(stepError);
    // running intent cleared so isRunning() reflects the halt.
    expect(loop.isRunning()).toBe(false);
    // Render was never reached (step threw first).
    expect(render).not.toHaveBeenCalled();

    // A stray re-fire (or any future frame) must NOT call step again — the
    // latched stoppedDueToError flag short-circuits frame().
    const callsAfterHalt = step.mock.calls.length;
    mockTimeMs += FRAME_MS;
    expect(() => rafCb!(mockTimeMs)).not.toThrow();
    expect(step.mock.calls.length).toBe(callsAfterHalt);

    loop.dispose();
  });

  it('render throws, default policy, no onError -> loop stops; lastError recorded; no throw escapes; no re-fire', () => {
    const renderError = new Error('boom-render');
    const step = vi.fn();
    const render = vi.fn(() => {
      throw renderError;
    });
    // No errorPolicy set -> defaults to 'stop'. No onError -> host is notified
    // only via the handle fields.
    const loop = createGameLoop({ step, render, fixedDt: FIXED_DT });

    // start() only schedules; it never calls render synchronously.
    expect(() => loop.start()).not.toThrow();
    expect(loop.isRunning()).toBe(true);

    // Fire the first frame: step runs fine, then render throws on its first
    // invocation. The throw must be contained — it must not escape frame() nor
    // kill the caller.
    mockTimeMs += FRAME_MS;
    expect(() => rafCb!(mockTimeMs)).not.toThrow();

    // step completed (>= 1 fixed step in the frame), then render threw once.
    expect(step).toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
    expect(loop.stoppedDueToError).toBe(true);
    expect(loop.lastError).toBe(renderError);
    // running intent cleared so isRunning() reflects the halt.
    expect(loop.isRunning()).toBe(false);

    // A stray re-fire (or any future frame) must NOT call step OR render again
    // — the latched stoppedDueToError flag short-circuits frame().
    const stepsAfterHalt = step.mock.calls.length;
    const rendersAfterHalt = render.mock.calls.length;
    mockTimeMs += FRAME_MS;
    expect(() => rafCb!(mockTimeMs)).not.toThrow();
    expect(step.mock.calls.length).toBe(stepsAfterHalt);
    expect(render.mock.calls.length).toBe(rendersAfterHalt);

    loop.dispose();
  });

  it("step throws, errorPolicy 'continue', onError provided -> onError called with phase 'step'; loop keeps running", () => {
    const stepError = new Error('boom-step');
    const step = vi.fn(() => {
      throw stepError;
    });
    const render = vi.fn();
    const onError = vi.fn();
    const loop = createGameLoop({
      step,
      render,
      fixedDt: FIXED_DT,
      errorPolicy: 'continue',
      onError,
    });
    loop.start();

    // Frame 1: step throws, onError notified, loop reschedules (keeps running).
    mockTimeMs += FRAME_MS;
    expect(() => rafCb!(mockTimeMs)).not.toThrow();
    expect(step).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(stepError, { phase: 'step' });
    expect(loop.stoppedDueToError).toBe(false);
    expect(loop.isRunning()).toBe(true);

    // Frame 2: the loop is still alive, so step is called AGAIN and throws again.
    mockTimeMs += FRAME_MS;
    expect(() => rafCb!(mockTimeMs)).not.toThrow();
    expect(step).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenNthCalledWith(2, stepError, { phase: 'step' });
    expect(loop.stoppedDueToError).toBe(false);

    loop.dispose();
  });

  it("render throws, errorPolicy 'continue' -> onError called with phase 'render'; loop keeps running", () => {
    const renderError = new Error('boom-render');
    const step = vi.fn();
    const render = vi.fn(() => {
      throw renderError;
    });
    const onError = vi.fn();
    const loop = createGameLoop({
      step,
      render,
      fixedDt: FIXED_DT,
      errorPolicy: 'continue',
      onError,
    });
    loop.start();

    // Frame 1: step runs fine, then render throws.
    mockTimeMs += FRAME_MS;
    expect(() => rafCb!(mockTimeMs)).not.toThrow();
    expect(step).toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(renderError, { phase: 'render' });
    expect(loop.stoppedDueToError).toBe(false);
    expect(loop.isRunning()).toBe(true);

    // Frame 2: loop kept running, render is called again (and throws again).
    mockTimeMs += FRAME_MS;
    expect(() => rafCb!(mockTimeMs)).not.toThrow();
    expect(render).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenNthCalledWith(2, renderError, { phase: 'render' });
    expect(loop.stoppedDueToError).toBe(false);

    loop.dispose();
  });

  it("onError itself throws, errorPolicy 'continue' -> handler throw swallowed; loop keeps running; nothing escapes frame()", () => {
    const stepError = new Error('boom-step');
    const step = vi.fn(() => {
      throw stepError;
    });
    const render = vi.fn();
    // A BROKEN error handler that itself throws. The loop wraps onError in its
    // own try/catch so this secondary throw must be swallowed — it can never
    // crash the host, break the rAF chain, or block the 'continue' reschedule.
    const handlerError = new Error('broken-handler');
    const onError = vi.fn(() => {
      throw handlerError;
    });
    const loop = createGameLoop({
      step,
      render,
      fixedDt: FIXED_DT,
      errorPolicy: 'continue',
      onError,
    });
    loop.start();

    // Frame 1: step throws, the broken onError is invoked and ALSO throws, but
    // that throw must be swallowed — nothing escapes frame(). lastError records
    // the STEP error (set before onError runs), not the handler's throw. The
    // 'continue' policy still reschedules, so the loop stays alive.
    mockTimeMs += FRAME_MS;
    expect(() => rafCb!(mockTimeMs)).not.toThrow();
    expect(step).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(stepError, { phase: 'step' });
    expect(loop.lastError).toBe(stepError);
    expect(loop.stoppedDueToError).toBe(false);
    expect(loop.isRunning()).toBe(true);

    // Frame 2: the loop is still alive, so step is called AGAIN (throws again,
    // broken handler throws again — all swallowed). The loop did not crash.
    mockTimeMs += FRAME_MS;
    expect(() => rafCb!(mockTimeMs)).not.toThrow();
    expect(step).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(loop.stoppedDueToError).toBe(false);
    expect(loop.isRunning()).toBe(true);

    loop.dispose();
  });

  it('normal operation (no throw) -> onError never called; stoppedDueToError false; lastError falsy', () => {
    const step = vi.fn();
    const render = vi.fn();
    const onError = vi.fn();
    const loop = createGameLoop({
      step,
      render,
      fixedDt: FIXED_DT,
      onError,
    });
    loop.start();

    // Two healthy frames.
    mockTimeMs += 2.5 * FIXED_DT * 1000;
    rafCb!(mockTimeMs);
    mockTimeMs += FIXED_DT * 1000;
    rafCb!(mockTimeMs);

    expect(step).toHaveBeenCalled();
    expect(render).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(loop.stoppedDueToError).toBe(false);
    expect(loop.lastError).toBeFalsy();
    expect(loop.isRunning()).toBe(true);

    loop.dispose();
  });
});
