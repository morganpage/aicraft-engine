/**
 * Type definitions for the enemy archetype system.
 *
 * Enemies are runtime entities compiled from `LevelEntity` entries with
 * `kind: 'enemy'`. Each enemy has an `archetype` string that dispatches to
 * a behavior handler in the `EnemyBehaviorRegistry`. The pattern mirrors
 * `TrapProps.type` and `TriggerProps.action` — a free string discriminator
 * with a handler registry for extensibility.
 *
 * Determinism: all types are plain readonly objects with primitive fields.
 * No timestamps, no closures, no `Set`/`Map`. Survives JSON round-trip.
 *
 * @module
 */

import type { EnemyProps } from '../../level/types';

/**
 * Built-in enemy archetype identifiers. Consumers may register additional
 * archetypes via `createEnemyBehaviorRegistry` — the type is a free string
 * for extensibility, but these three are the shipped built-ins.
 */
export type EnemyArchetype = 'spinny' | 'turret' | 'spider';

/**
 * Props for the `'enemy'` entity kind. Stored on `LevelEntity.props` when
 * `kind === 'enemy'`. The `archetype` field dispatches to a behavior
 * handler; `params` is an untyped bag whose shape depends on the archetype
 * (same pattern as `TrapProps.params`).
 *
 * Re-exported from `src/level/types.ts` — the canonical definition lives there.
 */
export type { EnemyProps };

/**
 * Runtime state for a single enemy, mutated immutably each tick by the
 * behavior handler. Every field is `readonly` — handlers return a fresh
 * object via spread.
 */
export interface EnemyState {
  /** World-space X of the enemy body's top-left corner. */
  readonly x: number;
  /** World-space Y of the enemy body's top-left corner. */
  readonly y: number;
  /** Horizontal velocity in px/s. */
  readonly vx: number;
  /** Vertical velocity in px/s. */
  readonly vy: number;
  /** Facing direction: +1 right, -1 left. */
  readonly facing: 1 | -1;
  /** `false` when the enemy is dead / deactivated. */
  readonly alive: boolean;
  /** Archetype-specific persistent data (e.g. cooldown timers, waypoint index). */
  readonly data: Record<string, unknown>;
}

/**
 * The result of a single enemy behavior step. Contains the updated
 * `EnemyState` and an optional `ProjectileState` if the behavior
 * spawned a projectile this tick.
 */
export interface EnemyStepResult {
  /** Updated enemy state (fresh copy). */
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly facing: 1 | -1;
  readonly alive: boolean;
  readonly data: Record<string, unknown>;
  /** Projectile spawned this tick, or `undefined` if none. */
  readonly projectile?: ProjectileState;
}

/**
 * Per-tick context passed to an enemy behavior handler. Provides the
 * timestep, collision surfaces, tile grid info, and optional player rect
 * for behaviors that need to aim at or detect the player.
 */
export interface EnemyUpdateContext {
  /** Fixed timestep in seconds. */
  readonly dt: number;
  /** Current solid surfaces for collision checks. */
  readonly solids: readonly import('../../collision/types').Solid[];
  /**
   * Tile solidity query, or `null` if no tile grid is available.
   * Behaviors use this for ledge detection, wall detection, etc.
   */
  readonly tileQuery: ((tileX: number, tileY: number) => string) | null;
  /** Tile size in pixels (used to convert between world and tile space). */
  readonly tileSize: number;
  /** Player's current rect, or `null` if no player exists. Used for aimed turrets. */
  readonly playerRect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
}

/**
 * A behavior handler for a single enemy archetype. Receives the enemy's
 * current state and the per-tick context; returns a step result with the
 * updated state and an optional projectile.
 *
 * Must be pure: same `(state, ctx, params)` → identical result. Never
 * mutate `state` — return a fresh object. Never throw.
 */
export interface EnemyBehaviorHandler {
  /**
   * Advance this enemy by one tick.
   *
   * @param state - current enemy state (immutable)
   * @param ctx - per-tick context (dt, solids, tile info, player rect)
   * @param params - archetype-specific parameters from `EnemyProps.params`
   * @returns a fresh `EnemyStepResult`
   */
  step(
    state: EnemyState,
    ctx: EnemyUpdateContext,
    params: Record<string, unknown>,
  ): EnemyStepResult;
}

/**
 * A compiled enemy — the runtime representation of a level entity with
 * `kind: 'enemy'`. Carries the full source entity for rendering convenience
 * (the entity is small and read-only).
 */
export interface CompiledEnemy {
  /** Stable id matching the source `LevelEntity.id`. */
  readonly id: number;
  /** The archetype this enemy uses. */
  readonly archetype: string;
  /** Current runtime state. */
  readonly state: EnemyState;
  /** The source level entity (read-only back-reference for rendering). */
  readonly entity: import('../../level/types').LevelEntity;
  /** Archetype-specific params from `EnemyProps.params`. */
  readonly params: Record<string, unknown>;
}

/**
 * A projectile spawned by an enemy behavior (e.g. turret fire). Projectiles
 * are returned from `stepEnemies` in a flat array and survive enemy death.
 *
 * Determinism: all fields are primitives. No timestamps, no closures.
 */
export interface ProjectileState {
  /** World-space X of the projectile's top-left corner. */
  readonly x: number;
  /** World-space Y of the projectile's top-left corner. */
  readonly y: number;
  /** Horizontal velocity in px/s. */
  readonly vx: number;
  /** Vertical velocity in px/s. */
  readonly vy: number;
  /** Hitbox width. */
  readonly width: number;
  /** Hitbox height. */
  readonly height: number;
  /** `false` when the projectile has hit a solid or been deactivated. */
  readonly alive: boolean;
}

/**
 * Result of `stepProjectile`. Extends `ProjectileState` with a
 * `hitPlayer` flag for the consumer's collision pipeline.
 */
export interface ProjectileStepResult extends ProjectileState {
  /** `true` if the projectile overlaps the player rect this tick. */
  readonly hitPlayer: boolean;
}

/**
 * Registry mapping archetype strings to their behavior handlers.
 * Consumers create one via `createEnemyBehaviorRegistry` and pass it
 * to `stepEnemies`.
 */
export interface EnemyBehaviorRegistry {
  /**
   * Look up a behavior handler by archetype name.
   *
   * @param archetype - the archetype string to look up
   * @returns the handler, or `undefined` if not registered
   */
  get(archetype: string): EnemyBehaviorHandler | undefined;
}
