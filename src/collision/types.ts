/**
 * Type definitions for the collision module.
 *
 * AABB (axis-aligned bounding box) collision is the foundation of the
 * platformer physics layer. These types are the pure-data contract between
 * a game's simulation (which tracks body position + velocity) and the
 * move-and-resolve helpers in `resolve.ts`.
 *
 * The simulation owns authoritative state; these helpers are pure readers
 * that return resolved positions without mutating inputs.
 *
 * @module
 */

/**
 * Axis-aligned bounding box. The fundamental collision shape.
 *
 * Coordinates are world-space. `x`/`y` is the top-left corner; the box spans
 * `[x, x + width]` horizontally and `[y, y + height]` vertically.
 */
export interface Rect {
  /** World X of the top-left corner. */
  x: number;
  /** World Y of the top-left corner. */
  y: number;
  /** Box width in world units. */
  width: number;
  /** Box height in world units. */
  height: number;
}

/**
 * A static collision surface. Extends {@link Rect} with an optional
 * passthrough flag.
 */
export interface Solid extends Rect {
  /**
   * If `true`, the solid only blocks downward movement (falling onto its top
   * face from above). A body rising into it from below, or moving horizontally
   * into it, passes through unaffected. Used for one-way platforms.
   *
   * Default: `false` (fully solid — blocks from all directions).
   */
  passthrough?: boolean;
}

/**
 * Result of resolving horizontal movement against solids.
 */
export interface ResolveXResult {
  /** Resolved X position (snapped to a wall edge if a collision occurred). */
  x: number;
  /** Horizontal velocity after resolution (`0` if a wall was hit, unchanged otherwise). */
  vx: number;
  /** `true` if the body collided with a wall this tick. */
  hitWall: boolean;
}

/**
 * Result of resolving vertical movement against solids.
 */
export interface ResolveYResult {
  /** Resolved Y position (snapped to a surface if a collision occurred). */
  y: number;
  /** Vertical velocity after resolution (`0` if landed or hit a ceiling, unchanged otherwise). */
  vy: number;
  /** `true` if the body landed on top of a solid (ground contact). */
  landed: boolean;
  /** `true` if the body hit a ceiling (head bumped against a solid's underside). */
  hitCeiling: boolean;
}

/**
 * Tile solidity classification for the tile-grid query.
 *
 * - `'empty'` — no collision (air / decorative).
 * - `'solid'` — fully solid surface (blocks from all directions).
 * - `'passthrough'` — one-way platform (blocks downward movement only).
 *
 * @see TileSolidityQuery
 */
export type TileType = 'empty' | 'solid' | 'passthrough';

/**
 * Classifies a tile at grid coordinates. The consumer wraps their tile data
 * structure (2D array, flat array, string map, procedural function) behind
 * this uniform interface. Out-of-bounds tiles should return `'empty'` (or
 * `'solid'` for level boundaries — the consumer's choice).
 *
 * Pure: the query is a reader of the underlying tile data; it must not mutate
 * game state. Tile collision helpers call it many times per tick, so it should
 * be cheap (a direct array/lookup, not a traversal).
 *
 * @example
 * ```ts
 * const grid: number[][] = [[1, 1, 1], [1, 0, 0], [1, 0, 0]];
 * const query: TileSolidityQuery = (tileX, tileY) => {
 *   if (tileY < 0 || tileY >= grid.length || tileX < 0 || tileX >= grid[0].length) return 'empty';
 *   return grid[tileY][tileX] === 1 ? 'solid' : 'empty';
 * };
 * ```
 */
export type TileSolidityQuery = (tileX: number, tileY: number) => TileType;
