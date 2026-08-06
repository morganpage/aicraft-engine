import { renderTerrainArtSourceTile, type TerrainArtImportedAssetResolver } from './compositor';
import { hashTerrainArtProject } from './storage';
import type { TerrainArtDualGridMask, TerrainArtProject, TerrainArtSourceTile } from './types';

export interface TerrainArtRenderCache {
  render(project: Readonly<TerrainArtProject>, materialId: string, mask: TerrainArtDualGridMask, variantId?: string): TerrainArtSourceTile;
  invalidate(materialId?: string): void;
  readonly size: number;
}

/**
 * Create an explicit bounded source/composite cache for interactive editors.
 *
 * The resolver is fixed at construction and deliberately absent from the cache
 * key — it supplies pixels for an `assetId` the project already names, so two
 * resolvers disagreeing about the same id would be a host bug, not a variation
 * worth caching separately. Swap resolvers by making a new cache.
 */
export function createTerrainArtRenderCache(maxEntries = 512, resolveImportedAsset?: TerrainArtImportedAssetResolver): TerrainArtRenderCache {
  const entries = new Map<string, TerrainArtSourceTile>();
  return {
    render(project, materialId, mask, variantId = 'default') {
      const key = `${hashTerrainArtProject(project)}:${materialId}:${variantId}:${mask}`; const cached = entries.get(key); if (cached) return cached;
      const tile = renderTerrainArtSourceTile(project, materialId, mask, variantId, resolveImportedAsset); entries.set(key, tile);
      while (entries.size > Math.max(1, maxEntries)) entries.delete(entries.keys().next().value!); return tile;
    },
    invalidate(materialId) { if (materialId === undefined) entries.clear(); else for (const key of entries.keys()) if (key.includes(`:${materialId}:`)) entries.delete(key); },
    get size() { return entries.size; },
  };
}
