import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTouchButtonSet } from '../input/touch-button-set';
import { orEdges } from '../input/merge';
import type { PolledEdge, TouchButtonSetAdapter } from '../input/types';

type Listener = (e: { pointerId?: number }) => void;

interface MockTarget {
  addEventListener: (type: string, handler: Listener) => void;
  removeEventListener: (type: string, handler: Listener) => void;
  style: Record<string, string>;
  listeners: Record<string, Listener | undefined>;
}

function createMockTarget(): MockTarget {
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

interface MockHost {
  window: MockTarget;
  document: MockTarget;
}

function createMockHost(): MockHost {
  return {
    window: createMockTarget(),
    document: createMockTarget(),
  };
}

const IDLE: PolledEdge = { held: false, pressed: false, released: false };

describe('createTouchButtonSet — SSR / no host (Node)', () => {
  it('does not crash when window is undefined', () => {
    expect(() => createTouchButtonSet({ elements: [] })).not.toThrow();
  });

  it('poll() returns idle array matching input length', () => {
    const a = createTouchButtonSet({ elements: [null, null, null] });
    expect(a.poll()).toEqual([IDLE, IDLE, IDLE]);
    expect(a.poll()).toHaveLength(3);
  });

  it('poll() returns [] for empty elements', () => {
    expect(createTouchButtonSet({ elements: [] }).poll()).toEqual([]);
  });

  it('dispose is a no-op and idempotent', () => {
    const a = createTouchButtonSet({ elements: [null] });
    expect(() => a.dispose()).not.toThrow();
    expect(() => a.dispose()).not.toThrow();
  });
});

describe('createTouchButtonSet — live path (window + document stubbed)', () => {
  let host: MockHost;
  let btnA: MockTarget;
  let btnB: MockTarget;

  beforeEach(() => {
    host = createMockHost();
    btnA = createMockTarget();
    btnB = createMockTarget();
    vi.stubGlobal('window', host.window);
    vi.stubGlobal('document', host.document);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets touchAction="none" on each non-null element', () => {
    createTouchButtonSet({ elements: [btnA, btnB] as unknown as HTMLElement[] });
    expect(btnA.style.touchAction).toBe('none');
    expect(btnB.style.touchAction).toBe('none');
  });

  it('registers pointerdown / pointerup / pointercancel / pointerleave on each non-null element', () => {
    createTouchButtonSet({ elements: [btnA] as unknown as HTMLElement[] });
    expect(btnA.addEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    expect(btnA.addEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
    expect(btnA.addEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    expect(btnA.addEventListener).toHaveBeenCalledWith('pointerleave', expect.any(Function));
  });

  it('registers pointerup / pointercancel / pointerleave on document (global safety net)', () => {
    createTouchButtonSet({ elements: [btnA] as unknown as HTMLElement[] });
    expect(host.document.addEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
    expect(host.document.addEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    expect(host.document.addEventListener).toHaveBeenCalledWith('pointerleave', expect.any(Function));
  });

  it('skips null elements (no listeners, no touchAction) but keeps the slot aligned', () => {
    const liveBtn = createMockTarget();
    const set = createTouchButtonSet({
      elements: [null, liveBtn as unknown as HTMLElement, null],
    });
    expect(liveBtn.addEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    expect(liveBtn.style.touchAction).toBe('none');
    expect(set.poll()).toHaveLength(3);
    set.dispose();
  });
});

describe('createTouchButtonSet — pointer-ID isolation (two buttons)', () => {
  let host: MockHost;
  let btnA: MockTarget;
  let btnB: MockTarget;
  let set: TouchButtonSetAdapter;

  beforeEach(() => {
    host = createMockHost();
    btnA = createMockTarget();
    btnB = createMockTarget();
    vi.stubGlobal('window', host.window);
    vi.stubGlobal('document', host.document);
    set = createTouchButtonSet({
      elements: [btnA, btnB] as unknown as HTMLElement[],
    });
  });

  afterEach(() => {
    set.dispose();
    vi.unstubAllGlobals();
  });

  it('pointerdown on btn A only presses A; B stays idle', () => {
    btnA.listeners.pointerdown?.({ pointerId: 1 });
    expect(set.poll()).toEqual([
      { held: true, pressed: true, released: false },
      IDLE,
    ]);
  });

  it('pointerdown on btn B while A is held: both register independently', () => {
    btnA.listeners.pointerdown?.({ pointerId: 1 });
    set.poll();
    btnB.listeners.pointerdown?.({ pointerId: 2 });
    expect(set.poll()).toEqual([
      { held: true, pressed: false, released: false },
      { held: true, pressed: true, released: false },
    ]);
  });

  it('pointerup on btn A releases A only; B stays held', () => {
    btnA.listeners.pointerdown?.({ pointerId: 1 });
    btnB.listeners.pointerdown?.({ pointerId: 2 });
    set.poll();
    btnA.listeners.pointerup?.({ pointerId: 1 });
    expect(set.poll()).toEqual([
      { held: false, pressed: false, released: true },
      { held: true, pressed: false, released: false },
    ]);
  });
});

describe('createTouchButtonSet — same-button multi-touch', () => {
  let host: MockHost;
  let btn: MockTarget;
  let set: TouchButtonSetAdapter;

  beforeEach(() => {
    host = createMockHost();
    btn = createMockTarget();
    vi.stubGlobal('window', host.window);
    vi.stubGlobal('document', host.document);
    set = createTouchButtonSet({ elements: [btn] as unknown as HTMLElement[] });
  });

  afterEach(() => {
    set.dispose();
    vi.unstubAllGlobals();
  });

  it('two pointers on same button: held+single-pressed; release only when BOTH lift', () => {
    btn.listeners.pointerdown?.({ pointerId: 1 });
    btn.listeners.pointerdown?.({ pointerId: 2 });
    expect(set.poll()).toEqual([{ held: true, pressed: true, released: false }]);

    btn.listeners.pointerup?.({ pointerId: 1 });
    expect(set.poll()).toEqual([{ held: true, pressed: false, released: false }]);

    btn.listeners.pointerup?.({ pointerId: 2 });
    expect(set.poll()).toEqual([{ held: false, pressed: false, released: true }]);
  });
});

describe('createTouchButtonSet — 0→≥1 / 1→0 edge transitions', () => {
  let host: MockHost;
  let btn: MockTarget;
  let set: TouchButtonSetAdapter;

  beforeEach(() => {
    host = createMockHost();
    btn = createMockTarget();
    vi.stubGlobal('window', host.window);
    vi.stubGlobal('document', host.document);
    set = createTouchButtonSet({ elements: [btn] as unknown as HTMLElement[] });
  });

  afterEach(() => {
    set.dispose();
    vi.unstubAllGlobals();
  });

  it('0→≥1: first pointerdown fires pressed edge', () => {
    btn.listeners.pointerdown?.({ pointerId: 1 });
    expect(set.poll()).toEqual([{ held: true, pressed: true, released: false }]);
  });

  it('0→≥1→≥2: second pointerdown does NOT re-fire pressed', () => {
    btn.listeners.pointerdown?.({ pointerId: 1 });
    set.poll();
    btn.listeners.pointerdown?.({ pointerId: 2 });
    expect(set.poll()).toEqual([{ held: true, pressed: false, released: false }]);
  });

  it('≥1→≥1: lifting one of two pointers does NOT fire released', () => {
    btn.listeners.pointerdown?.({ pointerId: 1 });
    btn.listeners.pointerdown?.({ pointerId: 2 });
    set.poll();
    btn.listeners.pointerup?.({ pointerId: 1 });
    expect(set.poll()).toEqual([{ held: true, pressed: false, released: false }]);
  });

  it('1→0: lifting last pointer fires released', () => {
    btn.listeners.pointerdown?.({ pointerId: 1 });
    set.poll();
    btn.listeners.pointerup?.({ pointerId: 1 });
    expect(set.poll()).toEqual([{ held: false, pressed: false, released: true }]);
  });

  it('press + release between two polls surfaces BOTH edges on next poll', () => {
    btn.listeners.pointerdown?.({ pointerId: 1 });
    btn.listeners.pointerup?.({ pointerId: 1 });
    expect(set.poll()).toEqual([{ held: false, pressed: true, released: true }]);
  });

  it('per-element pointerup followed by document pointerup: no double-release', () => {
    btn.listeners.pointerdown?.({ pointerId: 1 });
    set.poll();
    btn.listeners.pointerup?.({ pointerId: 1 });
    host.document.listeners.pointerup?.({ pointerId: 1 });
    expect(set.poll()).toEqual([{ held: false, pressed: false, released: true }]);
  });

  it('pointercancel triggers 1→0 release', () => {
    btn.listeners.pointerdown?.({ pointerId: 1 });
    set.poll();
    btn.listeners.pointercancel?.({ pointerId: 1 });
    expect(set.poll()).toEqual([{ held: false, pressed: false, released: true }]);
  });

  it('pointerleave on element triggers 1→0 release', () => {
    btn.listeners.pointerdown?.({ pointerId: 1 });
    set.poll();
    btn.listeners.pointerleave?.({ pointerId: 1 });
    expect(set.poll()).toEqual([{ held: false, pressed: false, released: true }]);
  });

  it('no double-fire: subsequent polls with no events return idle held-only state', () => {
    btn.listeners.pointerdown?.({ pointerId: 1 });
    set.poll();
    btn.listeners.pointerup?.({ pointerId: 1 });
    set.poll();
    expect(set.poll()).toEqual([{ held: false, pressed: false, released: false }]);
  });
});

describe('createTouchButtonSet — global document safety net (stuck-button fix)', () => {
  let host: MockHost;
  let btn: MockTarget;
  let set: TouchButtonSetAdapter;

  beforeEach(() => {
    host = createMockHost();
    btn = createMockTarget();
    vi.stubGlobal('window', host.window);
    vi.stubGlobal('document', host.document);
    set = createTouchButtonSet({ elements: [btn] as unknown as HTMLElement[] });
  });

  afterEach(() => {
    set.dispose();
    vi.unstubAllGlobals();
  });

  it('document pointerup releases a stuck button', () => {
    btn.listeners.pointerdown?.({ pointerId: 5 });
    set.poll();
    host.document.listeners.pointerup?.({ pointerId: 5 });
    expect(set.poll()).toEqual([{ held: false, pressed: false, released: true }]);
  });

  it('document pointercancel releases a stuck button', () => {
    btn.listeners.pointerdown?.({ pointerId: 5 });
    set.poll();
    host.document.listeners.pointercancel?.({ pointerId: 5 });
    expect(set.poll()).toEqual([{ held: false, pressed: false, released: true }]);
  });

  it('document pointerleave releases a stuck button (viewport-exit fix)', () => {
    btn.listeners.pointerdown?.({ pointerId: 5 });
    set.poll();
    host.document.listeners.pointerleave?.({ pointerId: 5 });
    expect(set.poll()).toEqual([{ held: false, pressed: false, released: true }]);
  });

  it('document safety net ignores unknown pointer IDs', () => {
    btn.listeners.pointerdown?.({ pointerId: 5 });
    set.poll();
    host.document.listeners.pointerup?.({ pointerId: 999 });
    expect(set.poll()).toEqual([{ held: true, pressed: false, released: false }]);
  });

  it('safety net releases only the slot that owns the pointer', () => {
    const btn2 = createMockTarget();
    const set2 = createTouchButtonSet({
      elements: [btn, btn2] as unknown as HTMLElement[],
    });
    btn.listeners.pointerdown?.({ pointerId: 5 });
    btn2.listeners.pointerdown?.({ pointerId: 6 });
    set2.poll();
    host.document.listeners.pointerleave?.({ pointerId: 5 });
    expect(set2.poll()).toEqual([
      { held: false, pressed: false, released: true },
      { held: true, pressed: false, released: false },
    ]);
    set2.dispose();
  });
});

describe('createTouchButtonSet — null elements', () => {
  let host: MockHost;

  beforeEach(() => {
    host = createMockHost();
    vi.stubGlobal('window', host.window);
    vi.stubGlobal('document', host.document);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('null slots produce idle PolledEdge; live button is wired normally', () => {
    const liveBtn = createMockTarget();
    const set = createTouchButtonSet({
      elements: [null, liveBtn as unknown as HTMLElement, null],
    });
    expect(liveBtn.addEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    expect(liveBtn.style.touchAction).toBe('none');
    expect(set.poll()).toEqual([IDLE, IDLE, IDLE]);
    set.dispose();
  });

  it('press on live button does not affect null slots', () => {
    const liveBtn = createMockTarget();
    const set = createTouchButtonSet({
      elements: [null, liveBtn as unknown as HTMLElement, null],
    });
    liveBtn.listeners.pointerdown?.({ pointerId: 1 });
    expect(set.poll()).toEqual([
      IDLE,
      { held: true, pressed: true, released: false },
      IDLE,
    ]);
    set.dispose();
  });
});

describe('createTouchButtonSet — dispose', () => {
  let host: MockHost;
  let btn: MockTarget;
  let set: TouchButtonSetAdapter;

  beforeEach(() => {
    host = createMockHost();
    btn = createMockTarget();
    vi.stubGlobal('window', host.window);
    vi.stubGlobal('document', host.document);
    set = createTouchButtonSet({ elements: [btn] as unknown as HTMLElement[] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('removes all element listeners on dispose', () => {
    set.dispose();
    expect(btn.removeEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    expect(btn.removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
    expect(btn.removeEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    expect(btn.removeEventListener).toHaveBeenCalledWith('pointerleave', expect.any(Function));
  });

  it('removes all document listeners on dispose', () => {
    set.dispose();
    expect(host.document.removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
    expect(host.document.removeEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    expect(host.document.removeEventListener).toHaveBeenCalledWith('pointerleave', expect.any(Function));
  });

  it('is idempotent', () => {
    expect(() => set.dispose()).not.toThrow();
    expect(() => set.dispose()).not.toThrow();
    expect(() => set.dispose()).not.toThrow();
  });

  it('events after dispose do not latch (handlers removed from mock)', () => {
    set.dispose();
    btn.listeners.pointerdown?.({ pointerId: 1 });
    expect(set.poll()).toEqual([IDLE]);
  });

  it('poll after dispose returns the last-known held state (no further release latch)', () => {
    btn.listeners.pointerdown?.({ pointerId: 1 });
    set.poll();
    set.dispose();
    btn.listeners.pointerup?.({ pointerId: 1 });
    expect(set.poll()).toEqual([{ held: true, pressed: false, released: false }]);
  });
});

describe('createTouchButtonSet — composability with orEdges', () => {
  let host: MockHost;
  let btn: MockTarget;
  let set: TouchButtonSetAdapter;

  beforeEach(() => {
    host = createMockHost();
    btn = createMockTarget();
    vi.stubGlobal('window', host.window);
    vi.stubGlobal('document', host.document);
    set = createTouchButtonSet({ elements: [btn] as unknown as HTMLElement[] });
  });

  afterEach(() => {
    set.dispose();
    vi.unstubAllGlobals();
  });

  it('touch press OR-merged with idle keyboard edge yields held+pressed', () => {
    const keyboardJump: PolledEdge = IDLE;
    btn.listeners.pointerdown?.({ pointerId: 1 });
    const [touchEdge] = set.poll();
    const merged = orEdges(keyboardJump, touchEdge);
    expect(merged).toEqual({ held: true, pressed: true, released: false });
  });

  it('idle touch OR-merged with held keyboard edge yields held', () => {
    const keyboardLeft: PolledEdge = { held: true, pressed: true, released: false };
    const [touchEdge] = set.poll();
    const merged = orEdges(keyboardLeft, touchEdge);
    expect(merged).toEqual({ held: true, pressed: true, released: false });
  });
});
