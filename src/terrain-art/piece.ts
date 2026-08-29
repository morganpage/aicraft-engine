/**
 * Terrain pieces — rendering a terrain fragment as a **finished object** rather
 * than a sliced rectangle.
 *
 * When a platform splits (a pit opening) or breaks apart (a ledge crumbling),
 * the newly-exposed ends must resolve to end-cap tiles instead of showing the
 * raw cross-section of a filled rect. This module owns the *geometry
 * projection* half of that; the caller keeps the tick loop and the transform.
 *
 * It is the rendering sibling of {@link "../collision/moving-gap"}, which owns
 * the **collision** half of "a hole in a platform".
 *
 * ## Bonded vs free
 *
 * Capping reduces to one choice about how a boundary cell samples its
 * neighbours:
 *
 * - **Bonded** — sample the *global* terrain field, including cells outside the
 *   piece. A closed pit's edge cells see the floor next door, resolve to
 *   interior tiles, and the seam disappears.
 * - **Free** — sample only within the piece. Every exposed face resolves to an
 *   end cap, so the piece reads as a finished chunk of ground.
 *
 * Neither needs new resolution code. {@link prepareTerrainArtRuleGrid} already
 * clamps out-of-bounds neighbours to `0`, and `0` is air — which is exactly what
 * makes a boundary cell cap. So the two policies are a choice of *which grid you
 * hand in*: a free piece resolves against its own cells, a bonded piece is a
 * window into the resolved global field.
 *
 * Policy is chosen by **motion family**, not once per piece. The same geometry
 * wants `'bonded'` when eroding in place — it never moves, so its outer end is
 * still welded to its neighbour — and `'free'` when sliding away or falling.
 *
 * ## Determinism
 *
 * Same `(piece, kinds, ruleSet, field)` → byte-identical output, forever. No
 * `Math.random`, no `Date.now`, no DOM reads. Never throws: invalid input yields
 * an empty result rather than an exception, matching the rest of `terrain-art/`.
 *
 * This file is canvas-free. Baking and drawing live in `./piece-render`.
 *
 * @module
 *
 * @see docs/design/terrain-piece-decision.md — the locked API and its rulings.
 * @see ../collision/moving-gap — the collision half of the same problem.
 */

import type { TileGrid } from '../level/types';
import type { TerrainKindDefinition, TerrainArtRuleSet } from './types';
import type { PreparedTerrainArtRuleGrid, ResolvedTerrainArtRuleCell } from './rule-grid';
import { prepareTerrainArtRuleGrid } from './rule-grid';

// ---------------------------------------------------------------------------
// Rect → grid
// ---------------------------------------------------------------------------

/**
 * Minimal rect shape. Declared structurally rather than importing
 * `collision/types`.`Rect` so this module stays free of cross-pillar imports —
 * a `Rect` or `Solid` can still be passed directly.
 */
export interface TerrainPieceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RectsToTileGridResult {
  readonly grid: TileGrid;
  /**
   * Valid rects whose edges do not fall on `tileSize` boundaries. Diagnostic
   * only — the grid is still produced.
   *
   * Worth surfacing rather than logging: under the cell-centre rule a rect
   * thinner than half a cell renders nothing at all, and a level quietly losing
   * thin ledges is very hard to trace back here.
   */
  readonly unalignedRects: number;
  /** Rects skipped as unusable (non-finite, or zero/negative extent). */
  readonly skippedRects: number;
}

const EMPTY_GRID: TileGrid = Object.freeze({
  data: Object.freeze([]) as readonly number[],
  cols: 0,
  rows: 0,
  tileSize: 0,
});

const EMPTY_RECTS_RESULT: RectsToTileGridResult = Object.freeze({
  grid: EMPTY_GRID,
  unalignedRects: 0,
  skippedRects: 0,
});

function usableRect(rect: unknown): rect is TerrainPieceRect {
  if (rect === null || typeof rect !== 'object') return false;
  const r = rect as TerrainPieceRect;
  return (
    Number.isFinite(r.x) && Number.isFinite(r.y) &&
    Number.isFinite(r.width) && Number.isFinite(r.height) &&
    r.width > 0 && r.height > 0
  );
}

/** True when every edge of `rect` lands on a `size` boundary. */
function alignedToGrid(rect: TerrainPieceRect, size: number): boolean {
  return (
    rect.x % size === 0 && rect.y % size === 0 &&
    rect.width % size === 0 && rect.height % size === 0
  );
}

/**
 * Rasterize plain rects into a {@link TileGrid} occupancy field.
 *
 * **Coverage rule: cell centre.** A cell is solid iff some rect covers its
 * centre. Exact for grid-aligned input, and stable for everything else. The
 * alternatives were rejected: *any overlap* over-covers (a 1px intrusion claims
 * a whole cell, growing terrain past its collision box), and *full coverage*
 * under-covers (a half-cell ledge vanishes).
 *
 * Consumers differ on input cleanliness — one may lint its levels to the cell
 * grid, another authoring through a tile editor carries no such guarantee — so
 * misalignment is reported, never thrown.
 *
 * @param rects - World-space rects to rasterize.
 * @param tileSize - Cell size in world units.
 * @param bounds - The world region the grid covers. Cell `(0,0)` sits at
 *   `bounds.x, bounds.y`.
 * @param tileValue - Value written into solid cells. `0` is the empty
 *   convention, so a zero or non-finite value falls back to `1`.
 * @returns The grid plus alignment diagnostics. Never throws.
 */
export function rectsToTileGrid(
  rects: readonly Readonly<TerrainPieceRect>[],
  tileSize: number,
  bounds: Readonly<TerrainPieceRect>,
  tileValue = 1,
): RectsToTileGridResult {
  if (!Number.isFinite(tileSize) || tileSize <= 0) return EMPTY_RECTS_RESULT;
  if (!usableRect(bounds)) return EMPTY_RECTS_RESULT;
  if (!Array.isArray(rects)) return EMPTY_RECTS_RESULT;

  const value = Number.isFinite(tileValue) && tileValue !== 0 ? tileValue : 1;
  const cols = Math.ceil(bounds.width / tileSize);
  const rows = Math.ceil(bounds.height / tileSize);
  if (cols <= 0 || rows <= 0) return EMPTY_RECTS_RESULT;

  const data = new Array<number>(cols * rows).fill(0);
  let unalignedRects = 0;
  let skippedRects = 0;

  for (const raw of rects) {
    if (!usableRect(raw)) { skippedRects++; continue; }
    if (!alignedToGrid(raw, tileSize)) unalignedRects++;

    // Only the cell band this rect can touch — centres outside it can never be
    // covered, so the full grid is never scanned per rect.
    const startCol = Math.max(0, Math.floor((raw.x - bounds.x) / tileSize));
    const endCol = Math.min(cols, Math.ceil((raw.x + raw.width - bounds.x) / tileSize));
    const startRow = Math.max(0, Math.floor((raw.y - bounds.y) / tileSize));
    const endRow = Math.min(rows, Math.ceil((raw.y + raw.height - bounds.y) / tileSize));

    for (let row = startRow; row < endRow; row++) {
      const centerY = bounds.y + (row + 0.5) * tileSize;
      if (centerY < raw.y || centerY >= raw.y + raw.height) continue;
      for (let col = startCol; col < endCol; col++) {
        const centerX = bounds.x + (col + 0.5) * tileSize;
        if (centerX < raw.x || centerX >= raw.x + raw.width) continue;
        data[row * cols + col] = value;
      }
    }
  }

  return Object.freeze({
    grid: Object.freeze({ data: Object.freeze(data) as readonly number[], cols, rows, tileSize }),
    unalignedRects,
    skippedRects,
  });
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * How a piece's boundary cells sample their neighbours.
 *
 * A string union rather than a boolean: every known case is uniform across
 * edges, but should a mixed piece ever be needed this widens to a per-edge form
 * without breaking callers.
 */
export type TerrainPieceBondPolicy = 'bonded' | 'free';

/** A terrain fragment, positioned on the global cell grid. */
export interface TerrainPiece {
  /** Stable id — the bake cache key, and the reserved determinism seed root. */
  readonly id: string;
  /** Piece-local occupancy, row-major. `0` marks cells the piece does not own. */
  readonly cells: Readonly<TileGrid>;
  /** Piece origin on the global cell grid. */
  readonly originCol: number;
  readonly originRow: number;
  readonly bondPolicy: TerrainPieceBondPolicy;
}

const EMPTY_PREPARED: PreparedTerrainArtRuleGrid = Object.freeze({
  cols: 0,
  rows: 0,
  tileSize: 0,
  tiles: Object.freeze([]) as readonly ResolvedTerrainArtRuleCell[],
});

function usablePiece(piece: unknown): piece is TerrainPiece {
  if (piece === null || typeof piece !== 'object') return false;
  const p = piece as TerrainPiece;
  const cells = p.cells as TileGrid | undefined;
  return (
    cells !== null && typeof cells === 'object' &&
    Number.isInteger(cells.cols) && cells.cols > 0 &&
    Number.isInteger(cells.rows) && cells.rows > 0 &&
    Number.isFinite(cells.tileSize) && cells.tileSize > 0 &&
    Array.isArray(cells.data) && cells.data.length >= cells.cols * cells.rows &&
    Number.isInteger(p.originCol) && Number.isInteger(p.originRow)
  );
}

/**
 * Resolve a piece against an already-prepared global field.
 *
 * **Prefer this over {@link resolveTerrainPiece} whenever more than one piece
 * shares a field.** Preparing the field is a whole-field operation; doing it
 * inside the per-piece call means N full-field resolutions for N pieces on every
 * topology change. Prepare once with {@link prepareTerrainArtRuleGrid}, then
 * resolve each piece as a window into the result.
 *
 * Two details that are easy to get wrong, both handled here:
 *
 * 1. **Re-basing.** Output `col`/`row` are piece-local. The renderer draws each
 *    cell at `col * tileSize`, so a window carrying global coordinates would
 *    bake at its world offset inside its own canvas.
 * 2. **Ownership.** Cells inside the bounding box that the piece does not own
 *    resolve to `-1`, whatever the field holds there — otherwise a piece drags
 *    its neighbours' tiles along when it moves.
 *
 * @returns Piece-local rule indices. Never throws.
 */
export function resolveTerrainPieceFromPrepared(
  piece: Readonly<TerrainPiece>,
  preparedField: Readonly<PreparedTerrainArtRuleGrid>,
): PreparedTerrainArtRuleGrid {
  if (!usablePiece(piece)) return EMPTY_PREPARED;
  if (
    preparedField === null || typeof preparedField !== 'object' ||
    !Number.isInteger(preparedField.cols) || preparedField.cols <= 0 ||
    !Array.isArray(preparedField.tiles)
  ) return EMPTY_PREPARED;

  const { cells, originCol, originRow } = piece;
  const tiles: ResolvedTerrainArtRuleCell[] = [];

  for (let row = 0; row < cells.rows; row++) {
    for (let col = 0; col < cells.cols; col++) {
      const owned = (cells.data[row * cells.cols + col] ?? 0) !== 0;
      if (!owned) { tiles.push(Object.freeze({ col, row, ruleIndex: -1 })); continue; }

      const fieldCol = originCol + col;
      const fieldRow = originRow + row;
      if (
        fieldCol < 0 || fieldRow < 0 ||
        fieldCol >= preparedField.cols || fieldRow >= preparedField.rows
      ) { tiles.push(Object.freeze({ col, row, ruleIndex: -1 })); continue; }

      const source = preparedField.tiles[fieldRow * preparedField.cols + fieldCol];
      tiles.push(Object.freeze({ col, row, ruleIndex: source?.ruleIndex ?? -1 }));
    }
  }

  return Object.freeze({
    cols: cells.cols,
    rows: cells.rows,
    tileSize: cells.tileSize,
    tiles: Object.freeze(tiles),
  });
}

/**
 * Resolve a single piece to per-cell rule indices, in piece-local coordinates.
 *
 * Convenience over {@link resolveTerrainPieceFromPrepared} for the genuine
 * one-piece case; it prepares the field internally.
 *
 * `field` is required for `'bonded'` and ignored for `'free'`. A bonded piece
 * with no usable field **degrades to free** rather than throwing — a capped
 * piece is a visible imperfection, an exception is a blank screen.
 *
 * @returns Piece-local rule indices. Never throws.
 */
export function resolveTerrainPiece(
  piece: Readonly<TerrainPiece>,
  kinds: readonly Readonly<TerrainKindDefinition>[],
  ruleSet: Readonly<TerrainArtRuleSet>,
  field?: Readonly<TileGrid>,
): PreparedTerrainArtRuleGrid {
  if (!usablePiece(piece)) return EMPTY_PREPARED;

  if (piece.bondPolicy === 'bonded' && field !== undefined) {
    const preparedField = prepareTerrainArtRuleGrid(field, kinds, ruleSet);
    if (preparedField.cols > 0) return resolveTerrainPieceFromPrepared(piece, preparedField);
    // Unusable field — fall through to free.
  }

  // Free: the piece's own grid IS the world. Out-of-bounds reads inside
  // `prepareTerrainArtRuleGrid` return air, so every exposed face caps.
  return prepareTerrainArtRuleGrid(piece.cells, kinds, ruleSet);
}
