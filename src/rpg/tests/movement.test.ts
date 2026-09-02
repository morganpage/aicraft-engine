import { describe, it, expect } from 'vitest';
import {
  advanceGridMovement,
  createOverworldAtAnchor,
  type GridMovementResult,
} from '../movement';
import { resolveArrival, type GridArrival } from '../interaction';
import type { RpgMapDefinition, RpgTerrainKind } from '../map';
import type { OverworldState, RpgConfig } from '../state';
import type { RpgInput } from '../types';

const W = 6;
const H = 5;

function emptyTerrain(): RpgTerrainKind[] {
  return new Array<RpgTerrainKind>(W * H).fill('ground');
}

function emptyCollision(): boolean[] {
  return new Array<boolean>(W * H).fill(false);
}

function emptyZones(): (string | null)[] {
  return new Array<string | null>(W * H).fill(null);
}

function makeMap(overrides?: Partial<RpgMapDefinition>): RpgMapDefinition {
  return {
    schemaVersion: 1,
    id: 'test-map',
    name: 'Test Map',
    widthTiles: W,
    heightTiles: H,
    tileSize: 16,
    terrain: emptyTerrain(),
    collision: emptyCollision(),
    encounterZones: emptyZones(),
    spawns: [{ id: 'start', tile: { tileX: 2, tileY: 2 }, facing: 'down' }],
    npcs: [],
    warps: [],
    healPoints: [],
    ...overrides,
  };
}

const CONFIG: RpgConfig = { tickDuration: 1 / 60, stepDurationTicks: 8, transitionDurationTicks: 18 };

const NO_INPUT: RpgInput = { direction: null, confirm: false, cancel: false, menu: false, battleCommand: null };
const HOLD_RIGHT: RpgInput = { direction: 'right', confirm: false, cancel: false, menu: false, battleCommand: null };

function idx(x: number, y: number): number {
  return y * W + x;
}

function startOverworld(map: RpgMapDefinition = makeMap()): OverworldState {
  const overworld = createOverworldAtAnchor(map, 'start');
  expect(overworld).not.toBeNull();
  return overworld as OverworldState;
}

describe('createOverworldAtAnchor', () => {
  it('builds an idle overworld at the named anchor', () => {
    const overworld = createOverworldAtAnchor(makeMap(), 'start');
    expect(overworld).toEqual({
      location: { mapId: 'test-map', tileX: 2, tileY: 2, facing: 'down' },
      step: null,
    });
  });
  it('returns null for a missing anchor instead of throwing', () => {
    expect(createOverworldAtAnchor(makeMap(), 'nope')).toBeNull();
  });
});

describe('advanceGridMovement', () => {
  it('starts a tick-counted step on a direction while keeping the departure tile authoritative', () => {
    const result = advanceGridMovement(startOverworld(), 10, HOLD_RIGHT, makeMap(), CONFIG);
    expect(result.events).toEqual([]);
    expect(result.arrival).toBeNull();
    expect(result.overworld.location).toEqual({ mapId: 'test-map', tileX: 2, tileY: 2, facing: 'right' });
    expect(result.overworld.step).toEqual({
      from: { tileX: 2, tileY: 2 },
      to: { tileX: 3, tileY: 2 },
      facing: 'right',
      startedTick: 10,
      durationTicks: 8,
    });
  });

  it('updates facing even when the destination is blocked by collision', () => {
    const collision = emptyCollision();
    collision[idx(3, 2)] = true;
    const result = advanceGridMovement(startOverworld(), 0, HOLD_RIGHT, makeMap({ collision }), CONFIG);
    expect(result.overworld.location).toEqual({ mapId: 'test-map', tileX: 2, tileY: 2, facing: 'right' });
    expect(result.overworld.step).toBeNull();
    expect(result.events).toEqual([]);
    expect(result.arrival).toBeNull();
  });

  it('is blocked at the map bounds without starting a step', () => {
    const map = makeMap({
      spawns: [{ id: 'start', tile: { tileX: 0, tileY: 2 }, facing: 'left' }],
    });
    const overworld = createOverworldAtAnchor(map, 'start') as OverworldState;
    const result = advanceGridMovement(overworld, 0, { ...NO_INPUT, direction: 'left' }, map, CONFIG);
    expect(result.overworld.step).toBeNull();
    expect(result.overworld.location?.facing).toBe('left');
    expect(result.overworld.location?.tileX).toBe(0);
  });

  it('is blocked by an NPC standing on the destination tile', () => {
    const map = makeMap({
      npcs: [
        { id: 'guide', name: 'Guide', tile: { tileX: 3, tileY: 2 }, facing: 'down', dialogueId: 'dlg-guide' },
      ],
    });
    const result = advanceGridMovement(startOverworld(), 0, HOLD_RIGHT, map, CONFIG);
    expect(result.overworld.step).toBeNull();
    expect(result.overworld.location?.facing).toBe('right');
  });

  it('ignores direction input while a step is in progress', () => {
    const started = advanceGridMovement(startOverworld(), 10, HOLD_RIGHT, makeMap(), CONFIG);
    const mid = advanceGridMovement(started.overworld, 11, { ...NO_INPUT, direction: 'up' }, makeMap(), CONFIG);
    expect(mid.overworld).toEqual(started.overworld);
    expect(mid.arrival).toBeNull();
  });

  it('emits exactly one stepCompleted on the arrival tick and commits the location', () => {
    let overworld = startOverworld();
    let eventsCount = 0;
    for (let tick = 10; tick <= 18; tick++) {
      const result = advanceGridMovement(overworld, tick, HOLD_RIGHT, makeMap(), CONFIG);
      overworld = result.overworld;
      eventsCount += result.events.length;
      if (tick < 18) {
        expect(result.arrival).toBeNull();
      } else {
        expect(result.events).toEqual([
          { type: 'stepCompleted', mapId: 'test-map', tileX: 3, tileY: 2 },
        ]);
        expect(result.arrival).toEqual({ kind: 'plain' });
      }
    }
    expect(eventsCount).toBe(1);
    expect(overworld.location).toEqual({ mapId: 'test-map', tileX: 3, tileY: 2, facing: 'right' });
    expect(overworld.step).toBeNull();
  });

  it('does not chain a new step on the arrival tick itself', () => {
    let overworld = startOverworld();
    for (let tick = 0; tick <= 8; tick++) {
      overworld = advanceGridMovement(overworld, tick, HOLD_RIGHT, makeMap(), CONFIG).overworld;
    }
    expect(overworld.step).toBeNull();
    const next = advanceGridMovement(overworld, 9, HOLD_RIGHT, makeMap(), CONFIG);
    expect(next.overworld.step).not.toBeNull();
    expect(next.overworld.step?.from).toEqual({ tileX: 3, tileY: 2 });
  });

  it('resolves arrival priority warp → heal → encounter zone', () => {
    const zones = emptyZones();
    zones[idx(3, 2)] = 'grass-table';
    const terrain = emptyTerrain();
    terrain[idx(3, 2)] = 'grass';
    const map = makeMap({
      terrain,
      encounterZones: zones,
      warps: [{ id: 'door', source: { tileX: 3, tileY: 2 }, targetMapId: 'clinic', targetAnchorId: 'entry', targetFacing: 'up' }],
      healPoints: [{ id: 'mat', tile: { tileX: 3, tileY: 2 } }],
    });
    const arrival = driveOneStep(map, 'right');
    expect(arrival).toEqual({ kind: 'warp', warpId: 'door' });
  });

  it('resolves a heal point above an encounter zone', () => {
    const zones = emptyZones();
    zones[idx(3, 2)] = 'grass-table';
    const map = makeMap({
      encounterZones: zones,
      healPoints: [{ id: 'mat', tile: { tileX: 3, tileY: 2 } }],
    });
    const arrival = driveOneStep(map, 'right');
    expect(arrival).toEqual({ kind: 'heal', healPointId: 'mat' });
  });

  it('resolves an encounter-zone arrival on grass', () => {
    const zones = emptyZones();
    zones[idx(3, 2)] = 'grass-table';
    const terrain = emptyTerrain();
    terrain[idx(3, 2)] = 'grass';
    const map = makeMap({ terrain, encounterZones: zones });
    const arrival = driveOneStep(map, 'right');
    expect(arrival).toEqual({ kind: 'encounterZone', encounterTableId: 'grass-table' });
  });

  it('never produces an encounter arrival on a blocked attempt or idle tick', () => {
    const zones = emptyZones();
    zones[idx(3, 2)] = 'grass-table';
    const collision = emptyCollision();
    collision[idx(3, 2)] = true;
    const map = makeMap({ encounterZones: zones, collision });
    const blocked = advanceGridMovement(startOverworld(), 0, HOLD_RIGHT, map, CONFIG);
    expect(blocked.arrival).toBeNull();
    expect(blocked.events).toEqual([]);
    const idle = advanceGridMovement(startOverworld(), 0, NO_INPUT, makeMap(), CONFIG);
    expect(idle.arrival).toBeNull();
    expect(idle.events).toEqual([]);
  });

  it('is pure: the input overworld object is never mutated', () => {
    const overworld = startOverworld();
    const frozen = JSON.parse(JSON.stringify(overworld));
    advanceGridMovement(overworld, 0, HOLD_RIGHT, makeMap(), CONFIG);
    expect(overworld).toEqual(frozen);
  });

  it('reports a diagnostic and no-ops on a malformed map grid', () => {
    const map = makeMap({ collision: [false, false] });
    const result: GridMovementResult = advanceGridMovement(startOverworld(), 0, HOLD_RIGHT, map, CONFIG);
    expect(result.overworld.step).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].code).toBe('rpg.movement.mapMalformed');
  });
});

function driveOneStep(map: RpgMapDefinition, direction: 'up' | 'down' | 'left' | 'right'): GridArrival | null {
  let overworld = createOverworldAtAnchor(map, 'start') as OverworldState;
  const input: RpgInput = { direction, confirm: false, cancel: false, menu: false, battleCommand: null };
  let arrival: GridArrival | null = null;
  for (let tick = 0; tick <= CONFIG.stepDurationTicks; tick++) {
    const result = advanceGridMovement(overworld, tick, input, map, CONFIG);
    overworld = result.overworld;
    arrival = result.arrival ?? arrival;
  }
  return arrival;
}

describe('resolveArrival', () => {
  it('returns plain for an empty tile', () => {
    expect(resolveArrival(makeMap(), { tileX: 1, tileY: 1 })).toEqual({ kind: 'plain' });
  });
  it('returns warp when the tile is a warp source', () => {
    const map = makeMap({
      warps: [{ id: 'door', source: { tileX: 4, tileY: 4 }, targetMapId: 'clinic', targetAnchorId: 'entry', targetFacing: 'up' }],
    });
    expect(resolveArrival(map, { tileX: 4, tileY: 4 })).toEqual({ kind: 'warp', warpId: 'door' });
  });
});
