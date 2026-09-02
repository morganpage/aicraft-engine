import { describe, it, expect } from 'vitest';
import { generateRpgWorld, STARTER_FIELD_MAP_ID, STARTER_CLINIC_MAP_ID } from '../mapgen';
import { advanceGridMovement, createOverworldAtAnchor } from '../movement';
import { npcAt, resolveInteraction, type GridArrival } from '../interaction';
import { healPartyFully } from '../party';
import type { SpeciesDefinition } from '../creatures';
import { DEFAULT_RPG_CONFIG } from '../constants';
import type { RpgMapDefinition } from '../map';
import type { OverworldState } from '../state';
import type { RpgDirection, RpgTileRef } from '../types';
import { canonicalize, fnv1a } from '../../level';

/**
 * Milestone 1 exit gate: a headless scripted input trace reaches the NPC,
 * the grass, the clinic, and the return warp on every tested seed, and the
 * same trace yields an identical world state and hash.
 */

const SEED_CORPUS: readonly number[] = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 4181, 6765];

const STEP_TICKS = DEFAULT_RPG_CONFIG.stepDurationTicks;

const NEIGHBOR_ORDER: readonly { dir: RpgDirection; dx: number; dy: number }[] = [
  { dir: 'up', dx: 0, dy: -1 },
  { dir: 'down', dx: 0, dy: 1 },
  { dir: 'left', dx: -1, dy: 0 },
  { dir: 'right', dx: 1, dy: 0 },
];

function walkable(map: RpgMapDefinition, tile: RpgTileRef): boolean {
  if (tile.tileX < 0 || tile.tileX >= map.widthTiles) return false;
  if (tile.tileY < 0 || tile.tileY >= map.heightTiles) return false;
  if (map.collision[tile.tileY * map.widthTiles + tile.tileX]) return false;
  return npcAt(map, tile) === null;
}

function isWarpSource(map: RpgMapDefinition, tile: RpgTileRef): boolean {
  return map.warps.some((w) => w.source.tileX === tile.tileX && w.source.tileY === tile.tileY);
}

/**
 * BFS route over walkable tiles. Warp sources are pass-through barriers:
 * the route may end on one but never cross one, so the trace never
 * accidentally triggers a mid-route warp.
 */
function findRoute(
  map: RpgMapDefinition,
  from: RpgTileRef,
  to: RpgTileRef,
): RpgDirection[] | null {
  const previous = new Map<number, { tile: RpgTileRef; dir: RpgDirection } | null>();
  const key = (t: RpgTileRef) => t.tileY * map.widthTiles + t.tileX;
  const queue: RpgTileRef[] = [from];
  previous.set(key(from), null);
  while (queue.length > 0) {
    const current = queue.shift() as RpgTileRef;
    if (current.tileX === to.tileX && current.tileY === to.tileY) {
      const route: RpgDirection[] = [];
      let node: RpgTileRef = current;
      while (true) {
        const cameFrom = previous.get(key(node));
        if (!cameFrom) break;
        if (cameFrom.tile) {
          route.unshift(cameFrom.dir);
          node = cameFrom.tile;
        } else {
          break;
        }
      }
      return route;
    }
    for (const { dir, dx, dy } of NEIGHBOR_ORDER) {
      const next: RpgTileRef = { tileX: current.tileX + dx, tileY: current.tileY + dy };
      if (!walkable(map, next)) continue;
      if (previous.has(key(next))) continue;
      if (isWarpSource(map, next) && !(next.tileX === to.tileX && next.tileY === to.tileY)) continue;
      previous.set(key(next), { tile: current, dir });
      queue.push(next);
    }
  }
  return null;
}

interface TraceDriver {
  overworld: OverworldState;
  map: RpgMapDefinition;
  tick: number;
  log: string[];
}

function driveRoute(driver: TraceDriver, route: readonly RpgDirection[]): GridArrival[] {
  const arrivals: GridArrival[] = [];
  for (const direction of route) {
    for (let i = 0; i <= STEP_TICKS; i++) {
      const result = advanceGridMovement(driver.overworld, driver.tick, {
        direction,
        confirm: false,
        cancel: false,
        menu: false,
        battleCommand: null,
      }, driver.map, DEFAULT_RPG_CONFIG);
      driver.overworld = result.overworld;
      driver.tick += 1;
      if (result.arrival) {
        arrivals.push(result.arrival);
        driver.log.push(`arrive:${driver.map.id}:${result.overworld.location.tileX},${result.overworld.location.tileY}:${result.arrival.kind}`);
      }
    }
  }
  return arrivals;
}

function runTrace(seed: number) {
  const { maps } = generateRpgWorld(seed);
  const field = maps.find((m) => m.id === STARTER_FIELD_MAP_ID) as RpgMapDefinition;
  const clinic = maps.find((m) => m.id === STARTER_CLINIC_MAP_ID) as RpgMapDefinition;
  const driver: TraceDriver = {
    overworld: createOverworldAtAnchor(field, 'start') as OverworldState,
    map: field,
    tick: 0,
    log: [],
  };

  // 1. Reach the NPC and face it.
  const npc = field.npcs[0];
  expect(npc).toBeDefined();
  let npcRoute: RpgDirection[] | null = null;
  for (const { dx, dy } of NEIGHBOR_ORDER) {
    const neighbor: RpgTileRef = { tileX: npc.tile.tileX + dx, tileY: npc.tile.tileY + dy };
    if (!walkable(field, neighbor)) continue;
    npcRoute = findRoute(field, driver.overworld.location, neighbor);
    if (npcRoute) {
      driveRoute(driver, npcRoute);
      const towardNpc = neighbor.tileX < npc.tile.tileX ? 'right'
        : neighbor.tileX > npc.tile.tileX ? 'left'
        : neighbor.tileY < npc.tile.tileY ? 'down' : 'up';
      const face = advanceGridMovement(driver.overworld, driver.tick, {
        direction: towardNpc as RpgDirection,
        confirm: false,
        cancel: false,
        menu: false,
        battleCommand: null,
      }, field, DEFAULT_RPG_CONFIG);
      driver.overworld = face.overworld;
      driver.tick += 1;
      break;
    }
  }
  expect(npcRoute).not.toBeNull();
  expect(resolveInteraction(field, driver.overworld.location)).toEqual({
    kind: 'npc',
    npcId: npc.id,
    dialogueId: npc.dialogueId,
  });

  // 2. Reach encounter grass.
  const grassTile = field.encounterZones.findIndex((z) => z !== null);
  expect(grassTile).toBeGreaterThanOrEqual(0);
  const grassTarget: RpgTileRef = {
    tileX: grassTile % field.widthTiles,
    tileY: Math.floor(grassTile / field.widthTiles),
  };
  const grassRoute = findRoute(field, driver.overworld.location, grassTarget);
  expect(grassRoute).not.toBeNull();
  const grassArrivals = driveRoute(driver, grassRoute as RpgDirection[]);
  expect(grassArrivals.some((a) => a.kind === 'encounterZone')).toBe(true);

  // 3. Enter the clinic through its door warp.
  const doorWarp = field.warps.find((w) => w.targetMapId === STARTER_CLINIC_MAP_ID);
  expect(doorWarp).toBeDefined();
  const doorRoute = findRoute(field, driver.overworld.location, (doorWarp as NonNullable<typeof doorWarp>).source);
  expect(doorRoute).not.toBeNull();
  const doorArrivals = driveRoute(driver, doorRoute as RpgDirection[]);
  expect(doorArrivals[doorArrivals.length - 1]?.kind).toBe('warp');
  const clinicEntry = createOverworldAtAnchor(clinic, (doorWarp as NonNullable<typeof doorWarp>).targetAnchorId);
  expect(clinicEntry).not.toBeNull();
  driver.overworld = clinicEntry as OverworldState;
  driver.map = clinic;
  driver.log.push(`warp:${STARTER_CLINIC_MAP_ID}`);

  // 4. Step onto the heal mat and fully heal a damaged party fixture.
  const mat = clinic.healPoints[0];
  expect(mat).toBeDefined();
  const matRoute = findRoute(clinic, driver.overworld.location, mat.tile);
  expect(matRoute).not.toBeNull();
  const matArrivals = driveRoute(driver, matRoute as RpgDirection[]);
  expect(matArrivals.some((a) => a.kind === 'heal')).toBe(true);
  const damagedParty = [{
    id: 'trace-creature',
    speciesId: 'trace-species',
    individualSeed: 1,
    level: 4,
    xp: 0,
    currentHp: 1,
    moveIds: [],
  }];
  const species: Record<string, SpeciesDefinition> = {
    'trace-species': {
      id: 'trace-species',
      name: 'Tracer',
      typeId: 'ember',
      baseStats: { hp: 12, attack: 12, defense: 12, speed: 12 },
      catchBasisPoints: 4000,
      expYield: 30,
      learnset: [],
      visual: { generatorVersion: 1, bodyPlan: 'blob', paletteSeed: 1, proportions: {}, features: [] },
    },
  };
  const healed = healPartyFully(damagedParty, species);
  expect(healed[0].currentHp).toBe(12 + 3 * 4);

  // 5. Return through the clinic exit warp.
  const exitWarp = clinic.warps.find((w) => w.targetMapId === STARTER_FIELD_MAP_ID);
  expect(exitWarp).toBeDefined();
  const exitRoute = findRoute(clinic, driver.overworld.location, (exitWarp as NonNullable<typeof exitWarp>).source);
  expect(exitRoute).not.toBeNull();
  const exitArrivals = driveRoute(driver, exitRoute as RpgDirection[]);
  expect(exitArrivals[exitArrivals.length - 1]?.kind).toBe('warp');
  const returned = createOverworldAtAnchor(field, (exitWarp as NonNullable<typeof exitWarp>).targetAnchorId);
  expect(returned).not.toBeNull();
  driver.overworld = returned as OverworldState;
  driver.map = field;
  driver.log.push(`warp:${STARTER_FIELD_MAP_ID}`);

  const hash = fnv1a(canonicalize({ overworld: driver.overworld, log: driver.log }));
  return { overworld: driver.overworld, log: driver.log, hash };
}

describe('overworld scripted trace (milestone 1 exit gate)', () => {
  it('reaches NPC, grass, clinic, and return warp on every tested seed', () => {
    for (const seed of SEED_CORPUS) {
      runTrace(seed);
    }
  });

  it('produces an identical state, log, and hash across repeated runs', () => {
    for (const seed of SEED_CORPUS.slice(0, 6)) {
      const first = runTrace(seed);
      const second = runTrace(seed);
      expect(second.overworld).toEqual(first.overworld);
      expect(second.log).toEqual(first.log);
      expect(second.hash).toBe(first.hash);
    }
  });

  it('yields different traces for different seeds (world layout varies)', () => {
    const hashes = new Set(SEED_CORPUS.slice(0, 8).map((seed) => runTrace(seed).hash));
    expect(hashes.size).toBeGreaterThan(4);
  });
});
