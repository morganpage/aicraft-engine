import type {
  PreparedTerrainArtDualGrid,
  TerrainArtLogicalCornerHit,
  TerrainArtVisualHit,
} from './types';

/** Map a world-space point to its visual tile and reusable source coordinates. */
export function hitTestTerrainArtDualGrid(
  prepared: Readonly<PreparedTerrainArtDualGrid>,
  worldX: number,
  worldY: number,
  authoringResolution: number,
): TerrainArtVisualHit | null {
  if (
    prepared === null || typeof prepared !== 'object' ||
    !Number.isInteger(prepared.cols) || prepared.cols <= 0 ||
    !Number.isInteger(prepared.rows) || prepared.rows <= 0 ||
    !Number.isFinite(prepared.tileSize) || prepared.tileSize <= 0 ||
    !Array.isArray(prepared.tiles) || prepared.tiles.length < prepared.cols * prepared.rows ||
    !Number.isFinite(worldX) || !Number.isFinite(worldY) ||
    !Number.isInteger(authoringResolution) || authoringResolution <= 0
  ) return null;
  const half = prepared.tileSize / 2;
  const dualX = Math.floor((worldX + half) / prepared.tileSize);
  const dualY = Math.floor((worldY + half) / prepared.tileSize);
  if (dualX < 0 || dualY < 0 || dualX >= prepared.cols || dualY >= prepared.rows) return null;
  const tile = prepared.tiles[dualY * prepared.cols + dualX];
  if (tile === undefined) return null;
  const left = dualX * prepared.tileSize - half;
  const top = dualY * prepared.tileSize - half;
  const localPixelX = Math.max(0, Math.min(
    authoringResolution - 1,
    Math.floor((worldX - left) / prepared.tileSize * authoringResolution),
  ));
  const localPixelY = Math.max(0, Math.min(
    authoringResolution - 1,
    Math.floor((worldY - top) / prepared.tileSize * authoringResolution),
  ));
  const logicalCorners: readonly TerrainArtLogicalCornerHit[] = Object.freeze([
    Object.freeze({ corner: 'north-west' as const, col: dualX - 1, row: dualY - 1 }),
    Object.freeze({ corner: 'north-east' as const, col: dualX, row: dualY - 1 }),
    Object.freeze({ corner: 'south-east' as const, col: dualX, row: dualY }),
    Object.freeze({ corner: 'south-west' as const, col: dualX - 1, row: dualY }),
  ]);
  return Object.freeze({
    dualX,
    dualY,
    localPixelX,
    localPixelY,
    logicalCorners,
    tile,
  });
}
