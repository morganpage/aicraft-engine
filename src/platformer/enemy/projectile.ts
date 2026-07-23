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
 * - If a `playerRect` is provided and the projectile overlaps it, `hitPlayer` is `true`
 *   AND the projectile is deactivated.
 * - If `maxRange > 0` and accumulated distance exceeds maxRange, the projectile
 *   is deactivated at the exact range boundary (zero overshoot via position clamping).
 * - An already-dead projectile (`alive: false`) passes through unchanged.
 * - `maxRange` and `distanceTraveled` are preserved on every deactivation path.
 *
 * Precedence: solid hit > player hit > range exceeded.
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

  const maxRange = projectile.maxRange ?? 0;
  const prevDistance = projectile.distanceTraveled ?? 0;

  // Compute proposed next position
  const dx = projectile.vx * dt;
  const dy = projectile.vy * dt;
  let nextX = projectile.x + dx;
  let nextY = projectile.y + dy;
  let alive = true;

  // Range check: accumulate distance and clamp if exceeded
  if (maxRange > 0) {
    const tickDistance = Math.hypot(dx, dy);
    const newDistance = prevDistance + tickDistance;

    if (newDistance >= maxRange) {
      // Clamp to exact range boundary: project remaining distance along direction
      const remaining = maxRange - prevDistance;
      const dirLen = Math.hypot(projectile.vx, projectile.vy);
      if (dirLen > 0) {
        const dirX = projectile.vx / dirLen;
        const dirY = projectile.vy / dirLen;
        nextX = projectile.x + dirX * remaining;
        nextY = projectile.y + dirY * remaining;
      }
      alive = false;
    }

    // Distance field: preserve on deactivation, accumulate on survival
    const distanceTraveled = alive ? newDistance : maxRange;

    // Check solid collision AFTER range clamp
    const nextRect = { x: nextX, y: nextY, width: projectile.width, height: projectile.height };
    for (const solid of solids) {
      if (aabbOverlap(nextRect, solid)) {
        alive = false;
        break;
      }
    }

    // Check player overlap AFTER solid check (solid takes precedence)
    let hitPlayer = false;
    if (playerRect && alive) {
      hitPlayer = aabbOverlap(nextRect, playerRect);
      if (hitPlayer) alive = false;
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
      maxRange: projectile.maxRange,
      distanceTraveled,
    };
  }

  // Legacy path: no range limit
  const nextRect = { x: nextX, y: nextY, width: projectile.width, height: projectile.height };

  // Check solid collision
  for (const solid of solids) {
    if (aabbOverlap(nextRect, solid)) {
      alive = false;
      break;
    }
  }

  // Check player overlap (solid takes precedence)
  let hitPlayer = false;
  if (playerRect && alive) {
    hitPlayer = aabbOverlap(nextRect, playerRect);
    if (hitPlayer) alive = false;
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
