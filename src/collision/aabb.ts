import type { Solid } from './types';

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
