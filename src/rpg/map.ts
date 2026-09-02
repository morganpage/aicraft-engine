/**
 * Top-down RPG map definitions.
 *
 * `RpgMapDefinition` is independent of the platformer `LevelData` union: flat
 * integer grids, tile-anchored entities, no physics fields. The collision
 * grid is authoritative for movement; terrain kinds are routing and render
 * hints.
 */

import type {
  RpgAnchorId,
  RpgDialogueId,
  RpgDirection,
  RpgEncounterTableId,
  RpgMapId,
  RpgTileRef,
} from './types';

/**
 * Terrain routing/render kinds. `grass` marks encounter-capable ground (an
 * encounter-zone id on the same tile makes it actually trigger); `obstacle`
 * is decorative blocking matter that must also appear in the collision grid.
 */
export type RpgTerrainKind = 'ground' | 'path' | 'grass' | 'obstacle';

/** One map in the content catalog. */
export interface RpgMapDefinition {
  readonly schemaVersion: 1;
  readonly id: RpgMapId;
  readonly name: string;
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly tileSize: number;
  /** Row-major terrain kinds, length `widthTiles * heightTiles`. */
  readonly terrain: readonly RpgTerrainKind[];
  /** Row-major collision flags (`true` = blocked), same length as terrain. */
  readonly collision: readonly boolean[];
  /** Row-major encounter-zone assignment per tile, or `null` outside grass. */
  readonly encounterZones: readonly (RpgEncounterTableId | null)[];
  /** Stable named spawn anchors targeted by starts and warps. */
  readonly spawns: readonly RpgSpawnAnchor[];
  /** Blocking NPCs; their tiles are impassable while the NPC stands there. */
  readonly npcs: readonly RpgNpcDefinition[];
  /** Tile warps to another map (or another anchor of the same map). */
  readonly warps: readonly RpgWarpDefinition[];
  /** Tiles that fully heal the party and update the heal anchor on arrival. */
  readonly healPoints: readonly RpgHealPointDefinition[];
  /** Optional procedural render theme/palette id consumed by the renderer. */
  readonly themeId?: string;
}

/** A named spawn position with facing. */
export interface RpgSpawnAnchor {
  readonly id: RpgAnchorId;
  readonly tile: RpgTileRef;
  readonly facing: RpgDirection;
}

/** A standing NPC the player can face and interact with. */
export interface RpgNpcDefinition {
  readonly id: string;
  readonly name: string;
  readonly tile: RpgTileRef;
  readonly facing: RpgDirection;
  readonly dialogueId: RpgDialogueId;
  /** Optional stable seed for deterministic portrait/appearance rendering. */
  readonly visualSeed?: number;
}

/** A one-way tile warp. Source tile is the arrival tile that triggers it. */
export interface RpgWarpDefinition {
  readonly id: string;
  readonly source: RpgTileRef;
  readonly targetMapId: RpgMapId;
  readonly targetAnchorId: RpgAnchorId;
  readonly targetFacing: RpgDirection;
}

/** A healing station tile (clinic mat, shrine, rest point). */
export interface RpgHealPointDefinition {
  readonly id: string;
  readonly tile: RpgTileRef;
}
