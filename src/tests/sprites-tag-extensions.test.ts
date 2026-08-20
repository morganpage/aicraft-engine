import { describe, expect, it } from 'vitest';
import { compileSpriteSheet, DEFAULT_FRAME_DURATION_MS } from '../sprites/compile';
import { parseSpriteSheet } from '../sprites/parse';
import { advanceSpriteAnim, createSpriteAnimState, currentFrameIndex } from '../sprites/resolve';
import {
  advanceSpriteAnimPlayer,
  createSpriteAnimPlayer,
  deriveSpriteAnimKind,
  spriteAnimClipFor,
  type SpriteAnimKind,
} from '../sprites/anim-state';
import type { SpriteSheetJSON } from '../sprites/types';

/**
 * The 0.20.0 frameTag extensions: `loop` (one-shot clips that clamp on their
 * last frame — the jump arc), `duration` (a uniform per-clip pace), and
 * `durations` (per-frame pacing). Together these retire the two consumer
 * workarounds the celerock brief documented: hand-building a `loop: false`
 * `CompiledAnim`, and copy-on-write surgery on the compiled sheet to re-pace
 * a clip.
 */

/** The celerock Player.png sheet shape: 10×8 grid of 16px cells. */
function celerockSheet(): SpriteSheetJSON {
  return {
    frames: {},
    meta: {
      image: 'Player.png',
      size: { w: 160, h: 128 },
      grid: { tileWidth: 16, tileHeight: 16, columns: 10 },
      frameTags: [
        { name: 'idle', from: 0, to: 0, direction: 'forward', duration: 140 },
        { name: 'walk', from: 0, to: 7, direction: 'forward' },
        {
          name: 'jump', from: 60, to: 64, direction: 'forward', loop: false, duration: 70,
        },
        { name: 'climb', from: 30, to: 31, direction: 'forward', duration: 90 },
      ],
    },
  };
}

describe('frameTag extensions — parse', () => {
  it('preserves loop/duration/durations through parseSpriteSheet', () => {
    const text = JSON.stringify({
      frames: {},
      meta: {
        image: 'p.png',
        size: { w: 160, h: 128 },
        grid: { tileWidth: 16, tileHeight: 16, columns: 10 },
        frameTags: [
          { name: 'jump', from: 60, to: 64, direction: 'forward', loop: false, duration: 70, durations: [70, 80, 90, 100, 110] },
        ],
      },
    });
    const { ok, sheet, errors } = parseSpriteSheet(text);
    expect(errors).toHaveLength(0);
    expect(ok).toBe(true);
    expect(sheet!.meta.frameTags![0]).toMatchObject({
      name: 'jump',
      loop: false,
      duration: 70,
      durations: [70, 80, 90, 100, 110],
    });
  });

  it('drops an invalid durations array whole (positions must stay parallel)', () => {
    const text = JSON.stringify({
      frames: {},
      meta: {
        image: 'p.png',
        size: { w: 64, h: 16 },
        grid: { tileWidth: 16, tileHeight: 16, columns: 4 },
        frameTags: [
          { name: 'a', from: 0, to: 2, direction: 'forward', durations: [70, 0, 90] },
        ],
      },
    });
    const { ok, sheet } = parseSpriteSheet(text);
    expect(ok).toBe(true);
    expect(sheet!.meta.frameTags![0].durations).toBeUndefined();
  });

  it('drops a non-positive or non-boolean loop/duration silently', () => {
    const text = JSON.stringify({
      frames: {},
      meta: {
        image: 'p.png',
        size: { w: 64, h: 16 },
        grid: { tileWidth: 16, tileHeight: 16, columns: 4 },
        frameTags: [
          { name: 'a', from: 0, to: 1, direction: 'forward', loop: 'yes', duration: -5 },
        ],
      },
    });
    const { ok, sheet } = parseSpriteSheet(text);
    expect(ok).toBe(true);
    const tag = sheet!.meta.frameTags![0];
    expect('loop' in tag).toBe(false);
    expect('duration' in tag).toBe(false);
  });
});

describe('frameTag extensions — compile', () => {
  it('compiles loop:false verbatim and defaults loop:true (Aseprite behavior)', () => {
    const { sheet, diagnostics } = compileSpriteSheet(celerockSheet());
    expect(diagnostics).toHaveLength(0);
    expect(sheet.anims.get('jump')!.loop).toBe(false);
    expect(sheet.anims.get('walk')!.loop).toBe(true);
  });

  it('applies a uniform per-tag duration to a grid sheet (the per-clip pace)', () => {
    const { sheet } = compileSpriteSheet(celerockSheet());
    expect(sheet.anims.get('jump')!.durations).toEqual([70, 70, 70, 70, 70]);
    expect(sheet.anims.get('idle')!.durations).toEqual([140]);
    // Tags without the extension keep the grid default.
    expect(sheet.anims.get('walk')!.durations).toEqual(
      Array.from({ length: 8 }, () => DEFAULT_FRAME_DURATION_MS),
    );
  });

  it('durations (per-frame) wins over duration (uniform)', () => {
    const sheet: SpriteSheetJSON = {
      frames: {},
      meta: {
        image: 'p.png',
        size: { w: 64, h: 16 },
        grid: { tileWidth: 16, tileHeight: 16, columns: 4 },
        frameTags: [
          { name: 'a', from: 0, to: 2, direction: 'forward', duration: 50, durations: [10, 20, 30] },
        ],
      },
    };
    const compiled = compileSpriteSheet(sheet);
    expect(compiled.sheet.anims.get('a')!.durations).toEqual([10, 20, 30]);
  });

  it('a length-mismatched durations array is a diagnostic and falls back', () => {
    const sheet: SpriteSheetJSON = {
      frames: {},
      meta: {
        image: 'p.png',
        size: { w: 64, h: 16 },
        grid: { tileWidth: 16, tileHeight: 16, columns: 4 },
        frameTags: [
          { name: 'a', from: 0, to: 2, direction: 'forward', duration: 50, durations: [10, 20] },
        ],
      },
    };
    const { sheet: compiled, diagnostics } = compileSpriteSheet(sheet);
    expect(diagnostics.some((d) => /durations must be 3 positive/.test(d.message))).toBe(true);
    expect(compiled.anims.get('a')!.durations).toEqual([50, 50, 50]);
  });

  it('the compiled one-shot jump clamps on its fall frame (no hand-built anim)', () => {
    const { sheet } = compileSpriteSheet(celerockSheet());
    const jump = sheet.anims.get('jump')!;
    // Total 350 ms; past the end the slot clamps to n-1 (the fall frame), and
    // the sheet cell is 64 — not a loop back to 60.
    let state = createSpriteAnimState();
    state = advanceSpriteAnim(state, 400);
    const slot = currentFrameIndex(state, jump)!;
    expect(slot).toBe(4);
    expect(jump.frameIndices[slot]).toBe(64);
  });
});

describe('the climb kind (0.20.0)', () => {
  it('climbing: true reads as climb, priority over grounded and airborne', () => {
    expect(
      deriveSpriteAnimKind({ supported: true, speedX: 40, velocityY: 0, climbing: true }),
    ).toBe('climb');
    expect(
      deriveSpriteAnimKind({ supported: false, speedX: 0, velocityY: -120, climbing: true }),
    ).toBe('climb');
  });

  it('climb maps to its own clip; airborne kinds still share the jump clip', () => {
    expect(spriteAnimClipFor('climb')).toBe('climb');
    expect(spriteAnimClipFor('ascent')).toBe('jump');
    expect(spriteAnimClipFor('apex')).toBe('jump');
    expect(spriteAnimClipFor('descent')).toBe('jump');
    expect(spriteAnimClipFor('idle')).toBe('idle');
    expect(spriteAnimClipFor('walk')).toBe('walk');
  });

  it('the clip player restarts entering and leaving climb, not across airborne phases', () => {
    let anim = createSpriteAnimPlayer('idle');
    const kinds: SpriteAnimKind[] = ['walk', 'ascent', 'apex', 'descent', 'climb', 'climb', 'descent'];
    const restarts: boolean[] = [];
    let clips: string[] = [];
    for (const kind of kinds) {
      anim = advanceSpriteAnimPlayer(anim, kind, 16);
      restarts.push(anim.restarted);
      clips.push(anim.clip);
    }
    // walk→(idle→walk restarts), ascent (jump clip restarts once), apex+descent
    // share it, climb restarts, second climb does NOT, leaving climb restarts.
    expect(clips).toEqual(['walk', 'jump', 'jump', 'jump', 'climb', 'climb', 'jump']);
    expect(restarts).toEqual([true, true, false, false, true, false, true]);
  });

  it('a parked climb clock: advancing with dtMs 0 keeps the clip change but not the clock', () => {
    let anim = createSpriteAnimPlayer('climb');
    anim = advanceSpriteAnimPlayer(anim, 'climb', 90);
    const heldFrame = anim.state.elapsedMs;
    // The Celeste touch: hold the cling without climbing — the clock parks.
    anim = advanceSpriteAnimPlayer(anim, 'climb', 0);
    expect(anim.state.elapsedMs).toBe(heldFrame);
    expect(anim.clip).toBe('climb');
  });
});
