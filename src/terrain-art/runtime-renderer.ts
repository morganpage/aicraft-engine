import type {
  PreparedTerrainArtDualGrid,
  ResolvedTerrainArtMaterial,
  TerrainArtPixelAtlas,
} from './types';
import { terrainArtMaskExposure } from './variants';
import type { CompiledTerrainArtRuntime, TerrainArtRuntimeMaterialEntry } from './compiler';

/** World-space rectangle used to cull atlas-backed dual-grid drawing. */
export interface TerrainArtDrawView {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Inputs for drawing one prepared material pass from a generated atlas. */
export interface DrawPreparedTerrainArtDualGridOptions {
  readonly atlas: Readonly<TerrainArtPixelAtlas>;
  readonly image: CanvasImageSource;
  readonly view: Readonly<TerrainArtDrawView>;
}

/** Draw one culled material pass and return the number of visual tiles drawn. */
export function drawPreparedTerrainArtDualGrid(
  context: CanvasRenderingContext2D,
  prepared: Readonly<PreparedTerrainArtDualGrid>,
  options: Readonly<DrawPreparedTerrainArtDualGridOptions>,
): number {
  if (
    context === null || typeof context !== 'object' ||
    prepared === null || typeof prepared !== 'object' ||
    options === null || typeof options !== 'object' ||
    !Number.isInteger(prepared.cols) || prepared.cols <= 0 ||
    !Number.isInteger(prepared.rows) || prepared.rows <= 0 ||
    !Number.isFinite(prepared.tileSize) || prepared.tileSize <= 0 ||
    !Array.isArray(prepared.tiles) ||
    options.atlas.tileSize <= 0 || options.atlas.maskToIndex.length < 16 ||
    !Number.isFinite(options.view.x) || !Number.isFinite(options.view.y) ||
    !Number.isFinite(options.view.width) || options.view.width <= 0 ||
    !Number.isFinite(options.view.height) || options.view.height <= 0
  ) return 0;
  const size = prepared.tileSize;
  const half = size / 2;
  const right = options.view.x + options.view.width;
  const bottom = options.view.y + options.view.height;
  const startCol = Math.max(0, Math.floor((options.view.x + half) / size));
  const endCol = Math.min(prepared.cols, Math.ceil((right + half) / size));
  const startRow = Math.max(0, Math.floor((options.view.y + half) / size));
  const endRow = Math.min(prepared.rows, Math.ceil((bottom + half) / size));
  let drawn = 0;
  for (let row = startRow; row < endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      const tile = prepared.tiles[row * prepared.cols + col];
      const material = tile?.materials.find((entry: Readonly<ResolvedTerrainArtMaterial>) =>
        entry.materialId === options.atlas.materialId);
      if (material === undefined || material.mask === 0) continue;
      const atlasIndex = options.atlas.maskToIndex[material.mask] ?? -1;
      if (atlasIndex < 0) continue;
      const sourceX = atlasIndex % options.atlas.columns * options.atlas.tileSize;
      const sourceY = Math.floor(atlasIndex / options.atlas.columns) * options.atlas.tileSize;
      const worldX = col * size - half;
      const worldY = row * size - half;
      try {
        context.drawImage(
          options.image,
          sourceX,
          sourceY,
          options.atlas.tileSize,
          options.atlas.tileSize,
          worldX,
          worldY,
          size,
          size,
        );
        drawn++;
      } catch {
        return drawn;
      }
    }
  }
  return drawn;
}

export interface DrawCompiledTerrainArtDualGridOptions {
  readonly images: readonly CanvasImageSource[];
  readonly view: Readonly<TerrainArtDrawView>;
  readonly pinnedVariant?: (dualX: number, dualY: number, materialId: string) => string | undefined;
}

function runtimeHash(seed: number, x: number, y: number, mask: number): number {
  let value = (seed ^ Math.imul(x + 0x4000, 0x9e3779b1) ^ Math.imul(y + 0x4000, 0x85ebca6b) ^ Math.imul(mask, 0xc2b2ae35)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d); value = Math.imul(value ^ (value >>> 15), 0x846ca68b); return (value ^ (value >>> 16)) >>> 0;
}

function selectRuntimeEntry(runtime: Readonly<CompiledTerrainArtRuntime>, materialId: string, mask: number, x: number, y: number, pinned?: string): Readonly<TerrainArtRuntimeMaterialEntry> | undefined {
  const entries = runtime.manifest.materials.filter((entry) => entry.materialId === materialId && entry.weight > 0 && entry.eligibleMasks.includes(mask as never) && (entry.exposure === 'any' || entry.exposure === terrainArtMaskExposure(mask as never)));
  const pinnedEntry = entries.find((entry) => entry.variantId === pinned); if (pinnedEntry) return pinnedEntry;
  if (entries.length === 0) return runtime.manifest.materials.find((entry) => entry.materialId === materialId && entry.variantId === 'default') ?? runtime.manifest.materials.find((entry) => entry.materialId === materialId);
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0); let sample = runtimeHash(runtime.manifest.visualSeed, x, y, mask) / 0x100000000 * total;
  for (const entry of entries) { sample -= entry.weight; if (sample < 0) return entry; } return entries[entries.length - 1];
}

/** Draw baked runtime atlases with deterministic per-occurrence variant selection. */
export function drawCompiledTerrainArtDualGrid(context: CanvasRenderingContext2D, prepared: Readonly<PreparedTerrainArtDualGrid>, runtime: Readonly<CompiledTerrainArtRuntime>, options: Readonly<DrawCompiledTerrainArtDualGridOptions>): number {
  const size = prepared.tileSize; const half = size / 2; let drawn = 0;
  for (const tile of prepared.tiles) {
    const worldX = tile.dualX * size - half; const worldY = tile.dualY * size - half;
    if (worldX + size < options.view.x || worldY + size < options.view.y || worldX > options.view.x + options.view.width || worldY > options.view.y + options.view.height) continue;
    for (const material of tile.materials) {
      const entry = selectRuntimeEntry(runtime, material.materialId, material.mask, tile.dualX, tile.dualY, options.pinnedVariant?.(tile.dualX, tile.dualY, material.materialId)); if (!entry) continue;
      const atlas = runtime.atlases[entry.atlasIndex]; const image = options.images[entry.atlasIndex]; if (!atlas || !image) continue;
      const source = { x: (material.mask % 4) * atlas.sourceTileStride + atlas.gutter, y: Math.floor(material.mask / 4) * atlas.sourceTileStride + atlas.gutter, width: atlas.tileSize, height: atlas.tileSize };
      try { context.drawImage(image, source.x, source.y, source.width, source.height, worldX, worldY, size, size); drawn++; } catch { return drawn; }
    }
  }
  return drawn;
}

/**
 * Whole-tile rule rendering: draw one complete source tile per logical cell
 * whose rule matched. Iterates the logical grid (full-cell offsets, no
 * half-tile shift), culls to the viewport, and blits each cell's matched whole
 * tile from the rule atlas. This is the LDtk-style path that conventional
 * whole-unit tilesets render through.
 */
export interface DrawPreparedTerrainArtRuleGridOptions {
  readonly atlas: Readonly<import('./rule-atlas').TerrainArtRuleAtlas>;
  readonly image: CanvasImageSource;
  readonly view: Readonly<TerrainArtDrawView>;
}

export function drawPreparedTerrainArtRuleGrid(
  context: CanvasRenderingContext2D,
  prepared: Readonly<import('./rule-grid').PreparedTerrainArtRuleGrid>,
  options: Readonly<DrawPreparedTerrainArtRuleGridOptions>,
): number {
  if (
    context === null || typeof context !== 'object' ||
    prepared === null || typeof prepared !== 'object' ||
    options === null || typeof options !== 'object' ||
    !Number.isInteger(prepared.cols) || prepared.cols <= 0 ||
    !Number.isInteger(prepared.rows) || prepared.rows <= 0 ||
    !Number.isFinite(prepared.tileSize) || prepared.tileSize <= 0 ||
    !Array.isArray(prepared.tiles) ||
    options.atlas.tileSize <= 0 || options.atlas.entries.length === 0 ||
    !Number.isFinite(options.view.width) || options.view.width <= 0 ||
    !Number.isFinite(options.view.height) || options.view.height <= 0
  ) return 0;
  const size = prepared.tileSize;
  const startCol = Math.max(0, Math.floor(options.view.x / size));
  const endCol = Math.min(prepared.cols, Math.ceil((options.view.x + options.view.width) / size));
  const startRow = Math.max(0, Math.floor(options.view.y / size));
  const endRow = Math.min(prepared.rows, Math.ceil((options.view.y + options.view.height) / size));
  let drawn = 0;
  for (let row = startRow; row < endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      const tile = prepared.tiles[row * prepared.cols + col];
      if (tile === undefined || tile.ruleIndex < 0) continue;
      const entry = options.atlas.entries[tile.ruleIndex];
      if (entry === undefined) continue;
      const worldX = col * size;
      const worldY = row * size;
      try {
        context.drawImage(
          options.image,
          entry.x, entry.y, options.atlas.tileSize, options.atlas.tileSize,
          worldX, worldY, size, size,
        );
        drawn++;
      } catch {
        return drawn;
      }
    }
  }
  return drawn;
}
