import { describe, expect, it } from 'vitest';
import { createCanvas } from 'canvas';
import { drawLdtkLevel } from '../ldtk/render';
import type { LdtkTilesetBundle, LdtkTilesetImage } from '../ldtk/render';
import { createLdtkLevelSurfaceCache } from '../ldtk/surface';
import type { LdtkSurfaceCanvas } from '../ldtk/surface';
import type { LdtkLayerInstance, LdtkLevel } from '../ldtk/types';

/** Build a small 2x1 tileset canvas: tile 0 = red (left), tile 1 = green (right). */
function makeTileset(tileSize = 8): LdtkTilesetImage {
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

/** A 16x16 level with a red tile at (0,0) and a green tile at (8,0). */
function makeLevel(): LdtkLevel {
  return {
    identifier: 'L0',
    iid: 'l0',
    uid: 1,
    pxWid: 16,
    pxHei: 16,
    worldX: 0,
    worldY: 0,
    worldDepth: 0,
    fieldInstances: [],
    externalRelPath: null,
    __neighbours: [],
    layerInstances: [
      makeAutoLayer([
        { px: [0, 0], src: [0, 0], t: 0 },
        { px: [TILE_SIZE, 0], src: [TILE_SIZE, 0], t: 1 },
      ]),
    ],
  };
}

function ctx2d(w: number, h: number): CanvasRenderingContext2D {
  return createCanvas(w, h).getContext('2d') as unknown as CanvasRenderingContext2D;
}

function pixel(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
): [number, number, number, number] {
  const d = context.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

/** node-canvas's createCanvas adapted to the cache's factory signature. */
const factory = (w: number, h: number) =>
  createCanvas(w, h) as unknown as LdtkSurfaceCanvas;

describe('createLdtkLevelSurfaceCache', () => {
  it('draws pixel-identical to the direct drawLdtkLevel path', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const level = makeLevel();
    const surfaces = createLdtkLevelSurfaceCache({ createCanvas: factory });

    const viaSurface = ctx2d(16, 16);
    const direct = ctx2d(16, 16);
    const tiles = surfaces.draw(viaSurface, level, { tilesets: bundle });
    const directTiles = drawLdtkLevel(direct, level, { tilesets: bundle });

    expect(tiles).toBe(directTiles);
    expect(tiles).toBe(2);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        expect(pixel(viaSurface, x, y)).toEqual(pixel(direct, x, y));
      }
    }
  });

  it('bakes the surface at the level native pxWid x pxHei', () => {
    const ts = makeTileset(TILE_SIZE);
    const surfaces = createLdtkLevelSurfaceCache({ createCanvas: factory });
    const surface = surfaces.get(makeLevel(), makeBundle(ts));
    expect(surface).toBeDefined();
    // CanvasImageSource is a union (VideoFrame has no width/height), so probe
    // the dims through the structural shape every canvas host satisfies.
    const dims = surface as { width: number; height: number } | undefined;
    expect(dims?.width).toBe(16);
    expect(dims?.height).toBe(16);
  });

  it('reuses the same surface instance (no rebuild on later draws)', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const level = makeLevel();
    let builds = 0;
    const surfaces = createLdtkLevelSurfaceCache({
      createCanvas: (w, h) => {
        builds++;
        return factory(w, h);
      },
    });

    const first = surfaces.get(level, bundle);
    const ctxA = ctx2d(16, 16);
    const ctxB = ctx2d(16, 16);
    surfaces.draw(ctxA, level, { tilesets: bundle });
    surfaces.draw(ctxB, level, { tilesets: bundle });
    const second = surfaces.get(level, bundle);

    expect(builds).toBe(1);
    expect(first).toBe(second);
    expect(surfaces.has('l0')).toBe(true);
  });

  it('applies worldOffset to the single blit', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const level = makeLevel();
    const surfaces = createLdtkLevelSurfaceCache({ createCanvas: factory });

    const ctx = ctx2d(32, 32);
    const tiles = surfaces.draw(ctx, level, {
      tilesets: bundle,
      worldOffset: { x: 10, y: 10 },
    });
    expect(tiles).toBe(2);
    expect(pixel(ctx, 11, 11)).toEqual([255, 0, 0, 255]); // red tile, shifted
    expect(pixel(ctx, 1, 1)).toEqual([0, 0, 0, 0]); // origin empty now
  });

  it('drop(iid) forces a rebake; clear() drops every surface', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const level = makeLevel();
    let builds = 0;
    const surfaces = createLdtkLevelSurfaceCache({
      createCanvas: (w, h) => {
        builds++;
        return factory(w, h);
      },
    });

    const first = surfaces.get(level, bundle);
    surfaces.drop('l0');
    expect(surfaces.has('l0')).toBe(false);
    const second = surfaces.get(level, bundle);
    expect(builds).toBe(2);
    expect(second).not.toBe(first);

    surfaces.clear();
    expect(surfaces.has('l0')).toBe(false);
    surfaces.get(level, bundle);
    expect(builds).toBe(3);
  });

  it('falls back to the direct draw path when the factory returns undefined', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const level = makeLevel();
    const surfaces = createLdtkLevelSurfaceCache({
      createCanvas: () => undefined,
    });

    const ctx = ctx2d(16, 16);
    const tiles = surfaces.draw(ctx, level, { tilesets: bundle });
    // Still rendered (via drawLdtkLevel directly), just not cached.
    expect(tiles).toBe(2);
    expect(pixel(ctx, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(surfaces.has('l0')).toBe(false);
    expect(surfaces.get(level, bundle)).toBeUndefined();
  });

  it('never throws on malformed levels and caches nothing for them', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const surfaces = createLdtkLevelSurfaceCache({ createCanvas: factory });
    const ctx = ctx2d(16, 16);

    expect(
      surfaces.draw(ctx, null as unknown as LdtkLevel, { tilesets: bundle }),
    ).toBe(0);
    expect(surfaces.draw(ctx, {} as LdtkLevel, { tilesets: bundle })).toBe(0);
    // Zero pixel dimensions: no cacheable surface, so the direct path draws
    // (drawLdtkLevel itself ignores pxWid/pxHei — its tiles still render)…
    const zeroSized = { ...makeLevel(), pxWid: 0, pxHei: 0 } as LdtkLevel;
    expect(surfaces.draw(ctx, zeroSized, { tilesets: bundle })).toBe(2);
    // …but nothing is cached for it.
    expect(surfaces.has('l0')).toBe(false);
  });

  it('returns the baked tile count from every cached draw', () => {
    const ts = makeTileset(TILE_SIZE);
    const bundle = makeBundle(ts);
    const level = makeLevel();
    const surfaces = createLdtkLevelSurfaceCache({ createCanvas: factory });

    const first = surfaces.draw(ctx2d(16, 16), level, { tilesets: bundle });
    // A second draw — surface already baked — still reports the baked count.
    const second = surfaces.draw(ctx2d(16, 16), level, { tilesets: bundle });
    expect(first).toBe(2);
    expect(second).toBe(2);
  });
});
