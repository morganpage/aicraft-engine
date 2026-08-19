import { describe, expect, it } from 'vitest';
import {
  LDTK_DEFAULT_ENTITY_MAP,
  ldtkLevelToLevelData,
  translateLdtkEntity,
  type LdtkEntityMap,
} from '../ldtk/translate';
import { validateLevel } from '../level';
import type { LevelEntity } from '../level/types';
import type {
  LdtkEntityInstance,
  LdtkLevel,
  LdtkProject,
  LdtkTileRenderMode,
} from '../ldtk/types';

/** Build a minimal LDtk level fixture with the given IntGrid + entities. */
function makeLevel(opts: {
  readonly identifier?: string;
  readonly gridSize?: number;
  readonly pxWid?: number;
  readonly pxHei?: number;
  readonly intGridCsv?: number[];
  readonly cWid?: number;
  readonly cHei?: number;
  readonly entities?: readonly LdtkEntityInstance[];
}): LdtkLevel {
  const gridSize = opts.gridSize ?? 16;
  const cWid = opts.cWid ?? 3;
  const cHei = opts.cHei ?? 2;
  return {
    identifier: opts.identifier ?? 'Level_0',
    iid: 'lvl-0',
    uid: 1,
    pxWid: opts.pxWid ?? cWid * gridSize,
    pxHei: opts.pxHei ?? cHei * gridSize,
    worldX: 0,
    worldY: 0,
    worldDepth: 0,
    fieldInstances: [],
    externalRelPath: null,
    __neighbours: [],
    layerInstances: [
      {
        __type: 'IntGrid',
        __identifier: 'Collisions',
        __cWid: cWid,
        __cHei: cHei,
        __gridSize: gridSize,
        __opacity: 1,
        __pxTotalOffsetX: 0,
        __pxTotalOffsetY: 0,
        visible: true,
        iid: 'l1',
        levelId: 'lvl-0',
        layerDefUid: 10,
        intGridCsv: opts.intGridCsv ?? [1, 1, 1, 0, 0, 0],
        __tilesetDefUid: null,
        __tilesetRelPath: null,
      },
      ...(opts.entities && opts.entities.length > 0 ? [{
        __type: 'Entities' as const,
        __identifier: 'Entities',
        __cWid: cWid,
        __cHei: cHei,
        __gridSize: gridSize,
        __opacity: 1,
        __pxTotalOffsetX: 0,
        __pxTotalOffsetY: 0,
        visible: true,
        iid: 'l2',
        levelId: 'lvl-0',
        layerDefUid: 11,
        entityInstances: opts.entities,
        __tilesetDefUid: null,
        __tilesetRelPath: null,
      }] : []),
    ],
  };
}

const ENT = (over: Partial<LdtkEntityInstance> & Pick<LdtkEntityInstance, '__identifier' | 'px' | 'width' | 'height'>): LdtkEntityInstance => ({
  defUid: 1,
  iid: 'e',
  __tags: [],
  __grid: [0, 0],
  __pivot: [0, 0],
  __tile: null,
  fieldInstances: [],
  ...over,
});

describe('ldtkLevelToLevelData — IntGrid', () => {
  it('copies the IntGrid csv 1:1 into TileGrid.data', () => {
    const level = makeLevel({ intGridCsv: [1, 0, 1, 0, 2, 0] });
    const { level: out, tileSemantics } = ldtkLevelToLevelData(level);
    expect(out).toBeDefined();
    expect(out!.tiles.data).toEqual([1, 0, 1, 0, 2, 0]);
    expect(out!.tiles.cols).toBe(3);
    expect(out!.tiles.rows).toBe(2);
    expect(out!.tiles.tileSize).toBe(16);
    // 1 is solid, 2 is passthrough by default.
    expect(tileSemantics.solid).toContain(1);
    expect(tileSemantics.passthrough).toEqual([2]);
  });

  it('derives width/height/tileSize from the level pixel + grid dims', () => {
    const level = makeLevel({ pxWid: 96, pxHei: 64, gridSize: 16, cWid: 6, cHei: 4, intGridCsv: new Array(24).fill(0) });
    const { level: out } = ldtkLevelToLevelData(level);
    expect(out).toMatchObject({ width: 96, height: 64, tileSize: 16 });
    expect(out!.tiles.cols).toBe(6);
    expect(out!.tiles.rows).toBe(4);
  });

  it('emits an error diagnostic when there is no IntGrid layer', () => {
    const level: LdtkLevel = {
      identifier: 'Empty',
      iid: 'x',
      uid: 1,
      pxWid: 48,
      pxHei: 32,
      worldX: 0,
      worldY: 0,
      worldDepth: 0,
      fieldInstances: [],
      externalRelPath: null,
      __neighbours: [],
      layerInstances: [
        {
          __type: 'Tiles', __identifier: 'Art', __cWid: 3, __cHei: 2, __gridSize: 16,
          __opacity: 1, __pxTotalOffsetX: 0, __pxTotalOffsetY: 0, visible: true,
          iid: 'l', levelId: 'x', layerDefUid: 9, gridTiles: [],
          __tilesetDefUid: null, __tilesetRelPath: null,
        },
      ],
    };
    const { level: out, diagnostics } = ldtkLevelToLevelData(level);
    expect(out).toBeUndefined();
    expect(diagnostics.some((d) => d.severity === 'error' && /no IntGrid collision layer/.test(d.message))).toBe(true);
  });
});

describe('ldtkLevelToLevelData — name-driven tile semantics', () => {
  // The makeLevel helper uses layerDefUid: 10 for its IntGrid layer. Build a
  // project whose defs.layers includes a matching def declaring named values.
  function makeProject(values: { value: number; identifier: string | null }[]): LdtkProject {
    return {
      defs: { layers: [{ uid: 10, intGridValues: values }] },
    } as unknown as LdtkProject;
  }

  it('derives passthrough by name (case-insensitive, any integer) when project is supplied', () => {
    // Value 1 = 'dirt' (solid), value 4 = 'one_way_passthrough' (one-way).
    // Note value 4 is NOT the legacy default 2 — name resolution must find it.
    const level = makeLevel({ intGridCsv: [1, 4, 1, 0, 1, 4] });
    const project = makeProject([
      { value: 1, identifier: 'dirt' },
      { value: 4, identifier: 'one_way_passthrough' },
    ]);
    const { tileSemantics } = ldtkLevelToLevelData(level, project);
    expect(tileSemantics.solid).toContain(1);
    expect(tileSemantics.passthrough).toContain(4);
    expect(tileSemantics.solid).not.toContain(4);
  });

  it('is case-insensitive on the passthrough name', () => {
    const level = makeLevel({ intGridCsv: [3, 0, 3] });
    const project = makeProject([{ value: 3, identifier: 'PASSTHROUGH' }]);
    const { tileSemantics } = ldtkLevelToLevelData(level, project);
    expect(tileSemantics.passthrough).toEqual([3]);
    expect(tileSemantics.solid).toEqual([]);
  });

  it('defaults every non-zero value to solid when none is named passthrough', () => {
    const level = makeLevel({ intGridCsv: [1, 2, 3] });
    const project = makeProject([
      { value: 1, identifier: 'dirt' },
      { value: 2, identifier: 'stone' },
      { value: 3, identifier: 'brick' },
    ]);
    const { tileSemantics } = ldtkLevelToLevelData(level, project);
    // No 'passthrough' name → all three are solid, including value 2 which the
    // legacy integer fallback would have classed as passthrough.
    expect(tileSemantics.solid).toEqual([1, 2, 3]);
    expect(tileSemantics.passthrough).toEqual([]);
  });

  it('excludes a ladder-named value from solid and records it in tileSemantics.ladder', () => {
    // Mirrors the 1-bit platformer sample: Dirt(2)/Brick(3)/Stone(4)/Ladder(5).
    // The historical bug: Ladder(5) was solid, got merged into a wall rect, and
    // the rect's ladder overlap re-tagged the whole wall non-colliding.
    const level = makeLevel({ intGridCsv: [2, 3, 4, 5, 5, 0] });
    const project = makeProject([
      { value: 2, identifier: 'Dirt' },
      { value: 3, identifier: 'Brick' },
      { value: 4, identifier: 'Stone' },
      { value: 5, identifier: 'Ladder' },
    ]);
    const { tileSemantics } = ldtkLevelToLevelData(level, project);
    expect(tileSemantics.solid).toEqual([2, 3, 4]);
    expect(tileSemantics.passthrough).toEqual([]);
    expect(tileSemantics.ladder).toEqual([5]);
  });

  it('is case-insensitive on the ladder name (exact match, not substring)', () => {
    // 'LADDER' (all caps) matches; a name that merely contains 'ladder' as a
    // substring (e.g. 'laddervine') does NOT — ladders use an exact identifier
    // match, mirroring ladderValueFromProject in the showcase.
    const level = makeLevel({ intGridCsv: [6, 7, 8] });
    const project = makeProject([
      { value: 6, identifier: 'LADDER' },
      { value: 7, identifier: 'ladder' },
      { value: 8, identifier: 'laddervine' },
    ]);
    const { tileSemantics } = ldtkLevelToLevelData(level, project);
    expect(tileSemantics.ladder).toEqual([6, 7]);
    // 'laddervine' is neither passthrough nor ladder → it stays solid.
    expect(tileSemantics.solid).toEqual([8]);
  });

  it('omits tileSemantics.ladder when no value is named ladder', () => {
    // No ladder → the ladder field is absent (not an empty array), so existing
    // callers that don't set it see an unchanged object shape.
    const level = makeLevel({ intGridCsv: [1, 2, 3] });
    const project = makeProject([
      { value: 1, identifier: 'dirt' },
      { value: 2, identifier: 'stone' },
    ]);
    const { tileSemantics } = ldtkLevelToLevelData(level, project);
    expect(tileSemantics.ladder).toBeUndefined();
    expect(tileSemantics.solid).toEqual([1, 2, 3]);
  });

  it('falls back to integer options when no project is supplied', () => {
    // Same grid as the name test, but no project → value 4 is solid (not
    // passthrough), proving the legacy path is intact.
    const level = makeLevel({ intGridCsv: [1, 4, 1, 0, 1, 4] });
    const { tileSemantics } = ldtkLevelToLevelData(level);
    expect(tileSemantics.solid).toContain(4);
    expect(tileSemantics.passthrough).not.toContain(4);
  });
});

describe('ldtkLevelToLevelData — entity mapping', () => {
  it('maps known LDtk identifiers to engine entity kinds', () => {
    const level = makeLevel({
      entities: [
        ENT({ __identifier: 'Player', px: [16, 16], width: 16, height: 24 }),
        ENT({ __identifier: 'Coin', px: [32, 16], width: 8, height: 8, fieldInstances: [{ __identifier: 'value', __type: 'Int', __value: 10 }] }),
        ENT({ __identifier: 'Exit', px: [48, 16], width: 16, height: 16 }),
        ENT({ __identifier: 'Spike', px: [0, 16], width: 16, height: 8 }),
      ],
    });
    const { level: out } = ldtkLevelToLevelData(level);
    const kinds = out!.entities.map((e) => e.kind);
    expect(kinds).toEqual(['spawn', 'collectible', 'exit', 'hazard']);
    const coin = out!.entities.find((e) => e.kind === 'collectible');
    expect(coin?.props).toMatchObject({ kind: 'coin', value: 10 });
    const exit = out!.entities.find((e) => e.kind === 'exit');
    expect(exit?.props).toMatchObject({ isTrap: false, locked: false });
  });

  it('uses the trigger escape hatch for unknown identifiers, preserving fields', () => {
    const level = makeLevel({
      entities: [
        ENT({
          __identifier: 'CustomBoss', px: [0, 0], width: 32, height: 32,
          fieldInstances: [{ __identifier: 'health', __type: 'Int', __value: 100 }],
        }),
      ],
    });
    const { level: out } = ldtkLevelToLevelData(level);
    const boss = out!.entities[0];
    expect(boss.kind).toBe('trigger');
    if (boss.kind === 'trigger') {
      expect(boss.props.action).toBe('CustomBoss');
      expect(boss.props.params).toMatchObject({ identifier: 'CustomBoss', fieldInstances: { health: 100 } });
    }
  });

  it('derives the LevelData.spawn from the Player entity', () => {
    const level = makeLevel({
      entities: [ENT({ __identifier: 'Player', px: [24, 32], width: 16, height: 24 })],
    });
    const { level: out } = ldtkLevelToLevelData(level);
    // Spawn = rect.x + width/2, rect.y + height (feet).
    expect(out!.spawn).toEqual({ x: 32, y: 56 });
  });

  it('uses a default spawn + warns when no Player entity exists', () => {
    const level = makeLevel({ entities: [] });
    const { level: out, diagnostics } = ldtkLevelToLevelData(level);
    expect(out!.spawn.x).toBe(16); // tileSize
    expect(diagnostics.some((d) => /no spawn entity/.test(d.message))).toBe(true);
  });

  it('allocates monotonic entity ids starting at 1', () => {
    const level = makeLevel({
      entities: [
        ENT({ __identifier: 'Player', px: [0, 0], width: 1, height: 1 }),
        ENT({ __identifier: 'Coin', px: [1, 1], width: 1, height: 1 }),
        ENT({ __identifier: 'Coin', px: [2, 2], width: 1, height: 1 }),
      ],
    });
    const { level: out } = ldtkLevelToLevelData(level);
    expect(out!.entities.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(out!.nextEntityId).toBe(4);
  });
});

describe('ldtkLevelToLevelData — validateLevel interop', () => {
  it('produces a level that passes validateLevel once spawn + exit exist', () => {
    const level = makeLevel({
      intGridCsv: [1, 1, 1, 1, 1, 1],
      entities: [
        ENT({ __identifier: 'Player', px: [8, 8], width: 8, height: 8 }),
        ENT({ __identifier: 'Exit', px: [32, 8], width: 8, height: 8 }),
      ],
    });
    const { level: out } = ldtkLevelToLevelData(level);
    const result = validateLevel(out!);
    expect(result.valid).toBe(true);
  });

  it('respects a custom entity map', () => {
    const level = makeLevel({
      entities: [ENT({ __identifier: 'WarpPad', px: [0, 0], width: 8, height: 8 })],
    });
    const { level: out } = ldtkLevelToLevelData(level, undefined, {
      entityMap: { resolve: (id) => (id === 'WarpPad' ? 'exit' : null) },
    });
    expect(out!.entities[0].kind).toBe('exit');
  });
});

describe('translateLdtkEntity — unit cases', () => {
  const noop = () => undefined;
  it('maps Gem/Diamond/Jewel to the gem collectible kind', () => {
    for (const id of ['Gem', 'Diamond', 'Jewel']) {
      const e = translateLdtkEntity(ENT({ __identifier: id, px: [0, 0], width: 1, height: 1 }), 1, LDTK_DEFAULT_ENTITY_MAP, noop);
      expect(e?.kind).toBe('collectible');
      if (e?.kind === 'collectible') expect(e.props.kind).toBe('gem');
    }
  });

  it('reads exit trap/locked flags', () => {
    const e = translateLdtkEntity(
      ENT({
        __identifier: 'Exit', px: [0, 0], width: 1, height: 1,
        fieldInstances: [
          { __identifier: 'isTrap', __type: 'Bool', __value: true },
          { __identifier: 'locked', __type: 'Bool', __value: true },
        ],
      }),
      1, LDTK_DEFAULT_ENTITY_MAP, noop,
    );
    expect(e?.kind).toBe('exit');
    if (e?.kind === 'exit') expect(e.props).toMatchObject({ isTrap: true, locked: true });
  });
});

describe('ldtkLevelToLevelData — entity art side channel', () => {
  // A project carrying entity DEFS: the art side channel needs each def's
  // tileRenderMode + nineSliceBorders, matched to instances by defUid.
  function makeEntityProject(
    defs: readonly { uid: number; tileRenderMode?: LdtkTileRenderMode; nineSliceBorders?: readonly [number, number, number, number] | null }[],
  ): LdtkProject {
    return {
      defs: {
        layers: [], // present (the tile-semantics path reads it) but empty
        entities: defs.map((d) => ({ tileRenderMode: 'FitInside', nineSliceBorders: null, ...d })),
      },
    } as unknown as LdtkProject;
  }
  const TILE = (x: number, y: number) => ({ tilesetUid: 90, x, y, w: 16, h: 16 });

  it('keys the art by the ENGINE entity id, carrying tile + def mode + borders', () => {
    const level = makeLevel({
      entities: [
        ENT({ __identifier: 'Spike', px: [0, 16], width: 16, height: 8, defUid: 10, __tile: TILE(0, 0) }),
        ENT({ __identifier: 'Coin', px: [32, 16], width: 8, height: 8, defUid: 11, __tile: TILE(16, 0) }),
      ],
    });
    const project = makeEntityProject([
      { uid: 10, tileRenderMode: 'Repeat' },
      { uid: 11, tileRenderMode: 'NineSlice', nineSliceBorders: [2, 2, 2, 2] },
    ]);
    const { level: out, entityArt } = ldtkLevelToLevelData(level, project);
    expect(entityArt.size).toBe(2);
    const [spike, coin] = out!.entities;
    expect(entityArt.get(spike.id)).toEqual({
      tile: TILE(0, 0),
      tileRenderMode: 'Repeat',
      nineSliceBorders: null,
    });
    expect(entityArt.get(coin.id)).toEqual({
      tile: TILE(16, 0),
      tileRenderMode: 'NineSlice',
      nineSliceBorders: [2, 2, 2, 2],
    });
  });

  it('the tile is copied, not aliased — the map shares no structure with the input level', () => {
    const instance = ENT({ __identifier: 'Spike', px: [0, 16], width: 16, height: 8, defUid: 10, __tile: TILE(0, 0) });
    const level = makeLevel({ entities: [instance] });
    const project = makeEntityProject([{ uid: 10, tileRenderMode: 'Repeat' }]);
    const { level: out, entityArt } = ldtkLevelToLevelData(level, project);
    const art = entityArt.get(out!.entities[0].id);
    expect(art).toBeDefined();
    expect(art!.tile).toEqual(instance.__tile);
    expect(art!.tile).not.toBe(instance.__tile);
  });

  it('two entities at the SAME rect resolve their own art — the rect-key collision failure mode cannot exist', () => {
    // A consumer indexing art by room-local rect (the pre-side-channel recipe)
    // could not tell these apart; keyed by engine id, both are exact.
    const level = makeLevel({
      entities: [
        ENT({ __identifier: 'Spike', px: [0, 16], width: 16, height: 8, defUid: 10, __tile: TILE(0, 0) }),
        ENT({ __identifier: 'Spike', px: [0, 16], width: 16, height: 8, defUid: 11, __tile: TILE(32, 0) }),
      ],
    });
    const project = makeEntityProject([
      { uid: 10, tileRenderMode: 'Repeat' },
      { uid: 11, tileRenderMode: 'Repeat' },
    ]);
    const { level: out, entityArt } = ldtkLevelToLevelData(level, project);
    const [first, second] = out!.entities;
    expect(first.rect).toEqual(second.rect);
    expect(entityArt.get(first.id)!.tile).toEqual(TILE(0, 0));
    expect(entityArt.get(second.id)!.tile).toEqual(TILE(32, 0));
  });

  it('an instance with no authored __tile gets NO entry — the engine shape is the authored intent', () => {
    const level = makeLevel({
      entities: [
        ENT({ __identifier: 'Player', px: [16, 16], width: 16, height: 24, __tile: null }),
        ENT({ __identifier: 'Spike', px: [0, 16], width: 16, height: 8, __tile: TILE(0, 0) }),
      ],
    });
    const { level: out, entityArt } = ldtkLevelToLevelData(level, makeEntityProject([{ uid: 1, tileRenderMode: 'Stretch' }]));
    const player = out!.entities.find((e) => e.kind === 'spawn')!;
    expect(entityArt.has(player.id)).toBe(false);
    expect(entityArt.size).toBe(1);
  });

  it('without a project (or a missing def) the art still carries the tile; mode is undefined and borders null', () => {
    // drawLdtkEntityTile treats an omitted mode as its geometry heuristic, so
    // passing `art.tileRenderMode` straight through is the correct fallback.
    const level = makeLevel({
      entities: [
        ENT({ __identifier: 'Spike', px: [0, 16], width: 16, height: 8, defUid: 10, __tile: TILE(0, 0) }),
        ENT({ __identifier: 'Coin', px: [32, 16], width: 8, height: 8, defUid: 999, __tile: TILE(16, 0) }),
      ],
    });
    const withProject = ldtkLevelToLevelData(level, makeEntityProject([{ uid: 10, tileRenderMode: 'Cover' }]));
    const [spike, coin] = withProject.level!.entities;
    expect(withProject.entityArt.get(spike.id)).toEqual({
      tile: TILE(0, 0),
      tileRenderMode: 'Cover',
      nineSliceBorders: null,
    });
    // defUid 999 has no def in the project.
    expect(withProject.entityArt.get(coin.id)).toEqual({
      tile: TILE(16, 0),
      tileRenderMode: undefined,
      nineSliceBorders: null,
    });
    // No project at all: same degraded-but-present shape for every entry.
    const bare = ldtkLevelToLevelData(level);
    expect(bare.entityArt.get(bare.level!.entities[0].id)).toEqual({
      tile: TILE(0, 0),
      tileRenderMode: undefined,
      nineSliceBorders: null,
    });
  });

  it('entities that fail translation leave no art entry and no id gap — the map aligns with level.entities', () => {
    // A custom map that resolves one identifier to a kind the props builder
    // cannot handle: that entity is dropped with a diagnostic; the rest map
    // through the default resolver as usual.
    const bogusMap: LdtkEntityMap = {
      resolve: (identifier, tags) =>
        identifier === 'Weird'
          ? ('bogus' as LevelEntity['kind'])
          : LDTK_DEFAULT_ENTITY_MAP.resolve(identifier, tags),
    };
    const level = makeLevel({
      entities: [
        ENT({ __identifier: 'Weird', px: [64, 16], width: 8, height: 8, __tile: TILE(48, 0) }),
        ENT({ __identifier: 'Spike', px: [0, 16], width: 16, height: 8, __tile: TILE(0, 0) }),
        ENT({ __identifier: 'Coin', px: [32, 16], width: 8, height: 8, __tile: TILE(16, 0) }),
      ],
    });
    const { level: out, entityArt, diagnostics } = ldtkLevelToLevelData(level, undefined, { entityMap: bogusMap });
    expect(out!.entities).toHaveLength(2);
    expect(diagnostics.some((d) => /unhandled kind/.test(d.message))).toBe(true);
    // Ids are gapless over the SURVIVING entities (1 and 2), and the art keys
    // are exactly those ids — a consumer iterating entities never sees a key
    // that does not belong to one.
    expect(out!.entities.map((e) => e.id)).toEqual([1, 2]);
    expect([...entityArt.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
  });
});
