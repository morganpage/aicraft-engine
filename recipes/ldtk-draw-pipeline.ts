import {
  createLdtkLevelSurfaceCache,
  type LdtkDrawView,
  type LdtkLevel,
  type LdtkSurfaceCanvasFactory,
  type LdtkTilesetBundle,
} from 'aicraft-engine';

/** Options for {@link createLdtkRoomPainter}. */
export interface LdtkRoomPainterOptions {
  /**
   * Canvas factory for the baked surfaces (the cache's own option — pass
   * node-canvas's `createCanvas` under test hosts). Defaults to
   * `OffscreenCanvas` / `document.createElement('canvas')` in the browser.
   */
  readonly createCanvas?: LdtkSurfaceCanvasFactory;
}

/** Per-frame draw options. */
export interface LdtkRoomDrawOptions {
  /**
   * World-space culling rectangle. Honored on the cache's direct-draw
   * fallback path; ignored on the baked blit path (a single blit needs no
   * culling) — pass it anyway so fallback frames cull identically.
   */
  readonly view?: LdtkDrawView;
  /** Camera world translate for this frame (feed your camera transform's x/y). */
  readonly worldOffset?: Readonly<{ x: number; y: number }>;
}

/** A level painter backed by a baked surface cache. */
export interface LdtkRoomPainter {
  /**
   * Draw a level through its baked surface (single blit per frame at
   * `worldOffset` inside the caller's transform), falling back to the direct
   * draw path when no canvas host is available. Returns the tile count
   * baked into the surface. Never throws.
   */
  draw(
    context: CanvasRenderingContext2D,
    level: Readonly<LdtkLevel>,
    options?: Readonly<LdtkRoomDrawOptions>,
  ): number;
  /** `true` iff a surface is baked for the level iid. */
  has(iid: string): boolean;
  /** Drop one level's surface — call after editing that level (hot reload). */
  invalidate(iid: string): void;
  /** Drop all cached surfaces — call after a tileset image changes. */
  invalidateAll(): void;
}

/**
 * The LDtk draw pipeline as one object: create the surface cache once at
 * boot, `draw` per frame with the camera's `worldOffset` and a culling
 * `view`, and `invalidate` the one edited level instead of rebuilding
 * everything (the live-edit/hot-reload path).
 *
 * Draws LEVELS, not layers: `drawLdtkLevel` applies `worldOffset` for you,
 * while `drawLdtkLayer` has no such parameter — routing room art through
 * the level API is the parity-safe shape, and the baked path is faster
 * regardless.
 *
 * @example
 * ```ts
 * const painter = createLdtkRoomPainter(tilesets);
 * // per frame, inside your camera transform:
 * painter.draw(ctx, level, { view, worldOffset: { x: cam.x, y: cam.y } });
 * // after a live edit of Level_1:
 * painter.invalidate('Level_1-iid');
 * ```
 */
export function createLdtkRoomPainter(
  tilesets: LdtkTilesetBundle,
  options: Readonly<LdtkRoomPainterOptions> = {},
): LdtkRoomPainter {
  const cache = createLdtkLevelSurfaceCache({ createCanvas: options.createCanvas });
  return {
    draw(context, level, drawOptions = {}) {
      return cache.draw(context, level, {
        tilesets,
        view: drawOptions.view,
        worldOffset: drawOptions.worldOffset,
      });
    },
    has(iid) {
      return cache.has(iid);
    },
    invalidate(iid) {
      cache.drop(iid);
    },
    invalidateAll() {
      cache.clear();
    },
  };
}
