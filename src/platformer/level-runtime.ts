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
import { aabbOverlap } from '../collision/aabb';
import type { PlatformerState, PlatformerConfig, PlatformerInput } from './types';
import { createPlatformerState, stepPlatformer } from './kernel';
import { IDLE_EDGE } from './input-edges';
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
  /**
   * Provenance of the resolved spawn point (Celerock hardening, Workstream C2).
   * Present when the compiler resolved a spawn; absent on the degraded
   * empty-state fallback path. `source` distinguishes an authored spawn
   * (`'authored'`) from a recoverable default (`'fallback'`, when `level.spawn`
   * was the origin `(0, 0)`); `'seam-entry'` is reserved for future
   * room-transition spawn resolution and is not populated yet.
   */
  readonly spawn?: ResolvedPlatformerSpawn;
  /**
   * Compile-time diagnostics (Celerock hardening, Workstream C3). Currently
   * only spawn/embedding warnings are produced. Absent (rather than empty) on
   * the degraded fallback path; check `?? []` to iterate defensively.
   */
  readonly diagnostics?: readonly CompileDiagnostic[];
}

/**
 * Provenance of the spawn point a {@link CompiledLevel} was initialized at
 * (Celerock hardening, Workstream C2).
 *
 * The `x`/`y` are the resolved AABB TOP-LEFT the kernel's initial state was
 * constructed with (after applying {@link CompileLevelOptions.spawnResolution}).
 * `source` records where the spawn came from so consumers / editors can tell an
 * authored spawn apart from a recoverable default. `entityId`, when present, is
 * the id of the `spawn` entity the point derived from (parsed back via
 * {@link entityIdFromSolidId} when applicable).
 */
export interface ResolvedPlatformerSpawn {
  /** Resolved world X of the initial AABB top-left. */
  readonly x: number;
  /** Resolved world Y of the initial AABB top-left. */
  readonly y: number;
  /** Where the spawn came from. */
  readonly source: 'authored' | 'seam-entry' | 'fallback';
  /** The level entity id the spawn derived from, when identifiable. */
  readonly entityId?: number;
}

/** Severity of a single {@link CompileDiagnostic}. */
export type CompileDiagnosticSeverity = 'warning' | 'error';

/**
 * A single diagnostic produced during level compilation (Celerock hardening,
 * Workstream C3). Diagnostics are advisory — they never prevent a level from
 * compiling; the consumer / editor decides what to surface.
 */
export interface CompileDiagnostic {
  /** Diagnostic severity. `'error'` is reserved for future hard failures. */
  readonly severity: CompileDiagnosticSeverity;
  /** Human-readable description of the finding. */
  readonly message: string;
  /** Related level entity id, when the diagnostic ties to one. */
  readonly entityId?: number;
  /** Related `Solid.id`, when the diagnostic ties to a compiled solid. */
  readonly solidId?: string;
}

/**
 * Prefix used to namespace level-entity ids when lifting them into `Solid.id`.
 * Entity-derived solids use `entity-<id>`; TILE-derived solids use a separate
 * `tile-<x>-<y>-<w>-<h>` namespace which is NOT reversible to an entity (so
 * {@link entityIdFromSolidId} returns `undefined` for `tile-…` ids).
 */
const ENTITY_ID_PREFIX = 'entity-';

/**
 * Build the stable `Solid.id` for a level entity (`entity-<id>`). Namespaced,
 * debuggable, and reversible via {@link entityIdFromSolidId}.
 *
 * Pure: returns a fresh string; never throws.
 */
export function solidIdForEntity(entityId: number): string {
  return `${ENTITY_ID_PREFIX}${entityId}`;
}

/**
 * Parse an entity id back out of a `Solid.id` produced by
 * {@link solidIdForEntity}. Returns `undefined` for any id that is not an
 * entity-derived solid — including the TILE-derived `tile-<x>-<y>-<w>-<h>`
 * namespace, malformed `entity-` ids (non-numeric suffix), and non-string ids.
 *
 * Pure: never throws.
 */
export function entityIdFromSolidId(solidId: string): number | undefined {
  if (typeof solidId !== 'string' || !solidId.startsWith(ENTITY_ID_PREFIX)) {
    return undefined;
  }
  const tail = solidId.slice(ENTITY_ID_PREFIX.length);
  // Reject an empty suffix (`'entity-'` — `Number('') === 0` would otherwise
  // collide with the legitimate `'entity-0'`) and negative ids (`'entity--1'`).
  // Entity-derived solid ids are non-negative integers; anything else is not a
  // reversible entity id.
  if (tail.length === 0) return undefined;
  const num = Number(tail);
  return Number.isInteger(num) && num >= 0 ? num : undefined;
}

/**
 * Build the stable `Solid.id` for a level entity. Thin wrapper over
 * {@link solidIdForEntity} retained as a private alias so the compile loop
 * reads at the call site.
 */
function makeSolidId(entityId: number): string {
  return solidIdForEntity(entityId);
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
  /**
   * How `level.spawn` is interpreted when constructing the initial state
   * (Celerock hardening, Workstream C1).
   *
   * - `'actor-top-left'` (default): `level.spawn` is the AABB TOP-LEFT, used
   *   verbatim. Preserves the existing hand-authored `compileLevel` behavior
   *   (non-breaking).
   * - `'rest-on-surface'`: `level.spawn` is a FEET-CENTER anchor (the entity's
   *   bottom-center, as emitted by `ldtkLevelToLevelData`). The compile step
   *   resolves it to the AABB top-left so the player rests on the surface:
   *   `topLeftX = spawn.x − playerWidth/2`,
   *   `topLeftY = spawn.y − playerHeight`. {@link compileGeneratedLevel} (the
   *   LDtk path) defaults to this.
   */
  readonly spawnResolution?: 'actor-top-left' | 'rest-on-surface';
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

  // Celerock hardening (Workstream C1) — spawn resolution. `level.spawn` from
  // hand-authored levels is the AABB top-left (`'actor-top-left'`, the default,
  // preserves the existing behavior); `ldtkLevelToLevelData` emits a FEET-CENTER
  // anchor, so the LDtk path (`compileGeneratedLevel`) passes
  // `'rest-on-surface'` and we resolve it to the AABB top-left so the player
  // rests on the surface (feet end up exactly at `spawn.y`).
  let spawnResolution: CompileLevelOptions['spawnResolution'] = 'actor-top-left';
  try {
    const value = options?.spawnResolution;
    if (value === 'actor-top-left' || value === 'rest-on-surface') spawnResolution = value;
  } catch {
    spawnResolution = 'actor-top-left';
  }
  let resolvedX = spawnX;
  let resolvedY = spawnY;
  if (spawnResolution === 'rest-on-surface') {
    resolvedX = spawnX - playerWidth / 2;
    resolvedY = spawnY - playerHeight;
  }

  let initialState: PlatformerState;
  try {
    initialState = createPlatformerState(resolvedX, resolvedY, config, playerWidth, playerHeight);
  } catch {
    initialState = createPlatformerState(
      resolvedX,
      resolvedY,
      DEFAULT_PLATFORMER_CONFIG,
      playerWidth,
      playerHeight,
    );
  }

  // Celerock hardening (Workstream C2) — spawn provenance. The compile step
  // only sees `level.spawn`, so the source is a heuristic: a spawn at the
  // origin `(0, 0)` is treated as the recoverable fallback (the empty-state
  // catch paths use `(0, 0)`); anything else is treated as authored. When a
  // `spawn` entity is present, record its id.
  const isFallback = spawnX === 0 && spawnY === 0;
  let spawnEntityId: number | undefined;
  try {
    const spawnEntity = (entities as readonly { readonly kind?: unknown; readonly id?: unknown }[])
      .find((e) => e && e.kind === 'spawn' && typeof e.id === 'number');
    if (spawnEntity !== undefined) spawnEntityId = spawnEntity.id as number;
  } catch {
    spawnEntityId = undefined;
  }
  const resolvedSpawn: ResolvedPlatformerSpawn = {
    x: resolvedX,
    y: resolvedY,
    source: isFallback ? 'fallback' : 'authored',
    ...(spawnEntityId !== undefined ? { entityId: spawnEntityId } : {}),
  };

  // Celerock hardening (Workstream C3) — spawn-embedding overlap check. If the
  // resolved player AABB overlaps any fully-BLOCKING solid (not passthrough /
  // spring / dashRefill / ladder — the non-blocking trigger volumes), emit a
  // warning diagnostic. With the new `'rest-on-surface'` resolution a correctly
  // authored feet-center anchor rests exactly on the surface and produces NO
  // overlap; the warning catches genuinely embedded spawns. Reported, not
  // auto-settled (see {@link settlePlatformerState} for an opt-in settle).
  const diagnostics: CompileDiagnostic[] = [];
  try {
    const body = {
      x: initialState.core.x,
      y: initialState.core.y,
      width: initialState.core.width,
      height: initialState.core.height,
    };
    for (const solid of staticSolids) {
      if (
        solid.passthrough === true ||
        solid.ladder === true ||
        solid.spring !== undefined ||
        solid.dashRefill === true
      ) {
        continue;
      }
      if (aabbOverlap(body, solid)) {
        const solidId = typeof solid.id === 'string' ? solid.id : undefined;
        const entityId =
          typeof solid.id === 'string' ? entityIdFromSolidId(solid.id) : undefined;
        diagnostics.push({
          severity: 'warning',
          message:
            'Player spawn AABB overlaps a solid — the player may be embedded in geometry at start.',
          ...(solidId !== undefined ? { solidId } : {}),
          ...(entityId !== undefined ? { entityId } : {}),
        });
        break;
      }
    }
  } catch {
    // Diagnostics are advisory; never let the check fail compilation.
  }

  return {
    staticSolids,
    movingPlatforms,
    initialState,
    tileQuery: captured.query,
    spawn: resolvedSpawn,
    diagnostics,
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
 *                    `spawnResolution` defaults to `'rest-on-surface'` (the
 *                    LDtk path emits feet-center anchors); pass
 *                    `'actor-top-left'` to override.
 * @returns A {@link CompiledLevel} with tile solids from the semantics.
 */
export function compileGeneratedLevel(
  generated: GeneratedLevelInput,
  options?: Omit<CompileLevelOptions, 'tileTypeMap'>,
): CompiledLevel {
  try {
    const tileTypeMap = createTileTypeMap(generated.tileSemantics);
    // Celerock hardening (Workstream C1) — LDtk levels derive `level.spawn` as
    // a FEET-CENTER anchor, so resolve it to the AABB top-left. A caller may
    // still override (`'actor-top-left'`); absent that, default to rest-on-surface.
    return compileLevel(generated.level, {
      ...options,
      tileTypeMap,
      spawnResolution: options?.spawnResolution ?? 'rest-on-surface',
    });
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

/**
 * Outcome of {@link settlePlatformerState}.
 */
export interface SettlePlatformerStateResult {
  /** The state after running up to `maxSteps` neutral ticks. */
  readonly state: PlatformerState;
  /** `true` iff the state reached `core.onGround === true` within `maxSteps`. */
  readonly settled: boolean;
  /** Number of neutral ticks actually run (0 when the input was already grounded). */
  readonly steps: number;
}

/** Default upper bound on neutral ticks run by {@link settlePlatformerState}. */
const DEFAULT_SETTLE_MAX_STEPS = 64;

/** Fixed timestep used by {@link settlePlatformerState} (60 Hz). */
const SETTLE_DT = 1 / 60;

/**
 * Settle a platformer state onto the ground by running neutral-input ticks.
 *
 * For each tick the input is fully idle (`moveX = 0`, `moveY = 0`, jump/dash/
 * grab all {@link IDLE_EDGE} — no jump, no dash, no grab), so the actor simply
 * falls under gravity until it lands. The loop stops as soon as
 * `state.core.onGround === true` or `maxSteps` (default 64) is exhausted.
 *
 * This mirrors the `settleState` helper the Celerock builds hand-rolled. It is
 * a RECOVERY tool for consumers with approximate spawn markers (or legacy
 * levels whose spawn is slightly embedded): the spawn-resolution +
 * overlap-diagnostic paths in {@link compileLevel} are the preferred fix, but
 * this helper remains for legacy use and for consumers that cannot recompile.
 *
 * Pure: returns a brand-new state; the input is never mutated. Never throws —
 * a throwing step leaves the last good state in the result.
 *
 * @param state - the platformer state to settle (e.g. `compiled.initialState`)
 * @param solids - the collision surfaces to resolve against each tick
 * @param config - platformer tuning config (default `DEFAULT_PLATFORMER_CONFIG`)
 * @param maxSteps - upper bound on ticks to run (default 64)
 * @returns `{ state, settled, steps }`
 *
 * @example
 * ```ts
 * const compiled = compileGeneratedLevel({ level, tileSemantics });
 * const { state, settled } = settlePlatformerState(
 *   compiled.initialState,
 *   compiled.staticSolids,
 * );
 * ```
 */
export function settlePlatformerState(
  state: PlatformerState,
  solids: readonly Solid[],
  config: Readonly<PlatformerConfig> = DEFAULT_PLATFORMER_CONFIG,
  maxSteps: number = DEFAULT_SETTLE_MAX_STEPS,
): SettlePlatformerStateResult {
  const limit = Number.isFinite(maxSteps) && maxSteps > 0
    ? Math.floor(maxSteps)
    : DEFAULT_SETTLE_MAX_STEPS;
  const idleInput: PlatformerInput = {
    moveX: 0,
    moveY: 0,
    jump: IDLE_EDGE,
    dash: IDLE_EDGE,
    grab: IDLE_EDGE,
  };
  let current = state;
  if (current?.core?.onGround === true) {
    return { state: current, settled: true, steps: 0 };
  }
  let steps = 0;
  for (; steps < limit; steps += 1) {
    try {
      current = stepPlatformer(current, idleInput, solids, SETTLE_DT, config).state;
    } catch {
      return { state: current, settled: Boolean(current?.core?.onGround), steps };
    }
    if (current.core.onGround) {
      return { state: current, settled: true, steps: steps + 1 };
    }
  }
  // Loop exhausted without grounding (current.core.onGround is necessarily
  // false here — we return on the first grounded tick). `Boolean()` keeps the
  // read defensive without tripping control-flow narrowing.
  return { state: current, settled: Boolean(current?.core?.onGround), steps };
}
