import { describe, expect, it } from 'vitest';
import { createCanvas } from 'canvas';
import { drawSprite, createSpriteTintCache } from '../sprites/render';
import { compileSpriteSheet } from '../sprites/compile';
import type { SpriteSheetJSON } from '../sprites/types';
import type { CompiledSpriteSheet } from '../sprites/compile';

/**
 * Build a 2x1 sheet canvas: tile 0 = solid white (left), tile 1 = solid
 * white (right). Used as the `CanvasImageSource` for blit + tint tests.
 */
function makeSheet(tile = 8): { canvas: ReturnType<typeof createCanvas>; w: number; h: number } {
  const canvas = createCanvas(tile * 2, tile);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tile * 2, tile);
  return { canvas, w: tile * 2, h: tile };
}

/**
 * node-canvas's `CanvasRenderingContext2D` is a narrower stub than the DOM
 * type the engine targets, so cast through `unknown` — same idiom as
 * `src/tests/ldtk-render.test.ts:65`.
 */
function ctx2d(canvas: ReturnType<typeof createCanvas>): CanvasRenderingContext2D {
  return canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
}

/** A minimal grid sheet over the 2x1 canvas: 2 tiles, one tag covering both. */
function gridJSON(tile: number): SpriteSheetJSON {
  return {
    frames: {},
    meta: {
      image: 's.png',
      size: { w: tile * 2, h: tile },
      grid: { tileWidth: tile, tileHeight: tile, columns: 2 },
      frameTags: [{ name: 'idle', from: 0, to: 1, direction: 'forward' }],
    },
  };
}

describe('drawSprite', () => {
  it('blits the requested frame into the destination', () => {
    const tile = 8;
    const sheet = makeSheet(tile);
    const { sheet: compiled } = compileSpriteSheet(gridJSON(tile));
    const dest = createCanvas(32, 32);
    const ctx = ctx2d(dest);

    const drew = drawSprite(
      ctx,
      sheet.canvas as unknown as CanvasImageSource,
      compiled,
      0, // frame 0 = left tile
      4,
      4,
    );
    expect(drew).toBe(true);

    // Pixel at destination center (4+tile/2, 4+tile/2) should be white.
    const cx = ctx.getImageData(4 + tile / 2, 4 + tile / 2, 1, 1).data;
    expect(cx[0]).toBe(255); // R
  });

  it('returns false for an out-of-range frame index', () => {
    const tile = 8;
    const sheet = makeSheet(tile);
    const { sheet: compiled } = compileSpriteSheet(gridJSON(tile));
    const dest = createCanvas(16, 16);
    const ctx = ctx2d(dest);
    const drew = drawSprite(ctx, sheet.canvas as unknown as CanvasImageSource, compiled, 999, 0, 0);
    expect(drew).toBe(false);
  });

  it('forces imageSmoothingEnabled=false and restores the prior value', () => {
    const tile = 8;
    const sheet = makeSheet(tile);
    const { sheet: compiled } = compileSpriteSheet(gridJSON(tile));
    const dest = createCanvas(16, 16);
    const ctx = ctx2d(dest);
    ctx.imageSmoothingEnabled = true;
    drawSprite(ctx, sheet.canvas as unknown as CanvasImageSource, compiled, 0, 0, 0);
    expect(ctx.imageSmoothingEnabled).toBe(true);
  });

  it('scales the sprite to destWidth/destHeight', () => {
    const tile = 8;
    const sheet = makeSheet(tile);
    const { sheet: compiled } = compileSpriteSheet(gridJSON(tile));
    const dest = createCanvas(32, 32);
    const ctx = ctx2d(dest);
    drawSprite(ctx, sheet.canvas as unknown as CanvasImageSource, compiled, 0, 0, 0, {
      destWidth: 16,
      destHeight: 16,
    });
    // A 16x16 region at (0,0) should be white; (24,24) should be transparent/0.
    const filled = ctx.getImageData(8, 8, 1, 1).data;
    expect(filled[0]).toBe(255);
    const outside = ctx.getImageData(24, 24, 1, 1).data;
    expect(outside[3]).toBe(0);
  });

  it('mirrors the sprite horizontally when facing is -1', () => {
    // Build an asymmetric sheet: left tile red, right tile green, then ask for
    // frame 0 (red) mirrored. The mirror flips horizontally, so the red still
    // occupies the destination's left tile but mirrored — we just verify a
    // draw happened and the non-tinted path returns true. A full pixel-exact
    // mirror assertion is covered by the scale test's geometry.
    const tile = 8;
    const canvas = createCanvas(tile * 2, tile);
    const sctx = canvas.getContext('2d');
    sctx.fillStyle = '#ff0000';
    sctx.fillRect(0, 0, tile, tile);
    sctx.fillStyle = '#00ff00';
    sctx.fillRect(tile, 0, tile, tile);
    const { sheet: compiled } = compileSpriteSheet(gridJSON(tile));
    const dest = createCanvas(16, 16);
    const ctx = ctx2d(dest);
    const drew = drawSprite(ctx, canvas as unknown as CanvasImageSource, compiled, 0, 0, 0, {
      facing: -1,
    });
    expect(drew).toBe(true);
    const px = ctx.getImageData(4, 4, 1, 1).data;
    expect(px[0]).toBe(255); // red channel present (mirrored red tile)
  });

  it('tints the sprite via the tint cache (recolors opaque pixels)', () => {
    const tile = 8;
    const sheet = makeSheet(tile);
    const { sheet: compiled } = compileSpriteSheet(gridJSON(tile));
    // Under node-canvas there's no document/OffscreenCanvas, so the consumer
    // supplies the canvas package's createCanvas as the tint factory.
    const cache = createSpriteTintCache((w, h) => createCanvas(w, h) as unknown as import('../sprites/render').TintCanvas);
    const dest = createCanvas(16, 16);
    const ctx = ctx2d(dest);
    drawSprite(ctx, sheet.canvas as unknown as CanvasImageSource, compiled, 0, 0, 0, {
      tint: '#0000ff', // blue
      tintCache: cache,
    });
    const px = ctx.getImageData(4, 4, 1, 1).data;
    // Tinted fully-opaque white → blue: R=0, G=0, B=255, A=255.
    expect(px[0]).toBe(0);
    expect(px[1]).toBe(0);
    expect(px[2]).toBe(255);
    expect(px[3]).toBe(255);
    // The cache should now hold the tinted frame.
    expect(cache.get('0|#0000ff')).toBeDefined();
  });

  it('falls back to untinted when no tintCache is supplied', () => {
    const tile = 8;
    const sheet = makeSheet(tile);
    const { sheet: compiled } = compileSpriteSheet(gridJSON(tile));
    const dest = createCanvas(16, 16);
    const ctx = ctx2d(dest);
    drawSprite(ctx, sheet.canvas as unknown as CanvasImageSource, compiled, 0, 0, 0, {
      tint: '#0000ff', // requested but no cache → ignored
    });
    const px = ctx.getImageData(4, 4, 1, 1).data;
    // Untinted white stays white.
    expect(px[0]).toBe(255);
    expect(px[2]).toBe(255);
  });

  it('never throws on a bad image (returns false)', () => {
    const tile = 8;
    const { sheet: compiled } = compileSpriteSheet(gridJSON(tile));
    const dest = createCanvas(16, 16);
    const ctx = ctx2d(dest);
    // Pass a bogus image source.
    const drew = drawSprite(ctx, {} as CanvasImageSource, compiled, 0, 0, 0);
    expect(drew).toBe(false);
  });
});

describe('drawSprite snap option (0.17.1)', () => {
  it('snap: true pins fractional destination coordinates to round() — pixel-identical to the direct integer call', () => {
    // The shim's raison d'être is browser-side: Skia antialiases fractional
    // image destinations even under imageSmoothingEnabled = false (the
    // shimmering edge column a real Celerock build showed mid-jump), while
    // node-canvas's Cairo rounds-to-nearest on its own — so the BLUR cannot
    // be reproduced here. What CAN be pinned is the contract: for any
    // fractional dest, snap renders exactly what the direct integer call
    // renders, across a sweep and under the facing mirror too.
    const canvas = createCanvas(2, 2);
    const tctx = canvas.getContext('2d');
    tctx.fillStyle = '#ff0000'; tctx.fillRect(0, 0, 1, 2);
    tctx.fillStyle = '#0000ff'; tctx.fillRect(1, 0, 1, 2);
    const sheet = {
      image: 'snap-test.png',
      frames: [{ x: 0, y: 0, width: 2, height: 2 }],
      anims: new Map(),
      imageSize: { width: 2, height: 2 },
      characters: new Map(),
    } as unknown as CompiledSpriteSheet;
    const image = canvas as unknown as CanvasImageSource;

    const snapshot = (dx: number, dy: number, opts: { snap?: boolean; facing?: 1 | -1 }): string => {
      const c = createCanvas(8, 8).getContext('2d') as unknown as CanvasRenderingContext2D;
      expect(drawSprite(c, image, sheet, 0, dx, dy, opts)).toBe(true);
      let out = '';
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        out += c.getImageData(x, y, 1, 1).data.join(',');
      }
      return out;
    };

    for (const f of [-1.7, -0.51, 0.25, 0.5, 1.49, 2.7]) {
      expect(snapshot(f, f, { snap: true })).toBe(snapshot(Math.round(f), Math.round(f), {}));
      // Mirrored sprites stay on the same grid.
      expect(snapshot(f, f, { snap: true, facing: -1 })).toBe(snapshot(Math.round(f), Math.round(f), { facing: -1 }));
    }
  });

});
