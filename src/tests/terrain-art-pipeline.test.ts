import { describe, expect, it } from 'vitest';
import {
  activeTerrainArtOccurrenceOverrides, addTerrainArtMaterial, compileTerrainArtRuntime,
  createMemoryTerrainArtStorage, createTerrainArtProject, editTerrainArtSourceTile,
  getTerrainArtOccurrenceStatus, hashTerrainArtProject, loadTerrainArtProject,
  paintTerrainArtLogicalCells, prepareTerrainArtDualGrid, removeTerrainArtMaterial,
  renameTerrainArtMaterial, resetTerrainArtMaterial,
  resizeTerrainArtProject, saveTerrainArtProject, selectTerrainArtVariant,
  terrainArtLogicalFill, terrainArtLogicalLine, terrainArtRuntimeSourceRect,
  updateTerrainArtLayer,
  addTerrainArtVariant, pinTerrainArtOccurrenceVariant, terrainArtVariantUsage,
  transformTerrainArtSourceTile, moveTerrainArtSourceTile,
  resolveTerrainArtTransitions, setTerrainArtTransitionRule,
  resolveTerrainArtDualTile,
  renderResolvedTerrainArtTile,
  generateTerrainArtMaterialAtlas,
  editTerrainArtOccurrenceLayer, renderTerrainArtOccurrenceTile,
  moveTerrainArtSourceSelection, diagnoseTerrainArtExport,
} from '../index';
import type { TerrainArtDualGridMask } from '../index';

describe('terrain art complete pipeline foundations', () => {
  it('paints logical terrain without exposing mask ids', () => {
    const grid = { cols: 3, rows: 2, tileSize: 16, data: [0, 0, 0, 0, 1, 1] };
    expect(terrainArtLogicalLine({ col: 0, row: 0 }, { col: 2, row: 0 })).toHaveLength(3);
    expect(terrainArtLogicalFill(grid, { col: 0, row: 0 })).toHaveLength(4);
    expect(paintTerrainArtLogicalCells(grid, [{ col: 0, row: 0 }], 1).data[0]).toBe(1);
  });

  it('composites multiple materials against one union-world contour', () => {
    const source = addTerrainArtMaterial(createTerrainArtProject({ authoringResolution: 16 }), 'rock', 'Rock');
    const tile = { dualX: 1, dualY: 1, occupancyMask: 15 as const, materials: [{ materialId: 'solid', mask: 9 as const, priority: 10 }, { materialId: 'rock', mask: 6 as const, priority: 20 }] };
    const rendered = renderResolvedTerrainArtTile(source, tile);
    expect(rendered.pixels.filter((_, index) => index % 4 === 3 && rendered.pixels[index] === 0)).toHaveLength(0);
  });

  it('resolves all 625 empty/four-material corner combinations without gaps or overlap', () => {
    const kinds = [
      { id: 'empty', label: 'Empty', tileValue: 0, collision: 'empty' as const, materialId: null, connectGroup: 'empty', renderPriority: 0 },
      ...[1, 2, 3, 4].map((value) => ({ id: `m${value}`, label: `M${value}`, tileValue: value, collision: 'solid' as const, materialId: `m${value}`, connectGroup: 'solid', renderPriority: value * 10 })),
    ];
    let checked = 0;
    for (let nw = 0; nw < 5; nw++) for (let ne = 0; ne < 5; ne++) for (let se = 0; se < 5; se++) for (let sw = 0; sw < 5; sw++) {
      const tile = resolveTerrainArtDualTile({ cols: 2, rows: 2, tileSize: 16, data: [nw, ne, sw, se] }, kinds, 1, 1);
      const union = tile.materials.reduce((mask, material) => mask | material.mask, 0);
      expect(union).toBe(tile.occupancyMask);
      for (let first = 0; first < tile.materials.length; first++) for (let second = first + 1; second < tile.materials.length; second++) expect(tile.materials[first]!.mask & tile.materials[second]!.mask).toBe(0);
      checked++;
    }
    expect(checked).toBe(625);
  });

  it('supports variant management, pinning, transforms, and explicit transitions', () => {
    let source = createTerrainArtProject({ authoringResolution: 16 });
    source = editTerrainArtSourceTile(source, 'solid', 'manual', 15, 'default', [{ x: 2, y: 3, mode: 'paint', colorRef: 'accent' }]);
    source = transformTerrainArtSourceTile(source, 'solid', 'manual', 15, 'default', 'flip-horizontal');
    expect(source.materials[0]!.layers.find((layer) => layer.id === 'manual')!.patches?.[0]?.runs[0]).toMatchObject({ x: 13, y: 3 });
    source = moveTerrainArtSourceTile(source, 'solid', 'manual', 15, 'default', 0, 2);
    expect(source.materials[0]!.layers.find((layer) => layer.id === 'manual')!.patches?.[0]?.runs[0]).toMatchObject({ x: 13, y: 5 });
    source = addTerrainArtVariant(source, 'solid', { id: 'cracked', label: 'Cracked', enabled: true, weight: 2, eligibleMasks: [15], exposure: 'interior', seedOffset: 4 });
    source = pinTerrainArtOccurrenceVariant(source, 'level', 1, 1, 'solid', 15, 'default', 'cracked');
    expect(terrainArtVariantUsage(source, 'solid')).toEqual({ cracked: 1 });
    const multi = addTerrainArtMaterial(source, 'rock', 'Rock');
    const ruled = setTerrainArtTransitionRule(multi, { foregroundMaterialId: 'rock', backgroundMaterialId: 'solid', mode: 'contour', width: 2, colorRef: 'contour' });
    expect(resolveTerrainArtTransitions(ruled, { dualX: 0, dualY: 0, occupancyMask: 3, materials: [{ materialId: 'solid', mask: 1, priority: 10 }, { materialId: 'rock', mask: 2, priority: 20 }] })).toEqual([expect.objectContaining({ mode: 'contour', width: 2 })]);
    const material = source.materials[0]!; const coordinates = Array.from({ length: 20 }, (_, index) => ({ x: index, y: index * 3 }));
    const forward = coordinates.map(({ x, y }) => `${x},${y}:${selectTerrainArtVariant(material, 15, x, y, 44)?.id}`);
    const reverse = [...coordinates].reverse().map(({ x, y }) => `${x},${y}:${selectTerrainArtVariant(material, 15, x, y, 44)?.id}`).reverse();
    expect(reverse).toEqual(forward);
    expect(selectTerrainArtVariant(material, 15, 2, 4, 999, 'cracked')?.id).toBe('cracked');
  });

  it('manages materials safely and preserves bound kinds on replacement', () => {
    const source = createTerrainArtProject();
    const added = addTerrainArtMaterial(source, 'rock', 'Rock', 'rock');
    expect(added.materials.map((item) => item.id)).toEqual(['solid', 'rock']);
    const rebound = { ...added, terrainKinds: added.terrainKinds.map((kind) => kind.id === 'solid' ? { ...kind, materialId: 'rock' } : kind) };
    const removed = removeTerrainArtMaterial(rebound, 'rock', 'solid');
    expect(removed.terrainKinds.find((kind) => kind.id === 'solid')?.materialId).toBe('solid');
  });

  it('renames and restores a material without breaking stable level bindings', () => {
    const source = editTerrainArtSourceTile(createTerrainArtProject(), 'solid', 'manual', 15, 'default', [{ x: 2, y: 2, mode: 'paint', colorRef: 'accent' }]);
    const renamed = renameTerrainArtMaterial(source, 'solid', 'Forest floor');
    const restored = resetTerrainArtMaterial(renamed, 'solid', 'rock');
    expect(restored.materials[0]).toMatchObject({ id: 'solid', name: 'Forest floor', generator: { roundness: .45, contourWidth: 7 } });
    expect(restored.materials[0]!.layers.find((layer) => layer.id === 'manual')?.patches).toEqual([]);
    expect(restored.terrainKinds.find((kind) => kind.id === 'solid')?.materialId).toBe('solid');
  });

  it('keeps layers isolated and resamples sparse manual runs on resolution change', () => {
    const source = editTerrainArtSourceTile(createTerrainArtProject({ authoringResolution: 16 }), 'solid', 'manual', 15, 'default', [{ x: 8, y: 8, mode: 'paint', colorRef: 'accent' }]);
    const hidden = updateTerrainArtLayer(source, 'solid', 'manual', { visible: false });
    expect(hidden.materials[0]!.layers.find((layer) => layer.id === 'base')!.visible).toBe(true);
    const resized = resizeTerrainArtProject(hidden, 32);
    expect(resized.materials[0]!.layers.find((layer) => layer.id === 'manual')!.patches?.[0]?.runs[0]).toMatchObject({ x: 16, y: 16 });
  });

  it('selects variants independently of draw order and compiles guttered atlases', () => {
    const source = createTerrainArtProject({ authoringResolution: 16, visualSeed: 9 });
    const material = source.materials[0]!;
    expect(selectTerrainArtVariant(material, 15, 4, 7, 9)?.id).toBe(selectTerrainArtVariant(material, 15, 4, 7, 9)?.id);
    const runtime = compileTerrainArtRuntime(source, 1);
    expect(runtime.manifest.sourceHash).toBe(hashTerrainArtProject(source));
    expect(runtime.atlases[0]).toMatchObject({ tileSize: 16, sourceTileStride: 18, width: 72, height: 72 });
    expect(terrainArtRuntimeSourceRect(runtime.atlases[0]!, 15)).toEqual({ x: 55, y: 55, width: 16, height: 16 });
    const editor = generateTerrainArtMaterialAtlas(source, 'solid'); const baked = runtime.atlases[0]!;
    for (let mask = 0; mask < 16; mask++) {
      const sourceRect = terrainArtRuntimeSourceRect(baked, mask as TerrainArtDualGridMask);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) for (let channel = 0; channel < 4; channel++) {
        const editorOffset = ((Math.floor(mask / 4) * 16 + y) * editor.width + (mask % 4) * 16 + x) * 4 + channel;
        const bakedOffset = ((sourceRect.y + y) * baked.width + sourceRect.x + x) * 4 + channel;
        expect(baked.pixels[bakedOffset]).toBe(editor.pixels[editorOffset]);
      }
    }
  });

  it('round-trips through a never-throw storage adapter', async () => {
    const source = createTerrainArtProject(); const storage = createMemoryTerrainArtStorage();
    expect((await saveTerrainArtProject(storage, source)).ok).toBe(true);
    expect((await loadTerrainArtProject(storage, source.id)).project).toEqual(source);
  });

  it('marks drifted occurrence overrides stale and excludes them safely', () => {
    const source = createTerrainArtProject({ authoringResolution: 16 });
    const grid = { cols: 1, rows: 1, tileSize: 16, data: [1] };
    const prepared = prepareTerrainArtDualGrid(grid, source.terrainKinds);
    const override = { levelId: 'level', dualX: 0, dualY: 0, materialId: 'solid', expectedMask: 15 as const, expectedVariantId: 'default', layerPatches: [] };
    const project = { ...source, occurrenceOverrides: [override] };
    expect(getTerrainArtOccurrenceStatus(override, 'level', prepared, project)).toBe('stale');
    expect(activeTerrainArtOccurrenceOverrides(project, 'level', prepared)).toEqual([]);
    expect(diagnoseTerrainArtExport(project, { level: prepared })).toEqual([expect.objectContaining({ code: 'occurrence-stale', severity: 'warning' })]);
  });

  it('renders active local edits separately and moves selected source pixels only', () => {
    let source = createTerrainArtProject({ authoringResolution: 16 });
    source = editTerrainArtSourceTile(source, 'solid', 'manual', 15, 'default', [{ x: 1, y: 1, mode: 'paint', colorRef: 'accent' }, { x: 8, y: 8, mode: 'paint', colorRef: 'accent' }]);
    source = moveTerrainArtSourceSelection(source, 'solid', 'manual', 15, 'default', { x: 0, y: 0, width: 4, height: 4 }, 2, 0);
    const runs = source.materials[0]!.layers.find((layer) => layer.id === 'manual')!.patches?.[0]?.runs ?? [];
    expect(runs.some((run) => run.x === 3 && run.y === 1)).toBe(true); expect(runs.some((run) => run.x === 8 && run.y === 8)).toBe(true);
    source = editTerrainArtOccurrenceLayer(source, 'level', 1, 1, 'solid', 15, 'default', 'manual', [{ x: 4, y: 4, mode: 'paint', rgba: 0xff0000ff }]);
    const override = source.occurrenceOverrides[0]!; const local = renderTerrainArtOccurrenceTile(source, override);
    expect([...local.pixels.slice((4 * 16 + 4) * 4, (4 * 16 + 4) * 4 + 4)]).toEqual([255, 0, 0, 255]);
  });
});
