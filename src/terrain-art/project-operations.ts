import { createTerrainArtMaterial } from './factory';
import type { TerrainArtLayer, TerrainArtProject, TerrainMaterialDefinition, TerrainPixelRun } from './types';

export type TerrainArtPresetId = 'meadow' | 'rock' | 'metal' | 'water';

const PRESETS: Record<TerrainArtPresetId, Partial<TerrainMaterialDefinition['palette']>> = {
  meadow: { fill: '#5f8f4f', contour: '#a8d878', highlight: '#c8eb8f', shadow: '#365d3d', detail: '#456d3d', accent: '#f4d35e' },
  rock: { fill: '#6f7180', contour: '#b8bac7', highlight: '#d9dae2', shadow: '#353744', detail: '#555866', accent: '#d8a657' },
  metal: { fill: '#607080', contour: '#b8d0d8', highlight: '#d9f0f2', shadow: '#293945', detail: '#465966', accent: '#e6b84f' },
  water: { fill: '#347fa3', contour: '#8bdcf2', highlight: '#c0f3ff', shadow: '#17435f', detail: '#286b8d', accent: '#e8fbff' },
};

export function applyTerrainArtPreset(project: Readonly<TerrainArtProject>, materialId: string, preset: TerrainArtPresetId): TerrainArtProject {
  const generator = preset === 'water' ? { roundness: .8, contourWidth: 4, detailDensity: .08 }
    : preset === 'metal' ? { roundness: .15, contourWidth: 5, detailDensity: .04 }
      : preset === 'rock' ? { roundness: .45, contourWidth: 7, detailDensity: .12 }
        : { roundness: .65, contourWidth: 7, detailDensity: .035 };
  return { ...project, materials: project.materials.map((material) => material.id !== materialId ? material : ({ ...material, palette: { ...material.palette, ...PRESETS[preset] }, generator: { ...material.generator, ...generator } })) };
}

export function addTerrainArtMaterial(project: Readonly<TerrainArtProject>, id: string, name: string, preset: TerrainArtPresetId = 'rock'): TerrainArtProject {
  const cleanId = id.trim();
  if (!cleanId || project.materials.some((material) => material.id === cleanId)) return project as TerrainArtProject;
  const base = createTerrainArtMaterial(cleanId, name.trim() || cleanId);
  return { ...project, materials: [...project.materials, { ...base, priority: Math.max(0, ...project.materials.map((material) => material.priority)) + 10, palette: { ...base.palette, ...PRESETS[preset] } }] };
}

/** Rename one reusable terrain-art material without changing its stable id. */
export function renameTerrainArtMaterial(project: Readonly<TerrainArtProject>, materialId: string, name: string): TerrainArtProject {
  const cleanName = name.trim();
  if (!cleanName) return project as TerrainArtProject;
  return { ...project, materials: project.materials.map((material) => material.id === materialId ? { ...material, name: cleanName } : material) };
}

/** Restore one material to a clean preset while preserving its identity and level bindings. */
export function resetTerrainArtMaterial(project: Readonly<TerrainArtProject>, materialId: string, preset: TerrainArtPresetId = 'meadow'): TerrainArtProject {
  const current = project.materials.find((material) => material.id === materialId);
  if (current === undefined) return project as TerrainArtProject;
  const clean = { ...createTerrainArtMaterial(current.id, current.name), enabled: current.enabled, priority: current.priority };
  const replaced = {
    ...project,
    materials: project.materials.map((material) => material.id === materialId ? clean : material),
    occurrenceOverrides: project.occurrenceOverrides.filter((override) => override.materialId !== materialId),
  };
  return applyTerrainArtPreset(replaced, materialId, preset);
}

export function removeTerrainArtMaterial(project: Readonly<TerrainArtProject>, materialId: string, replacementMaterialId: string): TerrainArtProject {
  if (materialId === replacementMaterialId || !project.materials.some((material) => material.id === replacementMaterialId)) return project as TerrainArtProject;
  return {
    ...project,
    materials: project.materials.filter((material) => material.id !== materialId),
    terrainKinds: project.terrainKinds.map((kind) => kind.materialId === materialId ? { ...kind, materialId: replacementMaterialId } : kind),
    transitionRules: project.transitionRules.filter((rule) => rule.foregroundMaterialId !== materialId && rule.backgroundMaterialId !== materialId),
    occurrenceOverrides: project.occurrenceOverrides.filter((override) => override.materialId !== materialId),
  };
}

export function updateTerrainArtLayer(project: Readonly<TerrainArtProject>, materialId: string, layerId: string, update: Partial<Readonly<TerrainArtLayer>>): TerrainArtProject {
  return { ...project, materials: project.materials.map((material) => material.id !== materialId ? material : ({ ...material, layers: material.layers.map((layer) => layer.id === layerId ? { ...layer, ...update, id: layer.id, type: layer.type } : layer) })) };
}

export function reorderTerrainArtLayer(project: Readonly<TerrainArtProject>, materialId: string, layerId: string, toIndex: number): TerrainArtProject {
  return { ...project, materials: project.materials.map((material) => {
    if (material.id !== materialId) return material;
    const layers = [...material.layers]; const from = layers.findIndex((layer) => layer.id === layerId);
    if (from < 0) return material;
    const [layer] = layers.splice(from, 1); layers.splice(Math.max(0, Math.min(layers.length, toIndex)), 0, layer!);
    return { ...material, layers };
  }) };
}

function scaleRun(run: Readonly<TerrainPixelRun>, from: number, to: number): TerrainPixelRun {
  const x = Math.min(to - 1, Math.floor(run.x * to / from));
  const end = Math.min(to, Math.max(x + 1, Math.ceil((run.x + run.length) * to / from)));
  return { ...run, x, y: Math.min(to - 1, Math.floor(run.y * to / from)), length: end - x };
}

/**
 * Confirm a nearest-neighbor authoring-resolution migration as one immutable
 * transaction. Materials that pin their own `resolution` — imported tilesets —
 * are left untouched: the project default does not describe their pixel grid,
 * so rescaling their manual patches would corrupt them.
 */
export function resizeTerrainArtProject(project: Readonly<TerrainArtProject>, resolution: number): TerrainArtProject {
  if (!Number.isInteger(resolution) || resolution < 16 || resolution > 128 || resolution === project.authoringResolution) return project as TerrainArtProject;
  return { ...project, authoringResolution: resolution, materials: project.materials.map((material) => material.resolution !== undefined ? material : ({ ...material, layers: material.layers.map((layer) => layer.patches === undefined ? layer : ({ ...layer, patches: layer.patches.map((patch) => ({ ...patch, runs: patch.runs.map((run) => scaleRun(run, project.authoringResolution, resolution)) })) })) })) };
}
