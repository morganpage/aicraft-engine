import { describe, expect, it } from 'vitest';
import { createCanvas } from 'canvas';
import {
  buildLdtkTilesetBundle,
  drawLdtkEntityTile,
  drawLdtkLayer,
  drawLdtkLevel,
} from '../ldtk/render';
import { parseLdtkProject } from '../ldtk/parse';
import type { LdtkTilesetBundle, LdtkTilesetImage } from '../ldtk/render';
import type { LdtkLayerInstance, LdtkLevel } from '../ldtk/types';

/** Build a small 2x1 tileset canvas: tile 0 = red (left), tile 1 = green (right). */
function makeTileset(tileSize = 8): LdtkTilesetImage & { canvas: ReturnType<typeof createCanvas> } {
  const canvas = createCanvas(tileSize * 2, tileSize);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, tileSize, tileSize);
  ctx.fillStyle = '#00ff00';
  ctx.fillRect(tileSize, 0, tileSize, tileSize);
  return {
    def: {
      identifier: 'Test',
      uid: 1,
      relPath: 'test.png',
      pxWid: tileSize * 2,
      pxHei: tileSize,
      tileGridSize: tileSize,
      padding: 0,
      spacing: 0,
      __cWid: 2,
      __cHei: 1,
      embedAtlas: null,
    },
    image: canvas as unknown as CanvasImageSource,
    canvas,
  };
}

function makeBundle(image: LdtkTilesetImage): LdtkTilesetBundle {
  return new Map([[image.def.uid, image]]);
}

const TILE_SIZE = 8;

function makeAutoLayer(tiles: Readonly<LdtkLayerInstance>['autoLayerTiles']): LdtkLayerInstance {
  return {
    __type: 'AutoLayer',
    __identifier: 'Auto',
    __cWid: 4,
    __cHei: 4,
    __gridSize: TILE_SIZE,
    __opacity: 1,
    __pxTotalOffsetX: 0,
    __pxTotalOffsetY: 0,
    visible: true,
    iid: 'l',
    levelId: 'lvl',
    layerDefUid: 1,
    autoLayerTiles: tiles,
    __tilesetDefUid: 1,
    __tilesetRelPath: 'test.png',
  };
}

function ctx2d(w: number, h: number): CanvasRenderingContext2D {
  return createCanvas(w, h).getContext('2d') as unknown as CanvasRenderingContext2D;
}

function pixel(context: CanvasRenderingContext2D, x: number, y: number): [number, number, number, number] {
  const d = context.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

describe('drawLdtkLayer', () => {
  it('blits a tile from the tileset source rect to the layer destination', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const layer = makeAutoLayer([{ px: [0, 0], src: [0, 0], t: 0 }]); // red tile to (0,0)
    const ctx = ctx2d(16, 16);
    const drawn = drawLdtkLayer(ctx, layer, { tilesets: bundle });
    expect(drawn).toBe(1);
    expect(pixel(ctx, 1, 1)).toEqual([255, 0, 0, 255]);
  });

  it('draws the green tile when src points at the second tile', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const layer = makeAutoLayer([{ px: [0, 0], src: [TILE_SIZE, 0], t: 1 }]);
    const ctx = ctx2d(16, 16);
    drawLdtkLayer(ctx, layer, { tilesets: bundle });
    expect(pixel(ctx, 1, 1)).toEqual([0, 255, 0, 255]);
  });

  it('flips a tile horizontally when f bit 0 is set', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    // Make the red tile have a distinct left/right: left half red, right half blue.
    const tctx = ts.canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    tctx.fillStyle = '#0000ff';
    tctx.fillRect(TILE_SIZE / 2, 0, TILE_SIZE / 2, TILE_SIZE);
    // Unflipped: left=red, right=blue.
    const layerNormal = makeAutoLayer([{ px: [0, 0], src: [0, 0], t: 0, f: 0 }]);
    const ctxN = ctx2d(16, 16);
    drawLdtkLayer(ctxN, layerNormal, { tilesets: bundle });
    expect(pixel(ctxN, 1, 1)[0]).toBe(255); // red at left
    expect(pixel(ctxN, TILE_SIZE - 2, 1)[2]).toBe(255); // blue at right
    // Flipped X: left=blue, right=red.
    const layerFlip = makeAutoLayer([{ px: [0, 0], src: [0, 0], t: 0, f: 1 }]);
    const ctxF = ctx2d(16, 16);
    drawLdtkLayer(ctxF, layerFlip, { tilesets: bundle });
    expect(pixel(ctxF, 1, 1)[2]).toBe(255); // blue now at left
    expect(pixel(ctxF, TILE_SIZE - 2, 1)[0]).toBe(255); // red now at right
  });

  it('multiplies global alpha by the tile alpha', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const layer = makeAutoLayer([{ px: [0, 0], src: [0, 0], t: 0, a: 0.5 }]);
    const ctx = ctx2d(16, 16);
    drawLdtkLayer(ctx, layer, { tilesets: bundle });
    // The result alpha should be ~127 (255 * 0.5). RGB from the opaque
    // source stays 255 in node-canvas's premultiplied compositing.
    const [, , , a] = pixel(ctx, 1, 1);
    expect(a).toBeGreaterThanOrEqual(118);
    expect(a).toBeLessThanOrEqual(138);
  });

  it('skips tiles entirely when tile.a is 0', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const layer = makeAutoLayer([{ px: [0, 0], src: [0, 0], t: 0, a: 0 }]);
    const ctx = ctx2d(16, 16);
    const drawn = drawLdtkLayer(ctx, layer, { tilesets: bundle });
    expect(drawn).toBe(0);
    expect(pixel(ctx, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it('respects layer.visible === false (draws nothing)', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const layer = makeAutoLayer([{ px: [0, 0], src: [0, 0], t: 0 }]);
    (layer as { visible: boolean }).visible = false;
    const ctx = ctx2d(16, 16);
    expect(drawLdtkLayer(ctx, layer, { tilesets: bundle })).toBe(0);
  });

  it('skips layers whose tileset uid is not in the bundle', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const layer = makeAutoLayer([{ px: [0, 0], src: [0, 0], t: 0 }]);
    (layer as { __tilesetDefUid: number }).__tilesetDefUid = 999; // unknown uid
    const ctx = ctx2d(16, 16);
    expect(drawLdtkLayer(ctx, layer, { tilesets: bundle })).toBe(0);
  });

  it('culls tiles outside the viewport', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const layer = makeAutoLayer([
      { px: [0, 0], src: [0, 0], t: 0 },   // at origin
      { px: [100, 100], src: [0, 0], t: 0 }, // far outside
    ]);
    const ctx = ctx2d(32, 32);
    const drawn = drawLdtkLayer(ctx, layer, {
      tilesets: bundle,
      view: { x: 0, y: 0, width: 32, height: 32 },
    });
    expect(drawn).toBe(1);
    expect(pixel(ctx, 1, 1)).toEqual([255, 0, 0, 255]); // first tile drawn
    expect(pixel(ctx, 100, 100)).toEqual([0, 0, 0, 0]); // second culled
  });
});

describe('drawLdtkLevel', () => {
  it('draws back-to-front, so the first layer in the array wins', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const level: LdtkLevel = {
      identifier: 'L0', iid: 'l0', uid: 1, pxWid: 16, pxHei: 16,
      worldX: 0, worldY: 0, worldDepth: 0, fieldInstances: [], externalRelPath: null, __neighbours: [],
      // LDtk sorts `layerInstances` in display order: index 0 is the top-most
      // layer and the last entry is furthest back. Painting them in array
      // order would draw the background over everything.
      layerInstances: [
        // Top: green tile — must end up visible.
        makeAutoLayer([{ px: [0, 0], src: [TILE_SIZE, 0], t: 1 }]),
        // Behind it: red tile at the same spot.
        makeAutoLayer([{ px: [0, 0], src: [0, 0], t: 0 }]),
      ],
    };
    const ctx = ctx2d(16, 16);
    const drawn = drawLdtkLevel(ctx, level, { tilesets: bundle });
    expect(drawn).toBe(2);
    expect(pixel(ctx, 1, 1)).toEqual([0, 255, 0, 255]);
  });

  it('draws a rule-driven IntGrid layer, which carries its own autoLayerTiles', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    // An IntGrid layer with auto-rules bakes tiles just like an AutoLayer, and
    // is frequently a level's primary terrain art.
    const layer: LdtkLayerInstance = {
      ...makeAutoLayer([{ px: [0, 0], src: [0, 0], t: 0 }]),
      __type: 'IntGrid',
      intGridCsv: [1],
    };
    const ctx = ctx2d(16, 16);
    expect(drawLdtkLayer(ctx, layer, { tilesets: bundle })).toBe(1);
    expect(pixel(ctx, 1, 1)).toEqual([255, 0, 0, 255]);
  });

  it('never draws an Entities layer', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const layer: LdtkLayerInstance = {
      ...makeAutoLayer([{ px: [0, 0], src: [0, 0], t: 0 }]),
      __type: 'Entities',
    };
    const ctx = ctx2d(16, 16);
    expect(drawLdtkLayer(ctx, layer, { tilesets: bundle })).toBe(0);
    expect(pixel(ctx, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it('applies the world offset to every layer', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const level: LdtkLevel = {
      identifier: 'L0', iid: 'l0', uid: 1, pxWid: 16, pxHei: 16,
      worldX: 0, worldY: 0, worldDepth: 0, fieldInstances: [], externalRelPath: null, __neighbours: [],
      layerInstances: [makeAutoLayer([{ px: [0, 0], src: [0, 0], t: 0 }])],
    };
    const ctx = ctx2d(32, 32);
    drawLdtkLevel(ctx, level, { tilesets: bundle, worldOffset: { x: 10, y: 10 } });
    expect(pixel(ctx, 11, 11)).toEqual([255, 0, 0, 255]);
    expect(pixel(ctx, 1, 1)).toEqual([0, 0, 0, 0]); // origin empty now
  });

  it('returns 0 for a level with no layers (externalLevels case)', () => {
    const ts = makeTileset(TILE_SIZE);
    const level: LdtkLevel = {
      identifier: 'L0', iid: 'l0', uid: 1, pxWid: 16, pxHei: 16,
      worldX: 0, worldY: 0, worldDepth: 0, fieldInstances: [], externalRelPath: 'l0.ldtkl', __neighbours: [],
      layerInstances: null,
    };
    const ctx = ctx2d(16, 16);
    expect(drawLdtkLevel(ctx, level, { tilesets: makeBundle(ts) })).toBe(0);
  });

  it('never throws on malformed input', () => {
    const ctx = ctx2d(16, 16);
    expect(drawLdtkLevel(ctx, null as unknown as LdtkLevel, { tilesets: new Map() })).toBe(0);
    expect(drawLdtkLevel(ctx, {} as LdtkLevel, { tilesets: new Map() })).toBe(0);
  });
});

describe('buildLdtkTilesetBundle', () => {
  it('includes real tilesets and skips the LdtkIcons embedAtlas', () => {
    const ts = makeTileset(TILE_SIZE);
    const icon = {
      ...ts.def,
      identifier: 'Icons',
      uid: 2,
      relPath: null,
      embedAtlas: 'LdtkIcons' as const,
    };
    const bundle = buildLdtkTilesetBundle([ts.def, icon], () => ts.image);
    expect(bundle.has(1)).toBe(true);
    expect(bundle.has(2)).toBe(false);
  });

  it('skips tilesets whose loader returns undefined', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = buildLdtkTilesetBundle([ts.def], () => undefined);
    expect(bundle.size).toBe(0);
  });
});

describe('drawLdtkEntityTile', () => {
  const RED_TILE = { tilesetUid: 1, x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE };

  /** First tile painted left-red / right-blue so scaled and clipped draws are tellable apart. */
  function makeTwoToneTileset(): LdtkTilesetBundle {
    const ts = makeTileset(TILE_SIZE);
    const tctx = ts.canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    tctx.fillStyle = '#0000ff';
    tctx.fillRect(TILE_SIZE / 2, 0, TILE_SIZE / 2, TILE_SIZE);
    return makeBundle(ts);
  }

  it('Repeat tiles a 40x8 strip over the 8x8 tile into five tiles', () => {
    const bundle = makeBundle(makeTileset(TILE_SIZE));
    const ctx = ctx2d(48, 8);
    expect(drawLdtkEntityTile(ctx, RED_TILE, { x: 0, y: 0, width: 40, height: 8 }, bundle, 'Repeat')).toBe(true);
    for (const x of [1, 9, 17, 25, 33, 39]) {
      expect(pixel(ctx, x, 1)).toEqual([255, 0, 0, 255]);
    }
  });

  it('Repeat clips the last partial column from the SOURCE rect, not by smearing', () => {
    const bundle = makeTwoToneTileset();
    const ctx = ctx2d(16, 8);
    // 12 wide = one full tile + a 4px partial column.
    expect(drawLdtkEntityTile(ctx, RED_TILE, { x: 0, y: 0, width: 12, height: 8 }, bundle, 'Repeat')).toBe(true);
    expect(pixel(ctx, 1, 1)).toEqual([255, 0, 0, 255]);   // full tile, left half
    expect(pixel(ctx, 7, 1)).toEqual([0, 0, 255, 255]);   // full tile, right half
    expect(pixel(ctx, 11, 1)).toEqual([255, 0, 0, 255]);  // partial column = SOURCE pixels 0-3
    expect(pixel(ctx, 12, 1)).toEqual([0, 0, 0, 0]);      // nothing past the rect
  });

  it('Stretch fills the rect with one scaled blit', () => {
    const bundle = makeTwoToneTileset();
    const ctx = ctx2d(16, 8);
    expect(drawLdtkEntityTile(ctx, RED_TILE, { x: 0, y: 0, width: 16, height: 8 }, bundle, 'Stretch')).toBe(true);
    expect(pixel(ctx, 1, 1)).toEqual([255, 0, 0, 255]);   // source left half
    expect(pixel(ctx, 14, 1)).toEqual([0, 0, 255, 255]);  // source right half covers dest x >= 8
  });

  it('FitInside letterboxes: aspect-preserving and centered', () => {
    const bundle = makeBundle(makeTileset(TILE_SIZE));
    const ctx = ctx2d(16, 8);
    expect(drawLdtkEntityTile(ctx, RED_TILE, { x: 0, y: 0, width: 16, height: 8 }, bundle, 'FitInside')).toBe(true);
    expect(pixel(ctx, 1, 1)).toEqual([0, 0, 0, 0]);        // letterbox left
    expect(pixel(ctx, 5, 1)).toEqual([255, 0, 0, 255]);    // centered 8x8 blit
    expect(pixel(ctx, 14, 1)).toEqual([0, 0, 0, 0]);       // letterbox right
  });

  it('Cover fills the rect and clips to it', () => {
    const bundle = makeBundle(makeTileset(TILE_SIZE));
    const ctx = ctx2d(16, 12);
    expect(drawLdtkEntityTile(ctx, RED_TILE, { x: 0, y: 0, width: 16, height: 8 }, bundle, 'Cover')).toBe(true);
    expect(pixel(ctx, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixel(ctx, 14, 7)).toEqual([255, 0, 0, 255]);
    expect(pixel(ctx, 1, 9)).toEqual([0, 0, 0, 0]);        // clipped below the rect
  });

  it('omitted mode uses the geometry heuristic: oversized repeats, undersized blits', () => {
    const bundle = makeBundle(makeTileset(TILE_SIZE));
    const big = ctx2d(24, 8);
    expect(drawLdtkEntityTile(big, RED_TILE, { x: 0, y: 0, width: 24, height: 8 }, bundle)).toBe(true);
    expect(pixel(big, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixel(big, 23, 1)).toEqual([255, 0, 0, 255]);   // third repeat tile, not a smear
    const small = ctx2d(8, 8);
    expect(drawLdtkEntityTile(small, RED_TILE, { x: 0, y: 0, width: 4, height: 8 }, bundle)).toBe(true);
    expect(pixel(small, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixel(small, 5, 1)).toEqual([0, 0, 0, 0]);
  });

  it('NineSlice WITHOUT borders falls back to the geometry heuristic (a def that lost its borders)', () => {
    const bundle = makeBundle(makeTileset(TILE_SIZE));
    const ctx = ctx2d(24, 8);
    expect(drawLdtkEntityTile(ctx, RED_TILE, { x: 0, y: 0, width: 24, height: 8 }, bundle, 'NineSlice')).toBe(true);
    expect(pixel(ctx, 23, 1)).toEqual([255, 0, 0, 255]); // repeated across, not one smear
  });

  it('returns false (and draws nothing) for an unknown tileset uid, empty bundle, or degenerate rects', () => {
    const bundle = makeBundle(makeTileset(TILE_SIZE));
    const ctx = ctx2d(16, 8);
    const dest = { x: 0, y: 0, width: 8, height: 8 };
    expect(drawLdtkEntityTile(ctx, { ...RED_TILE, tilesetUid: 999 }, dest, bundle, 'Repeat')).toBe(false);
    expect(drawLdtkEntityTile(ctx, RED_TILE, dest, new Map())).toBe(false);
    expect(drawLdtkEntityTile(ctx, { ...RED_TILE, w: 0 }, dest, bundle)).toBe(false);
    expect(drawLdtkEntityTile(ctx, RED_TILE, { x: 0, y: 0, width: 0, height: 8 }, bundle)).toBe(false);
    expect(drawLdtkEntityTile(null as unknown as CanvasRenderingContext2D, RED_TILE, dest, bundle)).toBe(false);
    expect(pixel(ctx, 1, 1)).toEqual([0, 0, 0, 0]);
  });


  // ---------------------------------------------------------------------
  // NineSlice + FullSize* (0.17.0). The 3x3 helper paints nine distinct
  // colors into one tile so every slice is identifiable in the output.
  // ---------------------------------------------------------------------
  const NINE = {
    tl: [255, 0, 0], tr: [0, 255, 0], bl: [0, 0, 255], br: [255, 255, 0],
    top: [255, 0, 255], bottom: [0, 255, 255], left: [255, 128, 0],
    right: [128, 0, 255], center: [255, 255, 255],
  } as const;
  const rgba = (c: readonly number[]): [number, number, number, number] => [c[0], c[1], c[2], 255];

  /** One 8x8 tile, borders [2,2,2,2], nine distinct slice colors. */
  function makeNineSliceTileset(): LdtkTilesetBundle {
    const ts = makeTileset(TILE_SIZE); // start from tile0=red / tile1=green
    const tctx = ts.canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    const paint = (x: number, y: number, w: number, h: number, c: readonly number[]) => {
      tctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      tctx.fillRect(x, y, w, h);
    };
    // Overwrite tile 0 entirely with the 3x3 layout (border size 2 on 8px).
    paint(0, 0, 8, 8, NINE.center);
    paint(0, 0, 2, 2, NINE.tl); paint(6, 0, 2, 2, NINE.tr);
    paint(0, 6, 2, 2, NINE.bl); paint(6, 6, 2, 2, NINE.br);
    paint(2, 0, 4, 2, NINE.top); paint(2, 6, 4, 2, NINE.bottom);
    paint(0, 2, 2, 4, NINE.left); paint(6, 2, 2, 4, NINE.right);
    return makeBundle(ts);
  }

  it('NineSlice stretches edges one axis and the center both; corners stay 1:1', () => {
    const bundle = makeNineSliceTileset();
    const ctx = ctx2d(12, 16);
    expect(drawLdtkEntityTile(ctx, RED_TILE, { x: 0, y: 0, width: 12, height: 16 }, bundle, 'NineSlice', [2, 2, 2, 2])).toBe(true);
    expect(pixel(ctx, 1, 1)).toEqual(rgba(NINE.tl));
    expect(pixel(ctx, 10, 1)).toEqual(rgba(NINE.tr));
    expect(pixel(ctx, 1, 14)).toEqual(rgba(NINE.bl));
    expect(pixel(ctx, 10, 14)).toEqual(rgba(NINE.br));
    expect(pixel(ctx, 5, 1)).toEqual(rgba(NINE.top));     // stretched to 8 wide
    expect(pixel(ctx, 1, 7)).toEqual(rgba(NINE.left));    // stretched to 12 tall
    expect(pixel(ctx, 5, 7)).toEqual(rgba(NINE.center));  // stretched both
  });

  it('NineSlice skips zero-span slices instead of throwing (the Door case, scaled: 4 wide against 2+2 borders)', () => {
    // dest.width 4 with borders 2+2 → the center and the horizontal edge
    // strips have zero DEST width and are skipped; the side edges still
    // stretch the full height (their source spans stay positive — the
    // in-repo Door is 12 wide against 6+6 over a 16px tile, same shape).
    // A zero-size drawImage THROWS — this must not.
    const bundle = makeNineSliceTileset();
    const ctx = ctx2d(4, 16);
    expect(drawLdtkEntityTile(ctx, RED_TILE, { x: 0, y: 0, width: 4, height: 16 }, bundle, 'NineSlice', [2, 2, 2, 2])).toBe(true);
    expect(pixel(ctx, 0, 1)).toEqual(rgba(NINE.tl));
    expect(pixel(ctx, 3, 1)).toEqual(rgba(NINE.tr));
    expect(pixel(ctx, 0, 7)).toEqual(rgba(NINE.left));    // side edge survives
    expect(pixel(ctx, 3, 7)).toEqual(rgba(NINE.right));   // side edge survives
  });

  it('NineSlice clamps borders past half the rect (odd under-size)', () => {
    // borders 2 on a 3-wide rect clamp to 1 → corners squash 2px→1px but
    // every span stays positive; the center keeps a 1px column.
    const bundle = makeNineSliceTileset();
    const ctx = ctx2d(3, 16);
    expect(drawLdtkEntityTile(ctx, RED_TILE, { x: 0, y: 0, width: 3, height: 16 }, bundle, 'NineSlice', [2, 2, 2, 2])).toBe(true);
    expect(pixel(ctx, 0, 1)).toEqual(rgba(NINE.tl));      // 1px squashed corner
    expect(pixel(ctx, 2, 1)).toEqual(rgba(NINE.tr));
    expect(pixel(ctx, 1, 7)).toEqual(rgba(NINE.center));  // clamped-but-positive center
  });

  it('FullSizeCropped draws the tile at NATIVE size, clipped to the rect', () => {
    const bundle = makeBundle(makeTileset(TILE_SIZE));
    const ctx = ctx2d(8, 8);
    expect(drawLdtkEntityTile(ctx, RED_TILE, { x: 0, y: 0, width: 4, height: 4 }, bundle, 'FullSizeCropped')).toBe(true);
    expect(pixel(ctx, 1, 1)).toEqual([255, 0, 0, 255]);   // native 8x8 centered over the 4x4 rect
    expect(pixel(ctx, 5, 5)).toEqual([0, 0, 0, 0]);       // clipped outside the rect
  });

  it('FullSizeUncropped overflows the rect at native size', () => {
    const bundle = makeBundle(makeTileset(TILE_SIZE));
    const ctx = ctx2d(8, 8);
    expect(drawLdtkEntityTile(ctx, RED_TILE, { x: 0, y: 0, width: 4, height: 4 }, bundle, 'FullSizeUncropped')).toBe(true);
    // Native 8x8 centered over the 4x4 rect covers -2..5 on each axis.
    expect(pixel(ctx, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixel(ctx, 5, 5)).toEqual([255, 0, 0, 255]);   // outside the rect, NOT clipped
    expect(pixel(ctx, 6, 6)).toEqual([0, 0, 0, 0]);       // past the native-size image
  });
  it('pins the parsed default end-to-end: a def omitting tileRenderMode draws ONE centered blit, not a repeat run', () => {
    // Synthetic older-file shape: a tile-bearing def with the key absent (the
    // adversarial fixture has no tile-bearing defs, so this pin is synthetic
    // by necessity). The parsed default — 'FitInside' — must decide the draw:
    // a 40x8 instance letterboxes to one centered 8x8 blit. This test puts
    // that default choice on the record; if it looks wrong, change the parse
    // default, not this assertion.
    const { project } = parseLdtkProject(JSON.stringify({
      jsonVersion: '1.5.3',
      defs: { entities: [{
        identifier: 'Strip', uid: 1, renderMode: 'Tile',
        tileRect: { tilesetUid: 1, x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE },
        // no tileRenderMode key
      }] },
    }));
    const def = project!.defs.entities[0];
    expect(def.tileRenderMode).toBe('FitInside');
    const bundle = makeBundle(makeTileset(TILE_SIZE));
    const ctx = ctx2d(48, 8);
    expect(drawLdtkEntityTile(ctx, def.tileRect!, { x: 0, y: 0, width: 40, height: 8 }, bundle, def.tileRenderMode)).toBe(true);
    expect(pixel(ctx, 1, 1)).toEqual([0, 0, 0, 0]);        // no repeat run
    expect(pixel(ctx, 20, 1)).toEqual([255, 0, 0, 255]);   // the one centered blit
    expect(pixel(ctx, 39, 1)).toEqual([0, 0, 0, 0]);
  });
});
