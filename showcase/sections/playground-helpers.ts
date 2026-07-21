/**
 * DOM-free pure helpers for the playground section.
 *
 * These cover the concrete arithmetic the playground performs on user
 * input (mouse → world coords, waypoint conversion, drag-rect
 * normalization, moving-platform placement translation). They are pure
 * so they can be unit-tested in a Node Vitest config without any DOM
 * fake, and they are imported by `sections/playground.ts` so the tests
 * exercise the real code path — not a parallel reimplementation.
 *
 * All exports are pure: inputs are never mutated, fresh records returned.
 *
 * @module
 */

import type { LevelRect } from '../../src/level/types';
import type { EditorOperation } from '../../src/editor';
import type { CatalogEntry } from '../../src/editor';

/**
 * Compute the axis-aligned bounding rect from two corner points. The two
 * points can be in any diagonal order (top-left + bottom-right, or
 * top-right + bottom-left); the result is always normalized to top-left
 * + width/height.
 *
 * Pure: returns a new rect; never mutates input.
 *
 * @param a - First corner.
 * @param b - Second corner.
 * @returns Normalized bounding `{x, y, width, height}`.
 */
export function boundingRect(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);
  return { x, y, width, height };
}

/**
 * Translate a mouse position into the platform's top-left coordinate for
 * a waypoint drag.
 *
 * The path-widget renders each waypoint circle at the platform's
 * **center** (top-left + half rect), so the user grabs a center-rendered
 * handle. Storing the raw mouse as the new top-left waypoint makes the
 * waypoint "jump" by (half-width, half-height) the moment the drag
 * begins. Subtracting half the rect keeps the handle under the cursor.
 *
 * Pure.
 *
 * @param mouse       - World-space mouse position.
 * @param platformRect - The moving-platform's body rect.
 * @returns The waypoint top-left position.
 */
export function mouseToWaypointTopLeft(
  mouse: { readonly x: number; readonly y: number },
  platformRect: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } {
  return {
    x: mouse.x - platformRect.width / 2,
    y: mouse.y - platformRect.height / 2,
  };
}

/**
 * Hit-test a mouse point against the waypoints of a moving-platform's
 * path. The waypoints render at the platform's CENTER (top-left + half
 * rect), so the hit-test offsets each waypoint to its center before
 * comparing to the mouse.
 *
 * Returns the index of the closest waypoint within the hit radius, or -1.
 *
 * Pure.
 *
 * @param mouse       - World-space mouse position.
 * @param path        - Platform path (top-left positions).
 * @param platformRect - Platform body rect.
 * @param hitRadius   - Hit radius in world units.
 */
export function hitTestWaypoint(
  mouse: { readonly x: number; readonly y: number },
  path: readonly { readonly x: number; readonly y: number }[],
  platformRect: { readonly width: number; readonly height: number },
  hitRadius: number,
): number {
  const cx = platformRect.width / 2;
  const cy = platformRect.height / 2;
  const rSq = hitRadius * hitRadius;
  for (let i = 0; i < path.length; i++) {
    const dx = mouse.x - (path[i].x + cx);
    const dy = mouse.y - (path[i].y + cy);
    if (dx * dx + dy * dy <= rSq) return i;
  }
  return -1;
}

/**
 * Translate a movingPlatform catalog entry's default path so that
 * `path[0]` matches the placement position. Returns the full props bag
 * (speed + path + loopMode) for use with an `addEntity` op.
 *
 * Without this, a freshly placed movingPlatform keeps its default
 * path `[{0,0}, {48,0}]` while its body rect is at the drop position;
 * the runtime kernel compiles `path[0]` as the home position, so the
 * platform snaps to `(0, 0)` on play regardless of where it was placed.
 *
 * Pure: returns a new props record.
 *
 * @param entry  - The catalog entry (typically for kind: 'movingPlatform').
 * @param at     - Placement position for the entity's top-left corner.
 * @returns `{ rect, props }` for the resulting `addEntity` op.
 */
export function instantiateMovingPlatformAt(
  entry: CatalogEntry,
  at: { readonly x: number; readonly y: number },
): {
  readonly rect: LevelRect;
  readonly props: Record<string, unknown>;
} {
  const rect: LevelRect = {
    x: at.x,
    y: at.y,
    width: entry.defaultRect.width,
    height: entry.defaultRect.height,
  };
  // Translate the default path so path[0] = at-position. Subsequent
  // waypoints preserve their default relative offset.
  const defaultProps = entry.defaultProps as { speed?: unknown; path?: unknown; loopMode?: unknown };
  const defaultPath = Array.isArray(defaultProps.path)
    ? (defaultProps.path as { x: number; y: number }[])
    : [];
  let translatedPath: { x: number; y: number }[];
  if (defaultPath.length === 0) {
    translatedPath = [{ x: at.x, y: at.y }, { x: at.x + 48, y: at.y }];
  } else {
    const origin = defaultPath[0];
    const dx = at.x - origin.x;
    const dy = at.y - origin.y;
    translatedPath = defaultPath.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  return {
    rect,
    props: {
      ...defaultProps,
      speed:
        typeof defaultProps.speed === 'number'
          ? defaultProps.speed
          : 60,
      path: translatedPath,
      loopMode:
        defaultProps.loopMode === 'pingpong' || defaultProps.loopMode === 'loop'
          ? defaultProps.loopMode
          : 'loop',
    },
  };
}

/**
 * Convert a screen-space (CSS pixel) mouse coordinate into world-space
 * coordinates, given the canvas's CSS-pixel bounding rect and the
 * world's logical dimensions.
 *
 * Pure: no DOM reads. The caller passes in the canvas bounding rect.
 *
 * @param clientX   - Mouse clientX (CSS pixels relative to viewport).
 * @param clientY   - Mouse clientY (CSS pixels relative to viewport).
 * @param canvasRect - The canvas's `getBoundingClientRect()` result.
 * @param worldW    - Logical world width (e.g. 600).
 * @param worldH    - Logical world height (e.g. 400).
 */
export function canvasMouseToWorld(
  clientX: number,
  clientY: number,
  canvasRect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  worldW: number,
  worldH: number,
): { readonly x: number; readonly y: number } {
  const scaleX = canvasRect.width > 0 ? worldW / canvasRect.width : 1;
  const scaleY = canvasRect.height > 0 ? worldH / canvasRect.height : 1;
  return {
    x: (clientX - canvasRect.left) * scaleX,
    y: (clientY - canvasRect.top) * scaleY,
  };
}

/**
 * Input for {@link computePlayerVisuals}. All fields are numeric and
 * DOM-free so the helper is unit-testable in Node.  `scaleX/Y` come from
 * `volumeScale(squashOffset)`; `breathScaleX/Y` from `breathe(tick, cfg)`.
 *
 * @see computePlayerVisuals
 */
export interface PlayerVisualInput {
  /** Collision-box X (world px). */
  readonly coreX: number;
  /** Collision-box Y (world px). */
  readonly coreY: number;
  /** Collision-box width (world px). */
  readonly coreW: number;
  /** Collision-box height (world px). */
  readonly coreH: number;
  /** Horizontal squash/stretch scale (volume-preserving). */
  readonly scaleX: number;
  /** Vertical squash/stretch scale (volume-preserving). */
  readonly scaleY: number;
  /** Horizontal breath scale. */
  readonly breathScaleX: number;
  /** Vertical breath scale. */
  readonly breathScaleY: number;
  /** Foot height in px (drawSimpleFeet footH). */
  readonly footH: number;
  /** Clearance between body bottom and platform surface (px). */
  readonly clearance: number;
}

/**
 * Output of {@link computePlayerVisuals} — the geometry the playground
 * renderer needs to draw the player body and feet with correct
 * platform-surface alignment.
 *
 * All values are in **world coordinates** except `feetBaseY`, which is in
 * the **local** coordinate space the canvas is translated to (origin at
 * the platform surface when grounded).  The canvas translate point is
 * `(coreX + coreW/2, coreY + coreH)`, so local y=0 is the platform
 * surface and negative y is upward.
 *
 * @see computePlayerVisuals
 */
export interface PlayerVisualOutput {
  /** Body rect left edge (world px). */
  readonly bodyX: number;
  /** Body rect top edge (world px). */
  readonly bodyY: number;
  /** Body rect width (world px). */
  readonly bodyW: number;
  /** Body rect height (world px). */
  readonly bodyH: number;
  /**
   * Feet `baseY` for `drawSimpleFeet` (local coords, origin at platform
   * surface).  Equals `-footH` so foot bottom lands exactly at local
   * y=0 (= the platform surface).
   */
  readonly feetBaseY: number;
}

/**
 * Pure DOM-free geometry helper for the playground player.
 *
 * Computes the body draw rect and the simple-feet `baseY` from the
 * collision core, squash/stretch + breath scales, foot dimensions, and
 * the desired clearance between body bottom and platform surface.
 *
 * **Invariants guaranteed at rest** (squash=0 → scaleX/Y=1, breath=1):
 *
 * 1. `feetBaseY + footH === 0` — foot bottom is exactly at local y=0
 *    (the platform surface when grounded).
 * 2. `bodyY + bodyH === coreY + coreH - clearance` — the body bottom is
 *    `clearance` px above the platform surface, never touching it.
 * 3. `bodyH > 0` — the body has positive visible height.
 * 4. The body overlaps the upper portion of the feet slightly (body
 *    bottom at −clearance in local coords sits between foot top at
 *    −footH and foot bottom at 0), creating a clean cartoon join.
 *
 * **Anchoring formula** (the critical detail):
 * The body's **scaled** top is preserved while its height is reduced by
 * `clearance`.  Concretely:
 *   - `scaledDh = coreH * scaleY * breathScaleY` — the full scaled height.
 *   - `dh = scaledDh - clearance` — the visible body height.
 *   - `dy = coreY + (coreH - scaledDh)` — body top anchored at the
 *     scaled position.
 * This gives `bodyBottom = dy + dh = coreBottom − clearance`.  A
 * naïve formula of `dy = coreY + (coreH - dh)` would keep the body
 * bottom pinned to `coreBottom` and never create clearance — the
 * original bug.
 *
 * Pure: returns a fresh record; never mutates input.
 *
 * @param input - collision core, scales, foot, and clearance values.
 * @returns body draw rect (world) + feet baseY (local).
 */
export function computePlayerVisuals(input: PlayerVisualInput): PlayerVisualOutput {
  const {
    coreX, coreY, coreW, coreH,
    scaleX, scaleY, breathScaleX, breathScaleY,
    footH, clearance,
  } = input;

  // Full scaled dimensions (volume-preserving squash × breath modulation).
  const scaledDw = coreW * scaleX * breathScaleX;
  const scaledDh = coreH * scaleY * breathScaleY;

  // Visible body: reduce scaled height by clearance so the body lifts off
  // the platform surface.  Width unchanged.
  const bodyW = scaledDw;
  const bodyH = scaledDh - clearance;

  // Body position: center horizontally in the collision box, anchor top at
  // the SCALED position (not the reduced-height position).  This is the
  // fix — using `scaledDh` rather than `dh` keeps the body top where the
  // full-scale body would be, and the reduced `dh` lifts the bottom.
  const bodyX = coreX + (coreW - bodyW) / 2;
  const bodyY = coreY + (coreH - scaledDh);

  // Feet baseY: foot top at baseY, foot bottom at baseY + footH.  We want
  // the bottom at local y=0 (= the platform surface), so baseY = -footH.
  const feetBaseY = -footH;

  return { bodyX, bodyY, bodyW, bodyH, feetBaseY };
}

/**
 * Build the `addEntity` op for a drag-drawn sizeable kind (platform,
 * passthrough, hazard). If the drag is smaller than one tile, fall back
 * to the catalog default size at the start corner (so a click without a
 * drag still places an entity).
 *
 * Pure.
 *
 * @param entry    - The catalog entry for the kind being drawn.
 * @param start    - Snapped drag-start corner (world coords).
 * @param current  - Snapped current drag corner (world coords).
 * @param minSize  - Minimum dimension (px) that counts as a "real" drag.
 * @returns An `addEntity` EditorOperation ready for `applyOp`.
 */
export function buildDrawnEntityOp(
  entry: CatalogEntry,
  start: { readonly x: number; readonly y: number },
  current: { readonly x: number; readonly y: number },
  minSize: number,
): EditorOperation {
  const box = boundingRect(start, current);
  const rect =
    box.width < minSize || box.height < minSize
      ? {
          x: start.x,
          y: start.y,
          width: entry.defaultRect.width,
          height: entry.defaultRect.height,
        }
      : box;
  return {
    type: 'addEntity',
    kind: entry.kind,
    rect,
    props: entry.defaultProps,
  };
}
