import { generateTerrainArtMaterialAtlas } from './atlas';
import type { TerrainArtImportedAssetResolver } from './compositor';
import { hashTerrainArtProject } from './storage';
import type { TerrainArtDualGridMask, TerrainArtPixelAtlas, TerrainArtProject } from './types';

export interface CompiledTerrainArtAtlas extends TerrainArtPixelAtlas {
  readonly gutter: number;
  readonly sourceTileStride: number;
}

export interface TerrainArtRuntimeMaterialEntry {
  readonly materialId: string;
  readonly variantId: string;
  readonly atlasIndex: number;
  readonly priority: number;
  readonly weight: number;
  readonly eligibleMasks: readonly TerrainArtDualGridMask[];
  readonly exposure: 'any' | 'top' | 'side' | 'interior';
  readonly seedOffset: number;
}

export interface TerrainArtRuntimeManifest {
  readonly version: 1;
  readonly sourceHash: string;
  readonly authoringResolution: number;
  readonly visualSeed: number;
  readonly materials: readonly TerrainArtRuntimeMaterialEntry[];
}

export interface CompiledTerrainArtRuntime {
  readonly manifest: TerrainArtRuntimeManifest;
  readonly atlases: readonly CompiledTerrainArtAtlas[];
}

function withGutter(atlas: Readonly<TerrainArtPixelAtlas>, gutter: number): CompiledTerrainArtAtlas {
  const g = Math.max(0, Math.floor(gutter)); const stride = atlas.tileSize + g * 2;
  const width = stride * atlas.columns; const height = stride * atlas.rows;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let mask = 0; mask < 16; mask++) {
    const sourceCol = mask % 4; const sourceRow = Math.floor(mask / 4);
    const targetX = sourceCol * stride + g; const targetY = sourceRow * stride + g;
    for (let y = -g; y < atlas.tileSize + g; y++) for (let x = -g; x < atlas.tileSize + g; x++) {
      const sx = sourceCol * atlas.tileSize + Math.max(0, Math.min(atlas.tileSize - 1, x));
      const sy = sourceRow * atlas.tileSize + Math.max(0, Math.min(atlas.tileSize - 1, y));
      const tx = targetX + x; const ty = targetY + y;
      const source = (sy * atlas.width + sx) * 4; const target = (ty * width + tx) * 4;
      pixels[target] = atlas.pixels[source] ?? 0; pixels[target + 1] = atlas.pixels[source + 1] ?? 0;
      pixels[target + 2] = atlas.pixels[source + 2] ?? 0; pixels[target + 3] = atlas.pixels[source + 3] ?? 0;
    }
  }
  return { ...atlas, width, height, pixels, gutter: g, sourceTileStride: stride };
}

/** Compile every enabled material/variant into deterministic runtime-only atlases. */
export function compileTerrainArtRuntime(project: Readonly<TerrainArtProject>, gutter = 1, resolveImportedAsset?: TerrainArtImportedAssetResolver): CompiledTerrainArtRuntime {
  const atlases: CompiledTerrainArtAtlas[] = []; const materials: TerrainArtRuntimeMaterialEntry[] = [];
  for (const material of [...project.materials].filter((item) => item.enabled).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))) {
    for (const variant of material.variants.filter((item) => item.enabled).sort((a, b) => a.id.localeCompare(b.id))) {
      materials.push({ materialId: material.id, variantId: variant.id, atlasIndex: atlases.length, priority: material.priority, weight: variant.weight, eligibleMasks: [...variant.eligibleMasks], exposure: variant.exposure, seedOffset: variant.seedOffset });
      atlases.push(withGutter(generateTerrainArtMaterialAtlas(project, material.id, variant.id, resolveImportedAsset), gutter));
    }
  }
  return { manifest: { version: 1, sourceHash: hashTerrainArtProject(project), authoringResolution: project.authoringResolution, visualSeed: project.visualSeed, materials }, atlases };
}

export function terrainArtRuntimeSourceRect(atlas: Readonly<CompiledTerrainArtAtlas>, mask: TerrainArtDualGridMask): { x: number; y: number; width: number; height: number } {
  return { x: (mask % 4) * atlas.sourceTileStride + atlas.gutter, y: Math.floor(mask / 4) * atlas.sourceTileStride + atlas.gutter, width: atlas.tileSize, height: atlas.tileSize };
}
