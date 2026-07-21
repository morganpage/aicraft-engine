/**
 * Enemy behavior registry and built-in behavior implementations.
 *
 * Ships two built-in archetypes:
 * - `'spinny'`: patrol behavior with optional ledge-turn-around and patrol paths.
 * - `'turret'`: stationary shooter with cooldown, fixed or aimed mode.
 *
 * Consumers extend via `createEnemyBehaviorRegistry({ myArchetype: handler })`.
 *
 * Determinism: all behavior functions are pure. No `Math.random`, no `Date.now`,
 * no global mutable state, no DOM reads.
 *
 * @module
 */

import type {
  EnemyBehaviorHandler,
  EnemyBehaviorRegistry,
  EnemyState,
  EnemyStepResult,
  EnemyUpdateContext,
  ProjectileState,
} from './types';

// ─── Built-in: spinny ───────────────────────────────────────────────

/** Default speed for spinny enemies (px/s). */
const DEFAULT_SPINNY_SPEED = 60;
/** Arrival threshold in pixels for patrol waypoints. */
const WAYPOINT_ARRIVAL_THRESHOLD = 2;

/**
 * Spinny behavior: a simple patrol enemy that walks along the x-axis,
 * optionally turning around at ledges or following a patrol path.
 *
 * Params:
 * - `speed` (number, default 60): movement speed in px/s
 * - `ledgeTurnAround` (boolean, default false): reverse at ledges
 * - `patrolPath` ({x,y}[], optional): waypoints to follow
 */
export const spinnyBehavior: EnemyBehaviorHandler = {
  step(
    state: EnemyState,
    ctx: EnemyUpdateContext,
    params: Record<string, unknown>,
  ): EnemyStepResult {
    const speed = typeof params.speed === 'number' && Number.isFinite(params.speed)
      ? params.speed
      : DEFAULT_SPINNY_SPEED;
    const ledgeTurnAround = params.ledgeTurnAround === true;
    const patrolPath = Array.isArray(params.patrolPath) ? params.patrolPath : null;

    let x = state.x;
    let y = state.y;
    let facing = state.facing;
    const data: Record<string, unknown> = { ...state.data };

    // Patrol path mode
    if (patrolPath && patrolPath.length >= 2) {
      const waypointIndex = typeof data.waypointIndex === 'number'
        ? data.waypointIndex
        : 0;
      const target = patrolPath[waypointIndex];
      if (target && typeof target.x === 'number' && typeof target.y === 'number') {
        const dx = target.x - x;
        const dy = target.y - y;
        const dist = Math.hypot(dx, dy);
        const step = speed * ctx.dt;

        if (dist <= WAYPOINT_ARRIVAL_THRESHOLD || step >= dist) {
          // Arrived at waypoint — snap and advance
          x = target.x;
          y = target.y;
          const nextIndex = (waypointIndex + 1) % patrolPath.length;
          data.waypointIndex = nextIndex;
        } else {
          x = x + (dx / dist) * step;
          y = y + (dy / dist) * step;
        }

        facing = dx >= 0 ? 1 : -1;
      }
    } else {
      // Simple x-axis patrol mode
      const moveDir = facing;
      const proposedX = x + moveDir * speed * ctx.dt;
      let hitWall = false;

      // Check wall collision against solids
      const enemyWidth = 16;
      const enemyHeight = 16;
      for (const solid of ctx.solids) {
        const nextLeft = proposedX;
        const nextRight = proposedX + enemyWidth;
        const nextTop = y;
        const nextBottom = y + enemyHeight;

        const solidLeft = solid.x;
        const solidRight = solid.x + solid.width;
        const solidTop = solid.y;
        const solidBottom = solid.y + solid.height;

        // Check if next position overlaps with solid
        if (
          nextRight > solidLeft &&
          nextLeft < solidRight &&
          nextBottom > solidTop &&
          nextTop < solidBottom
        ) {
          hitWall = true;
          break;
        }
      }

      if (hitWall) {
        facing = facing === 1 ? -1 : 1;
      } else {
        x = proposedX;
      }

      // Ledge detection
      if (!hitWall && ledgeTurnAround && ctx.tileQuery && ctx.tileSize > 0) {
        // Check tile ahead and one tile below the enemy's feet
        const aheadX = moveDir === 1
          ? x + enemyWidth + 1
          : x - 1;
        const feetTileY = Math.floor((y + enemyHeight + 1) / ctx.tileSize);
        const aheadTileX = Math.floor(aheadX / ctx.tileSize);

        const tileType = ctx.tileQuery(aheadTileX, feetTileY);
        if (tileType !== 'solid' && tileType !== 'passthrough') {
          // No ground ahead — turn around
          facing = facing === 1 ? -1 : 1;
          // Don't move this tick; just reverse
          x = state.x;
        }
      }
    }

    return {
      x,
      y,
      vx: 0,
      vy: 0,
      facing,
      alive: state.alive,
      data,
    };
  },
};

// ─── Built-in: turret ───────────────────────────────────────────────

/** Default enemy width for turret projectile spawn offset. */
const ENEMY_WIDTH = 16;
/** Default enemy height for turret projectile spawn offset. */
const ENEMY_HEIGHT = 16;

/**
 * Turret behavior: a stationary enemy that fires projectiles at a fixed
 * rate. Supports `'fixed'` mode (fires in `aimDirection`) and `'aimed'`
 * mode (fires toward the player when within `detectionRadius`).
 *
 * Params:
 * - `fireRate` (number, default 1): shots per second
 * - `projectileSpeed` (number, default 120): projectile speed in px/s
 * - `projectileSize` (number, default 6): projectile hitbox size
 * - `aimMode` ('fixed' | 'aimed', default 'fixed'): aiming mode
 * - `aimDirection` ({x,y}, default {x:1,y:0}): direction for fixed mode
 * - `detectionRadius` (number, default 200): range for aimed mode
 * - `enemyWidth` (number, default 16): enemy body width for spawn offset
 * - `enemyHeight` (number, default 16): enemy body height for spawn offset
 */
export const turretBehavior: EnemyBehaviorHandler = {
  step(
    state: EnemyState,
    ctx: EnemyUpdateContext,
    params: Record<string, unknown>,
  ): EnemyStepResult {
    const fireRate = typeof params.fireRate === 'number' && Number.isFinite(params.fireRate) && params.fireRate > 0
      ? params.fireRate
      : 1;
    const projectileSpeed = typeof params.projectileSpeed === 'number' && Number.isFinite(params.projectileSpeed)
      ? params.projectileSpeed
      : 120;
    const projectileSize = typeof params.projectileSize === 'number' && Number.isFinite(params.projectileSize)
      ? params.projectileSize
      : 6;
    const aimMode = params.aimMode === 'aimed' ? 'aimed' : 'fixed';
    const aimDirection = params.aimDirection && typeof params.aimDirection === 'object'
      ? { x: Number((params.aimDirection as Record<string, unknown>).x) || 1, y: Number((params.aimDirection as Record<string, unknown>).y) || 0 }
      : { x: 1, y: 0 };
    const detectionRadius = typeof params.detectionRadius === 'number' && Number.isFinite(params.detectionRadius)
      ? params.detectionRadius
      : 200;
    const enemyW = typeof params.enemyWidth === 'number' ? params.enemyWidth : ENEMY_WIDTH;
    const enemyH = typeof params.enemyHeight === 'number' ? params.enemyHeight : ENEMY_HEIGHT;

    const cooldownDuration = 1 / fireRate;
    const currentCooldown = typeof state.data.fireCooldown === 'number'
      ? state.data.fireCooldown
      : 0;

    // Tick cooldown
    const newCooldown = Math.max(0, currentCooldown - ctx.dt);

    let projectile: ProjectileState | undefined;

    if (newCooldown <= 0) {
      let dirX = aimDirection.x;
      let dirY = aimDirection.y;

      if (aimMode === 'aimed') {
        if (!ctx.playerRect) {
          // No player — don't fire in aimed mode
          return {
            x: state.x,
            y: state.y,
            vx: state.vx,
            vy: state.vy,
            facing: state.facing,
            alive: state.alive,
            data: { ...state.data, fireCooldown: newCooldown },
          };
        }

        // Compute direction to player center
        const playerCenterX = ctx.playerRect.x + ctx.playerRect.width / 2;
        const playerCenterY = ctx.playerRect.y + ctx.playerRect.height / 2;
        const enemyCenterX = state.x + enemyW / 2;
        const enemyCenterY = state.y + enemyH / 2;
        const dx = playerCenterX - enemyCenterX;
        const dy = playerCenterY - enemyCenterY;
        const dist = Math.hypot(dx, dy);

        if (dist > detectionRadius || dist === 0) {
          // Out of range or on top of player — don't fire
          return {
            x: state.x,
            y: state.y,
            vx: state.vx,
            vy: state.vy,
            facing: state.facing,
            alive: state.alive,
            data: { ...state.data, fireCooldown: newCooldown },
          };
        }

        dirX = dx / dist;
        dirY = dy / dist;
      }

      // Normalize direction
      const dirLen = Math.hypot(dirX, dirY);
      if (dirLen > 0) {
        dirX /= dirLen;
        dirY /= dirLen;
      }

      // Spawn projectile at center of enemy
      const spawnX = state.x + enemyW / 2 - projectileSize / 2;
      const spawnY = state.y + enemyH / 2 - projectileSize / 2;

      projectile = {
        x: spawnX,
        y: spawnY,
        vx: dirX * projectileSpeed,
        vy: dirY * projectileSpeed,
        width: projectileSize,
        height: projectileSize,
        alive: true,
      };
    }

    const data: Record<string, unknown> = {
      ...state.data,
      fireCooldown: projectile ? cooldownDuration : newCooldown,
    };

    return {
      x: state.x,
      y: state.y,
      vx: state.vx,
      vy: state.vy,
      facing: state.facing,
      alive: state.alive,
      data,
      projectile,
    };
  },
};

// ─── Registry ───────────────────────────────────────────────────────

/** Built-in behavior handlers shipped with the library. */
const BUILT_IN_HANDLERS: Readonly<Record<string, EnemyBehaviorHandler>> = {
  spinny: spinnyBehavior,
  turret: turretBehavior,
};

/**
 * Create an {@link EnemyBehaviorRegistry} with the built-in archetypes
 * (`'spinny'` and `'turret'`) plus any custom handlers the consumer
 * supplies. Custom handlers merge on top of built-ins — a custom handler
 * with the same name overrides the built-in.
 *
 * @example
 * ```ts
 * const registry = createEnemyBehaviorRegistry({
 *   myCustom: { step: (state, ctx, params) => ({ ...state, x: state.x + 1 }) },
 * });
 * const handler = registry.get('spinny'); // built-in
 * const custom = registry.get('myCustom'); // consumer-supplied
 * ```
 *
 * @param customHandlers - optional record of archetype → handler to merge
 * @returns a registry with `get(archetype)` lookup
 */
export function createEnemyBehaviorRegistry(
  customHandlers?: Readonly<Record<string, EnemyBehaviorHandler>>,
): EnemyBehaviorRegistry {
  const merged: Record<string, EnemyBehaviorHandler> = {
    ...BUILT_IN_HANDLERS,
    ...customHandlers,
  };
  return {
    get(archetype: string): EnemyBehaviorHandler | undefined {
      return merged[archetype];
    },
  };
}
