import type { LevelData } from '../../src/level';
import {
  createTerrainArtProject,
  generateTerrainArtMaterialAtlas,
  prepareTerrainArtDualGrid,
  type PreparedTerrainArtDualGrid,
  type TerrainArtImportedAssetResolver,
  type TerrainArtPixelAtlas,
  type TerrainArtProject,
} from '../../src/terrain-art';

/** The editable procedural art source used by the live dual-grid room. */
export function createTileRoomTerrainArtProject(): TerrainArtProject {
  const project = createTerrainArtProject({
    id: 'tile-room-dual-grid',
    name: 'Tile room dual grid',
    authoringResolution: 64,
    visualSeed: 1337,
  });
  const material = project.materials[0]!;
  return Object.freeze({
    ...project,
    terrainKinds: Object.freeze([
      project.terrainKinds[0]!,
      project.terrainKinds[1]!,
      Object.freeze({
        id: 'passthrough',
        label: 'Passthrough',
        tileValue: 2,
        collision: 'passthrough' as const,
        materialId: material.id,
        connectGroup: 'solid',
        renderPriority: material.priority,
      }),
    ]),
    materials: Object.freeze([
      Object.freeze({
        ...material,
        name: 'Meadow stone',
        palette: Object.freeze({
          ...material.palette,
          fill: '#5f8f4f',
          contour: '#a8d878',
          highlight: '#c8eb8f',
          shadow: '#365d3d',
          detail: '#456d3d',
        }),
        generator: Object.freeze({
          ...material.generator,
          roundness: 0.65,
          contourWidth: 7,
          topHighlightDepth: 3,
          sideShadeDepth: 4,
          detailDensity: 0.035,
          detailScale: 1,
        }),
      }),
    ]),
  });
}

/** Generate the reusable material atlas for the live dual-grid room. */
export function createTileRoomTerrainArtAtlas(
  project: Readonly<TerrainArtProject>,
  resolveImportedAsset?: TerrainArtImportedAssetResolver,
): TerrainArtPixelAtlas {
  return generateTerrainArtMaterialAtlas(project, project.materials[0]?.id ?? 'solid', 'default', resolveImportedAsset);
}

/** Resolve one tile-room level into its derived visual topology. */
export function prepareTileRoomTerrainArt(
  level: Readonly<LevelData>,
  project: Readonly<TerrainArtProject>,
): PreparedTerrainArtDualGrid {
  return prepareTerrainArtDualGrid(level.tiles, project.terrainKinds);
}
