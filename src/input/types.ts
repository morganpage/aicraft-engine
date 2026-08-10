/**
 * Type definitions for the input module.
 *
 * The module splits input handling into two layers:
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

/** Configuration for {@link createTouchButtonSet}. */
export interface TouchButtonSetConfig {
  /**
   * DOM elements for each button in the set, in positional order. `null`
   * entries produce idle {@link PolledEdge} slots (SSR, element not yet
   * mounted, query failed) but keep array alignment intact so consumers can
   * destructure positionally: `const [left, right] = set.poll()`.
   */
  readonly elements: readonly (HTMLElement | null)[];
}

/**
 * Multi-touch-safe button-set adapter — manages one {@link EdgeAccumulator}
 * per input element and tracks `pointerId`s per slot so two fingers on the
 * SAME button do not double-fire presses or spurious releases (the
 * load-bearing multi-touch invariant). Adds a global `document` safety net
 * (`pointerup` / `pointercancel` / `pointerleave`) so a pointer that exits
 * the viewport without a clean per-element `pointerup` cannot leave a button
 * stuck. Call `poll()` exactly once per fixed tick; call `dispose()` to tear
 * down all listeners.
 */
export interface TouchButtonSetAdapter {
  /**
   * Drain all accumulators, returning a per-element edge snapshot array
   * aligned with the input `elements` order. Call exactly once per tick.
   * Null-element slots report idle `{held:false, pressed:false, released:false}`.
   */
  poll(): PolledEdge[];
  /** Remove all per-element and document-level listeners. Idempotent. */
  dispose(): void;
}

/**
 * Bidirectional axis binding for {@link GamepadConfig.axisToAction}: maps
 * positive / negative deflection of a single analog axis to action names.
 * Either direction can be omitted (e.g. a camera-pan axis that only cares
 * about rightward deflection). When BOTH are omitted the entry is silently
 * skipped — no error, no warning.
 */
export interface AxisBinding {
  /** Action name for positive axis deflection (e.g. `'right'`). Omit to ignore. */
  readonly positive?: string;
  /** Action name for negative axis deflection (e.g. `'left'`). Omit to ignore. */
  readonly negative?: string;
}

/**
 * Configuration for {@link createGamepadAdapter}.
 *
 * Maps W3C Standard Gamepad button indices (0-16) and axis indices (0-3) to
 * logical action names. Multiple buttons can map to the same action (e.g.
 * D-pad right + left-stick positive-X → `'right'` → one shared accumulator).
 *
 * v1 ships single-pad (`getGamepads()[0]`), `mapping === 'standard'` only,
 * axial per-axis threshold deadzone. See {@link GamepadAdapter} for the
 * lifecycle contract.
 */
export interface GamepadConfig {
  /**
   * Maps Standard Gamepad button indices to action names. Keys are stringified
   * numbers (matches the `Record<string, string>` shape of
   * {@link KeyboardConfig.codeToAction}).
   *
   * W3C Standard layout: 0-3 = face cluster (A/B/X/Y), 4-5 = shoulders
   * (LB/RB), 6-7 = triggers (L2/R2), 8-9 = center (Back/Start),
   * 10-11 = stick clicks (LS/RS), 12-15 = D-pad (up/down/left/right),
   * 16 = guide.
   *
   * @example
   * ```ts
   * { '0': 'jump', '12': 'up', '13': 'down', '14': 'left', '15': 'right' }
   * ```
   */
  readonly buttonToAction: Readonly<Record<string, string>>;

  /**
   * Maps Standard Gamepad axis indices to directional action pairs. The axis
   * value is compared against {@link GamepadConfig.deadzone}; when magnitude
   * ≥ deadzone the corresponding direction's accumulator is pressed.
   *
   * Axes 0-1 = left stick (X, Y); axes 2-3 = right stick (X, Y).
   *
   * @example
   * ```ts
   * { '0': { positive: 'right', negative: 'left' }, '1': { positive: 'down', negative: 'up' } }
   * ```
   */
  readonly axisToAction?: Readonly<Record<string, AxisBinding>>;

  /**
   * Analog stick deadzone magnitude. Values with `Math.abs(raw) < deadzone`
   * are treated as idle (no edge fired). Applied **per-axis independently**
   * (axial per-axis threshold) — each axis is compared against the deadzone
   * on its own, NOT as a 2D stick magnitude. Defaults to
   * {@link DEFAULT_GAMEPAD_DEADZONE} (`0.25`).
   */
  readonly deadzone?: number;
}

/**
 * Gamepad adapter — polls `navigator.getGamepads()` once per tick and maps the
 * W3C Standard Gamepad layout to logical actions via one
 * {@link EdgeAccumulator} per action. OR-merges with keyboard/touch via the
 * existing `orEdges` helper.
 *
 * Single-player v1: binds to the first connected pad (`getGamepads()[0]`).
 * Multi-player v2: consumer creates a second adapter instance.
 *
 * Returns `{}` from `poll()` when no standard-mapping gamepad is connected,
 * or in Node / SSR. Never throws.
 */
export interface GamepadAdapter {
  /**
   * Drain all accumulators, returning a per-action edge snapshot. Call exactly
   * once per tick. Every mapped action appears in the record each tick (idle
   * actions report `{held:false, pressed:false, released:false}`). Returns
   * `{}` when no standard-mapping gamepad is connected, or in Node / SSR.
   */
  poll(): Record<string, PolledEdge>;
  /** Remove all window listeners and release resources. Idempotent. */
  dispose(): void;
}
