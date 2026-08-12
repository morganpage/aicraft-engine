/**
 * Level → platformer-runtime bridge (Pillar 4 glue module).
 *
 * Compiles a `LevelData` (the editor's serialization shape) into the inputs
 * the platformer kernel expects: a flat `Solid[]` for static geometry, a
 * list of moving-platform descriptors the consumer advances per tick, and
 * the initial `PlatformerState` at the level's spawn point.
 *
 * Solid kinds: `platform` (fully solid), `passthrough` (one-way), and
 * `movingPlatform` (the platform's current rect is fed back in each tick by
 * the consumer — the kernel does not own platform motion). All other kinds
 * (`spawn`, `exit`, `trap`, `hazard`, `decoration`, `trigger`) are NOT
 * collision surfaces; the consumer renders them and handles their semantics
 * in their own game logic.
 *
 * Determinism: pure data transform, never mutates input, never throws. No
 * `Math.random`, no `Date.now`, no DOM reads. Malformed input produces a
 * graceful empty solids list and a state at the spawn point (or `(0, 0)`
 * if the spawn is unreadable).
 *
 * @module
 */

import type { LevelData } from '../level/types';
import type { GeneratedTileSemantics } from '../level/tile-semantics';
import { createTileTypeMap } from '../level/tile-semantics';
import type { Solid, TileSolidityQuery, TileType } from '../collision/types';
import type { PlatformerState, PlatformerConfig } from './types';
import { createPlatformerState } from './kernel';
import {
  DEFAULT_PLATFORMER_CONFIG,
  DEFAULT_PLAYER_WIDTH,
  DEFAULT_PLAYER_HEIGHT,
} from './constants';

/**
 * A moving-platform descriptor extracted from a level. The consumer advances
 * this each tick via {@link advanceMovingPlatform} and feeds the current rect
 * back into the kernel's solids list via {@link movingPlatformToSolid}.
 */
export interface CompiledMovingPlatform {
  /** Stable id matching the `Solid.id` the kernel sees when the platform is at its current position. */
  readonly id: string;
  /** The level entity this was compiled from. */
  readonly entity: import('../level/types').LevelEntity;
  /** Current position (top-left). */
  readonly x: number;
  readonly y: number;
  /** Path waypoints (already coerced to finite numbers). */
  readonly path: readonly { readonly x: number; readonly y: number }[];
  /** Travel speed in px/s. */
  readonly speed: number;
  /** Cycle mode: `'loop'` wraps to start, `'pingpong'` reverses at endpoints. */
  readonly loopMode: 'loop' | 'pingpong';
  /** Current target waypoint index. */
  readonly targetIndex: number;
  /** Current direction (`+1` forward, `-1` reverse — used for pingpong). */
  readonly direction: 1 | -1;
}

/**
 * Output of {@link compileLevel} — the complete set of inputs the platformer
 * kernel needs to run a level.
 */
export interface CompiledLevel {
  /** Static solids extracted from `platform`, `passthrough` entities. Each gets a stable `'entity-<id>'`. */
  readonly staticSolids: readonly Solid[];
  /** Moving platforms extracted from `movingPlatform` entities. The consumer advances these and re-injects their current rect as a Solid each tick. */
  readonly movingPlatforms: readonly CompiledMovingPlatform[];
  /** Initial platformer state at `level.spawn`, with default player dimensions (overridable) and the supplied config. */
  readonly initialState: PlatformerState;
  /** Captured tile classification used to generate tile collision geometry. */
  readonly tileQuery: TileSolidityQuery;
}

/** Prefix used to namespace level-entity ids when lifting them into `Solid.id`. */
const ENTITY_ID_PREFIX = 'entity-';

/**
 * Build the stable `Solid.id` for a level entity. Namespaced and debuggable.
 */
function makeSolidId(entityId: number): string {
  return `${ENTITY_ID_PREFIX}${entityId}`;
}

/**
 * Coerce a raw path array into clean finite `{x, y}` waypoints. Drops any
 * entry with non-finite coordinates. Used defensively on `MovingPlatformProps.path`.
 */
function coerceWaypoints(
  path: readonly { readonly x?: number; readonly y?: number }[],
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const p of path) {
    if (p === null || typeof p !== 'object') continue;
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ x, y });
  }
  return out;
}

/**
 * Options for {@link compileLevel}.
 */
export interface CompileLevelOptions {
  /** Override the default player body width (`DEFAULT_PLAYER_WIDTH`). */
  readonly playerWidth?: number;
  /** Override the default player body height (`DEFAULT_PLAYER_HEIGHT`). */
  readonly playerHeight?: number;
  /** Override the default platformer config (`DEFAULT_PLATFORMER_CONFIG`). */
  readonly config?: Readonly<PlatformerConfig>;
  /** Classify serialized numeric tile values for platformer collision. */
  readonly tileTypeMap?: (tileValue: number) => TileType;
}

/**
 * Compile a `LevelData` into the inputs the platformer kernel expects.
 *
 * Solid kinds: `platform` (fully solid), `passthrough` (one-way, `passthrough: true`),
 * and `movingPlatform` (extracted into `movingPlatforms`, NOT into `staticSolids`).
 * All other kinds (`spawn`, `exit`, `trap`, `hazard`, `decoration`, `trigger`)
 * are ignored — they're not collision surfaces.
 *
 * Initial state is constructed at `level.spawn` with default player dimensions
 * (overridable via {@link CompileLevelOptions}) and the supplied config.
 *
 * Pure: returns a fresh `CompiledLevel`; the input is never mutated. Never
 * throws — malformed level data produces an empty solids list and a state at
 * the spawn point (or `(0, 0)` if the spawn is unreadable).
 *
 * @param level - the level data to compile
 * @param options - optional player dimensions / config overrides
 * @returns a fresh `CompiledLevel` with static solids, moving platforms, and initial state
 *
 * @example
 * ```ts
 * const compiled = compileLevel(levelData);
 * let state = compiled.initialState;
 * // each tick:
 * const platforms = compiled.movingPlatforms.map(advanceMovingPlatform);
 * const solids = [...compiled.staticSolids, ...platforms.map(movingPlatformToSolid)];
 * state = stepPlatformer(state, input, solids, dt).state;
 * ```
 */
export function compileLevel(
  level: LevelData,
  options?: CompileLevelOptions,
): CompiledLevel {
  try {
    return compileLevelUnsafe(level, options);
  } catch {
    return {
      staticSolids: [],
      movingPlatforms: [],
      initialState: createPlatformerState(0, 0),
      tileQuery: () => 'empty',
    };
  }
}

function compileLevelUnsafe(
  level: LevelData,
  options?: CompileLevelOptions,
): CompiledLevel {
  const staticSolids: Solid[] = [];
  const movingPlatforms: CompiledMovingPlatform[] = [];

  // Parse config + player dimensions FIRST so the entity loop can read spring
  // launch velocities from `config.springBounceVy` / `config.springSuperBounceVy`
  // (Phase 8). Previously this ran after the entity loop; moving it up is a
  // pure reorder — config parsing has no dependency on entities or tiles.
  let config: Readonly<PlatformerConfig> = DEFAULT_PLATFORMER_CONFIG;
  let playerWidth = DEFAULT_PLAYER_WIDTH;
  let playerHeight = DEFAULT_PLAYER_HEIGHT;
  try {
    config = options?.config ?? DEFAULT_PLATFORMER_CONFIG;
  } catch {
    config = DEFAULT_PLATFORMER_CONFIG;
  }
  try {
    const value = options?.playerWidth;
    if (typeof value === 'number' && Number.isFinite(value)) playerWidth = value;
  } catch {
    playerWidth = DEFAULT_PLAYER_WIDTH;
  }
  try {
    const value = options?.playerHeight;
    if (typeof value === 'number' && Number.isFinite(value)) playerHeight = value;
  } catch {
    playerHeight = DEFAULT_PLAYER_HEIGHT;
  }

  let entities: readonly import('../level/types').LevelEntity[] = [];
  try {
    entities = level && Array.isArray(level.entities) ? level.entities : [];
  } catch {
    entities = [];
  }
  let entityCount = 0;
  try {
    entityCount = Math.min(1_000_000, entities.length);
  } catch {
    entityCount = 0;
  }
  for (let entityIndex = 0; entityIndex < entityCount; entityIndex += 1) {
    try {
      const entity = entities[entityIndex];
      if (!entity || typeof entity.kind !== 'string') continue;
      const r = entity.rect;
      if (!r) continue;
      const rx = Number(r.x);
      const ry = Number(r.y);
      const rw = Number(r.width);
      const rh = Number(r.height);
      if (!Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(rw) || !Number.isFinite(rh)) {
        continue;
      }

      if (entity.kind === 'platform') {
        staticSolids.push({
          id: makeSolidId(entity.id),
          x: rx,
          y: ry,
          width: rw,
          height: rh,
        });
      } else if (entity.kind === 'passthrough') {
        staticSolids.push({
          id: makeSolidId(entity.id),
          x: rx,
          y: ry,
          width: rw,
          height: rh,
          passthrough: true,
        });
      } else if (entity.kind === 'movingPlatform') {
        const props = entity.props;
        const rawPath = props && Array.isArray(props.path) ? props.path : [];
        const cleanPath = coerceWaypoints(rawPath);
        // Path requires at least 2 valid waypoints for motion; otherwise the
        // platform is dropped from the motion system (empty path).
        const finalPath = cleanPath.length >= 2 ? cleanPath : [];
        const rawSpeed = props && typeof props.speed === 'number' ? props.speed : NaN;
        const speed = Number.isFinite(rawSpeed) ? Math.max(0, rawSpeed) : 0;
        const loopMode: 'loop' | 'pingpong' =
          props && props.loopMode === 'pingpong' ? 'pingpong' : 'loop';

        const startX = finalPath.length >= 1 ? finalPath[0].x : rx;
        const startY = finalPath.length >= 1 ? finalPath[0].y : ry;
        const targetIndex = finalPath.length >= 2 ? 1 : 0;

        movingPlatforms.push({
          id: makeSolidId(entity.id),
          entity,
          x: startX,
          y: startY,
          path: finalPath,
          speed,
          loopMode,
          targetIndex,
          direction: 1,
        });
      } else if (entity.kind === 'spring') {
        // Phase 8 — spring trigger volume. NON-BLOCKING (the resolvers skip
        // `spring` solids, same as `passthrough`/`ladder`). `launch` is the
        // pre-computed upward velocity from the entity's `power` + config, so
        // the kernel reads a single ready value via `solid.spring.launch`.
        // Routed through a `LaunchIntent { source: 'spring' }` by the kernel.
        const power = entity.props?.power;
        const launch =
          power === 'super' ? config.springSuperBounceVy : config.springBounceVy;
        staticSolids.push({
          id: makeSolidId(entity.id),
          x: rx,
          y: ry,
          width: rw,
          height: rh,
          spring: { launch },
        });
      } else if (entity.kind === 'dashRefill') {
        // Phase 8 — dash crystal trigger volume. NON-BLOCKING; the kernel
        // refills `dashesRemaining` on overlap and emits an interaction; the
        // consumer owns the respawn cycle (removes the solid on interaction).
        staticSolids.push({
          id: makeSolidId(entity.id),
          x: rx,
          y: ry,
          width: rw,
          height: rh,
          dashRefill: true,
        });
      }
      // Other kinds (spawn, exit, trap, hazard, decoration, trigger, enemy,
      // collectible) are not collision surfaces and are intentionally ignored
      // here.
    } catch {
      // A hostile entity is skipped without preventing later entities.
    }
  }

  let classifier: ((tileValue: number) => TileType) | undefined;
  try {
    classifier = options?.tileTypeMap;
  } catch {
    classifier = undefined;
  }
  let captured = emptyCapturedTiles();
  try {
    captured = captureTiles(level, classifier);
    const tileSolids = flattenCapturedTiles(
      captured.types,
      captured.cols,
      captured.rows,
      captured.tileSize,
    );
    for (const solid of tileSolids) staticSolids.push(solid);
  } catch {
    captured = emptyCapturedTiles();
  }

  let spawnX = 0;
  let spawnY = 0;
  try {
    const spawn = level?.spawn;
    if (typeof spawn?.x === 'number' && Number.isFinite(spawn.x)) spawnX = spawn.x;
    if (typeof spawn?.y === 'number' && Number.isFinite(spawn.y)) spawnY = spawn.y;
  } catch {
    // Preserve successfully compiled entities/tiles when spawn is hostile.
  }

  let initialState: PlatformerState;
  try {
    initialState = createPlatformerState(spawnX, spawnY, config, playerWidth, playerHeight);
  } catch {
    initialState = createPlatformerState(
      spawnX,
      spawnY,
      DEFAULT_PLATFORMER_CONFIG,
      playerWidth,
      playerHeight,
    );
  }

  return {
    staticSolids,
    movingPlatforms,
    initialState,
    tileQuery: captured.query,
  };
}

interface CapturedTiles {
  readonly types: readonly TileType[];
  readonly cols: number;
  readonly rows: number;
  readonly tileSize: number;
  readonly query: TileSolidityQuery;
}

function emptyCapturedTiles(): CapturedTiles {
  return { types: [], cols: 0, rows: 0, tileSize: 1, query: () => 'empty' };
}

function captureTiles(
  level: LevelData,
  classifier?: (tileValue: number) => TileType,
): CapturedTiles {
  const grid = level?.tiles;
  const cols = Number.isFinite(grid?.cols) ? Math.max(0, Math.floor(grid.cols)) : 0;
  const rows = Number.isFinite(grid?.rows) ? Math.max(0, Math.floor(grid.rows)) : 0;
  const tileSize = Number.isFinite(grid?.tileSize) && grid.tileSize > 0 ? grid.tileSize : 1;
  const data: readonly unknown[] = Array.isArray(grid?.data) ? grid.data : [];
  const cellCount = cols * rows;
  if (!Number.isSafeInteger(cellCount) || cellCount > 1_000_000) {
    return { types: [], cols: 0, rows: 0, tileSize, query: () => 'empty' };
  }
  const types: TileType[] = [];
  for (let index = 0; index < cellCount; index += 1) {
    let type: TileType = 'empty';
    const value = data[index];
    if (classifier && typeof value === 'number' && Number.isFinite(value)) {
      try {
        const classified = classifier(value);
        if (classified === 'solid' || classified === 'passthrough' || classified === 'empty') {
          type = classified;
        }
      } catch {
        type = 'empty';
      }
    }
    types.push(type);
  }
  const query: TileSolidityQuery = (x, y) => {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= cols || y >= rows) {
      return 'empty';
    }
    return types[y * cols + x] ?? 'empty';
  };
  return { types, cols, rows, tileSize, query };
}

function flattenCapturedTiles(
  types: readonly TileType[],
  cols: number,
  rows: number,
  tileSize: number,
): Solid[] {
  const result: Solid[] = [];
  const visited = new Array<boolean>(types.length).fill(false);
  const emit = (x: number, y: number, width: number, height: number, passthrough: boolean) => {
    const bounds = {
      x: x * tileSize,
      y: y * tileSize,
      width: width * tileSize,
      height: height * tileSize,
    };
    result.push({
      id: `tile-${bounds.x}-${bounds.y}-${bounds.width}-${bounds.height}`,
      ...bounds,
      ...(passthrough ? { passthrough: true } : {}),
    });
  };

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const start = y * cols + x;
      if (visited[start]) continue;
      const type = types[start] ?? 'empty';
      if (type === 'empty') continue;
      let width = 1;
      while (
        x + width < cols &&
        !visited[start + width] &&
        types[start + width] === type
      ) width += 1;

      let height = 1;
      if (type === 'solid') {
        rows: while (y + height < rows) {
          for (let dx = 0; dx < width; dx += 1) {
            const index = (y + height) * cols + x + dx;
            if (visited[index] || types[index] !== 'solid') break rows;
          }
          height += 1;
        }
      }
      for (let dy = 0; dy < height; dy += 1) {
        for (let dx = 0; dx < width; dx += 1) {
          visited[(y + dy) * cols + x + dx] = true;
        }
      }
      emit(x, y, width, height, type === 'passthrough');
    }
  }
  return result;
}

/**
 * Input to {@link compileGeneratedLevel} — a generated level paired with
 * its explicit tile semantics so the runtime, reachability, and simulation
 * all interpret tile values consistently.
 *
 * @see {@link GeneratedTileSemantics}
 * @see {@link compileGeneratedLevel}
 */
export interface GeneratedLevelInput {
  /** The generated level data. */
  readonly level: LevelData;
  /** Explicit tile-value classification for this generated level. */
  readonly tileSemantics: Readonly<GeneratedTileSemantics>;
}

/**
 * Compile a generated level with its explicit tile semantics.
 *
 * This is the canonical entry point for generated levels. It builds the
 * `tileTypeMap` from `generated.tileSemantics` via
 * {@link createTileTypeMap}, then delegates to {@link compileLevel}.
 *
 * This preserves `compileLevel`'s existing entity-only default (no
 * `tileTypeMap`) while making generated levels safe by default — tile
 * values the generator emitted are correctly classified as solid,
 * passthrough, or empty.
 *
 * Pure: never mutates input, never throws. Malformed input produces a
 * graceful empty {@link CompiledLevel} (see {@link compileLevel}).
 *
 * @example
 * ```ts
 * const compiled = compileGeneratedLevel({
 *   level: generatedLevel,
 *   tileSemantics: { solid: [1], passthrough: [2] },
 * });
 * // compiled.staticSolids includes tile-derived solids
 * ```
 *
 * @param generated - The generated level and its tile semantics.
 * @param options   - Optional overrides passed through to `compileLevel`
 *                    (player dimensions, config). `tileTypeMap` is
 *                    derived from `tileSemantics` and cannot be overridden.
 * @returns A {@link CompiledLevel} with tile solids from the semantics.
 */
export function compileGeneratedLevel(
  generated: GeneratedLevelInput,
  options?: Omit<CompileLevelOptions, 'tileTypeMap'>,
): CompiledLevel {
  try {
    const tileTypeMap = createTileTypeMap(generated.tileSemantics);
    return compileLevel(generated.level, { ...options, tileTypeMap });
  } catch {
    return {
      staticSolids: [],
      movingPlatforms: [],
      initialState: createPlatformerState(0, 0),
      tileQuery: () => 'empty',
    };
  }
}

/**
 * Compute the next `(targetIndex, direction)` after reaching the current
 * target. Loop mode wraps; pingpong reverses at endpoints.
 */
function nextTargetIndex(platform: CompiledMovingPlatform): {
  index: number;
  direction: 1 | -1;
} {
  const len = platform.path.length;
  if (len === 0) return { index: 0, direction: platform.direction };
  if (platform.loopMode === 'loop') {
    return {
      index: (platform.targetIndex + 1) % len,
      direction: platform.direction,
    };
  }
  // pingpong
  const atEnd = platform.direction === 1 && platform.targetIndex >= len - 1;
  const atStart = platform.direction === -1 && platform.targetIndex <= 0;
  if (atEnd) return { index: Math.max(0, platform.targetIndex - 1), direction: -1 };
  if (atStart) return { index: Math.min(len - 1, platform.targetIndex + 1), direction: 1 };
  const next = platform.targetIndex + platform.direction;
  return { index: Math.max(0, Math.min(len - 1, next)), direction: platform.direction };
}

/**
 * Advance a moving platform by `dt` seconds.
 *
 * The platform moves toward `path[targetIndex]` at `speed` px/s. When it
 * reaches the waypoint (within 1 px, or when the step would overshoot), it
 * snaps to the waypoint and advances to the next. In `'loop'` mode the index
 * wraps; in `'pingpong'` mode the direction reverses at path endpoints.
 *
 * Pure: returns a new `CompiledMovingPlatform` with updated position, target
 * index, and direction; the input is not mutated. Never throws — malformed
 * path or NaN inputs return the input unchanged.
 *
 * @param platform - the current moving-platform descriptor
 * @param dt - elapsed seconds for this tick
 * @returns a fresh descriptor with the advanced position and updated indices
 */
export function advanceMovingPlatform(
  platform: CompiledMovingPlatform,
  dt: number,
): CompiledMovingPlatform {
  if (!Number.isFinite(dt) || dt <= 0) return platform;
  if (platform.path.length < 2) return platform;
  if (!Number.isFinite(platform.speed) || platform.speed <= 0) return platform;

  const target = platform.path[platform.targetIndex];
  if (!target) return platform;

  const dx = target.x - platform.x;
  const dy = target.y - platform.y;
  const dist = Math.hypot(dx, dy);
  const step = platform.speed * dt;

  // Arrival: within 1 px of target, or this tick's step would overshoot it.
  // Snap to the target and advance to the next waypoint.
  if (dist <= 1 || step >= dist) {
    const next = nextTargetIndex(platform);
    return {
      ...platform,
      x: target.x,
      y: target.y,
      targetIndex: next.index,
      direction: next.direction,
    };
  }

  const nx = platform.x + (dx / dist) * step;
  const ny = platform.y + (dy / dist) * step;
  return { ...platform, x: nx, y: ny };
}

/**
 * Convert a `CompiledMovingPlatform` into the `Solid` the kernel should see
 * this tick. The solid's `id` matches `platform.id` so kernel contacts
 * (`Contacts.groundId`, etc.) refer back to this specific moving platform.
 *
 * The solid's width/height come from the source entity's rect (the platform
 * body); the x/y come from the platform's current advanced position.
 *
 * Pure: returns a fresh `Solid`; never throws.
 *
 * @param platform - the current moving-platform descriptor
 * @returns a `Solid` with matching `id` and the platform's current bounds
 */
export function movingPlatformToSolid(platform: CompiledMovingPlatform): Solid {
  const r = platform.entity.rect;
  return {
    id: platform.id,
    x: platform.x,
    y: platform.y,
    width: Number(r.width),
    height: Number(r.height),
  };
}

/**
 * Build a `SolidDisplacementProvider` that returns the per-tick displacement
 * of each moving platform by id. Pass this to `stepPlatformer` so the
 * kernel's riding tracker carries actors along when their `groundId` is a
 * moving platform.
 *
 * Displacement per id = `currentPos - previousPos`. Returns `null` for ids
 * not in `previous` (unknown / new), ids not in `current` (removed), or when
 * the displacement is `(0, 0)` (no movement this tick).
 *
 * @param current - this tick's advanced platform descriptors
 * @param previous - last tick's platform descriptors
 * @returns a provider function suitable for `stepPlatformer`'s `getSolidDisplacement` argument
 */
export function createMovingPlatformDisplacementProvider(
  current: readonly CompiledMovingPlatform[],
  previous: readonly CompiledMovingPlatform[],
): (id: string) => { dx: number; dy: number } | null {
  const prevMap = new Map<string, CompiledMovingPlatform>();
  for (const p of previous) {
    if (p && typeof p.id === 'string') prevMap.set(p.id, p);
  }
  const curMap = new Map<string, CompiledMovingPlatform>();
  for (const p of current) {
    if (p && typeof p.id === 'string') curMap.set(p.id, p);
  }
  return (id: string): { dx: number; dy: number } | null => {
    const cur = curMap.get(id);
    if (!cur) return null;
    const prev = prevMap.get(id);
    if (!prev) return null;
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    if (dx === 0 && dy === 0) return null;
    return { dx, dy };
  };
}
