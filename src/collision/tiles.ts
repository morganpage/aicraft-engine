/**
 * Tile-grid collision — reuses the AABB resolver against a tile grid.
 *
 * In a tile-based platformer the level is a grid of tiles and the player is an
 * AABB moving through it. Rather than rebuilding a hand-curated list of
 * {@link Solid} rects every tick, these helpers query the **tile grid** for
 * the tiles the moving body overlaps, convert those tiles into `Solid` rects,
 * and delegate to {@link resolveAxisX} / {@link resolveAxisY}. No resolution
 * logic is duplicated — the tile layer is purely a coordinate-translation and
 * tile-range-query layer on top of the existing AABB resolver.
 *
 * All exports are pure: no host access, no `Math.random`, no global state, no
 * mutation of inputs. Safe to call from deterministic simulation code.
 *
 * **Tunneling limitation:** if `vx` or `vy` exceeds `tileSize` in a single
 * tick, the body can skip over a thin tile (the post-move query sees only the
 * destination tiles, not the ones crossed in between). This is the standard
 * discrete-tile-collision trade-off. Consumers should use a fixed `dt` small
 * enough that per-tick movement stays below `tileSize`, or sub-step the move.
 *
 * @module
 */

import type { Rect, Solid, TileSolidityQuery, ResolveXResult, ResolveYResult } from './types';
import { resolveAxisX, resolveAxisY } from './resolve';

/**
 * Convert world-space coordinates to tile-space grid indices.
 *
 * Uses `Math.floor` so negative world coords map correctly: world `-1` with
 * tile size `16` is tile `-1` (not tile `0`), because floor(-1/16) === -1.
 *
 * Pure: no side effects.
 *
 * @example
 * ```ts
 * worldToTile(0, 0, 16);   // { tileX: 0, tileY: 0 }
 * worldToTile(16, 16, 16); // { tileX: 1, tileY: 1 }
 * worldToTile(-1, -1, 16); // { tileX: -1, tileY: -1 }
 * ```
 *
 * @param worldX    - World-space X coordinate.
 * @param worldY    - World-space Y coordinate.
 * @param tileSize  - Pixel size of each (square) tile.
 * @returns The `{ tileX, tileY }` grid indices containing that world point.
 */
export function worldToTile(
  worldX: number,
  worldY: number,
  tileSize: number,
): { tileX: number; tileY: number } {
  return { tileX: Math.floor(worldX / tileSize), tileY: Math.floor(worldY / tileSize) };
}

/**
 * Convert tile-space grid indices to world-space coordinates (the top-left
 * corner of the tile).
 *
 * Pure: no side effects.
 *
 * @example
 * ```ts
 * tileToWorld(0, 0, 16);  // { x: 0, y: 0 }
 * tileToWorld(2, 3, 16);  // { x: 32, y: 48 }
 * tileToWorld(-1, -1, 16); // { x: -16, y: -16 }
 * ```
 *
 * @param tileX    - Tile column index.
 * @param tileY    - Tile row index.
 * @param tileSize - Pixel size of each (square) tile.
 * @returns The world-space `{ x, y }` of the tile's top-left corner.
 */
export function tileToWorld(
  tileX: number,
  tileY: number,
  tileSize: number,
): { x: number; y: number } {
  return { x: tileX * tileSize, y: tileY * tileSize };
}

/**
 * Get the world-space {@link Rect} for a tile. Convenience for debug rendering
 * (drawing tile outlines) and used internally to convert queried tiles into
 * `Solid` rects.
 *
 * Pure: no side effects.
 *
 * @example
 * ```ts
 * tileRect(2, 3, 16); // { x: 32, y: 48, width: 16, height: 16 }
 * ```
 *
 * @param tileX    - Tile column index.
 * @param tileY    - Tile row index.
 * @param tileSize - Pixel size of each (square) tile.
 * @returns The world-space rect covering that tile.
 */
export function tileRect(tileX: number, tileY: number, tileSize: number): Rect {
  return { x: tileX * tileSize, y: tileY * tileSize, width: tileSize, height: tileSize };
}

/**
 * Query the tile grid for non-empty tiles overlapping `body`'s current
 * position, and convert each to a {@link Solid} rect.
 *
 * The tile range is inclusive on both axes. The max index uses
 * `body.{x,y} + body.{width,height} - 1` so a body whose edge merely *touches*
 * the boundary of the next tile does not pull that tile into the query — this
 * matches the strict overlap test in {@link aabbOverlap}.
 *
 * Internal helper (not exported): the tile resolver builds a fresh `Solid[]`
 * each tick and feeds it to the AABB resolver. Passthrough tiles are marked
 * `passthrough: true` so the resolver's existing one-way-platform rules apply.
 *
 * Pure: returns a new array; never mutates `body` or the underlying grid.
 *
 * @param body     - The rect whose overlapping tiles to query.
 * @param query    - Tile solidity classifier.
 * @param tileSize - Pixel size of each (square) tile.
 * @returns `Solid` rects for every non-empty tile the body overlaps.
 */
function querySolidTiles(body: Rect, query: TileSolidityQuery, tileSize: number): Solid[] {
  const solids: Solid[] = [];
  const minTileX = Math.floor(body.x / tileSize);
  const maxTileX = Math.floor((body.x + body.width - 1) / tileSize);
  const minTileY = Math.floor(body.y / tileSize);
  const maxTileY = Math.floor((body.y + body.height - 1) / tileSize);
  for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
      const type = query(tileX, tileY);
      if (type === 'empty') continue;
      solids.push({
        ...tileRect(tileX, tileY, tileSize),
        passthrough: type === 'passthrough',
      });
    }
  }
  return solids;
}

/**
 * Resolve horizontal movement against a tile grid.
 *
 * Moves the body by `vx`, queries the tiles it overlaps at the post-move
 * position, converts solid tiles to {@link Solid} rects, and delegates to
 * {@link resolveAxisX}. Passthrough tiles are ignored on the X axis (the
 * resolver skips passthrough solids horizontally — one-way platforms only
 * block downward Y movement).
 *
 * Zero velocity short-circuits as a no-op. The body is queried at its
 * post-move position so the tiles it will overlap are caught, but the original
 * `body` is passed to the AABB resolver (which performs the move + resolve
 * internally against the supplied `Solid[]`).
 *
 * Pure: returns new values, never mutates `body` or the grid.
 *
 * **Tunneling:** if `|vx| > tileSize`, the body can skip a thin tile wall.
 *
 * @example
 * ```ts
 * const r = resolveTileX(player, player.vx, tileQuery, 16);
 * player.x = r.x;
 * player.vx = r.vx;
 * if (r.hitWall) player.onWallHit();
 * ```
 *
 * @param body     - Current body position (BEFORE applying `vx`).
 * @param vx       - Horizontal velocity to apply this tick.
 * @param query    - Tile solidity classifier.
 * @param tileSize - Pixel size of each (square) tile.
 * @returns Resolved position, adjusted velocity, and wall-hit flag.
 */
export function resolveTileX(
  body: Rect,
  vx: number,
  query: TileSolidityQuery,
  tileSize: number,
): ResolveXResult {
  if (vx === 0) return { x: body.x, vx: 0, hitWall: false };
  const postMove: Rect = { x: body.x + vx, y: body.y, width: body.width, height: body.height };
  const solids = querySolidTiles(postMove, query, tileSize);
  return resolveAxisX(body, vx, solids);
}

/**
 * Resolve vertical movement against a tile grid.
 *
 * Moves the body by `vy`, queries the tiles it overlaps at the post-move
 * position, converts solid tiles to {@link Solid} rects, and delegates to
 * {@link resolveAxisY}.
 *
 * - **Solid tiles** block from both directions: falling (`vy > 0`) lands the
 *   body on top; rising (`vy < 0`) bumps the ceiling from below.
 * - **Passthrough tiles** only block downward movement, and only when the body
 *   was above the tile last tick (`prevBottom <= tile top Y`). This lets a
 *   body rise clean through from below and only land when descending onto the
 *   top face — the classic one-way platform.
 *
 * These rules are enforced entirely by {@link resolveAxisY} via each tile's
 * `passthrough` flag; the tile layer does not reimplement them. Zero velocity
 * short-circuits as a no-op.
 *
 * Pure: returns new values, never mutates `body` or the grid.
 *
 * **Tunneling:** if `|vy| > tileSize`, the body can skip a thin tile floor or
 * ceiling.
 *
 * @example
 * ```ts
 * const prevBottom = player.y + player.height;
 * const r = resolveTileY(player, player.vy, tileQuery, 16, prevBottom);
 * player.y = r.y;
 * player.vy = r.vy;
 * if (r.landed) player.onLand();
 * ```
 *
 * @param body       - Current body position (BEFORE applying `vy`).
 * @param vy         - Vertical velocity to apply this tick.
 * @param query      - Tile solidity classifier.
 * @param tileSize   - Pixel size of each (square) tile.
 * @param prevBottom - The body's bottom Y (`body.y + body.height`) BEFORE this
 *                     tick's vertical move. Drives the passthrough rule.
 * @returns Resolved position, adjusted velocity, landed flag, and ceiling flag.
 */
export function resolveTileY(
  body: Rect,
  vy: number,
  query: TileSolidityQuery,
  tileSize: number,
  prevBottom: number,
): ResolveYResult {
  if (vy === 0) return { y: body.y, vy: 0, landed: false, hitCeiling: false };
  const postMove: Rect = { x: body.x, y: body.y + vy, width: body.width, height: body.height };
  const solids = querySolidTiles(postMove, query, tileSize);
  return resolveAxisY(body, vy, solids, prevBottom);
}
