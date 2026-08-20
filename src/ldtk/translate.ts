/**
 * Translate `.ldtk` levels into the engine's {@link LevelData} schema.
 *
 * LDtk's `IntGrid` layer maps 1:1 onto the engine's {@link TileGrid}
 * (flat row-major array, `0` = empty). LDtk entities map onto the
 * engine's closed {@link LevelEntity} union, with a `'trigger'` escape
 * hatch for unknown identifiers (the recommended extension point for
 * consumer-specific LDtk entities).
 *
 * Determinism note: pure functions over plain data; no `Math.random`,
 * no `Date.now`, never throws.
 *
 * @module
 */

import type {
  CollectibleProps,
  EntityId,
  LevelData,
  LevelEntity,
  LevelRect,
  SpringProps,
} from '../level/types';
import { LEVEL_VERSION } from '../level/constants';
import type { GeneratedTileSemantics } from '../level/tile-semantics';
import type {
  LdtkEntityDef,
  LdtkEntityInstance,
  LdtkFieldInstance,
  LdtkLayerDef,
  LdtkLayerInstance,
  LdtkLevel,
  LdtkProject,
  LdtkTileRenderMode,
} from './types';

/**
 * Maps an LDtk entity identifier to an engine {@link LevelEntity} variant.
 *
 * The default map (`LDTK_DEFAULT_ENTITY_MAP`) covers common platformer
 * identifiers. Unknown identifiers fall through to `'trigger'` (see
 * {@link LdtkEntityFallback}), which preserves the LDtk identifier and
 * field instances in `params` so no entity is silently dropped.
 */
export interface LdtkEntityMap {
  /**
   * Resolve an LDtk `__identifier` to an engine entity kind, or return
   * `null` to use the `'trigger'` fallback. Called for every entity.
   * Never throws.
   */
  readonly resolve: (identifier: string, tags: readonly string[]) =>
    LevelEntity['kind'] | null;
}

/** A single diagnostic produced during translation. */
export interface LdtkTranslateDiagnostic {
  readonly path: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

/**
 * The authored display art for one translated entity — its LDtk `__tile`
 * together with everything {@link drawLdtkEntityTile} needs to blit it.
 *
 * This is the association a consumer CANNOT reconstruct after the fact. The
 * translated {@link LevelEntity} and the authored art live on opposite sides of
 * translation (engine ids vs LDtk instances), so a build that wants authored
 * entity art next to engine entities has to re-walk the raw level and re-match
 * instances to translated entities by rect — a fragile key with two shipped
 * failure modes: a room slide draws TWO rooms in one frame, so an index built
 * for the active room misses the outgoing room's entities (they fall back to
 * `DEFAULT_ENTITY_PALETTE` and flash the fallback shape for the length of the
 * transition), and rects are room-LOCAL, so two rooms sharing a local rect
 * silently resolve EACH OTHER's tiles instead of missing. Keyed by the engine
 * {@link EntityId} instead, both are structurally impossible: the id is unique
 * per translated entity and the lookup cannot cross rooms.
 *
 * Produced by {@link ldtkLevelToLevelData} as the `entityArt` side channel,
 * carried onto {@link CompiledLdtkRoom} as `room.entityArt`, and consumed as
 * `room.entityArt.get(entity.id)` inside a `drawLevelEntity` override.
 */
export interface LdtkEntityArt {
  /** The instance's authored display tile, copied (never aliased) from `__tile`. */
  readonly tile: NonNullable<LdtkEntityInstance['__tile']>;
  /**
   * The def's authored render mode for resized instances. `undefined` when the
   * def could not be resolved (no project, or an instance whose `defUid` has no
   * matching def) — pass it through to {@link drawLdtkEntityTile}, whose
   * omitted-mode geometry heuristic is exactly the right fallback.
   */
  readonly tileRenderMode: LdtkTileRenderMode | undefined;
  /** The def's nine-slice borders, or `null` (only meaningful for `NineSlice`). */
  readonly nineSliceBorders: readonly [number, number, number, number] | null;
}

/** Outcome of translating an LDtk level into the engine schema. */
export interface LdtkTranslateResult {
  /** The translated level, or `undefined` on hard failure. */
  readonly level?: LevelData;
  /** Tile semantics derived from the IntGrid layer. */
  readonly tileSemantics: GeneratedTileSemantics;
  /**
   * Authored display art per translated entity, keyed by the entity's ENGINE
   * {@link EntityId} — see {@link LdtkEntityArt}. An entry exists iff the
   * entity translated AND has an authored `__tile`; a missing key means "the
   * entity renders as its engine shape" (the override returns `false`).
   */
  readonly entityArt: ReadonlyMap<EntityId, LdtkEntityArt>;
  /** Diagnostics (errors and warnings). */
  readonly diagnostics: readonly LdtkTranslateDiagnostic[];
}

/**
 * Options for {@link ldtkLevelToLevelData}.
 */
export interface LdtkTranslateOptions {
  /**
   * Override the entity identifier → kind map. Defaults to
   * {@link LDTK_DEFAULT_ENTITY_MAP}.
   */
  readonly entityMap?: LdtkEntityMap;
  /**
   * Override which layer identifier is treated as the collision IntGrid.
   * Default: the first `IntGrid` layer in the level.
   */
  readonly collisionLayerIdentifier?: string;
  /**
   * Override the solid IntGrid value (default `1`). Passthrough is `2`.
   * Values ≥ 1 other than these map to solid by default.
   *
   * **Fallback only.** When {@link ldtkLevelToLevelData} is called with a
   * `project`, solidity is derived from IntGrid value names — every non-zero
   * value is solid unless its name contains `'passthrough'`. This option and
   * {@link LdtkTranslateOptions.passthroughValue} apply only when no `project`
   * is supplied (or it declares no passthrough-named value).
   */
  readonly solidValue?: number;
  /**
   * Override the passthrough IntGrid value (default `2`).
   *
   * **Fallback only** — see {@link LdtkTranslateOptions.solidValue}.
   */
  readonly passthroughValue?: number;
}

/** Default LDtk entity identifier → engine kind resolver. */
export const LDTK_DEFAULT_ENTITY_MAP: LdtkEntityMap = {
  resolve(identifier) {
    const id = identifier.toLowerCase();
    if (id === 'player' || id === 'spawn' || id === 'start') return 'spawn';
    if (id === 'exit' || id === 'door' || id === 'goal' || id === 'end') return 'exit';
    if (id === 'coin') return 'collectible';
    if (id === 'gem' || id === 'diamond' || id === 'jewel') return 'collectible';
    if (id === 'key') return 'collectible';
    if (id === 'spike' || id === 'spikes' || id === 'hazard' || id === 'lava' || id === 'saw') return 'hazard';
    if (id === 'enemy' || id.startsWith('enemy_')) return 'enemy';
    if (id === 'movingplatform' || id === 'moving_platform' || id === 'movingplatforms') return 'movingPlatform';
    if (id === 'platform') return 'platform';
    if (id === 'passthrough' || id === 'oneway' || id === 'one_way_platform') return 'passthrough';
    // Phase 8 trigger volumes. `spring`/`superspring` → spring (power inferred
    // from the identifier in buildEntityProps); `dashrefill`/`dashcrystal`/
    // `refill` → dashRefill. Without these entries the runtime never sees the
    // dedicated kinds (it already handles them — they just never arrived).
    if (id === 'spring' || id === 'superspring') return 'spring';
    if (id === 'dashrefill' || id === 'dashcrystal' || id === 'refill') return 'dashRefill';
    if (id === 'decoration' || id === 'deco' || id === 'prop') return 'decoration';
    if (id === 'trap') return 'trap';
    return null;
  },
};

/** Read a field value by identifier from an LDtk field list. */
function fieldValue(fields: readonly LdtkFieldInstance[], name: string): unknown {
  for (const f of fields) {
    if (f.__identifier === name) return f.__value;
  }
  return undefined;
}

function boolField(fields: readonly LdtkFieldInstance[], name: string, fallback = false): boolean {
  const v = fieldValue(fields, name);
  return typeof v === 'boolean' ? v : fallback;
}

function numField(fields: readonly LdtkFieldInstance[], name: string, fallback: number): number {
  const v = fieldValue(fields, name);
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function strField(fields: readonly LdtkFieldInstance[], name: string, fallback = ''): string {
  const v = fieldValue(fields, name);
  return typeof v === 'string' ? v : fallback;
}

/** Build a {@link LevelRect} from an LDtk entity (pivot already applied by LDtk). */
function entityRect(e: LdtkEntityInstance): LevelRect {
  return { x: e.px[0], y: e.px[1], width: e.width, height: e.height };
}

/** Translate a single LDtk entity into an engine {@link LevelEntity}. */
export function translateLdtkEntity(
  entity: LdtkEntityInstance,
  id: EntityId,
  entityMap: LdtkEntityMap,
  diagnostic: (message: string) => void,
): LevelEntity | undefined {
  const rect = entityRect(entity);
  const fields = entity.fieldInstances;
  const resolved = entityMap.resolve(entity.__identifier, entity.__tags);
  const kind = resolved ?? 'trigger';
  const props = buildEntityProps(kind, entity, fields, diagnostic);
  if (props === undefined) return undefined;
  return { id, kind, rect, props } as LevelEntity;
}

/** Build the kind-specific props for a translated entity. */
function buildEntityProps(
  kind: LevelEntity['kind'],
  entity: LdtkEntityInstance,
  fields: readonly LdtkFieldInstance[],
  diagnostic: (message: string) => void,
): LevelEntity['props'] | undefined {
  const idLower = entity.__identifier.toLowerCase();
  switch (kind) {
    case 'spawn':
      return {};
    case 'exit':
      return {
        isTrap: boolField(fields, 'isTrap', strField(fields, 'trap', '').toLowerCase() === 'true'),
        locked: boolField(fields, 'locked', boolField(fields, 'requiresKey', false)),
      };
    case 'platform':
      return {};
    case 'passthrough':
      return {};
    case 'hazard':
      return {};
    case 'spring': {
      // Power: prefer an explicit `power` field (an LDtk enum/string
      // `'super'`/`'normal'`); otherwise infer from the original identifier —
      // `SuperSpring` → `'super'`, plain `Spring` → `'normal'`. The compile
      // path reads `props.power` to pick `springBounceVy` vs
      // `springSuperBounceVy`.
      const powerField = strField(fields, 'power', '').toLowerCase();
      const power: SpringProps['power'] =
        powerField === 'super' || idLower === 'superspring' ? 'super' : 'normal';
      return { power };
    }
    case 'dashRefill':
      // The runtime only keys off `entity.kind === 'dashRefill'`; no props.
      return {};
    case 'collectible': {
      const kindMap: Record<string, CollectibleProps['kind']> = {
        coin: 'coin', coins: 'coin',
        gem: 'gem', diamond: 'gem', jewel: 'gem',
        key: 'key',
      };
      const collectibleKind = kindMap[idLower] ?? 'coin';
      const value = numField(fields, 'value', 0);
      return {
        kind: collectibleKind,
        value: value >= 0 ? value : undefined,
        persists: boolField(fields, 'persists', false) || undefined,
      };
    }
    case 'decoration':
      return {
        sprite: strField(fields, 'sprite', entity.__identifier),
        flipX: boolField(fields, 'flipX', false) || undefined,
      };
    case 'trap':
      return {
        type: strField(fields, 'type', entity.__identifier),
        params: fieldsToParams(fields),
      };
    case 'trigger':
      return {
        action: entity.__identifier,
        // The authored field values as a clean top-level record — the
        // supported read surface for custom-entity recipes (`props.fields.tiletype`),
        // so no consumer reaches into `params.fieldInstances` again.
        fields: fieldsToParams(fields),
        params: { identifier: entity.__identifier, tags: [...entity.__tags], fieldInstances: fieldsToParams(fields) },
      };
    case 'movingPlatform': {
      const speed = numField(fields, 'speed', 30);
      const path = readPathField(fields) ?? [];
      const loopMode = strField(fields, 'loopMode', 'pingpong') === 'loop' ? 'loop' : 'pingpong';
      return { speed, path, loopMode };
    }
    case 'enemy': {
      const archetype = strField(fields, 'archetype', idLower.startsWith('enemy_') ? idLower.slice('enemy_'.length) : entity.__identifier);
      return { archetype, params: fieldsToParams(fields) };
    }
    default:
      diagnostic(`unhandled kind ${kind} for entity ${entity.__identifier}`);
      return undefined;
  }
}

/** Convert LDtk field instances into a plain params record (loses type info). */
function fieldsToParams(fields: readonly LdtkFieldInstance[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f.__identifier] = f.__value;
  return out;
}

/** Read a `path` field (array of `[x, y]` or LDtk `Point`s). */
function readPathField(fields: readonly LdtkFieldInstance[]): { x: number; y: number }[] | undefined {
  const v = fieldValue(fields, 'path');
  if (!Array.isArray(v)) return undefined;
  const out: { x: number; y: number }[] = [];
  for (const p of v) {
    if (Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number') {
      out.push({ x: p[0], y: p[1] });
    } else if (p && typeof p === 'object' && 'cx' in p && 'cy' in p) {
      // LDtk GridPoint — store grid coords; consumer rescales by gridSize.
      out.push({ x: (p as { cx: number }).cx, y: (p as { cy: number }).cy });
    }
  }
  return out;
}

/** Find the collision IntGrid layer for a level. */
function findCollisionLayer(
  level: LdtkLevel,
  identifierOverride?: string,
): LdtkLayerInstance | undefined {
  const layers = level.layerInstances;
  if (layers === null) return undefined;
  if (identifierOverride !== undefined) {
    return layers.find((l) => l.__identifier === identifierOverride && l.__type === 'IntGrid');
  }
  return layers.find((l) => l.__type === 'IntGrid');
}

/**
 * Look up a layer instance's definition in `project.defs.layers` by uid.
 * Returns `undefined` when the project or matching def is absent.
 */
function layerDefOf(
  project: LdtkProject | undefined,
  layer: LdtkLayerInstance | undefined,
): LdtkLayerDef | undefined {
  if (project === undefined || layer === undefined) return undefined;
  return project.defs.layers.find((d) => d.uid === layer.layerDefUid);
}

/**
 * Derive passthrough IntGrid values by name from the collision layer's
 * definition. Any declared value whose identifier contains `'passthrough'`
 * (case-insensitive) is collected. Returns the set, or `undefined` when there
 * is no project, no matching layer def, or no value named passthrough — in
 * which case the caller falls back to the integer options.
 */
function passthroughValuesFromNames(
  project: LdtkProject | undefined,
  collision: LdtkLayerInstance | undefined,
): Set<number> | undefined {
  const def = layerDefOf(project, collision);
  const values = def?.intGridValues;
  if (values === undefined) return undefined;
  const passthrough = new Set<number>();
  for (const v of values) {
    if (v.identifier !== null && v.identifier.toLowerCase().includes('passthrough')) {
      passthrough.add(v.value);
    }
  }
  return passthrough.size > 0 ? passthrough : undefined;
}

/**
 * Derive ladder IntGrid values by name from the collision layer's definition.
 * Any declared value whose identifier is exactly `'ladder'` (case-insensitive)
 * is collected — the exact match mirrors {@link ladderValueFromProject} in the
 * showcase. Ladder values are climb space, not collision, so the caller excludes
 * them from `solid` (and they never become `passthrough`). Returns the set, or
 * `undefined` when there is no project, no matching layer def, or no value named
 * ladder.
 */
function ladderValuesFromNames(
  project: LdtkProject | undefined,
  collision: LdtkLayerInstance | undefined,
): Set<number> | undefined {
  const def = layerDefOf(project, collision);
  const values = def?.intGridValues;
  if (values === undefined) return undefined;
  const ladder = new Set<number>();
  for (const v of values) {
    if (v.identifier !== null && v.identifier.toLowerCase() === 'ladder') {
      ladder.add(v.value);
    }
  }
  return ladder.size > 0 ? ladder : undefined;
}

/**
 * Translate an LDtk level into the engine's {@link LevelData} schema.
 *
 * The level's first `IntGrid` layer becomes {@link TileGrid}. The shapes
 * already match exactly (flat row-major, `0` = empty), so this is a copy
 * plus a `tileSize`/`width`/`height`/`spawn` derivation. Entities are
 * mapped via {@link LDTK_DEFAULT_ENTITY_MAP} (overridable).
 *
 * **Tile semantics.** When `project` is supplied, solidity is derived from the
 * collision layer's declared IntGrid value names: every non-zero value is
 * treated as solid unless its identifier contains `'passthrough'`
 * (case-insensitive), in which case it becomes a one-way platform, or is exactly
 * `'ladder'` (case-insensitive), in which case it is climb space —
 * non-colliding, excluded from `solid`, and recorded in `tileSemantics.ladder`
 * so the runtime can overlay per-cell ladder solids. This lets a project name a
 * value `'passthrough'` or `'ladder'` (any case, any integer) rather than
 * reserving magic integers. Without `project`, the legacy integer fallback
 * applies (`solidValue` default `1`, `passthroughValue` default `2`).
 *
 * **Never throws.** Malformed entities emit warnings and are skipped;
 * structural failures (no IntGrid layer) emit errors.
 *
 * @param level - The LDtk level to translate.
 * @param project - Optional whole project. When supplied, enables name-driven
 *   tile semantics (see above). The showcase always passes this.
 * @param options - Translation overrides.
 *
 * @example
 * ```ts
 * const { ok, project } = parseLdtkProject(text);
 * if (!ok || !project) throw new Error('bad ldtk');
 * const { level, tileSemantics } = ldtkLevelToLevelData(project.levels[0], project);
 * const result = validateLevel(level);
 * ```
 */
export function ldtkLevelToLevelData(
  level: LdtkLevel,
  project?: LdtkProject,
  options: Readonly<LdtkTranslateOptions> = {},
): LdtkTranslateResult {
  const diagnostics: LdtkTranslateDiagnostic[] = [];
  const warn = (path: string, message: string): void => {
    diagnostics.push({ path, message, severity: 'warning' });
  };
  const error = (path: string, message: string): void => {
    diagnostics.push({ path, message, severity: 'error' });
  };

  const tileSize = level.layerInstances?.find((l) => l.__gridSize > 0)?.__gridSize ?? 16;
  const collision = findCollisionLayer(level, options.collisionLayerIdentifier);
  if (collision === undefined) {
    error(`${level.identifier}.layerInstances`, 'no IntGrid collision layer found');
  }

  const solidValue = options.solidValue ?? 1;
  const passthroughValue = options.passthroughValue ?? 2;

  // Build TileGrid from the collision IntGrid (or an empty grid as fallback).
  let data: number[] = [];
  let cols = 0;
  let rows = 0;
  if (collision !== undefined && collision.intGridCsv !== undefined) {
    data = [...collision.intGridCsv];
    cols = collision.__cWid;
    rows = collision.__cHei;
  } else if (level.pxWid > 0 && level.pxHei > 0 && tileSize > 0) {
    cols = Math.floor(level.pxWid / tileSize);
    rows = Math.floor(level.pxHei / tileSize);
    data = new Array(cols * rows).fill(0);
  }

  // Tile semantics. When a project is supplied, derive solidity from the
  // collision layer's declared value names: every non-zero value is solid
  // unless its identifier contains 'passthrough' (one-way platform) or is
  // exactly 'ladder' (climb space — non-colliding; the runtime overlays ladder
  // cells separately). Without a project, fall back to the integer options so
  // legacy callers behave as before. Supplying a project with no
  // passthrough/ladder-named value means "none of that kind" — the integer
  // defaults are NOT re-applied, since the names are the source of truth.
  const presentValues = new Set<number>();
  for (const v of data) if (v !== 0) presentValues.add(v);
  let solid: number[];
  let passthrough: number[];
  let ladder: number[] = [];
  if (project !== undefined) {
    const namedPassthrough = passthroughValuesFromNames(project, collision);
    const namedLadder = ladderValuesFromNames(project, collision);
    // A value is solid unless it is named passthrough or ladder. Ladder and
    // passthrough are mutually exclusive by name (ladder uses an exact match),
    // so a value won't appear in both — but filter defensively anyway.
    solid = [...presentValues].filter(
      (v) =>
        (namedPassthrough === undefined || !namedPassthrough.has(v)) &&
        (namedLadder === undefined || !namedLadder.has(v)),
    );
    passthrough = namedPassthrough === undefined
      ? []
      : [...presentValues].filter((v) => namedPassthrough.has(v));
    ladder = namedLadder === undefined ? [] : [...presentValues].filter((v) => namedLadder.has(v));
  } else {
    solid = [...presentValues].filter((v) => v !== passthroughValue);
    if (!solid.includes(solidValue) && presentValues.size === 0) solid.push(solidValue);
    passthrough = presentValues.has(passthroughValue) ? [passthroughValue] : [];
  }
  const tileSemantics: GeneratedTileSemantics =
    ladder.length > 0 ? { solid, passthrough, ladder } : { solid, passthrough };

  // Entities — collect from every Entities layer.
  const entityMap = options.entityMap ?? LDTK_DEFAULT_ENTITY_MAP;
  const entities: LevelEntity[] = [];
  const entityArt = new Map<EntityId, LdtkEntityArt>();
  // Def lookup for authored display art (mode + nine-slice borders live on the
  // DEF, the tile on the instance — the side channel needs both at once).
  const entityDefs = new Map<number, LdtkEntityDef>();
  for (const def of project?.defs.entities ?? []) {
    if (def && typeof def.uid === 'number') entityDefs.set(def.uid, def);
  }
  let nextId: EntityId = 1;
  let spawnX = 0;
  let spawnY = 0;
  let spawnFound = false;
  const entityLayers = (level.layerInstances ?? []).filter((l) => l.__type === 'Entities');
  for (const layer of entityLayers) {
    for (const e of layer.entityInstances ?? []) {
      const translated = translateLdtkEntity(e, nextId, entityMap, (message) =>
        warn(`${level.identifier}.entities[${e.__identifier}]`, message),
      );
      if (translated === undefined) continue;
      if (translated.kind === 'spawn' && !spawnFound) {
        spawnX = translated.rect.x + translated.rect.width / 2;
        spawnY = translated.rect.y + translated.rect.height;
        spawnFound = true;
      }
      entities.push(translated);
      if (e.__tile != null) {
        const def = entityDefs.get(e.defUid);
        entityArt.set(translated.id, {
          // Copied, not aliased: the map must not share structure with the
          // input level (a consumer mutating an entry cannot corrupt the source).
          tile: {
            tilesetUid: e.__tile.tilesetUid,
            x: e.__tile.x,
            y: e.__tile.y,
            w: e.__tile.w,
            h: e.__tile.h,
          },
          tileRenderMode: def?.tileRenderMode,
          nineSliceBorders: def?.nineSliceBorders ?? null,
        });
      }
      nextId++;
    }
  }

  // Ensure exactly one spawn (LevelData invariant). If none found, place at
  // a sensible default and warn — the consumer can fix it in the editor.
  if (!spawnFound) {
    spawnX = tileSize;
    spawnY = Math.max(0, (rows - 2) * tileSize);
    warn(`${level.identifier}`, 'no spawn entity found; using default spawn');
  }

  const result: LevelData = {
    version: LEVEL_VERSION,
    id: level.identifier,
    name: level.identifier,
    width: level.pxWid,
    height: level.pxHei,
    tileSize,
    spawn: { x: spawnX, y: spawnY },
    tiles: { data, cols, rows, tileSize },
    entities,
    nextEntityId: nextId,
  };

  const ok = diagnostics.every((d) => d.severity !== 'error');
  return { level: ok ? result : undefined, tileSemantics, entityArt, diagnostics };
}
