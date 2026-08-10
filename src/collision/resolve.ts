/**
 * Per-axis move-and-resolve against static solids.
 *
 * Follows the discipline of the reference `resolveX` / `resolveY` handlers,
 * generalized to pure functions: the caller passes the current body position
 * plus the velocity to apply this tick, and receives the resolved position +
 * flags back. Inputs are never mutated.
 *
 * The two axes are resolved independently (caller decides order — typically X
 * then Y, or Y then X, per the game's preferred tunneling trade-offs). Each
 * helper moves the body along one axis only and ignores the other.
 *
 * @module
 */

import type { Rect, Solid, ResolveXResult, ResolveYResult } from './types';
import { aabbOverlap } from './aabb';

/**
 * Resolve horizontal movement against solids.
 *
 * The body is moved by `vx`, then checked against each solid. Passthrough
 * solids are skipped entirely on the X axis (they only ever block downward
 * movement — see {@link resolveAxisY}). If the moved body overlaps a
 * fully-solid surface, it is snapped flush against that solid's edge:
 * - moving right (`vx > 0`) → body's right edge meets solid's left edge,
 * - moving left (`vx < 0`) → body's left edge meets solid's right edge,
 * and `vx` is zeroed. Iteration continues so a body wedged between multiple
 * walls settles against the nearest one.
 *
 * Zero velocity short-circuits: no movement means no collision is possible,
 * so even a body already overlapping a wall returns its position unchanged
 * with `hitWall === false`.
 *
 * Pure: returns new values, never mutates `body` or `solids`.
 *
 * @example
 * ```ts
 * const r = resolveAxisX(player, 5, levelSolids);
 * player.x = r.x;
 * player.vx = r.vx;
 * ```
 *
 * @param body   - Current body position (BEFORE applying `vx`).
 * @param vx     - Horizontal velocity to apply this tick.
 * @param solids - Static collision surfaces (passthrough ignored on X).
 * @returns Resolved position, adjusted velocity, and wall-hit flag.
 */
export function resolveAxisX(body: Rect, vx: number, solids: readonly Solid[]): ResolveXResult {
  if (vx === 0) return { x: body.x, vx: 0, hitWall: false };

  const dir = Math.sign(vx);
  let newX = body.x + vx;
  let outVx = vx;
  let hitWall = false;

  for (const solid of solids) {
    if (solid.passthrough) continue;
    if (solid.ladder) continue;
    const moved: Rect = { x: newX, y: body.y, width: body.width, height: body.height };
    if (!aabbOverlap(moved, solid)) continue;
    newX = dir > 0 ? solid.x - body.width : solid.x + solid.width;
    outVx = 0;
    hitWall = true;
  }

  return { x: newX, vx: outVx, hitWall };
}

/**
 * Resolve vertical movement against solids.
 *
 * The body is moved by `vy`, then checked against each solid:
 * - **Fully-solid surfaces** block both directions: falling (`vy > 0`) lands
 *   the body on top; rising (`vy < 0`) bumps the ceiling from below.
 * - **Passthrough platforms** only block downward movement, and only when the
 *   body was above the platform last tick (`prevBottom <= solid.y`). This lets
 *   a body rise clean through from below and only land when descending onto
 *   the top face — the classic one-way platform.
 *
 * Landing snaps the body so its bottom edge meets the solid's top
 * (`y = solid.y - body.height`); ceiling hits snap the body so its top edge
 * meets the solid's bottom (`y = solid.y + solid.height`). In both cases `vy`
 * is zeroed. Iteration continues so a body overlapping several surfaces
 * settles correctly (e.g. lands on the highest platform beneath it).
 *
 * Zero velocity short-circuits: no movement means no collision is possible.
 *
 * Pure: returns new values, never mutates `body` or `solids`.
 *
 * @example
 * ```ts
 * const prevBottom = player.y + player.height;
 * player.y += player.vy;
 * const r = resolveAxisY(player, player.vy, levelSolids, prevBottom);
 * player.y = r.y;
 * player.vy = r.vy;
 * if (r.landed) player.onLand();
 * ```
 *
 * @param body       - Current body position (BEFORE applying `vy`). Its
 *                     `y + height` is the pre-move bottom; the caller passes
 *                     that explicitly as `prevBottom` so this helper stays a
 *                     pure reader of a single moment in time.
 * @param vy         - Vertical velocity to apply this tick.
 * @param solids     - Static collision surfaces.
 * @param prevBottom - The body's bottom Y (`body.y + body.height`) BEFORE this
 *                     tick's vertical move. Drives the passthrough rule.
 * @returns Resolved position, adjusted velocity, landed flag, and ceiling flag.
 */
export function resolveAxisY(
  body: Rect,
  vy: number,
  solids: readonly Solid[],
  prevBottom: number,
): ResolveYResult {
  if (vy === 0) return { y: body.y, vy: 0, landed: false, hitCeiling: false };

  const falling = vy > 0;
  let newY = body.y + vy;
  let outVy = vy;
  let landed = false;
  let hitCeiling = false;

  for (const solid of solids) {
    if (solid.ladder) continue;
    if (solid.passthrough) {
      if (!falling || prevBottom > solid.y) continue;
    }
    const moved: Rect = { x: body.x, y: newY, width: body.width, height: body.height };
    if (!aabbOverlap(moved, solid)) continue;
    if (falling) {
      newY = solid.y - body.height;
      outVy = 0;
      landed = true;
    } else {
      newY = solid.y + solid.height;
      outVy = 0;
      hitCeiling = true;
    }
  }

  return { y: newY, vy: outVy, landed, hitCeiling };
}
