import {
  runLdtkAutoLayer,
  type LdtkLayerDef,
  type LdtkRuleGridSource,
  type LdtkSurfaceCanvas,
  type LdtkSurfaceCanvasFactory,
  type LdtkTile,
  type LdtkTilesetImage,
} from 'aicraft-engine';

/** Options for {@link bakeLdtkEntityTileArt}. */
export interface LdtkEntityTileArtOptions {
  /**
   * The room's REAL IntGrid (from `ldtkRuleSourceFromCsv(intGridCsv, cols,
   * rows, layerDef)`). The footprint is stamped in-context on top of it, so
   * edge/corner rules resolve against the true neighbours — the ceiling a
   * block hangs from, the floor it will land on. An ISOLATED grid is wrong
   * by construction: rules with `outOfBoundsValue` treat the void as a
   * value, and an all-empty surround autotiles as all-fill.
   */
  readonly source: Readonly<LdtkRuleGridSource>;
  /** The IntGrid layer definition supplying the auto-rule groups. */
  readonly layerDef: Readonly<LdtkLayerDef>;
  /** The tileset the rules paint from (image + geometry). */
  readonly tileset: Readonly<LdtkTilesetImage>;
  /** The layer's grid size in pixels (`__gridSize`). */
  readonly gridSize: number;
  /**
   * The entity's footprint in TILES: top-left cell + extent. Stamped with
   * `value` before the rules run; the bake is cropped to exactly this rect.
   */
  readonly footprint: Readonly<{ tx: number; ty: number; w: number; h: number }>;
  /** The IntGrid value to stamp (the block's material). `0` (empty) degrades. */
  readonly value: number;
  /** Deterministic rule seed (rules with `chance`/Perlin consume it). Default 0. */
  readonly seed?: number;
  /** Canvas factory for the bake (node-canvas under test hosts). */
  readonly createCanvas?: LdtkSurfaceCanvasFactory;
}

/**
 * Bake an LDtk ENTITY's art with the project's OWN auto-tile rules — the
 * fix for the "falling block rendered as a hardcoded bordered rectangle"
 * class of placeholder.
 *
 * LDtk entities are not part of the level's baked `autoLayerTiles`, so
 * nothing paints a terrain-like entity (falling block, push block, crumble
 * slab) unless the game does. This recipe stamps the entity's footprint
 * into the room's real IntGrid, runs the project's rules windowed to the
 * footprint, and blits the emitted tiles — flip bits and alpha honored —
 * into one entity-sized offscreen canvas. Bake once per room entry and
 * `drawImage` the canvas at the entity's CURRENT position each frame (for a
 * falling block: render from `originY` while simulating from `y`); the art
 * travels intact wherever the entity moves.
 *
 * The stamp is a functional override of the source's `valueAt` (footprint
 * cells read as `value`, everything else reads through), so the original
 * grid is never copied or mutated.
 *
 * **Never throws.** No matching rules, a `0`/invalid value or footprint, a
 * missing canvas host, or a throwing draw degrades to `undefined` — render
 * your readable fallback slab instead.
 *
 * @returns the baked entity-art canvas, or `undefined` on any degrade path
 *
 * @example
 * ```ts
 * const art = bakeLdtkEntityTileArt({
 *   source: ldtkRuleSourceFromCsv(layer.intGridCsv, cols, rows, layerDef),
 *   layerDef, tileset, gridSize: layer.__gridSize,
 *   footprint: { tx: block.tx, ty: block.originTy, w: block.tw, h: block.th },
 *   value: block.material,
 * });
 * if (art) ctx.drawImage(art, block.x, block.y);
 * else drawFallbackSlab(ctx, block); // readable degrade, never a throw
 * ```
 */
export function bakeLdtkEntityTileArt(
  options: Readonly<LdtkEntityTileArtOptions>,
): LdtkSurfaceCanvas | undefined {
  try {
    const { source, layerDef, tileset, footprint } = options;
    if (source === null || typeof source !== 'object') return undefined;
    if (layerDef === null || typeof layerDef !== 'object') return undefined;
    if (tileset === null || typeof tileset !== 'object') return undefined;
    const { tx, ty, w, h } = footprint ?? {};
    if (!isCount(tx) || !isCount(ty) || !isPositiveCount(w) || !isPositiveCount(h)) {
      return undefined;
    }
    if (!(options.value > 0)) return undefined;
    const gridSize = options.gridSize > 0 ? options.gridSize : 0;
    if (gridSize === 0) return undefined;

    // In-context stamp: footprint cells read as `value`, all else reads the
    // room's real grid — neighbours resolve against true geometry.
    const stamped: LdtkRuleGridSource = {
      cols: source.cols,
      rows: source.rows,
      groupOf: (value) => source.groupOf(value),
      valueAt: (cx, cy) =>
        cx >= tx && cx < tx + w && cy >= ty && cy < ty + h
          ? options.value
          : source.valueAt(cx, cy),
    };

    const def = tileset.def;
    const tiles = runLdtkAutoLayer(stamped, layerDef, {
      seed: options.seed ?? 0,
      gridSize,
      region: { cx: tx, cy: ty, cols: w, rows: h },
      tileset: {
        cWid: def.__cWid > 0 ? def.__cWid : 1,
        tileGridSize: def.tileGridSize > 0 ? def.tileGridSize : gridSize,
        padding: def.padding ?? 0,
        spacing: def.spacing ?? 0,
      },
    });
    if (tiles.length === 0) return undefined;

    const canvas = (options.createCanvas ?? defaultCreateCanvas)(w * gridSize, h * gridSize);
    if (canvas === undefined) return undefined;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return undefined;

    ctx.imageSmoothingEnabled = false;
    let drawn = 0;
    for (const tile of tiles) {
      const destX = tile.px[0] - tx * gridSize;
      const destY = tile.px[1] - ty * gridSize;
      // Rules can emit slightly outside the window via tile pivots; the bake
      // is the footprint, so skip anything off its canvas.
      if (destX < -gridSize || destY < -gridSize || destX >= w * gridSize || destY >= h * gridSize) {
        continue;
      }
      if (blitTile(ctx, tileset.image, tile, gridSize, destX, destY)) drawn++;
    }
    return drawn > 0 ? canvas : undefined;
  } catch {
    return undefined;
  }
}

/** Canvas resolution mirroring the engine's surface cache: consumer factory,
 * then `OffscreenCanvas`, then `document.createElement('canvas')`; `undefined`
 * (no host) disables the bake. */
function defaultCreateCanvas(width: number, height: number): LdtkSurfaceCanvas | undefined {
  try {
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
}

/** Tile blit honoring LDtk flip bits and per-tile alpha — same semantics as
 * the engine renderer's internal blit (draw around the tile center under a
 * mirror when flipped). Returns `false` for a fully transparent tile. */
function blitTile(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  tile: Readonly<LdtkTile>,
  tileSize: number,
  destX: number,
  destY: number,
): boolean {
  const flipX = ((tile.f ?? 0) & 1) !== 0;
  const flipY = ((tile.f ?? 0) & 2) !== 0;
  const alpha = tile.a ?? 1;
  if (alpha <= 0) return false;
  context.save();
  try {
    if (alpha < 1) context.globalAlpha *= alpha;
    if (flipX || flipY) {
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
  } finally {
    context.restore();
  }
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function isPositiveCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}
