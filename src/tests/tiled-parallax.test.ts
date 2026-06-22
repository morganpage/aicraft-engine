import { describe, it, expect, vi } from 'vitest';
import { tiledParallaxRange, drawTiledParallax } from '../primitives/parallax';

describe('tiledParallaxRange', () => {
  it('computes basic geometry for a centered viewport (camera=0)', () => {
    // Case #1: offset 0 → startX 0, copies = ceil(400/100) = 4
    expect(tiledParallaxRange(0, 0.5, 100, 400)).toEqual({ startX: 0, copies: 4 });
  });

  it('returns startX 0 on perfect alignment after a full camera scroll', () => {
    // Case #2: camera 200, factor 1.0, tile 100 → offset -200, -200 % 100 = -0 → normalized to 0
    expect(tiledParallaxRange(200, 1.0, 100, 400)).toEqual({ startX: 0, copies: 4 });
  });

  it('handles sub-pixel camera positions exactly (no rounding)', () => {
    // Case #3: offset -75.125, startX -75.125, copies = ceil(475.125/100) = 5
    expect(tiledParallaxRange(150.25, 0.5, 100, 400)).toEqual({
      startX: -75.125,
      copies: 5,
    });
  });

  it('draws exactly enough copies at perfect grid alignment (no off-screen waste)', () => {
    // Case #4: offset -200, normalized startX 0, copies = ceil(400/100) = 4
    expect(tiledParallaxRange(400, 0.5, 100, 400)).toEqual({ startX: 0, copies: 4 });
  });

  it('returns 1 copy when a single tile wider than the viewport covers it', () => {
    // Case #5: offset 0, startX 0, copies = max(1, ceil(320/500)) = max(1, 1) = 1
    expect(tiledParallaxRange(0, 1.0, 500, 320)).toEqual({ startX: 0, copies: 1 });
  });

  it('guards against zero tile width by returning copies 0', () => {
    // Case #6: degenerate guard prevents division-by-zero and infinite loops
    expect(tiledParallaxRange(100, 0.5, 0, 400)).toEqual({ startX: 0, copies: 0 });
  });

  it('guards against negative tile width by returning copies 0', () => {
    // Case #7: same degenerate guard as zero width
    expect(tiledParallaxRange(100, 0.5, -50, 400)).toEqual({ startX: 0, copies: 0 });
  });

  it('returns 2 copies when the viewport is only partially covered by one tile', () => {
    // Case #8: offset -300, startX -300, copies = ceil(620/500) = 2
    expect(tiledParallaxRange(300, 1.0, 500, 320)).toEqual({ startX: -300, copies: 2 });
  });

  it('returns startX 0 and full coverage for a static layer (factor=0)', () => {
    // Case #9: factor 0 → offset -0 → startX 0; copies = ceil(800/256) = 4
    expect(tiledParallaxRange(500, 0, 256, 800)).toEqual({ startX: 0, copies: 4 });
  });

  it('handles foreground factors greater than 1', () => {
    // Case #10: offset -200, -200 % 200 = -0 → 0; copies = ceil(600/200) = 3
    expect(tiledParallaxRange(100, 2.0, 200, 600)).toEqual({ startX: 0, copies: 3 });
  });

  it('still draws at least 1 copy when the viewport width is 0 (Math.max guard)', () => {
    // Case #11: offset -50, startX -50, copies = max(1, ceil(50/100)) = 1
    expect(tiledParallaxRange(100, 0.5, 100, 0)).toEqual({ startX: -50, copies: 1 });
  });

  it('normalizes negative zero on startX to positive zero', () => {
    // Case #12: -200 % 100 yields -0 in JS; the helper must coerce it to +0 so
    // that Object.is(startX, -0) is false and Object.is(startX, 0) is true.
    const result = tiledParallaxRange(200, 1.0, 100, 400);
    expect(Object.is(result.startX, -0)).toBe(false);
    expect(Object.is(result.startX, 0)).toBe(true);
  });

  it('is deterministic and returns a fresh object per call', () => {
    // Case #13: identical inputs → deep-equal but not referentially identical.
    const a = tiledParallaxRange(123.456, 0.37, 87, 654);
    const b = tiledParallaxRange(123.456, 0.37, 87, 654);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('drawTiledParallax', () => {
  it('invokes drawTile exactly `copies` times, at startX + i*tileWidth', () => {
    // Case #14: range is { startX: 0, copies: 4 } → 4 calls at 0, 100, 200, 300.
    const ctx = {} as CanvasRenderingContext2D;
    const drawTile = vi.fn();
    drawTiledParallax(ctx, drawTile, 0, 0.5, 100, 400);
    expect(drawTile).toHaveBeenCalledTimes(4);
    const screenXs = drawTile.mock.calls.map((call) => call[1]);
    expect(screenXs).toEqual([0, 100, 200, 300]);
    // The wrapper must pass the same ctx reference through untouched.
    for (const call of drawTile.mock.calls) {
      expect(call[0]).toBe(ctx);
    }
  });

  it('never invokes drawTile when tileWidth is zero (degenerate guard)', () => {
    // Case #15: copies = 0 → loop body runs zero iterations.
    const ctx = {} as CanvasRenderingContext2D;
    const drawTile = vi.fn();
    drawTiledParallax(ctx, drawTile, 100, 0.5, 0, 400);
    expect(drawTile).not.toHaveBeenCalled();
  });
});
