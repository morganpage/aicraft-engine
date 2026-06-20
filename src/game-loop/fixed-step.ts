/**
 * Fixed-step game loop — the connective tissue that ties input → simulation →
 * render into a running game.
 *
 * Two layers:
 *   - {@link advanceAccumulator} — PURE fixed-timestep accumulator math. No
 *     DOM, no globals, no `Date.now()`. The only side effect is invoking the
 *     supplied `step` callback. Unit-testable under Node with no mocking.
 *   - {@link createGameLoop} — DEFENSIVE host-touching adapter that drives
 *     `advanceAccumulator` from `requestAnimationFrame`. Lazily resolves RAF,
 *     `performance.now()`, and `document`; swallows all host errors; never
 *     throws. In environments without RAF (Node / SSR), `start()` is a silent
 *     no-op.
 *
 * The pattern is extracted from Spitekeep (`src/main.ts` ~L442-530): a 60 Hz
 * fixed-step simulation with a variable-rate render, an accumulator that
 * carries sub-step remainder across frames, a `maxFrameDelta` clamp to prevent
 * the spiral-of-death, and a `visibilitychange` reset so a backgrounded tab
 * doesn't explode into a giant catch-up burst on regain.
 *
 * @module
 */

import type { GameLoop, GameLoopConfig } from './types';

/** Default fixed timestep: 60 Hz. The canonical game-sim rate. */
export const DEFAULT_FIXED_DT = 1 / 60;

/**
 * Default max frame delta before clamping (spiral-of-death guard). At 60 Hz
 * this permits ~10 catch-up steps per frame — enough to absorb a brief stall,
 * not enough to lock up on a long one. If the tab was hidden for 5 s, the loop
 * runs ~10 steps (not ~300) on regain.
 */
export const DEFAULT_MAX_FRAME_DELTA = 1 / 6;

/** Result of advancing the accumulator one frame. */
export interface AccumulatorStep {
  /** Leftover accumulated time in seconds, in `[0, fixedDt)`. Carries to next frame. */
  accumulator: number;
  /** Interpolation alpha `accumulator / fixedDt`, in `[0, 1)`. */
  alpha: number;
}

/**
 * Advance the fixed-step accumulator by one frame's delta. Calls `step(fixedDt)`
 * once per whole fixed step that fits in the (clamped) delta, then returns the
 * leftover accumulator and the interpolation alpha for the renderer.
 *
 * The delta is clamped to `maxFrameDelta` BEFORE accumulating — the
 * spiral-of-death guard. The accumulator carries sub-step remainder across
 * frames: e.g. a `2.5 × fixedDt` delta yields 2 steps and leaves
 * `0.5 × fixedDt` for the next frame.
 *
 * Pure: no DOM, no globals, no `Date.now()`. The ONLY side effect is invoking
 * the `step` callback (which the consumer controls). Same inputs always yield
 * the same number of `step` calls with the same `fixedDt` argument.
 *
 * @param accumulator  - current accumulated time in seconds (carried remainder)
 * @param frameDelta   - real time elapsed since the last frame, in seconds
 * @param fixedDt       - fixed simulation timestep in seconds (e.g. `1/60`)
 * @param maxFrameDelta - cap on `frameDelta` in seconds (spiral-of-death guard)
 * @param step          - callback invoked once per fixed step with `fixedDt`
 * @returns the leftover `accumulator` and the interpolation `alpha`
 *
 * @example
 * ```ts
 * const { accumulator: next, alpha } = advanceAccumulator(
 *   acc, frameDelta, 1 / 60, 1 / 6, (dt) => stepSimulation(dt),
 * );
 * acc = next;
 * render(alpha);
 * ```
 */
export function advanceAccumulator(
  accumulator: number,
  frameDelta: number,
  fixedDt: number,
  maxFrameDelta: number,
  step: (dt: number) => void,
): AccumulatorStep {
  // Degenerate-config guard: a non-positive fixedDt would divide by zero and
  // loop forever. Treat as a no-op frame (never throw — purity contract).
  if (!(fixedDt > 0)) {
    return { accumulator, alpha: 0 };
  }
  // Clamp the per-frame delta: time cannot go backwards, and a huge delta
  // (backgrounded tab, stalled device) must not trigger a catch-up burst.
  const clamped =
    frameDelta > maxFrameDelta ? maxFrameDelta : frameDelta < 0 ? 0 : frameDelta;
  let acc = accumulator + clamped;
  while (acc >= fixedDt) {
    step(fixedDt);
    acc -= fixedDt;
  }
  return { accumulator: acc, alpha: acc / fixedDt };
}

/**
 * Create a fixed-step game loop.
 *
 * Lazily resolves `requestAnimationFrame`, `cancelAnimationFrame`,
 * `performance.now()`, and `document` INSIDE the factory (never at module
 * load), so the module is safe to import in Node / SSR / test environments.
 * Follows the canonical defensive-adapter pattern (`src/primitives/motion.ts`):
 * all host API access is guarded and wrapped in try/catch; the public methods
 * (`start` / `stop` / `isRunning` / `dispose`) NEVER throw.
 *
 * Timing source: `performance.now()` (returned in seconds). If `performance`
 * is missing or throws, falls back to `Date.now() / 1000`. This is acceptable
 * for a timing adapter — the wall-clock delta never feeds into the
 * deterministic simulation (the sim receives the fixed `fixedDt`, not the
 * variable delta).
 *
 * Visibility handling: when the tab becomes hidden, the loop cancels its RAF
 * and resets the accumulator to 0 (prevents a catch-up burst on regain). When
 * the tab becomes visible again, the loop reschedules RAF (if it was running)
 * and resets the frame clock so the first post-resume delta is tiny.
 *
 * In environments without `requestAnimationFrame`, `start()` is a silent no-op
 * and `isRunning()` returns `false`.
 *
 * @param config - loop configuration (see {@link GameLoopConfig})
 * @returns a defensive {@link GameLoop}
 *
 * @example
 * ```ts
 * const loop = createGameLoop({
 *   fixedDt: 1 / 60,
 *   maxFrameDelta: 1 / 6,
 *   step: (dt) => {
 *     const input = inputManager.poll();   // poll EXACTLY once per fixed step
 *     world = stepWorld(world, input, dt);
 *   },
 *   render: (alpha) => drawFrame(ctx, alpha),
 * });
 * loop.start();
 * ```
 */
export function createGameLoop(config: GameLoopConfig): GameLoop {
  const fixedDt = config.fixedDt ?? DEFAULT_FIXED_DT;
  const maxFrameDelta = config.maxFrameDelta ?? DEFAULT_MAX_FRAME_DELTA;
  const step = config.step;
  const render = config.render;

  let running = false;
  let disposed = false;
  let rafId = 0;
  let lastFrameTime = 0;
  let accumulator = 0;

  // --- Lazily-resolved host accessors (resolved at factory-call time, NOT at
  //     module load). Each is guarded + try/caught; a missing or broken host
  //     API degrades to a no-op rather than throwing. ---

  let raf: ((cb: FrameRequestCallback) => number) | null = null;
  try {
    const rawRAF = globalThis.requestAnimationFrame;
    if (typeof rawRAF === 'function') {
      raf = (cb) => rawRAF(cb);
    }
  } catch {
    // Swallow — missing RAF means start() is a silent no-op.
  }

  let cancelFn: ((handle: number) => void) | null = null;
  try {
    const rawCancel = globalThis.cancelAnimationFrame;
    if (typeof rawCancel === 'function') {
      cancelFn = (handle) => rawCancel(handle);
    }
  } catch {
    // Swallow — missing cancel is harmless (we just cannot preempt a frame).
  }

  let nowFn: (() => number) | null = null;
  try {
    const perf = globalThis.performance;
    if (perf && typeof perf.now === 'function') {
      nowFn = () => perf.now() / 1000;
    }
  } catch {
    // Swallow — fall through to the Date.now() fallback below.
  }
  if (nowFn === null) {
    // Timing-adapter fallback. Date.now() is acceptable here: this wall clock
    // never feeds the deterministic sim (the sim gets fixedDt, not this delta).
    nowFn = () => Date.now() / 1000;
  }

  /** Read the current time in seconds. Never throws. */
  const readNow = (): number => {
    try {
      return nowFn();
    } catch {
      try {
        return Date.now() / 1000;
      } catch {
        return 0;
      }
    }
  };

  /** Per-frame callback scheduled by RAF. The RAF timestamp argument is not
   *  used — `readNow()` is the single timing source so units stay consistent
   *  (seconds) across `performance.now()` and the `Date.now()` fallback. */
  const frame = (): void => {
    const now = readNow();
    const frameDelta = now - lastFrameTime;
    lastFrameTime = now;
    const result = advanceAccumulator(accumulator, frameDelta, fixedDt, maxFrameDelta, step);
    accumulator = result.accumulator;
    render(result.alpha);
    if (running && !disposed) {
      try {
        if (raf) rafId = raf(frame);
      } catch {
        // Host scheduling threw — stop rescheduling to avoid a tight error loop.
        rafId = 0;
      }
    }
  };

  /** visibilitychange handler: pause on hidden, resume on visible. */
  const onVisibilityChange = (): void => {
    let hidden = false;
    try {
      hidden = globalThis.document?.hidden === true;
    } catch {
      // Swallow — treat unreadable visibility as "visible" (no pause).
    }
    if (hidden) {
      if (cancelFn && rafId) {
        try {
          cancelFn(rafId);
        } catch {
          // Swallow — idempotent teardown must not throw.
        }
      }
      rafId = 0;
      accumulator = 0;
    } else if (running && !rafId && !disposed) {
      lastFrameTime = readNow();
      try {
        if (raf) rafId = raf(frame);
      } catch {
        rafId = 0;
      }
    }
  };

  // Attach the visibility listener at creation (guarded). Stored as a named
  // reference so dispose() can remove it.
  try {
    const doc = globalThis.document;
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', onVisibilityChange);
    }
  } catch {
    // Swallow — no document means no visibility handling.
  }

  return {
    start(): void {
      if (disposed || running) return;
      // No host RAF -> silent no-op; isRunning() stays false.
      if (raf === null) return;
      running = true;
      lastFrameTime = readNow();
      accumulator = 0;
      try {
        rafId = raf(frame);
      } catch {
        running = false;
        rafId = 0;
      }
    },
    stop(): void {
      if (!running) return;
      running = false;
      if (cancelFn && rafId) {
        try {
          cancelFn(rafId);
        } catch {
          // Swallow — idempotent teardown must not throw.
        }
      }
      rafId = 0;
    },
    isRunning(): boolean {
      return running;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      running = false;
      if (cancelFn && rafId) {
        try {
          cancelFn(rafId);
        } catch {
          // Swallow — idempotent teardown must not throw.
        }
      }
      rafId = 0;
      try {
        const doc = globalThis.document;
        if (doc && typeof doc.removeEventListener === 'function') {
          doc.removeEventListener('visibilitychange', onVisibilityChange);
        }
      } catch {
        // Swallow — idempotent teardown must not throw.
      }
    },
  };
}
