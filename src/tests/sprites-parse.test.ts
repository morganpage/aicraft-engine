import { describe, expect, it } from 'vitest';
import { parseSpriteSheet } from '../sprites/parse';

describe('parseSpriteSheet', () => {
  it('parses an Aseprite hash-form single-character sheet', () => {
    const json = JSON.stringify({
      frames: {
        'player 0': { frame: { x: 0, y: 0, w: 16, h: 16 }, duration: 120 },
        'player 1': { frame: { x: 16, y: 0, w: 16, h: 16 }, duration: 120 },
      },
      meta: {
        image: 'player.png',
        size: { w: 32, h: 16 },
        frameTags: [{ name: 'idle', from: 0, to: 1, direction: 'forward' }],
      },
    });
    const { ok, sheet, errors } = parseSpriteSheet(json);
    expect(ok).toBe(true);
    expect(errors).toHaveLength(0);
    expect(sheet).toBeDefined();
    expect(sheet!.meta.image).toBe('player.png');
    expect(sheet!.meta.frameTags![0].name).toBe('idle');
  });

  it('parses an Aseprite array-form frames list', () => {
    const json = JSON.stringify({
      frames: [
        { frame: { x: 0, y: 0, w: 8, h: 8 }, duration: 100 },
        { frame: { x: 8, y: 0, w: 8, h: 8 }, duration: 100 },
      ],
      meta: { image: 'a.png', size: { w: 16, h: 8 } },
    });
    const { ok, sheet } = parseSpriteSheet(json);
    expect(ok).toBe(true);
    expect(Array.isArray(sheet!.frames)).toBe(true);
    expect(sheet!.frames).toHaveLength(2);
  });

  it('parses a grid sheet (Kenney) with characters[]', () => {
    const json = JSON.stringify({
      frames: {},
      meta: {
        image: 'monochrome.png',
        size: { w: 320, h: 320 },
        grid: { tileWidth: 16, tileHeight: 16, columns: 20 },
        frameTags: [
          { name: 'player/idle', from: 260, to: 260, direction: 'forward' },
          { name: 'slime/idle', from: 280, to: 280, direction: 'forward' },
        ],
      },
      characters: [
        { name: 'player', defaultAnim: 'idle', animations: { idle: 'player/idle' } },
        { name: 'slime', defaultAnim: 'idle', animations: { idle: 'slime/idle' } },
      ],
    });
    const { ok, sheet, errors } = parseSpriteSheet(json);
    expect(ok).toBe(true);
    expect(errors).toHaveLength(0);
    expect(sheet!.meta.grid).toEqual({ tileWidth: 16, tileHeight: 16, columns: 20 });
    expect(sheet!.characters).toHaveLength(2);
    expect(sheet!.characters![0].animations.idle).toBe('player/idle');
  });

  it('returns ok=false with a diagnostic for malformed JSON', () => {
    const { ok, sheet, errors } = parseSpriteSheet('{ not valid json');
    expect(ok).toBe(false);
    expect(sheet).toBeUndefined();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].path).toBe('root');
    expect(errors[0].severity).toBe('error');
  });

  it('returns ok=false when the root is not an object', () => {
    const { ok, errors } = parseSpriteSheet(JSON.stringify([1, 2, 3]));
    expect(ok).toBe(false);
    expect(errors[0].message).toMatch(/not an object/);
  });

  it('errors when neither frames nor grid are present', () => {
    const { ok, errors } = parseSpriteSheet(JSON.stringify({ meta: {} }));
    expect(ok).toBe(false);
    expect(errors.some((e) => e.message.includes('nothing to animate'))).toBe(true);
  });

  it('accepts a grid-only sheet (empty frames, no characters)', () => {
    const json = JSON.stringify({
      meta: { image: 'g.png', size: { w: 32, h: 16 }, grid: { tileWidth: 16, tileHeight: 16, columns: 2 } },
    });
    const { ok, sheet } = parseSpriteSheet(json);
    expect(ok).toBe(true);
    expect(sheet!.meta.grid?.columns).toBe(2);
  });

  it('coerces invalid grid fields to an error rather than throwing', () => {
    const json = JSON.stringify({
      meta: { image: 'g.png', size: { w: 32, h: 16 }, grid: { tileWidth: -1, tileHeight: 16, columns: 2 } },
    });
    const { ok, errors } = parseSpriteSheet(json);
    // The grid is invalid (tileWidth <= 0) AND there are no usable frames,
    // so both contribute errors → not ok.
    expect(ok).toBe(false);
    expect(errors.some((e) => /grid/.test(e.path) || e.message.includes('grid'))).toBe(true);
  });

  it('drops malformed frame entries with a diagnostic but keeps valid ones', () => {
    const json = JSON.stringify({
      frames: {
        good: { frame: { x: 0, y: 0, w: 8, h: 8 }, duration: 100 },
        bad: { frame: { x: 'oops', y: 0, w: 8, h: 8 }, duration: 100 },
      },
      meta: { image: 'a.png', size: { w: 8, h: 8 } },
    });
    const { ok, sheet, errors } = parseSpriteSheet(json);
    // 'bad' frame drops with an error (missing valid x) → not ok, but 'good' survives.
    expect(ok).toBe(false);
    expect(errors.some((e) => e.path.includes('bad'))).toBe(true);
    expect((sheet!.frames as Record<string, unknown>).good).toBeDefined();
    expect((sheet!.frames as Record<string, unknown>).bad).toBeUndefined();
  });

  it('is deterministic: identical input yields identical output', () => {
    const json = JSON.stringify({
      frames: { a: { frame: { x: 0, y: 0, w: 8, h: 8 }, duration: 100 } },
      meta: { image: 'a.png', size: { w: 8, h: 8 } },
    });
    const a = parseSpriteSheet(json);
    const b = parseSpriteSheet(json);
    expect(b).toEqual(a);
  });

  it('preserves frame duration of 0 (Aseprite "hold" sentinel) verbatim', () => {
    const json = JSON.stringify({
      frames: { a: { frame: { x: 0, y: 0, w: 8, h: 8 }, duration: 0 } },
      meta: { image: 'a.png', size: { w: 8, h: 8 } },
    });
    const { ok, sheet } = parseSpriteSheet(json);
    expect(ok).toBe(true);
    expect((sheet!.frames as Record<string, { duration: number }>).a.duration).toBe(0);
  });
});
