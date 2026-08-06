import type { TerrainArtProject, TerrainGeneratorSettings } from './types';

export type TerrainGeneratorSettingsUpdate = Partial<Readonly<TerrainGeneratorSettings>>;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Update one material's procedural generator without mutating its manual art layers. */
export function updateTerrainArtGenerator(
  project: Readonly<TerrainArtProject>,
  materialId: string,
  update: Readonly<TerrainGeneratorSettingsUpdate>,
): TerrainArtProject {
  return {
    ...project,
    materials: project.materials.map((material) => material.id !== materialId ? material : ({
      ...material,
      generator: {
        ...material.generator,
        ...update,
        roundness: clamp(Number.isFinite(update.roundness) ? update.roundness! : material.generator.roundness, 0, 1),
        contourWidth: clamp(Number.isFinite(update.contourWidth) ? update.contourWidth! : material.generator.contourWidth, 0, project.authoringResolution / 2),
        topHighlightDepth: clamp(Number.isFinite(update.topHighlightDepth) ? update.topHighlightDepth! : material.generator.topHighlightDepth, 0, project.authoringResolution / 2),
        sideShadeDepth: clamp(Number.isFinite(update.sideShadeDepth) ? update.sideShadeDepth! : material.generator.sideShadeDepth, 0, project.authoringResolution / 2),
        detailDensity: clamp(Number.isFinite(update.detailDensity) ? update.detailDensity! : material.generator.detailDensity, 0, 1),
        detailScale: clamp(Number.isFinite(update.detailScale) ? update.detailScale! : material.generator.detailScale, 1, project.authoringResolution),
      },
    })),
  };
}
