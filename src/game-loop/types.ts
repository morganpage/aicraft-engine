/**
 * Type definitions for the game-loop module.
 *
 * The module splits the fixed-step game loop into two layers (mirrors
 * Spitekeep's `src/main.ts` ~L442-530):
 *   - **Pure accumulator** (`advanceAccumulator` in `fixed-step.ts`) — DOM-free
 *     fixed-timestep math, unit-testable under Node with no mocking.
 *   - **Defensive loop adapter** (`createGameLoop` in `fixed-step.ts`) —
 *     host-touching code that resolves `requestAnimationFrame` /
 *     `performance.now()` / `document` lazily, swallows all errors, and never
 *     throws (see `src/primitives/motion.ts` for the canonical defensive-adapter
 *     pattern).
 *
 * @module
 */

/** Configuration for {@link createGameLoop}. */
export interface GameLoopConfig {
  /**
   * Fixed simulation timestep in seconds. Default `1/60` (60 Hz). The `step`
   * callback receives exactly this value each call — never a variable dt — so
   * simulation logic is deterministic regardless of the display's refresh rate.
   */
  fixedDt?: number;
  /**
   * Maximum frame delta in seconds before clamping (spiral-of-death guard).
   * Default `1/6` (~10 max catch-up steps per frame at 60 Hz). If the tab was
   * backgrounded or the device stalled, the loop does NOT try to run hundreds
   * of catch-up steps — it clamps the delta and simulates at most
   * `floor(maxFrameDelta / fixedDt)` steps per frame.
   */
  maxFrameDelta?: number;
  /**
   * Called once per fixed step with `fixedDt` (seconds). This is where the
   * simulation advances: poll input, step entities, resolve collisions, advance
   * animation, etc. Poll input EXACTLY once per invocation — input edges are
   * drained per poll (see `src/input/`).
   */
  step: (dt: number) => void;
  /**
   * Called once per animation frame, after all fixed steps for that frame.
   * `alpha` ∈ [0, 1) is the interpolation factor: how far into the next fixed
   * step the simulation has accumulated. Most side-on games ignore `alpha` and
   * render the current state directly; it is provided for consumers that want
   * smooth sub-step interpolation on high-refresh (120/144 Hz) displays.
   */
  render: (alpha: number) => void;
}

/** A running fixed-step game loop. Returned by {@link createGameLoop}. */
export interface GameLoop {
  /**
   * Start the loop: reset the accumulator and schedule the first animation
   * frame. Idempotent — a no-op if already running, already disposed, or if the
   * host has no `requestAnimationFrame` (Node / SSR / test). Never throws.
   */
  start(): void;
  /**
   * Stop the loop: cancel the pending animation frame. Idempotent — a no-op if
   * already stopped. Never throws.
   */
  stop(): void;
  /**
   * Whether the loop is currently running (started, not stopped, not disposed).
   * Reflects the caller's intent: a tab-hidden pause does NOT flip this (the
   * loop resumes automatically on regain).
   */
  isRunning(): boolean;
  /**
   * Permanently tear down: stop the loop and remove the `visibilitychange`
   * listener. After `dispose()`, `start()` is a silent no-op. Idempotent.
   * Never throws.
   */
  dispose(): void;
}
