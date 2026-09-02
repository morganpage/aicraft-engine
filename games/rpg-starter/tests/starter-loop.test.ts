import { describe, it, expect } from 'vitest';
import {
  createMemorySaveStorage,
  createRpgSave,
  rpgSaveHash,
  writeSave,
  canonicalize,
  fnv1a,
  DEFAULT_RPG_CONFIG,
  STARTER_FIELD_MAP_ID,
  STARTER_CLINIC_MAP_ID,
  type RpgDirection,
  type RpgState,
} from 'aicraft-engine';
import { createStarterGame } from '../src/game';

/**
 * Milestone 5 exit gate, at the wiring level: the starter completes the
 * full loop — explore → talk → encounter → fight → catch/level → heal →
 * save → reload — twice, and a reload continues from the same tile with an
 * identical save hash. The browser runs this same `createStarterGame`
 * object; only the DOM differs.
 */

const NEIGHBORS: readonly { dir: RpgDirection; dx: number; dy: number }[] = [
  { dir: 'up', dx: 0, dy: -1 },
  { dir: 'down', dx: 0, dy: 1 },
  { dir: 'left', dx: -1, dy: 0 },
  { dir: 'right', dx: 1, dy: 0 },
];

interface RouteDriver {
  game: ReturnType<typeof createStarterGame>;
  ticks: number;
}

function playerTile(state: RpgState) {
  const activity = state.activity;
  const location = activity.kind === 'overworld' ? activity.overworld.location : activity.returnTo.location;
  return { tileX: location.tileX, tileY: location.tileY };
}

function currentMapId(state: RpgState): string {
  const activity = state.activity;
  return (activity.kind === 'overworld' ? activity.overworld.location : activity.returnTo.location).mapId;
}

function walkable(game: ReturnType<typeof createStarterGame>, mapId: string, tile: { tileX: number; tileY: number }): boolean {
  const map = game.content.maps[mapId];
  if (!map) return false;
  if (tile.tileX < 0 || tile.tileX >= map.widthTiles || tile.tileY < 0 || tile.tileY >= map.heightTiles) return false;
  if (map.collision[tile.tileY * map.widthTiles + tile.tileX]) return false;
  return !map.npcs.some((npc) => npc.tile.tileX === tile.tileX && npc.tile.tileY === tile.tileY);
}

function isWarp(game: ReturnType<typeof createStarterGame>, mapId: string, tile: { tileX: number; tileY: number }): boolean {
  const map = game.content.maps[mapId];
  return Boolean(map?.warps.some((w) => w.source.tileX === tile.tileX && w.source.tileY === tile.tileY));
}

function findRoute(
  game: ReturnType<typeof createStarterGame>,
  mapId: string,
  from: { tileX: number; tileY: number },
  to: { tileX: number; tileY: number },
): RpgDirection[] | null {
  const map = game.content.maps[mapId];
  if (!map) return null;
  const key = (t: { tileX: number; tileY: number }) => t.tileY * map.widthTiles + t.tileX;
  const previous = new Map<number, { tile: { tileX: number; tileY: number }; dir: RpgDirection } | null>();
  const queue = [{ ...from }];
  previous.set(key(from), null);
  while (queue.length > 0) {
    const current = queue.shift()!;
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
      if (!walkable(game, mapId, next) || previous.has(key(next))) continue;
      if (isWarp(game, mapId, next) && !(next.tileX === to.tileX && next.tileY === to.tileY)) continue;
      previous.set(key(next), { tile: current, dir });
      queue.push(next);
    }
  }
  return null;
}

function driveRoute(driver: RouteDriver, route: readonly RpgDirection[], stopAtBattle: boolean): void {
  for (const direction of route) {
    for (let i = 0; i <= DEFAULT_RPG_CONFIG.stepDurationTicks; i++) {
      driver.game.pressKey(`Arrow${direction[0].toUpperCase()}${direction.slice(1)}`);
      driver.game.tick(driver.game.sampleInput());
      driver.ticks += 1;
      if (stopAtBattle && driver.game.getState().activity.kind === 'battle') return;
      // Let transitions complete so movement can continue.
      let guard = 0;
      while (driver.game.getState().activity.kind === 'transition' && guard < 40) {
        driver.game.tick(driver.game.sampleInput());
        driver.ticks += 1;
        guard += 1;
      }
    }
  }
}

function settle(driver: RouteDriver): void {
  for (let i = 0; i < 12; i++) {
    const state = driver.game.getState();
    if (state.activity.kind === 'overworld' && state.activity.overworld.step === null) return;
    driver.game.tick(driver.game.sampleInput());
    driver.ticks += 1;
  }
}

function grindToBattle(driver: RouteDriver): void {
  const mapId = currentMapId(driver.game.getState());
  const map = driver.game.content.maps[mapId];
  const zoneIndex = map.encounterZones.findIndex((z) => z !== null);
  expect(zoneIndex).toBeGreaterThanOrEqual(0);
  const grass = { tileX: zoneIndex % map.widthTiles, tileY: Math.floor(zoneIndex / map.widthTiles) };
  for (let round = 0; round < 40; round++) {
    const route = findRoute(driver.game, mapId, playerTile(driver.game.getState()), grass);
    driveRoute(driver, route ?? [], true);
    if (driver.game.getState().activity.kind === 'battle') return;
    // Step off and back onto grass to re-roll the trigger.
    const off = NEIGHBORS.map(({ dx, dy }) => ({ tileX: grass.tileX + dx, tileY: grass.tileY + dy }))
      .find((tile) => walkable(driver.game, mapId, tile));
    if (off) {
      driveRoute(driver, findRoute(driver.game, mapId, playerTile(driver.game.getState()), off) ?? [], true);
      if (driver.game.getState().activity.kind === 'battle') return;
    }
  }
  throw new Error('encounter never triggered');
}

function fightOneBattle(driver: RouteDriver, mode: 'fight' | 'catch'): string {
  grindToBattle(driver);
  let outcome = 'running';
  for (let turns = 0; turns < 300; turns++) {
    if (driver.game.getState().activity.kind !== 'battle') break;
    const commands = driver.game.battleCommands();
    if (commands.length === 0) break;
    const pick = mode === 'catch'
      ? commands.find((c) => c.type === 'catch') ?? commands.find((c) => c.type === 'fight')!
      : commands.find((c) => c.type === 'fight')!;
    const events = driver.game.tick({
      direction: null,
      confirm: false,
      cancel: false,
      menu: false,
      battleCommand: pick,
    });
    driver.ticks += 1;
    const ended = events.find((event) => event.type === 'battleEnded');
    if (ended && ended.type === 'battleEnded') outcome = ended.outcome;
    if (driver.game.getState().activity.kind !== 'battle') break;
  }
  settle(driver);
  return outcome;
}

function exitClinic(driver: RouteDriver): void {
  if (currentMapId(driver.game.getState()) !== STARTER_CLINIC_MAP_ID) return;
  const clinic = driver.game.content.maps[STARTER_CLINIC_MAP_ID];
  const exit = clinic.warps.find((w) => w.targetMapId === STARTER_FIELD_MAP_ID)!;
  driveRoute(driver, findRoute(driver.game, STARTER_CLINIC_MAP_ID, playerTile(driver.game.getState()), exit.source) ?? [], true);
  let guard = 0;
  while (driver.game.getState().activity.kind === 'transition' && guard < 40) {
    driver.game.tick(driver.game.sampleInput());
    driver.ticks += 1;
    guard += 1;
  }
  settle(driver);
}

function enterClinicAndHeal(driver: RouteDriver): void {
  const field = driver.game.content.maps[STARTER_FIELD_MAP_ID];
  const door = field.warps.find((w) => w.targetMapId === STARTER_CLINIC_MAP_ID)!;
  driveRoute(driver, findRoute(driver.game, STARTER_FIELD_MAP_ID, playerTile(driver.game.getState()), door.source) ?? [], true);
  let guard = 0;
  while (driver.game.getState().activity.kind === 'transition' && guard < 40) {
    driver.game.tick(driver.game.sampleInput());
    driver.ticks += 1;
    guard += 1;
  }
  expect(currentMapId(driver.game.getState())).toBe(STARTER_CLINIC_MAP_ID);
  const clinic = driver.game.content.maps[STARTER_CLINIC_MAP_ID];
  driveRoute(driver, findRoute(driver.game, STARTER_CLINIC_MAP_ID, playerTile(driver.game.getState()), clinic.healPoints[0].tile) ?? [], true);
  settle(driver);
}

describe('starter full loop', () => {
  it('completes explore → encounter → battle → heal → save → reload, twice, identically', () => {
    const runLoop = () => {
      const storage = createMemorySaveStorage();
      const game = createStarterGame({ storage, audio: null });
      const driver: RouteDriver = { game, ticks: 0 };

      // 1. Explore + first battle (fight).
      fightOneBattle(driver, 'fight');
      // 2. A second battle attempting capture (may fail into fights — fine).
      fightOneBattle(driver, 'catch');
      // 3. Heal at the clinic.
      enterClinicAndHeal(driver);
      const healed = game.getState();
      expect(healed.party.every((m) => m.currentHp > 0)).toBe(true);
      expect(healed.party.some((m) => m.xp > 0)).toBe(true);

      // 4. Save, then reload into a fresh game object sharing storage.
      expect(game.save()).toBe(true);
      expect(game.hasSave()).toBe(true);
      const resumedGame = createStarterGame({ storage, audio: null });
      expect(resumedGame.load()).toBe(true);
      const resumed = resumedGame.getState();
      expect(resumed.tick).toBe(healed.tick);
      expect(currentMapId(resumed)).toBe(currentMapId(healed));
      expect(playerTile(resumed)).toEqual(playerTile(healed));
      expect(rpgSaveHash(createRpgSave(resumed).save!)).toBe(rpgSaveHash(createRpgSave(healed).save!));

      // 5. Continue on the resumed session and re-verify the loop machinery.
      const resumedDriver: RouteDriver = { game: resumedGame, ticks: driver.ticks };
      exitClinic(resumedDriver);
      fightOneBattle(resumedDriver, 'fight');

      return {
        finalHash: fnv1a(canonicalize(resumedGame.getState())),
        partyXp: resumedGame.getState().party[0].xp,
        saveHash: rpgSaveHash(createRpgSave(resumedGame.getState()).save!),
      };
    };

    const first = runLoop();
    const second = runLoop();
    expect(second.finalHash).toBe(first.finalHash);
    expect(second.saveHash).toBe(first.saveHash);
    expect(first.partyXp).toBeGreaterThan(0);
  });

  it('talking to the NPC grants the flag and items through the UI wiring', () => {
    const game = createStarterGame({ audio: null });
    const field = game.content.maps[STARTER_FIELD_MAP_ID];
    const npc = field.npcs[0];
    const OPPOSITE: Record<RpgDirection, RpgDirection> = { up: 'down', down: 'up', left: 'right', right: 'left' };
    let facing: RpgDirection = 'down';
    let target = { tileX: npc.tile.tileX, tileY: npc.tile.tileY + 1 };
    for (const { dir, dx, dy } of NEIGHBORS) {
      const candidate = { tileX: npc.tile.tileX + dx, tileY: npc.tile.tileY + dy };
      if (walkable(game, STARTER_FIELD_MAP_ID, candidate)) {
        target = candidate;
        facing = OPPOSITE[dir];
        break;
      }
    }
    const route = findRoute(game, STARTER_FIELD_MAP_ID, playerTile(game.getState()), target);
    expect(route).not.toBeNull();
    const driver: RouteDriver = { game, ticks: 0 };
    driveRoute(driver, route!, false);
    settle(driver);
    // Face + confirm → dialogue; advance through it.
    game.pressKey(`Arrow${facing[0].toUpperCase()}${facing.slice(1)}`);
    game.tick(game.sampleInput());
    game.pressKey('Enter');
    game.tick(game.sampleInput());
    expect(game.getState().activity.kind).toBe('dialogue');
    for (let i = 0; i < 5; i++) {
      game.pressKey('Enter');
      game.tick(game.sampleInput());
      if (game.getState().activity.kind === 'overworld') break;
    }
    expect(game.getState().activity.kind).toBe('overworld');
    expect(game.getState().flags['metGuide']).toBe(true);
    expect(game.getState().inventory.find((e) => e.itemId === 'capture-orb')?.quantity).toBe(5);
  });

  it('save flows through the storage adapter end to end', () => {
    const storage = createMemorySaveStorage();
    const game = createStarterGame({ storage, audio: null });
    const driver: RouteDriver = { game, ticks: 0 };
    driveRoute(driver, findRoute(game, STARTER_FIELD_MAP_ID, playerTile(game.getState()), { tileX: 5, tileY: 5 }) ?? [], true);
    settle(driver);
    expect(game.save()).toBe(true);
    const reloaded = createStarterGame({ storage, audio: null });
    expect(reloaded.load()).toBe(true);
    // A future-versioned blob is refused, proving the migration guard runs
    // in the starter's load path too.
    writeSave(storage, { schemaVersion: 99 });
    expect(createStarterGame({ storage, audio: null }).load()).toBe(false);
  });
});
