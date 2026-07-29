/**
 * Enemy compilation and per-tick stepping.
 *
 * `compileEnemies` extracts all `'enemy'` entities from a `LevelData` and
 * produces `CompiledEnemy[]` — the runtime representation the game loop
 * steps each tick. `stepEnemies` advances all enemies via the behavior
 * registry, collecting spawned projectiles into a flat array.
 *
 * Determinism: pure data transforms. No `Math.random`, no `Date.now`,
 * no global mutable state, no DOM reads. Never mutates input. Never throws.
 *
 * @module
 */

import type { LevelData } from '../../level/types';
import type {
  CompiledEnemy,
  EnemyState,
  EnemyBehaviorRegistry,
  EnemyUpdateContext,
  ProjectileState,
} from './types';
import { CHARGER_HEIGHT, CHARGER_WIDTH } from '../../level/enemy-schema';

/**
 * Compile all `'enemy'` entities from a `LevelData` into `CompiledEnemy[]`.
 *
 * Each enemy entity's `rect.x` / `rect.y` become the initial `EnemyState`
 * position. The `archetype` and `params` are lifted from `entity.props`.
 *
 * Non-enemy entities are silently skipped. Entities with malformed rects
 * (non-finite coordinates) are silently skipped. Null/undefined level input
 * produces an empty array. Never throws.
 *
 * Pure: returns a fresh array; the input is never mutated.
 *
 * @param level - the level data to extract enemies from
 * @returns a fresh `CompiledEnemy[]` with one entry per valid enemy entity
 *
 * @example
 * ```ts
 * const enemies = compileEnemies(levelData);
 * // enemies[0].state.x === enemies[0].entity.rect.x
 * // enemies[0].archetype === enemies[0].entity.props.archetype
 * ```
 */
export function compileEnemies(level: LevelData): readonly CompiledEnemy[] {
  const result: CompiledEnemy[] = [];

  try {
    if (!level || !Array.isArray(level.entities)) return result;

    for (const entity of level.entities) {
      if (!entity || entity.kind !== 'enemy') continue;
      const r = entity.rect;
      if (!r) continue;
      const rx = Number(r.x);
      const ry = Number(r.y);
      const rw = Number(r.width);
      const rh = Number(r.height);
      if (!Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(rw) || !Number.isFinite(rh)) {
        continue;
      }

      const props = entity.props;
      const archetype = typeof props.archetype === 'string' ? props.archetype : 'spinny';
      if (
        archetype === 'charger' &&
        (rw !== CHARGER_WIDTH || rh !== CHARGER_HEIGHT)
      ) {
        continue;
      }
      const params = props.params && typeof props.params === 'object'
        ? props.params as Record<string, unknown>
        : {};

      const state: EnemyState = {
        x: rx,
        y: ry,
        vx: 0,
        vy: 0,
        facing: 1,
        alive: true,
        data: {},
      };

      result.push({
        id: entity.id,
        archetype,
        state,
        entity,
        params,
      });
    }
  } catch {
    // Defensive: never throw. Whatever was pushed so far is returned.
  }

  return result;
}

/**
 * Result of `stepEnemies`: the updated enemy descriptors plus any
 * projectiles spawned this tick.
 */
export interface StepEnemiesResult {
  /** Updated enemy descriptors (fresh array). */
  readonly enemies: readonly CompiledEnemy[];
  /** All projectiles spawned this tick (flat array from all enemies). */
  readonly projectiles: readonly ProjectileState[];
}

/**
 * Advance all enemies by one tick using the behavior registry.
 *
 * For each enemy, looks up the behavior handler by `archetype`, calls
 * `handler.step(state, ctx, params)`, and updates the `CompiledEnemy`
 * with the returned state. Any `projectile` in the step result is
 * collected into the returned `projectiles` array.
 *
 * Enemies whose archetype is not found in the registry are passed through
 * unchanged (no step, no projectile). Dead enemies (`alive: false`) are
 * also passed through unchanged.
 *
 * Pure: returns a fresh result; the input array is never mutated. Never throws.
 *
 * @param enemies - the current compiled enemies
 * @param registry - the behavior registry to look up handlers
 * @param ctx - per-tick context (dt, solids, tile info, player rect)
 * @returns a fresh `StepEnemiesResult` with updated enemies and spawned projectiles
 */
export function stepEnemies(
  enemies: readonly CompiledEnemy[],
  registry: EnemyBehaviorRegistry,
  ctx: EnemyUpdateContext,
): StepEnemiesResult {
  const updatedEnemies: CompiledEnemy[] = [];
  const projectiles: ProjectileState[] = [];

  try {
    for (const enemy of enemies) {
      if (!enemy || !enemy.state.alive) {
        updatedEnemies.push(enemy);
        continue;
      }

      const handler = registry.get(enemy.archetype);
      if (!handler) {
        updatedEnemies.push(enemy);
        continue;
      }

      const result = handler.step(enemy.state, ctx, enemy.params);

      const newState: EnemyState = {
        x: result.x,
        y: result.y,
        vx: result.vx,
        vy: result.vy,
        facing: result.facing,
        alive: result.alive,
        data: result.data,
      };

      updatedEnemies.push({
        ...enemy,
        state: newState,
      });

      if (result.projectile) {
        projectiles.push(result.projectile);
      }
    }
  } catch {
    // Defensive: return whatever was accumulated so far.
  }

  return { enemies: updatedEnemies, projectiles };
}
