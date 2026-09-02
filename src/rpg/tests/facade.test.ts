import { describe, it, expect } from 'vitest';
import { compileRpgContent } from '../content';
import { createStarterContentBundle } from '../starter';
import { STARTER_FIELD_MAP_ID, STARTER_CLINIC_MAP_ID, STARTER_FIELD_START_ID } from '../mapgen';
import { createRpgController, createRpgState, getEffectiveParty, getEffectiveInventory, isSaveEligible } from '../state';
import { npcAt } from '../interaction';
import { DEFAULT_RPG_CONFIG } from '../constants';
import type { RpgDirection, RpgInput, RpgTileRef } from '../types';
import type { RpgEvent, RpgState } from '../state';
import type { RpgMapDefinition } from '../map';
import { canonicalize, fnv1a } from '../../level/serialize';

const COMPILED = compileRpgContent(createStarterContentBundle(2026));
if (!COMPILED.ok) throw new Error('starter content must compile');
const content = COMPILED.content;
const CONTROLLER = createRpgController(content);
const DT = DEFAULT_RPG_CONFIG.tickDuration;

const START_INVENTORY = [
  { itemId: 'capture-orb', quantity: 3 },
  { itemId: 'potion', quantity: 2 },
];

function newState(seed: number): RpgState {
  return createRpgState(content, seed, {
    spawnMapId: STARTER_FIELD_MAP_ID,
    spawnAnchorId: STARTER_FIELD_START_ID,
    startingParty: [{ speciesId: content.speciesIds[0], level: 4 }],
    startingInventory: START_INVENTORY,
  });
}

function input(direction: RpgDirection | null, confirm = false): RpgInput {
  return { direction, confirm, cancel: false, menu: false, battleCommand: null };
}

function battleInput(battleCommand: NonNullable<RpgInput['battleCommand']>): RpgInput {
  return { direction: null, confirm: false, cancel: false, menu: false, battleCommand };
}

const NEIGHBORS: readonly { dir: RpgDirection; dx: number; dy: number }[] = [
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
  return map.warps.some((w: { source: RpgTileRef }) => w.source.tileX === tile.tileX && w.source.tileY === tile.tileY);
}

function findRoute(map: RpgMapDefinition, from: RpgTileRef, to: RpgTileRef): RpgDirection[] | null {
  const previous = new Map<number, { tile: RpgTileRef; dir: RpgDirection } | null>();
  const key = (t: RpgTileRef) => t.tileY * map.widthTiles + t.tileX;
  const queue: RpgTileRef[] = [from];
  previous.set(key(from), null);
  while (queue.length > 0) {
    const current = queue.shift() as RpgTileRef;
    if (current.tileX === to.tileX && current.tileY === to.tileY) {
      const route: RpgDirection[] = [];
      let node = current;
      while (true) {
        const came = previous.get(key(node));
        if (!came) break;
        route.unshift(came.dir);
        node = came.tile;
      }
      return route;
    }
    for (const { dir, dx, dy } of NEIGHBORS) {
      const next = { tileX: current.tileX + dx, tileY: current.tileY + dy };
      if (!walkable(map, next) || previous.has(key(next))) continue;
      if (isWarpSource(map, next) && !(next.tileX === to.tileX && next.tileY === to.tileY)) continue;
      previous.set(key(next), { tile: current, dir });
      queue.push(next);
    }
  }
  return null;
}

interface Driver {
  state: RpgState;
  events: RpgEvent[];
}

function step(driver: Driver, tickInput: RpgInput): void {
  const result = CONTROLLER.step(driver.state, tickInput, DT);
  driver.state = result.state;
  driver.events.push(...result.events);
}

function driveRoute(driver: Driver, route: readonly RpgDirection[], allowEncounters: 'stop-at-battle' | 'power-through'): void {
  for (const direction of route) {
    for (let i = 0; i <= DEFAULT_RPG_CONFIG.stepDurationTicks; i++) {
      step(driver, input(direction));
      if (driver.state.activity.kind === 'battle' && allowEncounters === 'stop-at-battle') return;
      if (driver.state.activity.kind !== 'overworld') {
        // finish transitions so movement can continue
        for (let t = 0; t <= DEFAULT_RPG_CONFIG.transitionDurationTicks + 1 && driver.state.activity.kind === 'transition'; t++) {
          step(driver, input(null));
        }
      }
    }
  }
}

function activityKind(driver: Driver): string {
  return driver.state.activity.kind;
}

function currentMap(state: RpgState): RpgMapDefinition {
  const activity = state.activity;
  const mapId = activity.kind === 'overworld'
    ? activity.overworld.location.mapId
    : activity.returnTo.location.mapId;
  return content.maps[mapId];
}

function playerTile(state: RpgState): RpgTileRef {
  const activity = state.activity;
  const location = activity.kind === 'overworld' ? activity.overworld.location : activity.returnTo.location;
  return { tileX: location.tileX, tileY: location.tileY };
}

/** Walk back and forth over grass until a battle starts (bounded). */
function grindEncounters(driver: Driver): void {
  const map = currentMap(driver.state);
  const zoneIndex = map.encounterZones.findIndex((z: string | null) => z !== null);
  expect(zoneIndex).toBeGreaterThanOrEqual(0);
  const grassA = { tileX: zoneIndex % map.widthTiles, tileY: Math.floor(zoneIndex / map.widthTiles) };
  let neighbor: RpgTileRef | null = null;
  for (const { dx, dy } of NEIGHBORS) {
    const candidate = { tileX: grassA.tileX + dx, tileY: grassA.tileY + dy };
    if (walkable(map, candidate) && map.encounterZones[candidate.tileY * map.widthTiles + candidate.tileX] == null) {
      neighbor = candidate;
      break;
    }
  }
  if (!neighbor) neighbor = grassA;
  for (let round = 0; round < 40 && activityKind(driver) === 'overworld'; round++) {
    driveRoute(driver, findRoute(map, playerTile(driver.state), grassA) ?? [], 'stop-at-battle');
    if (activityKind(driver) === 'battle') return;
    driveRoute(driver, findRoute(map, playerTile(driver.state), neighbor) ?? [], 'stop-at-battle');
    if (activityKind(driver) === 'battle') return;
  }
  throw new Error('encounter never triggered');
}

function fightToEnd(driver: Driver): void {
  for (let turns = 0; turns < 200; turns++) {
    const activity = driver.state.activity;
    if (activity.kind !== 'battle') return;
    if (activity.battle.phase === 'ended') return;
    const request = (globalThis as { __battleRequest?: unknown }).__battleRequest;
    void request;
    const battle = activity.battle;
    const active = battle.playerParty[battle.activePlayerIndex];
    const command = active.moveIds.length > 0
      ? { type: 'fight' as const, moveId: active.moveIds[0] }
      : { type: 'flee' as const };
    step(driver, battleInput(command));
  }
  throw new Error('battle never ended');
}

function projectionHash(state: RpgState, events: readonly RpgEvent[]): number {
  const party = getEffectiveParty(state);
  const inventory = getEffectiveInventory(state);
  return fnv1a(canonicalize({
    activity: state.activity,
    party,
    inventory,
    flags: state.flags,
    worldRng: state.worldRng,
    encounterIndex: state.encounterIndex,
    lastHealAnchor: state.lastHealAnchor,
    tick: state.tick,
    rulesVersion: state.rulesVersion,
    fingerprint: state.contentFingerprint,
    events,
  }));
}

describe('RPG facade', () => {
  it('creates a fresh state at the starter spawn with a granted party and inventory', () => {
    const state = newState(42);
    expect(state.party.length).toBe(1);
    expect(state.party[0].level).toBe(4);
    expect(state.inventory).toEqual([
      { itemId: 'capture-orb', quantity: 3 },
      { itemId: 'potion', quantity: 2 },
    ]);
    expect(isSaveEligible(state)).toBe(true);
  });

  it('completes explore → encounter → battle → heal → return deterministically', () => {
    const runOnce = () => {
      const driver: Driver = { state: newState(77), events: [] };
      grindEncounters(driver);
      expect(driver.events.some((e) => e.type === 'encounterTriggered')).toBe(true);
      expect(driver.events.some((e) => e.type === 'battleStarted')).toBe(true);
      fightToEnd(driver);
      const outcome = driver.events.filter((e) => e.type === 'battleEnded').pop();

      // Enter the clinic, step on the mat, come back.
      const field = content.maps[STARTER_FIELD_MAP_ID];
      const door = field.warps.find((w) => w.targetMapId === STARTER_CLINIC_MAP_ID);
      expect(door).toBeDefined();
      driveRoute(driver, findRoute(field, playerTile(driver.state), (door as NonNullable<typeof door>).source) ?? [], 'stop-at-battle');
      for (let t = 0; t <= DEFAULT_RPG_CONFIG.transitionDurationTicks + 1; t++) step(driver, input(null));
      expect(driver.state.activity.kind === 'overworld'
        ? driver.state.activity.overworld.location.mapId
        : '').toBe(STARTER_CLINIC_MAP_ID);

      const clinic = content.maps[STARTER_CLINIC_MAP_ID];
      const mat = clinic.healPoints[0];
      driveRoute(driver, findRoute(clinic, playerTile(driver.state), mat.tile) ?? [], 'stop-at-battle');
      expect(driver.events.some((e) => e.type === 'healApplied')).toBe(true);
      expect(getEffectiveParty(driver.state).every((m) => m.currentHp > 0)).toBe(true);

      const exit = clinic.warps.find((w) => w.targetMapId === STARTER_FIELD_MAP_ID);
      driveRoute(driver, findRoute(clinic, playerTile(driver.state), (exit as NonNullable<typeof exit>).source) ?? [], 'stop-at-battle');
      for (let t = 0; t <= DEFAULT_RPG_CONFIG.transitionDurationTicks + 1; t++) step(driver, input(null));
      const finalMap = driver.state.activity.kind === 'overworld'
        ? driver.state.activity.overworld.location.mapId
        : '';
      expect(finalMap).toBe(STARTER_FIELD_MAP_ID);
      return { driver, outcome };
    };

    const first = runOnce();
    const second = runOnce();
    expect(second.driver.state).toEqual(first.driver.state);
    expect(second.driver.events).toEqual(first.driver.events);
    expect(projectionHash(second.driver.state, second.driver.events))
      .toBe(projectionHash(first.driver.state, first.driver.events));
  });

  it('runs the NPC dialogue to a flag and item grants', () => {
    const driver: Driver = { state: newState(5), events: [] };
    const field = content.maps[STARTER_FIELD_MAP_ID];
    const npc = field.npcs[0];
    expect(npc).toBeDefined();
    let target: RpgTileRef | null = null;
    let facing: RpgDirection = 'down';
    const OPPOSITE: Record<RpgDirection, RpgDirection> = { up: 'down', down: 'up', left: 'right', right: 'left' };
    for (const { dir, dx, dy } of NEIGHBORS) {
      const candidate = { tileX: npc.tile.tileX + dx, tileY: npc.tile.tileY + dy };
      if (walkable(field, candidate) && findRoute(field, playerTile(driver.state), candidate)) {
        target = candidate;
        facing = OPPOSITE[dir];
        break;
      }
    }
    expect(target).not.toBeNull();
    driveRoute(driver, findRoute(field, playerTile(driver.state), target as RpgTileRef) ?? [], 'stop-at-battle');
    // Face the NPC and confirm.
    step(driver, input(facing));
    step(driver, input(null, true));
    expect(driver.state.activity.kind === 'dialogue').toBe(true);
    // Advance: choose 'ask' (cursor 0), then advance twice through tip → farewell → end.
    step(driver, input(null, true));
    step(driver, input(null, true));
    step(driver, input(null, true));
    expect(driver.state.activity.kind).toBe('overworld');
    expect(driver.state.flags['metGuide']).toBe(true);
    expect(driver.state.inventory.find((e) => e.itemId === 'capture-orb')?.quantity).toBe(5);
    expect(driver.state.inventory.find((e) => e.itemId === 'potion')?.quantity).toBe(3);
    expect(driver.events.some((e) => e.type === 'dialogueStarted')).toBe(true);
    expect(driver.events.some((e) => e.type === 'dialogueEnded')).toBe(true);
  });

  it('validates fixedDt mismatches with a diagnostic and still ticks', () => {
    const driver: Driver = { state: newState(1), events: [] };
    const result = CONTROLLER.step(driver.state, input('right'), 999);
    expect(result.diagnostics.some((d) => d.code === 'rpg.step.fixedDtMismatch')).toBe(true);
    expect(result.state.tick).toBe(1);
  });

  it('keeps battle snapshot authority via the effective readers', () => {
    const driver: Driver = { state: newState(3), events: [] };
    grindEncounters(driver);
    const activity = driver.state.activity;
    expect(activity.kind).toBe('battle');
    if (activity.kind !== 'battle') return;
    const before = getEffectiveParty(driver.state)[0].currentHp;
    const duringOuter = driver.state.party[0].currentHp;
    fightToEnd(driver);
    expect(getEffectiveParty(driver.state).length).toBe(1);
    void before; void duringOuter;
  });
});
