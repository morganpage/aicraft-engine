import { describe, expect, it } from 'vitest';
import {
  createTerrainArtProject,
  generateTerrainArtMaterialAtlas,
} from '../terrain-art';

describe('terrain-art generated atlas', () => {
  it('packs all sixteen masks into a deterministic 4x4 atlas', () => {
    const project = createTerrainArtProject({
      id: 'forest',
      authoringResolution: 16,
      visualSeed: 42,
    });
    const first = generateTerrainArtMaterialAtlas(project, 'solid');
    const second = generateTerrainArtMaterialAtlas(project, 'solid');

    expect(first).toMatchObject({
      materialId: 'solid',
      variantId: 'default',
      width: 64,
      height: 64,
      tileSize: 16,
      columns: 4,
      rows: 4,
    });
    expect(first.maskToIndex).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(first.pixels).toEqual(second.pixels);
  });

  it('keeps mask zero transparent and mask fifteen complete', () => {
    const atlas = generateTerrainArtMaterialAtlas(
      createTerrainArtProject({ authoringResolution: 16 }),
      'solid',
    );
    const alphas = (mask: number): number[] => {
      const tileIndex = atlas.maskToIndex[mask]!;
      const originX = tileIndex % atlas.columns * atlas.tileSize;
      const originY = Math.floor(tileIndex / atlas.columns) * atlas.tileSize;
      const result: number[] = [];
      for (let y = 0; y < atlas.tileSize; y++) {
        for (let x = 0; x < atlas.tileSize; x++) {
          result.push(atlas.pixels[((originY + y) * atlas.width + originX + x) * 4 + 3]!);
        }
      }
      return result;
    };

    expect(alphas(0).every((alpha) => alpha === 0)).toBe(true);
    expect(alphas(15).every((alpha) => alpha === 255)).toBe(true);
  });
});
