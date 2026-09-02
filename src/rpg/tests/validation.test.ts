import { describe, it, expect } from 'vitest';
import { validateRpgMap, validateRpgMapCatalog } from '../validation';
import type { RpgMapDefinition, RpgTerrainKind } from '../map';

const W = 6;
const H = 5;

function makeMap(overrides?: Partial<RpgMapDefinition>): RpgMapDefinition {
  return {
    schemaVersion: 1,
    id: 'field',
    name: 'Field',
    widthTiles: W,
    heightTiles: H,
    tileSize: 16,
    terrain: new Array<RpgTerrainKind>(W * H).fill('ground'),
    collision: new Array<boolean>(W * H).fill(false),
    encounterZones: new Array<string | null>(W * H).fill(null),
    spawns: [{ id: 'start', tile: { tileX: 2, tileY: 2 }, facing: 'down' }],
    npcs: [],
    warps: [],
    healPoints: [],
    ...overrides,
  };
}

function idx(x: number, y: number): number {
  return y * W + x;
}

function emptyCollision(): boolean[] {
  return new Array<boolean>(W * H).fill(false);
}

function emptyTerrain(): RpgTerrainKind[] {
  return new Array<RpgTerrainKind>(W * H).fill('ground');
}

function errorsOf(diagnostics: readonly { severity: string }[]): number {
  return diagnostics.filter((d) => d.severity === 'error').length;
}

describe('validateRpgMap', () => {
  it('accepts a well-formed map with no diagnostics', () => {
    expect(validateRpgMap(makeMap())).toEqual([]);
  });

  it('rejects dimension/grid length mismatches with a stable path', () => {
    const diagnostics = validateRpgMap(makeMap({ collision: [false, false] }));
    expect(errorsOf(diagnostics)).toBe(1);
    expect(diagnostics[0].code).toBe('rpg.map.gridLength');
    expect(diagnostics[0].path).toBe('collision');
  });

  it('rejects invalid terrain kinds with the offending index in the path', () => {
    const terrain = emptyTerrain();
    (terrain as string[])[7] = 'lava-marsh';
    const map = makeMap({ terrain });
    const diagnostics = validateRpgMap(map);
    expect(diagnostics[0].code).toBe('rpg.map.terrain');
    expect(diagnostics[0].path).toBe('terrain[7]');
  });

  it('rejects spawns that are out of bounds, blocked, or duplicated', () => {
    const collision = emptyCollision();
    collision[idx(1, 1)] = true;
    const map = makeMap({
      collision,
      spawns: [
        { id: 'start', tile: { tileX: 2, tileY: 2 }, facing: 'down' },
        { id: 'start', tile: { tileX: 99, tileY: 0 }, facing: 'down' },
        { id: 'other', tile: { tileX: 1, tileY: 1 }, facing: 'up' },
      ],
    });
    const diagnostics = validateRpgMap(map);
    const codes = diagnostics.map((d) => d.code);
    expect(codes).toContain('rpg.map.duplicateSpawnId');
    expect(codes).toContain('rpg.map.spawnOutOfBounds');
    expect(codes).toContain('rpg.map.spawnBlocked');
  });

  it('rejects NPCs that are out of bounds, duplicated, or standing in walls', () => {
    const collision = emptyCollision();
    collision[idx(1, 3)] = true;
    const map = makeMap({
      collision,
      npcs: [
        { id: 'guide', name: 'Guide', tile: { tileX: 3, tileY: 3 }, facing: 'down', dialogueId: 'd1' },
        { id: 'guide', name: 'Guide', tile: { tileX: 99, tileY: 0 }, facing: 'down', dialogueId: 'd1' },
        { id: 'waller', name: 'Waller', tile: { tileX: 1, tileY: 3 }, facing: 'down', dialogueId: 'd2' },
      ],
    });
    const codes = validateRpgMap(map).map((d) => d.code);
    expect(codes).toContain('rpg.map.npcOutOfBounds');
    expect(codes).toContain('rpg.map.duplicateNpcId');
    expect(codes).toContain('rpg.map.npcBlocked');
  });

  it('rejects warps whose source is out of bounds, blocked, or duplicated', () => {
    const collision = emptyCollision();
    collision[idx(0, 4)] = true;
    const map = makeMap({
      collision,
      warps: [
        { id: 'door', source: { tileX: 4, tileY: 4 }, targetMapId: 'clinic', targetAnchorId: 'entry', targetFacing: 'up' },
        { id: 'door', source: { tileX: 4, tileY: 99 }, targetMapId: 'clinic', targetAnchorId: 'entry', targetFacing: 'up' },
        { id: 'buried', source: { tileX: 0, tileY: 4 }, targetMapId: 'clinic', targetAnchorId: 'entry', targetFacing: 'up' },
      ],
    });
    const codes = validateRpgMap(map).map((d) => d.code);
    expect(codes).toContain('rpg.map.warpSourceOutOfBounds');
    expect(codes).toContain('rpg.map.duplicateWarpId');
    expect(codes).toContain('rpg.map.warpSourceBlocked');
  });

  it('rejects heal points that are out of bounds, blocked, or duplicated', () => {
    const collision = emptyCollision();
    collision[idx(1, 1)] = true;
    const map = makeMap({
      collision,
      healPoints: [
        { id: 'mat', tile: { tileX: 1, tileY: 1 } },
        { id: 'mat', tile: { tileX: 2, tileY: 0 } },
      ],
    });
    const codes = validateRpgMap(map).map((d) => d.code);
    expect(codes).toContain('rpg.map.duplicateHealId');
    expect(codes).toContain('rpg.map.healBlocked');
  });
});

describe('validateRpgMapCatalog', () => {
  it('accepts a consistent two-map catalog', () => {
    const clinic = makeMap({
      id: 'clinic',
      spawns: [{ id: 'entry', tile: { tileX: 2, tileY: 2 }, facing: 'up' }],
    });
    const field = makeMap({
      warps: [{ id: 'door', source: { tileX: 4, tileY: 4 }, targetMapId: 'clinic', targetAnchorId: 'entry', targetFacing: 'up' }],
    });
    expect(errorsOf(validateRpgMapCatalog([field, clinic]))).toBe(0);
  });

  it('flags duplicate map ids and broken warp targets with stable paths', () => {
    const clinic = makeMap({ id: 'clinic' });
    const field = makeMap({
      warps: [
        { id: 'door', source: { tileX: 4, tileY: 4 }, targetMapId: 'clinic', targetAnchorId: 'missing', targetFacing: 'up' },
        { id: 'exit', source: { tileX: 0, tileY: 4 }, targetMapId: 'nowhere', targetAnchorId: 'entry', targetFacing: 'up' },
      ],
    });
    const diagnostics = validateRpgMapCatalog([field, clinic, makeMap({ id: 'field' })]);
    const codes = diagnostics.map((d) => d.code);
    expect(codes).toContain('rpg.catalog.duplicateMapId');
    expect(codes).toContain('rpg.catalog.warpTargetAnchorMissing');
    expect(codes).toContain('rpg.catalog.warpTargetMapMissing');
    const anchorPath = diagnostics.find((d) => d.code === 'rpg.catalog.warpTargetAnchorMissing');
    expect(anchorPath?.path).toBe('maps[field].warps[door].targetAnchorId');
  });

  it('flags warp targets that land on blocked tiles', () => {
    const clinicCollision = emptyCollision();
    clinicCollision[idx(2, 2)] = true;
    const clinic = makeMap({ id: 'clinic', collision: clinicCollision });
    const field = makeMap({
      warps: [{ id: 'door', source: { tileX: 4, tileY: 4 }, targetMapId: 'clinic', targetAnchorId: 'start', targetFacing: 'up' }],
    });
    const codes = validateRpgMapCatalog([field, clinic]).map((d) => d.code);
    expect(codes).toContain('rpg.catalog.warpTargetBlocked');
  });
});
