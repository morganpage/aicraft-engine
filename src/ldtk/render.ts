/**
 * LDtk canvas renderer — the single runtime draw path for `.ldtk` levels.
 *
 * LDtk resolves all auto-tiling rules at save time, so `autoLayerTiles`
 * and `gridTiles` are ordinary pre-sorted, pre-deculded tiles. The
 * renderer just blits them — no per-frame rule evaluation. Painting into a
 * level re-resolves them through `rules.ts`; this module stays a pure draw
 * path so it can ship without the authoring code.
 *
 * This is additive to the procedural `src/terrain-art/` renderer, not a
 * replacement for it: that path exists for games shipping no tile assets at
 * all, which LDtk by definition cannot serve.
 *
 * Contract (per https://ldtk.io/docs/game-dev/json-overview/):
 *  - `layerInstances` is sorted in display order: index 0 is the *top-most*
 *    layer and the last entry is furthest back. Drawing back-to-front
 *    therefore means iterating the array in reverse.
 *  - A rule-driven `IntGrid` layer bakes `autoLayerTiles` just like an
 *    `AutoLayer` does, and must be drawn.
 *  - Each tile: source rect `(src[0], src[1], tileSize, tileSize)` from
 *    the tileset image; dest `(layer.__pxTotalOffsetX + tile.px[0], …)`.
 *  - Flip: `tile.f & 1` → X, `tile.f & 2` → Y.
 *  - Alpha: multiply global alpha by `tile.a` (default 1).
 *  - Respect `__opacity` and `visible` per layer.
 *
 * Determinism note: pure drawing over the supplied context; no
 * `Math.random`, no `Date.now`. The `imageSmoothingEnabled` flag is set
 * to `false` (pixel art).
 *
 * @module
 */

import type {
  LdtkLayerInstance,
  LdtkLevel,
  LdtkTile,
  LdtkTileRenderMode,
  LdtkTilesetDef,
} from './types';

/**
 * A loaded tileset image paired with its definition. The `image` is any
 * `CanvasImageSource` (HTMLCanvasElement, ImageBitmap, OffscreenCanvas,
 * node-canvas in tests).
 */
export interface LdtkTilesetImage {
  /** The tileset definition (uid, tileGridSize, padding, spacing). */
  readonly def: LdtkTilesetDef;
  /** The decoded image. */
  readonly image: CanvasImageSource;
}

/** Tilesets keyed by uid — the lookup the renderer uses per layer. */
export type LdtkTilesetBundle = ReadonlyMap<number, LdtkTilesetImage>;

/** Viewport rectangle for culling (world-space pixels). */
export interface LdtkDrawView {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Options shared by all layer-draw entry points. */
export interface DrawLdtkLayerOptions {
  /** Tilesets by uid. Layers with an unknown uid are skipped. */
  readonly tilesets: LdtkTilesetBundle;
  /** Optional viewport cull. If omitted, everything is drawn. */
  readonly view?: Readonly<LdtkDrawView>;
}

/** Options for {@link drawLdtkLevel}. */
export interface DrawLdtkLevelOptions extends DrawLdtkLayerOptions {
  /** World-space presentation offset (e.g. camera translate). Default origin. */
  readonly worldOffset?: Readonly<{ x: number; y: number }>;
}

/** True iff `v` is a finite positive number. */
function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** Intersect a tile's world rect with the view; return false if fully outside. */
function inView(
  tileX: number,
  tileY: number,
  size: number,
  view: Readonly<LdtkDrawView> | undefined,
): boolean {
  if (view === undefined) return true;
  return (
    tileX + size > view.x &&
    tileY + size > view.y &&
    tileX < view.x + view.width &&
    tileY < view.y + view.height
  );
}

/** Apply flip + alpha and blit one tile. Returns false if the draw threw. */
function blitTile(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  tile: Readonly<LdtkTile>,
  tileSize: number,
  destX: number,
  destY: number,
): boolean {
  const flipX = (tile.f ?? 0) & 1;
  const flipY = (tile.f ?? 0) & 2;
  const alpha = tile.a ?? 1;
  if (alpha <= 0) return false; // fully transparent — not drawn
  context.save();
  try {
    if (alpha < 1) context.globalAlpha *= alpha;
    if (flipX || flipY) {
      // Mirror around the tile's center, then draw into the flipped frame.
      context.translate(destX + tileSize / 2, destY + tileSize / 2);
      context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      context.drawImage(
        image,
        tile.src[0],
        tile.src[1],
        tileSize,
        tileSize,
        -tileSize / 2,
        -tileSize / 2,
        tileSize,
        tileSize,
      );
    } else {
      context.drawImage(
        image,
        tile.src[0],
        tile.src[1],
        tileSize,
        tileSize,
        destX,
        destY,
        tileSize,
        tileSize,
      );
    }
    return true;
  } catch {
    return false;
  } finally {
    context.restore();
  }
}

/**
 * Draw one tile-bearing layer. **Never throws** — draw exceptions abort the
 * rest of the layer but propagate no error.
 *
 * `Tiles`, `AutoLayer` and rule-driven `IntGrid` layers all draw; `Entities`
 * layers never do. Returns the number of tiles successfully drawn.
 *
 * @param context - The 2D canvas context (caller owns base transform).
 * @param layer - The LDtk layer instance.
 * @param options - Tileset bundle + optional viewport.
 * @returns Count of tiles drawn.
 */
export function drawLdtkLayer(
  context: CanvasRenderingContext2D,
  layer: Readonly<LdtkLayerInstance>,
  options: Readonly<DrawLdtkLayerOptions>,
): number {
  if (
    context === null || typeof context !== 'object' ||
    layer === null || typeof layer !== 'object' ||
    options === null || typeof options !== 'object'
  ) return 0;
  if (!layer.visible) return 0;
  if (layer.__type === 'Entities') return 0;

  const tilesetImage = layer.__tilesetDefUid === null ? undefined : options.tilesets.get(layer.__tilesetDefUid);
  if (tilesetImage === undefined) return 0;
  const tileSize = tilesetImage.def.tileGridSize;
  if (!isPositiveFinite(tileSize)) return 0;

  // An IntGrid layer carrying auto-rules bakes its own `autoLayerTiles`, and
  // that is frequently a level's primary terrain art — so layer type alone does
  // not decide which array to draw. Prefer whichever is populated: `Tiles`
  // layers fill `gridTiles`, rule-driven layers fill `autoLayerTiles`, and a
  // layer never fills both.
  const tiles =
    layer.autoLayerTiles !== undefined && layer.autoLayerTiles.length > 0
      ? layer.autoLayerTiles
      : layer.gridTiles;
  if (tiles === undefined || tiles.length === 0) return 0;

  const offsetX = layer.__pxTotalOffsetX;
  const offsetY = layer.__pxTotalOffsetY;

  context.save();
  try {
    if (layer.__opacity < 1) context.globalAlpha *= layer.__opacity;
    const smoothing = context.imageSmoothingEnabled;
    context.imageSmoothingEnabled = false;
    let drawn = 0;
    for (const tile of tiles) {
      const destX = offsetX + tile.px[0];
      const destY = offsetY + tile.px[1];
      if (!inView(destX, destY, tileSize, options.view)) continue;
      if (blitTile(context, tilesetImage.image, tile, tileSize, destX, destY)) drawn++;
    }
    context.imageSmoothingEnabled = smoothing;
    return drawn;
  } catch {
    return 0;
  } finally {
    context.restore();
  }
}

/**
 * Draw an LDtk level — iterate `layerInstances` drawing every visible
 * tile-bearing layer. `Entities` layers are skipped; entity spawning is owned
 * by the translated {@link LevelData}.
 *
 * LDtk stores `layerInstances` top→bottom, so this iterates in reverse to
 * paint back-to-front.
 *
 * **Never throws.** Returns the total tile count drawn.
 *
 * @param context - The 2D canvas context (caller owns base transform).
 * @param level - The LDtk level to render.
 * @param options - Tileset bundle + optional viewport + world offset.
 * @returns Total tiles drawn across all layers.
 */
export function drawLdtkLevel(
  context: CanvasRenderingContext2D,
  level: Readonly<LdtkLevel>,
  options: Readonly<DrawLdtkLevelOptions>,
): number {
  if (
    context === null || typeof context !== 'object' ||
    level === null || typeof level !== 'object' ||
    options === null || typeof options !== 'object'
  ) return 0;
  const layers = level.layerInstances;
  if (!Array.isArray(layers) || layers.length === 0) return 0;

  const offset = options.worldOffset ?? { x: 0, y: 0 };
  let total = 0;
  context.save();
  try {
    if (offset.x !== 0 || offset.y !== 0) context.translate(offset.x, offset.y);
    for (let i = layers.length - 1; i >= 0; i--) {
      total += drawLdtkLayer(context, layers[i], options);
    }
  } finally {
    context.restore();
  }
  return total;
}

/**
 * Draw the 9 slices of a bordered tile into a rect (standard 9-slice:
 * corners 1:1, edges stretched along one axis, center both). Borders are in
 * LDtk schema order `[up, right, down, left]`.
 *
 * Under-sized rects: each border clamps to half the rect on its axis (the
 * schema is silent on this case), and any slice whose SOURCE or DEST span
 * comes out ≤ 0 is skipped — a zero-size `drawImage` throws, which would
 * fail the whole entity to the engine fallback rather than degrade one
 * slice. With uniform borders on a too-narrow rect this drops the center
 * and the horizontal edge strips; the side edges still stretch, which is
 * the correct degenerate rendering (the door's sides run its full height).
 */
function drawNineSlices(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  tile: Readonly<{ x: number; y: number; w: number; h: number }>,
  dest: Readonly<{ x: number; y: number; width: number; height: number }>,
  borders: readonly [number, number, number, number],
): void {
  const maxW = Math.floor(dest.width / 2);
  const maxH = Math.floor(dest.height / 2);
  const top = Math.min(borders[0], maxH);
  const right = Math.min(borders[1], maxW);
  const bottom = Math.min(borders[2], maxH);
  const left = Math.min(borders[3], maxW);
  // Source spans come from the tile geometry (unclamped borders).
  const sxL = tile.x + borders[3];
  const sxR = tile.x + tile.w - borders[1];
  const syT = tile.y + borders[0];
  const syB = tile.y + tile.h - borders[2];
  // Dest spans use the clamped borders.
  const dxL = dest.x + left;
  const dxR = dest.x + dest.width - right;
  const dyT = dest.y + top;
  const dyB = dest.y + dest.height - bottom;
  const slices: ReadonlyArray<readonly [number, number, number, number, number, number, number, number]> = [
    // [sx, sy, sw, sh, dx, dy, dw, dh]
    [tile.x, tile.y, borders[3], borders[0], dest.x, dest.y, left, top],          // top-left
    [sxL, tile.y, sxR - sxL, borders[0], dxL, dest.y, dxR - dxL, top],            // top edge
    [sxR, tile.y, borders[1], borders[0], dxR, dest.y, right, top],               // top-right
    [tile.x, syT, borders[3], syB - syT, dest.x, dyT, left, dyB - dyT],           // left edge
    [sxL, syT, sxR - sxL, syB - syT, dxL, dyT, dxR - dxL, dyB - dyT],             // center
    [sxR, syT, borders[1], syB - syT, dxR, dyT, right, dyB - dyT],                // right edge
    [tile.x, syB, borders[3], borders[2], dest.x, dyB, left, bottom],             // bottom-left
    [sxL, syB, sxR - sxL, borders[2], dxL, dyB, dxR - dxL, bottom],               // bottom edge
    [sxR, syB, borders[1], borders[2], dxR, dyB, right, bottom],                  // bottom-right
  ];
  for (const [sx, sy, sw, sh, dx, dy, dw, dh] of slices) {
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
    context.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
  }
}

/**
 * Draw one entity's authored display tile into its instance rect.
 *
 * Entities are NOT drawn by {@link drawLdtkLevel} — spawning is owned by the
 * translated `LevelData` — so this is the blit for consumers rendering entity
 * art from the LDtk file: an entity def's `tileRect` resolved to the
 * instance `__tile`.
 *
 * Mode semantics (the entity def's `tileRenderMode`):
 *  - `Repeat` — tile across the rect, clipping the last partial column/row
 *    (an authored 40×8 spike strip over an 8×8 tile draws five tiles).
 *  - `Stretch` — one scaled blit filling the rect.
 *  - `FitInside` — scale to fit inside the rect preserving aspect, centered.
 *  - `Cover` — scale to cover the rect preserving aspect, clipped to it.
 *  - `NineSlice` — standard 9-slice when `nineSliceBorders` is supplied
 *    (schema order `[up, right, down, left]`): corners 1:1, top/bottom edges
 *    stretch horizontally, left/right edges stretch vertically, the center
 *    stretches both. Borders clamp to half the rect on their axis, and any
 *    slice whose source or dest span comes out ≤ 0 is SKIPPED — the schema
 *    is silent on under-sized rects and one ships in-repo (Entities.ldtk's
 *    Door: 12px wide against 6+6 borders, a zero-width center by
 *    construction; a zero-size `drawImage` is an error condition, not a
 *    no-op). Without borders, falls back to the geometry heuristic.
 *  - `FullSizeCropped` / `FullSizeUncropped` — the tile at its NATIVE pixel
 *    size, centered in the rect, clipped / not clipped to it (the schema
 *    names but does not define these; semantics per the LDtk editor).
 *  - omitted — the geometry heuristic: an instance no larger than its tile
 *    on both axes draws one plain blit scaled to the rect; a larger instance
 *    repeat-tiles. This preserves how consumers derived the behavior before
 *    the mode was parsed.
 *
 * **Never throws** — a missing tileset, degenerate tile, or throwing draw
 * returns `false` and draws nothing.
 *
 * @param context - The 2D canvas context. Caller owns the base transform;
 *   `dest` is in the context's current coordinate space.
 * @param tile - Source rect — the instance `__tile` (or the def `tileRect`).
 * @param dest - Destination rect (the entity's instance rect).
 * @param tilesets - Tileset bundle the tile's `tilesetUid` resolves against.
 * @param mode - The def's `tileRenderMode`; omit for the geometry heuristic.
 * @param nineSliceBorders - The def's parsed `nineSliceBorders` (required to
 *   render real `NineSlice`; its absence selects the fallback).
 * @returns `true` iff the tile was drawn.
 */
export function drawLdtkEntityTile(
  context: CanvasRenderingContext2D,
  tile: Readonly<{ tilesetUid: number; x: number; y: number; w: number; h: number }>,
  dest: Readonly<{ x: number; y: number; width: number; height: number }>,
  tilesets: Readonly<LdtkTilesetBundle>,
  mode?: LdtkTileRenderMode,
  nineSliceBorders?: readonly [number, number, number, number] | null,
): boolean {
  if (
    context === null || typeof context !== 'object' ||
    tile === null || typeof tile !== 'object' ||
    dest === null || typeof dest !== 'object' ||
    tilesets === null || typeof tilesets !== 'object'
  ) return false;
  if (!isPositiveFinite(tile.w) || !isPositiveFinite(tile.h)) return false;
  if (!isPositiveFinite(dest.width) || !isPositiveFinite(dest.height)) return false;
  const entry = tilesets.get(tile.tilesetUid);
  if (entry === undefined) return false;

  let resolved: LdtkTileRenderMode;
  if (mode === 'Repeat' || mode === 'Stretch' || mode === 'FitInside' || mode === 'Cover') {
    resolved = mode;
  } else if (
    mode === 'NineSlice' &&
    Array.isArray(nineSliceBorders) && nineSliceBorders.length === 4
  ) {
    resolved = 'NineSlice';
  } else if (mode === 'FullSizeCropped' || mode === 'FullSizeUncropped') {
    resolved = mode;
  } else {
    resolved = dest.width <= tile.w && dest.height <= tile.h ? 'Stretch' : 'Repeat';
  }

  context.save();
  try {
    context.imageSmoothingEnabled = false;
    if (resolved === 'Repeat') {
      for (let dy = 0; dy < dest.height; dy += tile.h) {
        for (let dx = 0; dx < dest.width; dx += tile.w) {
          const w = Math.min(tile.w, dest.width - dx); // clip the last partial column
          const h = Math.min(tile.h, dest.height - dy); // and the last partial row
          context.drawImage(entry.image, tile.x, tile.y, w, h, dest.x + dx, dest.y + dy, w, h);
        }
      }
      return true;
    }
    if (resolved === 'NineSlice') {
      drawNineSlices(context, entry.image, tile, dest, nineSliceBorders!);
      return true;
    }
    if (resolved === 'FullSizeCropped' || resolved === 'FullSizeUncropped') {
      // Native pixel size, centered on the rect; Cropped clips to it.
      const dx = dest.x + (dest.width - tile.w) / 2;
      const dy = dest.y + (dest.height - tile.h) / 2;
      if (resolved === 'FullSizeUncropped') {
        context.drawImage(entry.image, tile.x, tile.y, tile.w, tile.h, dx, dy, tile.w, tile.h);
        return true;
      }
      context.save();
      try {
        context.beginPath();
        context.rect(dest.x, dest.y, dest.width, dest.height);
        context.clip();
        context.drawImage(entry.image, tile.x, tile.y, tile.w, tile.h, dx, dy, tile.w, tile.h);
      } finally {
        context.restore();
      }
      return true;
    }
    if (resolved === 'Stretch') {
      context.drawImage(entry.image, tile.x, tile.y, tile.w, tile.h,
        dest.x, dest.y, dest.width, dest.height);
      return true;
    }
    if (resolved === 'FitInside') {
      const scale = Math.min(dest.width / tile.w, dest.height / tile.h);
      const w = tile.w * scale;
      const h = tile.h * scale;
      context.drawImage(entry.image, tile.x, tile.y, tile.w, tile.h,
        dest.x + (dest.width - w) / 2, dest.y + (dest.height - h) / 2, w, h);
      return true;
    }
    // Cover — scale to cover, clipped to the rect.
    const scale = Math.max(dest.width / tile.w, dest.height / tile.h);
    const w = tile.w * scale;
    const h = tile.h * scale;
    context.save();
    try {
      context.beginPath();
      context.rect(dest.x, dest.y, dest.width, dest.height);
      context.clip();
      context.drawImage(entry.image, tile.x, tile.y, tile.w, tile.h,
        dest.x + (dest.width - w) / 2, dest.y + (dest.height - h) / 2, w, h);
    } finally {
      context.restore();
    }
    return true;
  } catch {
    return false;
  } finally {
    context.restore();
  }
}

/**
 * Build a {@link LdtkTilesetBundle} from a parsed project's `defs.tilesets`
 * paired with loaded images. Convenience for the common setup path.
 *
 * Skips tilesets with `embedAtlas: 'LdtkIcons'` (editor-only icon atlas).
 */
export function buildLdtkTilesetBundle(
  tilesets: readonly LdtkTilesetDef[],
  loadImage: (def: LdtkTilesetDef) => CanvasImageSource | undefined,
): LdtkTilesetBundle {
  const map = new Map<number, LdtkTilesetImage>();
  for (const def of tilesets) {
    if (def.embedAtlas === 'LdtkIcons') continue;
    if (def.relPath === null) continue;
    const image = loadImage(def);
    if (image !== undefined) map.set(def.uid, { def, image });
  }
  return map;
}
