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
 * passthrough flag and an optional stable identity string.
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
  /**
   * If `true`, the solid is a ladder cell — climb space, NOT collision
   * geometry. The AABB resolvers skip ladder solids entirely (they block no
   * movement in any direction), and a climb ability reads them to detect
   * "is the body on a ladder?". Default `undefined`/`false`.
   */
  ladder?: boolean;
  /**
   * Phase 8 — spring trigger volume. When present, the solid is a NON-BLOCKING
   * trigger volume (the AABB resolvers SKIP it, like `passthrough`/`ladder`)
   * that launches the actor upward when overlapped. `launch` is the
   * pre-computed upward launch velocity in px/s (negative — upward, +Y is
   * down), set at level-compile time from the entity's `power` and the
   * platformer config (`springBounceVy` / `springSuperBounceVy`). The
   * platformer kernel's `springAbility` reads this via `aabbOverlap` and emits
   * a `LaunchIntent { source: 'spring' }` so the impulse routes through the
   * §0b launch contract (otherwise the jump slice would discard it). The
   * matched `InteractionEvent { kind: 'spring', entityId: solid.id }` lets the
   * consumer own per-spring cooldown / visuals.
   *
   * Phase D2 adds the optional `super` flag so the `springLaunch` feel moment
   * can report super-spring provenance without reverse-inferring it from a
   * velocity equality. Level compile sets `super: power === 'super'`;
   * hand-rolled springs omit it (treated as `false`).
   *
   * Default: `undefined` (not a spring).
   */
  readonly spring?: { readonly launch: number; readonly super?: boolean };
  /**
   * Phase 8 — dash-refill (dash crystal) trigger volume. When `true`, the
   * solid is a NON-BLOCKING trigger volume (the AABB resolvers SKIP it, like
   * `passthrough`/`ladder`) that refills the actor's `dashesRemaining` to
   * `config.maxDashes` when overlapped. The kernel emits
   * `InteractionEvent { kind: 'dashRefill', entityId: solid.id }`; the consumer
   * then REMOVES the crystal from the per-tick `solids[]` (its respawn cycle)
   * so it cannot refill again until re-added. Uses `solid.id` as the
   * `entityId`. Default `undefined`/`false`.
   */
  readonly dashRefill?: boolean;
  /**
   * Optional stable identity string for this solid. The platformer kernel
   * (`src/platformer/`) reads this to populate `Contacts.groundId` /
   * `leftWallId` / `rightWallId` / `ceilingId` — the durable "which solid am
   * I touching" handle that survives re-creation of the solids array each tick
   * (index identity would break under add/remove; reference equality breaks
   * across serialized replays).
   *
   * Consumers assign stable string IDs to level geometry they need to track
   * (moving platforms, named walls). Static decoration geometry may leave this
   * `undefined`; the kernel normalizes an absent id to `null` in `Contacts`.
   *
   * Optional and non-breaking: existing collision code never reads this field.
   *
   * Default: `undefined`.
   */
  id?: string;
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

/**
 * Tile solidity classification for the tile-grid query.
 *
 * - `'empty'` — no collision (air / decorative).
 * - `'solid'` — fully solid surface (blocks from all directions).
 * - `'passthrough'` — one-way platform (blocks downward movement only).
 *
 * @see TileSolidityQuery
 */
export type TileType = 'empty' | 'solid' | 'passthrough';

/**
 * Classifies a tile at grid coordinates. The consumer wraps their tile data
 * structure (2D array, flat array, string map, procedural function) behind
 * this uniform interface. Out-of-bounds tiles should return `'empty'` (or
 * `'solid'` for level boundaries — the consumer's choice).
 *
 * Pure: the query is a reader of the underlying tile data; it must not mutate
 * game state. Tile collision helpers call it many times per tick, so it should
 * be cheap (a direct array/lookup, not a traversal).
 *
 * @example
 * ```ts
 * const grid: number[][] = [[1, 1, 1], [1, 0, 0], [1, 0, 0]];
 * const query: TileSolidityQuery = (tileX, tileY) => {
 *   if (tileY < 0 || tileY >= grid.length || tileX < 0 || tileX >= grid[0].length) return 'empty';
 *   return grid[tileY][tileX] === 1 ? 'solid' : 'empty';
 * };
 * ```
 */
export type TileSolidityQuery = (tileX: number, tileY: number) => TileType;
