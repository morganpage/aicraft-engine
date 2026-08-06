import { terrainArtMaterialResolution } from './constants';
import { renderTerrainArtSourceTile, type TerrainArtImportedAssetResolver } from './compositor';
import type {
  TerrainArtDualGridMask,
  TerrainArtPixelAtlas,
  TerrainArtProject,
} from './types';

const MASK_TO_INDEX = Object.freeze(
  Array.from({ length: 16 }, (_, mask) => mask),
);

/** Generate a deterministic 4×4 preview atlas for one material and variant. */
export function generateTerrainArtMaterialAtlas(
  project: Readonly<TerrainArtProject>,
  materialId: string,
  variantId = 'default',
  resolveImportedAsset?: TerrainArtImportedAssetResolver,
): TerrainArtPixelAtlas {
  const tileSize = terrainArtMaterialResolution(
    project.authoringResolution,
    project.materials.find((candidate) => candidate.id === materialId)?.resolution,
  );
  const width = tileSize * 4;
  const height = tileSize * 4;
  const pixels = new Uint8ClampedArray(width * height * 4);
  let resolvedVariantId = variantId;
  for (let mask = 0; mask < 16; mask++) {
    const tile = renderTerrainArtSourceTile(
      project,
      materialId,
      mask as TerrainArtDualGridMask,
      variantId,
      resolveImportedAsset,
    );
    resolvedVariantId = tile.variantId;
    const originX = mask % 4 * tileSize;
    const originY = Math.floor(mask / 4) * tileSize;
    for (let y = 0; y < tileSize; y++) {
      const sourceStart = y * tileSize * 4;
      const destinationStart = ((originY + y) * width + originX) * 4;
      pixels.set(tile.pixels.subarray(sourceStart, sourceStart + tileSize * 4), destinationStart);
    }
  }
  return Object.freeze({
    materialId,
    variantId: resolvedVariantId,
    width,
    height,
    tileSize,
    columns: 4 as const,
    rows: 4 as const,
    pixels,
    maskToIndex: MASK_TO_INDEX,
  });
}
