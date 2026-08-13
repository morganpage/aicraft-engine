import { describe, it, expect } from 'vitest';
import { createKeyboardAdapter } from '../input/keyboard';
import { createGamepadAdapter } from '../input/gamepad';
import type { GamepadConfig, KeyboardConfig, PolledEdge } from '../input/types';
import {
  IDLE_EDGE,
  STANDARD_KEYBOARD_PLATFORMER_MAP,
  STANDARD_GAMEPAD_PLATFORMER_MAP,
} from '../platformer/input-edges';

describe('IDLE_EDGE', () => {
  it('is a frozen singleton of all-false fields', () => {
    expect(Object.isFrozen(IDLE_EDGE)).toBe(true);
    expect(IDLE_EDGE.held).toBe(false);
    expect(IDLE_EDGE.pressed).toBe(false);
    expect(IDLE_EDGE.released).toBe(false);
  });

  it('satisfies the PolledEdge (edge) shape at compile time', () => {
    // Compile-time check: IDLE_EDGE is assignable to PolledEdge. This line
    // fails to typecheck if the export drifts from the edge shape.
    const edge: PolledEdge = IDLE_EDGE;
    expect(edge).toEqual({ held: false, pressed: false, released: false });
  });
});

describe('STANDARD_KEYBOARD_PLATFORMER_MAP', () => {
  const { codeToAction } = STANDARD_KEYBOARD_PLATFORMER_MAP;

  it('is frozen (outer object and inner codeToAction)', () => {
    expect(Object.isFrozen(STANDARD_KEYBOARD_PLATFORMER_MAP)).toBe(true);
    expect(Object.isFrozen(codeToAction)).toBe(true);
  });

  it('maps Space → jump', () => {
    expect(codeToAction['Space']).toBe('jump');
  });

  it('maps both shifts → dash', () => {
    expect(codeToAction['ShiftLeft']).toBe('dash');
    expect(codeToAction['ShiftRight']).toBe('dash');
  });

  it('maps KeyK → grab and KeyR → reset', () => {
    expect(codeToAction['KeyK']).toBe('grab');
    expect(codeToAction['KeyR']).toBe('reset');
  });

  it('maps Arrow keys + WASD to the four move directions', () => {
    // Arrows.
    expect(codeToAction['ArrowUp']).toBe('up');
    expect(codeToAction['ArrowDown']).toBe('down');
    expect(codeToAction['ArrowLeft']).toBe('left');
    expect(codeToAction['ArrowRight']).toBe('right');
    // WASD.
    expect(codeToAction['KeyW']).toBe('up');
    expect(codeToAction['KeyS']).toBe('down');
    expect(codeToAction['KeyA']).toBe('left');
    expect(codeToAction['KeyD']).toBe('right');
  });

  it('has the exact { codeToAction } shape createKeyboardAdapter accepts and is passable straight in', () => {
    // Compile-time: the map is assignable to KeyboardConfig.
    const kb: KeyboardConfig = STANDARD_KEYBOARD_PLATFORMER_MAP;
    expect(kb.codeToAction).toBe(codeToAction);
    // Runtime: the adapter factory accepts the config without throwing. In Node
    // (no `window`) the keyboard adapter is a no-op whose poll() returns `{}`;
    // this still proves the config object is well-formed and accepted.
    const adapter = createKeyboardAdapter(kb);
    expect(adapter.poll()).toEqual({});
    adapter.dispose();
  });
});

describe('STANDARD_GAMEPAD_PLATFORMER_MAP', () => {
  const { buttonToAction, axisToAction } = STANDARD_GAMEPAD_PLATFORMER_MAP;

  it('is frozen (outer object, buttonToAction, and axisToAction)', () => {
    expect(Object.isFrozen(STANDARD_GAMEPAD_PLATFORMER_MAP)).toBe(true);
    expect(Object.isFrozen(buttonToAction)).toBe(true);
    expect(axisToAction).toBeDefined();
    expect(Object.isFrozen(axisToAction!)).toBe(true);
  });

  it('keys buttonToAction by NUMERIC INDEX strings (never b0 / dpleft)', () => {
    const keys = Object.keys(buttonToAction);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k).not.toMatch(/^b\d/);
      expect(k).not.toMatch(/^dp/);
      // Every key is a stringified non-negative integer ("0", "12", …).
      expect(k).toMatch(/^\d+$/);
    }
  });

  it("maps '0' (A) → jump and '1' (B) → dash", () => {
    expect(buttonToAction['0']).toBe('jump');
    expect(buttonToAction['1']).toBe('dash');
  });

  it("maps '2' (X) → grab", () => {
    expect(buttonToAction['2']).toBe('grab');
  });

  it('maps D-pad indices to the four move directions', () => {
    expect(buttonToAction['12']).toBe('up');
    expect(buttonToAction['13']).toBe('down');
    expect(buttonToAction['14']).toBe('left');
    expect(buttonToAction['15']).toBe('right');
  });

  it('binds the left-stick axes to left/right and down/up', () => {
    expect(axisToAction?.['0']).toEqual({ positive: 'right', negative: 'left' });
    expect(axisToAction?.['1']).toEqual({ positive: 'down', negative: 'up' });
  });

  it('has the exact { buttonToAction, axisToAction } shape createGamepadAdapter accepts and is passable straight in', () => {
    // Compile-time: the map is assignable to GamepadConfig.
    const gp: GamepadConfig = STANDARD_GAMEPAD_PLATFORMER_MAP;
    expect(gp.buttonToAction).toBe(buttonToAction);
    // Runtime: the adapter factory accepts the config without throwing. In Node
    // (no navigator.getGamepads) the gamepad adapter is a no-op whose poll()
    // returns `{}`; this still proves the config object is well-formed.
    const adapter = createGamepadAdapter(gp);
    expect(adapter.poll()).toEqual({});
    adapter.dispose();
  });
});
