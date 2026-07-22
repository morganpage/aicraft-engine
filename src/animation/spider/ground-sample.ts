/**
 * Deterministic ground sampling for the procedural spider.
 *
 * Samples the tile grid downward from an origin point to find the nearest
 * solid surface. Used by the gait solver to determine where feet should
 * plant.
 *
 * **Foot-snap fix.** The prototype returned a point INSIDE the first solid
 * tile, causing feet to plant ~1 tile below the visible floor. This module
 * returns the **surface point** — the top edge of the first solid tile when
 * sampling downward — so feet plant exactly on the visible floor surface.
 *
 * **Determinism contract.** Pure, deterministic, no host access. Only called
 * when a leg is about to step (lazy sampling — not every frame for every
 * leg). Never throws.
 *
 * **Floor-only v1.** The sampling direction is taken as a parameter for
 * future wall/ceiling support, but v1 hard-codes downward `{x:0, y:1}` at
 * the call site. Adding a `samplingDirection` config field later is a
 * non-breaking extension.
 *
 * @module
 */

import type { Vec2 } from '../types';
import type { TileSolidityQuery } from '../../collision/types';
import { worldToTile, tileToWorld } from '../../collision/tiles';

/**
 * Result of a ground sample query.
 */
export interface GroundSampleResult {
  /** World-space point where solid ground was found (surface point). */
  readonly point: Vec2;
  /** Surface normal (pointing away from solid). For downward floor: `{x:0, y:-1}`. */
  readonly normal: Vec2;
  /** Whether solid ground was found within `maxDistance`. */
  readonly hasGround: boolean;
}

/**
 * Safe fallback result when sampling cannot proceed (degenerate inputs).
 */
const NO_GROUND: Readonly<GroundSampleResult> = {
  point: { x: 0, y: 0 },
  normal: { x: 0, y: -1 },
  hasGround: false,
};

/**
 * Sample the nearest solid tile from an origin point in a given direction.
 *
 * Steps through the tile grid checking solidity via the provided
 * {@link TileSolidityQuery}. Stops at the first solid tile. Returns the
 * **surface point** (the tile's top edge for downward sampling), not a
 * point inside the tile.
 *
 * Pure, deterministic, no host access. Never throws. Handles:
 * - No solid within `maxDistance` → `{hasGround: false}`.
 * - Zero/negative `tileSize` → safe no-op.
 * - Passthrough tiles → ignored (not plantable from above in v1).
 * - Non-finite origin → safe fallback.
 *
 * @param originX - world-space X to sample from
 * @param originY - world-space Y to sample from
 * @param directionX - sample direction X (normalized; 0 for floor-only v1)
 * @param directionY - sample direction Y (normalized; 1 for downward)
 * @param maxDistance - maximum sample distance in px
 * @param tileSize - tile grid cell size in px
 * @param tileQuery - tile solidity query
 * @returns ground sample result
 */
export function sampleGround(
  originX: number,
  originY: number,
  directionX: number,
  directionY: number,
  maxDistance: number,
  tileSize: number,
  tileQuery: TileSolidityQuery,
): GroundSampleResult {
  // Defensive: degenerate inputs → safe no-op.
  if (!Number.isFinite(originX) || !Number.isFinite(originY)) return NO_GROUND;
  if (!Number.isFinite(tileSize) || tileSize <= 0) return NO_GROUND;
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) return NO_GROUND;

  // Normalize direction
  const dirLen = Math.sqrt(directionX * directionX + directionY * directionY);
  if (dirLen < 1e-8) return NO_GROUND;
  const ndx = directionX / dirLen;
  const ndy = directionY / dirLen;

  // Step through the tile grid in the sampling direction.
  // Use half-tile steps to avoid skipping thin tiles.
  const stepSize = tileSize / 2;
  const steps = Math.max(1, Math.ceil(maxDistance / stepSize));
  const stepX = ndx * stepSize;
  const stepY = ndy * stepSize;

  for (let i = 0; i <= steps; i++) {
    const checkX = originX + stepX * i;
    const checkY = originY + stepY * i;
    const { tileX, tileY } = worldToTile(checkX, checkY, tileSize);
    const tileType = tileQuery(tileX, tileY);

    if (tileType === 'solid') {
      // Found a solid tile. Return the SURFACE POINT — the top edge of the
      // tile for downward sampling, not a point inside the tile.
      const tileOrigin = tileToWorld(tileX, tileY, tileSize);

      // For downward sampling (directionY > 0), the surface is the tile's
      // top edge (tileOrigin.y).
      // For general directions, we'd compute the entry face, but v1 is
      // floor-only so we hard-code the downward surface.
      const surfaceY = tileOrigin.y;
      const surfaceX = checkX; // X stays at the sample point

      return {
        point: { x: surfaceX, y: surfaceY },
        normal: { x: 0, y: -1 }, // outward normal (away from solid, upward)
        hasGround: true,
      };
    }
  }

  return NO_GROUND;
}
