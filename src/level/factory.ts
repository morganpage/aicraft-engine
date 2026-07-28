/**
 * Level factory functions — `createLevelScaffold` and `createMinimalValidLevel`.
 *
 * These are pure factory functions that produce {@link LevelData} objects
 * with sensible defaults. They never mutate input, never throw, and produce
 * fully independent copies on each call.
 *
 * Determinism note: no `Math.random`, no `Date.now`, no global state. Every
 * call with the same options produces the same result.
 *
 * @module
 */

import type { LevelData } from './types';
import {
  LEVEL_VERSION,
  DEFAULT_TILE_SIZE,
  DEFAULT_LEVEL_WIDTH,
  DEFAULT_LEVEL_HEIGHT,
  DEFAULT_ENTITY_ID_START,
} from './constants';

/**
 * Options for {@link createLevelScaffold}.
 */
export interface LevelScaffoldOptions {
  /** Stable level identifier. Default: `''`. */
  readonly id?: string;
  /** Human-facing display name. Default: `'New Level'`. */
  readonly name?: string;
  /** Level width in pixels. Default: {@link DEFAULT_LEVEL_WIDTH} (960). */
  readonly width?: number;
  /** Level height in pixels. Default: {@link DEFAULT_LEVEL_HEIGHT} (540). */
  readonly height?: number;
  /** Tile size in pixels. Default: {@link DEFAULT_TILE_SIZE} (16). */
  readonly tileSize?: number;
}

/**
 * Create an empty editor scaffold — a {@link LevelData} with an empty tile
 * grid (all zeros), no entities, and `nextEntityId` set to
 * {@link DEFAULT_ENTITY_ID_START}.
 *
 * **May be structurally invalid until authored.** The scaffold has no spawn
 * entity, no exit entity, and therefore fails {@link validateLevel}. This is
 * deliberate: the scaffold is a blank canvas for the editor, not a playable
 * level. If a structurally valid starter level is needed, use
 * {@link createMinimalValidLevel}.
 *
 * Pure: returns a fresh `LevelData` each call; never mutates input; never
 * throws.
 *
 * @example
 * ```ts
 * const scaffold = createLevelScaffold({ width: 320, height: 240, tileSize: 16 });
 * // scaffold.entities.length === 0
 * // scaffold.nextEntityId === 1
 * ```
 *
 * @param options - Optional dimension overrides.
 * @returns A fresh `LevelData` suitable as an editor blank canvas.
 */
export function createLevelScaffold(options?: LevelScaffoldOptions): LevelData {
  const width = options?.width ?? DEFAULT_LEVEL_WIDTH;
  const height = options?.height ?? DEFAULT_LEVEL_HEIGHT;
  const tileSize = options?.tileSize ?? DEFAULT_TILE_SIZE;
  const id = options?.id ?? '';
  const name = options?.name ?? 'New Level';

  const cols = Math.floor(width / tileSize);
  const rows = Math.floor(height / tileSize);

  const tileData: number[] = new Array(cols * rows).fill(0);

  return {
    version: LEVEL_VERSION,
    id,
    name,
    width,
    height,
    tileSize,
    spawn: { x: 0, y: 0 },
    tiles: {
      data: tileData,
      cols,
      rows,
      tileSize,
    },
    entities: [],
    nextEntityId: DEFAULT_ENTITY_ID_START,
  };
}

/**
 * Options for {@link createMinimalValidLevel}.
 */
export interface MinimalLevelOptions {
  /** Stable level identifier. Default: `''`. */
  readonly id?: string;
  /** Human-facing display name. Default: `'Minimal Level'`. */
  readonly name?: string;
  /** Level width in pixels. Default: {@link DEFAULT_LEVEL_WIDTH} (960). */
  readonly width?: number;
  /** Level height in pixels. Default: {@link DEFAULT_LEVEL_HEIGHT} (540). */
  readonly height?: number;
  /** Tile size in pixels. Default: {@link DEFAULT_TILE_SIZE} (16). */
  readonly tileSize?: number;
}

/**
 * Create a structurally valid {@link LevelData} that passes
 * {@link validateLevel}.
 *
 * The returned level includes:
 *  - One spawn entity at the top-left corner.
 *  - One exit entity (non-trap, non-locked) near the top-right on the
 *    ground row.
 *  - A bottom row of solid tiles (value `1`) for supporting ground.
 *  - Coherent top-level `spawn` coordinates matching the spawn entity.
 *  - `nextEntityId` set to `3` (spawn = 1, exit = 2).
 *  - An empty tile grid (all zeros except the solid bottom row).
 *
 * This is the smallest level that satisfies the editor's cardinality
 * requirements. It is suitable for testing, as a starting point for
 * procedural generation, or as a fallback when generation fails.
 *
 * Pure: returns a fresh `LevelData` each call; never mutates input; never
 * throws.
 *
 * @example
 * ```ts
 * const level = createMinimalValidLevel({ width: 320, height: 240, tileSize: 16 });
 * const result = validateLevel(level);
 * // result.valid === true
 * ```
 *
 * @param options - Optional dimension overrides.
 * @returns A structurally valid `LevelData` with spawn, exit, and ground.
 */
export function createMinimalValidLevel(options?: MinimalLevelOptions): LevelData {
  const width = options?.width ?? DEFAULT_LEVEL_WIDTH;
  const height = options?.height ?? DEFAULT_LEVEL_HEIGHT;
  const tileSize = options?.tileSize ?? DEFAULT_TILE_SIZE;
  const id = options?.id ?? '';
  const name = options?.name ?? 'Minimal Level';

  const cols = Math.floor(width / tileSize);
  const rows = Math.floor(height / tileSize);

  // Build tile grid: bottom row solid (value 1), rest empty (value 0).
  const tileData: number[] = new Array(cols * rows).fill(0);
  const bottomRowStart = (rows - 1) * cols;
  for (let x = 0; x < cols; x++) {
    tileData[bottomRowStart + x] = 1;
  }

  // Spawn at top-left, just inside the level bounds.
  const spawnX = tileSize;
  const spawnY = tileSize;

  // Exit at top-right, on the ground row.
  const exitX = width - tileSize * 2;
  const exitY = height - tileSize * 2;

  return {
    version: LEVEL_VERSION,
    id,
    name,
    width,
    height,
    tileSize,
    spawn: { x: spawnX, y: spawnY },
    tiles: {
      data: tileData,
      cols,
      rows,
      tileSize,
    },
    entities: [
      {
        id: 1,
        kind: 'spawn',
        rect: { x: spawnX, y: spawnY, width: tileSize, height: tileSize },
        props: {},
      },
      {
        id: 2,
        kind: 'exit',
        rect: { x: exitX, y: exitY, width: tileSize, height: tileSize },
        props: { isTrap: false, locked: false },
      },
    ],
    nextEntityId: 3,
  };
}
