/**
 * Bot policies for platformer-level simulation testing.
 *
 * Each policy is a pure function that reads the current `PlatformerState`
 * and a `BotContext` (level entities, solids, moving platforms) and returns a
 * `PlatformerInput` for the current tick.
 *
 * **Determinism:** All policies are pure — same `(state, ctx)` → same input,
 * forever. No `Math.random`, no `Date.now()`, no DOM reads, no global mutable
 * state. Never throw (degrade to idle input on malformed state).
 *
 * @module
 */

import type { PlatformerInput, PlatformerState } from '../platformer/types';
import type { JumpConfig } from '../animation/jump';
import type { LevelEntity } from '../level/types';
import type { Solid } from '../collision/types';
import type { CompiledMovingPlatform } from '../platformer/level-runtime';
import type { CollectibleSave } from '../collectibles/types';

// ---------------------------------------------------------------------------
// PolledEdge helper
// ---------------------------------------------------------------------------

/** A "not pressed" edge — all fields false. */
const EDGE_OFF = { held: false, pressed: false, released: false };
/** A "just pressed this tick" edge. */
const EDGE_PRESS = { held: true, pressed: true, released: false };
// ---------------------------------------------------------------------------
// BotPolicy type
// ---------------------------------------------------------------------------

/**
 * Context passed to a bot policy each tick.
 */
export interface BotContext {
  /** All level entities (exits, platforms, collectibles, etc.). */
  readonly entities: readonly LevelEntity[];
  /** Static collision solids for the current tick (including moving-platform solids). */
  readonly solids: readonly Solid[];
  /** Moving-platform descriptors for the current tick. */
  readonly movingPlatforms: readonly CompiledMovingPlatform[];
  /** Current tick index. */
  readonly tick: number;
  /** Fixed timestep in seconds. */
  readonly dt: number;
  /** Authoritative jump config from the platformer config. */
  readonly jumpConfig: Readonly<JumpConfig>;
  /** Current collectible save (read-only). */
  readonly save: Readonly<CollectibleSave>;
}

/**
 * A deterministic bot policy that selects a platformer input each tick.
 *
 * Must be pure: same `(state, ctx)` → same `PlatformerInput`, forever.
 * Must never throw — return a safe idle input `{ moveX: 0, jump: EDGE_OFF, dash: EDGE_OFF }`
 * on any error.
 *
 * @param state - Current platformer state (read-only).
 * @param ctx   - Bot context with level data and solids.
 * @returns A `PlatformerInput` for this tick.
 */
export type BotPolicy = (
  state: PlatformerState,
  ctx: BotContext,
) => PlatformerInput;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A safe idle input used as fallback. */
const IDLE_INPUT: PlatformerInput = Object.freeze({
  moveX: 0 as const,
  jump: EDGE_OFF,
  dash: EDGE_OFF,
});

/** Pixels below feet to check for ground presence. */
const GROUND_CHECK_DIST = 4;

// ---------------------------------------------------------------------------
// Policy helpers
// ---------------------------------------------------------------------------

/**
 * Check if there is ground below the player at a given horizontal offset.
 * Looks `GROUND_CHECK_DIST` pixels below the player's feet.
 */
function hasGroundBelow(
  state: PlatformerState,
  solids: readonly Solid[],
  offsetX: number = 0,
): boolean {
  const feetY = state.core.y + state.core.height;
  const checkX = state.core.x + state.core.width / 2 + offsetX;
  for (const solid of solids) {
    if (solid.passthrough) continue;
    if (
      checkX >= solid.x &&
      checkX <= solid.x + solid.width &&
      feetY >= solid.y - GROUND_CHECK_DIST &&
      feetY <= solid.y + GROUND_CHECK_DIST
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Check if there is a wall in front of the player within 32 px.
 */
function hasWallAhead(
  state: PlatformerState,
  solids: readonly Solid[],
): boolean {
  const dir = state.core.vx === 0 ? state.core.facing : (state.core.vx >= 0 ? 1 : -1);
  const edgeX = dir > 0
    ? state.core.x + state.core.width + 1
    : state.core.x - 1;
  for (const solid of solids) {
    if (solid.passthrough) continue;
    if (dir > 0) {
      if (
        edgeX >= solid.x &&
        edgeX <= solid.x + solid.width &&
        state.core.y < solid.y + solid.height &&
        state.core.y + state.core.height > solid.y
      ) {
        return true;
      }
    } else {
      if (
        edgeX <= solid.x + solid.width &&
        edgeX >= solid.x &&
        state.core.y < solid.y + solid.height &&
        state.core.y + state.core.height > solid.y
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Find the nearest non-trap, non-locked exit entity.
 * Returns `null` if none exists.
 */
function findNearestExit(
  state: PlatformerState,
  entities: readonly LevelEntity[],
): LevelEntity | null {
  let best: LevelEntity | null = null;
  let bestDist = Infinity;
  const px = state.core.x + state.core.width / 2;
  for (const entity of entities) {
    if (!entity || typeof entity !== 'object') continue;
    if (entity.kind !== 'exit') continue;
    const props = entity.props as { readonly isTrap?: boolean; readonly locked?: boolean };
    if (props?.isTrap || props?.locked) continue;
    const ex = entity.rect.x + entity.rect.width / 2;
    const ey = entity.rect.y + entity.rect.height / 2;
    const dx = ex - px;
    const dy = ey - (state.core.y + state.core.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = entity;
    }
  }
  return best;
}

/**
 * Find the nearest uncollected collectible entity.
 * Returns `null` if none exists or all are collected.
 */
function findNearestCollectible(
  state: PlatformerState,
  entities: readonly LevelEntity[],
  save: Readonly<CollectibleSave>,
): LevelEntity | null {
  const collected = new Set<string>(
    save && Array.isArray(save.collected) ? save.collected : [],
  );
  let best: LevelEntity | null = null;
  let bestDist = Infinity;
  const px = state.core.x + state.core.width / 2;
  const py = state.core.y + state.core.height / 2;
  for (const entity of entities) {
    if (!entity || typeof entity !== 'object') continue;
    if (entity.kind !== 'collectible') continue;
    if (collected.has(String(entity.id))) continue;
    const ex = entity.rect.x + entity.rect.width / 2;
    const ey = entity.rect.y + entity.rect.height / 2;
    const dist = Math.hypot(ex - px, ey - py);
    if (dist < bestDist) {
      bestDist = dist;
      best = entity;
    }
  }
  return best;
}

/**
 * Determine horizontal move direction toward a target entity.
 */
function moveToward(
  state: PlatformerState,
  target: LevelEntity,
): -1 | 0 | 1 {
  const px = state.core.x + state.core.width / 2;
  const tx = target.rect.x + target.rect.width / 2;
  const diff = tx - px;
  if (Math.abs(diff) < 4) return 0;
  return diff > 0 ? 1 : -1;
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

/**
 * **Cautious policy** — prefers wide landings, avoids hazards, moves slowly.
 *
 * This policy:
 * - Moves toward the nearest exit.
 * - Only jumps when absolutely necessary (wall ahead or no ground ahead).
 * - Avoids dashing unless over a large gap.
 * - Prefers staying on ground over aerial maneuvers.
 *
 * @example
 * ```ts
 * const input = cautiousPolicy(state, ctx);
 * ```
 */
export const cautiousPolicy: BotPolicy = (
  state: PlatformerState,
  ctx: BotContext,
): PlatformerInput => {
  try {
    const target = findNearestExit(state, ctx.entities);
    if (!target) return IDLE_INPUT;

    const moveX = moveToward(state, target);
    const dir = moveX !== 0 ? moveX : state.core.facing;

    // Check if there's ground ahead in the direction of travel
    const groundAhead = hasGroundBelow(state, ctx.solids, dir * 16);
    const wallAhead = hasWallAhead(state, ctx.solids);

    // Jump only when blocked or about to fall off
    let shouldJump = false;
    if (state.core.onGround) {
      if (wallAhead || (!groundAhead && moveX !== 0)) {
        shouldJump = true;
      }
    }

    return {
      moveX,
      jump: shouldJump ? EDGE_PRESS : EDGE_OFF,
      dash: EDGE_OFF,
    };
  } catch {
    return IDLE_INPUT;
  }
};

/**
 * **Direct policy** — follows the shortest route to the exit.
 *
 * This policy:
 * - Moves aggressively toward the nearest exit.
 * - Jumps as soon as an obstacle is detected.
 * - Uses dash to clear gaps quickly.
 * - Ignores collectibles (focused on speedrunning to the exit).
 *
 * @example
 * ```ts
 * const input = directPolicy(state, ctx);
 * ```
 */
export const directPolicy: BotPolicy = (
  state: PlatformerState,
  ctx: BotContext,
): PlatformerInput => {
  try {
    const target = findNearestExit(state, ctx.entities);
    if (!target) return IDLE_INPUT;

    const moveX = moveToward(state, target);

    // Check obstacles
    const dir = moveX !== 0 ? moveX : state.core.facing;
    const groundAhead = hasGroundBelow(state, ctx.solids, dir * 20);
    const wallAhead = hasWallAhead(state, ctx.solids);

    // Jump at obstacles
    let shouldJump = false;
    if (state.core.onGround && (wallAhead || !groundAhead)) {
      shouldJump = true;
    }

    // Dash to cover ground quickly when available
    let shouldDash = false;
    if (state.core.onGround && moveX !== 0 && !wallAhead) {
      const dashState = state.abilities?.['dash'] as
        | { readonly timer?: number; readonly cooldown?: number }
        | undefined;
      if (dashState && dashState.timer === 0 && dashState.cooldown === 0) {
        shouldDash = true;
      }
    }

    return {
      moveX,
      jump: shouldJump ? EDGE_PRESS : EDGE_OFF,
      dash: shouldDash ? EDGE_PRESS : EDGE_OFF,
    };
  } catch {
    return IDLE_INPUT;
  }
};

/**
 * **Collector policy** — visits optional collectibles before exiting.
 *
 * This policy:
 * - Checks for uncollected collectibles near the critical path.
 * - Detours to collect them before proceeding to the exit.
 * - Falls back to `directPolicy` behavior when all collectibles are collected.
 *
 * @example
 * ```ts
 * const input = collectorPolicy(state, ctx);
 * ```
 */
export const collectorPolicy: BotPolicy = (
  state: PlatformerState,
  ctx: BotContext,
): PlatformerInput => {
  try {
    // Look for uncollected collectibles
    const collectible = findNearestCollectible(state, ctx.entities, ctx.save);

    // If no collectibles remain, behave like direct policy
    if (!collectible) {
      return directPolicy(state, ctx);
    }

    const moveX = moveToward(state, collectible);
    const dir = moveX !== 0 ? moveX : state.core.facing;

    // Obstacle detection
    const groundAhead = hasGroundBelow(state, ctx.solids, dir * 16);
    const wallAhead = hasWallAhead(state, ctx.solids);

    let shouldJump = false;
    if (state.core.onGround && (wallAhead || !groundAhead)) {
      shouldJump = true;
    }

    return {
      moveX,
      jump: shouldJump ? EDGE_PRESS : EDGE_OFF,
      dash: EDGE_OFF,
    };
  } catch {
    return IDLE_INPUT;
  }
};

// ---------------------------------------------------------------------------
// Default bot policies
// ---------------------------------------------------------------------------

/**
 * The default set of bot policies used by `verifyLevel` when no explicit
 * policies are provided in {@link import('./verify').LevelTestConfig}.
 *
 * Includes: {@link cautiousPolicy}, {@link directPolicy}, {@link collectorPolicy}.
 */
export const DEFAULT_BOT_POLICIES: readonly BotPolicy[] = Object.freeze([
  cautiousPolicy,
  directPolicy,
  collectorPolicy,
]);
