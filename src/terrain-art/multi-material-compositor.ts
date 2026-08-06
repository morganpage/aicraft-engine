import { renderTerrainArtSourceTile, type TerrainArtImportedAssetResolver } from './compositor';
import { deriveTerrainArtContour, generateTerrainArtCoverage } from './coverage';
import type { ResolvedTerrainArtDualTile, TerrainArtProject, TerrainArtSourceTile } from './types';

function rgba(hex: string): readonly [number, number, number, number] {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex); if (!match) return [0, 0, 0, 255]; const value = match[1]!;
  return [parseInt(value.slice(0,2),16), parseInt(value.slice(2,4),16), parseInt(value.slice(4,6),16), match[2] ? parseInt(match[2],16) : 255];
}

function over(target: Uint8ClampedArray, source: Uint8ClampedArray): void {
  for (let offset = 0; offset < target.length; offset += 4) {
    const sa = (source[offset + 3] ?? 0) / 255; if (sa <= 0) continue; const da = (target[offset + 3] ?? 0) / 255; const oa = sa + da * (1 - sa);
    for (let channel = 0; channel < 3; channel++) target[offset + channel] = Math.round(((source[offset + channel] ?? 0) * sa + (target[offset + channel] ?? 0) * da * (1 - sa)) / oa);
    target[offset + 3] = Math.round(oa * 255);
  }
}

/** Flatten ordered materials with one union-world contour, avoiding doubled internal outlines. */
export function renderResolvedTerrainArtTile(project: Readonly<TerrainArtProject>, tile: Readonly<ResolvedTerrainArtDualTile>, variantIds: Readonly<Record<string, string>> = {}, resolveImportedAsset?: TerrainArtImportedAssetResolver): TerrainArtSourceTile {
  const size = project.authoringResolution; const pixels = new Uint8ClampedArray(size * size * 4);
  let contourMaterial = project.materials[0];
  for (const pass of tile.materials) {
    const material = project.materials.find((candidate) => candidate.id === pass.materialId); if (!material) continue; contourMaterial = material;
    const withoutContour: TerrainArtProject = { ...project, materials: project.materials.map((candidate) => candidate.id !== material.id ? candidate : ({ ...candidate, layers: candidate.layers.map((layer) => layer.type === 'contour' ? { ...layer, visible: false } : layer) })) };
    over(pixels, renderTerrainArtSourceTile(withoutContour, material.id, pass.mask, variantIds[material.id], resolveImportedAsset).pixels);
  }
  if (tile.occupancyMask !== 0 && contourMaterial) {
    const coverage = generateTerrainArtCoverage({ mask: tile.occupancyMask, resolution: size, roundness: contourMaterial.generator.roundness });
    const contour = deriveTerrainArtContour(coverage, contourMaterial.generator.contourWidth, contourMaterial.generator.contourPlacement); const color = rgba(contourMaterial.palette.contour);
    for (let index = 0; index < contour.length; index++) if ((contour[index] ?? 0) > 0) { const offset = index * 4; pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = Math.round(color[3] * (contour[index] ?? 0) / 255); }
  }
  return { materialId: tile.materials.map((entry) => entry.materialId).join('+'), variantId: 'resolved', mask: tile.occupancyMask, width: size, height: size, pixels };
}
