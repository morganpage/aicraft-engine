/**
 * Terrain piece baking and drawing — the Canvas2D half of `./piece`.
 *
 * A resolved piece bakes to one offscreen canvas; the caller draws that canvas
 * under whatever transform it likes. That separation is what lets one primitive
 * serve unrelated motion:
 *
 * ```ts
 * // Rigid pair — a pit splitting open
 * ctx.save(); ctx.translate(x - offset, y); ctx.drawImage(left.canvas, 0, 0); ctx.restore();
 *
 * // Crumble — N chunks under independent gravity
 * for (const c of chunks) {
 *   ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.angle);
 *   ctx.drawImage(c.baked.canvas, 0, 0); ctx.restore();
 * }
 * ```
 *
 * **No motion parameter appears in this module.** Baking an offset in would
 * serve the rigid pair and nothing else — crumble is a different family where
 * each chunk carries its own velocity and scatter. Motion stays with the caller,
 * mirroring how `collision/moving-gap` separates gap motion from gap geometry.
 *
 * Determinism: same `(prepared, atlas, image)` → byte-identical pixels. Never
 * throws; when no canvas host is available the bake returns `undefined` so the
 * caller can keep its own fallback path.
 *
 * @module
 *
 * @see ./piece — resolution, and the bonded/free explanation.
 * @see docs/design/terrain-piece-decision.md — the locked API and its rulings.
 */

import { fnv1aHash } from '../hash/fnv1a';
import { drawPreparedTerrainArtRuleGrid } from './runtime-renderer';
import type { TerrainArtRuleAtlas } from './rule-atlas';
import type { PreparedTerrainArtRuleGrid } from './rule-grid';

// ---------------------------------------------------------------------------
// Baking
// ---------------------------------------------------------------------------

/**
 * A canvas a piece can be baked into. Accepts browser (`HTMLCanvasElement`,
 * `OffscreenCanvas`) and node-canvas objects alike — mirrors
 * `LdtkSurfaceCanvas`.
 */
export interface TerrainPieceCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
}

/**
 * Optional factory so baking works in any host. In a browser it can be omitted
 * (the bake falls back to `OffscreenCanvas`, then `document.createElement`).
 * Under node-canvas (tests), pass `createCanvas` from the `canvas` package.
 * Returning `undefined` disables baking rather than throwing.
 */
export type TerrainPieceCanvasFactory =
  (width: number, height: number) => TerrainPieceCanvas | undefined;

export interface BakeTerrainPieceOptions {
  readonly atlas: Readonly<TerrainArtRuleAtlas>;
  /** The atlas pixels as a drawable image. */
  readonly image: CanvasImageSource;
  readonly createCanvas?: TerrainPieceCanvasFactory;
}

export interface BakedTerrainPiece {
  readonly canvas: TerrainPieceCanvas;
  readonly width: number;
  readonly height: number;
  /** Tiles actually drawn. `0` means the piece resolved to nothing. */
  readonly tiles: number;
}

/** Canvas acquisition ladder, matching `ldtk/surface.ts`. */
function createPieceCanvas(
  width: number,
  height: number,
  factory?: TerrainPieceCanvasFactory,
): TerrainPieceCanvas | undefined {
  try {
    if (factory !== undefined) return factory(width, height);
    if (typeof OffscreenCanvas !== 'undefined') {
      return new OffscreenCanvas(width, height) as unknown as TerrainPieceCanvas;
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

function usablePrepared(prepared: unknown): prepared is PreparedTerrainArtRuleGrid {
  if (prepared === null || typeof prepared !== 'object') return false;
  const p = prepared as PreparedTerrainArtRuleGrid;
  return (
    Number.isInteger(p.cols) && p.cols > 0 &&
    Number.isInteger(p.rows) && p.rows > 0 &&
    Number.isFinite(p.tileSize) && p.tileSize > 0 &&
    Array.isArray(p.tiles)
  );
}

function usableBaked(baked: unknown): baked is BakedTerrainPiece {
  if (baked === null || typeof baked !== 'object') return false;
  const b = baked as BakedTerrainPiece;
  return (
    Number.isFinite(b.width) && b.width > 0 &&
    Number.isFinite(b.height) && b.height > 0 &&
    b.canvas !== null && typeof b.canvas === 'object'
  );
}

/**
 * Bake a resolved piece to its own canvas, at piece-local origin.
 *
 * @returns The baked surface, or `undefined` when no canvas host is available or
 *   the input is unusable. Never throws.
 */
export function bakeTerrainPiece(
  prepared: Readonly<PreparedTerrainArtRuleGrid>,
  options: Readonly<BakeTerrainPieceOptions>,
): BakedTerrainPiece | undefined {
  if (!usablePrepared(prepared)) return undefined;
  if (options === null || typeof options !== 'object') return undefined;

  const width = prepared.cols * prepared.tileSize;
  const height = prepared.rows * prepared.tileSize;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return undefined;
  }

  const canvas = createPieceCanvas(width, height, options.createCanvas);
  if (canvas === undefined) return undefined;
  const context = canvas.getContext('2d');
  if (context === null) return undefined;

  try {
    // Own the smoothing state like every sibling pixel-art path: under
    // caller-default smoothing a fractional camera zoom bilinear-filters the
    // baked piece into a blur.
    context.imageSmoothingEnabled = false;
    const tiles = drawPreparedTerrainArtRuleGrid(context, prepared, {
      atlas: options.atlas,
      image: options.image,
      // The whole piece — a baked surface is never viewport-culled; culling is
      // the caller's job once the piece is placed in the world.
      view: { x: 0, y: 0, width, height },
    });
    return Object.freeze({ canvas, width, height, tiles });
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * A cheap topology fingerprint: dimensions plus the rule-index sequence.
 *
 * Only what changes the baked pixels is included. Piece **position** is
 * deliberately excluded — moving a piece must not rebake it, which is the whole
 * point of the caller owning the transform.
 */
export function terrainPieceFingerprint(prepared: Readonly<PreparedTerrainArtRuleGrid>): number {
  if (!usablePrepared(prepared)) return 0;
  let text = `${prepared.cols}x${prepared.rows}@${prepared.tileSize}:`;
  for (const tile of prepared.tiles) text += `${tile.ruleIndex},`;
  return fnv1aHash(text);
}

export interface TerrainPieceCache {
  /** Bake on miss, reuse on hit. Rebakes when the piece's topology changes. */
  get(
    id: string,
    prepared: Readonly<PreparedTerrainArtRuleGrid>,
    options: Readonly<BakeTerrainPieceOptions>,
  ): BakedTerrainPiece | undefined;
  /** Total bakes performed — observability for the once-per-topology invariant. */
  bakeCount(): number;
  drop(id: string): void;
  clear(): void;
}

interface CacheEntry {
  readonly baked: BakedTerrainPiece;
  readonly prepared: Readonly<PreparedTerrainArtRuleGrid>;
  readonly fingerprint: number;
}

/**
 * Create a bake cache keyed by piece id.
 *
 * **Invalidation is by fingerprint, not by caller discipline.**
 * `createLdtkLevelSurfaceCache` keys on level iid and asks the consumer to
 * `drop`/`clear` after edits — right for levels, which change at authoring
 * time. A terrain piece flips bonded→free at the exact frame a pit opens, every
 * time it opens, and a missed `drop` would render caps on a still-closed pit.
 * Storing a topology hash makes "bake once per topology change" true by
 * construction instead.
 *
 * Reference identity is checked before hashing, so a caller holding a stable
 * prepared object pays nothing, and a caller that re-resolves every frame still
 * bakes exactly once. `drop`/`clear` remain for explicit control.
 */
export function createTerrainPieceCache(
  options?: Readonly<{ createCanvas?: TerrainPieceCanvasFactory }>,
): TerrainPieceCache {
  const entries = new Map<string, CacheEntry>();
  let bakes = 0;

  return {
    get(id, prepared, bakeOptions) {
      if (typeof id !== 'string' || id.length === 0) return undefined; // no stable key
      const cached = entries.get(id);
      if (cached !== undefined) {
        if (cached.prepared === prepared) return cached.baked; // same object, same topology
        if (cached.fingerprint === terrainPieceFingerprint(prepared)) return cached.baked;
      }
      const baked = bakeTerrainPiece(prepared, {
        ...bakeOptions,
        createCanvas: bakeOptions.createCanvas ?? options?.createCanvas,
      });
      if (baked === undefined) return undefined;
      bakes++;
      entries.set(id, { baked, prepared, fingerprint: terrainPieceFingerprint(prepared) });
      return baked;
    },
    bakeCount: () => bakes,
    drop: (id) => { entries.delete(id); },
    clear: () => { entries.clear(); },
  };
}

// ---------------------------------------------------------------------------
// Drawing a partially-hidden piece
// ---------------------------------------------------------------------------

/** Which edge is anchored — the edge that does not move. */
export type TerrainPieceAnchor = 'left' | 'right' | 'top' | 'bottom';

/**
 * Draw a baked piece that is **sliding into a wall**.
 *
 * Shrinking motion would otherwise be the one case needing per-frame re-tiling:
 * as a piece narrows, the cell at its free end keeps changing which rule it
 * matches. This collapses it into rigid motion — bake once at full size, then
 * clip the anchored edge:
 *
 * ```text
 * anchor 'left', full width 64
 *
 *   extent 64   [############]  fully extended
 *   extent 32   [######]        free end has travelled 32px into the wall
 *               ^ wall face, fixed at x
 * ```
 *
 * The piece is offset so the surviving art is its **far** portion — where the
 * free end's cap lives. A retracting platform therefore keeps its capped end all
 * the way in, while the anchored end's cap is inside the wall and covered by the
 * static terrain drawn on top.
 *
 * For ground being eaten away *in place*, use {@link drawMaskedTerrainPiece}.
 *
 * @param visibleExtent - How much of the piece is out of the wall, in pixels,
 *   along the anchored axis. Clamped to `[0, full]`.
 * @param x - Left of the piece's **full-size** footprint; it does not move as
 *   the piece retracts, so callers vary only `visibleExtent`.
 * @returns `true` when something was drawn. Never throws.
 */
export function drawClippedTerrainPiece(
  context: CanvasRenderingContext2D,
  baked: Readonly<BakedTerrainPiece>,
  anchor: TerrainPieceAnchor,
  visibleExtent: number,
  x: number,
  y: number,
): boolean {
  if (context === null || typeof context !== 'object') return false;
  if (!usableBaked(baked)) return false;
  if (!Number.isFinite(visibleExtent)) return false;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  const horizontal = anchor === 'left' || anchor === 'right';
  if (!horizontal && anchor !== 'top' && anchor !== 'bottom') return false;

  const full = horizontal ? baked.width : baked.height;
  const extent = Math.min(Math.max(visibleExtent, 0), full);
  if (extent <= 0) return false;
  const hidden = full - extent;

  // Clip window pinned at the anchored edge; the piece offset so its FREE end
  // lands on the window's free side. Both derive from `hidden`, so they can
  // never disagree.
  let clipX = x, clipY = y, clipW = baked.width, clipH = baked.height;
  let drawX = x, drawY = y;
  switch (anchor) {
    case 'left':   clipW = extent; drawX = x - hidden; break;
    case 'right':  clipW = extent; clipX = x + hidden; drawX = x + hidden; break;
    case 'top':    clipH = extent; drawY = y - hidden; break;
    case 'bottom': clipH = extent; clipY = y + hidden; drawY = y + hidden; break;
  }

  context.save();
  try {
    context.beginPath();
    context.rect(clipX, clipY, clipW, clipH);
    context.clip();
    context.imageSmoothingEnabled = false;
    context.drawImage(baked.canvas as unknown as CanvasImageSource, drawX, drawY);
  } catch {
    return false;
  } finally {
    // Balance the save even if the blit throws. A leaked clip region is silent
    // and frame-wide — every subsequent draw would be cropped to this window.
    context.restore();
  }
  return true;
}

/**
 * Draw a baked piece whose end is **eroded in place**.
 *
 * The difference from {@link drawClippedTerrainPiece} is one offset. There the
 * piece translates and reads as retreating into a wall. Here it stays exactly
 * where it is and the clip eats inward from the free end, so the texture is
 * pinned to the ground and the end simply disappears:
 *
 * ```text
 * anchor 'left', full 64 — texture pinned at x, eroding from the right
 *
 *   extent 64   [A B C D]
 *   extent 48   [A B C ]        D is gone; A B C have not moved
 *   extent 32   [A B ]
 * ```
 *
 * This is the shape crumbling terrain wants: ground being consumed, not ground
 * retreating.
 *
 * ## The cap is a separate overlay, and is off by default
 *
 * A pure mask leaves the raw cross-section at the cut — and the cap baked into
 * the body sits at the piece's *original* end, so the mask eats it first.
 * Passing `cap` fixes that without re-tiling: a one-tile strip, baked once, is
 * drawn at the moving boundary *inside* the same clip, so it trims rather than
 * spilling. The body stays static and masked; only the cap moves.
 *
 * Omit it for a raw cut, which is usually what fracture should look like — a
 * bevelled cap reads as *finished* where a raw cut reads as *freshly broken*.
 * The cap suits an edge that was always meant to exist, such as a sliding ledge.
 *
 * @param visibleExtent - How much of the piece survives, in pixels, measured
 *   from the anchored edge. Clamped to `[0, full]`.
 * @param cap - Optional end-cap strip drawn at the eroding boundary.
 * @returns `true` when something was drawn. Never throws.
 */
export function drawMaskedTerrainPiece(
  context: CanvasRenderingContext2D,
  baked: Readonly<BakedTerrainPiece>,
  anchor: TerrainPieceAnchor,
  visibleExtent: number,
  x: number,
  y: number,
  cap?: Readonly<BakedTerrainPiece>,
): boolean {
  if (context === null || typeof context !== 'object') return false;
  if (!usableBaked(baked)) return false;
  if (!Number.isFinite(visibleExtent)) return false;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  const horizontal = anchor === 'left' || anchor === 'right';
  if (!horizontal && anchor !== 'top' && anchor !== 'bottom') return false;

  const full = horizontal ? baked.width : baked.height;
  const extent = Math.min(Math.max(visibleExtent, 0), full);
  if (extent <= 0) return false;
  const hidden = full - extent;

  // Clip window pinned at the anchored edge exactly as in the slide variant —
  // but the piece is NOT offset, so the texture stays put.
  let clipX = x, clipY = y, clipW = baked.width, clipH = baked.height;
  switch (anchor) {
    case 'left':   clipW = extent; break;
    case 'right':  clipW = extent; clipX = x + hidden; break;
    case 'top':    clipH = extent; break;
    case 'bottom': clipH = extent; clipY = y + hidden; break;
  }

  context.save();
  try {
    context.beginPath();
    context.rect(clipX, clipY, clipW, clipH);
    context.clip();
    context.imageSmoothingEnabled = false;
    context.drawImage(baked.canvas as unknown as CanvasImageSource, x, y);

    if (cap !== undefined && usableBaked(cap)) {
      let capX = x, capY = y;
      switch (anchor) {
        case 'left':   capX = x + extent - cap.width; break;
        case 'right':  capX = x + hidden; break;
        case 'top':    capY = y + extent - cap.height; break;
        case 'bottom': capY = y + hidden; break;
      }
      context.drawImage(cap.canvas as unknown as CanvasImageSource, capX, capY);
    }
  } catch {
    return false;
  } finally {
    context.restore();
  }
  return true;
}
