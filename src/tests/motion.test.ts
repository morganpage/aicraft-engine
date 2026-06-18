import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prefersReducedMotion, resetMotionCacheForTests } from '../primitives/motion';

describe('prefersReducedMotion', () => {
  beforeEach(() => {
    resetMotionCacheForTests();
  });

  it('returns false when window is undefined (node test env)', () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it('returns true when matchMedia reports reduce', () => {
    const mockMatchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('window', { matchMedia: mockMatchMedia });
    try {
      expect(prefersReducedMotion()).toBe(true);
      expect(mockMatchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns false when matchMedia reports no preference', () => {
    const mockMatchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal('window', { matchMedia: mockMatchMedia });
    try {
      expect(prefersReducedMotion()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('caches the result across calls', () => {
    const mockMatchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('window', { matchMedia: mockMatchMedia });
    try {
      prefersReducedMotion();
      prefersReducedMotion();
      prefersReducedMotion();
      expect(mockMatchMedia).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to false if matchMedia throws', () => {
    const mockMatchMedia = vi.fn().mockImplementation(() => {
      throw new Error('matchMedia unavailable');
    });
    vi.stubGlobal('window', { matchMedia: mockMatchMedia });
    try {
      expect(prefersReducedMotion()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
