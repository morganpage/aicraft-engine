/**
 * DOM-free pure helpers for the playground section.
 *
 * These cover the concrete arithmetic the playground performs on user
 * input (mouse → world coords, waypoint conversion, drag-rect
 * normalization, moving-platform + enemy placement translation, toolbar
 * identity, play-mode render filtering). They are pure so they can be
 * unit-tested in a Node Vitest config without any DOM fake, and they are
 * imported by `sections/playground.ts` so the tests exercise the real code
 * path — not a parallel reimplementation.
 *
 * All exports are pure: inputs are never mutated, fresh records returned.
 *
 * @module
 */

import type { LevelRect, EntityKind, LevelEntity } from '../../src/level/types';
import type { EditorOperation, CatalogEntry, EntityCatalog } from '../../src/editor';

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

// ---------------------------------------------------------------------------
// Enemy editor helpers (regression: archetype identity + placement).
//
// These three helpers fix the three concrete bugs reported in the
// showcase enemy editor:
//   1. Toolbar active state must distinguish Spinny vs Turret buttons
//      (both ship with `data-kind="enemy"` but a different archetype).
//   2. Placement / ghost preview must resolve Spinny / Turret by their
//      dedicated catalog keys (`entries.spinny` / `entries.turret`) so
//      the dedicated default `params.patrolPath` is honored — the generic
//      `enemy` entry has `params: {}` and would silently drop the patrol.
//   3. Authored enemy entities must NOT be drawn through `drawLevelEntity`
//      in play mode — runtime `drawEnemies` is the sole enemy renderer.
// ---------------------------------------------------------------------------

/**
 * Decide whether a toolbar button should be marked active given the
 * current editor selection and the button's `data-kind` / `data-archetype`
 * attributes.
 *
 * The toolbar ships two enemy buttons (`Spinny` and `Turret`) that both
 * carry `data-kind="enemy"` but differ on `data-archetype`. A naive
 * `kind === selectedKind` test lights both buttons up at once when
 * either enemy archetype is selected. This helper compares the archetype
 * too whenever the button's kind is `'enemy'`, so clicking Spinny does
 * not activate Turret and vice versa.
 *
 * Pure.
 *
 * @param selectedKind      - The kind currently selected in the editor.
 * @param selectedArchetype - The enemy archetype currently selected, or
 *                            `null` if a non-enemy kind is selected.
 * @param btnKind           - The `data-kind` of the toolbar button.
 * @param btnArchetype      - The `data-archetype` of the toolbar button,
 *                            or `null` if the button has no archetype
 *                            (the generic "Enemy" button).
 * @returns `true` iff the button should be marked active.
 */
export function isEnemyToolbarButtonActive(
  selectedKind: EntityKind,
  selectedArchetype: string | null,
  btnKind: EntityKind,
  btnArchetype: string | null,
): boolean {
  if (btnKind !== 'enemy') {
    return selectedKind === btnKind;
  }
  // Enemy-kind button. Require an enemy selection; if the button carries
  // a specific archetype, it must match the selected one. A button with
  // no archetype (the generic "Enemy" button) is treated as a wildcard
  // match for any selected enemy archetype.
  if (selectedKind !== 'enemy') return false;
  if (btnArchetype === null) return true;
  return selectedArchetype === btnArchetype;
}

/**
 * Resolve the catalog entry to use when placing / ghost-previewing an
 * enemy of the given archetype.
 *
 * The shipped catalog ships dedicated entries for the built-in archetypes
 * (`entries.spinny`, `entries.turret`) so their tuned `defaultProps`
 * (Spinny's `patrolPath`, Turret's `fireRate` / `projectileSpeed`) are
 * honored at placement time. Looking up the generic `entries.enemy`
 * instead (the historical bug) drops those defaults because the generic
 * entry's `defaultProps.params` is `{}` — a freshly placed Spinny would
 * have no patrol and silently fall back to ledge/wall patrolling at
 * runtime, with no path widget shown in the editor.
 *
 * Resolution order:
 *   1. `catalog.entries[archetype]` if it exists and is `kind: 'enemy'`.
 *   2. Otherwise the generic `enemy` catalog entry (via `findCatalogEntry`).
 *
 * Pure: never throws. Returns the generic entry on miss; the caller can
 * pass the result straight into {@link instantiateEnemyAt}.
 *
 * @param catalog    - The catalog to resolve against.
 * @param archetype  - The enemy archetype string (e.g. `'spinny'`).
 * @returns The matching `CatalogEntry`, or the generic enemy entry as a
 *          safe fallback.
 */
export function resolveEnemyCatalogEntry(
  catalog: EntityCatalog,
  archetype: string,
): CatalogEntry {
  const direct = catalog.entries[archetype];
  if (direct !== undefined && direct.kind === 'enemy') return direct;
  // Safe generic fallback. `findCatalogEntry` walks the entries record
  // and returns the first `kind: 'enemy'` entry — guaranteed to exist
  // for any catalog that includes the default `enemy` prefab.
  const fallback = findEnemyEntry(catalog);
  if (fallback !== undefined) return fallback;
  // Last-resort defensive fallback: synthesize a 16×16 enemy entry so
  // placement still works on a stripped catalog. Never throws.
  return {
    kind: 'enemy',
    label: 'Enemy',
    defaultRect: { x: 0, y: 0, width: 16, height: 16 },
    defaultProps: { archetype, params: {} },
  };
}

/**
 * Internal: find the generic `kind: 'enemy'` entry in a catalog. Returns
 * `undefined` if no enemy-kind entry exists (extremely unlikely for any
 * real catalog — the default catalog always ships one).
 */
function findEnemyEntry(catalog: EntityCatalog): CatalogEntry | undefined {
  for (const key in catalog.entries) {
    const entry = catalog.entries[key];
    if (entry && entry.kind === 'enemy') return entry;
  }
  return undefined;
}

/**
 * Instantiate an enemy catalog entry at a world-space position, translating
 * its default `params.patrolPath` so point 0 equals the placement position.
 *
 * Mirrors {@link instantiateMovingPlatformAt} for the enemy archetype
 * contract: the runtime spinny behavior targets `patrolPath` waypoints
 * relative to its body rect, so a freshly placed Spinny whose patrol is
 * still at the catalog default `[{0,0}, {48,0}]` would walk back toward
 * `(0, 0)` on play. This helper translates the patrol so point 0 lands at
 * the placement and the remaining waypoints preserve their default
 * relative offset (Spinny → point 1 = placement + (48, 0)).
 *
 * The resulting `props.archetype` is always set to the requested
 * archetype — this lets a caller place a Turret from the generic enemy
 * entry (which has `defaultProps.archetype === 'spinny'`) and still get
 * the correct dispatch key.
 *
 * Pure: returns a new props record; the input entry is untouched.
 *
 * @param entry     - The resolved catalog entry (dedicated prefab or
 *                    generic fallback from {@link resolveEnemyCatalogEntry}).
 * @param at        - Placement position for the entity's top-left corner.
 * @param archetype - The enemy archetype string to stamp onto `props.archetype`.
 * @returns `{ rect, props }` for the resulting `addEntity` op.
 */
export function instantiateEnemyAt(
  entry: CatalogEntry,
  at: { readonly x: number; readonly y: number },
  archetype: string,
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

  const defaultProps = entry.defaultProps as {
    params?: Record<string, unknown>;
  };
  const defaultParams =
    defaultProps.params && typeof defaultProps.params === 'object'
      ? (defaultProps.params as Record<string, unknown>)
      : {};

  // Translate patrolPath so point[0] = at-position. Subsequent waypoints
  // preserve their default relative offset (no rotation / scaling).
  const defaultPatrol = Array.isArray(defaultParams.patrolPath)
    ? (defaultParams.patrolPath as { x: number; y: number }[])
    : null;

  let translatedParams: Record<string, unknown>;
  if (defaultPatrol !== null && defaultPatrol.length >= 2) {
    const origin = defaultPatrol[0];
    const dx = at.x - origin.x;
    const dy = at.y - origin.y;
    const translatedPatrol = defaultPatrol.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    translatedParams = { ...defaultParams, patrolPath: translatedPatrol };
  } else {
    // No patrol in the source entry — leave params alone so a freshly
    // placed Turret / unknown archetype doesn't get a synthesized patrol.
    translatedParams = { ...defaultParams };
  }

  return {
    rect,
    props: {
      ...defaultProps,
      archetype,
      params: translatedParams,
    },
  };
}

/**
 * Decide whether an authored `LevelEntity` should be drawn through the
 * library's `drawLevelEntity` dispatcher during Play mode.
 *
 * Authored `enemy` entities are skipped in Play mode because the runtime
 * `drawEnemies` renderer is the sole source of truth for enemy visuals
 * (per-archetype treatments: spinny sawblade rotation, turret direction
 * indicator, etc.). Drawing the authored rectangle through
 * `drawLevelEntity` would (a) double-render enemies and (b) show a static
 * rectangle at the authored position rather than the runtime position.
 *
 * Authored `spawn` entities are also skipped — the player IS the spawn
 * marker in play mode.
 *
 * In Edit mode the caller should NOT consult this helper: authored enemy
 * rectangles must remain visible + selectable so the user can move / delete
 * them. Edit mode draws every entity unconditionally.
 *
 * Pure.
 *
 * @param entity - The authored level entity.
 * @returns `true` if the entity should be rendered via `drawLevelEntity`
 *          in Play mode; `false` if it is owned by a runtime renderer.
 */
export function shouldRenderEntityInPlay(entity: LevelEntity): boolean {
  // `spawn` is rendered as the player position; `enemy` is rendered by
  // `drawEnemies`. Every other kind flows through `drawLevelEntity`.
  return entity.kind !== 'spawn' && entity.kind !== 'enemy';
}

// ---------------------------------------------------------------------------
// Turret shootTo widget helpers (pure geometry + hit tests).
//
// Treatment C: solid amber vector, faint amber range disk with subtle fill,
// double-ring target reticle handle (10px outer, 4px inner dot, crosshair
// ticks), dark-blue-on-amber pill label. All geometry computed here; the
// renderer in playground.ts draws the shapes.
// ---------------------------------------------------------------------------

/**
 * Configuration for the shootTo widget rendering.
 */
export const SHOOT_TO_WIDGET_CONFIG = {
  /** Reticle outer ring radius (px). */
  reticleOuterRadius: 10,
  /** Reticle inner dot radius (px). */
  reticleInnerRadius: 4,
  /** Reticle crosshair tick length beyond outer ring (px). */
  reticleTickLength: 4,
  /** Arrowhead half-width perpendicular to the direction (px). */
  arrowHalfWidth: 6,
  /** Arrowhead length along the direction (px). */
  arrowLength: 12,
  /** Distance pill offset perpendicular to the vector (px). */
  pillOffset: 14,
  /** Hit-test radius for the endpoint handle (px). */
  hitRadius: 12,
} as const;

/**
 * Geometry data for the shootTo widget — everything the renderer needs
 * to draw the Treatment C reticle widget.
 */
export interface ShootToWidgetGeometry {
  /** Turret center in world space. */
  readonly centerX: number;
  readonly centerY: number;
  /** Line endpoint (center + shootTo vector). */
  readonly endX: number;
  readonly endY: number;
  /** Normalized direction vector. */
  readonly dirX: number;
  readonly dirY: number;
  /** Range magnitude (0 when no range). */
  readonly maxRange: number;
  /** Distance pill label text. */
  readonly labelText: string;
}

/**
 * Compute shootTo widget geometry for a turret entity.
 *
 * Returns all the data a Canvas2D renderer needs to draw:
 *   - Amber vector line from turret center to endpoint
 *   - Target reticle handle at endpoint
 *   - Faint amber range disk (when maxRange > 0)
 *   - Dark-blue-on-amber distance pill
 *
 * Pure: returns a fresh record; never mutates input.
 *
 * @param entityX - turret body top-left X
 * @param entityY - turret body top-left Y
 * @param entityW - turret body width
 * @param entityH - turret body height
 * @param shootTo - the raw shootTo param from level JSON (may be anything)
 * @returns geometry data for Canvas2D rendering, or null if shootTo is invalid/zero
 */
export function computeShootToWidgetGeometry(
  entityX: number,
  entityY: number,
  entityW: number,
  entityH: number,
  shootTo: unknown,
): ShootToWidgetGeometry | null {
  if (!shootTo || typeof shootTo !== 'object') return null;

  const st = shootTo as Record<string, unknown>;
  const rawX = Number(st.x);
  const rawY = Number(st.y);
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;

  const magnitude = Math.hypot(rawX, rawY);
  if (magnitude === 0) return null;

  const dirX = rawX / magnitude;
  const dirY = rawY / magnitude;
  const cx = entityX + entityW / 2;
  const cy = entityY + entityH / 2;
  const endX = cx + dirX * magnitude;
  const endY = cy + dirY * magnitude;

  return {
    centerX: cx,
    centerY: cy,
    endX,
    endY,
    dirX,
    dirY,
    maxRange: magnitude,
    labelText: `${Math.round(magnitude)}px`,
  };
}

/**
 * Hit-test a mouse point against the shootTo endpoint handle.
 *
 * The handle renders at `center + shootTo` (the endpoint of the vector).
 * Returns `true` if the mouse is within the hit radius.
 *
 * Pure.
 *
 * @param mouse - World-space mouse position.
 * @param centerX - turret center X
 * @param centerY - turret center Y
 * @param shootTo - the raw shootTo param
 * @param hitRadius - hit radius in world units
 * @returns `true` if the mouse hits the endpoint handle
 */
export function hitTestShootToEndpoint(
  mouse: { readonly x: number; readonly y: number },
  centerX: number,
  centerY: number,
  shootTo: unknown,
  hitRadius: number,
): boolean {
  if (!shootTo || typeof shootTo !== 'object') return false;
  const st = shootTo as Record<string, unknown>;
  const rawX = Number(st.x);
  const rawY = Number(st.y);
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return false;
  const magnitude = Math.hypot(rawX, rawY);
  if (magnitude === 0) return false;

  const endX = centerX + (rawX / magnitude) * magnitude;
  const endY = centerY + (rawY / magnitude) * magnitude;
  const dx = mouse.x - endX;
  const dy = mouse.y - endY;
  return dx * dx + dy * dy <= hitRadius * hitRadius;
}

/**
 * Compute the relative shootTo vector from a drag endpoint.
 *
 * The endpoint is in world space; the turret center is the origin.
 * The result is the raw relative vector (NOT normalized — preserves
 * the drag distance as the range). Snaps to grid if desired.
 *
 * Pure.
 *
 * @param endpointX - dragged endpoint X (world space)
 * @param endpointY - dragged endpoint Y (world space)
 * @param centerX - turret center X
 * @param centerY - turret center Y
 * @returns the relative shootTo vector {x, y}
 */
export function computeShootToFromEndpoint(
  endpointX: number,
  endpointY: number,
  centerX: number,
  centerY: number,
): { readonly x: number; readonly y: number } {
  return {
    x: endpointX - centerX,
    y: endpointY - centerY,
  };
}

/**
 * Decide whether a turret entity should show the shootTo widget.
 *
 * A turret shows the widget when it is selected AND has a valid
 * (non-zero, finite) shootTo param. This is checked in edit mode
 * only.
 *
 * Pure.
 *
 * @param entity - the level entity (must be kind: 'enemy', archetype: 'turret')
 * @returns `true` if the shootTo widget should be rendered
 */
export function shouldShowShootToWidget(entity: LevelEntity): boolean {
  if (entity.kind !== 'enemy') return false;
  const props = entity.props as { archetype?: string; params?: Record<string, unknown> };
  if (props.archetype !== 'turret') return false;
  const params = props.params;
  if (!params || typeof params !== 'object') return false;
  const shootTo = params.shootTo;
  if (!shootTo || typeof shootTo !== 'object') return false;
  const st = shootTo as Record<string, unknown>;
  const rawX = Number(st.x);
  const rawY = Number(st.y);
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return false;
  return Math.hypot(rawX, rawY) > 0;
}
