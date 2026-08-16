import { describe, expect, it, vi } from 'vitest';
import type { TileGrid } from '../level';
import {
  createTerrainArtProject,
  createTerrainArtRenderCache,
  drawPreparedTerrainArtDualGrid,
  generateTerrainArtMaterialAtlas,
  prepareTerrainArtDualGrid,
  compileTerrainArtRuntime,
  drawCompiledTerrainArtDualGrid,
} from '../terrain-art';

describe('terrain-art atlas-backed runtime drawing', () => {
  it('draws visible non-empty masks at half-tile-offset world coordinates', () => {
    const project = createTerrainArtProject({ authoringResolution: 16 });
    const source: TileGrid = { cols: 1, rows: 1, tileSize: 16, data: [1] };
    const prepared = prepareTerrainArtDualGrid(source, project.terrainKinds);
    const atlas = generateTerrainArtMaterialAtlas(project, 'solid');
    const drawImage = vi.fn();
    const context = { drawImage } as unknown as CanvasRenderingContext2D;
    const image = {} as CanvasImageSource;

    const count = drawPreparedTerrainArtDualGrid(context, prepared, {
      atlas,
      image,
      view: { x: -8, y: -8, width: 32, height: 32 },
    });

    expect(count).toBe(4);
    expect(drawImage).toHaveBeenCalledTimes(4);
    expect(drawImage.mock.calls.map((call) => call.slice(5))).toEqual([
      [-8, -8, 16, 16],
      [8, -8, 16, 16],
      [-8, 8, 16, 16],
      [8, 8, 16, 16],
    ]);
  });

  it('draws guttered compiled atlases with stable runtime variant selection', () => {
    const project = createTerrainArtProject({ authoringResolution: 16, visualSeed: 42 });
    const prepared = prepareTerrainArtDualGrid({ cols: 1, rows: 1, tileSize: 16, data: [1] }, project.terrainKinds);
    const runtime = compileTerrainArtRuntime(project, 1); const drawImage = vi.fn();
    const count = drawCompiledTerrainArtDualGrid({ drawImage } as unknown as CanvasRenderingContext2D, prepared, runtime, { images: [{} as CanvasImageSource], view: { x: -8, y: -8, width: 32, height: 32 } });
    expect(count).toBe(4);
    expect(drawImage).toHaveBeenCalledTimes(4);
    expect(drawImage.mock.calls.every((call) => call[1] % 18 === 1 && call[2] % 18 === 1)).toBe(true);
  });

  it('culls disjoint tiles and ignores an atlas for another material', () => {
    const project = createTerrainArtProject({ authoringResolution: 16 });
    const source: TileGrid = { cols: 1, rows: 1, tileSize: 16, data: [1] };
    const prepared = prepareTerrainArtDualGrid(source, project.terrainKinds);
    const atlas = generateTerrainArtMaterialAtlas(project, 'solid');
    const drawImage = vi.fn();
    const context = { drawImage } as unknown as CanvasRenderingContext2D;

    expect(drawPreparedTerrainArtDualGrid(context, prepared, {
      atlas: { ...atlas, materialId: 'missing' },
      image: {} as CanvasImageSource,
      view: { x: 100, y: 100, width: 16, height: 16 },
    })).toBe(0);
    expect(drawImage).not.toHaveBeenCalled();
  });
});

describe('createTerrainArtRenderCache invalidate', () => {
  it('matches the materialId SEGMENT exactly — not another entry\'s variant segment', () => {
    const cache = createTerrainArtRenderCache();
    const stoneProject = createTerrainArtProject({ authoringResolution: 16, visualSeed: 1 });
    const grassProject = createTerrainArtProject({ authoringResolution: 16, visualSeed: 2 });
    // Key layout: hash:materialId:variantId:mask. The stone entry's VARIANT
    // segment is 'grass' — the old substring match (`:${materialId}:`) deleted
    // it on invalidate('grass'), and invalidate('default') massacred every
    // default-variant entry in the cache.
    cache.render(stoneProject, 'stone', 15, 'grass');
    cache.render(grassProject, 'grass', 0, 'default');
    expect(cache.size).toBe(2);
    cache.invalidate('grass');
    expect(cache.size).toBe(1); // only the grass MATERIAL entry died
    // Re-render both: the stone/grass-variant entry survived, so it is not
    // re-computed (size stays 1 until the grass entry re-caches).
    cache.render(stoneProject, 'stone', 15, 'grass');
    expect(cache.size).toBe(1);
  });

  it('invalidate() with no argument clears everything', () => {
    const cache = createTerrainArtRenderCache();
    const project = createTerrainArtProject({ authoringResolution: 16 });
    cache.render(project, 'a', 0);
    cache.render(project, 'b', 0);
    expect(cache.size).toBe(2);
    cache.invalidate();
    expect(cache.size).toBe(0);
  });
});
