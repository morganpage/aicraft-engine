import { describe, expect, it } from 'vitest';
import { compileSpriteSheet, resolveAnim, DEFAULT_FRAME_DURATION_MS } from '../sprites/compile';
import type { SpriteSheetJSON } from '../sprites/types';

function gridSheet(): SpriteSheetJSON {
  return {
    frames: {},
    meta: {
      image: 'sheet.png',
      size: { w: 64, h: 32 },
      grid: { tileWidth: 16, tileHeight: 16, columns: 4 },
      frameTags: [
        { name: 'player/idle', from: 0, to: 1, direction: 'forward' },
        { name: 'player/walk', from: 2, to: 5, direction: 'forward' },
        { name: 'slime/idle', from: 6, to: 7, direction: 'forward' },
      ],
    },
    characters: [
      { name: 'player', defaultAnim: 'idle', animations: { idle: 'player/idle', walk: 'player/walk' } },
      { name: 'slime', defaultAnim: 'idle', animations: { idle: 'slime/idle' } },
    ],
  };
}

describe('compileSpriteSheet — grid synthesis', () => {
  it('synthesizes frames from a uniform grid', () => {
    const { sheet, diagnostics } = compileSpriteSheet(gridSheet());
    expect(diagnostics).toHaveLength(0);
    // size 64x32, tile 16x16, 4 cols → 2 rows × 4 cols = 8 tiles.
    expect(sheet.frames).toHaveLength(8);
    // Tile 0 → (0,0); tile 5 → col 1, row 1 → (16,16).
    expect(sheet.frames[0]).toEqual({ x: 0, y: 0, width: 16, height: 16 });
    expect(sheet.frames[5]).toEqual({ x: 16, y: 16, width: 16, height: 16 });
  });

  it('grid frame durations default to DEFAULT_FRAME_DURATION_MS', () => {
    const { sheet } = compileSpriteSheet(gridSheet());
    const walk = sheet.anims.get('player/walk')!;
    expect(walk.durations).toEqual([
      DEFAULT_FRAME_DURATION_MS,
      DEFAULT_FRAME_DURATION_MS,
      DEFAULT_FRAME_DURATION_MS,
      DEFAULT_FRAME_DURATION_MS,
    ]);
  });

  it('ignores explicit frames when meta.grid is present (with a warning)', () => {
    const sheet: SpriteSheetJSON = {
      frames: { stray: { frame: { x: 0, y: 0, w: 99, h: 99 }, duration: 10 } },
      meta: {
        image: 's.png',
        size: { w: 32, h: 16 },
        grid: { tileWidth: 16, tileHeight: 16, columns: 2 },
      },
    };
    const { sheet: compiled, diagnostics } = compileSpriteSheet(sheet);
    expect(diagnostics.some((d) => /explicit frames are ignored/.test(d.message))).toBe(true);
    // Synthesized from grid, not the stray 99x99.
    expect(compiled.frames[0]).toEqual({ x: 0, y: 0, width: 16, height: 16 });
  });
});

describe('compileSpriteSheet — tag expansion', () => {
  it('expands a forward tag into the inclusive range', () => {
    const { sheet } = compileSpriteSheet(gridSheet());
    expect(sheet.anims.get('player/walk')!.frameIndices).toEqual([2, 3, 4, 5]);
  });

  it('expands a reverse tag into the reversed range', () => {
    const sheet: SpriteSheetJSON = {
      frames: {},
      meta: {
        image: 's.png',
        size: { w: 64, h: 16 },
        grid: { tileWidth: 16, tileHeight: 16, columns: 4 },
        frameTags: [{ name: 'rev', from: 0, to: 3, direction: 'reverse' }],
      },
    };
    const { sheet: compiled } = compileSpriteSheet(sheet);
    expect(compiled.anims.get('rev')!.frameIndices).toEqual([3, 2, 1, 0]);
  });

  it('clamps out-of-range tag indices into the frame count', () => {
    const sheet: SpriteSheetJSON = {
      frames: {},
      meta: {
        image: 's.png',
        size: { w: 32, h: 16 },
        grid: { tileWidth: 16, tileHeight: 16, columns: 2 },
        frameTags: [{ name: 'big', from: 0, to: 100, direction: 'forward' }],
      },
    };
    const { sheet: compiled, diagnostics } = compileSpriteSheet(sheet);
    // Only 2 tiles exist; the range [0,100] clamps to [0,1].
    expect(compiled.anims.get('big')!.frameIndices).toEqual([0, 1]);
    // No warning: clamping is silent (the tag still resolves to frames).
    expect(diagnostics.some((d) => /big/.test(d.message))).toBe(false);
  });

  it('skips a tag that resolves to no frames with a warning', () => {
    const sheet: SpriteSheetJSON = {
      frames: [],
      meta: {
        image: 's.png',
        size: { w: 0, h: 0 },
        frameTags: [{ name: 'empty', from: 0, to: 3, direction: 'forward' }],
      },
    };
    const { sheet: compiled, diagnostics } = compileSpriteSheet(sheet);
    expect(compiled.anims.has('empty')).toBe(false);
    expect(diagnostics.some((d) => /empty/.test(d.message))).toBe(true);
  });
});

describe('compileSpriteSheet — explicit (non-grid) frames', () => {
  it('uses authored frame rects and durations', () => {
    const sheet: SpriteSheetJSON = {
      frames: [
        { frame: { x: 0, y: 0, w: 24, h: 24 }, duration: 80 },
        { frame: { x: 24, y: 0, w: 24, h: 24 }, duration: 120 },
      ],
      meta: {
        image: 'p.png',
        size: { w: 48, h: 24 },
        frameTags: [{ name: 'idle', from: 0, to: 1, direction: 'forward' }],
      },
    };
    const { sheet: compiled } = compileSpriteSheet(sheet);
    expect(compiled.frames).toEqual([
      { x: 0, y: 0, width: 24, height: 24 },
      { x: 24, y: 0, width: 24, height: 24 },
    ]);
    const idle = compiled.anims.get('idle')!;
    expect(idle.frameIndices).toEqual([0, 1]);
    expect(idle.durations).toEqual([80, 120]);
  });

  it('treats duration 0 as the default', () => {
    const sheet: SpriteSheetJSON = {
      frames: [{ frame: { x: 0, y: 0, w: 8, h: 8 }, duration: 0 }],
      meta: { image: 'p.png', size: { w: 8, h: 8 }, frameTags: [{ name: 'a', from: 0, to: 0, direction: 'forward' }] },
    };
    const { sheet: compiled } = compileSpriteSheet(sheet);
    expect(compiled.anims.get('a')!.durations).toEqual([DEFAULT_FRAME_DURATION_MS]);
  });
});

describe('compileSpriteSheet — characters', () => {
  it('builds per-character animation tables', () => {
    const { sheet } = compileSpriteSheet(gridSheet());
    const player = sheet.characters.get('player')!;
    expect(player.defaultAnim).toBe('idle');
    expect(player.animations.has('idle')).toBe(true);
    expect(player.animations.has('walk')).toBe(true);
    const slime = sheet.characters.get('slime')!;
    expect(slime.animations.has('idle')).toBe(true);
  });

  it('warns when a character references an unknown tag and skips the key', () => {
    const sheet: SpriteSheetJSON = {
      frames: {},
      meta: {
        image: 's.png',
        size: { w: 32, h: 16 },
        grid: { tileWidth: 16, tileHeight: 16, columns: 2 },
        frameTags: [{ name: 'real', from: 0, to: 0, direction: 'forward' }],
      },
      characters: [{ name: 'c', animations: { good: 'real', bad: 'nope' } }],
    };
    const { sheet: compiled, diagnostics } = compileSpriteSheet(sheet);
    expect(diagnostics.some((d) => /unknown tag "nope"/.test(d.message))).toBe(true);
    const c = compiled.characters.get('c')!;
    expect(c.animations.has('good')).toBe(true);
    expect(c.animations.has('bad')).toBe(false);
  });

  it('resolves a character anim by key, then defaultAnim, then any', () => {
    const { sheet } = compileSpriteSheet(gridSheet());
    const walk = resolveAnim(sheet, 'player', 'walk');
    expect(walk).toBeDefined();
    // Missing key falls back to defaultAnim ('idle').
    const fallback = resolveAnim(sheet, 'player', 'nonexistent');
    expect(fallback).toBeDefined();
    expect(fallback!.name).toBe('player/idle');
  });

  it('resolveAnim reads tags directly for a single-character (no characters[]) sheet', () => {
    const sheet: SpriteSheetJSON = {
      frames: {},
      meta: {
        image: 's.png',
        size: { w: 32, h: 16 },
        grid: { tileWidth: 16, tileHeight: 16, columns: 2 },
        frameTags: [{ name: 'idle', from: 0, to: 1, direction: 'forward' }],
      },
    };
    const { sheet: compiled } = compileSpriteSheet(sheet);
    expect(resolveAnim(compiled, undefined, 'idle')).toBeDefined();
    expect(resolveAnim(compiled, undefined, 'nope')).toBeUndefined();
  });
});
