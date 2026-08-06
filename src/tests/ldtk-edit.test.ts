/**
 * Editing operations and the invariant that makes live auto-tiling safe.
 *
 * The load-bearing property is region invariance: re-resolving only the cells
 * an edit dirtied must produce exactly the tiles a full-layer resolve would
 * have placed there. If it does not, a painted level drifts from the same level
 * reopened — the tiles you see while drawing would not be the tiles you saved.
 */

import { describe, expect, it } from 'vitest';
import {
  addLdtkEntity,
  moveLdtkEntity,
  paintLdtkIntGrid,
  removeLdtkEntity,
  resizeLdtkLevel,
  setLdtkEntityField,
  setLdtkOptionalRuleGroup,
  widenDirtyRect,
} from '../ldtk/edit';
import { ldtkRuleSourceFromCsv, runLdtkAutoLayer } from '../ldtk/rules';
import { allOracleCases, diffTiles, type LdtkOracleCase } from './ldtk-fixtures';
import type { LdtkEntityInstance, LdtkTile } from '../ldtk/types';

/** Resolve a case, optionally windowed to a region. */
function resolve(testCase: LdtkOracleCase, csv: readonly number[], region?: {
  cx: number; cy: number; cols: number; rows: number;
}): readonly LdtkTile[] {
  const source = ldtkRuleSourceFromCsv(csv, testCase.cols, testCase.rows, testCase.layerDef);
  return runLdtkAutoLayer(source, testCase.layerDef, {
    seed: testCase.layer.seed ?? 0,
    enabledOptionalGroups: testCase.layer.optionalRules ?? [],
    gridSize: testCase.layer.__gridSize,
    tileset: testCase.tileset,
    ...(testCase.biomeValues === undefined ? {} : { biomeValues: testCase.biomeValues }),
    ...(region === undefined ? {} : { region }),
  });
}

/** Cases big enough for a windowed resolve to be a meaningful subset. */
const cases = allOracleCases().filter((c) => c.cols >= 12 && c.rows >= 12).slice(0, 8);

describe('dirty-region invalidation', () => {
  it('has cases to check', () => {
    expect(cases.length).toBeGreaterThan(3);
  });

  for (const testCase of cases) {
    it(`quadrant resolves union to the full resolve — ${testCase.sample} · ${testCase.layerDef.identifier}`, () => {
      const csv = testCase.intGrid;
      const full = resolve(testCase, csv);

      // Partition the grid into four disjoint regions covering every cell.
      // Every matched cell therefore falls in exactly one region, so the union
      // of the four windowed resolves must reproduce the full resolve exactly —
      // no tile lost at a seam, none counted twice. That is precisely the
      // property live re-tiling depends on.
      const halfX = Math.ceil(testCase.cols / 2);
      const halfY = Math.ceil(testCase.rows / 2);
      const quadrants = [
        { cx: 0, cy: 0, cols: halfX, rows: halfY },
        { cx: halfX, cy: 0, cols: testCase.cols - halfX, rows: halfY },
        { cx: 0, cy: halfY, cols: halfX, rows: testCase.rows - halfY },
        { cx: halfX, cy: halfY, cols: testCase.cols - halfX, rows: testCase.rows - halfY },
      ];
      const union = quadrants.flatMap((region) => resolve(testCase, csv, region));

      const { matched, missing, extra } = diffTiles(union, full);
      expect({ missing: missing.slice(0, 3), extra: extra.slice(0, 3), matched })
        .toEqual({ missing: [], extra: [], matched: full.length });
    });
  }

  it('confines the effect of a one-cell edit to the reported dirty region', () => {
    const testCase = cases.find((c) => c.layerDef.autoRuleGroups?.some((g) => g.rules.length > 0));
    expect(testCase).toBeDefined();
    if (testCase === undefined) return;

    const cx = Math.floor(testCase.cols / 2);
    const cy = Math.floor(testCase.rows / 2);
    const index = cx + cy * testCase.cols;
    const edited = [...testCase.intGrid];
    edited[index] = edited[index] === 0 ? 1 : 0;

    const before = resolve(testCase, testCase.intGrid);
    const after = resolve(testCase, edited);
    const dirty = widenDirtyRect({ cx, cy, cols: 1, rows: 1 }, testCase.layerDef);

    // Whatever the edit changed must lie inside the region the editor was told
    // to invalidate. A difference outside it would mean stale art surviving a
    // paint stroke — the exact failure dirty-region tracking exists to prevent.
    const { missing, extra } = diffTiles(after, before);
    const gridSize = testCase.layer.__gridSize;
    for (const tile of [...missing, ...extra]) {
      const tx = Math.floor(tile.px[0] / gridSize);
      const ty = Math.floor(tile.px[1] / gridSize);
      expect(tx).toBeGreaterThanOrEqual(dirty.cx);
      expect(ty).toBeGreaterThanOrEqual(dirty.cy);
      expect(tx).toBeLessThan(dirty.cx + dirty.cols);
      expect(ty).toBeLessThan(dirty.cy + dirty.rows);
    }
  });
});

describe('paintLdtkIntGrid', () => {
  const sample = allOracleCases().find((c) => c.layer.intGridCsv !== undefined);

  it('reports no change when painting a value the cell already has', () => {
    expect(sample).toBeDefined();
    if (sample === undefined) return;
    const project = sample.project;
    const existing = sample.layer.intGridCsv?.[0] ?? 0;
    const result = paintLdtkIntGrid(project, sample.levelIid, sample.layer.iid, [
      { cx: 0, cy: 0, value: existing },
    ]);
    expect(result.changed).toBe(false);
    expect(result.project).toBe(project);
  });

  it('writes a new value and reports a widened dirty region', () => {
    expect(sample).toBeDefined();
    if (sample === undefined) return;
    const existing = sample.layer.intGridCsv?.[0] ?? 0;
    const result = paintLdtkIntGrid(sample.project, sample.levelIid, sample.layer.iid, [
      { cx: 0, cy: 0, value: existing === 1 ? 2 : 1 },
    ]);
    expect(result.changed).toBe(true);
    expect(result.dirty).toBeDefined();
    // A one-cell edit must invalidate more than one cell, or neighbouring
    // tiles whose patterns read that cell would keep stale art.
    expect((result.dirty?.cols ?? 0)).toBeGreaterThan(1);
    expect((result.dirty?.rows ?? 0)).toBeGreaterThan(1);
  });

  it('ignores cells outside the layer', () => {
    expect(sample).toBeDefined();
    if (sample === undefined) return;
    const result = paintLdtkIntGrid(sample.project, sample.levelIid, sample.layer.iid, [
      { cx: -5, cy: -5, value: 1 },
      { cx: 99999, cy: 99999, value: 1 },
    ]);
    expect(result.changed).toBe(false);
  });

  it('leaves the input project untouched', () => {
    expect(sample).toBeDefined();
    if (sample === undefined) return;
    const before = JSON.stringify(sample.project);
    paintLdtkIntGrid(sample.project, sample.levelIid, sample.layer.iid, [
      { cx: 1, cy: 1, value: 3 },
    ]);
    expect(JSON.stringify(sample.project)).toBe(before);
  });

  it('is a no-op for unknown level or layer ids', () => {
    expect(sample).toBeDefined();
    if (sample === undefined) return;
    expect(paintLdtkIntGrid(sample.project, 'nope', sample.layer.iid, [
      { cx: 0, cy: 0, value: 1 },
    ]).changed).toBe(false);
    expect(paintLdtkIntGrid(sample.project, sample.levelIid, 'nope', [
      { cx: 0, cy: 0, value: 1 },
    ]).changed).toBe(false);
  });
});

describe('entity operations', () => {
  const sample = allOracleCases().find(
    (c) => c.project.levels.some((l) => l.layerInstances?.some((li) => li.__type === 'Entities')),
  );

  function entityLayer(testCase: LdtkOracleCase): { levelIid: string; layerIid: string } | undefined {
    for (const level of testCase.project.levels) {
      const layer = level.layerInstances?.find((li) => li.__type === 'Entities');
      if (layer !== undefined) return { levelIid: level.iid, layerIid: layer.iid };
    }
    return undefined;
  }

  const made: LdtkEntityInstance = {
    __identifier: 'TestEntity',
    defUid: 1,
    iid: 'test-entity-iid',
    __tags: [],
    px: [32, 48],
    width: 16,
    height: 16,
    __grid: [2, 3],
    __pivot: [0, 0],
    __tile: null,
    fieldInstances: [{ __identifier: 'hp', __type: 'Int', __value: 3, defUid: 7 }],
  };

  it('adds, moves, edits and removes an entity', () => {
    expect(sample).toBeDefined();
    if (sample === undefined) return;
    const target = entityLayer(sample);
    expect(target).toBeDefined();
    if (target === undefined) return;

    const added = addLdtkEntity(sample.project, target.levelIid, target.layerIid, made);
    expect(added.changed).toBe(true);

    const moved = moveLdtkEntity(added.project, target.levelIid, target.layerIid, made.iid, 64, 80);
    expect(moved.changed).toBe(true);

    const edited = setLdtkEntityField(
      moved.project, target.levelIid, target.layerIid, made.iid, 'hp', 9,
    );
    expect(edited.changed).toBe(true);

    const removed = removeLdtkEntity(edited.project, target.levelIid, target.layerIid, made.iid);
    expect(removed.changed).toBe(true);

    // Removing the entity we added restores the original population.
    const originalCount = sample.project.levels
      .flatMap((l) => l.layerInstances ?? [])
      .reduce((n, li) => n + (li.entityInstances?.length ?? 0), 0);
    const finalCount = removed.project.levels
      .flatMap((l) => l.layerInstances ?? [])
      .reduce((n, li) => n + (li.entityInstances?.length ?? 0), 0);
    expect(finalCount).toBe(originalCount);
  });

  it('keeps __grid consistent with the moved pixel position', () => {
    expect(sample).toBeDefined();
    if (sample === undefined) return;
    const target = entityLayer(sample);
    if (target === undefined) return;

    const added = addLdtkEntity(sample.project, target.levelIid, target.layerIid, made);
    const moved = moveLdtkEntity(added.project, target.levelIid, target.layerIid, made.iid, 64, 80);
    const layer = moved.project.levels
      .flatMap((l) => l.layerInstances ?? [])
      .find((li) => li.iid === target.layerIid);
    const entity = layer?.entityInstances?.find((e) => e.iid === made.iid);
    const gridSize = layer?.__gridSize ?? 1;
    expect(entity?.__grid).toEqual([Math.floor(64 / gridSize), Math.floor(80 / gridSize)]);
  });

  it('is a no-op removing an entity that does not exist', () => {
    expect(sample).toBeDefined();
    if (sample === undefined) return;
    const target = entityLayer(sample);
    if (target === undefined) return;
    expect(
      removeLdtkEntity(sample.project, target.levelIid, target.layerIid, 'ghost').changed,
    ).toBe(false);
  });
});

describe('setLdtkOptionalRuleGroup', () => {
  const sample = allOracleCases().find(
    (c) => (c.layer.optionalRules ?? []).length > 0,
  );

  it('toggles a group and dirties the whole layer', () => {
    expect(sample).toBeDefined();
    if (sample === undefined) return;
    const uid = (sample.layer.optionalRules ?? [])[0];

    const off = setLdtkOptionalRuleGroup(
      sample.project, sample.levelIid, sample.layer.iid, uid, false,
    );
    expect(off.changed).toBe(true);
    expect(off.dirty).toEqual({
      cx: 0, cy: 0, cols: sample.layer.__cWid, rows: sample.layer.__cHei,
    });

    // Toggling to the state it already has changes nothing.
    expect(
      setLdtkOptionalRuleGroup(off.project, sample.levelIid, sample.layer.iid, uid, false).changed,
    ).toBe(false);
  });

  it('changes the resolved tiles', () => {
    expect(sample).toBeDefined();
    if (sample === undefined) return;
    const uid = (sample.layer.optionalRules ?? [])[0];
    const before = resolve(sample, sample.intGrid);

    const source = ldtkRuleSourceFromCsv(
      sample.intGrid, sample.cols, sample.rows, sample.layerDef,
    );
    const after = runLdtkAutoLayer(source, sample.layerDef, {
      seed: sample.layer.seed ?? 0,
      enabledOptionalGroups: (sample.layer.optionalRules ?? []).filter((u) => u !== uid),
      gridSize: sample.layer.__gridSize,
      tileset: sample.tileset,
    });
    expect(after.length).toBeLessThan(before.length);
  });
});

describe('resizeLdtkLevel', () => {
  const sample = allOracleCases().find((c) => c.layer.intGridCsv !== undefined);

  it('re-lays out the IntGrid rather than reinterpreting the array', () => {
    expect(sample).toBeDefined();
    if (sample === undefined) return;
    const level = sample.project.levels.find((l) => l.iid === sample.levelIid);
    expect(level).toBeDefined();
    if (level === undefined) return;

    const gridSize = sample.layer.__gridSize;
    const narrower = level.pxWid - gridSize * 2;
    const result = resizeLdtkLevel(sample.project, sample.levelIid, narrower, level.pxHei);
    expect(result.changed).toBe(true);

    const resized = result.project.levels.find((l) => l.iid === sample.levelIid);
    const layer = resized?.layerInstances?.find((li) => li.iid === sample.layer.iid);
    expect(layer?.__cWid).toBe(sample.cols - 2);

    // Row 1 must still start with the same values it had — proof the grid was
    // re-laid out rather than the flat array simply truncated.
    const original = sample.layer.intGridCsv ?? [];
    expect(layer?.intGridCsv?.[layer.__cWid]).toBe(original[sample.cols]);
  });

  it('rejects non-positive dimensions', () => {
    expect(sample).toBeDefined();
    if (sample === undefined) return;
    expect(resizeLdtkLevel(sample.project, sample.levelIid, 0, 100).changed).toBe(false);
    expect(resizeLdtkLevel(sample.project, sample.levelIid, 100, -1).changed).toBe(false);
  });
});
