/**
 * TE.2 prototype tests — bake-once + caller-owned transform.
 *
 * Validated against BOTH motion families the primitive must serve: the rigid
 * pair of a splitting pit, and N independently-falling crumble chunks.
 */

import { describe, it, expect } from 'vitest';
import type { TileGrid } from '../level/types';
import { resolveTerrainPiece, type TerrainPiece } from '../terrain-art/piece';
import {
  bakeTerrainPiece,
  createTerrainPieceCache,
  terrainPieceFingerprint,
} from '../terrain-art/piece-render';
import { STRIP_RULE_SET, STONE_KINDS } from './terrain-piece-fixtures';
import {
  TILE,
  TILE_COLORS,
  createStripAtlas,
  nodeCanvasFactory,
  pixelAt,
  canvasBytes,
} from './terrain-piece-canvas-fixtures';

const { atlas, image } = createStripAtlas();
const BAKE = { atlas, image, createCanvas: nodeCanvasFactory } as const;

const grid = (data: readonly number[], cols: number, rows: number): TileGrid =>
  Object.freeze({ data: Object.freeze(data), cols, rows, tileSize: TILE });

const freePiece = (id: string, cols: number): TerrainPiece => ({
  id,
  cells: grid(new Array<number>(cols).fill(1), cols, 1),
  originCol: 0,
  originRow: 0,
  bondPolicy: 'free',
});

const resolveFree = (cols: number) =>
  resolveTerrainPiece(freePiece('p', cols), STONE_KINDS, STRIP_RULE_SET);

/** Colour of the tile at cell `col`, sampled at the cell's centre. */
const colorOfCell = (canvas: Parameters<typeof pixelAt>[0], col: number): number[] =>
  pixelAt(canvas, col * TILE + TILE / 2, TILE / 2).slice(0, 3);

describe('bakeTerrainPiece — the caps are really painted', () => {
  it('bakes a 1x3 free strip as left-end / middle / right-end', () => {
    const baked = bakeTerrainPiece(resolveFree(3), BAKE);
    expect(baked).toBeDefined();
    expect(baked!.width).toBe(48);
    expect(baked!.height).toBe(16);
    expect(baked!.tiles).toBe(3);
    expect(colorOfCell(baked!.canvas, 0)).toEqual([...TILE_COLORS[1]]); // left-end
    expect(colorOfCell(baked!.canvas, 1)).toEqual([...TILE_COLORS[3]]); // middle
    expect(colorOfCell(baked!.canvas, 2)).toEqual([...TILE_COLORS[2]]); // right-end
  });

  it('bakes a single isolated cell as the single tile', () => {
    const baked = bakeTerrainPiece(resolveFree(1), BAKE);
    expect(colorOfCell(baked!.canvas, 0)).toEqual([...TILE_COLORS[0]]);
  });

  it('bakes at piece-local origin — no blank margin from world position', () => {
    // A bonded piece far along the field must still bake at 0,0.
    const field = grid(new Array<number>(9).fill(1), 9, 1);
    const piece: TerrainPiece = {
      id: 'far', cells: grid([1, 1, 1], 3, 1), originCol: 6, originRow: 0, bondPolicy: 'bonded',
    };
    const baked = bakeTerrainPiece(
      resolveTerrainPiece(piece, STONE_KINDS, STRIP_RULE_SET, field), BAKE,
    );
    expect(baked!.width).toBe(48);
    // Cell 0 is painted, not transparent — proves the re-base held through bake.
    expect(pixelAt(baked!.canvas, TILE / 2, TILE / 2)[3]).toBe(255);
  });
});

describe('bakeTerrainPiece — determinism', () => {
  it('bakes byte-identically twice', () => {
    const prepared = resolveFree(4);
    const a = bakeTerrainPiece(prepared, BAKE);
    const b = bakeTerrainPiece(prepared, BAKE);
    expect(canvasBytes(a!.canvas)).toEqual(canvasBytes(b!.canvas));
  });

  it('bakes byte-identically from independently-resolved equal pieces', () => {
    const a = bakeTerrainPiece(resolveFree(4), BAKE);
    const b = bakeTerrainPiece(resolveFree(4), BAKE);
    expect(canvasBytes(a!.canvas)).toEqual(canvasBytes(b!.canvas));
  });
});

describe('bakeTerrainPiece — never throws', () => {
  it('returns undefined for unusable input', () => {
    for (const bad of [null, undefined, {}, { cols: 0, rows: 0, tileSize: 0, tiles: [] }]) {
      expect(bakeTerrainPiece(bad as never, BAKE)).toBeUndefined();
    }
    expect(bakeTerrainPiece(resolveFree(3), null as never)).toBeUndefined();
  });

  it('returns undefined when no canvas host is available', () => {
    const baked = bakeTerrainPiece(resolveFree(3), { atlas, image, createCanvas: () => undefined });
    expect(baked).toBeUndefined();
  });

  it('survives a factory that throws', () => {
    const baked = bakeTerrainPiece(resolveFree(3), {
      atlas, image, createCanvas: () => { throw new Error('no host'); },
    });
    expect(baked).toBeUndefined();
  });
});

describe('terrainPieceFingerprint', () => {
  it('is stable for equal topology and differs for different topology', () => {
    expect(terrainPieceFingerprint(resolveFree(3))).toBe(terrainPieceFingerprint(resolveFree(3)));
    expect(terrainPieceFingerprint(resolveFree(3))).not.toBe(terrainPieceFingerprint(resolveFree(4)));
  });

  it('ignores piece position — moving a piece must not rebake it', () => {
    const field = grid(new Array<number>(9).fill(1), 9, 1);
    const at = (originCol: number) => resolveTerrainPiece(
      { id: 'p', cells: grid([1, 1, 1], 3, 1), originCol, originRow: 0, bondPolicy: 'free' },
      STONE_KINDS, STRIP_RULE_SET, field,
    );
    expect(terrainPieceFingerprint(at(0))).toBe(terrainPieceFingerprint(at(5)));
  });
});

describe('createTerrainPieceCache — bake once per topology change', () => {
  it('bakes once and reuses across many frames', () => {
    const cache = createTerrainPieceCache({ createCanvas: nodeCanvasFactory });
    const prepared = resolveFree(3);
    for (let frame = 0; frame < 60; frame++) cache.get('pit', prepared, BAKE);
    expect(cache.bakeCount()).toBe(1);
  });

  it('reuses across frames even when the caller re-resolves each frame', () => {
    // The realistic case: a caller that rebuilds its prepared grid per frame
    // must NOT pay a rebake, or "bake once" is a promise the cache can't keep.
    const cache = createTerrainPieceCache({ createCanvas: nodeCanvasFactory });
    for (let frame = 0; frame < 60; frame++) cache.get('pit', resolveFree(3), BAKE);
    expect(cache.bakeCount()).toBe(1);
  });

  it('rebakes when topology actually changes', () => {
    const cache = createTerrainPieceCache({ createCanvas: nodeCanvasFactory });
    cache.get('pit', resolveFree(3), BAKE);
    cache.get('pit', resolveFree(4), BAKE);
    expect(cache.bakeCount()).toBe(2);
  });

  it('rebakes after an explicit drop, and clear empties everything', () => {
    const cache = createTerrainPieceCache({ createCanvas: nodeCanvasFactory });
    const prepared = resolveFree(3);
    cache.get('pit', prepared, BAKE);
    cache.drop('pit');
    cache.get('pit', prepared, BAKE);
    expect(cache.bakeCount()).toBe(2);
    cache.clear();
    cache.get('pit', prepared, BAKE);
    expect(cache.bakeCount()).toBe(3);
  });

  it('refuses to cache without a stable key', () => {
    const cache = createTerrainPieceCache({ createCanvas: nodeCanvasFactory });
    expect(cache.get('', resolveFree(3), BAKE)).toBeUndefined();
    expect(cache.bakeCount()).toBe(0);
  });
});

describe('the two motion families — one primitive', () => {
  it('serves a rigid pair: a pit splitting open caps its inner ends', () => {
    const cache = createTerrainPieceCache({ createCanvas: nodeCanvasFactory });
    const left = bakeTerrainPiece(resolveTerrainPiece(freePiece('left', 2), STONE_KINDS, STRIP_RULE_SET), BAKE);
    const right = bakeTerrainPiece(resolveTerrainPiece(freePiece('right', 2), STONE_KINDS, STRIP_RULE_SET), BAKE);
    // Both halves capped at both ends; the outer ends hide under static terrain
    // by draw order, the inner ends are the ones the player sees.
    for (const half of [left, right]) {
      expect(colorOfCell(half!.canvas, 0)).toEqual([...TILE_COLORS[1]]); // left-end
      expect(colorOfCell(half!.canvas, 1)).toEqual([...TILE_COLORS[2]]); // right-end
    }
    expect(cache.bakeCount()).toBe(0); // baked directly, cache untouched
  });

  it('serves N crumble chunks, each baked independently', () => {
    const cache = createTerrainPieceCache({ createCanvas: nodeCanvasFactory });
    const chunks = ['c0', 'c1', 'c2', 'c3'].map((id) =>
      cache.get(id, resolveTerrainPiece(freePiece(id, 1), STONE_KINDS, STRIP_RULE_SET), BAKE),
    );
    expect(chunks.every((c) => c !== undefined)).toBe(true);
    expect(cache.bakeCount()).toBe(4);
    // Every chunk is a fully-capped single tile — a falling chunk shows no
    // raw cross-section on any face.
    for (const chunk of chunks) expect(colorOfCell(chunk!.canvas, 0)).toEqual([...TILE_COLORS[0]]);
  });

  it('offset never reaches the primitive: transform does not affect the bake', () => {
    const cache = createTerrainPieceCache({ createCanvas: nodeCanvasFactory });
    const prepared = resolveFree(3);
    const first = cache.get('pit', prepared, BAKE);
    const before = canvasBytes(first!.canvas);
    // Simulate 30 frames of the caller sliding the piece. The caller owns the
    // transform entirely, so none of this can touch the baked pixels.
    for (let frame = 0; frame < 30; frame++) cache.get('pit', prepared, BAKE);
    expect(canvasBytes(cache.get('pit', prepared, BAKE)!.canvas)).toEqual(before);
    expect(cache.bakeCount()).toBe(1);
  });
});
