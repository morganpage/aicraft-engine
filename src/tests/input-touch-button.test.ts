import { describe, it, expect, vi } from 'vitest';
import { createTouchButton } from '../input/touch-button';

type Listener = (e: { pointerId?: number }) => void;

interface MockElement {
  addEventListener: (type: string, handler: Listener) => void;
  removeEventListener: (type: string, handler: Listener) => void;
  style: Record<string, string>;
  listeners: Record<string, Listener | undefined>;
}

function createMockElement(): MockElement {
  const listeners: Record<string, Listener | undefined> = {};
  return {
    addEventListener: vi.fn((type: string, handler: Listener) => {
      listeners[type] = handler;
    }),
    removeEventListener: vi.fn((type: string, handler: Listener) => {
      if (listeners[type] === handler) delete listeners[type];
    }),
    style: {},
    listeners,
  };
}

const IDLE = { held: false, pressed: false, released: false };

describe('createTouchButton — null element (SSR / no DOM)', () => {
  it('does not crash when element is null', () => {
    expect(() => createTouchButton(null)).not.toThrow();
  });

  it('poll() returns an all-false snapshot', () => {
    expect(createTouchButton(null).poll()).toEqual(IDLE);
  });

  it('dispose is a no-op and idempotent', () => {
    const adapter = createTouchButton(null);
    expect(() => adapter.dispose()).not.toThrow();
    expect(() => adapter.dispose()).not.toThrow();
  });
});

describe('createTouchButton — with mock element', () => {
  it('sets touchAction to "none" to prevent scroll/gesture interference', () => {
    const el = createMockElement();
    createTouchButton(el as unknown as HTMLElement);
    expect(el.style.touchAction).toBe('none');
  });

  it('registers pointerdown / up / cancel / leave listeners', () => {
    const el = createMockElement();
    createTouchButton(el as unknown as HTMLElement);
    expect(el.addEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    expect(el.addEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
    expect(el.addEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    expect(el.addEventListener).toHaveBeenCalledWith('pointerleave', expect.any(Function));
  });

  it('pointerdown produces a held+pressed edge', () => {
    const el = createMockElement();
    const adapter = createTouchButton(el as unknown as HTMLElement);
    el.listeners.pointerdown?.({ pointerId: 1 });
    expect(adapter.poll()).toEqual({ held: true, pressed: true, released: false });
  });

  it('pointerup produces a released edge', () => {
    const el = createMockElement();
    const adapter = createTouchButton(el as unknown as HTMLElement);
    el.listeners.pointerdown?.({ pointerId: 1 });
    adapter.poll();
    el.listeners.pointerup?.({ pointerId: 1 });
    expect(adapter.poll()).toEqual({ held: false, pressed: false, released: true });
  });

  it('pointercancel releases the held state and latches the released edge', () => {
    const el = createMockElement();
    const adapter = createTouchButton(el as unknown as HTMLElement);
    el.listeners.pointerdown?.({ pointerId: 1 });
    el.listeners.pointercancel?.({ pointerId: 1 });
    expect(adapter.poll()).toEqual({ held: false, pressed: true, released: true });
  });

  it('clears edges after they are polled', () => {
    const el = createMockElement();
    const adapter = createTouchButton(el as unknown as HTMLElement);
    el.listeners.pointerdown?.({ pointerId: 1 });
    adapter.poll();
    expect(adapter.poll()).toEqual({ held: true, pressed: false, released: false });
  });

  it('dispose removes all registered listeners', () => {
    const el = createMockElement();
    const adapter = createTouchButton(el as unknown as HTMLElement);
    adapter.dispose();
    expect(el.removeEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    expect(el.removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
    expect(el.removeEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    expect(el.removeEventListener).toHaveBeenCalledWith('pointerleave', expect.any(Function));
  });

  it('dispose is idempotent', () => {
    const el = createMockElement();
    const adapter = createTouchButton(el as unknown as HTMLElement);
    expect(() => adapter.dispose()).not.toThrow();
    expect(() => adapter.dispose()).not.toThrow();
  });
});
