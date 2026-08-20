/**
 * Pure merge helpers for polled input edges.
 *
 * Extracted from the per-tick merge step so it can be unit-tested under Node
 * with no DOM. The merge rule: held is OR'd across sources (either device
 * holding = held); pressed / released edges are OR'd (either device producing
 * the edge = the edge fires this tick).
 *
 * @module
 */

import type { AxisBinding, GamepadConfig, KeyboardConfig, PolledEdge } from './types';

/**
 * Pure OR-merge of two polled edge snapshots for the SAME action (e.g.
 * keyboard + touch for `'jump'`). `held` is OR'd; `pressed` / `released`
 * edges are OR'd.
 *
 * Pure: never mutates either input; returns a fresh object each call.
 *
 * @param a - One source snapshot (e.g. keyboard).
 * @param b - Other source snapshot (e.g. touch).
 * @returns A new {@link PolledEdge} combining both sources via OR.
 *
 * @example
 * ```ts
 * const jump = orEdges(keyboardPoll['jump'], touchJumpPoll);
 * if (jump.pressed) bufferJump();
 * ```
 */
export function orEdges(a: PolledEdge, b: PolledEdge): PolledEdge {
  return {
    held: a.held || b.held,
    pressed: a.pressed || b.pressed,
    released: a.released || b.released,
  };
}

/** The all-false edge every merge of zero sources resolves to. */
const NO_EDGES: PolledEdge = Object.freeze({ held: false, pressed: false, released: false });

/**
 * Variadic OR-merge of any number of polled edges for the SAME action — the
 * keyboard + gamepad + touch cascade every multi-device build hand-rolls.
 * Zero sources (a disconnected gamepad, an unmapped touch set) resolve to the
 * idle edge; a single source returns its values unchanged.
 *
 * Pure: never mutates any input; returns a fresh object (or the frozen idle
 * singleton for zero sources).
 *
 * @param edges - Edge snapshots from each device, all for the same action.
 * @returns A new {@link PolledEdge} OR-combining every source.
 *
 * @example
 * ```ts
 * const jump = mergeEdges(keyboard['jump'], gamepad['jump'], touchJump);
 * ```
 */
export function mergeEdges(...edges: readonly PolledEdge[]): PolledEdge {
  if (edges.length === 0) return NO_EDGES;
  let held = false;
  let pressed = false;
  let released = false;
  for (const edge of edges) {
    held = held || edge.held;
    pressed = pressed || edge.pressed;
    released = released || edge.released;
  }
  return { held, pressed, released };
}

/**
 * Merge per-action edge RECORDS from multiple devices — the shape every
 * adapter's `poll()` returns — into one record covering the UNION of their
 * actions. An action mapped by only one device merges against idle for the
 * rest; an action mapped by none of them is absent (read with `?? IDLE_EDGE`).
 *
 * Pure: never mutates any input record; the result's action set is the union
 * in first-appearance order (first record's actions first, then unseen ones
 * from later records).
 *
 * @param maps - One `Record<action, PolledEdge>` per device (`keyboard.poll()`,
 *   `gamepad.poll()`, …). Zero maps yields `{}`.
 * @returns A fresh merged record.
 *
 * @example
 * ```ts
 * const edges = mergePolledEdgeMaps(keyboard.poll(), gamepad.poll());
 * const input: PlatformerInput = {
 *   moveX: (edges['right']?.held ? 1 : 0) - (edges['left']?.held ? 1 : 0),
 *   moveY: (edges['down']?.held ? 1 : 0) - (edges['up']?.held ? 1 : 0),
 *   jump: edges['jump'] ?? IDLE_EDGE,
 *   dash: edges['dash'] ?? IDLE_EDGE,
 *   grab: edges['grab'] ?? IDLE_EDGE,
 * };
 * ```
 */
export function mergePolledEdgeMaps(
  ...maps: readonly Record<string, PolledEdge>[]
): Record<string, PolledEdge> {
  const out: Record<string, PolledEdge> = {};
  for (const map of maps) {
    for (const action of Object.keys(map)) {
      const edge = map[action];
      out[action] = action in out ? orEdges(out[action], edge) : edge;
    }
  }
  return out;
}

/**
 * Extend a (possibly deeply frozen) keyboard map with additional
 * `code → action` entries, returning a NEW frozen map — the standard maps
 * ship frozen, so a build adding one key (e.g. `Escape → 'pause'`) cannot
 * mutate them and used to hand-roll a shallow copy. Later additions win on
 * key collision; the base map is never mutated.
 *
 * @example
 * ```ts
 * const map = extendKeyboardMap(STANDARD_KEYBOARD_PLATFORMER_MAP, {
 *   codeToAction: { Escape: 'pause' },
 * });
 * ```
 */
export function extendKeyboardMap(
  base: Readonly<KeyboardConfig>,
  additions: Readonly<KeyboardConfig>,
): Readonly<KeyboardConfig> {
  return Object.freeze({
    codeToAction: Object.freeze({ ...base.codeToAction, ...additions.codeToAction }),
  });
}

/**
 * Extend a (possibly deeply frozen) gamepad map — the same contract as
 * {@link extendKeyboardMap} for `GamepadConfig`: button and axis tables are
 * merged with the additions winning on collision, `deadzone` (if authored on
 * the additions) overrides the base, and the result is a new frozen map. The
 * base is never mutated.
 *
 * @example
 * ```ts
 * // Start (W3C index 9) opens the pause menu on top of the standard map.
 * const map = extendGamepadMap(STANDARD_GAMEPAD_PLATFORMER_MAP, {
 *   buttonToAction: { '9': 'pause' },
 * });
 * ```
 */
export function extendGamepadMap(
  base: Readonly<GamepadConfig>,
  additions: Readonly<GamepadConfig>,
): Readonly<GamepadConfig> {
  const out: {
    buttonToAction: Readonly<Record<string, string>>;
    axisToAction?: Readonly<Record<string, AxisBinding>>;
    deadzone?: number;
  } = {
    buttonToAction: Object.freeze({ ...base.buttonToAction, ...additions.buttonToAction }),
  };
  const axis = { ...base.axisToAction, ...additions.axisToAction };
  if (Object.keys(axis).length > 0) out.axisToAction = Object.freeze(axis);
  if (additions.deadzone !== undefined) out.deadzone = additions.deadzone;
  else if (base.deadzone !== undefined) out.deadzone = base.deadzone;
  return Object.freeze(out);
}
