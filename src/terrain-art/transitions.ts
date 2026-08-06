import type { ResolvedTerrainArtDualTile, TerrainArtProject, TerrainTransitionRule } from './types';

export interface ResolvedTerrainArtTransition {
  readonly foregroundMaterialId: string;
  readonly backgroundMaterialId: string;
  readonly mode: TerrainTransitionRule['mode'];
  readonly width: number;
  readonly colorRef?: TerrainTransitionRule['colorRef'];
}

/** Resolve explicit transitions between ordered material passes at one visual tile. */
export function resolveTerrainArtTransitions(project: Readonly<TerrainArtProject>, tile: Readonly<ResolvedTerrainArtDualTile>): readonly ResolvedTerrainArtTransition[] {
  const result: ResolvedTerrainArtTransition[] = [];
  for (let foregroundIndex = 1; foregroundIndex < tile.materials.length; foregroundIndex++) {
    const foreground = tile.materials[foregroundIndex]!;
    for (let backgroundIndex = 0; backgroundIndex < foregroundIndex; backgroundIndex++) {
      const background = tile.materials[backgroundIndex]!;
      const rule = project.transitionRules.find((candidate) => candidate.foregroundMaterialId === foreground.materialId && candidate.backgroundMaterialId === background.materialId);
      result.push({ foregroundMaterialId: foreground.materialId, backgroundMaterialId: background.materialId, mode: rule?.mode ?? 'hard', width: Math.max(0, rule?.width ?? 0), ...(rule?.colorRef !== undefined ? { colorRef: rule.colorRef } : {}) });
    }
  }
  return result;
}

export function setTerrainArtTransitionRule(project: Readonly<TerrainArtProject>, rule: Readonly<TerrainTransitionRule>): TerrainArtProject {
  if (rule.foregroundMaterialId === rule.backgroundMaterialId) return project as TerrainArtProject;
  return { ...project, transitionRules: [...project.transitionRules.filter((candidate) => candidate.foregroundMaterialId !== rule.foregroundMaterialId || candidate.backgroundMaterialId !== rule.backgroundMaterialId), { ...rule, width: Math.max(0, rule.width) }].sort((a, b) => a.foregroundMaterialId.localeCompare(b.foregroundMaterialId) || a.backgroundMaterialId.localeCompare(b.backgroundMaterialId)) };
}
