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
 * movement — see {@link resolveAxisY}). Phase 8: `spring` and `dashRefill`
 * marker solids are ALSO skipped — they are non-blocking trigger volumes, not
 * walls. If the moved body overlaps a fully-solid surface, it is snapped flush
 * against that solid's edge:
 * - moving right (`vx > 0`) → body's right edge meets solid's left edge,
 * - moving left (`vx < 0`) → body's left edge meets solid's right edge,
 * and `vx` is zeroed. When the ORIGINAL moved rect overlaps several solids,
 * the body settles against the NEAREST one — the minimum (moving right) /
 * maximum (moving left) candidate face, computed directly. The snap is never
 * re-derived from an already-snapped position: the pre-v14 resolver iterated
 * re-snaps off the updated position, which made the result depend on array
 * order and could cascade the body through solids the original move never
 * overlapped (pinned before the change by
 * `collision-snap-characterization.test.ts`).
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
 * @param solids - Static collision surfaces (passthrough/spring/dashRefill ignored on X).
 * @returns Resolved position, adjusted velocity, and wall-hit flag.
 */
export function resolveAxisX(body: Rect, vx: number, solids: readonly Solid[]): ResolveXResult {
  if (vx === 0) return { x: body.x, vx: 0, hitWall: false };

  const dir = Math.sign(vx);
  // The collision candidates are fixed by the ORIGINAL move — every overlap
  // test below runs against this one rect, never against an updated position.
  const moved: Rect = { x: body.x + vx, y: body.y, width: body.width, height: body.height };
  let newX = moved.x;
  let outVx = vx;
  let hitWall = false;

  for (const solid of solids) {
    if (solid.passthrough) continue;
    if (solid.ladder) continue;
    if (solid.spring !== undefined) continue;
    if (solid.dashRefill) continue;
    if (!aabbOverlap(moved, solid)) continue;
    // Nearest wall among the candidates: min face moving right, max moving left.
    const face = dir > 0 ? solid.x - body.width : solid.x + solid.width;
    if (!hitWall || (dir > 0 ? face < newX : face > newX)) newX = face;
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
 * - Phase 8: `spring` and `dashRefill` marker solids are skipped entirely —
 *   they are non-blocking trigger volumes (springs launch via a `LaunchIntent`,
 *   dash crystals refill via `dashesRemaining`), not collision geometry.
 *
 * Landing snaps the body so its bottom edge meets the solid's top
 * (`y = solid.y - body.height`); ceiling hits snap the body so its top edge
 * meets the solid's bottom (`y = solid.y + solid.height`). In both cases `vy`
 * is zeroed. When the ORIGINAL moved rect overlaps several solids, the body
 * settles on the HIGHEST floor beneath it when falling / the LOWEST ceiling
 * above it when rising — the min/max candidate face, computed directly. As on
 * the X axis, the pre-v14 resolver's iterative re-snap was array-order-
 * dependent and could cascade through surfaces the move never overlapped.
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
 * @param solids     - Static collision surfaces (spring/dashRefill ignored).
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
  // Candidates are fixed by the ORIGINAL move — no re-snap off updated positions.
  const moved: Rect = { x: body.x, y: body.y + vy, width: body.width, height: body.height };
  let newY = moved.y;
  let outVy = vy;
  let landed = false;
  let hitCeiling = false;

  for (const solid of solids) {
    if (solid.ladder) continue;
    if (solid.spring !== undefined) continue;
    if (solid.dashRefill) continue;
    if (solid.passthrough) {
      if (!falling || prevBottom > solid.y) continue;
    }
    if (!aabbOverlap(moved, solid)) continue;
    if (falling) {
      // Highest floor: the minimum candidate top.
      const face = solid.y - body.height;
      if (!landed || face < newY) newY = face;
      outVy = 0;
      landed = true;
    } else {
      // Lowest ceiling: the maximum candidate bottom.
      const face = solid.y + solid.height;
      if (!hitCeiling || face > newY) newY = face;
      outVy = 0;
      hitCeiling = true;
    }
  }

  return { y: newY, vy: outVy, landed, hitCeiling };
}
