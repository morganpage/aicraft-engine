/**
 * Type definitions for the collision module.
 *
 * AABB (axis-aligned bounding box) collision is the foundation of the
 * platformer physics layer. These types are the pure-data contract between
 * a game's simulation (which tracks body position + velocity) and the
 * move-and-resolve helpers in `resolve.ts`.
 *
 * The simulation owns authoritative state; these helpers are pure readers
 * that return resolved positions without mutating inputs.
 *
 * @module
 */

/**
 * Axis-aligned bounding box. The fundamental collision shape.
 *
 * Coordinates are world-space. `x`/`y` is the top-left corner; the box spans
 * `[x, x + width]` horizontally and `[y, y + height]` vertically.
 */
export interface Rect {
  /** World X of the top-left corner. */
  x: number;
  /** World Y of the top-left corner. */
  y: number;
  /** Box width in world units. */
  width: number;
  /** Box height in world units. */
  height: number;
}

/**
 * A static collision surface. Extends {@link Rect} with an optional
 * passthrough flag.
 */
export interface Solid extends Rect {
  /**
   * If `true`, the solid only blocks downward movement (falling onto its top
   * face from above). A body rising into it from below, or moving horizontally
   * into it, passes through unaffected. Used for one-way platforms.
   *
   * Default: `false` (fully solid — blocks from all directions).
   */
  passthrough?: boolean;
}

/**
 * Result of resolving horizontal movement against solids.
 */
export interface ResolveXResult {
  /** Resolved X position (snapped to a wall edge if a collision occurred). */
  x: number;
  /** Horizontal velocity after resolution (`0` if a wall was hit, unchanged otherwise). */
  vx: number;
  /** `true` if the body collided with a wall this tick. */
  hitWall: boolean;
}

/**
 * Result of resolving vertical movement against solids.
 */
export interface ResolveYResult {
  /** Resolved Y position (snapped to a surface if a collision occurred). */
  y: number;
  /** Vertical velocity after resolution (`0` if landed or hit a ceiling, unchanged otherwise). */
  vy: number;
  /** `true` if the body landed on top of a solid (ground contact). */
  landed: boolean;
  /** `true` if the body hit a ceiling (head bumped against a solid's underside). */
  hitCeiling: boolean;
}
