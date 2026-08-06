/** Persistence boundary for the showcase tile-room level editor. */

import { canonicalize, validateLevel } from '../../src/level';
import type { GeneratedTileSemantics, LevelData } from '../../src/level';
import type { TileRoomScene } from './tile-room-fixtures';

export const TILE_ROOM_LEVEL_FILE_FORMAT = 'aicraft-showcase-level';
export const TILE_ROOM_LEVEL_FILE_VERSION = 1;

interface TileRoomLevelFile {
  readonly format: typeof TILE_ROOM_LEVEL_FILE_FORMAT;
  readonly version: typeof TILE_ROOM_LEVEL_FILE_VERSION;
  readonly scene: TileRoomScene;
}

export type TileRoomLevelParseResult =
  | { readonly ok: true; readonly scene: TileRoomScene }
  | { readonly ok: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integerList(value: unknown): readonly number[] | null {
  if (!Array.isArray(value) || value.some((entry) => !Number.isInteger(entry))) return null;
  return [...new Set(value as number[])];
}

function readSemantics(value: unknown, fallback: Readonly<GeneratedTileSemantics>): GeneratedTileSemantics {
  if (!isRecord(value)) return { solid: [...fallback.solid], passthrough: [...fallback.passthrough] };
  return {
    solid: integerList(value.solid) ?? [...fallback.solid],
    passthrough: integerList(value.passthrough) ?? [...fallback.passthrough],
  };
}

/** Stable dirty-check token for level data and its tile collision semantics. */
export function hashTileRoomScene(scene: Readonly<TileRoomScene>): string {
  return canonicalize({ level: scene.level, tileSemantics: scene.tileSemantics });
}

/** Human-readable JSON suitable for local saves, source control, or shipping. */
export function serializeTileRoomScene(scene: Readonly<TileRoomScene>): string {
  const file: TileRoomLevelFile = {
    format: TILE_ROOM_LEVEL_FILE_FORMAT,
    version: TILE_ROOM_LEVEL_FILE_VERSION,
    scene: scene as TileRoomScene,
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Parse either a showcase level file or a raw engine `LevelData` JSON file.
 * The active scene id is retained so importing cannot break the scene tabs.
 */
export function parseTileRoomScene(
  source: string,
  activeScene: Readonly<TileRoomScene>,
): TileRoomLevelParseResult {
  let raw: unknown;
  try { raw = JSON.parse(source); }
  catch { return { ok: false, error: 'That file is not valid JSON.' }; }

  const wrapped = isRecord(raw) && raw.format === TILE_ROOM_LEVEL_FILE_FORMAT && isRecord(raw.scene)
    ? raw.scene
    : null;
  const levelCandidate = wrapped?.level ?? raw;
  const validation = validateLevel(levelCandidate);
  const firstError = validation.errors.find((entry) => entry.severity === 'error');
  if (!validation.valid || firstError !== undefined) {
    return { ok: false, error: firstError === undefined ? 'The level is invalid.' : `${firstError.path || 'level'}: ${firstError.message}` };
  }

  const level = levelCandidate as LevelData;
  const semantics = readSemantics(wrapped?.tileSemantics, activeScene.tileSemantics);
  return {
    ok: true,
    scene: {
      id: activeScene.id,
      label: level.name,
      level,
      tileSemantics: semantics,
    },
  };
}
