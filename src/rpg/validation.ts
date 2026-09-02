/**
 * Never-throw map validation with path-based diagnostics.
 *
 * `validateRpgMap` checks one map's structural integrity (dimensions, grid
 * lengths, terrain kinds, entity placement); `validateRpgMapCatalog` checks
 * catalog-level consistency (unique map ids, warp cross-references). Paths
 * locate the offending value exactly, e.g. `maps[field].warps[door].targetAnchorId`,
 * so AI-authored content can be debugged from the diagnostic alone.
 */

import type { RpgMapDefinition } from './map';
import type { RpgDiagnostic, RpgTileRef } from './types';

const TERRAIN_KINDS: ReadonlySet<string> = new Set(['ground', 'path', 'grass', 'obstacle']);

function error(code: string, path: string, message: string): RpgDiagnostic {
  return { code, severity: 'error', path, message };
}

function inBounds(map: RpgMapDefinition, tile: RpgTileRef): boolean {
  return tile.tileX >= 0 && tile.tileX < map.widthTiles && tile.tileY >= 0 && tile.tileY < map.heightTiles;
}

function tileIndex(map: RpgMapDefinition, tile: RpgTileRef): number {
  return tile.tileY * map.widthTiles + tile.tileX;
}

/**
 * Validate one map definition. Returns diagnostics; an empty array means the
 * map is structurally sound. Never throws.
 */
export function validateRpgMap(map: RpgMapDefinition): readonly RpgDiagnostic[] {
  const diagnostics: RpgDiagnostic[] = [];
  const push = (code: string, path: string, message: string) => diagnostics.push(error(code, path, message));

  const width = map.widthTiles;
  const height = map.heightTiles;
  if (!Number.isInteger(width) || width <= 0) push('rpg.map.invalidDimensions', 'widthTiles', 'Width must be a positive integer.');
  if (!Number.isInteger(height) || height <= 0) push('rpg.map.invalidDimensions', 'heightTiles', 'Height must be a positive integer.');
  if (!Number.isInteger(map.tileSize) || map.tileSize <= 0) push('rpg.map.invalidTileSize', 'tileSize', 'Tile size must be a positive integer.');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return diagnostics;

  const cellCount = width * height;
  if (map.collision.length !== cellCount) {
    push('rpg.map.gridLength', 'collision', `Collision grid length ${map.collision.length} does not match ${width}×${height} = ${cellCount}.`);
  }
  if (map.encounterZones.length !== cellCount) {
    push('rpg.map.gridLength', 'encounterZones', `Encounter-zone grid length ${map.encounterZones.length} does not match ${cellCount}.`);
  }
  if (map.terrain.length !== cellCount) {
    push('rpg.map.gridLength', 'terrain', `Terrain grid length ${map.terrain.length} does not match ${cellCount}.`);
    return diagnostics;
  }
  map.terrain.forEach((kind, i) => {
    if (!TERRAIN_KINDS.has(kind)) {
      push('rpg.map.terrain', `terrain[${i}]`, `Unknown terrain kind '${String(kind)}'.`);
    }
  });

  const spawnIds = new Set<string>();
  map.spawns.forEach((spawn, i) => {
    if (spawnIds.has(spawn.id)) {
      push('rpg.map.duplicateSpawnId', `spawns[${i}].id`, `Duplicate spawn id '${spawn.id}'.`);
    }
    spawnIds.add(spawn.id);
    if (!inBounds(map, spawn.tile)) {
      push('rpg.map.spawnOutOfBounds', `spawns[${i}].tile`, `Spawn '${spawn.id}' is out of bounds.`);
    } else if (map.collision[tileIndex(map, spawn.tile)]) {
      push('rpg.map.spawnBlocked', `spawns[${i}].tile`, `Spawn '${spawn.id}' stands on a colliding tile.`);
    }
  });

  const npcIds = new Set<string>();
  map.npcs.forEach((npc, i) => {
    if (npcIds.has(npc.id)) {
      push('rpg.map.duplicateNpcId', `npcs[${i}].id`, `Duplicate NPC id '${npc.id}'.`);
    }
    npcIds.add(npc.id);
    if (!inBounds(map, npc.tile)) {
      push('rpg.map.npcOutOfBounds', `npcs[${i}].tile`, `NPC '${npc.id}' is out of bounds.`);
    } else if (map.collision[tileIndex(map, npc.tile)]) {
      push('rpg.map.npcBlocked', `npcs[${i}].tile`, `NPC '${npc.id}' stands on a colliding tile.`);
    }
  });

  const warpIds = new Set<string>();
  map.warps.forEach((warp, i) => {
    if (warpIds.has(warp.id)) {
      push('rpg.map.duplicateWarpId', `warps[${i}].id`, `Duplicate warp id '${warp.id}'.`);
    }
    warpIds.add(warp.id);
    if (!inBounds(map, warp.source)) {
      push('rpg.map.warpSourceOutOfBounds', `warps[${i}].source`, `Warp '${warp.id}' source is out of bounds.`);
    } else if (map.collision[tileIndex(map, warp.source)]) {
      push('rpg.map.warpSourceBlocked', `warps[${i}].source`, `Warp '${warp.id}' source is on a colliding tile.`);
    }
  });

  const healIds = new Set<string>();
  map.healPoints.forEach((heal, i) => {
    if (healIds.has(heal.id)) {
      push('rpg.map.duplicateHealId', `healPoints[${i}].id`, `Duplicate heal-point id '${heal.id}'.`);
    }
    healIds.add(heal.id);
    if (!inBounds(map, heal.tile)) {
      push('rpg.map.healOutOfBounds', `healPoints[${i}].tile`, `Heal point '${heal.id}' is out of bounds.`);
    } else if (map.collision[tileIndex(map, heal.tile)]) {
      push('rpg.map.healBlocked', `healPoints[${i}].tile`, `Heal point '${heal.id}' is on a colliding tile.`);
    }
  });

  return diagnostics;
}

/**
 * Validate a map catalog: unique map ids and resolvable, walkable warp
 * targets. Per-map structure is not repeated — run `validateRpgMap` per map
 * for that. Never throws.
 */
export function validateRpgMapCatalog(maps: readonly RpgMapDefinition[]): readonly RpgDiagnostic[] {
  const diagnostics: RpgDiagnostic[] = [];
  const push = (code: string, path: string, message: string) => diagnostics.push(error(code, path, message));

  const byId = new Map<string, RpgMapDefinition>();
  maps.forEach((map) => {
    if (byId.has(map.id)) {
      push('rpg.catalog.duplicateMapId', `maps[${map.id}]`, `Duplicate map id '${map.id}'.`);
      return;
    }
    byId.set(map.id, map);
  });

  for (const map of maps) {
    map.warps.forEach((warp) => {
      const target = byId.get(warp.targetMapId);
      if (!target) {
        push('rpg.catalog.warpTargetMapMissing', `maps[${map.id}].warps[${warp.id}].targetMapId`, `Warp '${warp.id}' targets unknown map '${warp.targetMapId}'.`);
        return;
      }
      const anchor = target.spawns.find((s) => s.id === warp.targetAnchorId);
      if (!anchor) {
        push('rpg.catalog.warpTargetAnchorMissing', `maps[${map.id}].warps[${warp.id}].targetAnchorId`, `Warp '${warp.id}' targets unknown anchor '${warp.targetAnchorId}' on map '${warp.targetMapId}'.`);
        return;
      }
      if (target.collision[anchor.tile.tileY * target.widthTiles + anchor.tile.tileX]) {
        push('rpg.catalog.warpTargetBlocked', `maps[${map.id}].warps[${warp.id}].targetAnchorId`, `Warp '${warp.id}' lands on a colliding tile.`);
      }
    });
  }

  return diagnostics;
}
