import { describe, expect, it } from 'vitest';
import { createCanvas } from 'canvas';
import {
  buildLdtkTilesetBundle,
  drawLdtkLayer,
  drawLdtkLevel,
} from '../ldtk/render';
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
