import { describe, it, expect } from 'vitest';
import { facingTile, npcAt, resolveInteraction } from '../interaction';
import type { RpgMapDefinition } from '../map';
import type { RpgLocation } from '../types';
import type { RpgTerrainKind } from '../map';

const W = 6;
const H = 5;

function makeMap(overrides?: Partial<RpgMapDefinition>): RpgMapDefinition {
  return {
    schemaVersion: 1,
    id: 'test-map',
    name: 'Test Map',
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

const NPC_MAP = makeMap({
  npcs: [
    { id: 'guide', name: 'Guide', tile: { tileX: 3, tileY: 2 }, facing: 'down', dialogueId: 'dlg-guide' },
  ],
});

describe('facingTile', () => {
  const location: RpgLocation = { mapId: 'test-map', tileX: 2, tileY: 2, facing: 'down' };
  it('computes the faced tile for each direction', () => {
    expect(facingTile({ ...location, facing: 'up' })).toEqual({ tileX: 2, tileY: 1 });
    expect(facingTile({ ...location, facing: 'down' })).toEqual({ tileX: 2, tileY: 3 });
    expect(facingTile({ ...location, facing: 'left' })).toEqual({ tileX: 1, tileY: 2 });
    expect(facingTile({ ...location, facing: 'right' })).toEqual({ tileX: 3, tileY: 2 });
  });
});

describe('npcAt', () => {
  it('finds the NPC occupying a tile', () => {
    expect(npcAt(NPC_MAP, { tileX: 3, tileY: 2 })?.id).toBe('guide');
  });
  it('returns null on an empty tile', () => {
    expect(npcAt(NPC_MAP, { tileX: 1, tileY: 1 })).toBeNull();
  });
});

describe('resolveInteraction', () => {
  it('resolves an NPC standing on the faced tile', () => {
    const resolution = resolveInteraction(NPC_MAP, {
      mapId: 'test-map',
      tileX: 2,
      tileY: 2,
      facing: 'right',
    });
    expect(resolution).toEqual({ kind: 'npc', npcId: 'guide', dialogueId: 'dlg-guide' });
  });
  it('returns none when the faced tile is empty', () => {
    const resolution = resolveInteraction(NPC_MAP, {
      mapId: 'test-map',
      tileX: 2,
      tileY: 2,
      facing: 'down',
    });
    expect(resolution).toEqual({ kind: 'none' });
  });
});
