/**
 * Standard platformer input edges + device-to-action mappings.
 *
 * Celerock hardening (Workstream D3): ships the singleton edge and the standard
 * keyboard / gamepad mappings that builders were hand-rolling (and mis-stating).
 *
 * Background — the bugs this module fixes:
 *   - The celerock brief referenced an `IDLE_EDGE` export that did NOT exist, so
 *     every builder hand-rolled `{ held:false, pressed:false, released:false }`.
 *     {@link IDLE_EDGE} replaces that drift-prone literal.
 *   - Two builders mis-specified gamepad input: the gamepad adapter's
 *     `buttonToAction` is keyed by NUMERIC INDEX STRINGS (`'0'`, `'12'`, …),
 *     NOT `'b0'` / `'dpleft'`. {@link STANDARD_GAMEPAD_PLATFORMER_MAP} uses the
 *     real keys.
 *
 * Every exported map matches the EXACT shape the defensive input adapters
 * (`createKeyboardAdapter`, `createGamepadAdapter`) accept, so it can be passed
 * straight in:
 *
 * ```ts
 * import { createKeyboardAdapter, createGamepadAdapter } from '../input';
 * import {
 *   STANDARD_KEYBOARD_PLATFORMER_MAP,
 *   STANDARD_GAMEPAD_PLATFORMER_MAP,
 * } from '../platformer/input-edges';
 *
 * const keyboard = createKeyboardAdapter(STANDARD_KEYBOARD_PLATFORMER_MAP);
 * const gamepad = createGamepadAdapter(STANDARD_GAMEPAD_PLATFORMER_MAP);
 * ```
 *
 * @module
 */

import type { GamepadConfig, KeyboardConfig, PolledEdge } from '../input/types';

/**
 * Recursively freeze `value` and its plain-object own properties (best-effort),
 * returning the same reference. The runtime freeze makes the export immutable;
 * the declared type is unchanged so the value stays directly assignable to the
 * adapter config types. The property walk goes through `unknown` (never `any`).
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    const record = value as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const child = record[key];
      if (child !== null && typeof child === 'object') {
        deepFreeze(child);
      }
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Mapped-but-not-pressed this tick. Prefer this over `null` (which DISABLES the
 * ability). Importing this avoids hand-rolling the literal and drifting from the
 * Edge shape.
 *
 * A deeply frozen singleton of the idle {@link PolledEdge}: every field is
 * `false`. The platformer kernel treats this as "the action is mapped but
 * quiescent this tick" — distinct from `null`, which means "unmapped / the
 * ability is disabled" (see `PlatformerInput.dash` / `grab`). Reuse this one
 * instance instead of allocating a fresh `{ held:false, … }` literal each tick.
 */
export const IDLE_EDGE: Readonly<PolledEdge> = Object.freeze({
  held: false,
  pressed: false,
  released: false,
});

/**
 * Standard keyboard layout for a Celeste-style platformer, in the exact
 * `{ codeToAction }` shape {@link createKeyboardAdapter} (in `src/input/keyboard.ts`)
 * consumes — pass it straight in.
 *
 * Movement (digital axes; the consumer derives `PlatformerInput.moveX` from
 * `left`/`right` and `moveY` from `up`/`down`):
 *   - Arrow keys + WASD → `left` / `right` / `up` / `down` (each direction's
 *     two codes share one accumulator).
 *
 * Abilities:
 *   - `Space` → `jump`
 *   - `ShiftLeft` + `ShiftRight` → `dash` (either shift dashes)
 *   - `KeyK` → `grab` (wall-grab / wall-climb)
 *   - `KeyR` → `reset` (respawn / restart)
 *
 * Deeply frozen.
 */
export const STANDARD_KEYBOARD_PLATFORMER_MAP: Readonly<KeyboardConfig> = deepFreeze<KeyboardConfig>({
  codeToAction: {
    // Movement — arrows.
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    // Movement — WASD.
    KeyW: 'up',
    KeyS: 'down',
    KeyA: 'left',
    KeyD: 'right',
    // Abilities.
    Space: 'jump',
    ShiftLeft: 'dash',
    ShiftRight: 'dash',
    KeyK: 'grab',
    KeyR: 'reset',
  },
});

/**
 * Standard W3C Standard Gamepad mapping for a Celeste-style platformer, in the
 * exact `{ buttonToAction, axisToAction }` shape {@link createGamepadAdapter}
 * (in `src/input/gamepad.ts`) consumes — pass it straight in.
 *
 * Buttons — KEYS ARE NUMERIC INDEX STRINGS (e.g. `'0'`, NOT `'b0'`; `'14'`, NOT
 * `'dpleft'`), matching the adapter's `buttonToAction: Record<string, string>`:
 *   - `'0'` (A) → `jump`
 *   - `'1'` (B) → `dash`
 *   - `'2'` (X) → `grab`
 *   - `'12'` / `'13'` / `'14'` / `'15'` (D-pad up/down/left/right) → `up` /
 *     `down` / `left` / `right`
 *
 * Left stick (axes `0` = X, `1` = Y) — bound via `axisToAction`:
 *   - axis `'0'`: positive → `right`, negative → `left`
 *   - axis `'1'`: positive → `down`,  negative → `up`
 *
 * The D-pad and the left stick feed the SAME shared `left` / `right` / `up` /
 * `down` accumulators (the adapter OR-coalesces multiple sources per action).
 * `deadzone` is intentionally omitted so the adapter falls back to its own
 * `DEFAULT_GAMEPAD_DEADZONE`.
 *
 * Deeply frozen.
 */
export const STANDARD_GAMEPAD_PLATFORMER_MAP: Readonly<GamepadConfig> = deepFreeze<GamepadConfig>({
  buttonToAction: {
    // Face cluster.
    '0': 'jump', // A
    '1': 'dash', // B
    '2': 'grab', // X
    // D-pad (digital movement).
    '12': 'up', // D-pad up
    '13': 'down', // D-pad down
    '14': 'left', // D-pad left
    '15': 'right', // D-pad right
  },
  axisToAction: {
    // Left stick.
    '0': { positive: 'right', negative: 'left' }, // X
    '1': { positive: 'down', negative: 'up' }, // Y
  },
});
