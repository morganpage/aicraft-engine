import type { TerrainArtDualGridMask, TerrainArtProject, TerrainVariantDefinition } from './types';

export function addTerrainArtVariant(project: Readonly<TerrainArtProject>, materialId: string, variant: Readonly<TerrainVariantDefinition>): TerrainArtProject {
  return { ...project, materials: project.materials.map((material) => material.id !== materialId || material.variants.some((item) => item.id === variant.id) ? material : ({ ...material, variants: [...material.variants, { ...variant, eligibleMasks: [...variant.eligibleMasks] }] })) };
}

export function updateTerrainArtVariant(project: Readonly<TerrainArtProject>, materialId: string, variantId: string, update: Partial<Readonly<TerrainVariantDefinition>>): TerrainArtProject {
  return { ...project, materials: project.materials.map((material) => material.id !== materialId ? material : ({ ...material, variants: material.variants.map((variant) => variant.id !== variantId ? variant : ({ ...variant, ...update, id: variant.id, weight: Math.max(0, update.weight ?? variant.weight), eligibleMasks: [...(update.eligibleMasks ?? variant.eligibleMasks)].filter((mask): mask is TerrainArtDualGridMask => Number.isInteger(mask) && mask >= 0 && mask <= 15) })) })) };
}

export function removeTerrainArtVariant(project: Readonly<TerrainArtProject>, materialId: string, variantId: string): TerrainArtProject {
  return { ...project, materials: project.materials.map((material) => {
    if (material.id !== materialId || material.variants.length <= 1) return material;
    return { ...material, variants: material.variants.filter((variant) => variant.id !== variantId), layers: material.layers.map((layer) => layer.patches === undefined ? layer : ({ ...layer, patches: layer.patches.filter((patch) => patch.variantId !== variantId) })) };
  }), occurrenceOverrides: project.occurrenceOverrides.map((override) => override.materialId === materialId && override.pinnedVariantId === variantId ? ({ ...override, pinnedVariantId: undefined }) : override) };
}

export function terrainArtVariantUsage(project: Readonly<TerrainArtProject>, materialId: string): Readonly<Record<string, number>> {
  const usage: Record<string, number> = {};
  for (const override of project.occurrenceOverrides) if (override.materialId === materialId && override.pinnedVariantId !== undefined) usage[override.pinnedVariantId] = (usage[override.pinnedVariantId] ?? 0) + 1;
  return usage;
}
