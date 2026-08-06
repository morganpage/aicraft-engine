import type {
  TerrainArtDualGridMask,
  TerrainArtLayer,
  TerrainArtPalette,
  TerrainArtProject,
  TerrainPixelRun,
  TerrainSourcePatch,
} from './types';

export interface TerrainArtPixelEdit {
  readonly x: number;
  readonly y: number;
  readonly mode: 'paint' | 'erase' | 'inherit';
  readonly rgba?: number;
  readonly colorRef?: keyof TerrainArtPalette;
}

function samePaint(a: Readonly<TerrainPixelRun>, b: Readonly<TerrainPixelRun>): boolean {
  return a.mode === b.mode && a.rgba === b.rgba && a.colorRef === b.colorRef;
}

function normalizePixels(runs: readonly Readonly<TerrainPixelRun>[], resolution: number): TerrainPixelRun[] {
  const pixels = new Map<number, TerrainPixelRun>();
  for (const run of runs) {
    if (!Number.isInteger(run.x) || !Number.isInteger(run.y) || !Number.isInteger(run.length)) continue;
    for (let x = Math.max(0, run.x); x < Math.min(resolution, run.x + run.length); x++) {
      if (run.y >= 0 && run.y < resolution) pixels.set(run.y * resolution + x, { ...run, x, length: 1 });
    }
  }
  const ordered = [...pixels.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  const result: TerrainPixelRun[] = [];
  for (const pixel of ordered) {
    const previous = result[result.length - 1];
    if (previous && previous.y === pixel.y && previous.x + previous.length === pixel.x && samePaint(previous, pixel)) {
      result[result.length - 1] = { ...previous, length: previous.length + 1 };
    } else result.push(pixel);
  }
  return result;
}

function updateManualLayer(
  project: Readonly<TerrainArtProject>, materialId: string, layerId: string,
  update: (layer: Readonly<TerrainArtLayer>) => TerrainArtLayer,
): TerrainArtProject {
  return {
    ...project,
    materials: project.materials.map((material) => material.id !== materialId ? material : ({
      ...material,
      layers: material.layers.map((layer) => layer.id === layerId && layer.type === 'manual' && !layer.locked ? update(layer) : layer),
    })),
  };
}

/** Apply sparse pixel edits to one reusable source tile without touching generated layers. */
export function editTerrainArtSourceTile(
  project: Readonly<TerrainArtProject>, materialId: string, layerId: string,
  mask: TerrainArtDualGridMask, variantId: string,
  edits: readonly Readonly<TerrainArtPixelEdit>[],
): TerrainArtProject {
  return updateManualLayer(project, materialId, layerId, (layer) => {
    const patches = layer.patches ?? [];
    const current = patches.find((patch) => patch.mask === mask && patch.variantId === variantId);
    const pixels = new Map<number, TerrainPixelRun>();
    for (const run of normalizePixels(current?.runs ?? [], project.authoringResolution)) {
      for (let x = run.x; x < run.x + run.length; x++) {
        pixels.set(run.y * project.authoringResolution + x, { ...run, x, length: 1 });
      }
    }
    for (const edit of edits) {
      if (!Number.isInteger(edit.x) || !Number.isInteger(edit.y) || edit.x < 0 || edit.y < 0 || edit.x >= project.authoringResolution || edit.y >= project.authoringResolution) continue;
      const key = edit.y * project.authoringResolution + edit.x;
      if (edit.mode === 'inherit') pixels.delete(key);
      else pixels.set(key, { x: edit.x, y: edit.y, length: 1, mode: edit.mode,
        ...(edit.colorRef !== undefined ? { colorRef: edit.colorRef } : {}),
        ...(edit.rgba !== undefined ? { rgba: edit.rgba } : {}) });
    }
    const runs = normalizePixels([...pixels.values()], project.authoringResolution);
    const nextPatch: TerrainSourcePatch = { mask, variantId, runs };
    return { ...layer, patches: [
      ...patches.filter((patch) => patch.mask !== mask || patch.variantId !== variantId),
      ...(runs.length ? [nextPatch] : []),
    ].sort((a, b) => a.mask - b.mask || a.variantId.localeCompare(b.variantId)) };
  });
}

/** Remove a source tile's manual patch, revealing its current procedural output. */
export function clearTerrainArtSourceTileEdits(
  project: Readonly<TerrainArtProject>, materialId: string, layerId: string,
  mask: TerrainArtDualGridMask, variantId: string,
): TerrainArtProject {
  return updateManualLayer(project, materialId, layerId, (layer) => ({
    ...layer,
    patches: (layer.patches ?? []).filter((patch) => patch.mask !== mask || patch.variantId !== variantId),
  }));
}
