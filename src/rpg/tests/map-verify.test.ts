import { describe, it, expect } from 'vitest';
import { verifyRpgWorld } from '../map-verify';
import type { RpgMapDefinition, RpgTerrainKind } from '../map';

const W = 7;
const H = 6;

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
    spawns: [{ id: 'start', tile: { tileX: 1, tileY: 1 }, facing: 'down' }],
    npcs: [],
    warps: [],
    healPoints: [],
    ...overrides,
  };
}

function idx(x: number, y: number): number {
  return y * W + x;
}

describe('verifyRpgWorld', () => {
  it('accepts a fully reachable world', () => {
    const clinic = makeMap({
      id: 'clinic',
      spawns: [{ id: 'entry', tile: { tileX: 2, tileY: 2 }, facing: 'up' }],
      healPoints: [{ id: 'mat', tile: { tileX: 2, tileY: 2 } }],
    });
    const zones = new Array<string | null>(W * H).fill(null);
    zones[idx(3, 4)] = 'grass';
    const field = makeMap({
      encounterZones: zones,
      npcs: [{ id: 'guide', name: 'Guide', tile: { tileX: 5, tileY: 4 }, facing: 'down', dialogueId: 'd1' }],
      warps: [{ id: 'door', source: { tileX: 5, tileY: 1 }, targetMapId: 'clinic', targetAnchorId: 'entry', targetFacing: 'up' }],
    });
    const result = verifyRpgWorld([field, clinic], 'field', 'start');
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('reports an NPC that no reachable tile can face', () => {
    const collision = new Array<boolean>(W * H).fill(false);
    for (const [x, y] of [[4, 4], [5, 3], [6, 4], [5, 5]] as const) {
      collision[idx(x, y)] = true;
    }
    const map = makeMap({
      collision,
      npcs: [{ id: 'hermit', name: 'Hermit', tile: { tileX: 5, tileY: 4 }, facing: 'down', dialogueId: 'd1' }],
    });
    const result = verifyRpgWorld([map], 'field', 'start');
    expect(result.ok).toBe(false);
    const npcDiagnostic = result.diagnostics.find((d) => d.code === 'rpg.world.npcUnreachable');
    expect(npcDiagnostic?.path).toContain('hermit');
  });

  it('reports an unreachable heal point and encounter zone', () => {
    const collision = new Array<boolean>(W * H).fill(false);
    // Enclose the heal mat and the grass tile completely.
    for (const [x, y] of [[5, 0], [4, 1], [6, 1], [5, 2], [5, 3], [4, 4], [6, 4], [5, 5]] as const) {
      collision[idx(x, y)] = true;
    }
    const zones = new Array<string | null>(W * H).fill(null);
    zones[idx(5, 4)] = 'grass';
    const map = makeMap({
      collision,
      encounterZones: zones,
      healPoints: [{ id: 'mat', tile: { tileX: 5, tileY: 1 } }],
    });
    const result = verifyRpgWorld([map], 'field', 'start');
    expect(result.ok).toBe(false);
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain('rpg.world.healUnreachable');
    expect(codes).toContain('rpg.world.encounterZoneUnreachable');
  });

  it('reports a missing spawn anchor instead of throwing', () => {
    const result = verifyRpgWorld([makeMap()], 'field', 'missing-anchor');
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'rpg.world.spawnMissing')).toBe(true);
  });

  it('traverses warps across maps so clinic interiors count as reachable', () => {
    const clinic = makeMap({
      id: 'clinic',
      spawns: [{ id: 'entry', tile: { tileX: 3, tileY: 3 }, facing: 'up' }],
      healPoints: [{ id: 'mat', tile: { tileX: 3, tileY: 1 } }],
    });
    const field = makeMap({
      warps: [
        { id: 'door', source: { tileX: 5, tileY: 1 }, targetMapId: 'clinic', targetAnchorId: 'entry', targetFacing: 'up' },
        { id: 'exit', source: { tileX: 3, tileY: 3 }, targetMapId: 'field', targetAnchorId: 'start', targetFacing: 'down' },
      ],
    });
    const result = verifyRpgWorld([field, clinic], 'field', 'start');
    expect(result.ok).toBe(true);
    // Break the clinic door: the heal mat becomes unreachable through the warp.
    const brokenCollision = new Array<boolean>(W * H).fill(false);
    brokenCollision[idx(5, 1)] = true;
    const brokenField = makeMap({
      collision: brokenCollision,
      warps: [
        { id: 'exit', source: { tileX: 3, tileY: 3 }, targetMapId: 'field', targetAnchorId: 'start', targetFacing: 'down' },
      ],
    });
    const broken = verifyRpgWorld([brokenField, clinic], 'field', 'start');
    expect(broken.ok).toBe(false);
  });

  it('reports a warp whose source tile cannot be reached', () => {
    const clinic = makeMap({
      id: 'clinic',
      spawns: [{ id: 'entry', tile: { tileX: 2, tileY: 2 }, facing: 'up' }],
    });
    const fieldCollision = new Array<boolean>(W * H).fill(false);
    // Enclose the warp source tile completely.
    for (const [x, y] of [[5, 0], [4, 1], [6, 1], [5, 2]] as const) {
      fieldCollision[idx(x, y)] = true;
    }
    const field = makeMap({
      collision: fieldCollision,
      warps: [{ id: 'door', source: { tileX: 5, tileY: 1 }, targetMapId: 'clinic', targetAnchorId: 'entry', targetFacing: 'up' }],
    });
    const result = verifyRpgWorld([field, clinic], 'field', 'start');
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'rpg.world.warpUnreachable')).toBe(true);
  });
});
