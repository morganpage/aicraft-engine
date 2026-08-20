import { describe, expect, it } from 'vitest';
import type { PolledEdge } from '../input/types';
import {
  advanceMenuNav,
  clampMenuNavIndex,
  createMenuNav,
  IDLE_MENU_INPUT,
  openMenuNav,
  type MenuNavInput,
} from '../game-state/menu-nav';

/**
 * Menu navigation (0.20.0) — the selection state machine the start menu and
 * the pause menu of a Celeste-like both need: wrapped index, confirm edge,
 * open grace window, same-frame nav+confirm resolution.
 */

const edge = (pressed: boolean): PolledEdge => ({ held: pressed, pressed, released: false });
const input = (over: Partial<MenuNavInput>): MenuNavInput => ({
  up: over.up ?? IDLE_MENU_INPUT.up,
  down: over.down ?? IDLE_MENU_INPUT.down,
  confirm: over.confirm ?? IDLE_MENU_INPUT.confirm,
});

describe('createMenuNav / openMenuNav', () => {
  it('starts on entry 0 with the grace window armed', () => {
    expect(createMenuNav()).toEqual({ index: 0, openGrace: 8 });
    expect(createMenuNav({ openGraceTicks: 0 })).toEqual({ index: 0, openGrace: 0 });
  });

  it('openMenuNav re-arms the grace window without moving the selection', () => {
    let state = createMenuNav();
    state = advanceMenuNav(state, input({ down: edge(true) }), 3).state;
    expect(state.index).toBe(1);
    const reopened = openMenuNav(state);
    expect(reopened).toEqual({ index: 1, openGrace: 8 });
  });
});

describe('advanceMenuNav — navigation', () => {
  it('down wraps and up wraps (0 → last → 0)', () => {
    let state = createMenuNav({ openGraceTicks: 0 });
    state = advanceMenuNav(state, input({ up: edge(true) }), 3).state;
    expect(state.index).toBe(2);
    state = advanceMenuNav(state, input({ down: edge(true) }), 3).state;
    expect(state.index).toBe(0);
    state = advanceMenuNav(state, input({ down: edge(true) }), 3).state;
    expect(state.index).toBe(1);
  });

  it('held edges navigate once per press, not per held tick', () => {
    let state = createMenuNav({ openGraceTicks: 0 });
    // held=true but pressed only on the first tick.
    state = advanceMenuNav(state, input({ down: edge(true) }), 2).state;
    state = advanceMenuNav(state, input({ down: { held: true, pressed: false, released: false } }), 2).state;
    expect(state.index).toBe(1);
  });

  it('simultaneous opposing presses cancel', () => {
    const state = createMenuNav({ openGraceTicks: 0 });
    const out = advanceMenuNav(state, input({ up: edge(true), down: edge(true) }), 3);
    expect(out.state.index).toBe(0);
    expect(out.moved).toBe(false);
  });

  it('count <= 1 pins the index; count 0 reports nothing', () => {
    let state = createMenuNav({ openGraceTicks: 0 });
    state = advanceMenuNav(state, input({ down: edge(true) }), 1).state;
    expect(state.index).toBe(0);
    const none = advanceMenuNav(state, input({ confirm: edge(true) }), 0);
    expect(none.confirmed).toBe(false);
  });
});

describe('advanceMenuNav — confirm + grace', () => {
  it('swallows confirm inside the grace window', () => {
    let state = createMenuNav({ openGraceTicks: 3 });
    for (let i = 0; i < 2; i++) {
      const out = advanceMenuNav(state, input({ confirm: edge(true) }), 2);
      expect(out.confirmed).toBe(false);
      state = out.state;
    }
    // Third tick: grace has ticked to zero — confirm lands.
    const out = advanceMenuNav(state, input({ confirm: edge(true) }), 2);
    expect(out.confirmed).toBe(true);
  });

  it('a same-frame nav + confirm resolves as the DESTINATION entry', () => {
    const state = createMenuNav({ openGraceTicks: 0 });
    const out = advanceMenuNav(state, input({ down: edge(true), confirm: edge(true) }), 3);
    expect(out.state.index).toBe(1);
    expect(out.moved).toBe(true);
    expect(out.direction).toBe(1);
    expect(out.confirmed).toBe(true);
  });

  it('reports the move direction for reads (marker bounce, SFX)', () => {
    const state = createMenuNav({ openGraceTicks: 0 });
    expect(advanceMenuNav(state, input({ up: edge(true) }), 3).direction).toBe(-1);
    expect(advanceMenuNav(state, IDLE_MENU_INPUT, 3).direction).toBe(0);
  });
});

describe('clampMenuNavIndex', () => {
  it('pulls the selection back when entries disappear', () => {
    const state = { index: 2, openGrace: 0 };
    expect(clampMenuNavIndex(state, 2)).toEqual({ index: 1, openGrace: 0 });
    expect(clampMenuNavIndex(state, 3)).toBe(state);
    expect(clampMenuNavIndex(state, 0)).toEqual({ index: 0, openGrace: 0 });
  });
});

describe('menu-nav — purity', () => {
  it('never mutates the input state', () => {
    const state = { index: 0, openGrace: 4 };
    const snap = { ...state };
    advanceMenuNav(state, input({ down: edge(true), confirm: edge(true) }), 3);
    expect(state).toEqual(snap);
  });
});
