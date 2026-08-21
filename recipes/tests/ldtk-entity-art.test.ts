import { describe, expect, it, vi } from 'vitest';
import type { CompiledLdtkRoom, LdtkTilesetBundle } from 'aicraft-engine';
import { ldtkEntityTileOverride } from '../ldtk-entity-art';

const drawImage = vi.fn();
const ctx = {
  save: vi.fn(),
  restore: vi.fn(),
  drawImage,
} as unknown as CanvasRenderingContext2D;

// One authored tile on tileset uid 7; the def's render mode was unresolvable
// (undefined → drawLdtkEntityTile's geometry heuristic, the intended fallback).
const room = {
  entityArt: new Map([
    [1, {
      tile: { tilesetUid: 7, x: 0, y: 0, w: 8, h: 8 },
      tileRenderMode: undefined,
      nineSliceBorders: null,
    }],
  ]),
} as unknown as CompiledLdtkRoom;

const tilesets = new Map([
  [7, { def: { tileGridSize: 8, __cWid: 1, padding: 0, spacing: 0 }, image: {} as CanvasImageSource }],
]) as unknown as LdtkTilesetBundle;

describe('ldtkEntityTileOverride', () => {
  it('draws an entity with authored art through the engine blit', () => {
    const overrides = ldtkEntityTileOverride(room, tilesets);
    const entity = { id: 1, rect: { x: 16, y: 24, width: 8, height: 8 } };
    // Same function routes every drawn kind — prove it on two of them.
    expect(overrides.hazard!(ctx, entity as never)).toBe(true);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(overrides.collectible!(ctx, entity as never)).toBe(true);
    expect(drawImage).toHaveBeenCalledTimes(2);
  });

  it('an entity with no authored art returns false — the engine shape draws it', () => {
    drawImage.mockClear();
    const overrides = ldtkEntityTileOverride(room, tilesets);
    const undressed = { id: 2, rect: { x: 0, y: 0, width: 8, height: 8 } };
    expect(overrides.spring!(ctx, undressed as never)).toBe(false);
    expect(drawImage).toHaveBeenCalledTimes(0);
  });

  it('routes EVERY override-map kind through the same rule', () => {
    const overrides = ldtkEntityTileOverride(room, tilesets);
    const entity = { id: 1, rect: { x: 0, y: 0, width: 8, height: 8 } } as never;
    const kinds = Object.keys(overrides) as (keyof typeof overrides)[];
    expect(kinds.length).toBeGreaterThanOrEqual(13);
    for (const kind of kinds) {
      expect(overrides[kind]!(ctx, entity)).toBe(true);
    }
  });
});
