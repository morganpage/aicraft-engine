import { describe, expect, it, vi } from 'vitest';
import {
  ldtkRuleSourceFromCsv,
  runLdtkAutoLayer,
  type LdtkRuleGridSource,
  type LdtkSurfaceCanvas,
  type LdtkTilesetDef,
  type LdtkTilesetImage,
} from 'aicraft-engine';
import { allOracleCases } from '../../src/tests/ldtk-fixtures';
import { bakeLdtkEntityTileArt } from '../ldtk-entity-tile-art';

// Recording canvas: a stub whose 2d context counts blits. The bake's RULE
// correctness is the engine oracle suite's job; this suite proves the
// recipe's wiring (stamp, window, crop, blit, degrade).
function recordingCanvas(width: number, height: number): LdtkSurfaceCanvas {
  // One memoized context per canvas — getContext must return the SAME
  // object the recipe drew on, or the test spies on a fresh no-op.
  const ctx = {
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
  };
  return {
    width,
    height,
    getContext: () => ctx as unknown as CanvasRenderingContext2D,
  };
}

/** Find an oracle case whose rules actually emit tiles for a center stamp. */
function usableCase() {
  for (const c of allOracleCases()) {
    const gridSize = c.layer.__gridSize;
    const value = c.layerDef.intGridValues?.[0]?.value ?? 1;
    if (!(gridSize > 0) || c.cols < 4 || c.rows < 4) continue;
    const tx = Math.floor(c.cols / 2);
    const ty = Math.floor(c.rows / 2);
    const base = ldtkRuleSourceFromCsv(c.intGrid, c.cols, c.rows, c.layerDef);
    const stamped: LdtkRuleGridSource = {
      cols: base.cols,
      rows: base.rows,
      groupOf: (v) => base.groupOf(v),
      valueAt: (cx, cy) =>
        cx >= tx && cx < tx + 2 && cy >= ty && cy < ty + 2 ? value : base.valueAt(cx, cy),
    };
    const tiles = runLdtkAutoLayer(stamped, c.layerDef, {
      seed: 0,
      gridSize,
      region: { cx: tx, cy: ty, cols: 2, rows: 2 },
      tileset: c.tileset,
    });
    if (tiles.length > 0) {
      const tileset: LdtkTilesetImage = {
        image: {} as CanvasImageSource,
        def: {
          __cWid: c.tileset.cWid,
          tileGridSize: c.tileset.tileGridSize,
          padding: c.tileset.padding,
          spacing: c.tileset.spacing,
        } as unknown as LdtkTilesetDef,
      };
      return { c, gridSize, value, tx, ty, base, tiles, tileset };
    }
  }
  return undefined;
}

describe('bakeLdtkEntityTileArt', () => {
  it('bakes a stamped 2×2 footprint from a real oracle project', () => {
    const usable = usableCase();
    if (usable === undefined) return; // no fixture stamps — nothing to prove
    const canvas = bakeLdtkEntityTileArt({
      source: usable.base,
      layerDef: usable.c.layerDef,
      tileset: usable.tileset,
      gridSize: usable.gridSize,
      footprint: { tx: usable.tx, ty: usable.ty, w: 2, h: 2 },
      value: usable.value,
      createCanvas: recordingCanvas,
    });
    expect(canvas).toBeDefined();
    expect(canvas!.width).toBe(2 * usable.gridSize);
    expect(canvas!.height).toBe(2 * usable.gridSize);
    const ctx = canvas!.getContext('2d') as unknown as { drawImage: ReturnType<typeof vi.fn> };
    expect(ctx.drawImage.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('degrades to undefined on invalid value / footprint / host', () => {
    const usable = usableCase();
    if (usable === undefined) return;
    const common = {
      source: usable.base,
      layerDef: usable.c.layerDef,
      tileset: usable.tileset,
      gridSize: usable.gridSize,
    };
    expect(
      bakeLdtkEntityTileArt({ ...common, footprint: { tx: 1, ty: 1, w: 2, h: 2 }, value: 0, createCanvas: recordingCanvas }),
    ).toBeUndefined();
    expect(
      bakeLdtkEntityTileArt({ ...common, footprint: { tx: 1, ty: 1, w: 0, h: 2 }, value: usable.value, createCanvas: recordingCanvas }),
    ).toBeUndefined();
    // No canvas factory and no OffscreenCanvas/document in the Node host.
    expect(
      bakeLdtkEntityTileArt({ ...common, footprint: { tx: 1, ty: 1, w: 2, h: 2 }, value: usable.value }),
    ).toBeUndefined();
  });
});
