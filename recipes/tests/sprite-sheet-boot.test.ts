import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadSpriteSheetAssets, type FetchTextResult } from '../sprite-sheet-boot';

// The celerock brief's real animation source of truth (§1.1): a 10×8
// meta.grid synthesizing 80 cells, four frame tags with the 0.20.0 pacing /
// one-shot extensions. If this file's schema changes, the recipe's boot
// contract changes with it — the honest fixture.
const PLAYER_JSON = readFileSync(new URL('../../games/Player.json', import.meta.url), 'utf8');

const okFetch = (text: string) => (): Promise<FetchTextResult> =>
  Promise.resolve({ ok: true, text: () => Promise.resolve(text) });

const failFetch = (): Promise<FetchTextResult> =>
  Promise.resolve({ ok: false, text: () => Promise.resolve('') });

const image = {} as CanvasImageSource;

describe('loadSpriteSheetAssets', () => {
  it('boots the real Player.json: four clips resolve with authored pacing', async () => {
    const sheet = await loadSpriteSheetAssets({
      imageUrl: 'Player.png',
      jsonUrl: 'Player.json',
      decodeImage: () => Promise.resolve(image),
      fetchText: okFetch(PLAYER_JSON),
    });
    expect(sheet).not.toBeNull();
    const jump = sheet!.clip('jump');
    expect(jump).not.toBeNull();
    expect(jump!.loop).toBe(false);          // the one-shot that clamps on the fall frame
    expect(sheet!.clip('idle')!.durations[0]).toBe(400);
    expect(sheet!.clip('climb')!.durations[0]).toBe(160);
    expect(sheet!.compiled.frames).toHaveLength(80); // 10×8 grid
  });

  it('an unknown clip name degrades to null (fall back to idle, never walk)', async () => {
    const sheet = await loadSpriteSheetAssets({
      imageUrl: 'Player.png',
      jsonUrl: 'Player.json',
      decodeImage: () => Promise.resolve(image),
      fetchText: okFetch(PLAYER_JSON),
    });
    expect(sheet!.clip('victory')).toBeNull();
  });

  it('a failed JSON fetch degrades to null — never throws', async () => {
    const sheet = await loadSpriteSheetAssets({
      imageUrl: 'Player.png',
      jsonUrl: 'Player.json',
      decodeImage: () => Promise.resolve(image),
      fetchText: failFetch,
    });
    expect(sheet).toBeNull();
  });

  it('unparseable JSON degrades to null', async () => {
    const sheet = await loadSpriteSheetAssets({
      imageUrl: 'Player.png',
      jsonUrl: 'Player.json',
      decodeImage: () => Promise.resolve(image),
      fetchText: okFetch('{ not json'),
    });
    expect(sheet).toBeNull();
  });

  it('a failed image decode degrades to null (procedural fallback body takes over)', async () => {
    const sheet = await loadSpriteSheetAssets({
      imageUrl: 'Player.png',
      jsonUrl: 'Player.json',
      decodeImage: () => Promise.resolve(undefined),
      fetchText: okFetch(PLAYER_JSON),
    });
    expect(sheet).toBeNull();
  });

  it('a THROWING decode is swallowed and degrades to null', async () => {
    const sheet = await loadSpriteSheetAssets({
      imageUrl: 'Player.png',
      jsonUrl: 'Player.json',
      decodeImage: () => {
        throw new Error('hostile host');
      },
      fetchText: okFetch(PLAYER_JSON),
    });
    expect(sheet).toBeNull();
  });
});
