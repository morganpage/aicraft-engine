/**
 * Type definitions for the input module.
 *
 * The module splits input handling into two layers (mirrors Spitekeep's
 * `src/input/`):
 *   - **Pure core** (`edges.ts`, `merge.ts`) — DOM-free edge-accumulator logic
 *     that is safe to unit-test under Node / vitest with no jsdom.
 *   - **Defensive adapters** (`keyboard.ts`, `touch-button.ts`) — host-touching
 *     code that resolves `window` / DOM elements lazily, swallows all errors,
 *     and never throws (see `src/primitives/motion.ts` for the canonical
 *     defensive-adapter pattern).
 *
 * @module
 */

/**
 * Mutable per-action edge state. One instance per logical action, owned by a
 * device handler (keyboard / touch). Device events (`pressEdge` /
 * `releaseEdge`) mutate this buffer between ticks; the simulation drains it
 * once per tick via `pollEdge`.
 *
 * MUTABLE BY DESIGN: this is an event buffer — derived/cached data recomputed
 * from host input — NOT pure simulation state. The mutability is the whole
 * point: device events arrive at arbitrary times and must be latched for
 * deterministic per-tick consumption. This is the same exception category as
 * the renderer-output buffers described in `docs/architecture.md` ("Renderer-
 * output buffer exception"): the buffer is never read by pure simulation logic
 * except through the `pollEdge()` drain interface. Authoritative simulation
 * state remains pure-clone per the pure-progression-ops discipline.
 */
export interface EdgeAccumulator {
  /** Whether the action is currently held down right now. Persists across polls. */
  held: boolean;
  /** Latched `true` on a press event; cleared (consumed) by `pollEdge()`. */
  pressedSincePoll: boolean;
  /** Latched `true` on a release event; cleared (consumed) by `pollEdge()`. */
  releasedSincePoll: boolean;
}

/**
 * A drained per-tick snapshot of one action. `held` is continuous; `pressed`
 * and `released` are single-tick edges (true for exactly one poll after the
 * event, then cleared).
 */
export interface PolledEdge {
  held: boolean;
  pressed: boolean;
  released: boolean;
}

/**
 * Keyboard adapter — maps `KeyboardEvent.code` values to logical actions and
 * manages one {@link EdgeAccumulator} per action. Call `poll()` exactly once
 * per fixed tick; call `dispose()` to tear down all listeners.
 */
export interface KeyboardAdapter {
  /**
   * Drain all accumulators, returning a per-action edge snapshot. Call exactly
   * once per tick. Every mapped action appears in the record each tick (idle
   * actions report `{held:false, pressed:false, released:false}`).
   */
  poll(): Record<string, PolledEdge>;
  /** Remove all window listeners and release resources. Idempotent. */
  dispose(): void;
}

/** Configuration for {@link createKeyboardAdapter}. */
export interface KeyboardConfig {
  /**
   * Maps `KeyboardEvent.code` values to action names. Multiple codes can map
   * to the same action (e.g. `ArrowLeft` + `KeyA` → `'left'` → one shared
   * accumulator).
   *
   * See: https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_code_values
   *
   * @example
   * ```ts
   * { 'ArrowLeft': 'left', 'ArrowRight': 'right', 'Space': 'jump' }
   * ```
   */
  codeToAction: Record<string, string>;
}

/**
 * Touch-button adapter — tracks pointer events on a single DOM element and
 * latches them into one {@link EdgeAccumulator}. Call `poll()` exactly once
 * per fixed tick; call `dispose()` to tear down listeners.
 */
export interface TouchButtonAdapter {
  /** Drain the accumulator, returning the edge snapshot. Call exactly once per tick. */
  poll(): PolledEdge;
  /** Remove all element listeners and release resources. Idempotent. */
  dispose(): void;
}
