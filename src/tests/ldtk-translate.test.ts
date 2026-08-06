import { describe, expect, it } from 'vitest';
import {
  LDTK_DEFAULT_ENTITY_MAP,
  ldtkLevelToLevelData,
  translateLdtkEntity,
} from '../ldtk/translate';
import { validateLevel } from '../level';
import type { LdtkEntityInstance, LdtkLevel } from '../ldtk/types';

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
    const { level: out } = ldtkLevelToLevelData(level, {
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
