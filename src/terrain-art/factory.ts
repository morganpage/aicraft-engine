import {
  DEFAULT_TERRAIN_ART_RESOLUTION,
  DEFAULT_TERRAIN_ART_SEED,
  MAX_TERRAIN_ART_RESOLUTION,
  MIN_TERRAIN_ART_RESOLUTION,
  TERRAIN_ART_PROJECT_VERSION,
} from './constants';
import type {
  TerrainArtLayer,
  TerrainArtProject,
  TerrainMaterialDefinition,
} from './types';

/** Options for creating a complete procedural terrain-art project. */
export interface CreateTerrainArtProjectOptions {
  readonly id?: string;
  readonly name?: string;
  readonly authoringResolution?: number;
  readonly visualSeed?: number;
}

function clampResolution(value: number | undefined): number {
  const finite = Number.isInteger(value) ? value! : DEFAULT_TERRAIN_ART_RESOLUTION;
  return Math.max(MIN_TERRAIN_ART_RESOLUTION, Math.min(MAX_TERRAIN_ART_RESOLUTION, finite));
}

function layer(
  id: string,
  name: string,
  type: TerrainArtLayer['type'],
  locked: boolean,
): TerrainArtLayer {
  return Object.freeze({
    id,
    name,
    type,
    visible: true,
    locked,
    opacity: 1,
    blendMode: 'normal' as const,
    clipMode: type === 'manual'
      ? 'material-silhouette' as const
      : type === 'contour' ? 'none' as const : 'world-silhouette' as const,
    ...(type === 'manual' ? { patches: Object.freeze([]) } : {}),
  });
}

export function createTerrainArtMaterial(
  id = 'solid',
  name = 'Solid',
): TerrainMaterialDefinition {
  return Object.freeze({
    id,
    name,
    enabled: true,
    priority: 10,
    palette: Object.freeze({
      fill: '#5f8f4f',
      contour: '#a8d878',
      highlight: '#c8eb8f',
      shadow: '#28452f',
      detail: '#456d3d',
      accent: '#f4d35e',
    }),
    generator: Object.freeze({
      roundness: 0.5,
      contourWidth: 8,
      contourPlacement: 'inside' as const,
      topHighlightDepth: 4,
      sideShadeDepth: 5,
      detailDensity: 0.2,
      detailScale: 1,
      antialias: 'none' as const,
      clipManualToSilhouette: true,
    }),
    layers: Object.freeze([
      layer('base', 'Base Generator', 'base', true),
      layer('shading', 'Shading', 'shading', false),
      layer('contour', 'Contour', 'contour', false),
      layer('decoration', 'Procedural Decoration', 'decoration', false),
      layer('manual', 'Manual Paint', 'manual', false),
    ]),
    variants: Object.freeze([
      Object.freeze({
        id: 'default',
        label: 'Default',
        enabled: true,
        weight: 1,
        eligibleMasks: Object.freeze([
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
        ] as const),
        exposure: 'any' as const,
        seedOffset: 0,
      }),
    ]),
  });
}

/** Create a valid, immediately usable terrain-art source document. */
export function createTerrainArtProject(
  options: Readonly<CreateTerrainArtProjectOptions> = {},
): TerrainArtProject {
  const id = options.id?.trim() || 'terrain-art';
  const name = options.name?.trim() || 'Terrain art';
  const visualSeed = Number.isFinite(options.visualSeed)
    ? Math.trunc(options.visualSeed!)
    : DEFAULT_TERRAIN_ART_SEED;
  return Object.freeze({
    version: TERRAIN_ART_PROJECT_VERSION,
    id,
    name,
    authoringResolution: clampResolution(options.authoringResolution),
    visualSeed,
    terrainKinds: Object.freeze([
      Object.freeze({
        id: 'empty',
        label: 'Empty',
        tileValue: 0,
        collision: 'empty' as const,
        materialId: null,
        connectGroup: 'empty',
        renderPriority: 0,
      }),
      Object.freeze({
        id: 'solid',
        label: 'Solid',
        tileValue: 1,
        collision: 'solid' as const,
        materialId: 'solid',
        connectGroup: 'solid',
        renderPriority: 10,
      }),
    ]),
    materials: Object.freeze([createTerrainArtMaterial()]),
    transitionRules: Object.freeze([]),
    occurrenceOverrides: Object.freeze([]),
  });
}
