import { clearTerrainArtSourceTileEdits, editTerrainArtSourceTile } from './manual-paint';
import type { TerrainArtDualGridMask, TerrainArtProject, TerrainPixelRun } from './types';

export type TerrainArtTransform = 'flip-horizontal' | 'flip-vertical' | 'rotate-clockwise';

function transformPoint(x: number, y: number, size: number, transform: TerrainArtTransform): { x: number; y: number } {
  if (transform === 'flip-horizontal') return { x: size - 1 - x, y };
  if (transform === 'flip-vertical') return { x, y: size - 1 - y };
  return { x: size - 1 - y, y: x };
}

function patchRuns(project: Readonly<TerrainArtProject>, materialId: string, layerId: string, mask: TerrainArtDualGridMask, variantId: string): readonly Readonly<TerrainPixelRun>[] {
  return project.materials.find((material) => material.id === materialId)?.layers.find((layer) => layer.id === layerId)?.patches?.find((patch) => patch.mask === mask && patch.variantId === variantId)?.runs ?? [];
}

/** Flip or rotate one sparse manual source tile. */
export function transformTerrainArtSourceTile(project: Readonly<TerrainArtProject>, materialId: string, layerId: string, mask: TerrainArtDualGridMask, variantId: string, transform: TerrainArtTransform): TerrainArtProject {
  const edits = [];
  for (const run of patchRuns(project, materialId, layerId, mask, variantId)) for (let x = run.x; x < run.x + run.length; x++) {
    const point = transformPoint(x, run.y, project.authoringResolution, transform);
    edits.push({ ...point, mode: run.mode, ...(run.rgba !== undefined ? { rgba: run.rgba } : {}), ...(run.colorRef !== undefined ? { colorRef: run.colorRef } : {}) });
  }
  return editTerrainArtSourceTile(clearTerrainArtSourceTileEdits(project, materialId, layerId, mask, variantId), materialId, layerId, mask, variantId, edits);
}

/** Move manual pixels by an integer offset; pixels outside the tile are discarded. */
export function moveTerrainArtSourceTile(project: Readonly<TerrainArtProject>, materialId: string, layerId: string, mask: TerrainArtDualGridMask, variantId: string, dx: number, dy: number): TerrainArtProject {
  const edits = [];
  for (const run of patchRuns(project, materialId, layerId, mask, variantId)) for (let x = run.x; x < run.x + run.length; x++) {
    edits.push({ x: x + Math.trunc(dx), y: run.y + Math.trunc(dy), mode: run.mode, ...(run.rgba !== undefined ? { rgba: run.rgba } : {}), ...(run.colorRef !== undefined ? { colorRef: run.colorRef } : {}) });
  }
  return editTerrainArtSourceTile(clearTerrainArtSourceTileEdits(project, materialId, layerId, mask, variantId), materialId, layerId, mask, variantId, edits);
}

export interface TerrainArtPixelSelection { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** Move only pixels inside a rectangular selection; unselected pixels stay put. */
export function moveTerrainArtSourceSelection(project: Readonly<TerrainArtProject>, materialId: string, layerId: string, mask: TerrainArtDualGridMask, variantId: string, selection: Readonly<TerrainArtPixelSelection>, dx: number, dy: number): TerrainArtProject {
  const edits = [];
  for (const run of patchRuns(project, materialId, layerId, mask, variantId)) for (let x = run.x; x < run.x + run.length; x++) {
    const selected = x >= selection.x && x < selection.x + selection.width && run.y >= selection.y && run.y < selection.y + selection.height;
    edits.push({ x: selected ? x + Math.trunc(dx) : x, y: selected ? run.y + Math.trunc(dy) : run.y, mode: run.mode, ...(run.rgba !== undefined ? { rgba: run.rgba } : {}), ...(run.colorRef !== undefined ? { colorRef: run.colorRef } : {}) });
  }
  return editTerrainArtSourceTile(clearTerrainArtSourceTileEdits(project, materialId, layerId, mask, variantId), materialId, layerId, mask, variantId, edits);
}

/** Copy one manual patch onto another mask/variant as a stamp. */
export function stampTerrainArtSourceTile(project: Readonly<TerrainArtProject>, materialId: string, layerId: string, sourceMask: TerrainArtDualGridMask, sourceVariantId: string, targetMask: TerrainArtDualGridMask, targetVariantId: string): TerrainArtProject {
  const edits = [];
  for (const run of patchRuns(project, materialId, layerId, sourceMask, sourceVariantId)) for (let x = run.x; x < run.x + run.length; x++) edits.push({ x, y: run.y, mode: run.mode, ...(run.rgba !== undefined ? { rgba: run.rgba } : {}), ...(run.colorRef !== undefined ? { colorRef: run.colorRef } : {}) });
  return editTerrainArtSourceTile(project, materialId, layerId, targetMask, targetVariantId, edits);
}
