/**
 * Facing-tile interaction and arrival resolution.
 *
 * Pure tile lookups over a map definition: what the player faces (NPC
 * interaction) and what an arrival tile triggers (warp → heal point →
 * encounter zone, the documented priority — only the first applicable
 * transition executes per arrival).
 */

import type { RpgMapDefinition } from './map';
import type {
  RpgEncounterTableId,
  RpgLocation,
  RpgTileRef,
} from './types';

/** Per-direction unit deltas; down is +y in screen space. */
const DIRECTION_DELTA: Readonly<Record<string, Readonly<{ x: number; y: number }>>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** What one arrived-at tile resolves to, by documented priority. */
export type GridArrival =
  | { readonly kind: 'plain' }
  | { readonly kind: 'warp'; readonly warpId: string }
  | { readonly kind: 'heal'; readonly healPointId: string }
  | { readonly kind: 'encounterZone'; readonly encounterTableId: RpgEncounterTableId };

/** Result of a confirm press while exploring. */
export type InteractionResolution =
  | { readonly kind: 'none' }
  | { readonly kind: 'npc'; readonly npcId: string; readonly dialogueId: string };

/** The tile one step ahead of a location in its facing direction. */
export function facingTile(location: RpgLocation): RpgTileRef {
  const delta = DIRECTION_DELTA[location.facing] ?? { x: 0, y: 0 };
  return { tileX: location.tileX + delta.x, tileY: location.tileY + delta.y };
}

/** The NPC occupying a tile, or `null` when none does. */
export function npcAt(map: RpgMapDefinition, tile: RpgTileRef) {
  for (const npc of map.npcs) {
    if (npc.tile.tileX === tile.tileX && npc.tile.tileY === tile.tileY) return npc;
  }
  return null;
}

/**
 * Resolve a confirm press at a location: an NPC standing on the faced tile
 * opens its dialogue; anything else is a no-op.
 */
export function resolveInteraction(
  map: RpgMapDefinition,
  location: RpgLocation,
): InteractionResolution {
  const npc = npcAt(map, facingTile(location));
  return npc ? { kind: 'npc', npcId: npc.id, dialogueId: npc.dialogueId } : { kind: 'none' };
}

/**
 * Resolve an arrival tile by priority: warp first (a warp tile never also
 * heals or triggers an encounter), then heal point, then encounter zone.
 */
export function resolveArrival(map: RpgMapDefinition, tile: RpgTileRef): GridArrival {
  for (const warp of map.warps) {
    if (warp.source.tileX === tile.tileX && warp.source.tileY === tile.tileY) {
      return { kind: 'warp', warpId: warp.id };
    }
  }
  for (const heal of map.healPoints) {
    if (heal.tile.tileX === tile.tileX && heal.tile.tileY === tile.tileY) {
      return { kind: 'heal', healPointId: heal.id };
    }
  }
  if (
    Number.isInteger(map.widthTiles) && map.widthTiles > 0 &&
    Number.isInteger(map.heightTiles) && map.heightTiles > 0 &&
    map.encounterZones.length === map.widthTiles * map.heightTiles
  ) {
    const inBounds =
      tile.tileX >= 0 && tile.tileX < map.widthTiles &&
      tile.tileY >= 0 && tile.tileY < map.heightTiles;
    if (inBounds) {
      const zone = map.encounterZones[tile.tileY * map.widthTiles + tile.tileX];
      if (zone) return { kind: 'encounterZone', encounterTableId: zone };
    }
  }
  return { kind: 'plain' };
}
