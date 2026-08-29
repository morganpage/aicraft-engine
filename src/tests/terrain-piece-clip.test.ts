/**
 * TE.3 prototype tests — clip at the anchored edge.
 *
 * The spec's acceptance criterion is "visible extent matches a caller-supplied
 * width at every step". These tests measure that from the **destination canvas
 * pixels**, not from the numbers the helper was handed.
 */

import { describe, it, expect } from 'vitest';
import type { TileGrid } from '../level/types';
import { resolveTerrainPiece, type TerrainPiece } from '../terrain-art/piece';
import { bakeTerrainPiece, type BakedTerrainPiece } from '../terrain-art/piece-render';
import {
  drawClippedTerrainPiece,
  drawMaskedTerrainPiece,
  type TerrainPieceAnchor,
} from '../terrain-art/piece-render';
import { STRIP_RULE_SET, STONE_KINDS } from './terrain-piece-fixtures';
import {
  TILE,
  TILE_COLORS,
  createStripAtlas,
  nodeCanvasFactory,
  createTargetCanvas,
  opaqueBounds,
  canvasBytes,
  pixelAt,
} from './terrain-piece-canvas-fixtures';

const { atlas, image } = createStripAtlas();
const BAKE = { atlas, image, createCanvas: nodeCanvasFactory } as const;

/** A 4-cell strip: [left-end, middle, middle, right-end] → 64×16. */
const STRIP_CELLS = 4;
const FULL = STRIP_CELLS * TILE;

function bakeStrip(): BakedTerrainPiece {
  const piece: TerrainPiece = {
    id: 'strip',
    cells: Object.freeze({
      data: Object.freeze(new Array<number>(STRIP_CELLS).fill(1)),
      cols: STRIP_CELLS, rows: 1, tileSize: TILE,
    }) as TileGrid,
    originCol: 0, originRow: 0, bondPolicy: 'free',
  };
  const baked = bakeTerrainPiece(resolveTerrainPiece(piece, STONE_KINDS, STRIP_RULE_SET), BAKE);
  if (baked === undefined) throw new Error('bake failed');
  return baked;
}

const baked = bakeStrip();

/** Draw one clipped step onto a fresh 128×64 target at (32, 16). */
function drawStep(anchor: TerrainPieceAnchor, extent: number) {
  const target = createTargetCanvas(128, 64);
  const context = target.getContext('2d')!;
  const drew = drawClippedTerrainPiece(context, baked, anchor, extent, 32, 16);
  return { target, context, drew, bounds: opaqueBounds(target) };
}

describe('drawClippedTerrainPiece — visible extent at every step', () => {
  it('shrinks horizontally, pinned at the left wall', () => {
    for (let extent = TILE; extent <= FULL; extent += TILE) {
      const { bounds } = drawStep('left', extent);
      expect(bounds.width).toBe(extent);
      expect(bounds.x).toBe(32); // wall face never moves
    }
  });

  it('shrinks horizontally, pinned at the right wall', () => {
    for (let extent = TILE; extent <= FULL; extent += TILE) {
      const { bounds } = drawStep('right', extent);
      expect(bounds.width).toBe(extent);
      // Right edge stays at the wall: 32 + 64 = 96, so x slides right.
      expect(bounds.x + bounds.width).toBe(32 + FULL);
    }
  });

  it('shrinks vertically for top and bottom anchors', () => {
    // A 1-row strip is 16px tall, so vertical clipping steps in pixels.
    for (let extent = 4; extent <= TILE; extent += 4) {
      const top = drawStep('top', extent);
      expect(top.bounds.height).toBe(extent);
      expect(top.bounds.y).toBe(16);

      const bottom = drawStep('bottom', extent);
      expect(bottom.bounds.height).toBe(extent);
      expect(bottom.bounds.y + bottom.bounds.height).toBe(16 + TILE);
    }
  });

  it('handles sub-tile extents, not just whole cells', () => {
    for (const extent of [1, 7, 13, 31, 63]) {
      expect(drawStep('left', extent).bounds.width).toBe(extent);
    }
  });
});

describe('drawClippedTerrainPiece — the free end keeps its cap', () => {
  it('left anchor reveals the piece right-to-left, showing the right cap', () => {
    // Retracted to one tile: the visible art is the piece's LAST cell, which is
    // the right-end cap. A retracting platform must not expose a raw edge.
    const { target } = drawStep('left', TILE);
    expect(pixelAt(target, 32 + TILE / 2, 16 + TILE / 2).slice(0, 3))
      .toEqual([...TILE_COLORS[2]]); // right-end
  });

  it('right anchor reveals the piece left-to-right, showing the left cap', () => {
    const { target } = drawStep('right', TILE);
    const cx = 32 + FULL - TILE / 2;
    expect(pixelAt(target, cx, 16 + TILE / 2).slice(0, 3))
      .toEqual([...TILE_COLORS[1]]); // left-end
  });

  it('fully extended shows both caps in place', () => {
    const { target } = drawStep('left', FULL);
    expect(pixelAt(target, 32 + TILE / 2, 24).slice(0, 3)).toEqual([...TILE_COLORS[1]]);
    expect(pixelAt(target, 32 + FULL - TILE / 2, 24).slice(0, 3)).toEqual([...TILE_COLORS[2]]);
  });
});

describe('drawClippedTerrainPiece — bounds and degradation', () => {
  it('draws nothing at or below zero extent', () => {
    for (const extent of [0, -1, -1000]) {
      const { drew, bounds } = drawStep('left', extent);
      expect(drew).toBe(false);
      expect(bounds.empty).toBe(true);
    }
  });

  it('clamps an over-large extent to the full piece', () => {
    const { bounds, drew } = drawStep('left', FULL * 10);
    expect(drew).toBe(true);
    expect(bounds.width).toBe(FULL);
  });

  it('never throws on bad input', () => {
    const context = createTargetCanvas(64, 64).getContext('2d')!;
    expect(drawClippedTerrainPiece(null as never, baked, 'left', 32, 0, 0)).toBe(false);
    expect(drawClippedTerrainPiece(context, null as never, 'left', 32, 0, 0)).toBe(false);
    expect(drawClippedTerrainPiece(context, baked, 'sideways' as never, 32, 0, 0)).toBe(false);
    expect(drawClippedTerrainPiece(context, baked, 'left', Number.NaN, 0, 0)).toBe(false);
    expect(drawClippedTerrainPiece(context, baked, 'left', 32, Number.NaN, 0)).toBe(false);
  });
});

describe('drawClippedTerrainPiece — leaks nothing', () => {
  it('does not mutate the baked canvas', () => {
    const before = canvasBytes(baked.canvas);
    for (let extent = 0; extent <= FULL; extent += 8) drawStep('left', extent);
    expect(canvasBytes(baked.canvas)).toEqual(before);
  });

  it('restores the clip region so later draws are not cropped', () => {
    // A leaked clip is silent and catastrophic: every subsequent draw in the
    // frame gets cropped to the retracting platform's window.
    const target = createTargetCanvas(128, 64);
    const context = target.getContext('2d')!;
    drawClippedTerrainPiece(context, baked, 'left', TILE, 32, 16);
    context.fillStyle = '#ff00ff';
    context.fillRect(0, 48, 128, 8); // well outside the clip window
    expect(pixelAt(target, 4, 52).slice(0, 3)).toEqual([255, 0, 255]);
  });

  it('restores the clip even when the blit fails', () => {
    const target = createTargetCanvas(128, 64);
    const context = target.getContext('2d')!;
    const exploding = { ...baked, canvas: { width: 64, height: 16, getContext: () => null } };
    const original = context.drawImage.bind(context);
    (context as unknown as { drawImage: () => void }).drawImage = () => { throw new Error('blit failed'); };
    expect(drawClippedTerrainPiece(context, exploding as never, 'left', TILE, 32, 16)).toBe(false);
    (context as unknown as { drawImage: typeof original }).drawImage = original;
    context.fillStyle = '#00ffff';
    context.fillRect(0, 48, 128, 8);
    expect(pixelAt(target, 4, 52).slice(0, 3)).toEqual([0, 255, 255]);
  });
});

describe('drawClippedTerrainPiece — a full retract, one bake', () => {
  it('runs a whole retract sequence from a single baked canvas', () => {
    const before = canvasBytes(baked.canvas);
    const widths: number[] = [];
    for (let extent = FULL; extent >= 0; extent -= 8) {
      widths.push(drawStep('left', extent).bounds.width);
    }
    expect(widths).toEqual([64, 56, 48, 40, 32, 24, 16, 8, 0]);
    // The whole animation played without re-tiling or re-baking anything.
    expect(canvasBytes(baked.canvas)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Mask variant — texture pinned, end eroded
// ---------------------------------------------------------------------------

/** A single-cell piece, baked. Resolves to `single` (red) — a visible cap. */
function bakeCap(): BakedTerrainPiece {
  const piece: TerrainPiece = {
    id: 'cap',
    cells: Object.freeze({ data: Object.freeze([1]), cols: 1, rows: 1, tileSize: TILE }) as TileGrid,
    originCol: 0, originRow: 0, bondPolicy: 'free',
  };
  const out = bakeTerrainPiece(resolveTerrainPiece(piece, STONE_KINDS, STRIP_RULE_SET), BAKE);
  if (out === undefined) throw new Error('cap bake failed');
  return out;
}
const cap = bakeCap();

function drawMasked(anchor: TerrainPieceAnchor, extent: number, withCap = false) {
  const target = createTargetCanvas(128, 64);
  const context = target.getContext('2d')!;
  const drew = drawMaskedTerrainPiece(
    context, baked, anchor, extent, 32, 16, withCap ? cap : undefined,
  );
  return { target, drew, bounds: opaqueBounds(target) };
}

describe('drawMaskedTerrainPiece — the texture stays pinned', () => {
  it('reveals the NEAR portion, where slide reveals the far portion', () => {
    // This is the whole difference between the two helpers, in one assertion.
    // Same anchor, same extent, opposite art.
    const masked = drawMasked('left', TILE);
    expect(pixelAt(masked.target, 32 + TILE / 2, 24).slice(0, 3))
      .toEqual([...TILE_COLORS[1]]); // left-end — the piece's FIRST cell

    const slid = drawStep('left', TILE);
    expect(pixelAt(slid.target, 32 + TILE / 2, 24).slice(0, 3))
      .toEqual([...TILE_COLORS[2]]); // right-end — the piece's LAST cell
  });

  it('does not move the surviving art as it erodes', () => {
    // Cell 0 must stay cell 0 at every extent — that is "pinned".
    for (const extent of [FULL, 48, 32, 20]) {
      const { target } = drawMasked('left', extent);
      expect(pixelAt(target, 32 + TILE / 2, 24).slice(0, 3)).toEqual([...TILE_COLORS[1]]);
    }
  });

  it('measures extent from the anchored edge, for every anchor', () => {
    for (let extent = TILE; extent <= FULL; extent += TILE) {
      expect(drawMasked('left', extent).bounds.width).toBe(extent);
      const right = drawMasked('right', extent).bounds;
      expect(right.width).toBe(extent);
      expect(right.x + right.width).toBe(32 + FULL);
    }
    for (const extent of [4, 8, 12, TILE]) {
      expect(drawMasked('top', extent).bounds.height).toBe(extent);
      expect(drawMasked('bottom', extent).bounds.height).toBe(extent);
    }
  });
});

describe('drawMaskedTerrainPiece — the optional cap', () => {
  it('leaves a raw cut when no cap is supplied', () => {
    const { target } = drawMasked('left', 32);
    // Last surviving pixel column is plain body art, not a cap.
    expect(pixelAt(target, 32 + 31, 24).slice(0, 3)).toEqual([...TILE_COLORS[3]]); // middle
  });

  it('rides the eroding boundary when supplied', () => {
    for (const extent of [32, 40, 48]) {
      const { target } = drawMasked('left', extent, true);
      // The cap occupies the last tile before the cut, wherever the cut is.
      expect(pixelAt(target, 32 + extent - TILE / 2, 24).slice(0, 3))
        .toEqual([...TILE_COLORS[0]]); // 'single' — the cap
      // ...and the art before the cap is untouched body.
      expect(pixelAt(target, 32 + TILE / 2, 24).slice(0, 3)).toEqual([...TILE_COLORS[1]]);
    }
  });

  it('anchors the cap to the other side for a right-anchored piece', () => {
    const extent = 32;
    const { target } = drawMasked('right', extent, true);
    const cut = 32 + FULL - extent;
    expect(pixelAt(target, cut + TILE / 2, 24).slice(0, 3)).toEqual([...TILE_COLORS[0]]);
  });

  it('does not let the cap spill past the cut', () => {
    // Extent narrower than the cap: the cap is trimmed by the same clip, not
    // painted over the gap.
    const { bounds } = drawMasked('left', 6, true);
    expect(bounds.width).toBe(6);
  });

  it('adds no bakes — the cap is baked once and reused', () => {
    const before = canvasBytes(cap.canvas);
    for (let extent = FULL; extent > 0; extent -= 4) drawMasked('left', extent, true);
    expect(canvasBytes(cap.canvas)).toEqual(before);
  });
});

describe('drawMaskedTerrainPiece — bounds and leaks', () => {
  it('draws nothing at or below zero extent', () => {
    for (const extent of [0, -8]) {
      const { drew, bounds } = drawMasked('left', extent, true);
      expect(drew).toBe(false);
      expect(bounds.empty).toBe(true);
    }
  });

  it('clamps an over-large extent', () => {
    expect(drawMasked('left', FULL * 4).bounds.width).toBe(FULL);
  });

  it('never throws on bad input', () => {
    const context = createTargetCanvas(64, 64).getContext('2d')!;
    expect(drawMaskedTerrainPiece(null as never, baked, 'left', 32, 0, 0)).toBe(false);
    expect(drawMaskedTerrainPiece(context, null as never, 'left', 32, 0, 0)).toBe(false);
    expect(drawMaskedTerrainPiece(context, baked, 'nope' as never, 32, 0, 0)).toBe(false);
    expect(drawMaskedTerrainPiece(context, baked, 'left', Number.NaN, 0, 0)).toBe(false);
  });

  it('ignores an unusable cap rather than failing the whole draw', () => {
    const target = createTargetCanvas(128, 64);
    const context = target.getContext('2d')!;
    const drew = drawMaskedTerrainPiece(context, baked, 'left', 32, 32, 16, {} as never);
    expect(drew).toBe(true);
    expect(opaqueBounds(target).width).toBe(32);
  });

  it('restores the clip so later draws are not cropped', () => {
    const target = createTargetCanvas(128, 64);
    const context = target.getContext('2d')!;
    drawMaskedTerrainPiece(context, baked, 'left', TILE, 32, 16, cap);
    context.fillStyle = '#ff00ff';
    context.fillRect(0, 48, 128, 8);
    expect(pixelAt(target, 4, 52).slice(0, 3)).toEqual([255, 0, 255]);
  });

  it('does not mutate the baked body', () => {
    const before = canvasBytes(baked.canvas);
    for (let extent = 0; extent <= FULL; extent += 4) drawMasked('left', extent, true);
    expect(canvasBytes(baked.canvas)).toEqual(before);
  });
});
