import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseLdtkProject, parseLdtkLevelFile } from '../ldtk';
import type { LdtkProject } from '../ldtk';

/**
 * A minimal but representative `.ldtk` project JSON used across these
 * tests. Exercises every layer type (IntGrid + Tiles + AutoLayer +
 * Entities), multiple tilesets, an unknown entity (escape hatch), flip
 * and alpha tile flags, and the `embedAtlas: LdtkIcons` skip case.
 */
const SAMPLE_PROJECT: LdtkProject = {
  jsonVersion: '1.5.3',
  iid: 'proj-1',
  bgColor: '#000000',
  externalLevels: false,
  worldLayout: 'LinearHorizontal',
  worldGridWidth: null,
  worldGridHeight: null,
  worlds: [],
  defs: {
    entities: [],
    tilesets: [
      {
        identifier: 'SunnyLand',
        uid: 1,
        relPath: 'sunny.png',
        pxWid: 96,
        pxHei: 48,
        tileGridSize: 16,
        padding: 0,
        spacing: 0,
        __cWid: 6,
        __cHei: 3,
        embedAtlas: null,
      },
      {
        identifier: 'Icons',
        uid: 99,
        relPath: null,
        pxWid: 0,
        pxHei: 0,
        tileGridSize: 16,
        __cWid: 0,
        __cHei: 0,
        embedAtlas: 'LdtkIcons',
      },
    ],
    enums: [],
    layers: [
      {
        __type: 'IntGrid',
        identifier: 'Collisions',
        uid: 10,
        gridSize: 16,
        intGridValues: [
          { identifier: 'walls', value: 1, color: '#ff0000' },
          { identifier: 'platform', value: 2, color: '#00ff00' },
        ],
      },
    ],
  },
  levels: [
    {
      identifier: 'Level_0',
      iid: 'lvl-0',
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
          __type: 'IntGrid',
          __identifier: 'Collisions',
          __cWid: 3,
          __cHei: 2,
          __gridSize: 16,
          __opacity: 1,
          __pxTotalOffsetX: 0,
          __pxTotalOffsetY: 0,
          visible: true,
          iid: 'layer-1',
          levelId: 'lvl-0',
          layerDefUid: 10,
          intGridCsv: [1, 1, 1, 0, 0, 2],
          __tilesetDefUid: null,
          __tilesetRelPath: null,
        },
        {
          __type: 'AutoLayer',
          __identifier: 'AutoTiles',
          __cWid: 3,
          __cHei: 2,
          __gridSize: 16,
          __opacity: 1,
          __pxTotalOffsetX: 0,
          __pxTotalOffsetY: 0,
          visible: true,
          iid: 'layer-2',
          levelId: 'lvl-0',
          layerDefUid: 11,
          autoLayerTiles: [
            { px: [0, 0], src: [0, 0], t: 0, f: 0, a: 1 },
            { px: [16, 0], src: [16, 0], t: 1, f: 1, a: 0.5 },
          ],
          __tilesetDefUid: 1,
          __tilesetRelPath: 'sunny.png',
        },
        {
          __type: 'Tiles',
          __identifier: 'HandPlaced',
          __cWid: 3,
          __cHei: 2,
          __gridSize: 16,
          __opacity: 0.8,
          __pxTotalOffsetX: 4,
          __pxTotalOffsetY: 8,
          visible: false,
          iid: 'layer-3',
          levelId: 'lvl-0',
          layerDefUid: 12,
          gridTiles: [{ px: [32, 16], src: [32, 0], t: 2, f: 3 }],
          __tilesetDefUid: 1,
          __tilesetRelPath: 'sunny.png',
        },
        {
          __type: 'Entities',
          __identifier: 'Entities',
          __cWid: 3,
          __cHei: 2,
          __gridSize: 16,
          __opacity: 1,
          __pxTotalOffsetX: 0,
          __pxTotalOffsetY: 0,
          visible: true,
          iid: 'layer-4',
          levelId: 'lvl-0',
          layerDefUid: 13,
          entityInstances: [
            { __identifier: 'Player', defUid: 50, iid: 'e1', __tags: [], px: [16, 16], width: 16, height: 24, __grid: [1, 1], __pivot: [0.5, 1], __tile: null, fieldInstances: [] },
            { __identifier: 'Coin', defUid: 51, iid: 'e2', __tags: ['pickup'], px: [32, 16], width: 8, height: 8, __grid: [2, 1], __pivot: [0.5, 0.5], __tile: { tilesetUid: 1, x: 0, y: 0, w: 16, h: 16 }, fieldInstances: [{ __identifier: 'value', __type: 'Int', __value: 5 }] },
            { __identifier: 'CustomBoss', defUid: 52, iid: 'e3', __tags: [], px: [0, 0], width: 32, height: 32, __grid: [0, 0], __pivot: [0, 0], __tile: null, fieldInstances: [{ __identifier: 'health', __type: 'Int', __value: 100 }] },
          ],
          __tilesetDefUid: null,
          __tilesetRelPath: null,
        },
      ],
    },
  ],
};

describe('parseLdtkProject', () => {
  it('parses a valid project without errors', () => {
    const result = parseLdtkProject(JSON.stringify(SAMPLE_PROJECT));
    expect(result.ok).toBe(true);
    expect(result.errors.filter((e) => e.severity === 'error')).toEqual([]);
    expect(result.project).toBeDefined();
  });

  it('captures the root metadata', () => {
    const { project } = parseLdtkProject(JSON.stringify(SAMPLE_PROJECT));
    expect(project?.jsonVersion).toBe('1.5.3');
    expect(project?.iid).toBe('proj-1');
    expect(project?.worldLayout).toBe('LinearHorizontal');
    expect(project?.externalLevels).toBe(false);
  });

  it('keeps both real and embedAtlas tilesets', () => {
    const { project } = parseLdtkProject(JSON.stringify(SAMPLE_PROJECT));
    const tilesets = project!.defs.tilesets;
    expect(tilesets).toHaveLength(2);
    expect(tilesets[0]).toMatchObject({ identifier: 'SunnyLand', uid: 1, relPath: 'sunny.png', tileGridSize: 16, __cWid: 6, __cHei: 3 });
    expect(tilesets[1]).toMatchObject({ identifier: 'Icons', embedAtlas: 'LdtkIcons', relPath: null });
  });

  it('copies the IntGrid layer 1:1 into intGridCsv', () => {
    const { project } = parseLdtkProject(JSON.stringify(SAMPLE_PROJECT));
    const layer = project!.levels[0].layerInstances![0];
    expect(layer.__type).toBe('IntGrid');
    expect(layer.intGridCsv).toEqual([1, 1, 1, 0, 0, 2]);
    expect(layer.__cWid).toBe(3);
    expect(layer.__cHei).toBe(2);
  });

  it('preserves flip and alpha flags on auto-layer tiles', () => {
    const { project } = parseLdtkProject(JSON.stringify(SAMPLE_PROJECT));
    const layer = project!.levels[0].layerInstances![1];
    expect(layer.__type).toBe('AutoLayer');
    expect(layer.autoLayerTiles).toHaveLength(2);
    expect(layer.autoLayerTiles![1]).toMatchObject({ f: 1, a: 0.5 });
  });

  it('preserves opacity, offset, and visible flags on Tiles layers', () => {
    const { project } = parseLdtkProject(JSON.stringify(SAMPLE_PROJECT));
    const layer = project!.levels[0].layerInstances![2];
    expect(layer.__type).toBe('Tiles');
    expect(layer.__opacity).toBe(0.8);
    expect(layer.__pxTotalOffsetX).toBe(4);
    expect(layer.__pxTotalOffsetY).toBe(8);
    expect(layer.visible).toBe(false);
    expect(layer.gridTiles).toHaveLength(1);
    expect(layer.gridTiles![0].f).toBe(3); // both flips
  });

  it('parses entities including their field instances and tiles', () => {
    const { project } = parseLdtkProject(JSON.stringify(SAMPLE_PROJECT));
    const layer = project!.levels[0].layerInstances![3];
    expect(layer.__type).toBe('Entities');
    const [player, coin, boss] = layer.entityInstances!;
    expect(player.__identifier).toBe('Player');
    expect(player.px).toEqual([16, 16]);
    expect(coin.__tile).toMatchObject({ tilesetUid: 1, x: 0, y: 0, w: 16, h: 16 });
    expect(coin.fieldInstances[0]).toMatchObject({ __identifier: 'value', __value: 5 });
    expect(boss.fieldInstances[0]).toMatchObject({ __identifier: 'health', __value: 100 });
  });

  it('returns ok=false with a diagnostic for malformed JSON', () => {
    const result = parseLdtkProject('{ not json');
    expect(result.ok).toBe(false);
    expect(result.project).toBeUndefined();
    expect(result.errors[0].severity).toBe('error');
    expect(result.errors[0].message).toContain('JSON parse failed');
  });

  it('returns ok=false when the root is not an object', () => {
    const result = parseLdtkProject('[]');
    expect(result.ok).toBe(false);
    expect(result.errors[0].path).toBe('root');
  });

  it('emits an error for an unknown layer __type but keeps siblings', () => {
    const raw = JSON.parse(JSON.stringify(SAMPLE_PROJECT));
    raw.levels[0].layerInstances.push({ __type: 'Magic', __identifier: 'Bad' });
    const result = parseLdtkProject(JSON.stringify(raw));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes('unknown layer type'))).toBe(true);
    // The other 4 layers are still present.
    expect(result.project!.levels[0].layerInstances).toHaveLength(4);
  });

  it('drops malformed tiles but keeps parseable ones in the same layer', () => {
    const raw = JSON.parse(JSON.stringify(SAMPLE_PROJECT));
    // Inject one good and one malformed tile into the AutoLayer.
    raw.levels[0].layerInstances[1].autoLayerTiles = [
      { px: [0, 0], src: [0, 0], t: 0 },
      { px: [16], t: 99 }, // missing src / malformed px
    ];
    const { project, errors } = parseLdtkProject(JSON.stringify(raw));
    const layer = project!.levels[0].layerInstances![1];
    expect(layer.autoLayerTiles).toHaveLength(1);
    expect(errors.filter((e) => e.severity === 'error')).toEqual([]);
  });

  it('parses entity-def tileRenderMode for all seven schema values', () => {
    const raw = JSON.parse(JSON.stringify(SAMPLE_PROJECT));
    const modes = [
      'Cover', 'FitInside', 'Repeat', 'Stretch',
      'FullSizeCropped', 'FullSizeUncropped', 'NineSlice',
    ] as const;
    // The two shipped Celerock pack values ride along (Gem / Spike, uid 43
    // tileset) so the real pack's modes are pinned by the same test.
    raw.defs.entities = [
      ...modes.map((m, i) => ({
        identifier: `E${i}`, uid: 100 + i, renderMode: 'Tile', tileRenderMode: m,
        tileRect: { tilesetUid: 1, x: 0, y: 0, w: 8, h: 8 },
      })),
      {
        identifier: 'Gem', uid: 98, renderMode: 'Tile', tilesetId: 43,
        tileRenderMode: 'FitInside',
        tileRect: { tilesetUid: 43, x: 888, y: 672, w: 8, h: 8 },
      },
      {
        identifier: 'Spike', uid: 97, renderMode: 'Tile', tilesetId: 43,
        tileRenderMode: 'Repeat',
        tileRect: { tilesetUid: 43, x: 992, y: 688, w: 8, h: 8 },
      },
    ];
    const { project } = parseLdtkProject(JSON.stringify(raw));
    const defs = project!.defs.entities;
    modes.forEach((m, i) => expect(defs[i].tileRenderMode).toBe(m));
    expect(defs.find((d) => d.identifier === 'Gem')!.tileRenderMode).toBe('FitInside');
    expect(defs.find((d) => d.identifier === 'Spike')!.tileRenderMode).toBe('Repeat');
  });

  it('defaults tileRenderMode to FitInside when the key is absent or garbage', () => {
    const raw = JSON.parse(JSON.stringify(SAMPLE_PROJECT));
    raw.defs.entities = [
      { identifier: 'NoKey', uid: 1, renderMode: 'Tile', tileRect: { tilesetUid: 1, x: 0, y: 0, w: 8, h: 8 } },
      { identifier: 'Garbage', uid: 2, renderMode: 'Tile', tileRenderMode: 'Diagonal', tileRect: null },
    ];
    const { project } = parseLdtkProject(JSON.stringify(raw));
    const defs = project!.defs.entities;
    expect(defs.find((d) => d.identifier === 'NoKey')!.tileRenderMode).toBe('FitInside');
    expect(defs.find((d) => d.identifier === 'Garbage')!.tileRenderMode).toBe('FitInside');
  });

  it('defaults every adversarial-fixture entity def to FitInside (zero tileRenderMode keys in the raw file)', () => {
    const url = new URL('./fixtures/celerock-adversarial.ldtk', import.meta.url);
    const { project } = parseLdtkProject(readFileSync(url, 'utf8'));
    expect(project!.defs.entities.length).toBeGreaterThan(0);
    for (const def of project!.defs.entities) {
      expect(def.tileRenderMode).toBe('FitInside');
    }
  });
});

describe('parseLdtkLevelFile', () => {
  it('parses a standalone .ldtkl level object', () => {
    const levelJson = JSON.stringify(SAMPLE_PROJECT.levels[0]);
    const result = parseLdtkLevelFile(levelJson);
    expect(result.ok).toBe(true);
    expect(result.level?.identifier).toBe('Level_0');
    expect(result.level?.layerInstances).toHaveLength(4);
  });

  it('fails on malformed JSON', () => {
    const result = parseLdtkLevelFile('not json');
    expect(result.ok).toBe(false);
    expect(result.level).toBeUndefined();
  });
});
