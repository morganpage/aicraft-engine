import type {
  PreparedTerrainArtDualGrid, TerrainArtOccurrenceStatus, TerrainArtProject,
  TerrainOccurrenceOverride, TerrainPixelRun,
} from './types';
import { editTerrainArtSourceTile, type TerrainArtPixelEdit } from './manual-paint';

/** Diagnose an occurrence override against the topology it was authored for. */
export function getTerrainArtOccurrenceStatus(
  override: Readonly<TerrainOccurrenceOverride>, levelId: string,
  prepared: Readonly<PreparedTerrainArtDualGrid>, project: Readonly<TerrainArtProject>,
): TerrainArtOccurrenceStatus {
  if (override.hidden === true) return 'hidden';
  if (override.levelId !== levelId) return 'orphaned';
  const tile = prepared.tiles.find((candidate) => candidate.dualX === override.dualX && candidate.dualY === override.dualY);
  if (tile === undefined) return 'orphaned';
  const material = project.materials.find((candidate) => candidate.id === override.materialId && candidate.enabled);
  if (material === undefined) return 'orphaned';
  const pass = tile.materials.find((candidate) => candidate.materialId === override.materialId);
  return pass?.mask === override.expectedMask ? 'active' : 'stale';
}

/** Return only safe active overrides; stale/orphaned data remains preserved in source. */
export function activeTerrainArtOccurrenceOverrides(
  project: Readonly<TerrainArtProject>, levelId: string,
  prepared: Readonly<PreparedTerrainArtDualGrid>,
): readonly Readonly<TerrainOccurrenceOverride>[] {
  return project.occurrenceOverrides.filter((override) =>
    getTerrainArtOccurrenceStatus(override, levelId, prepared, project) === 'active');
}

/** Rebind an override explicitly to the topology currently at its coordinate. */
export function rebindTerrainArtOccurrenceOverride(
  project: Readonly<TerrainArtProject>, levelId: string, dualX: number, dualY: number,
  prepared: Readonly<PreparedTerrainArtDualGrid>,
): TerrainArtProject {
  const tile = prepared.tiles.find((candidate) => candidate.dualX === dualX && candidate.dualY === dualY);
  return { ...project, occurrenceOverrides: project.occurrenceOverrides.map((override) => {
    if (override.levelId !== levelId || override.dualX !== dualX || override.dualY !== dualY) return override;
    const pass = tile?.materials.find((candidate) => candidate.materialId === override.materialId);
    return pass === undefined ? override : { ...override, expectedMask: pass.mask };
  }) };
}

/** Delete one override without affecting its reusable source tile. */
export function deleteTerrainArtOccurrenceOverride(
  project: Readonly<TerrainArtProject>, levelId: string, dualX: number, dualY: number, materialId: string,
): TerrainArtProject {
  return { ...project, occurrenceOverrides: project.occurrenceOverrides.filter((override) =>
    override.levelId !== levelId || override.dualX !== dualX || override.dualY !== dualY || override.materialId !== materialId) };
}

/** Create/update an explicitly local manual layer patch at one occurrence. */
export function setTerrainArtOccurrenceLayerPatch(
  project: Readonly<TerrainArtProject>, levelId: string, dualX: number, dualY: number,
  materialId: string, expectedMask: TerrainOccurrenceOverride['expectedMask'], expectedVariantId: string,
  layerId: string, runs: readonly Readonly<TerrainPixelRun>[],
): TerrainArtProject {
  const current = project.occurrenceOverrides.find((item) => item.levelId === levelId && item.dualX === dualX && item.dualY === dualY && item.materialId === materialId);
  const next: TerrainOccurrenceOverride = {
    ...(current ?? { levelId, dualX, dualY, materialId, expectedMask, expectedVariantId, layerPatches: [] }),
    expectedMask, expectedVariantId,
    layerPatches: [...(current?.layerPatches ?? []).filter((patch) => patch.layerId !== layerId), ...(runs.length ? [{ layerId, runs }] : [])],
  };
  return { ...project, occurrenceOverrides: [...project.occurrenceOverrides.filter((item) => item !== current), next] };
}

export function pinTerrainArtOccurrenceVariant(
  project: Readonly<TerrainArtProject>, levelId: string, dualX: number, dualY: number,
  materialId: string, expectedMask: TerrainOccurrenceOverride['expectedMask'], expectedVariantId: string, pinnedVariantId?: string,
): TerrainArtProject {
  const current = project.occurrenceOverrides.find((item) => item.levelId === levelId && item.dualX === dualX && item.dualY === dualY && item.materialId === materialId);
  const next: TerrainOccurrenceOverride = { ...(current ?? { levelId, dualX, dualY, materialId, expectedMask, expectedVariantId, layerPatches: [] }), expectedMask, expectedVariantId, ...(pinnedVariantId === undefined ? {} : { pinnedVariantId }) };
  if (pinnedVariantId === undefined) delete (next as { pinnedVariantId?: string }).pinnedVariantId;
  return { ...project, occurrenceOverrides: [...project.occurrenceOverrides.filter((item) => item !== current), next] };
}

export function clearTerrainArtOccurrenceOverrides(project: Readonly<TerrainArtProject>, levelId?: string): TerrainArtProject {
  return { ...project, occurrenceOverrides: levelId === undefined ? [] : project.occurrenceOverrides.filter((override) => override.levelId !== levelId) };
}

export function hideTerrainArtOccurrenceOverride(project: Readonly<TerrainArtProject>, levelId: string, dualX: number, dualY: number, materialId: string, hidden = true): TerrainArtProject {
  return { ...project, occurrenceOverrides: project.occurrenceOverrides.map((override) => override.levelId === levelId && override.dualX === dualX && override.dualY === dualY && override.materialId === materialId ? { ...override, hidden } : override) };
}

export function editTerrainArtOccurrenceLayer(
  project: Readonly<TerrainArtProject>, levelId: string, dualX: number, dualY: number,
  materialId: string, expectedMask: TerrainOccurrenceOverride['expectedMask'], variantId: string,
  layerId: string, edits: readonly Readonly<TerrainArtPixelEdit>[],
): TerrainArtProject {
  const current = project.occurrenceOverrides.find((item) => item.levelId === levelId && item.dualX === dualX && item.dualY === dualY && item.materialId === materialId);
  const runs = current?.layerPatches.find((patch) => patch.layerId === layerId)?.runs ?? [];
  const temporary: TerrainArtProject = { ...project, materials: project.materials.map((material) => material.id !== materialId ? material : ({ ...material, layers: material.layers.map((layer) => layer.id !== layerId ? layer : ({ ...layer, locked: false, type: 'manual' as const, patches: [{ mask: expectedMask, variantId, runs }] })) })) };
  const edited = editTerrainArtSourceTile(temporary, materialId, layerId, expectedMask, variantId, edits);
  const nextRuns = edited.materials.find((material) => material.id === materialId)?.layers.find((layer) => layer.id === layerId)?.patches?.find((patch) => patch.mask === expectedMask && patch.variantId === variantId)?.runs ?? [];
  return setTerrainArtOccurrenceLayerPatch(project, levelId, dualX, dualY, materialId, expectedMask, variantId, layerId, nextRuns);
}
