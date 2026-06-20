import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createKeyboardAdapter } from '../input/keyboard';
import type { KeyboardAdapter, KeyboardConfig } from '../input/types';

type AnyEvent = { code: string; repeat: boolean };
type Listener = (e: AnyEvent) => void;

interface MockWindow {
  addEventListener: (type: string, handler: Listener) => void;
  removeEventListener: (type: string, handler: Listener) => void;
  listeners: Record<string, Listener | undefined>;
}

function createMockWindow(): MockWindow {
  const listeners: Record<string, Listener | undefined> = {};
  return {
    addEventListener: vi.fn((type: string, handler: Listener) => {
      listeners[type] = handler;
    }),
    removeEventListener: vi.fn((type: string, handler: Listener) => {
      if (listeners[type] === handler) delete listeners[type];
    }),
    listeners,
  };
}

function fire(mock: MockWindow, type: string, event: AnyEvent = { code: '', repeat: false }): void {
  mock.listeners[type]?.(event);
}

const CONFIG: KeyboardConfig = {
  codeToAction: { ArrowLeft: 'left', KeyA: 'left', Space: 'jump' },
};

describe('createKeyboardAdapter — no host (Node / SSR)', () => {
  it('does not crash when window is undefined', () => {
    expect(() => createKeyboardAdapter(CONFIG)).not.toThrow();
  });

  it('poll() returns an empty record', () => {
    const adapter = createKeyboardAdapter(CONFIG);
    expect(adapter.poll()).toEqual({});
  });

  it('dispose is a no-op and idempotent', () => {
    const adapter = createKeyboardAdapter(CONFIG);
    expect(() => adapter.dispose()).not.toThrow();
    expect(() => adapter.dispose()).not.toThrow();
  });
});

describe('createKeyboardAdapter — with mock window', () => {
  let mock: MockWindow;
  let adapter: KeyboardAdapter;

  beforeEach(() => {
    mock = createMockWindow();
    vi.stubGlobal('window', mock);
    adapter = createKeyboardAdapter(CONFIG);
  });

  afterEach(() => {
    adapter.dispose();
    vi.unstubAllGlobals();
  });

  it('registers keydown, keyup, and blur listeners on window', () => {
    expect(mock.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(mock.addEventListener).toHaveBeenCalledWith('keyup', expect.any(Function));
    expect(mock.addEventListener).toHaveBeenCalledWith('blur', expect.any(Function));
  });

  it('keydown on a mapped code produces a held+pressed edge', () => {
    fire(mock, 'keydown', { code: 'ArrowLeft', repeat: false });
    expect(adapter.poll()).toEqual({
      left: { held: true, pressed: true, released: false },
      jump: { held: false, pressed: false, released: false },
    });
  });

  it('two codes mapping to the same action share one accumulator', () => {
    fire(mock, 'keydown', { code: 'ArrowLeft', repeat: false });
    fire(mock, 'keyup', { code: 'KeyA', repeat: false });
    expect(adapter.poll().left).toEqual({ held: false, pressed: true, released: true });
  });

  it('keyup produces a released edge', () => {
    fire(mock, 'keydown', { code: 'Space', repeat: false });
    adapter.poll();
    fire(mock, 'keyup', { code: 'Space', repeat: false });
    expect(adapter.poll().jump).toEqual({ held: false, pressed: false, released: true });
  });

  it('ignores auto-repeat keydown events', () => {
    fire(mock, 'keydown', { code: 'Space', repeat: false });
    fire(mock, 'keydown', { code: 'Space', repeat: true });
    expect(adapter.poll().jump).toEqual({ held: true, pressed: true, released: false });
  });

  it('ignores unmapped codes', () => {
    fire(mock, 'keydown', { code: 'KeyZ', repeat: false });
    expect(adapter.poll()).toEqual({
      left: { held: false, pressed: false, released: false },
      jump: { held: false, pressed: false, released: false },
    });
  });

  it('window blur resets all accumulators (no stuck keys)', () => {
    fire(mock, 'keydown', { code: 'Space', repeat: false });
    fire(mock, 'blur');
    expect(adapter.poll().jump).toEqual({ held: false, pressed: false, released: false });
  });

  it('clears edges after they are polled', () => {
    fire(mock, 'keydown', { code: 'Space', repeat: false });
    adapter.poll();
    expect(adapter.poll().jump).toEqual({ held: true, pressed: false, released: false });
  });

  it('dispose removes all registered listeners', () => {
    adapter.dispose();
    expect(mock.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(mock.removeEventListener).toHaveBeenCalledWith('keyup', expect.any(Function));
    expect(mock.removeEventListener).toHaveBeenCalledWith('blur', expect.any(Function));
  });

  it('dispose is idempotent', () => {
    adapter.dispose();
    expect(() => adapter.dispose()).not.toThrow();
  });
});
