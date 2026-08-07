/**
 * Tests for the 0x72 knight as the LDtk platformer's playable character.
 *
 * The knight is full-color art from a different sheet than the mobs, so this
 * covers three concerns the existing `ldtk-editor-mob-sprites.test.ts` does not:
 *   1. The knight JSON parses + compiles and every physics-driven anim kind
 *      (`idle`/`walk`/`jump`/`fall` + the airborne `ascent`/`apex`/`descent`
 *      aliases) resolves to real frames — the player is driven by
 *      `deriveSpriteAnimKind`, which can ask for any of these.
 *   2. The authored tile indices are the ones intended (guard against a future
 *      edit that silently shifts a clip).
 *   3. `playerTintFor` returns `undefined` for the colored knight bundle so the
 *      raw art is drawn, not a blue silhouette.
 */

import { describe, expect, it } from 'vitest';
import { parseSpriteSheet, compileSpriteSheet, resolveAnim } from '../../src/sprites';
import { playerTintFor } from '../sections/ldtk-editor/mob-sprites';
// Vite imports JSON as a parsed object; the parser takes a string, so we
// re-stringify exactly as `loadKnightBundle` does.
import knightSheet from '../../assets/sprites/samples/knight-0x72.json';

const parsed = parseSpriteSheet(JSON.stringify(knightSheet));
const compiled = parsed.ok && parsed.sheet ? compileSpriteSheet(parsed.sheet).sheet : undefined;

describe('knight-0x72.json', () => {
  it('parses and compiles without errors', () => {
    expect(parsed.ok).toBe(true);
    expect(parsed.errors).toHaveLength(0);
    expect(compiled).toBeDefined();
  });

  it('is a 512x512 sheet with a 32-column 16px grid (1024 tiles)', () => {
    // The frame array is grid-synthesized from `meta.grid`; 32 cols x 32 rows.
    expect(compiled!.frames).toHaveLength(1024);
  });

  it('defines exactly the knight character', () => {
    expect(Array.from(compiled!.characters.keys())).toEqual(['knight']);
  });

  it.each(['idle', 'walk', 'jump', 'fall', 'ascent', 'apex', 'descent'] as const)(
    'resolves the %s anim kind to real frames',
    (kind) => {
      const anim = resolveAnim(compiled!, 'knight', kind);
      expect(anim, `knight/${kind} should resolve`).toBeDefined();
      expect(anim!.frameIndices.length).toBeGreaterThan(0);
    },
  );

  it('uses the intended idle/walk/jump/fall tile indices', () => {
    // These are the frames identified by slicing the sheet (row 9 of the 0x72
    // DungeonTileset II grid). If the art is re-arranged, this test is the cue
    // to re-derive them — see assets/sprites/samples/README.md.
    expect(resolveAnim(compiled!, 'knight', 'idle')!.frameIndices).toEqual([296]);
    expect(resolveAnim(compiled!, 'knight', 'walk')!.frameIndices).toEqual([296, 297]);
    expect(resolveAnim(compiled!, 'knight', 'jump')!.frameIndices).toEqual([301]);
    expect(resolveAnim(compiled!, 'knight', 'fall')!.frameIndices).toEqual([304]);
  });

  it('maps the airborne kinds onto jump/fall (no separate air art)', () => {
    // Mirrors how kenney-1bit.json's player maps ascent->jump, apex/descent->fall.
    expect(resolveAnim(compiled!, 'knight', 'ascent')).toEqual(
      resolveAnim(compiled!, 'knight', 'jump'),
    );
    expect(resolveAnim(compiled!, 'knight', 'apex')).toEqual(
      resolveAnim(compiled!, 'knight', 'fall'),
    );
    expect(resolveAnim(compiled!, 'knight', 'descent')).toEqual(
      resolveAnim(compiled!, 'knight', 'fall'),
    );
  });
});

describe('playerTintFor', () => {
  it('returns undefined for a colored (0x72 knight) bundle so the raw art shows', () => {
    expect(playerTintFor({ colored: true })).toBeUndefined();
  });

  it('returns the player tint for a 1-bit (Kenney) bundle', () => {
    expect(playerTintFor({ colored: false })).toBe('#9ad0ff');
  });
});
