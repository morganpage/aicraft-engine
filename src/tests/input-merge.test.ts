import { describe, it, expect } from 'vitest';
import {
  orEdges,
  mergeEdges,
  mergePolledEdgeMaps,
  extendKeyboardMap,
  extendGamepadMap,
} from '../input/merge';
import type { PolledEdge } from '../input/types';
import {
  STANDARD_GAMEPAD_PLATFORMER_MAP,
  STANDARD_KEYBOARD_PLATFORMER_MAP,
  IDLE_EDGE,
} from '../platformer/input-edges';

const ALL_FALSE: PolledEdge = { held: false, pressed: false, released: false };
const ALL_TRUE: PolledEdge = { held: true, pressed: true, released: true };

describe('orEdges — held', () => {
  it('is true when either source is held', () => {
    expect(orEdges(ALL_TRUE, ALL_FALSE).held).toBe(true);
    expect(orEdges(ALL_FALSE, ALL_TRUE).held).toBe(true);
  });

  it('is true when both sources are held', () => {
    expect(orEdges(ALL_TRUE, ALL_TRUE).held).toBe(true);
  });

  it('is false when neither source is held', () => {
    expect(orEdges(ALL_FALSE, ALL_FALSE).held).toBe(false);
  });
});

describe('orEdges — pressed edge', () => {
  it('fires if either source produced it', () => {
    expect(orEdges({ ...ALL_FALSE, pressed: true }, ALL_FALSE).pressed).toBe(true);
    expect(orEdges(ALL_FALSE, { ...ALL_FALSE, pressed: true }).pressed).toBe(true);
    expect(orEdges(ALL_FALSE, ALL_FALSE).pressed).toBe(false);
  });
});

describe('orEdges — released edge', () => {
  it('fires if either source produced it', () => {
    expect(orEdges({ ...ALL_FALSE, released: true }, ALL_FALSE).released).toBe(true);
    expect(orEdges(ALL_FALSE, { ...ALL_FALSE, released: true }).released).toBe(true);
    expect(orEdges(ALL_FALSE, ALL_FALSE).released).toBe(false);
  });
});

describe('orEdges — purity', () => {
  it('does not mutate either input', () => {
    const a: PolledEdge = { held: true, pressed: true, released: false };
    const b: PolledEdge = { held: false, pressed: false, released: true };
    const aSnap = { ...a };
    const bSnap = { ...b };
    orEdges(a, b);
    expect(a).toEqual(aSnap);
    expect(b).toEqual(bSnap);
  });

  it('returns a fresh object each call', () => {
    const out1 = orEdges(ALL_FALSE, ALL_FALSE);
    const out2 = orEdges(ALL_FALSE, ALL_FALSE);
    expect(out1).not.toBe(out2);
    expect(out1).toEqual(out2);
  });
});

// ---------------------------------------------------------------------------
// 0.20.0 — the multi-device merge layer (mergeEdges / mergePolledEdgeMaps)
// and the frozen-map extenders (extendKeyboardMap / extendGamepadMap).
// ---------------------------------------------------------------------------

const edge = (held: boolean, pressed = false, released = false): PolledEdge => ({ held, pressed, released });

describe('mergeEdges — the variadic multi-device cascade (0.20.0)', () => {
  it('ORs every source exactly like chained orEdges', () => {
    expect(mergeEdges(edge(true, false, true), edge(false, true, false))).toEqual({
      held: true,
      pressed: true,
      released: true,
    });
    expect(mergeEdges(edge(true), edge(false), edge(false, true))).toEqual(orEdges(orEdges(edge(true), edge(false)), edge(false, true)));
  });

  it('zero sources resolve to the idle edge (a disconnected device is free)', () => {
    expect(mergeEdges()).toEqual({ held: false, pressed: false, released: false });
  });

  it('one source passes its values through', () => {
    expect(mergeEdges(edge(true))).toEqual({ held: true, pressed: false, released: false });
  });

  it('never mutates its inputs', () => {
    const a = edge(true);
    const b = edge(false, true);
    mergeEdges(a, b);
    expect(a).toEqual({ held: true, pressed: false, released: false });
    expect(b).toEqual({ held: false, pressed: true, released: false });
  });
});

describe('mergePolledEdgeMaps — merging poll() records', () => {
  it('merges the union of actions, OR-ing shared ones', () => {
    const keyboard = { left: edge(true), jump: edge(false, true) };
    const gamepad = { jump: edge(true), dash: edge(true, true) };
    const merged = mergePolledEdgeMaps(keyboard, gamepad);
    expect(Object.keys(merged)).toEqual(['left', 'jump', 'dash']);
    expect(merged.jump).toEqual({ held: true, pressed: true, released: false });
    expect(merged.left).toEqual({ held: true, pressed: false, released: false });
    expect(merged.dash).toEqual({ held: true, pressed: true, released: false });
  });

  it('an action mapped by one device merges against idle for the rest', () => {
    const merged = mergePolledEdgeMaps({ pause: edge(false, true) }, {});
    expect(merged.pause).toEqual({ held: false, pressed: true, released: false });
  });

  it('zero maps yields an empty record; the result is always fresh', () => {
    expect(mergePolledEdgeMaps()).toEqual({});
    const a = { jump: edge(true) };
    const merged = mergePolledEdgeMaps(a);
    expect(merged).not.toBe(a);
    expect(merged.jump).toBe(a.jump);
  });

  it('round-trips the documented PlatformerInput recipe', () => {
    const merged = mergePolledEdgeMaps(
      { left: edge(true), right: edge(false), down: edge(false), up: edge(false) },
      { jump: edge(false, true) },
    );
    const moveX = (merged['right']?.held ? 1 : 0) - (merged['left']?.held ? 1 : 0);
    expect(moveX).toBe(-1);
    expect(merged['jump'] ?? IDLE_EDGE).toEqual({ held: false, pressed: true, released: false });
    expect(merged['grab'] ?? IDLE_EDGE).toEqual(IDLE_EDGE);
  });
});

describe('extendKeyboardMap / extendGamepadMap — frozen-map extension (0.20.0)', () => {
  it('adds entries without mutating the frozen standard map', () => {
    expect(Object.isFrozen(STANDARD_KEYBOARD_PLATFORMER_MAP)).toBe(true);
    const before = JSON.stringify(STANDARD_KEYBOARD_PLATFORMER_MAP);
    const map = extendKeyboardMap(STANDARD_KEYBOARD_PLATFORMER_MAP, {
      codeToAction: { Escape: 'pause' },
    });
    expect(map.codeToAction).toMatchObject({ Escape: 'pause', Space: 'jump' });
    expect(JSON.stringify(STANDARD_KEYBOARD_PLATFORMER_MAP)).toBe(before);
    expect(map).not.toBe(STANDARD_KEYBOARD_PLATFORMER_MAP);
    // The result is frozen too — extension is not a hole for later mutation.
    expect(Object.isFrozen(map)).toBe(true);
    expect(Object.isFrozen(map.codeToAction)).toBe(true);
  });

  it('additions win on key collision; the base survives otherwise', () => {
    const map = extendKeyboardMap(
      { codeToAction: { KeyC: 'jump', KeyX: 'dash' } },
      { codeToAction: { KeyC: 'confirm' } },
    );
    expect(map.codeToAction).toEqual({ KeyC: 'confirm', KeyX: 'dash' });
  });

  it('gamepad: Start (W3C index 9) rides on top of the standard map', () => {
    const map = extendGamepadMap(STANDARD_GAMEPAD_PLATFORMER_MAP, {
      buttonToAction: { '9': 'pause' },
    });
    expect(map.buttonToAction).toMatchObject({ '9': 'pause', '0': 'jump', '12': 'up' });
    expect(map.axisToAction).toEqual(STANDARD_GAMEPAD_PLATFORMER_MAP.axisToAction);
    // The base's frozen table is not aliased into the new map.
    expect(map.buttonToAction).not.toBe(STANDARD_GAMEPAD_PLATFORMER_MAP.buttonToAction);
  });

  it('gamepad: deadzone override wins, base deadzone survives otherwise', () => {
    const base = { buttonToAction: { '0': 'jump' }, deadzone: 0.25 };
    expect(extendGamepadMap(base, { buttonToAction: {} }).deadzone).toBe(0.25);
    expect(extendGamepadMap(base, { buttonToAction: {}, deadzone: 0.4 }).deadzone).toBe(0.4);
  });
});
