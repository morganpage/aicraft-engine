/**
 * Defensive level validation against the {@link LevelData} schema.
 *
 * Returns a {@link ValidationResult}; **never throws.** Structural and
 * semantic checks run against the {@link LevelData} shape. Unknown top-level
 * fields and unknown entity props do NOT error (forward-compat: a v2 schema
 * may add fields unknown to a v1 validator).
 *
 * `valid === true` iff there are zero `severity: 'error'` diagnostics.
 * `severity: 'warning'` diagnostics are reported but do not affect `valid`.
 *
 * @module
 */

import type { ValidationError, ValidationResult } from './types';

/** Truthy narrow for a plain non-null object record (not an array). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** True iff `v` is a finite `number`. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** True iff `v` is a finite, strictly positive `number`. */
function isPositiveFinite(v: unknown): v is number {
  return isFiniteNumber(v) && v > 0;
}

/** True iff `v` is a finite positive integer. */
function isPositiveInteger(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v > 0;
}

/** Build a {@link ValidationError}. */
function err(path: string, message: string, severity: 'error' | 'warning' = 'error'): ValidationError {
  return { path, message, severity };
}

/**
 * Validate a level against the {@link LevelData} schema. **Never throws.**
 *
 * Checks:
 *  - **Structural**: `version` positive integer; `id`, `name` strings;
 *    `width`, `height`, `tileSize` positive finite numbers; `spawn` has
 *    numeric `x`, `y`; `tiles` has matching `cols * rows === data.length`
 *    and `cols`, `rows`, `tileSize` positive integers; `entities` is an
 *    array; `nextEntityId` is an integer ≥ 1.
 *  - **Bounds**: `spawn.x` / `spawn.y` within `[0, width]` / `[0, height]`
 *    (warning if outside, error if non-numeric); each entity's `rect.x`,
 *    `rect.y` within `[0, width]` / `[0, height]` (warning); `rect.width`
 *    and `rect.height` strictly positive (error).
 *  - **Uniqueness**: entity IDs unique (error on duplicates).
 *  - **Cardinality**: exactly one `kind: 'spawn'` entity (error if zero or
 *    more than one); at least one `kind: 'exit'` entity (error if zero).
 *  - **Per-kind prop shape**: documented fields exist with correct types
 *    (e.g. `exit` requires `isTrap: boolean`, `locked: boolean`;
 *    `movingPlatform` requires `speed: number`, `path: array of {x,y}`).
 *  - **Unknown properties**: do NOT error — forward-compatibility.
 *
 * @example
 * ```ts
 * const result = validateLevel(JSON.parse(rawJson));
 * if (!result.valid) {
 *   for (const e of result.errors) {
 *     if (e.severity === 'error') console.error(`${e.path}: ${e.message}`);
 *   }
 * }
 * ```
 *
 * @param level - Arbitrary input (typically a `JSON.parse` result).
 * @returns Validation result with diagnostics. Never throws.
 */
export function validateLevel(level: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isPlainObject(level)) {
    errors.push(err('', 'level must be a plain object'));
    return { valid: false, errors };
  }

  if (!isPositiveInteger(level.version)) {
    errors.push(err('version', 'version must be a positive integer'));
  }
  if (typeof level.id !== 'string') {
    errors.push(err('id', 'id must be a string'));
  }
  if (typeof level.name !== 'string') {
    errors.push(err('name', 'name must be a string'));
  }
  if (!isPositiveFinite(level.width)) {
    errors.push(err('width', 'width must be a positive finite number'));
  }
  if (!isPositiveFinite(level.height)) {
    errors.push(err('height', 'height must be a positive finite number'));
  }
  if (!isPositiveFinite(level.tileSize)) {
    errors.push(err('tileSize', 'tileSize must be a positive finite number'));
  }

  const width = isPositiveFinite(level.width) ? level.width : 0;
  const height = isPositiveFinite(level.height) ? level.height : 0;

  validateSpawn(level.spawn, width, height, errors);
  validateTiles(level.tiles, errors);
  validateEntities(level.entities, width, height, errors);

  if (!isPositiveInteger(level.nextEntityId)) {
    errors.push(err('nextEntityId', 'nextEntityId must be an integer >= 1'));
  }

  const valid = errors.every((e) => e.severity !== 'error');
  return { valid, errors };
}

function validateSpawn(
  spawn: unknown,
  width: number,
  height: number,
  errors: ValidationError[],
): void {
  if (!isPlainObject(spawn)) {
    errors.push(err('spawn', 'spawn must be an object with numeric x and y'));
    return;
  }
  const sx = spawn.x;
  const sy = spawn.y;
  if (!isFiniteNumber(sx)) {
    errors.push(err('spawn.x', 'spawn.x must be a finite number'));
  } else if (sx < 0 || sx > width) {
    errors.push(err('spawn.x', `spawn.x=${sx} is out of bounds [0, ${width}]`, 'warning'));
  }
  if (!isFiniteNumber(sy)) {
    errors.push(err('spawn.y', 'spawn.y must be a finite number'));
  } else if (sy < 0 || sy > height) {
    errors.push(err('spawn.y', `spawn.y=${sy} is out of bounds [0, ${height}]`, 'warning'));
  }
}

function validateTiles(tiles: unknown, errors: ValidationError[]): void {
  if (!isPlainObject(tiles)) {
    errors.push(err('tiles', 'tiles must be an object with cols, rows, tileSize, data'));
    return;
  }
  if (!isPositiveInteger(tiles.cols)) {
    errors.push(err('tiles.cols', 'tiles.cols must be a positive integer'));
  }
  if (!isPositiveInteger(tiles.rows)) {
    errors.push(err('tiles.rows', 'tiles.rows must be a positive integer'));
  }
  if (!isPositiveInteger(tiles.tileSize)) {
    errors.push(err('tiles.tileSize', 'tiles.tileSize must be a positive integer'));
  }
  if (!Array.isArray(tiles.data)) {
    errors.push(err('tiles.data', 'tiles.data must be an array of numbers'));
  } else if (isPositiveInteger(tiles.cols) && isPositiveInteger(tiles.rows)) {
    const expected = tiles.cols * tiles.rows;
    if (tiles.data.length !== expected) {
      errors.push(
        err(
          'tiles.data',
          `tiles.data length ${tiles.data.length} does not match cols*rows = ${expected}`,
        ),
      );
    }
  }
}

function validateEntities(
  entities: unknown,
  width: number,
  height: number,
  errors: ValidationError[],
): void {
  if (!Array.isArray(entities)) {
    errors.push(err('entities', 'entities must be an array'));
    return;
  }

  const seenIds = new Set<number>();
  let spawnCount = 0;
  let exitCount = 0;

  entities.forEach((entity, i) => {
    const base = `entities[${i}]`;
    if (!isPlainObject(entity)) {
      errors.push(err(base, 'entity must be a plain object'));
      return;
    }

    const id = entity.id;
    if (typeof id !== 'number' || !Number.isInteger(id)) {
      errors.push(err(`${base}.id`, 'entity id must be an integer'));
    } else if (seenIds.has(id)) {
      errors.push(err(`${base}.id`, `entity id ${id} is duplicated`));
    } else {
      seenIds.add(id);
    }

    const kind = entity.kind;
    if (typeof kind !== 'string') {
      errors.push(err(`${base}.kind`, 'entity kind must be a string'));
      return;
    }

    validateRect(entity.rect, `${base}.rect`, width, height, errors);

    const props = entity.props;
    const propsBase = `${base}.props`;
    if (!isPlainObject(props)) {
      errors.push(err(propsBase, 'entity props must be a plain object'));
    } else {
      validatePropsByKind(kind, props, propsBase, base, errors);
    }

    if (kind === 'spawn') spawnCount++;
    if (kind === 'exit') exitCount++;
  });

  if (spawnCount === 0) {
    errors.push(err('entities', 'level must contain exactly one spawn entity; found 0'));
  } else if (spawnCount > 1) {
    errors.push(
      err('entities', `level must contain exactly one spawn entity; found ${spawnCount}`),
    );
  }
  if (exitCount === 0) {
    errors.push(err('entities', 'level must contain at least one exit entity; found 0'));
  }
}

function validateRect(
  rect: unknown,
  base: string,
  width: number,
  height: number,
  errors: ValidationError[],
): void {
  if (!isPlainObject(rect)) {
    errors.push(err(base, 'rect must be an object with x, y, width, height'));
    return;
  }
  const rx = rect.x;
  const ry = rect.y;
  if (!isFiniteNumber(rx)) {
    errors.push(err(`${base}.x`, 'rect.x must be a finite number'));
  } else if (rx < 0 || rx > width) {
    errors.push(err(`${base}.x`, `rect.x=${rx} is out of bounds [0, ${width}]`, 'warning'));
  }
  if (!isFiniteNumber(ry)) {
    errors.push(err(`${base}.y`, 'rect.y must be a finite number'));
  } else if (ry < 0 || ry > height) {
    errors.push(err(`${base}.y`, `rect.y=${ry} is out of bounds [0, ${height}]`, 'warning'));
  }
  if (!isPositiveFinite(rect.width)) {
    errors.push(err(`${base}.width`, 'rect.width must be a positive finite number'));
  }
  if (!isPositiveFinite(rect.height)) {
    errors.push(err(`${base}.height`, 'rect.height must be a positive finite number'));
  }
}

function validatePropsByKind(
  kind: string,
  props: Record<string, unknown>,
  base: string,
  entityBase: string,
  errors: ValidationError[],
): void {
  switch (kind) {
    case 'spawn':
    case 'passthrough':
    case 'hazard':
      break;
    case 'exit':
      if (typeof props.isTrap !== 'boolean') {
        errors.push(err(`${base}.isTrap`, 'exit.isTrap must be a boolean'));
      }
      if (typeof props.locked !== 'boolean') {
        errors.push(err(`${base}.locked`, 'exit.locked must be a boolean'));
      }
      break;
    case 'platform':
      if (props.visual !== undefined && typeof props.visual !== 'string') {
        errors.push(err(`${base}.visual`, 'platform.visual must be a string or undefined'));
      }
      break;
    case 'trap':
      if (typeof props.type !== 'string') {
        errors.push(err(`${base}.type`, 'trap.type must be a string'));
      }
      if (!isPlainObject(props.params)) {
        errors.push(err(`${base}.params`, 'trap.params must be an object'));
      }
      break;
    case 'decoration':
      if (typeof props.sprite !== 'string') {
        errors.push(err(`${base}.sprite`, 'decoration.sprite must be a string'));
      }
      if (props.flipX !== undefined && typeof props.flipX !== 'boolean') {
        errors.push(err(`${base}.flipX`, 'decoration.flipX must be a boolean or undefined'));
      }
      break;
    case 'trigger':
      if (typeof props.action !== 'string') {
        errors.push(err(`${base}.action`, 'trigger.action must be a string'));
      }
      if (!isPlainObject(props.params)) {
        errors.push(err(`${base}.params`, 'trigger.params must be an object'));
      }
      break;
    case 'movingPlatform': {
      if (!isFiniteNumber(props.speed)) {
        errors.push(err(`${base}.speed`, 'movingPlatform.speed must be a finite number'));
      }
      if (!Array.isArray(props.path)) {
        errors.push(err(`${base}.path`, 'movingPlatform.path must be an array of {x,y}'));
      } else {
        (props.path as unknown[]).forEach((p, i) => {
          if (
            !isPlainObject(p) ||
            !isFiniteNumber((p as Record<string, unknown>).x) ||
            !isFiniteNumber((p as Record<string, unknown>).y)
          ) {
            errors.push(
              err(`${base}.path[${i}]`, 'movingPlatform.path items must have numeric x and y'),
            );
          }
        });
      }
      if (props.loopMode !== undefined && typeof props.loopMode !== 'string') {
        errors.push(
          err(`${base}.loopMode`, 'movingPlatform.loopMode must be a string or undefined'),
        );
      }
      break;
    }
    case 'enemy': {
      if (typeof props.archetype !== 'string') {
        errors.push(err(`${base}.archetype`, 'enemy.archetype must be a string'));
      }
      const params = props.params;
      const paramsBase = `${base}.params`;
      if (!isPlainObject(params)) {
        errors.push(err(paramsBase, 'enemy.params must be a plain object'));
        break;
      }
      // Built-in archetype contracts. Custom archetypes keep arbitrary params.
      if (props.archetype === 'spinny') {
        validateSpinnyParams(params, paramsBase, errors);
      } else if (props.archetype === 'turret') {
        validateTurretParams(params, paramsBase, errors);
      }
      break;
    }
    case 'collectible': {
      // Closed `CollectibleKind` sub-union (coin/gem/key) — rejects unknown
      // sub-kinds defensively at the schema boundary. Mirrors the approach
      // used by `EnemyProps.archetype` but with a closed set (not free-string)
      // so the renderer can dispatch by sub-kind without runtime fallbacks.
      const validKinds = new Set<string>(['coin', 'gem', 'key']);
      if (typeof props.kind !== 'string' || !validKinds.has(props.kind)) {
        errors.push(
          err(`${base}.kind`, 'collectible.kind must be one of "coin" | "gem" | "key"'),
        );
      }
      // `value` is optional; when present, must be a finite non-negative
      // number (coins can be worth 0 for tutorial/badge use-cases).
      if (
        props.value !== undefined &&
        !(typeof props.value === 'number' && Number.isFinite(props.value) && props.value >= 0)
      ) {
        errors.push(
          err(
            `${base}.value`,
            'collectible.value must be a finite non-negative number or undefined',
          ),
        );
      }
      // `persists` is optional; when present, must be a boolean. Absent
      // means `false` (per-run respawn, Mario-style default).
      if (props.persists !== undefined && typeof props.persists !== 'boolean') {
        errors.push(
          err(`${base}.persists`, 'collectible.persists must be a boolean or undefined'),
        );
      }
      // Forward-compat: unknown extra props are ignored (not rejected).
      break;
    }
    default:
      errors.push(err(entityBase, `unknown entity kind "${kind}"`));
      break;
  }
}

/**
 * Validate the built-in `'spinny'` archetype's optional params.
 * Unknown keys are forward-compat (ignored).
 */
function validateSpinnyParams(
  params: Record<string, unknown>,
  base: string,
  errors: ValidationError[],
): void {
  if (params.speed !== undefined && !isFiniteNumber(params.speed)) {
    errors.push(err(`${base}.speed`, 'spinny.params.speed must be a finite number or undefined'));
  }
  if (params.ledgeTurnAround !== undefined && typeof params.ledgeTurnAround !== 'boolean') {
    errors.push(
      err(`${base}.ledgeTurnAround`, 'spinny.params.ledgeTurnAround must be a boolean or undefined'),
    );
  }
  if (params.patrolPath !== undefined) {
    if (!Array.isArray(params.patrolPath)) {
      errors.push(
        err(`${base}.patrolPath`, 'spinny.params.patrolPath must be an array of {x,y} or undefined'),
      );
    } else {
      (params.patrolPath as unknown[]).forEach((p, i) => {
        if (
          !isPlainObject(p) ||
          !isFiniteNumber((p as Record<string, unknown>).x) ||
          !isFiniteNumber((p as Record<string, unknown>).y)
        ) {
          errors.push(
            err(`${base}.patrolPath[${i}]`, 'spinny.params.patrolPath items must have numeric x and y'),
          );
        }
      });
    }
  }
}

/**
 * Validate the built-in `'turret'` archetype's optional params.
 * Unknown keys are forward-compat (ignored).
 */
function validateTurretParams(
  params: Record<string, unknown>,
  base: string,
  errors: ValidationError[],
): void {
  const finiteKeys = ['fireRate', 'projectileSpeed', 'projectileSize', 'detectionRadius'] as const;
  for (const key of finiteKeys) {
    if (params[key] !== undefined && !isFiniteNumber(params[key])) {
      errors.push(
        err(`${base}.${key}`, `turret.params.${key} must be a finite number or undefined`),
      );
    }
  }
  if (params.aimDirection !== undefined) {
    const aim = params.aimDirection;
    if (
      !isPlainObject(aim) ||
      !isFiniteNumber((aim as Record<string, unknown>).x) ||
      !isFiniteNumber((aim as Record<string, unknown>).y)
    ) {
      errors.push(
        err(`${base}.aimDirection`, 'turret.params.aimDirection must be {x,y} with finite numbers or undefined'),
      );
    }
  }
  if (params.shootTo !== undefined) {
    const st = params.shootTo;
    if (
      !isPlainObject(st) ||
      !isFiniteNumber((st as Record<string, unknown>).x) ||
      !isFiniteNumber((st as Record<string, unknown>).y)
    ) {
      errors.push(
        err(`${base}.shootTo`, 'turret.params.shootTo must be {x,y} with finite numbers or undefined'),
      );
    }
  }
}
