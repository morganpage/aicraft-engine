import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGamepadAdapter, DEFAULT_GAMEPAD_DEADZONE } from '../input/gamepad';
import type { GamepadAdapter, GamepadConfig } from '../input/types';
import { orEdges } from '../input/merge';

/**
 * Fake host shapes mirroring the W3C Gamepad API surface. We avoid the lib.dom
 * `Gamepad` type here because vitest runs under Node with no DOM and we want
 * to inject synthetic state without fighting the type system.
 */
interface FakeButton {
  pressed: boolean;
  value: number;
  touched: boolean;
}

interface FakeGamepad {
  id: string;
  index: number;
  mapping: string;
  timestamp: number;
  buttons: FakeButton[];
  axes: number[];
  connected: boolean;
}

interface FakeNavigator {
  getGamepads: () => (FakeGamepad | null)[];
}

const STANDARD_ID = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)';

function makeButton(pressed = false, value = pressed ? 1 : 0): FakeButton {
  return { pressed, value, touched: pressed };
}

/** Build a Standard-mapping gamepad with the given button/axis state. */
function makePad(opts: {
  buttons?: Partial<Record<number, boolean>>;
  axes?: number[];
  timestamp?: number;
  mapping?: string;
  id?: string;
  connected?: boolean;
}): FakeGamepad {
  const buttons: FakeButton[] = new Array(17);
  for (let i = 0; i < 17; i++) buttons[i] = makeButton(false, 0);
  if (opts.buttons) {
    for (const [idx, pressed] of Object.entries(opts.buttons)) {
      buttons[Number(idx)] = makeButton(pressed ?? false, pressed ? 1 : 0);
    }
  }
  return {
    id: opts.id ?? STANDARD_ID,
    index: 0,
    mapping: opts.mapping ?? 'standard',
    timestamp: opts.timestamp ?? 1,
    buttons,
    axes: opts.axes ?? [0, 0, 0, 0],
    connected: opts.connected ?? true,
  };
}

const FULL_CONFIG: GamepadConfig = {
  buttonToAction: {
    '0': 'jump',
    '12': 'up',
    '13': 'down',
    '14': 'left',
    '15': 'right',
  },
  axisToAction: {
    '0': { positive: 'right', negative: 'left' },
    '1': { positive: 'down', negative: 'up' },
  },
  deadzone: 0.25,
};

describe('createGamepadAdapter — constants', () => {
  it('exports DEFAULT_GAMEPAD_DEADZONE = 0.25', () => {
    expect(DEFAULT_GAMEPAD_DEADZONE).toBe(0.25);
  });
});

describe('createGamepadAdapter — SSR / no host', () => {
  let original: typeof globalThis.navigator;
  beforeEach(() => {
    original = globalThis.navigator;
  });
  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it('returns {} poll when navigator is undefined', () => {
    // @ts-expect-error — deleting navigator to simulate SSR
    delete globalThis.navigator;
    const adapter = createGamepadAdapter(FULL_CONFIG);
    expect(adapter.poll()).toEqual({});
    expect(() => adapter.dispose()).not.toThrow();
  });

  it('returns {} poll when navigator.getGamepads is not a function', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    });
    const adapter = createGamepadAdapter(FULL_CONFIG);
    expect(adapter.poll()).toEqual({});
  });
});

describe('createGamepadAdapter — defensive poll', () => {
  let original: typeof globalThis.navigator;
  beforeEach(() => {
    original = globalThis.navigator;
  });
  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it('returns {} when no gamepad is connected (empty array)', () => {
    const fakeNav: FakeNavigator = { getGamepads: () => [] };
    Object.defineProperty(globalThis, 'navigator', {
      value: fakeNav,
      configurable: true,
      writable: true,
    });
    const adapter = createGamepadAdapter(FULL_CONFIG);
    expect(adapter.poll()).toEqual({});
    adapter.dispose();
  });

  it('returns {} when getGamepads throws (never-throw)', () => {
    const fakeNav = {
      getGamepads: () => {
        throw new Error('sandboxed iframe');
      },
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: fakeNav,
      configurable: true,
      writable: true,
    });
    const adapter = createGamepadAdapter(FULL_CONFIG);
    expect(adapter.poll()).toEqual({});
    adapter.dispose();
  });
});

describe('createGamepadAdapter — button edges', () => {
  let adapter: GamepadAdapter;
  let currentPad: FakeGamepad;
  let tsCounter: number;
  let original: typeof globalThis.navigator;

  beforeEach(() => {
    original = globalThis.navigator;
    tsCounter = 1;
    currentPad = makePad({ timestamp: tsCounter });
    const fakeNav: FakeNavigator = {
      getGamepads: () => [currentPad],
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: fakeNav,
      configurable: true,
      writable: true,
    });
    adapter = createGamepadAdapter(FULL_CONFIG);
  });

  afterEach(() => {
    adapter.dispose();
    Object.defineProperty(globalThis, 'navigator', {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  /** Advance the hardware timestamp so each state change is observed as new. */
  const bump = (): void => {
    tsCounter += 1;
    currentPad.timestamp = tsCounter;
  };

  it('reports all idle actions on the first poll with no input', () => {
    const edges = adapter.poll();
    expect(edges.jump).toEqual({ held: false, pressed: false, released: false });
    expect(edges.left).toEqual({ held: false, pressed: false, released: false });
  });

  it('button press → pressed edge on the next poll', () => {
    bump();
    currentPad.buttons[0] = makeButton(true, 1);
    const edges = adapter.poll();
    expect(edges.jump).toEqual({ held: true, pressed: true, released: false });
  });

  it('button release → released edge', () => {
    bump();
    currentPad.buttons[0] = makeButton(true, 1);
    adapter.poll();
    bump();
    currentPad.buttons[0] = makeButton(false, 0);
    const edges = adapter.poll();
    expect(edges.jump).toEqual({ held: false, pressed: false, released: true });
  });

  it('held button: pressed only on the first poll, held:true after', () => {
    bump();
    currentPad.buttons[0] = makeButton(true, 1);
    const first = adapter.poll();
    expect(first.jump).toEqual({ held: true, pressed: true, released: false });
    bump();
    const second = adapter.poll();
    expect(second.jump).toEqual({ held: true, pressed: false, released: false });
  });

  it('full press+release between polls surfaces BOTH edges (coalescing)', () => {
    // Two buttons mapping to the same action: a newly-pressed button fires
    // pressEdge while a newly-released button fires releaseEdge into the SAME
    // shared accumulator within one poll. The edge accumulator coalesces
    // both — mirrors the keyboard adapter's "two codes, same action" test.
    adapter.dispose();
    adapter = createGamepadAdapter({
      buttonToAction: { '0': 'jump', '1': 'jump' },
      deadzone: 0.25,
    });
    // Establish prior state: button 1 is held.
    bump();
    currentPad.buttons[1] = makeButton(true, 1);
    adapter.poll();
    // In one poll: release button 1 (true→false) AND press button 0 (false→true).
    bump();
    currentPad.buttons[1] = makeButton(false, 0);
    currentPad.buttons[0] = makeButton(true, 1);
    const edges = adapter.poll();
    // pressEdge (button 0) then releaseEdge (button 1) both land in the shared
    // accumulator. releaseEdge is the last to touch `held` → held=false.
    expect(edges.jump).toEqual({ held: false, pressed: true, released: true });
  });

  it('ignores unmapped button indices', () => {
    bump();
    currentPad.buttons[3] = makeButton(true, 1); // not in config
    const edges = adapter.poll();
    expect(edges.jump).toEqual({ held: false, pressed: false, released: false });
  });
});

describe('createGamepadAdapter — axis edges', () => {
  let adapter: GamepadAdapter;
  let currentPad: FakeGamepad;
  let tsCounter: number;
  let original: typeof globalThis.navigator;

  beforeEach(() => {
    original = globalThis.navigator;
    tsCounter = 1;
    currentPad = makePad({ timestamp: tsCounter });
    const fakeNav: FakeNavigator = {
      getGamepads: () => [currentPad],
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: fakeNav,
      configurable: true,
      writable: true,
    });
    adapter = createGamepadAdapter(FULL_CONFIG);
  });

  afterEach(() => {
    adapter.dispose();
    Object.defineProperty(globalThis, 'navigator', {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  const bump = (): void => {
    tsCounter += 1;
    currentPad.timestamp = tsCounter;
  };

  it('axis crosses deadzone positive → pressed on positive action', () => {
    bump();
    currentPad.axes[0] = 0.5; // > 0.25
    const edges = adapter.poll();
    expect(edges.right).toEqual({ held: true, pressed: true, released: false });
  });

  it('axis drops below deadzone → released on positive action', () => {
    bump();
    currentPad.axes[0] = 0.5;
    adapter.poll();
    bump();
    currentPad.axes[0] = 0.1;
    const edges = adapter.poll();
    expect(edges.right).toEqual({ held: false, pressed: false, released: true });
  });

  it('axis crosses deadzone negative → pressed on negative action', () => {
    bump();
    currentPad.axes[0] = -0.5;
    const edges = adapter.poll();
    expect(edges.left).toEqual({ held: true, pressed: true, released: false });
  });

  it('axis below deadzone → no edge', () => {
    bump();
    currentPad.axes[0] = 0.2; // < 0.25
    const edges = adapter.poll();
    expect(edges.right).toEqual({ held: false, pressed: false, released: false });
    expect(edges.left).toEqual({ held: false, pressed: false, released: false });
  });

  it('exactly at deadzone threshold is treated as triggered (>=)', () => {
    bump();
    currentPad.axes[0] = 0.25; // exactly deadzone
    const edges = adapter.poll();
    expect(edges.right).toEqual({ held: true, pressed: true, released: false });
  });

  it('honors a custom deadzone of 0.1', () => {
    adapter.dispose();
    const customConfig: GamepadConfig = {
      buttonToAction: { '0': 'jump' },
      axisToAction: { '0': { positive: 'right', negative: 'left' } },
      deadzone: 0.1,
    };
    adapter = createGamepadAdapter(customConfig);
    bump();
    currentPad.axes[0] = 0.15; // > 0.1 (custom) but < 0.25 (default)
    const edges = adapter.poll();
    expect(edges.right).toEqual({ held: true, pressed: true, released: false });
  });

  it('applies DEFAULT_GAMEPAD_DEADZONE when not configured', () => {
    adapter.dispose();
    const noDeadzoneConfig: GamepadConfig = {
      buttonToAction: { '0': 'jump' },
      axisToAction: { '0': { positive: 'right', negative: 'left' } },
    };
    adapter = createGamepadAdapter(noDeadzoneConfig);
    bump();
    currentPad.axes[0] = 0.3; // > default 0.25
    const edges = adapter.poll();
    expect(edges.right).toEqual({ held: true, pressed: true, released: false });
    bump();
    currentPad.axes[0] = 0.2; // < default 0.25
    const after = adapter.poll();
    expect(after.right).toEqual({ held: false, pressed: false, released: true });
  });

  it('silently skips axis binding where neither direction is set', () => {
    adapter.dispose();
    const sparseConfig: GamepadConfig = {
      buttonToAction: { '0': 'jump' },
      axisToAction: { '0': {} }, // no positive, no negative
    };
    adapter = createGamepadAdapter(sparseConfig);
    bump();
    currentPad.axes[0] = 0.9;
    const edges = adapter.poll();
    expect(edges).toEqual({
      jump: { held: false, pressed: false, released: false },
    });
  });
});

describe('createGamepadAdapter — non-standard mapping warn-once', () => {
  let adapter: GamepadAdapter;
  let currentPad: FakeGamepad;
  let original: typeof globalThis.navigator;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    original = globalThis.navigator;
    currentPad = makePad({
      mapping: 'xinput',
      id: 'Some Vendor Gamepad (raw)',
      timestamp: 1,
    });
    const fakeNav: FakeNavigator = {
      getGamepads: () => [currentPad],
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: fakeNav,
      configurable: true,
      writable: true,
    });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* swallow */
    });
  });

  afterEach(() => {
    adapter.dispose();
    Object.defineProperty(globalThis, 'navigator', {
      value: original,
      configurable: true,
      writable: true,
    });
    warnSpy.mockRestore();
  });

  it('warns once and returns {} on first poll', () => {
    adapter = createGamepadAdapter(FULL_CONFIG);
    const first = adapter.poll();
    expect(first).toEqual({});
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('Some Vendor Gamepad (raw)');
  });

  it('does NOT warn again on the second poll', () => {
    adapter = createGamepadAdapter(FULL_CONFIG);
    adapter.poll();
    currentPad.timestamp = 2;
    const second = adapter.poll();
    expect(second).toEqual({});
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('createGamepadAdapter — disconnect lifecycle', () => {
  let adapter: GamepadAdapter;
  let currentPad: FakeGamepad;
  let tsCounter: number;
  let original: typeof globalThis.navigator;
  type WinListener = (e: { gamepad: FakeGamepad }) => void;
  let listeners: Record<string, WinListener | undefined>;

  beforeEach(() => {
    original = globalThis.navigator;
    tsCounter = 1;
    currentPad = makePad({ timestamp: tsCounter });
    const fakeNav: FakeNavigator = {
      getGamepads: () => [currentPad],
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: fakeNav,
      configurable: true,
      writable: true,
    });
    listeners = {};
    Object.defineProperty(globalThis, 'window', {
      value: {
        addEventListener: vi.fn((type: string, handler: WinListener) => {
          listeners[type] = handler;
        }),
        removeEventListener: vi.fn((type: string, handler: WinListener) => {
          if (listeners[type] === handler) delete listeners[type];
        }),
      },
      configurable: true,
      writable: true,
    });
    adapter = createGamepadAdapter(FULL_CONFIG);
  });

  afterEach(() => {
    adapter.dispose();
    Object.defineProperty(globalThis, 'navigator', {
      value: original,
      configurable: true,
      writable: true,
    });
    // @ts-expect-error — restoring SSR-like state for window
    delete globalThis.window;
  });

  const bump = (): void => {
    tsCounter += 1;
    currentPad.timestamp = tsCounter;
  };

  it('installs gamepadconnected and gamepaddisconnected listeners', () => {
    expect(listeners['gamepadconnected']).toBeDefined();
    expect(listeners['gamepaddisconnected']).toBeDefined();
  });

  it('disconnect resets all accumulators (no stuck button after reconnect)', () => {
    // press a button, poll it (held+pressed, edges consumed)
    bump();
    currentPad.buttons[0] = makeButton(true, 1);
    adapter.poll();
    // disconnect fires
    listeners['gamepaddisconnected']?.({ gamepad: currentPad });
    // reconnect: button no longer pressed (player released during disconnect)
    bump();
    currentPad.buttons[0] = makeButton(false, 0);
    bump();
    const edges = adapter.poll();
    expect(edges.jump).toEqual({ held: false, pressed: false, released: false });
  });

  it('disconnect clears lastTimestamp so reconnect is observed fresh', () => {
    bump();
    currentPad.buttons[0] = makeButton(true, 1);
    const heldPoll = adapter.poll();
    expect(heldPoll.jump.held).toBe(true);
    const ts = currentPad.timestamp;
    // Disconnect resets accumulators AND clears the timestamp cache.
    listeners['gamepaddisconnected']?.({ gamepad: currentPad });
    // Re-set the SAME timestamp that was cached before disconnect — without
    // the clear, this would short-circuit and return a stale snapshot with
    // held=true (the button was held before disconnect). With the clear, the
    // poll re-diffs and sees the button is now released.
    currentPad.timestamp = ts;
    bump();
    currentPad.buttons[0] = makeButton(false, 0);
    const edges = adapter.poll();
    // After reset, prevButtonHeld is cleared → now=false vs was=false → no
    // edges. Critically, held=false (NOT the stale cached held=true).
    expect(edges.jump).toEqual({ held: false, pressed: false, released: false });
  });
});

describe('createGamepadAdapter — timestamp short-circuit', () => {
  let adapter: GamepadAdapter;
  let currentPad: FakeGamepad;
  let original: typeof globalThis.navigator;

  beforeEach(() => {
    original = globalThis.navigator;
    currentPad = makePad({ timestamp: 100 });
    const fakeNav: FakeNavigator = {
      getGamepads: () => [currentPad],
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: fakeNav,
      configurable: true,
      writable: true,
    });
    adapter = createGamepadAdapter(FULL_CONFIG);
  });

  afterEach(() => {
    adapter.dispose();
    Object.defineProperty(globalThis, 'navigator', {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it('same non-zero timestamp on second poll returns cached snapshot', () => {
    // first poll with input → establishes held state
    currentPad.buttons[0] = makeButton(true, 1);
    const first = adapter.poll();
    expect(first.jump).toEqual({ held: true, pressed: true, released: false });
    // timestamp unchanged → second poll returns cached snapshot, no spurious edges
    const second = adapter.poll();
    expect(second.jump).toEqual({ held: true, pressed: false, released: false });
  });

  it('timestamp === 0 always re-diffs (Firefox quirk)', () => {
    currentPad.timestamp = 0;
    currentPad.buttons[0] = makeButton(true, 1);
    const first = adapter.poll();
    expect(first.jump).toEqual({ held: true, pressed: true, released: false });
    // still timestamp 0, but a release — must be re-diffed despite the cache
    currentPad.buttons[0] = makeButton(false, 0);
    const second = adapter.poll();
    expect(second.jump).toEqual({ held: false, pressed: false, released: true });
  });
});

describe('createGamepadAdapter — dispose', () => {
  type WinListener = (e: { gamepad?: FakeGamepad }) => void;
  let listeners: Record<string, WinListener | undefined>;
  let originalNav: typeof globalThis.navigator;
  let adapter: GamepadAdapter;

  beforeEach(() => {
    originalNav = globalThis.navigator;
    listeners = {};
    Object.defineProperty(globalThis, 'navigator', {
      value: { getGamepads: () => [] },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        addEventListener: vi.fn((type: string, handler: WinListener) => {
          listeners[type] = handler;
        }),
        removeEventListener: vi.fn((type: string, handler: WinListener) => {
          if (listeners[type] === handler) delete listeners[type];
        }),
      },
      configurable: true,
      writable: true,
    });
    adapter = createGamepadAdapter(FULL_CONFIG);
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNav,
      configurable: true,
      writable: true,
    });
    // @ts-expect-error — restoring SSR-like state for window
    delete globalThis.window;
  });

  it('removes gamepadconnected and gamepaddisconnected listeners', () => {
    const connect = listeners['gamepadconnected'];
    const disconnect = listeners['gamepaddisconnected'];
    expect(connect).toBeDefined();
    expect(disconnect).toBeDefined();
    adapter.dispose();
    expect(listeners['gamepadconnected']).toBeUndefined();
    expect(listeners['gamepaddisconnected']).toBeUndefined();
  });

  it('is idempotent', () => {
    expect(() => adapter.dispose()).not.toThrow();
    expect(() => adapter.dispose()).not.toThrow();
  });
});

describe('createGamepadAdapter — composes with orEdges', () => {
  let originalNav: typeof globalThis.navigator;
  let currentPad: FakeGamepad;
  let adapter: GamepadAdapter;

  beforeEach(() => {
    originalNav = globalThis.navigator;
    currentPad = makePad({ timestamp: 1 });
    Object.defineProperty(globalThis, 'navigator', {
      value: { getGamepads: () => [currentPad] },
      configurable: true,
      writable: true,
    });
    adapter = createGamepadAdapter(FULL_CONFIG);
  });

  afterEach(() => {
    adapter.dispose();
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNav,
      configurable: true,
      writable: true,
    });
  });

  it('OR-merges gamepad jump-pressed with an idle keyboard record', () => {
    currentPad.timestamp += 1;
    currentPad.buttons[0] = makeButton(true, 1);
    const gp = adapter.poll();
    const fakeKeyboard: Record<string, { held: boolean; pressed: boolean; released: boolean }> = {
      jump: { held: false, pressed: false, released: false },
    };
    const merged = orEdges(gp.jump, fakeKeyboard.jump);
    expect(merged).toEqual({ held: true, pressed: true, released: false });
  });

  it('OR-merges idle gamepad record with a keyboard pressed edge', () => {
    const gp = adapter.poll(); // idle: nothing pressed yet
    const fakeKeyboard = {
      jump: { held: true, pressed: true, released: false },
    };
    const merged = orEdges(gp.jump, fakeKeyboard.jump);
    expect(merged).toEqual({ held: true, pressed: true, released: false });
  });
});
