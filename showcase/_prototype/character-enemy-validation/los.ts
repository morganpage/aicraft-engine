import type {
  TileSolidityQuery,
  TileType,
} from '../../../src/collision/types';

export const LOS_MAX_VISITED_TILES = 65_536;
const LOS_CORNER_EPSILON = 1e-12;

function isTileType(value: unknown): value is TileType {
  return value === 'empty' || value === 'solid' || value === 'passthrough';
}

export function checkLineOfSightWithLimits(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  tileQuery: TileSolidityQuery,
  tileSize: number,
  predictedVisitLimit: number,
  runtimeVisitLimit: number,
): boolean {
  if (
    !Number.isFinite(startX) ||
    !Number.isFinite(startY) ||
    !Number.isFinite(endX) ||
    !Number.isFinite(endY) ||
    !Number.isFinite(tileSize) ||
    tileSize <= 0
  ) {
    return false;
  }

  const dx = endX - startX;
  const dy = endY - startY;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;

  const startTileX = Math.floor(startX / tileSize);
  const startTileY = Math.floor(startY / tileSize);
  const endTileX = Math.floor(endX / tileSize);
  const endTileY = Math.floor(endY / tileSize);
  if (
    !Number.isSafeInteger(startTileX) ||
    !Number.isSafeInteger(startTileY) ||
    !Number.isSafeInteger(endTileX) ||
    !Number.isSafeInteger(endTileY)
  ) {
    return false;
  }

  const deltaTilesX = Math.abs(endTileX - startTileX);
  const deltaTilesY = Math.abs(endTileY - startTileY);
  const predictedVisits =
    1 +
    deltaTilesX +
    deltaTilesY +
    Math.min(deltaTilesX, deltaTilesY);
  if (
    !Number.isSafeInteger(predictedVisitLimit) ||
    predictedVisitLimit < 1 ||
    predictedVisits > predictedVisitLimit ||
    !Number.isSafeInteger(runtimeVisitLimit) ||
    runtimeVisitLimit < 1
  ) {
    return false;
  }

  const visited = new Set<string>();
  let visits = 0;
  const visit = (tileX: number, tileY: number): boolean => {
    const key = `${tileX},${tileY}`;
    if (visited.has(key)) return true;
    visited.add(key);
    visits += 1;
    if (visits > runtimeVisitLimit) return false;
    try {
      const value: unknown = tileQuery(tileX, tileY);
      return isTileType(value) && value !== 'solid';
    } catch {
      return false;
    }
  };

  let tileX = startTileX;
  let tileY = startTileY;
  if (!visit(tileX, tileY)) return false;
  if (tileX === endTileX && tileY === endTileY) return true;

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : tileSize / Math.abs(dx);
  const tDeltaY = stepY === 0 ? Number.POSITIVE_INFINITY : tileSize / Math.abs(dy);
  const nextBoundaryX =
    stepX > 0 ? (tileX + 1) * tileSize : tileX * tileSize;
  const nextBoundaryY =
    stepY > 0 ? (tileY + 1) * tileSize : tileY * tileSize;
  let tMaxX =
    stepX === 0 ? Number.POSITIVE_INFINITY : (nextBoundaryX - startX) / dx;
  let tMaxY =
    stepY === 0 ? Number.POSITIVE_INFINITY : (nextBoundaryY - startY) / dy;

  while (tileX !== endTileX || tileY !== endTileY) {
    const tied =
      Math.abs(tMaxX - tMaxY) <=
      LOS_CORNER_EPSILON *
        Math.max(1, Math.abs(tMaxX), Math.abs(tMaxY));

    if (tied) {
      if (!visit(tileX + stepX, tileY)) return false;
      if (!visit(tileX, tileY + stepY)) return false;
      tileX += stepX;
      tileY += stepY;
      if (!visit(tileX, tileY)) return false;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) {
      tileX += stepX;
      if (!visit(tileX, tileY)) return false;
      tMaxX += tDeltaX;
    } else {
      tileY += stepY;
      if (!visit(tileX, tileY)) return false;
      tMaxY += tDeltaY;
    }
  }

  return true;
}

export function checkLineOfSight(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  tileQuery: TileSolidityQuery,
  tileSize: number,
): boolean {
  return checkLineOfSightWithLimits(
    startX,
    startY,
    endX,
    endY,
    tileQuery,
    tileSize,
    LOS_MAX_VISITED_TILES,
    LOS_MAX_VISITED_TILES,
  );
}
