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
} from '../level/types';
import { LEVEL_VERSION } from '../level/constants';
import type { GeneratedTileSemantics } from '../level/tile-semantics';
import type {
  LdtkEntityInstance,
  LdtkFieldInstance,
  LdtkLayerInstance,
  LdtkLevel,
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

/** Outcome of translating an LDtk level into the engine schema. */
export interface LdtkTranslateResult {
  /** The translated level, or `undefined` on hard failure. */
  readonly level?: LevelData;
  /** Tile semantics derived from the IntGrid layer. */
  readonly tileSemantics: GeneratedTileSemantics;
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
   */
  readonly solidValue?: number;
  /** Override the passthrough IntGrid value (default `2`). */
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
 * Translate an LDtk level into the engine's {@link LevelData} schema.
 *
 * The level's first `IntGrid` layer becomes {@link TileGrid}. The shapes
 * already match exactly (flat row-major, `0` = empty), so this is a copy
 * plus a `tileSize`/`width`/`height`/`spawn` derivation. Entities are
 * mapped via {@link LDTK_DEFAULT_ENTITY_MAP} (overridable).
 *
 * **Never throws.** Malformed entities emit warnings and are skipped;
 * structural failures (no IntGrid layer) emit errors.
 *
 * @example
 * ```ts
 * const { ok, project } = parseLdtkProject(text);
 * if (!ok || !project) throw new Error('bad ldtk');
 * const { level, tileSemantics } = ldtkLevelToLevelData(project.levels[0]);
 * const result = validateLevel(level);
 * ```
 */
export function ldtkLevelToLevelData(
  level: LdtkLevel,
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

  // Tile semantics: solidValue → solid, passthroughValue → passthrough.
  // Any other non-zero values present in the grid are also treated as solid
  // (best-effort) so levels with multi-value IntGrids still collide.
  const presentValues = new Set<number>();
  for (const v of data) if (v !== 0) presentValues.add(v);
  const solid = [...presentValues].filter((v) => v !== passthroughValue);
  if (!solid.includes(solidValue) && presentValues.size === 0) solid.push(solidValue);
  const passthrough = presentValues.has(passthroughValue) ? [passthroughValue] : [];
  const tileSemantics: GeneratedTileSemantics = { solid, passthrough };

  // Entities — collect from every Entities layer.
  const entityMap = options.entityMap ?? LDTK_DEFAULT_ENTITY_MAP;
  const entities: LevelEntity[] = [];
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
  return { level: ok ? result : undefined, tileSemantics, diagnostics };
}
