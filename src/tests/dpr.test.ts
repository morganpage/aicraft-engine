import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FALLBACK_DPR,
  getDevicePixelRatio,
  resetDprCacheForTests,
  resizeCanvasToBackingStore,
} from '../primitives/dpr';

/**
 * Minimal canvas stub. The Node test env has no `document`; we cast a plain
 * object as `HTMLCanvasElement` (same defensive-mock style as
 * `input-touch-button.test.ts` casts plain objects to `HTMLElement`).
 */
interface MockCanvas {
  width: number;
  height: number;
  style: Record<string, string>;
}

function createMockCanvas(): MockCanvas {
  return { width: 0, height: 0, style: {} };
}

// Reset the module-level cache before every test so stub order across
// describes can't leak stale state. (Per-describe beforeEach would let the
// last test of one describe pollute the first test of the next.)
beforeEach(() => {
  resetDprCacheForTests();
});

describe('FALLBACK_DPR', () => {
  it('is 1', () => {
    expect(FALLBACK_DPR).toBe(1);
  });
});

describe('getDevicePixelRatio', () => {
  it('returns FALLBACK_DPR (1) when window is undefined (Node test env)', () => {
    expect(getDevicePixelRatio()).toBe(FALLBACK_DPR);
    expect(getDevicePixelRatio()).toBe(1);
  });

  it('reads window.devicePixelRatio when available', () => {
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    try {
      expect(getDevicePixelRatio()).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('caches the result across calls (no re-read after the first)', () => {
    let reads = 0;
    vi.stubGlobal('window', {
      get devicePixelRatio(): number {
        reads += 1;
        return 3;
      },
    });
    try {
      getDevicePixelRatio();
      getDevicePixelRatio();
      getDevicePixelRatio();
      expect(reads).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to FALLBACK_DPR if reading devicePixelRatio throws', () => {
    vi.stubGlobal('window', {
      get devicePixelRatio(): number {
        throw new Error('access denied');
      },
    });
    try {
      expect(getDevicePixelRatio()).toBe(FALLBACK_DPR);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to FALLBACK_DPR if devicePixelRatio is not a number', () => {
    vi.stubGlobal('window', { devicePixelRatio: undefined });
    try {
      expect(getDevicePixelRatio()).toBe(FALLBACK_DPR);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('resetDprCacheForTests', () => {
  it('clears the cache so the next read is fresh', () => {
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    try {
      expect(getDevicePixelRatio()).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
    resetDprCacheForTests();
    vi.stubGlobal('window', { devicePixelRatio: 3 });
    try {
      expect(getDevicePixelRatio()).toBe(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('resizeCanvasToBackingStore', () => {
  it('sets canvas.width/height to round(css * dpr) and returns the dpr (DPR=1 in Node)', () => {
    const canvas = createMockCanvas();
    const dpr = resizeCanvasToBackingStore(
      canvas as unknown as HTMLCanvasElement,
      600,
      400,
    );
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(400);
    expect(dpr).toBe(1);
  });

  it('reads DPR fresh each call — NOT via the cached getDevicePixelRatio (Architect fix)', () => {
    // Prime the cache with DPR=2 via the cached reader.
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    try {
      expect(getDevicePixelRatio()).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
    // DPR changes at runtime (window dragged to a 3× monitor / browser zoom).
    // Note: resetDprCacheForTests is NOT called — the cache still holds 2.
    vi.stubGlobal('window', { devicePixelRatio: 3 });
    const canvas = createMockCanvas();
    try {
      const dpr = resizeCanvasToBackingStore(
        canvas as unknown as HTMLCanvasElement,
        100,
        100,
      );
      // resize must read FRESH — if it used the cache this would be 2.
      expect(dpr).toBe(3);
      expect(canvas.width).toBe(300);
      expect(canvas.height).toBe(300);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rounds fractional DPR via Math.round (1.5 → 2; rounding down would blur)', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1.5 });
    try {
      // 101 × 1.5 = 151.5 → Math.round → 152 (rounds UP, never down).
      const canvas = createMockCanvas();
      const dpr = resizeCanvasToBackingStore(
        canvas as unknown as HTMLCanvasElement,
        101,
        101,
      );
      expect(dpr).toBe(1.5);
      expect(canvas.width).toBe(152);
      expect(canvas.height).toBe(152);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does NOT touch canvas.style (consumer owns CSS sizing)', () => {
    const canvas = createMockCanvas();
    canvas.style.width = '600px';
    canvas.style.height = '400px';
    resizeCanvasToBackingStore(
      canvas as unknown as HTMLCanvasElement,
      600,
      400,
    );
    expect(canvas.style.width).toBe('600px');
    expect(canvas.style.height).toBe('400px');
  });

  it('clamps canvas dimensions to a minimum of 1 (no zero-size backing store)', () => {
    const canvas = createMockCanvas();
    resizeCanvasToBackingStore(
      canvas as unknown as HTMLCanvasElement,
      0,
      0,
    );
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
  });

  it('swallows errors from the canvas.width setter and returns FALLBACK_DPR', () => {
    const canvas = createMockCanvas();
    Object.defineProperty(canvas, 'width', {
      configurable: true,
      set: () => {
        throw new Error('width setter exploded');
      },
      get: () => 0,
    });
    let dpr: number = -1;
    expect(() => {
      dpr = resizeCanvasToBackingStore(
        canvas as unknown as HTMLCanvasElement,
        600,
        400,
      );
    }).not.toThrow();
    expect(dpr).toBe(FALLBACK_DPR);
  });

  it('returns FALLBACK_DPR when window is undefined (Node test env)', () => {
    const canvas = createMockCanvas();
    const dpr = resizeCanvasToBackingStore(
      canvas as unknown as HTMLCanvasElement,
      600,
      400,
    );
    expect(dpr).toBe(FALLBACK_DPR);
  });
});
