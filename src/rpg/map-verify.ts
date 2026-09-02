/**
 * Whole-world BFS verification.
 *
 * Starting from a named spawn anchor, traversal crosses warp tiles into
 * their target maps (NPC-occupied tiles block movement exactly as they do at
 * runtime). Every anchor, warp source, heal point, and NPC approach must be
 * reachable, and every map that has encounter zones needs at least one
 * reachable zone tile. Deterministic: fixed neighbor order, array-based
 * bookkeeping, never throws.
 */

import type { RpgMapDefinition } from './map';
import type { RpgDiagnostic, RpgTileRef } from './types';

const NEIGHBOR_DELTAS: readonly { readonly dx: number; readonly dy: number }[] = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
];

export interface RpgWorldVerificationResult {
  readonly ok: boolean;
  readonly diagnostics: readonly RpgDiagnostic[];
}

function error(code: string, path: string, message: string): RpgDiagnostic {
  return { code, severity: 'error', path, message };
}

interface ReachGraph {
  readonly byId: ReadonlyMap<string, RpgMapDefinition>;
  readonly visited: ReadonlyMap<string, boolean[]>;
}

function tileWalkable(map: RpgMapDefinition, tile: RpgTileRef): boolean {
  if (tile.tileX < 0 || tile.tileX >= map.widthTiles) return false;
  if (tile.tileY < 0 || tile.tileY >= map.heightTiles) return false;
  if (map.collision[tile.tileY * map.widthTiles + tile.tileX]) return false;
  for (const npc of map.npcs) {
    if (npc.tile.tileX === tile.tileX && npc.tile.tileY === tile.tileY) return false;
  }
  return true;
}

function isReached(graph: ReachGraph, mapId: string, tile: RpgTileRef): boolean {
  const visited = graph.visited.get(mapId);
  if (!visited) return false;
  const map = graph.byId.get(mapId);
  if (!map) return false;
  if (tile.tileX < 0 || tile.tileX >= map.widthTiles || tile.tileY < 0 || tile.tileY >= map.heightTiles) return false;
  return visited[tile.tileY * map.widthTiles + tile.tileX] === true;
}

function buildReachGraph(
  maps: readonly RpgMapDefinition[],
  spawnMapId: string,
  spawnTile: RpgTileRef,
): ReachGraph {
  const byId = new Map<string, RpgMapDefinition>();
  for (const map of maps) {
    if (!byId.has(map.id)) byId.set(map.id, map);
  }
  const visited = new Map<string, boolean[]>();
  for (const [id, map] of byId) {
    visited.set(id, new Array<boolean>(map.widthTiles * map.heightTiles).fill(false));
  }

  const queue: { mapId: string; tile: RpgTileRef }[] = [];
  const enqueue = (mapId: string, tile: RpgTileRef) => {
    const map = byId.get(mapId);
    if (!map) return;
    if (!tileWalkable(map, tile)) return;
    const seen = visited.get(mapId);
    if (!seen || seen[tile.tileY * map.widthTiles + tile.tileX]) return;
    seen[tile.tileY * map.widthTiles + tile.tileX] = true;
    queue.push({ mapId, tile });
  };

  enqueue(spawnMapId, spawnTile);
  while (queue.length > 0) {
    const { mapId, tile } = queue.shift() as { mapId: string; tile: RpgTileRef };
    const map = byId.get(mapId);
    if (!map) continue;
    for (const warp of map.warps) {
      if (warp.source.tileX === tile.tileX && warp.source.tileY === tile.tileY) {
        const target = byId.get(warp.targetMapId);
        const anchor = target?.spawns.find((s) => s.id === warp.targetAnchorId);
        if (target && anchor) enqueue(target.id, anchor.tile);
      }
    }
    for (const { dx, dy } of NEIGHBOR_DELTAS) {
      enqueue(mapId, { tileX: tile.tileX + dx, tileY: tile.tileY + dy });
    }
  }

  return { byId, visited };
}

/**
 * Verify that a world of maps is fully playable from its spawn anchor.
 * Returns `{ ok, diagnostics }`; never throws.
 */
export function verifyRpgWorld(
  maps: readonly RpgMapDefinition[],
  spawnMapId: string,
  spawnAnchorId: string,
): RpgWorldVerificationResult {
  const diagnostics: RpgDiagnostic[] = [];
  const push = (code: string, path: string, message: string) => diagnostics.push(error(code, path, message));

  const spawnMap = maps.find((m) => m.id === spawnMapId);
  if (!spawnMap) {
    push('rpg.world.spawnMapMissing', `maps[${spawnMapId}]`, `Spawn map '${spawnMapId}' does not exist.`);
    return { ok: false, diagnostics };
  }
  const spawnAnchor = spawnMap.spawns.find((s) => s.id === spawnAnchorId);
  if (!spawnAnchor) {
    push('rpg.world.spawnMissing', `maps[${spawnMapId}].spawns[${spawnAnchorId}]`, `Spawn anchor '${spawnAnchorId}' does not exist.`);
    return { ok: false, diagnostics };
  }

  const graph = buildReachGraph(maps, spawnMapId, spawnAnchor.tile);

  for (const map of maps) {
    for (const spawn of map.spawns) {
      if (map.collision[spawn.tile.tileY * map.widthTiles + spawn.tile.tileX]) {
        push('rpg.world.anchorBlocked', `maps[${map.id}].spawns[${spawn.id}]`, `Anchor '${spawn.id}' stands on a colliding tile.`);
      } else if (!isReached(graph, map.id, spawn.tile)) {
        push('rpg.world.anchorUnreachable', `maps[${map.id}].spawns[${spawn.id}]`, `Anchor '${spawn.id}' cannot be reached from the spawn.`);
      }
    }
    for (const warp of map.warps) {
      if (!isReached(graph, map.id, warp.source)) {
        push('rpg.world.warpUnreachable', `maps[${map.id}].warps[${warp.id}]`, `Warp '${warp.id}' source cannot be reached.`);
      }
      const target = graph.byId.get(warp.targetMapId);
      const anchor = target?.spawns.find((s) => s.id === warp.targetAnchorId);
      if (!target || !anchor) {
        push('rpg.world.warpTargetMissing', `maps[${map.id}].warps[${warp.id}]`, `Warp '${warp.id}' target does not resolve.`);
      }
    }
    for (const heal of map.healPoints) {
      if (!isReached(graph, map.id, heal.tile)) {
        push('rpg.world.healUnreachable', `maps[${map.id}].healPoints[${heal.id}]`, `Heal point '${heal.id}' cannot be reached.`);
      }
    }
    for (const npc of map.npcs) {
      const approachable = NEIGHBOR_DELTAS.some(({ dx, dy }) => {
        const neighbor: RpgTileRef = { tileX: npc.tile.tileX + dx, tileY: npc.tile.tileY + dy };
        return tileWalkable(map, neighbor) && isReached(graph, map.id, neighbor);
      });
      if (!approachable) {
        push('rpg.world.npcUnreachable', `maps[${map.id}].npcs[${npc.id}]`, `No reachable tile can face NPC '${npc.id}'.`);
      }
    }
    const hasZones = map.encounterZones.some((zone) => zone != null);
    if (hasZones) {
      const zoneReached = map.encounterZones.some((zone, i) => {
        if (zone == null) return false;
        const visited = graph.visited.get(map.id);
        return visited != null && visited[i] === true;
      });
      if (!zoneReached) {
        push('rpg.world.encounterZoneUnreachable', `maps[${map.id}].encounterZones`, 'No encounter-zone tile can be reached.');
      }
    }
  }

  const hasErrors = diagnostics.some((d) => d.severity === 'error');
  return { ok: !hasErrors, diagnostics };
}
