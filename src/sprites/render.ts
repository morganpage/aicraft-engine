/**
 * Sprite renderer — the pure draw path for compiled sprite frames.
 *
 * Draws a single {@link CompiledSpriteSheet} frame via the 9-arg
 * `ctx.drawImage`, with optional horizontal mirror (for facing) and tint
 * (recoloring monochrome art to distinguish player vs. enemies from the same
 * white sprites). Mirrors the discipline of `../ldtk/render.ts`'s `blitTile`:
 * the image is caller-supplied (`CanvasImageSource`), `imageSmoothingEnabled`
 * is forced off for crisp pixel art and restored in `finally`, and the draw
 * **never throws**.
 *
 * The engine never imports `Image` / calls `fetch` — the consumer loads the
 * PNG and injects it (see `showcase/sections/parallax.ts`'s `decodeImage`).
 *
 * @module
 */

import type { CompiledSpriteSheet, FrameRect } from './compile';

/** Horizontal facing. Art is authored right-facing; `-1` mirrors it. */
export type SpriteFacing = 1 | -1;

/** Optional draw overrides. */
export interface DrawSpriteOptions {
  /** Facing mirror. Default `1` (no mirror). */
  facing?: SpriteFacing;
  /**
   * Destination width/height in canvas units. Defaults to the frame's source
   * size (1:1 pixel mapping). Pass explicit sizes to scale sprites up/down.
   */
  destWidth?: number;
  destHeight?: number;
  /**
   * Solid color tint applied to the sprite's opaque pixels. Implemented via
   * an offscreen canvas `source-in` composite, so it recolors monochrome
   * (e.g. Kenney 1-bit white) art to any color. Useful for distinguishing the
   * player from enemies drawn from the same sheet.
   *
   * Tinting allocates one small offscreen canvas per (frame, color) the first
   * time it's requested and caches it on the supplied {@link SpriteTintCache}.
   */
  tint?: string;
  /** Global alpha multiplier `[0,1]`. Default `1`. */
  alpha?: number;
  /**
   * Cache for tinted frames. Pass a long-lived object (one per canvas) so the
   * offscreen buffers are reused across frames. Only needed when `tint` is
   * used; create with {@link createSpriteTintCache}.
   */
  tintCache?: SpriteTintCache;
}

/** A canvas the tint helper can draw into. Accepts both browser
 * (`HTMLCanvasElement`/`OffscreenCanvas`) and node-canvas objects. */
export interface TintCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
}

/**
 * Optional factory the consumer supplies so tinting works in any host. In a
 * browser this can be omitted (the helper falls back to `OffscreenCanvas` or
 * `document.createElement('canvas')`). Under node-canvas (tests), pass
 * `createCanvas` from the `canvas` package.
 */
export type TintCanvasFactory = (width: number, height: number) => TintCanvas | undefined;

/**
 * Cache of offscreen canvases keyed by `"frameIndex|color"`. Holds one tiny
 * canvas per tinted frame; reuse a single instance per drawing context for
 * the lifetime of the sheet.
 */
export interface SpriteTintCache {
  get(key: string): CanvasImageSource | undefined;
  set(key: string, image: CanvasImageSource): void;
  /** Optional canvas factory for tinting. Browser default if omitted. */
  createCanvas?: TintCanvasFactory;
}

/** Create a fresh tint cache. */
export function createSpriteTintCache(createCanvas?: TintCanvasFactory): SpriteTintCache {
  const map = new Map<string, CanvasImageSource>();
  return {
    get: (key) => map.get(key),
    set: (key, image) => {
      map.set(key, image);
    },
    createCanvas,
  };
}

/**
 * Resolve the on-screen frame to draw: the source rect and, if a tint is
 * requested, a pre-tinted image. Exposed for consumers that want to compose
 * their own draw call (e.g. with shadows).
 */
export function resolveDrawSource(
  image: CanvasImageSource,
  sheet: CompiledSpriteSheet,
  frameIndex: number,
  options: DrawSpriteOptions,
): { source: CanvasImageSource; rect: FrameRect } | undefined {
  const rect = sheet.frames[frameIndex];
  if (rect === undefined) return undefined;
  if (options.tint === undefined) return { source: image, rect };

  const cache = options.tintCache;
  if (cache === undefined) return { source: image, rect }; // no cache → untinted
  const key = `${frameIndex}|${options.tint}`;
  const cached = cache.get(key);
  if (cached) {
    // The tinted offscreen holds the frame at its own (0,0) origin, so the
    // source rect for blitting is zero-origin, not the sheet-space rect.
    return { source: cached, rect: { x: 0, y: 0, width: rect.width, height: rect.height } };
  }
  const tinted = tintFrame(image, rect, options.tint, cache.createCanvas);
  if (tinted) {
    // A TintCanvas always has a 2d context, so it's a valid draw image.
    const source = tinted as unknown as CanvasImageSource;
    cache.set(key, source);
    return { source, rect: { x: 0, y: 0, width: rect.width, height: rect.height } };
  }
  return { source: image, rect };
}

/**
 * Recolor a frame's opaque pixels to `color` via an offscreen canvas. The
 * canvas is sized to the frame rect (in sheet pixels), so the cache key
 * stays small. Returns the offscreen canvas, or `undefined` if no canvas
 * could be created in this host.
 *
 * The canvas is created via (in priority order): the consumer-supplied
 * `createCanvas` factory, `OffscreenCanvas`, or `document.createElement`.
 * This keeps the engine DOM-free while still working under node-canvas
 * (tests pass the `canvas` package's `createCanvas`).
 */
function tintFrame(
  image: CanvasImageSource,
  rect: FrameRect,
  color: string,
  createCanvas?: TintCanvasFactory,
): TintCanvas | undefined {
  const w = rect.width;
  const h = rect.height;
  let canvas: TintCanvas | undefined;
  try {
    if (createCanvas) {
      canvas = createCanvas(w, h);
    } else if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(w, h) as unknown as TintCanvas;
    } else if (typeof document !== 'undefined') {
      const el = document.createElement('canvas');
      el.width = w;
      el.height = h;
      canvas = el as unknown as TintCanvas;
    }
  } catch {
    canvas = undefined;
  }
  if (!canvas) return undefined;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  // Draw the source frame, then composite a solid color over it using
  // `source-in` so only the opaque silhouette is recolored.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image as CanvasImageSource, rect.x, rect.y, w, h, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return canvas;
}

/**
 * Draw one sprite frame. **Never throws** — draw exceptions are swallowed so
 * a single bad frame can't abort a render pass (same contract as
 * `../ldtk/render.ts`'s `blitTile`).
 *
 * @param ctx - The drawing context.
 * @param image - The decoded sheet PNG (consumer-supplied).
 * @param sheet - The compiled sheet (source rects).
 * @param frameIndex - Index into `sheet.frames` (e.g. from
 *   {@link currentFrameIndex}'s result mapped through the anim's
 *   `frameIndices`).
 * @param destX - Destination top-left X in canvas units.
 * @param destY - Destination top-left Y in canvas units.
 * @param options - Optional facing, scale, tint, alpha.
 * @returns `true` if a frame was drawn; `false` on bad index or draw error.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sheet: CompiledSpriteSheet,
  frameIndex: number,
  destX: number,
  destY: number,
  options: DrawSpriteOptions = {},
): boolean {
  const resolved = resolveDrawSource(image, sheet, frameIndex, options);
  if (!resolved) return false;
  const { source, rect } = resolved;

  const facing: SpriteFacing = options.facing === -1 ? -1 : 1;
  const destW = options.destWidth ?? rect.width;
  const destH = options.destHeight ?? rect.height;
  const alpha = options.alpha ?? 1;

  ctx.save();
  const smoothing = ctx.imageSmoothingEnabled;
  try {
    ctx.imageSmoothingEnabled = false;
    if (alpha < 1) ctx.globalAlpha *= alpha;
    if (facing === -1) {
      // Mirror around the sprite's horizontal center.
      ctx.translate(destX + destW / 2, destY);
      ctx.scale(-1, 1);
      ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, -destW / 2, 0, destW, destH);
    } else {
      ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, destX, destY, destW, destH);
    }
    return true;
  } catch {
    return false;
  } finally {
    ctx.imageSmoothingEnabled = smoothing;
    ctx.restore();
  }
}
