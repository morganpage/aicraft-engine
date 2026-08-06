import { describe, expect, it } from 'vitest';
import {
  createTerrainArtProject,
  renderTerrainArtSourceTile,
  type TerrainArtProject,
} from '../terrain-art';

function rgbaAt(
  pixels: Uint8ClampedArray,
  size: number,
  x: number,
  y: number,
): readonly number[] {
  const index = (y * size + x) * 4;
  return Array.from(pixels.slice(index, index + 4));
}

function withMaterial(
  project: Readonly<TerrainArtProject>,
  update: (material: TerrainArtProject['materials'][number]) => TerrainArtProject['materials'][number],
): TerrainArtProject {
  return {
    ...project,
    materials: [update(project.materials[0]!)],
  };
}

describe('terrain-art layer compositor', () => {
  it('renders base and contour from one square zero-roundness silhouette', () => {
    const source = createTerrainArtProject({ authoringResolution: 16 });
    const project = withMaterial(source, (material) => ({
      ...material,
      generator: { ...material.generator, roundness: 0, contourWidth: 2 },
      layers: material.layers.filter((layer) =>
        layer.type === 'base' || layer.type === 'contour'),
    }));
    const tile = renderTerrainArtSourceTile(project, 'solid', 1);

    expect(rgbaAt(tile.pixels, 16, 4, 4)).toEqual([95, 143, 79, 255]);
    expect(rgbaAt(tile.pixels, 16, 7, 4)).toEqual([168, 216, 120, 255]);
    expect(rgbaAt(tile.pixels, 16, 12, 12)).toEqual([0, 0, 0, 0]);
  });

  it('honors layer visibility and order without mutating source settings', () => {
    const source = createTerrainArtProject({ authoringResolution: 16 });
    const hidden = withMaterial(source, (material) => ({
      ...material,
      generator: { ...material.generator, roundness: 0, contourWidth: 2 },
      layers: material.layers
        .filter((layer) => layer.type === 'base' || layer.type === 'contour')
        .map((layer) => layer.type === 'contour' ? { ...layer, visible: false } : layer),
    }));
    const reordered = withMaterial(source, (material) => ({
      ...material,
      generator: { ...material.generator, roundness: 0, contourWidth: 2 },
      layers: [
        material.layers.find((layer) => layer.type === 'contour')!,
        material.layers.find((layer) => layer.type === 'base')!,
      ],
    }));

    expect(rgbaAt(renderTerrainArtSourceTile(hidden, 'solid', 1).pixels, 16, 7, 4))
      .toEqual([95, 143, 79, 255]);
    expect(rgbaAt(renderTerrainArtSourceTile(reordered, 'solid', 1).pixels, 16, 7, 4))
      .toEqual([95, 143, 79, 255]);
    expect(source.materials[0]?.layers.map((layer) => layer.type)).toEqual([
      'base', 'shading', 'contour', 'decoration', 'manual',
    ]);
  });

  it('applies palette-linked paint and explicit erase from a manual layer', () => {
    const source = createTerrainArtProject({ authoringResolution: 16 });
    const project = withMaterial(source, (material) => ({
      ...material,
      generator: { ...material.generator, roundness: 0, contourWidth: 0 },
      layers: material.layers
        .filter((layer) => layer.type === 'base' || layer.type === 'manual')
        .map((layer) => layer.type === 'manual'
        ? {
            ...layer,
            patches: [{
              mask: 15 as const,
              variantId: 'default',
              runs: [
                { y: 2, x: 2, length: 1, mode: 'paint' as const, colorRef: 'accent' as const },
                { y: 2, x: 3, length: 1, mode: 'erase' as const },
              ],
            }],
          }
        : layer),
    }));
    const tile = renderTerrainArtSourceTile(project, 'solid', 15);

    expect(rgbaAt(tile.pixels, 16, 2, 2)).toEqual([244, 211, 94, 255]);
    expect(rgbaAt(tile.pixels, 16, 3, 2)).toEqual([0, 0, 0, 0]);
    expect(rgbaAt(tile.pixels, 16, 4, 2)).toEqual([95, 143, 79, 255]);
  });

  it('keeps manual patches when procedural generator settings change', () => {
    const source = createTerrainArtProject({ authoringResolution: 16 });
    const painted = withMaterial(source, (material) => ({
      ...material,
      layers: material.layers
        .filter((layer) => layer.type === 'base' || layer.type === 'manual')
        .map((layer) => layer.type === 'manual'
        ? {
            ...layer,
            clipMode: 'none' as const,
            patches: [{
              mask: 1 as const,
              variantId: 'default',
              runs: [{ y: 15, x: 15, length: 1, mode: 'paint' as const, rgba: 0xff00ffff }],
            }],
          }
        : layer),
    }));
    const regenerated = withMaterial(painted, (material) => ({
      ...material,
      generator: { ...material.generator, roundness: 0, contourWidth: 0 },
    }));

    expect(rgbaAt(renderTerrainArtSourceTile(painted, 'solid', 1).pixels, 16, 15, 15))
      .toEqual([255, 0, 255, 255]);
    expect(rgbaAt(renderTerrainArtSourceTile(regenerated, 'solid', 1).pixels, 16, 15, 15))
      .toEqual([255, 0, 255, 255]);
  });

  it('returns a transparent tile for a missing or disabled material', () => {
    const source = createTerrainArtProject({ authoringResolution: 16 });
    const disabled = withMaterial(source, (material) => ({ ...material, enabled: false }));

    expect(renderTerrainArtSourceTile(source, 'missing', 15).pixels.every((value) => value === 0))
      .toBe(true);
    expect(renderTerrainArtSourceTile(disabled, 'solid', 15).pixels.every((value) => value === 0))
      .toBe(true);
  });
});
