import { describe, expect, it, vi } from 'vitest';
import {
  applySnappedTranslate,
  snapCameraTranslation,
} from '../primitives/snap';

describe('snapCameraTranslation', () => {
  it('rounds translations onto the supplied device-pixel grid', () => {
    expect(snapCameraTranslation(-10.3, 5.2, 1.25)).toEqual({
      x: -10.4,
      y: 5.6,
    });
    expect(snapCameraTranslation(1 / 3, 2 / 3, 3)).toEqual({
      x: 1 / 3,
      y: 2 / 3,
    });
  });

  it('degrades malformed values safely', () => {
    expect(snapCameraTranslation(Number.NaN, Infinity, 0)).toEqual({ x: 0, y: 0 });
    expect(snapCameraTranslation(1.4, 1.6, Number.NaN)).toEqual({ x: 1, y: 2 });
  });
});

describe('applySnappedTranslate', () => {
  it('applies the exact snapped translation and leaves save/restore to the caller', () => {
    const translate = vi.fn();
    applySnappedTranslate(
      { translate } as unknown as CanvasRenderingContext2D,
      -10.3,
      5.2,
      1.25,
    );
    expect(translate).toHaveBeenCalledExactlyOnceWith(-10.4, 5.6);
  });
});
