/**
 * LDtk level surface cache — bake each level once at its native pixel
 * resolution, then scale the finished surface with the camera.
 *
 * Why: `drawLdtkLevel` blits every tile separately, and when a consumer's
 * camera transform carries a fractional zoom (a cover-fit 4.75×, or a zoom
 * easing between rooms) adjacent tiles are resampled independently — on some
 * browser/GPU combinations that exposes a duplicated or empty scanline between
 * tile rows (the classic GPU seam). A level baked into ONE offscreen canvas has
 * no internal draw boundaries for the compositor to split, so a single
 * `drawImage` of that surface stays seamless at any zoom. It is also cheaper
 * per frame: one blit instead of hundreds of tile blits, with culling for free.
 *
 * Tile art still goes through `drawLdtkLevel` verbatim — this cache only
 * changes WHEN scaling is applied (once, to the completed surface). The bake
 * happens lazily on first draw per level iid and the surface is reused by
 * reference thereafter (`createLdtkRoomCache` semantics). When no canvas host
 * is available (mock/non-DOM environments), `draw` retains the engine's direct
 * draw path rather than dropping the level art.
 *
 * Trade-off: one native-resolution canvas per visited level (level
 * `pxWid × pxHei`). The surface bakes from the FIRST tileset bundle seen for a
 * level — call {@link LdtkLevelSurfaceCache.drop} / `clear` after swapping
 * decoded tileset images or editing tiles.
 *
 * Determinism: no `Math.random`, no `Date.now`. Never throws.
 *
 * @module
 */

import { drawLdtkLevel } from './render';
import type { DrawLdtkLevelOptions, LdtkTilesetBundle } from './render';
import type { LdtkLevel } from './types';

/**
 * A canvas the surface cache can bake a level into. Accepts both browser
 * (`HTMLCanvasElement`/`OffscreenCanvas`) and node-canvas objects.
 */
export interface LdtkSurfaceCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
}

/**
 * Optional factory the consumer supplies so baking works in any host. In a
 * browser this can be omitted (the cache falls back to `OffscreenCanvas` or
 * `document.createElement('canvas')`). Under node-canvas (tests), pass
 * `createCanvas` from the `canvas` package. Returning `undefined` disables
 * caching — `draw` then uses the direct `drawLdtkLevel` path.
 */
export type LdtkSurfaceCanvasFactory = (width: number, height: number) => LdtkSurfaceCanvas | undefined;

/** Options for {@link createLdtkLevelSurfaceCache}. */
export interface LdtkLevelSurfaceCacheOptions {
  /** Optional canvas factory (see {@link LdtkSurfaceCanvasFactory}). */
  readonly createCanvas?: LdtkSurfaceCanvasFactory;
}

/** One baked level surface plus the tile count it was baked from. */
interface SurfaceEntry {
  readonly canvas: LdtkSurfaceCanvas;
  readonly tiles: number;
}

/** True iff `v` is a finite positive number. */
function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * A lazy, identity-preserving cache of native-resolution level surfaces.
 *
 * Created by {@link createLdtkLevelSurfaceCache}. Levels are baked on first
 * `draw`/`get` access and the SAME surface instance is reused thereafter.
 * `drop`/`clear` force a rebake (editor-repaint flows).
 */
export interface LdtkLevelSurfaceCache {
  /** `true` iff a surface is already baked for this level iid. */
  has(iid: string): boolean;
  /**
   * The baked surface for a level, baking it lazily on first access. Returns
   * `undefined` when no canvas host is available or the level has no usable
   * pixel dimensions — consumers should then fall back to direct
   * {@link drawLdtkLevel}.
   */
  get(
    level: Readonly<LdtkLevel>,
    tilesets: Readonly<LdtkTilesetBundle>,
  ): CanvasImageSource | undefined;
  /**
   * Draw a level through its baked surface — the drop-in replacement for
   * `drawLdtkLevel` under a consumer camera transform. Bakes the surface on
   * first call for the level's iid, then blits the whole surface ONCE per
   * frame at `worldOffset` inside the caller's transform. Returns the tile
   * count baked into the surface (consistent with `drawLdtkLevel`'s return).
   *
   * `options.view` is ignored on the cached path (a single blit needs no
   * culling); it only applies when this call falls back to the direct draw
   * path. **Never throws.**
   */
  draw(
    context: CanvasRenderingContext2D,
    level: Readonly<LdtkLevel>,
    options: Readonly<DrawLdtkLevelOptions>,
  ): number;
  /** Drop one level's surface; the next `draw`/`get` rebakes it. */
  drop(iid: string): void;
  /** Drop all cached surfaces; subsequent draws rebake. */
  clear(): void;
}

/**
 * Create a lazy {@link LdtkLevelSurfaceCache}.
 *
 * Canvas creation priority mirrors the sprite tint helper: the consumer
 * `createCanvas` factory (authoritative when supplied), then `OffscreenCanvas`,
 * then `document.createElement('canvas')` — `undefined` (no host) disables
 * caching and `draw` keeps the direct `drawLdtkLevel` path, so mock/non-DOM
 * hosts never lose their level art.
 *
 * @param options - Optional canvas factory.
 * @returns A {@link LdtkLevelSurfaceCache}.
 */
export function createLdtkLevelSurfaceCache(
  options?: Readonly<LdtkLevelSurfaceCacheOptions>,
): LdtkLevelSurfaceCache {
  const entries = new Map<string, SurfaceEntry>();

  const createSurfaceCanvas = (width: number, height: number): LdtkSurfaceCanvas | undefined => {
    try {
      if (options?.createCanvas !== undefined) return options.createCanvas(width, height);
      if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height) as unknown as LdtkSurfaceCanvas;
      }
      if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const el = document.createElement('canvas');
        el.width = width;
        el.height = height;
        return el;
      }
    } catch {
      return undefined;
    }
    return undefined;
  };

  const buildEntry = (
    level: Readonly<LdtkLevel>,
    tilesets: Readonly<LdtkTilesetBundle>,
  ): SurfaceEntry | undefined => {
    if (level === null || typeof level !== 'object') return undefined;
    const iid: unknown = (level as { iid?: unknown }).iid;
    if (typeof iid !== 'string') return undefined; // no stable cache key
    const cached = entries.get(iid);
    if (cached !== undefined) return cached;
    const width = (level as { pxWid?: unknown }).pxWid;
    const height = (level as { pxHei?: unknown }).pxHei;
    if (!isPositiveFinite(width) || !isPositiveFinite(height)) return undefined;
    const canvas = createSurfaceCanvas(width, height);
    if (canvas === undefined) return undefined;
    const surfaceCtx = canvas.getContext('2d');
    if (surfaceCtx === null) return undefined;
    surfaceCtx.imageSmoothingEnabled = false;
    const tiles = drawLdtkLevel(surfaceCtx, level, { tilesets });
    const entry: SurfaceEntry = { canvas, tiles };
    entries.set(iid, entry);
    return entry;
  };

  function has(iid: string): boolean {
    return entries.has(iid);
  }

  function get(
    level: Readonly<LdtkLevel>,
    tilesets: Readonly<LdtkTilesetBundle>,
  ): CanvasImageSource | undefined {
    const entry = buildEntry(level, tilesets);
    return entry === undefined ? undefined : (entry.canvas as unknown as CanvasImageSource);
  }

  function draw(
    context: CanvasRenderingContext2D,
    level: Readonly<LdtkLevel>,
    drawOptions: Readonly<DrawLdtkLevelOptions>,
  ): number {
    if (
      context === null || typeof context !== 'object' ||
      drawOptions === null || typeof drawOptions !== 'object'
    ) return 0;
    const entry = buildEntry(level, drawOptions.tilesets);
    if (entry === undefined) {
      // No canvas host / no stable key / unusable dimensions: retain the
      // engine's direct draw path rather than dropping the level art.
      return drawLdtkLevel(context, level, drawOptions);
    }
    try {
      const offset = drawOptions.worldOffset;
      context.save();
      try {
        if (offset !== undefined && (offset.x !== 0 || offset.y !== 0)) {
          context.translate(offset.x, offset.y);
        }
        context.drawImage(entry.canvas as unknown as CanvasImageSource, 0, 0);
      } finally {
        // Balance the save even if the blit throws, so the fallback draw (and
        // the caller's frame) sees the caller's own transform.
        context.restore();
      }
      return entry.tiles;
    } catch {
      return drawLdtkLevel(context, level, drawOptions);
    }
  }

  function drop(iid: string): void {
    entries.delete(iid);
  }

  function clear(): void {
    entries.clear();
  }

  return { has, get, draw, drop, clear };
}
