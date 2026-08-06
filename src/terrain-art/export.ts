import { generateTerrainArtMaterialAtlas } from './atlas';
import type { TerrainArtImportedAssetResolver } from './compositor';
import type { TerrainArtProject } from './types';

export interface TerrainArtImageData {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

export type TerrainArtImageEncoder<T> = (image: Readonly<TerrainArtImageData>) => T | Promise<T>;

/** Export a labeled-by-layout 4×4 atlas through a host-provided PNG/image encoder. */
export async function exportTerrainArtContactSheet<T>(project: Readonly<TerrainArtProject>, materialId: string, variantId: string, encode: TerrainArtImageEncoder<T>, resolveImportedAsset?: TerrainArtImportedAssetResolver): Promise<T> {
  const atlas = generateTerrainArtMaterialAtlas(project, materialId, variantId, resolveImportedAsset);
  return encode({ width: atlas.width, height: atlas.height, pixels: atlas.pixels });
}
