import { describe, expect, it } from 'vitest';
import type { TileGrid } from '../level';
import {
  createTerrainArtProject,
  hitTestTerrainArtDualGrid,
  prepareTerrainArtDualGrid,
} from '../terrain-art';

const grid: TileGrid = {
  cols: 2,
  rows: 2,
  tileSize: 16,
  data: [1, 0, 0, 0],
};

describe('terrain-art visual hit testing', () => {
  it('maps world pixels through the half-tile visual-grid offset', () => {
    const project = createTerrainArtProject({ authoringResolution: 64 });
    const prepared = prepareTerrainArtDualGrid(grid, project.terrainKinds);

    expect(hitTestTerrainArtDualGrid(prepared, 1, 1, 64)).toMatchObject({
      dualX: 0,
      dualY: 0,
      localPixelX: 36,
      localPixelY: 36,
      tile: { occupancyMask: 4 },
    });
    expect(hitTestTerrainArtDualGrid(prepared, 9, 1, 64)).toMatchObject({
      dualX: 1,
      dualY: 0,
      localPixelX: 4,
      localPixelY: 36,
      tile: { occupancyMask: 8 },
    });
  });

  it('reports the four logical cells responsible for the selected visual tile', () => {
    const project = createTerrainArtProject();
    const prepared = prepareTerrainArtDualGrid(grid, project.terrainKinds);
    const hit = hitTestTerrainArtDualGrid(prepared, 16, 16, 64);

    expect(hit?.logicalCorners).toEqual([
      { corner: 'north-west', col: 0, row: 0 },
      { corner: 'north-east', col: 1, row: 0 },
      { corner: 'south-east', col: 1, row: 1 },
      { corner: 'south-west', col: 0, row: 1 },
    ]);
  });

  it('returns null outside the prepared visual extent or for malformed input', () => {
    const project = createTerrainArtProject();
    const prepared = prepareTerrainArtDualGrid(grid, project.terrainKinds);

    expect(hitTestTerrainArtDualGrid(prepared, -9, 0, 64)).toBeNull();
    expect(hitTestTerrainArtDualGrid(prepared, 100, 100, 64)).toBeNull();
    expect(hitTestTerrainArtDualGrid(prepared, 0, 0, 0)).toBeNull();
  });
});
