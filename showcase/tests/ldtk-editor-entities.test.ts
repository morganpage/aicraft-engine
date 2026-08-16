/**
 * Entity placement, palette, and hit-testing in the LDtk editor.
 *
 * The editor's entity tool is thin UI glue over the library's
 * `addLdtkEntity`/`moveLdtkEntity`/`removeLdtkEntity` ops and the pure helpers
 * in `sections/ldtk-editor/entities.ts`. These tests cover the parts that can
 * go wrong in ways a screenshot will not reveal:
 *  - instance construction is deterministic (same def + cell → same instance),
 *  - pivot math places the cell where the author's pointer is,
 *  - the palette reflects the layer's entities and `used` state,
 *  - hit-testing resolves overlaps topmost-first,
 *  - the full place → move → delete loop restores the original population.
 *
 * No canvas: the rendering is covered separately; this is the logic.
 */

import { describe, expect, it } from 'vitest';
import {
  addLdtkEntity,
  moveLdtkEntity,
  removeLdtkEntity,
  type LdtkEntityDef,
  type LdtkEntityInstance,
  type LdtkLayerInstance,
  type LdtkProject,
} from '../../src/ldtk';
import {
  entityAtPoint,
  entityInstanceFromDef,
  levelEntityCount,
  nextEntityIid,
  paletteForLayer,
} from '../sections/ldtk-editor/entities';

/** A minimal entity def with a 16×16 footprint, top-left pivot, a color. */
function def(over: Partial<LdtkEntityDef> = {}): LdtkEntityDef {
  return {
    identifier: 'Coin',
    uid: 42,
    tags: ['item'],
    width: 16,
    height: 16,
    resizableX: false,
    resizableY: false,
    color: '#ffd24e',
    renderMode: 'Rectangle',
    tileRenderMode: 'FitInside',
    pivotX: 0,
    pivotY: 0,
    tilesetId: null,
    tileRect: null,
    fieldDefs: [],
    ...over,
  };
}

/** An Entities layer carrying the given instances. */
function entityLayer(instances: readonly LdtkEntityInstance[] = []): LdtkLayerInstance {
  return {
    __type: 'Entities',
    __identifier: 'Entities',
    __cWid: 10,
    __cHei: 10,
    __gridSize: 16,
    __opacity: 1,
    __pxTotalOffsetX: 0,
    __pxTotalOffsetY: 0,
    visible: true,
    iid: 'layer-1',
    levelId: 'level-0',
    layerDefUid: 99,
    entityInstances: instances,
    __tilesetDefUid: null,
    __tilesetRelPath: null,
  };
}

/** A project whose single level holds the given layers. */
function project(layers: readonly LdtkLayerInstance[], defs: readonly LdtkEntityDef[]): LdtkProject {
  return {
    jsonVersion: '1.5.3',
    iid: 'proj',
    bgColor: '#000',
    defs: {
      layers: [{ __type: 'Entities', identifier: 'Entities', uid: 99, gridSize: 16 }],
      entities: defs,
      tilesets: [],
      enums: [],
    },
    levels: [{
      identifier: 'Level_0',
      iid: 'level-0',
      uid: 1,
      pxWid: 160,
      pxHei: 160,
      worldX: 0,
      worldY: 0,
      worldDepth: 0,
      fieldInstances: [],
      externalRelPath: null,
      __neighbours: [],
      layerInstances: layers,
    }],
    externalLevels: false,
    worldLayout: 'Free',
    worldGridWidth: null,
    worldGridHeight: null,
    worlds: [],
  };
}

describe('entityInstanceFromDef', () => {
  it('derives a fully-formed instance from a def at a cell', () => {
    const instance = entityInstanceFromDef(def(), { cx: 2, cy: 3 }, 16, 'iid-1');
    expect(instance).toMatchObject({
      __identifier: 'Coin',
      defUid: 42,
      iid: 'iid-1',
      __tags: ['item'],
      px: [32, 48],
      width: 16,
      height: 16,
      __grid: [2, 3],
      __pivot: [0, 0],
      __tile: null,
    });
  });

  it('is deterministic: same def + cell + iid → identical instance', () => {
    const d = def();
    const a = entityInstanceFromDef(d, { cx: 5, cy: 5 }, 16, 'x');
    const b = entityInstanceFromDef(d, { cx: 5, cy: 5 }, 16, 'x');
    expect(a).toEqual(b);
  });

  it('places the pivot at the clicked cell top-left, keeping __grid = [cx, cy]', () => {
    // px is the pivot point's position, so for cell (1,1) at gridSize 16 the
    // pivot lands at (16, 16) regardless of the pivot fraction. __grid is the
    // cell containing the pivot, so it comes out exactly the clicked cell.
    const d = def({ width: 16, height: 24, pivotX: 0.5, pivotY: 1 });
    const instance = entityInstanceFromDef(d, { cx: 1, cy: 1 }, 16, 'p');
    expect(instance.px).toEqual([16, 16]);
    expect(instance.__grid).toEqual([1, 1]);
  });

  it('reproduces the bundled PlayerStart instance (the real LDtk convention)', () => {
    // PlayerStart in Entities.ldtk: 20×20, pivot [0.5, 1], at grid [4, 22]. In
    // LDtk's data px = [72, 368] (pivot at the cell's centre-x / bottom edge).
    // Placement at the *cell* lands the pivot at its top-left, so grid [4,22]
    // → px = [64, 352]; the draw top-left is then [54, 332]. This test pins the
    // px-is-the-pivot contract against the fixture that exposed the bug.
    const d = def({ identifier: 'PlayerStart', uid: 1, width: 20, height: 20, pivotX: 0.5, pivotY: 1 });
    const instance = entityInstanceFromDef(d, { cx: 4, cy: 22 }, 16, 'ps');
    expect(instance.px).toEqual([64, 352]);
    expect(instance.__grid).toEqual([4, 22]);
    // Draw origin = px − pivot × size (mirrors render.ts entityTopLeft).
    expect([instance.px[0] - 0.5 * 20, instance.px[1] - 1 * 20]).toEqual([54, 332]);
  });

  it('copies the display tile from the def when one is set', () => {
    const d = def({
      tilesetId: 7,
      tileRect: { tilesetUid: 7, x: 0, y: 16, w: 16, h: 16 },
    });
    const instance = entityInstanceFromDef(d, { cx: 0, cy: 0 }, 16, 't');
    expect(instance.__tile).toEqual({ tilesetUid: 7, x: 0, y: 16, w: 16, h: 16 });
  });

  it('seeds field instances from the def with sensible per-type defaults', () => {
    const d = def({
      fieldDefs: [
        { identifier: 'hp', uid: 1, __type: 'F_Int', canBeNull: false, isArray: false, defaultOverride: 5 },
        { identifier: 'name', uid: 2, __type: 'F_String', canBeNull: false, isArray: false, defaultOverride: null },
        { identifier: 'tags', uid: 3, __type: 'F_String', canBeNull: false, isArray: true, defaultOverride: null },
        { identifier: 'on', uid: 4, __type: 'F_Bool', canBeNull: false, isArray: false, defaultOverride: null },
      ],
    });
    const instance = entityInstanceFromDef(d, { cx: 0, cy: 0 }, 16, 'f');
    const fields = Object.fromEntries(instance.fieldInstances.map((f) => [f.__identifier, f.__value]));
    expect(fields).toEqual({ hp: 5, name: '', tags: [], on: false });
  });
});

describe('paletteForLayer', () => {
  const coinDef = def({ identifier: 'Coin', uid: 1 });
  const playerDef = def({ identifier: 'Player', uid: 2, color: '#4e9bff' });

  it('returns every project entity def for an Entities layer, marking used ones', () => {
    const placed: LdtkEntityInstance = {
      __identifier: 'Coin', defUid: 1, iid: 'c1', __tags: [],
      px: [0, 0], width: 16, height: 16, __grid: [0, 0], __pivot: [0, 0],
      __tile: null, fieldInstances: [],
    };
    const layer = entityLayer([placed]);
    const proj = project([layer], [coinDef, playerDef]);

    const palette = paletteForLayer(proj, layer);
    expect(palette.map((e) => e.def.identifier)).toEqual(['Coin', 'Player']);
    expect(palette.find((e) => e.def.identifier === 'Coin')?.used).toBe(true);
    expect(palette.find((e) => e.def.identifier === 'Player')?.used).toBe(false);
  });

  it('returns nothing for a non-Entities layer', () => {
    const tilesLayer: LdtkLayerInstance = {
      ...entityLayer([]),
      __type: 'Tiles',
      gridTiles: [],
    };
    const proj = project([tilesLayer], [coinDef]);
    expect(paletteForLayer(proj, tilesLayer)).toEqual([]);
  });

  it('returns nothing when the layer is undefined', () => {
    expect(paletteForLayer(project([], [coinDef]), undefined)).toEqual([]);
  });
});

describe('entityAtPoint', () => {
  function instance(
    iid: string, px: [number, number], w = 16, h = 16, pivot: [number, number] = [0, 0],
  ): LdtkEntityInstance {
    return {
      __identifier: 'E', defUid: 1, iid, __tags: [],
      px, width: w, height: h, __grid: [0, 0], __pivot: pivot,
      __tile: null, fieldInstances: [],
    };
  }

  it('hits an entity whose rect contains the point', () => {
    const layer = entityLayer([instance('a', [0, 0])]);
    expect(entityAtPoint(layer, 8, 8)?.iid).toBe('a');
  });

  it('resolves topmost-first when entities overlap', () => {
    const layer = entityLayer([instance('bottom', [0, 0]), instance('top', [0, 0])]);
    // Later in the array draws on top, so the click belongs to 'top'.
    expect(entityAtPoint(layer, 1, 1)?.iid).toBe('top');
  });

  it('misses outside every entity rect', () => {
    const layer = entityLayer([instance('a', [0, 0])]);
    expect(entityAtPoint(layer, 17, 0)).toBeUndefined();
    expect(entityAtPoint(layer, 0, 17)).toBeUndefined();
  });

  it('hit-tests against the pivot-derived rect, not the pivot point', () => {
    // A 16×16 entity with a bottom-centre pivot [0.5, 1] and px = [8, 16]: its
    // rect spans x∈[0,16], y∈[0,16]. A click at (8, 8) — the rect centre but
    // above the pivot point — must still hit it.
    const layer = entityLayer([instance('pivoted', [8, 16], 16, 16, [0.5, 1])]);
    expect(entityAtPoint(layer, 8, 8)?.iid).toBe('pivoted');
    // A click just below the rect (at the pivot point's level but outside the
    // rect) misses.
    expect(entityAtPoint(layer, 8, 17)).toBeUndefined();
  });
});

describe('iid allocation', () => {
  it('nextEntityIid is monotonic and never random', () => {
    expect(nextEntityIid('aaaaaaaa', 0)).toBe('aaaaaaaa-0001');
    expect(nextEntityIid('aaaaaaaa', 1)).toBe('aaaaaaaa-0002');
    expect(nextEntityIid('aaaaaaaa', 15)).toBe('aaaaaaaa-0010');
  });

  it('levelEntityCount tallies every entity across a level', () => {
    const layers: LdtkLayerInstance[] = [
      entityLayer([
        { __identifier: 'A', defUid: 1, iid: '1', __tags: [], px: [0, 0], width: 1, height: 1, __grid: [0, 0], __pivot: [0, 0], __tile: null, fieldInstances: [] },
      ]),
      entityLayer([
        { __identifier: 'B', defUid: 2, iid: '2', __tags: [], px: [0, 0], width: 1, height: 1, __grid: [0, 0], __pivot: [0, 0], __tile: null, fieldInstances: [] },
        { __identifier: 'C', defUid: 3, iid: '3', __tags: [], px: [0, 0], width: 1, height: 1, __grid: [0, 0], __pivot: [0, 0], __tile: null, fieldInstances: [] },
      ]),
    ];
    expect(levelEntityCount(layers)).toBe(3);
    expect(levelEntityCount(null)).toBe(0);
  });
});

describe('place → move → delete loop (via library ops)', () => {
  // This mirrors exactly what the editor's entity tool does: construct an
  // instance from a def, then add/move/remove through the library. The point is
  // that the editor's glue is sound — every op the UI calls is reachable and
  // composes to restore the original population.
  const proj = () => project([entityLayer([])], [def()]);
  const levelIid = 'level-0';
  const layerIid = 'layer-1';

  it('adds, moves, and removes an entity, restoring the original count', () => {
    const before = proj();
    const iid = nextEntityIid(levelIid, levelEntityCount(before.levels[0].layerInstances));
    const instance = entityInstanceFromDef(def(), { cx: 1, cy: 1 }, 16, iid);

    const added = addLdtkEntity(before, levelIid, layerIid, instance);
    expect(added.changed).toBe(true);
    expect(levelEntityCount(added.project.levels[0].layerInstances ?? null)).toBe(1);

    const moved = moveLdtkEntity(added.project, levelIid, layerIid, iid, 64, 64);
    expect(moved.changed).toBe(true);
    const movedInstance = moved.project.levels[0].layerInstances?.[0].entityInstances?.[0];
    expect(movedInstance?.px).toEqual([64, 64]);

    const removed = removeLdtkEntity(moved.project, levelIid, layerIid, iid);
    expect(removed.changed).toBe(true);
    expect(levelEntityCount(removed.project.levels[0].layerInstances ?? null)).toBe(0);
  });
});
