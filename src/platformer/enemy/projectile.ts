/**
 * Projectile stepping logic.
 *
 * Advances a projectile by its velocity * dt, checks for solid collision
 * (deactivates on hit), and checks for player overlap (returns hitPlayer flag).
 *
 * Determinism: pure function over plain data. No `Math.random`, no `Date.now`,
 * no global mutable state, no DOM reads.
 *
 * @module
 */

import type { ProjectileState, ProjectileStepResult } from './types';
import { aabbOverlap } from '../../collision/aabb';

/**
 * Advance a projectile by one tick.
 *
 * - Moves by `vx * dt` and `vy * dt`.
 * - If the projectile overlaps any solid, it is deactivated (`alive: false`).
 * - If a `playerRect` is provided and the projectile overlaps it, `hitPlayer` is `true`.
 * - An already-dead projectile (`alive: false`) passes through unchanged.
 *
 * Pure: returns a fresh `ProjectileStepResult`; the input is not mutated.
 * Never throws.
 *
 * @param projectile - current projectile state
 * @param dt - elapsed seconds for this tick
 * @param solids - current solid surfaces for collision
 * @param playerRect - optional player hitbox for overlap detection
 * @returns a fresh result with updated position, alive status, and hitPlayer flag
 */
export function stepProjectile(
  projectile: ProjectileState,
  dt: number,
  solids: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[],
  playerRect?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): ProjectileStepResult {
  if (!projectile.alive) {
    return {
      ...projectile,
      hitPlayer: false,
    };
  }

  const nextX = projectile.x + projectile.vx * dt;
  const nextY = projectile.y + projectile.vy * dt;

  const nextRect = {
    x: nextX,
    y: nextY,
    width: projectile.width,
    height: projectile.height,
  };

  // Check solid collision
  let alive = true;
  for (const solid of solids) {
    if (aabbOverlap(nextRect, solid)) {
      alive = false;
      break;
    }
  }

  // Check player overlap
  let hitPlayer = false;
  if (playerRect && alive) {
    hitPlayer = aabbOverlap(nextRect, playerRect);
  }

  return {
    x: nextX,
    y: nextY,
    vx: projectile.vx,
    vy: projectile.vy,
    width: projectile.width,
    height: projectile.height,
    alive,
    hitPlayer,
  };
}
