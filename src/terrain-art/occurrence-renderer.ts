import { renderTerrainArtSourceTile, type TerrainArtImportedAssetResolver } from './compositor';
import type { TerrainArtProject, TerrainArtSourceTile, TerrainOccurrenceOverride } from './types';

/** Composite one already-validated active occurrence override over reusable source art. */
export function renderTerrainArtOccurrenceTile(project: Readonly<TerrainArtProject>, override: Readonly<TerrainOccurrenceOverride>, resolveImportedAsset?: TerrainArtImportedAssetResolver): TerrainArtSourceTile {
  const material = project.materials.find((candidate) => candidate.id === override.materialId);
  if (material === undefined) return renderTerrainArtSourceTile(project, override.materialId, override.expectedMask, override.pinnedVariantId ?? override.expectedVariantId, resolveImportedAsset);
  const variantId = override.pinnedVariantId ?? override.expectedVariantId;
  const localProject: TerrainArtProject = {
    ...project,
    materials: project.materials.map((candidate) => candidate.id !== material.id ? candidate : ({
      ...candidate,
      layers: candidate.layers.map((layer) => {
        const local = override.layerPatches.find((patch) => patch.layerId === layer.id);
        return local === undefined ? layer : { ...layer, patches: [...(layer.patches ?? []), { mask: override.expectedMask, variantId, runs: local.runs }] };
      }),
    })),
  };
  return renderTerrainArtSourceTile(localProject, override.materialId, override.expectedMask, variantId, resolveImportedAsset);
}
