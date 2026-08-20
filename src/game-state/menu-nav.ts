/**
 * Menu navigation — the selection state machine every game menu (start menu,
 * pause menu, options list) hand-rolls: a highlighted index that wraps, a
 * confirm edge, an open grace window so the key that OPENED the menu cannot
 * also confirm inside it, and same-frame nav+confirm resolution (a press and
 * a nav edge on the same tick confirms the DESTINATION, matching player
 * intent).
 *
 * The module is deliberately presentation-free: it consumes polled edges
 * (keyboard / gamepad / touch merged however the consumer likes —
 * `mergePolledEdgeMaps` + a directional axis) and reports intent. Rendering,
 * muting, FSM dispatch, and what "confirm" MEANS stay with the game. Pausing
 * is not baked in either — a pause menu is `menu-nav` + the `paused` state of
 * the game-state FSM driven by its outputs.
 *
 * Determinism: pure — `advanceMenuNav` returns a fresh state, never mutates.
 * No `Math.random` / `Date.now`, never throws.
 *
 * @module
 */

import type { PolledEdge } from '../input/types';

/**
 * The menu navigation state. `openGrace` counts DOWN in ticks: while it is
 * above zero, confirm edges are swallowed (the opener's held key cannot
 * double as the first confirm).
 */
export interface MenuNavState {
  /** Highlighted entry index into the visible (non-hidden) entry list. */
  readonly index: number;
  /** Ticks of confirm immunity remaining (set from options at open). */
  readonly openGrace: number;
}

/** Options for {@link createMenuNav}. */
export interface MenuNavOptions {
  /**
   * Confirm-immunity window in ticks applied on creation and on every
   * {@link openMenuNav}. Default 8 (~133 ms at 60 Hz) — long enough that a
   * deliberate keypress cannot land inside it by accident, short enough that
   * no player notices it.
   */
  readonly openGraceTicks?: number;
}

/** The edges one menu tick consumes. Pass merged device edges. */
export interface MenuNavInput {
  /** Navigate to the previous entry (up / previous). */
  readonly up: PolledEdge;
  /** Navigate to the next entry (down / next). */
  readonly down: PolledEdge;
  /** Confirm the highlighted entry. */
  readonly confirm: PolledEdge;
}

/** The empty input (all-idle edges) — pass to idle the menu a tick. */
export const IDLE_MENU_INPUT: Readonly<MenuNavInput> = Object.freeze({
  up: { held: false, pressed: false, released: false },
  down: { held: false, pressed: false, released: false },
  confirm: { held: false, pressed: false, released: false },
});

/** What {@link advanceMenuNav} decided this tick. */
export interface MenuNavResult {
  /** The next state (index possibly moved, grace ticked down). */
  readonly state: MenuNavState;
  /** The entry confirmed this tick, if any. */
  readonly confirmed: boolean;
  /** The selection MOVED this tick (up or down). */
  readonly moved: boolean;
  /** The direction of the move, when `moved`. */
  readonly direction: -1 | 0 | 1;
}

/** Create a menu parked on entry 0 with the open-grace window armed. */
export function createMenuNav(options: Readonly<MenuNavOptions> = {}): MenuNavState {
  return { index: 0, openGrace: options.openGraceTicks ?? 8 };
}

/** Re-arm the grace window (call when a menu (re)opens). */
export function openMenuNav(
  state: MenuNavState,
  options: Readonly<MenuNavOptions> = {},
): MenuNavState {
  return { ...state, openGrace: options.openGraceTicks ?? 8 };
}

/**
 * Advance the menu one tick against `count` visible entries. Navigation wraps
 * (0 → count-1 → 0); `count <= 1` pins the index at 0. Confirm is swallowed
 * while the grace window is open; a same-frame nav + confirm resolves as the
 * nav FIRST (the player confirmed the entry they moved to, matching intent).
 * Pure.
 */
export function advanceMenuNav(
  state: MenuNavState,
  input: Readonly<MenuNavInput>,
  count: number,
): MenuNavResult {
  const grace = Math.max(0, state.openGrace - 1);
  if (count <= 0) {
    return { state: { index: 0, openGrace: grace }, confirmed: false, moved: false, direction: 0 };
  }

  // Nav first: a same-frame press+move confirms the DESTINATION entry.
  const up = input.up.pressed;
  const down = input.down.pressed;
  let index = state.index;
  let moved = false;
  let direction: -1 | 0 | 1 = 0;
  if (up !== down) {
    // Exactly one direction pressed this tick — simultaneous opposing
    // presses cancel (no coin-flip, no priority).
    direction = up ? -1 : 1;
    index = (index + direction + count) % count;
    moved = true;
  }

  const openState: MenuNavState = { index, openGrace: grace };
  if (input.confirm.pressed && grace === 0) {
    return { state: openState, confirmed: true, moved, direction };
  }
  return { state: openState, confirmed: false, moved, direction };
}

/**
 * Clamp a selection into a (possibly changed) visible-entry count — call
 * after entries are hidden/revealed (RESUME GAME appearing, a submenu
 * shrinking) so the highlight cannot point past the end.
 */
export function clampMenuNavIndex(state: MenuNavState, count: number): MenuNavState {
  if (count <= 0) return { ...state, index: 0 };
  return state.index >= count ? { ...state, index: count - 1 } : state;
}
