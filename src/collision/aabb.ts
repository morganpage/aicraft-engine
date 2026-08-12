import type { Rect, Solid } from './types';

/**
 * Strict AABB overlap test.
 *
 * Two rects overlap only when they share interior area on both axes. Edges
 * that merely touch — `a`'s right at `b`'s left, or `a`'s bottom at `b`'s
 * top — are NOT an overlap. This strictness is load-bearing for the resolver:
 * a body resting exactly on a platform top reads as "not overlapping", so it
 * does not re-collide every tick (which would cause visible jitter / sinking).
 *
 * Pure: no side effects, no mutation of inputs.
 *
 * @example
 * ```ts
 * aabbOverlap({ x: 0, y: 0, width: 10, height: 10 },
 *             { x: 10, y: 0, width: 10, height: 10 }); // false (edges touch)
 * aabbOverlap({ x: 0, y: 0, width: 10, height: 10 },
 *             { x: 9,  y: 0, width: 10, height: 10 }); // true (1px overlap)
 * ```
 *
 * @param a - First rect.
 * @param b - Second rect.
 * @returns `true` if the rects share interior area on both axes.
 */
export function aabbOverlap(
  a: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  b: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Whether `body`'s AABB overlaps any `ladder`-flagged solid in `solids`.
 *
 * Ladder solids are non-colliding climb space (the AABB resolvers skip them);
 * this helper is how a caller asks "is the body on a ladder?" using the same
 * solids array the kernel resolves against. Uses strict {@link aabbOverlap}, so
 * a body resting exactly on a ladder cell's edge reads as not overlapping.
 *
 * Pure: no side effects, no allocation, no mutation.
 *
 * @example
 * ```ts
 * if (overlapsLadder(player, solids)) startClimbing();
 * ```
 *
 * @param body   - The rect to test (typically the actor's core AABB).
 * @param solids - Collision surfaces, some of which may carry `ladder: true`.
 * @returns `true` if `body` overlaps any ladder solid on both axes.
 */
export function overlapsLadder(
  body: Readonly<{ x: number; y: number; width: number; height: number }>,
  solids: readonly Solid[],
): boolean {
  for (const s of solids) {
    if (s.ladder === true && aabbOverlap(body, s)) return true;
  }
  return false;
}

/**
 * Inclusive 1-D band overlap: two spans overlap when they share at least a
 * boundary point. Unlike {@link aabbOverlap} (which is strict / interior-only),
 * this counts mere edge contact as overlap — `aMax === bMin` or
 * `aMin === bMax` returns `true`.
 *
 * The probe helpers use this (rather than {@link aabbOverlap}) because flush
 * contact — a body resting exactly against a surface, gap `0` — must read as
 * "in contact". The strict test would miss those cases and cause wall-grab /
 * ground detection to flicker on sub-pixel alignment.
 */
function bandsOverlapInclusive(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
): boolean {
  return aMin <= bMax && aMax >= bMin;
}

/**
 * Nearest wall a body would hit if it moved up to `distance` pixels toward
 * `side` — a pure geometry query with no dependence on velocity or prior state.
 *
 * The body is treated as swept horizontally from its current x to
 * `x + side * distance`. A solid is a candidate wall when:
 *  - it is fully solid (`passthrough` and `ladder` solids are never walls —
 *    consistent with {@link resolveAxisX}), AND
 *  - its facing edge lies in `[0, distance]` pixels ahead of the body's leading
 *    edge (`body.x + width` for `side = +1`, `body.x` for `side = -1`), so a
 *    body already flush against the wall (gap `0`) counts, AND
 *  - the body's Y band overlaps the solid's Y band (inclusive — edge contact
 *    counts).
 *
 * Returns the candidate with the smallest gap, or `null` if none. Ties resolve
 * to the first solid in array order. `distance <= 0` returns `null`.
 *
 * Pure: no mutation of inputs, no allocation, no reliance on velocity.
 *
 * @example
 * ```ts
 * const wall = probeWall(player, 1, 4, solids);
 * if (wall) beginWallGrab(wall.id ?? null);
 * ```
 *
 * @param body     - The rect to test (typically the actor's core AABB).
 * @param side     - `+1` probes to the right, `-1` to the left.
 * @param distance - Max sweep distance in pixels (`<= 0` → `null`).
 * @param solids   - Collision surfaces.
 * @returns The nearest blocking solid in range, or `null`.
 */
export function probeWall(
  body: Rect,
  side: -1 | 1,
  distance: number,
  solids: readonly Solid[],
): Solid | null {
  if (distance <= 0) return null;
  const leadingEdge = side > 0 ? body.x + body.width : body.x;
  let best: Solid | null = null;
  let bestGap = Infinity;
  for (const s of solids) {
    if (s.passthrough || s.ladder) continue;
    if (s.spring !== undefined || s.dashRefill) continue;
    const facingEdge = side > 0 ? s.x : s.x + s.width;
    const gap = (facingEdge - leadingEdge) * side;
    if (gap < 0 || gap > distance) continue;
    if (!bandsOverlapInclusive(body.y, body.y + body.height, s.y, s.y + s.height)) continue;
    if (gap < bestGap) {
      bestGap = gap;
      best = s;
    }
  }
  return best;
}

/**
 * Nearest standable surface within `distance` pixels below the body's bottom
 * edge — pure geometry, no velocity dependence.
 *
 * A solid is candidate ground when:
 *  - it is NOT a ladder (ladders are climb space, not ground). `passthrough`
 *    platforms ARE included — they are standable from above, consistent with
 *    {@link resolveAxisY}'s downward-landing rule, AND
 *  - its top (`solid.y`) lies in `[bottom, bottom + distance]` where
 *    `bottom = body.y + body.height` (flush contact at `bottom` counts), AND
 *  - the body horizontally overlaps it (inclusive).
 *
 * Returns the candidate with the smallest top (the highest surface), or `null`.
 * `distance <= 0` returns `null`.
 *
 * Pure: no mutation of inputs.
 *
 * @example
 * ```ts
 * const ground = probeGround(player, 2, solids);
 * if (ground) setCoyoteTimer();
 * ```
 *
 * @param body     - The rect to test.
 * @param distance - Max distance below the body's bottom to search (`<= 0` → `null`).
 * @param solids   - Collision surfaces.
 * @returns The nearest standable solid below, or `null`.
 */
export function probeGround(
  body: Rect,
  distance: number,
  solids: readonly Solid[],
): Solid | null {
  if (distance <= 0) return null;
  const bottom = body.y + body.height;
  let best: Solid | null = null;
  let bestTop = Infinity;
  for (const s of solids) {
    if (s.ladder) continue;
    if (s.spring !== undefined || s.dashRefill) continue;
    if (s.y < bottom || s.y > bottom + distance) continue;
    if (!bandsOverlapInclusive(body.x, body.x + body.width, s.x, s.x + s.width)) continue;
    if (s.y < bestTop) {
      bestTop = s.y;
      best = s;
    }
  }
  return best;
}

/**
 * Nearest blocking solid within `distance` pixels above the body's top edge —
 * pure geometry, no velocity dependence.
 *
 * A solid is a candidate ceiling when:
 *  - it is fully solid (`passthrough` and `ladder` excluded — passthrough never
 *    blocks upward movement, consistent with {@link resolveAxisY}), AND
 *  - its bottom (`solid.y + solid.height`) lies in
 *    `[body.y - distance, body.y]` (flush contact at `body.y` counts), AND
 *  - the body horizontally overlaps it (inclusive).
 *
 * Returns the candidate with the largest bottom (the lowest underside, i.e. the
 * closest to the head), or `null`. `distance <= 0` returns `null`.
 *
 * Pure: no mutation of inputs.
 *
 * @example
 * ```ts
 * const ceiling = probeCeiling(player, 3, solids);
 * if (ceiling) cancelJump();
 * ```
 *
 * @param body     - The rect to test.
 * @param distance - Max distance above the body's top to search (`<= 0` → `null`).
 * @param solids   - Collision surfaces.
 * @returns The nearest blocking solid above, or `null`.
 */
export function probeCeiling(
  body: Rect,
  distance: number,
  solids: readonly Solid[],
): Solid | null {
  if (distance <= 0) return null;
  const top = body.y;
  let best: Solid | null = null;
  let bestBottom = -Infinity;
  for (const s of solids) {
    if (s.passthrough || s.ladder) continue;
    if (s.spring !== undefined || s.dashRefill) continue;
    const sBottom = s.y + s.height;
    if (sBottom < top - distance || sBottom > top) continue;
    if (!bandsOverlapInclusive(body.x, body.x + body.width, s.x, s.x + s.width)) continue;
    if (sBottom > bestBottom) {
      bestBottom = sBottom;
      best = s;
    }
  }
  return best;
}
