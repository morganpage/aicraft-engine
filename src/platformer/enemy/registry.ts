/**
 * Enemy behavior registry and built-in behavior implementations.
 *
 * Ships three built-in archetypes:
 * - `'spinny'`: patrol behavior with optional ledge-turn-around and patrol paths.
 * - `'turret'`: stationary shooter with cooldown, fixed or aimed mode.
 * - `'spider'`: procedural spider with patrol movement (mirrors spinny) and
 *   deterministic gait-driven leg locomotion.
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
import type { SpiderConfig, SpiderPalette } from '../../animation/spider/types';
import type { SpiderState } from '../../animation/spider/spider-state';
import type { TileSolidityQuery } from '../../collision/types';
import { createSpiderState, stepSpider } from '../../animation/spider/spider-state';
import { DEFAULT_SPIDER, DEFAULT_SPIDER_PALETTE } from '../../animation/spider/constants';
import { chargerBehavior } from './archetypes/charger';

export { chargerBehavior };

// ─── Built-in: spinny ───────────────────────────────────────────────

/** Default speed for spinny enemies (px/s). */
const DEFAULT_SPINNY_SPEED = 60;
/** Arrival threshold in pixels for patrol waypoints. */
const WAYPOINT_ARRIVAL_THRESHOLD = 2;
/**
 * Spinny roll radius (px) — the effective radius used to convert horizontal
 * displacement into visual rotation. Matches the default 16px enemy body
 * width (radius = body-width / 2 = 8px). No magic: this is the half-width
 * of the standard spinny hitbox.
 */
const SPINNY_ROLL_RADIUS = 8;

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
    const startX = x;

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

    // Accumulate spinAngle from actual horizontal displacement.
    // nextAngle = previousAngle + (newX - startX) / RADIUS.
    // Stationary ticks (wall/ledge reversal) have dx=0 → angle preserved.
    // Wrap into [0, 2π) to prevent unbounded floating-point growth.
    const TWO_PI = Math.PI * 2;
    const prevAngle = typeof data.spinAngle === 'number' && Number.isFinite(data.spinAngle)
      ? data.spinAngle
      : 0;
    const dx = x - startX;
    const rawAngle = prevAngle + dx / SPINNY_ROLL_RADIUS;
    data.spinAngle = ((rawAngle % TWO_PI) + TWO_PI) % TWO_PI;

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

/** Resolved direction + range from a shootTo param. */
interface ResolvedShootTo {
  readonly dirX: number;
  readonly dirY: number;
  readonly maxRange: number;
}

/**
 * Parse aimDirection from params, using Number.isFinite (not `|| 0`)
 * so zero components are preserved.
 */
function parseAimDirection(raw: unknown): { readonly x: number; readonly y: number } {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const rx = Number(obj.x);
    const ry = Number(obj.y);
    if (Number.isFinite(rx) && Number.isFinite(ry)) {
      return { x: rx, y: ry };
    }
  }
  return { x: 1, y: 0 };
}

/**
 * Resolve a relative shootTo vector into direction + range.
 *
 * Resolution order (from decision doc):
 *   1. Must be a plain object with Number.isFinite(x) AND Number.isFinite(y).
 *   2. If missing/non-object/non-finite → fallback direction, maxRange = 0.
 *   3. If magnitude === 0 → fallback direction, maxRange = 0.
 *   4. If magnitude > 0 → normalized dir + maxRange = magnitude.
 *
 * Zero-component preservation: {x:0, y:120} → dirX=0, dirY=1, maxRange=120.
 */
function resolveShootTo(
  shootTo: unknown,
  fallbackDirX: number,
  fallbackDirY: number,
): ResolvedShootTo {
  if (!shootTo || typeof shootTo !== 'object') {
    return { dirX: fallbackDirX, dirY: fallbackDirY, maxRange: 0 };
  }

  const st = shootTo as Record<string, unknown>;
  const rawX = Number(st.x);
  const rawY = Number(st.y);

  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
    return { dirX: fallbackDirX, dirY: fallbackDirY, maxRange: 0 };
  }

  const magnitude = Math.hypot(rawX, rawY);
  if (magnitude === 0) {
    return { dirX: fallbackDirX, dirY: fallbackDirY, maxRange: 0 };
  }

  return {
    dirX: rawX / magnitude,
    dirY: rawY / magnitude,
    maxRange: magnitude,
  };
}

/**
 * Turret behavior: a stationary enemy that fires projectiles at a fixed
 * rate. Supports `'fixed'` mode (fires in `aimDirection` or `shootTo`)
 * and `'aimed'` mode (fires toward the player when within `detectionRadius`).
 *
 * Params:
 * - `fireRate` (number, default 1): shots per second
 * - `projectileSpeed` (number, default 120): projectile speed in px/s
 * - `projectileSize` (number, default 6): projectile hitbox size
 * - `aimMode` ('fixed' | 'aimed', default 'fixed'): aiming mode
 * - `aimDirection` ({x,y}, default {x:1,y:0}): direction for fixed mode (legacy)
 * - `shootTo` ({x,y}, optional): relative vector for fixed mode; direction +
 *   range. Zero-component preserved via Number.isFinite. Missing/malformed/
 *   zero-length falls back to aimDirection with no range limit.
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
    const aimDirection = parseAimDirection(params.aimDirection);
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
      let maxRange = 0;

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
        // Aimed mode: always unbounded (maxRange stays 0)
      } else {
        // Fixed mode: resolve shootTo if present
        const resolved = resolveShootTo(params.shootTo, aimDirection.x, aimDirection.y);
        dirX = resolved.dirX;
        dirY = resolved.dirY;
        maxRange = resolved.maxRange;
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
        ...(maxRange > 0 ? { maxRange, distanceTraveled: 0 } : {}),
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

// ─── Built-in: spider ──────────────────────────────────────────────

/** Default speed for spider enemies (px/s). */
const DEFAULT_SPIDER_SPEED = 50;

/**
 * Spider behavior: a patrol enemy that walks along the x-axis (mirroring
 * `spinnyBehavior` movement) with procedural spider leg locomotion driven
 * by the deterministic gait solver.
 *
 * Movement mirrors spinny: x-axis patrol at `speed`, wall collision against
 * `ctx.solids`, optional ledge-turnaround via `ctx.tileQuery`, optional
 * `patrolPath` waypoint mode. The spider walks left/right and turns around
 * at walls/ledges.
 *
 * Gait driving: each tick, the spider body center is computed from
 * `state.x/y` + a body-center offset (half the enemy size, matching spinny's
 * cx/cy computation). On the first tick (when `state.data.spider` is missing),
 * the spider state is initialized via `createSpiderState`. On subsequent ticks,
 * `stepSpider` advances the gait and palp spring-rods.
 *
 * **JitterSeed derivation.** When `params.jitterSeed` is a finite number, it is
 * used directly. Otherwise, a deterministic seed is derived from the initial
 * `state.x` via a Knuth multiplicative hash: `(Math.abs(Math.floor(state.x)) * 2654435761) >>> 0`.
 * This ensures per-spider visual uniqueness without `Math.random`.
 *
 * **tileQuery adapter.** The handler adapts `ctx.tileQuery` (which returns a
 * `string` and may be `null`) to the `TileSolidityQuery` interface (which
 * returns `'empty'|'solid'|'passthrough'`). If `ctx.tileQuery` is `null`,
 * the adapter returns `'empty'` for all tiles (legs tuck, spider still patrols
 * via solids). All tileQuery calls are wrapped in try/catch — the handler
 * never throws.
 *
 * Params:
 * - `speed` (number, default 50): movement speed in px/s
 * - `ledgeTurnAround` (boolean, default false): reverse at ledges
 * - `patrolPath` ({x,y}[], optional): waypoints to follow
 * - `gaitMode` ('coordinated' | 'frantic', default 'coordinated'): spider gait mode
 * - `jitterSeed` (number, optional): seed for per-spider body jitter
 * - `palette` (Partial<SpiderPalette>, optional): palette overrides
 */
export const spiderBehavior: EnemyBehaviorHandler = {
  step(
    state: EnemyState,
    ctx: EnemyUpdateContext,
    params: Record<string, unknown>,
  ): EnemyStepResult {
    try {
      const speed = typeof params.speed === 'number' && Number.isFinite(params.speed)
        ? params.speed
        : DEFAULT_SPIDER_SPEED;
      const ledgeTurnAround = params.ledgeTurnAround === true;
      const patrolPath = Array.isArray(params.patrolPath) ? params.patrolPath : null;

      // ─── Movement (mirrors spinnyBehavior) ─────────────────────────
      let x = state.x;
      let y = state.y;
      let facing = state.facing;

      // Enemy dimensions (match spinny)
      const enemyWidth = 16;
      const enemyHeight = 16;

      // Patrol path mode
      if (patrolPath && patrolPath.length >= 2) {
        const waypointIndex = typeof state.data.waypointIndex === 'number'
          ? state.data.waypointIndex
          : 0;
        const target = patrolPath[waypointIndex];
        if (target && typeof target.x === 'number' && typeof target.y === 'number') {
          const dx = target.x - x;
          const dy = target.y - y;
          const dist = Math.hypot(dx, dy);
          const stepSize = speed * ctx.dt;

          if (dist <= WAYPOINT_ARRIVAL_THRESHOLD || stepSize >= dist) {
            x = target.x;
            y = target.y;
            const nextIndex = (waypointIndex + 1) % patrolPath.length;
            const data: Record<string, unknown> = { ...state.data, waypointIndex: nextIndex };
            facing = dx >= 0 ? 1 : -1;
            return buildSpiderResult(state, x, y, facing, speed, data, ctx, params);
          } else {
            x = x + (dx / dist) * stepSize;
            y = y + (dy / dist) * stepSize;
          }
          facing = dx >= 0 ? 1 : -1;
        }
      } else {
        // Simple x-axis patrol mode
        const moveDir = facing;
        const proposedX = x + moveDir * speed * ctx.dt;
        let hitWall = false;

        // Check wall collision against solids
        for (const solid of ctx.solids) {
          const nextLeft = proposedX;
          const nextRight = proposedX + enemyWidth;
          const nextTop = y;
          const nextBottom = y + enemyHeight;

          const solidLeft = solid.x;
          const solidRight = solid.x + solid.width;
          const solidTop = solid.y;
          const solidBottom = solid.y + solid.height;

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
          const aheadX = moveDir === 1
            ? x + enemyWidth + 1
            : x - 1;
          const feetTileY = Math.floor((y + enemyHeight + 1) / ctx.tileSize);
          const aheadTileX = Math.floor(aheadX / ctx.tileSize);

          const tileType = ctx.tileQuery(aheadTileX, feetTileY);
          if (tileType !== 'solid' && tileType !== 'passthrough') {
            facing = facing === 1 ? -1 : 1;
            x = state.x;
          }
        }
      }

      const data: Record<string, unknown> = { ...state.data };
      return buildSpiderResult(state, x, y, facing, speed, data, ctx, params);
    } catch {
      // Never throw — return the original state on any unexpected error
      return {
        x: state.x,
        y: state.y,
        vx: state.vx,
        vy: state.vy,
        facing: state.facing,
        alive: state.alive,
        data: state.data,
      };
    }
  },
};

/**
 * Build the spider step result: compute vx/vy, drive the spider gait,
 * and return a fresh EnemyStepResult. Extracted from the main step for
 * clarity (both patrol-path and simple-patrol modes converge here).
 */
function buildSpiderResult(
  state: EnemyState,
  x: number,
  y: number,
  facing: 1 | -1,
  speed: number,
  data: Record<string, unknown>,
  ctx: EnemyUpdateContext,
  params: Record<string, unknown>,
): EnemyStepResult {
  const enemyWidth = 16;
  const enemyHeight = 16;
  const moveDir = facing;
  const vx = speed * moveDir;
  const vy = 0;

  // Body center offset (matches spinny's cx/cy: top-left + half-size)
  const bodyX = x + enemyWidth / 2;
  const bodyY = y + enemyHeight / 2;

  // Build tileQuery adapter
  const tileQuery: TileSolidityQuery = ctx.tileQuery
    ? (tx: number, ty: number) => {
        try {
          const s = ctx.tileQuery!(tx, ty);
          return s === 'solid' ? 'solid' : s === 'passthrough' ? 'passthrough' : 'empty';
        } catch {
          return 'empty';
        }
      }
    : () => 'empty';

  // Build spider config from params
  const gaitMode = params.gaitMode === 'frantic' ? 'frantic' : 'coordinated';
  const paletteOverride = params.palette && typeof params.palette === 'object'
    ? { ...DEFAULT_SPIDER_PALETTE, ...(params.palette as Partial<SpiderPalette>) }
    : DEFAULT_SPIDER_PALETTE;
  const config: SpiderConfig = {
    ...DEFAULT_SPIDER,
    mode: gaitMode,
    palette: paletteOverride,
  };

  // Derive jitterSeed deterministically
  let jitterSeed: number;
  if (typeof params.jitterSeed === 'number' && Number.isFinite(params.jitterSeed)) {
    jitterSeed = params.jitterSeed;
  } else {
    // Knuth multiplicative hash from initial x position
    jitterSeed = (Math.abs(Math.floor(state.x)) * 2654435761) >>> 0;
  }

  // Advance or initialize spider state
  let nextSpider: SpiderState;
  const prevSpider = data.spider as SpiderState | undefined;
  const nextTick = (typeof data.tick === 'number' ? data.tick : 0) + 1;

  if (prevSpider) {
    nextSpider = stepSpider(
      prevSpider,
      bodyX, bodyY,
      vx, vy,
      facing,
      ctx.dt,
      config,
      tileQuery,
      ctx.tileSize,
      nextTick,
    );
  } else {
    nextSpider = createSpiderState(config, jitterSeed, bodyX, bodyY, facing);
  }

  return {
    x,
    y,
    vx,
    vy,
    facing,
    alive: state.alive,
    data: { ...data, spider: nextSpider, tick: nextTick },
  };
}

// ─── Registry ───────────────────────────────────────────────────────

/** Built-in behavior handlers shipped with the library. */
const BUILT_IN_HANDLERS: Readonly<Record<string, EnemyBehaviorHandler>> = {
  spinny: spinnyBehavior,
  turret: turretBehavior,
  spider: spiderBehavior,
  charger: chargerBehavior,
};

/**
 * Create an {@link EnemyBehaviorRegistry} with the built-in archetypes
 * (`'spinny'`, `'turret'`, `'spider'`, and `'charger'`) plus any custom handlers the
 * consumer supplies. Custom handlers merge on top of built-ins — a custom
 * handler with the same name overrides the built-in.
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
