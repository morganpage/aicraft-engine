/**
 * Per-room LDtk → platformer-runtime glue (Celerock hardening C4/C5).
 *
 * Consumers repeatedly hand-roll the same per-room pipeline: translate an
 * `LdtkLevel` via `ldtkLevelToLevelData`, compile it via
 * `compileGeneratedLevel`, bucket the resulting entities by kind, pull out the
 * resolved spawn, and cache the lot so a room is only compiled once. This
 * module packages that glue ON TOP of the existing primitives — it calls
 * `ldtkLevelToLevelData` and `compileGeneratedLevel` and never duplicates their
 * logic.
 *
 * Workstream C4 — {@link compileLdtkRoom}: translate + compile a single LDtk
 * level into a {@link CompiledLdtkRoom} (entity buckets, static solids, resolved
 * spawn, merged diagnostics). Never throws.
 *
 * Workstream C5 — {@link createLdtkRoomCache}: a tiny lazy cache over a whole
 * `LdtkProject`. `get(iid)` compiles on first access and returns the SAME
 * immutable instance thereafter; `getStartRoom()` resolves the project's
 * start room from an authored spawn (or an explicit override) without ever
 * fabricating a `(0, 0)` room.
 *
 * Determinism: pure functions over plain data; no `Math.random`, no `Date.now`.
 * Public APIs never throw — malformed input yields a degraded but well-typed
 * result carrying diagnostics.
 *
 * @module
 */

import type { LevelData, LevelEntity } from '../level/types';
import type { CollectibleEntity } from '../collectibles/types';
import { LEVEL_VERSION } from '../level/constants';
import type { GeneratedTileSemantics } from '../level/tile-semantics';
import { ldtkLevelToLevelData } from '../ldtk/translate';
import type { LdtkLevel, LdtkProject } from '../ldtk/types';
import type { Solid } from '../collision/types';
import type { PlatformerConfig } from './types';
import { createPlatformerState } from './kernel';
import {
  compileGeneratedLevel,
  type CompiledLevel,
  type ResolvedPlatformerSpawn,
  type CompileDiagnostic,
} from './level-runtime';

// ---------------------------------------------------------------------------
// C4 — compileLdtkRoom
// ---------------------------------------------------------------------------

/**
 * Options for {@link compileLdtkRoom}. All fields optional; each is forwarded
 * to {@link compileGeneratedLevel} (player dimensions, config, spawn
 * resolution). `spawnResolution` defaults to `'rest-on-surface'` (the LDtk
 * path emits feet-center anchors).
 */
export interface CompileLdtkRoomOptions {
  /** Override the default platformer config (`DEFAULT_PLATFORMER_CONFIG`). */
  readonly config?: Readonly<PlatformerConfig>;
  /** Override the default player body width (`DEFAULT_PLAYER_WIDTH`). */
  readonly playerWidth?: number;
  /** Override the default player body height (`DEFAULT_PLAYER_HEIGHT`). */
  readonly playerHeight?: number;
  /**
   * How `level.spawn` is interpreted. Defaults to `'rest-on-surface'` (LDtk
   * feet-center anchor) — see {@link compileGeneratedLevel}.
   */
  readonly spawnResolution?: 'actor-top-left' | 'rest-on-surface';
}

/**
 * A single LDtk level translated, compiled, and bucketed for a consumer.
 *
 * Produced by {@link compileLdtkRoom}. Every array is a fresh snapshot of the
 * compile output; the instance is immutable and safe to cache (see
 * {@link createLdtkRoomCache}).
 */
export interface CompiledLdtkRoom {
  /** The source LDtk level (unmutated). */
  readonly ldtkLevel: LdtkLevel;
  /** The translated engine level data (empty on hard translate failure). */
  readonly levelData: LevelData;
  /** The compiled level (from {@link compileGeneratedLevel}). */
  readonly compiled: CompiledLevel;
  /** Tile semantics derived from the LDtk IntGrid value names. */
  readonly tileSemantics: GeneratedTileSemantics;
  /**
   * The static collision set (`compiled.staticSolids`): tile geometry plus
   * `platform`/`passthrough` entity solids, plus the NON-BLOCKING trigger
   * volumes (`spring`/`dashRefill`). Moving platforms are NOT here — they stay
   * in `compiled.movingPlatforms` for the consumer to advance per tick.
   */
  readonly solids: readonly Solid[];
  /** `hazard` entities (spikes, lava, saws, …). */
  readonly hazards: readonly LevelEntity[];
  /**
   * `collectible` entities (coins, gems, keys). Narrowed to
   * {@link CollectibleEntity} (E2, celerock-0.7.0-upgrade-plan): the bucket is
   * kind-filtered at compile time, and `derivePickups` requires this type — so
   * the golden path `derivePickups(rect, room.collectibles, save)` compiles
   * without a consumer-side type predicate or cast.
   */
  readonly collectibles: readonly CollectibleEntity[];
  /** `spring` entities (normal + super). */
  readonly springs: readonly LevelEntity[];
  /** `dashRefill` entities (dash crystals). */
  readonly dashRefills: readonly LevelEntity[];
  /** `exit` entities (doors / goals). */
  readonly exits: readonly LevelEntity[];
  /** `enemy` entities. */
  readonly enemies: readonly LevelEntity[];
  /**
   * Ladder-cell marker solids.
   *
   * The engine's compile pipeline does NOT emit ladder solids: ladder IntGrid
   * values resolve to `'empty'` (see `createTileTypeMap`) so they form no
   * blocking rect, and no entity kind produces a `ladder: true` solid. Ladder
   * climb is instead driven by `tileSemantics.ladder` (the climb-space value
   * list) — a runtime overlays per-cell `ladder: true` solids each tick, and
   * the kernel's climb ability reads them via `overlapsLadder`. This field is
   * therefore ALWAYS EMPTY today; it is reserved on the shape so a future
   * engine change that emits ladder solids here is non-breaking. We do NOT
   * invent ladder solids the engine does not produce.
   */
  readonly ladders: readonly Solid[];
  /**
   * The resolved spawn point. Derived from `compiled.spawn` with `source`
   * refined for the LDtk path: when the level contains NO `spawn` entity,
   * `source` is forced to `'fallback'` (the compile heuristic only flags the
   * `(0, 0)` origin as fallback, but LDtk's translator always synthesizes a
   * non-origin default spawn — so the entity presence is the faithful signal
   * for "did the author place a spawn"). Guaranteed present.
   */
  readonly spawn: ResolvedPlatformerSpawn;
  /** Translate diagnostics + compile diagnostics, merged. */
  readonly diagnostics: readonly CompileDiagnostic[];
}

/** Default spawn position when no spawn can be resolved (the `(0, 0)` origin). */
const FALLBACK_SPAWN: ResolvedPlatformerSpawn = Object.freeze({
  x: 0,
  y: 0,
  source: 'fallback',
});

/**
 * Build a minimal empty {@link LevelData} for a level that failed to translate.
 * Carries the level's identifier/dimensions so downstream consumers still see a
 * well-typed, non-throwing result; tiles and entities are empty.
 */
function emptyLevelData(level: LdtkLevel): LevelData {
  const tileSize =
    level.layerInstances?.find((l) => l.__gridSize > 0)?.__gridSize ?? 16;
  return {
    version: LEVEL_VERSION,
    id: level.identifier,
    name: level.identifier,
    width: level.pxWid,
    height: level.pxHei,
    tileSize,
    spawn: { x: 0, y: 0 },
    tiles: { data: [], cols: 0, rows: 0, tileSize },
    entities: [],
    nextEntityId: 1,
  };
}

/** Coerce a caught `unknown` into a short diagnostic message (no `any`). */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Translate + compile a single LDtk level into a {@link CompiledLdtkRoom}.
 *
 * This is the canonical per-room glue for LDtk projects. It calls
 * {@link ldtkLevelToLevelData} (translate) then {@link compileGeneratedLevel}
 * (compile, with `spawnResolution` defaulting to `'rest-on-surface'`), buckets
 * the translated entities by kind, and merges translate + compile diagnostics.
 *
 * Behavior:
 *  - On a HARD translate failure (`level === undefined`), the room's arrays are
 *    empty, `levelData` is a minimal empty level, an error diagnostic is added,
 *    and the function still returns a well-typed result (never throws).
 *  - `solids` = `compiled.staticSolids` (moving platforms stay in
 *    `compiled.movingPlatforms`).
 *  - `ladders` is always empty — see {@link CompiledLdtkRoom.ladders}.
 *  - `spawn` = `compiled.spawn` with `source` refined to `'fallback'` when the
 *    level has no `spawn` entity; if compile yielded no spawn at all, a
 *    `(0, 0)` fallback is synthesized plus a warning diagnostic.
 *
 * Pure: returns a fresh result each call; never mutates the input level or
 * project. Never throws.
 *
 * @param ldtkLevel - The LDtk level to compile.
 * @param project   - The whole LDtk project (enables name-driven tile semantics).
 * @param options   - Optional config / player dimensions / spawn resolution.
 * @returns A fresh {@link CompiledLdtkRoom}.
 */
export function compileLdtkRoom(
  ldtkLevel: LdtkLevel,
  project: LdtkProject,
  options?: CompileLdtkRoomOptions,
): CompiledLdtkRoom {
  try {
    const translate = ldtkLevelToLevelData(ldtkLevel, project);
    const tileSemantics = translate.tileSemantics;

    // Merge translate diagnostics into the CompileDiagnostic shape (fold the
    // dotted `path` into the message so the provenance is preserved without
    // inventing a parallel diagnostic type).
    const diagnostics: CompileDiagnostic[] = translate.diagnostics.map((d) => ({
      severity: d.severity,
      message: `${d.path}: ${d.message}`,
    }));

    let levelData: LevelData;
    if (translate.level !== undefined) {
      levelData = translate.level;
    } else {
      diagnostics.push({
        severity: 'error',
        message: `LDtk translate failed for level "${ldtkLevel.identifier}"; compiled an empty room.`,
      });
      levelData = emptyLevelData(ldtkLevel);
    }

    const compiled = compileGeneratedLevel(
      { level: levelData, tileSemantics },
      {
        ...(options?.config !== undefined ? { config: options.config } : {}),
        ...(options?.playerWidth !== undefined
          ? { playerWidth: options.playerWidth }
          : {}),
        ...(options?.playerHeight !== undefined
          ? { playerHeight: options.playerHeight }
          : {}),
        spawnResolution: options?.spawnResolution ?? 'rest-on-surface',
      },
    );
    for (const d of compiled.diagnostics ?? []) diagnostics.push(d);

    // Bucket entities by kind. `spawn`, `platform`, `passthrough`,
    // `movingPlatform`, `decoration`, `trap`, `trigger` are intentionally NOT
    // bucketed here — they are consumed via `compiled` (solids /
    // movingPlatforms) or are non-gameplay.
    const entities = levelData.entities;
    const filterKind = (kind: LevelEntity['kind']): readonly LevelEntity[] =>
      entities.filter((e) => e.kind === kind);
    // E2 — the collectibles bucket carries its narrowed type via a type
    // predicate (the runtime filter is identical to `filterKind`).
    const collectibles = entities.filter(
      (e): e is CollectibleEntity => e.kind === 'collectible',
    );

    // Spawn: refine `source` for the LDtk path. The compile heuristic flags
    // only the `(0, 0)` origin as `'fallback'`, but the translator always
    // synthesizes a non-origin default spawn for spawn-less levels — so entity
    // presence is the faithful signal that the author placed a spawn.
    const hasSpawnEntity = entities.some((e) => e.kind === 'spawn');
    let spawn: ResolvedPlatformerSpawn;
    if (compiled.spawn !== undefined) {
      const s = compiled.spawn;
      spawn = hasSpawnEntity
        ? s
        : {
            x: s.x,
            y: s.y,
            source: 'fallback',
            ...(s.entityId !== undefined ? { entityId: s.entityId } : {}),
          };
    } else {
      diagnostics.push({
        severity: 'warning',
        message:
          'compileGeneratedLevel produced no spawn; using the (0, 0) fallback.',
      });
      spawn = FALLBACK_SPAWN;
    }

    return {
      ldtkLevel,
      levelData,
      compiled,
      tileSemantics,
      solids: compiled.staticSolids,
      hazards: filterKind('hazard'),
      collectibles,
      springs: filterKind('spring'),
      dashRefills: filterKind('dashRefill'),
      exits: filterKind('exit'),
      enemies: filterKind('enemy'),
      ladders: [],
      spawn,
      diagnostics,
    };
  } catch (err) {
    // Never throw: assemble a degraded but well-typed room. The translate +
    // compile primitives each guard themselves, so reaching here means a truly
    // hostile input slipped past them; build a minimal empty result directly
    // (no re-entry into compileGeneratedLevel that already threw once).
    const levelData = emptyLevelData(ldtkLevel);
    const tileSemantics: GeneratedTileSemantics = { solid: [], passthrough: [] };
    const compiled: CompiledLevel = {
      staticSolids: [],
      movingPlatforms: [],
      initialState: createPlatformerState(0, 0),
      tileQuery: () => 'empty',
    };
    return {
      ldtkLevel,
      levelData,
      compiled,
      tileSemantics,
      solids: [],
      hazards: [],
      collectibles: [],
      springs: [],
      dashRefills: [],
      exits: [],
      enemies: [],
      ladders: [],
      spawn: compiled.spawn ?? FALLBACK_SPAWN,
      diagnostics: [
        {
          severity: 'error',
          message: `compileLdtkRoom threw unexpectedly: ${describeError(err)}`,
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// C5 — createLdtkRoomCache
// ---------------------------------------------------------------------------

/**
 * Options for {@link createLdtkRoomCache}.
 *
 * Player dimensions are expressed as a function of the level's tile size so a
 * single cache can serve rooms of differing grid sizes (the adversarial
 * fixture mixes 8 px levels of differing height). When omitted, the defaults
 * are the Celerock body: `0.5 × tileSize` wide, `1.5 × tileSize` tall.
 */
export interface LdtkRoomCacheOptions {
  /** Override the default platformer config for every compiled room. */
  readonly config?: Readonly<PlatformerConfig>;
  /** Player body width as a function of the level tile size (default `0.5 × ts`). */
  readonly playerWidthForTileSize?: (tileSize: number) => number;
  /** Player body height as a function of the level tile size (default `1.5 × ts`). */
  readonly playerHeightForTileSize?: (tileSize: number) => number;
  /** Override start-room selection (the iid to return from `getStartRoom`). */
  readonly startLevelIid?: string;
  /** Spawn resolution forwarded to {@link compileLdtkRoom} (default `'rest-on-surface'`). */
  readonly spawnResolution?: 'actor-top-left' | 'rest-on-surface';
}

/**
 * Outcome of {@link LdtkRoomCache.getStartRoom}. `ok: true` carries the start
 * room; `ok: false` carries diagnostics (no room is ever fabricated).
 */
export type GetLdtkStartRoomResult =
  | { readonly ok: true; readonly room: CompiledLdtkRoom }
  | { readonly ok: false; readonly diagnostics: readonly CompileDiagnostic[] };

/**
 * A lazy, identity-preserving cache of compiled rooms over an LDtk project.
 *
 * Created by {@link createLdtkRoomCache}. Rooms are compiled on first access
 * via {@link compileLdtkRoom} and cached; `get(iid)` returns the SAME immutable
 * instance on every subsequent call. `getStartRoom()` resolves the project's
 * start room without ever fabricating a `(0, 0)` room — if no level has an
 * authored spawn it returns `{ ok: false, diagnostics }`.
 */
export interface LdtkRoomCache {
  /** `true` iff a level with this iid exists in the project (compiled or not). */
  has(iid: string): boolean;
  /**
   * Get the compiled room for `iid`, compiling lazily on first access and
   * returning the SAME immutable instance thereafter.
   *
   * Throws a descriptive `Error` for an iid NOT present in the project — that
   * is a programmer error, not a recoverable data condition. (Use
   * {@link LdtkRoomCache.has} to probe first when the iid is untrusted.)
   */
  get(iid: string): CompiledLdtkRoom;
  /** Drop all cached rooms; subsequent `get` calls recompile. */
  clear(): void;
  /**
   * Resolve the project's start room. Selection order:
   *   1. `options.startLevelIid` (explicit override), if present in the project;
   *   2. otherwise, the FIRST level (in project order) with an authored spawn
   *      (`compileLdtkRoom(...).spawn.source === 'authored'`).
   * If neither yields a room, returns `{ ok: false, diagnostics }` with an
   * error — never fabricates a `(0, 0)` room. Never throws.
   */
  getStartRoom(): GetLdtkStartRoomResult;
}

/**
 * Resolve every level in a project (top-level `levels` + each world's levels)
 * into a stable `iid → level` map. Insertion order is top-level first, then
 * worlds — so iteration order matches how a reader scans the project.
 */
function collectLevelsByIid(project: LdtkProject): Map<string, LdtkLevel> {
  const byIid = new Map<string, LdtkLevel>();
  for (const level of project.levels) {
    if (level && typeof level.iid === 'string') byIid.set(level.iid, level);
  }
  for (const world of project.worlds) {
    for (const level of world.levels) {
      if (level && typeof level.iid === 'string') byIid.set(level.iid, level);
    }
  }
  return byIid;
}

/** A level's tile size (first layer with a positive grid size), else 16. */
function tileSizeOfLevel(level: LdtkLevel): number {
  return (
    level.layerInstances?.find((l) => l.__gridSize > 0)?.__gridSize ?? 16
  );
}

/**
 * Create a lazy {@link LdtkRoomCache} over an LDtk project.
 *
 * Rooms are compiled via {@link compileLdtkRoom} on first `get`/`getStartRoom`
 * access. The cache holds the immutable {@link CompiledLdtkRoom} instances and
 * returns them by reference on revisit (`===` stable).
 *
 * Default player dimensions are derived from each level's tile size
 * (`0.5 × tileSize` wide, `1.5 × tileSize` tall — the Celerock body); override
 * per tile size via {@link LdtkRoomCacheOptions.playerWidthForTileSize} /
 * {@link LdtkRoomCacheOptions.playerHeightForTileSize}.
 *
 * Pure construction: the cache mutates only its own internal map; the input
 * project is never modified. Never throws.
 *
 * @param project - The whole LDtk project to cache rooms for.
 * @param options - Optional config / dimension callbacks / start-room override.
 * @returns A {@link LdtkRoomCache}.
 */
export function createLdtkRoomCache(
  project: LdtkProject,
  options?: LdtkRoomCacheOptions,
): LdtkRoomCache {
  const levelsByIid = collectLevelsByIid(project);
  const cache = new Map<string, CompiledLdtkRoom>();

  const compileRoom = (level: LdtkLevel): CompiledLdtkRoom => {
    const tileSize = tileSizeOfLevel(level);
    const playerWidth =
      options?.playerWidthForTileSize?.(tileSize) ?? 0.5 * tileSize;
    const playerHeight =
      options?.playerHeightForTileSize?.(tileSize) ?? 1.5 * tileSize;
    return compileLdtkRoom(level, project, {
      ...(options?.config !== undefined ? { config: options.config } : {}),
      playerWidth,
      playerHeight,
      ...(options?.spawnResolution !== undefined
        ? { spawnResolution: options.spawnResolution }
        : {}),
    });
  };

  function has(iid: string): boolean {
    return levelsByIid.has(iid);
  }

  function get(iid: string): CompiledLdtkRoom {
    const cached = cache.get(iid);
    if (cached !== undefined) return cached;
    const level = levelsByIid.get(iid);
    if (level === undefined) {
      throw new Error(
        `createLdtkRoomCache.get: unknown level iid "${iid}" (not present in project)`,
      );
    }
    const compiled = compileRoom(level);
    cache.set(iid, compiled);
    return compiled;
  }

  function clear(): void {
    cache.clear();
  }

  function getStartRoom(): GetLdtkStartRoomResult {
    try {
      if (options?.startLevelIid !== undefined) {
        const level = levelsByIid.get(options.startLevelIid);
        if (level === undefined) {
          return {
            ok: false,
            diagnostics: [
              {
                severity: 'error',
                message: `startLevelIid "${options.startLevelIid}" does not match any level in the project`,
              },
            ],
          };
        }
        return { ok: true, room: get(level.iid) };
      }
      // First level (in project order) with an authored spawn.
      for (const level of levelsByIid.values()) {
        const room = get(level.iid);
        if (room.spawn.source === 'authored') {
          return { ok: true, room };
        }
      }
      return {
        ok: false,
        diagnostics: [
          {
            severity: 'error',
            message:
              'no level with an authored spawn found in project (set options.startLevelIid or author a Player/Spawn entity)',
          },
        ],
      };
    } catch (err) {
      return {
        ok: false,
        diagnostics: [
          {
            severity: 'error',
            message: `getStartRoom failed: ${describeError(err)}`,
          },
        ],
      };
    }
  }

  return { has, get, clear, getStartRoom };
}
