/**
 * Collision module — AABB overlap test, per-axis move-and-resolve, and
 * tile-grid collision.
 *
 * The foundational platformer collision layer. All exports are pure functions
 * over plain data: no host access, no `Math.random`, no global state. Safe to
 * call from deterministic simulation code.
 *
 * The tile-grid helpers (`resolveTileX` / `resolveTileY`) are a thin layer on
 * top of the AABB resolver: they translate between world and tile space, query
 * the grid for overlapping tiles, and delegate resolution to
 * {@link resolveAxisX} / {@link resolveAxisY}. No resolution logic is
 * duplicated.
 *
 * @module
 */

export type { Rect, Solid, ResolveXResult, ResolveYResult, TileType, TileSolidityQuery } from './types';

export { aabbOverlap, overlapsLadder } from './aabb';

export { checkLineOfSight, LOS_MAX_VISITED_TILES } from './los';

export { resolveAxisX, resolveAxisY } from './resolve';

export { worldToTile, tileToWorld, tileRect, resolveTileX, resolveTileY } from './tiles';

export type {
  GapSpanConfig,
  GapGeometry,
  GapTravelMode,
  GapLoopMode,
  GapMotionConfig,
  GapMotionState,
} from './moving-gap';

export {
  gapSolids,
  createGapMotion,
  advanceGapMotion,
  gapTileQuery,
  DEFAULT_GAP_WIDTH,
  DEFAULT_GAP_SPEED,
  DEFAULT_CHASE_GIVE_UP_RADIUS,
} from './moving-gap';
