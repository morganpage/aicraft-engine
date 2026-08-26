import {
  compileSpriteSheet,
  parseSpriteSheet,
  type CompiledAnim,
  type CompiledSpriteSheet,
} from 'aicraft-engine';

/** A minimal successful text response (structural — avoids the full `Response`). */
export interface FetchTextResult {
  readonly ok: boolean;
  text(): Promise<string>;
}

/** Options for {@link loadSpriteSheetAssets}. */
export interface LoadSpriteSheetOptions {
  /** The sheet PNG (e.g. `Player.png`). */
  readonly imageUrl: string;
  /** The sheet's Aseprite-JSON animation definition — the clip SOURCE OF TRUTH. */
  readonly jsonUrl: string;
  /**
   * YOUR defensive image loader — the same one the tileset path uses. Resolves
   * a URL to a decoded `CanvasImageSource`, `undefined` on failure.
   * `recipes/image-decoder.ts`'s `decodeImageBounded` is the intended
   * implementation (copy that recipe in too — the shared bounded decoder:
   * host-defensive, timeout-guarded, never throws).
   */
  readonly decodeImage: (url: string) => Promise<CanvasImageSource | undefined>;
  /** Text fetcher (tests inject a stub). Defaults to the global `fetch`. */
  readonly fetchText?: (url: string) => Promise<FetchTextResult>;
}

/** A loaded, compiled sprite sheet plus a clip lookup. */
export interface SpriteSheetAssets {
  readonly image: CanvasImageSource;
  readonly compiled: CompiledSpriteSheet;
  /** The named clip, or `null` when the sheet has no clip by that name —
   * fall back to idle, never to walk. */
  clip(name: string): CompiledAnim | null;
}

/**
 * The defensive sprite-sheet boot: fetch the PNG and its animation JSON,
 * parse, compile, and hand back clips — or `null` on ANY failure.
 *
 * A missing/failed sprite asset is NOT fatal: the game still runs with its
 * procedural fallback body, so every step here degrades quietly instead of
 * crashing boot (`parseSpriteSheet` never throws; the fetches are wrapped).
 * The JSON stays the clip source of truth — this recipe never forks clip
 * definitions into game code, and the compiled sheet is consumed as-is
 * (it is frozen; no post-compile surgery).
 *
 * @example
 * ```ts
 * const sheet = await loadSpriteSheetAssets({
 *   imageUrl: `${import.meta.env.BASE_URL}Player.png`,
 *   jsonUrl: `${import.meta.env.BASE_URL}Player.json`,
 *   decodeImage: decodeImageBounded, // your loader, shared with the tilesets
 * });
 * const clips = sheet
 *   ? { idle: sheet.clip('idle'), walk: sheet.clip('walk'), jump: sheet.clip('jump') }
 *   : null;
 * ```
 */
export async function loadSpriteSheetAssets(
  options: Readonly<LoadSpriteSheetOptions>,
): Promise<SpriteSheetAssets | null> {
  const fetchText =
    options.fetchText ??
    ((url: string) => {
      const f = (globalThis as { fetch?: typeof fetch }).fetch;
      if (!f) return Promise.resolve({ ok: false, text: () => Promise.resolve('') });
      return f(url);
    });

  let jsonText: string | null = null;
  try {
    const response = await fetchText(options.jsonUrl);
    if (response.ok) jsonText = await response.text();
  } catch {
    jsonText = null;
  }
  if (jsonText === null) return null;

  const parsed = parseSpriteSheet(jsonText);
  if (!parsed.ok || !parsed.sheet) return null;

  let image: CanvasImageSource | undefined;
  try {
    image = await options.decodeImage(options.imageUrl);
  } catch {
    image = undefined;
  }
  if (image === undefined) return null;

  const compiled = compileSpriteSheet(parsed.sheet).sheet;
  return {
    image,
    compiled,
    clip(name) {
      return compiled.anims.get(name) ?? null;
    },
  };
}
