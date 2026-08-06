/**
 * Editor camera: pan, zoom, fit, and screen↔cell conversion.
 *
 * Zoom deliberately never responds to a bare wheel event. The editor lives
 * inside a scrolling page, and hijacking the wheel there means a user trying to
 * scroll past the section finds themselves zooming a canvas instead. Zoom is an
 * explicit control, or wheel with a modifier held.
 */

/** Camera state in world (level pixel) space. */
export interface Viewport {
  /** World coordinate at the canvas's top-left. */
  readonly x: number;
  readonly y: number;
  /** Pixels drawn per world pixel. */
  readonly scale: number;
}

/**
 * Zoom steps. Integers keep pixel art crisp; the fractional low end exists so a
 * whole level still fits on screen.
 */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

/** Clamp a scale to the nearest allowed step, rounding down. */
export function snapZoom(scale: number): number {
  let best = ZOOM_STEPS[0];
  for (const step of ZOOM_STEPS) {
    if (step <= scale + 1e-6) best = step;
  }
  return best;
}

/** The next step up from the current scale. */
export function zoomIn(scale: number): number {
  for (const step of ZOOM_STEPS) if (step > scale + 1e-6) return step;
  return ZOOM_STEPS[ZOOM_STEPS.length - 1];
}

/** The next step down from the current scale. */
export function zoomOut(scale: number): number {
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < scale - 1e-6) return ZOOM_STEPS[i];
  }
  return ZOOM_STEPS[0];
}

/**
 * A viewport showing all of `content` inside `view`, centred.
 *
 * The scale is snapped down to a zoom step so floating-point rounding can never
 * leave a one-pixel overflow — the classic cause of a scrollbar appearing on a
 * view that supposedly fits.
 */
export function fitViewport(
  content: Readonly<{ width: number; height: number }>,
  view: Readonly<{ width: number; height: number }>,
): Viewport {
  if (content.width <= 0 || content.height <= 0) return { x: 0, y: 0, scale: 1 };
  const raw = Math.min(view.width / content.width, view.height / content.height);
  const scale = snapZoom(raw);
  return {
    x: (content.width - view.width / scale) / 2,
    y: (content.height - view.height / scale) / 2,
    scale,
  };
}

/**
 * Zoom about a fixed screen point, so the world position under the cursor (or
 * the view's centre) stays put.
 */
export function zoomAbout(
  viewport: Readonly<Viewport>,
  scale: number,
  screenX: number,
  screenY: number,
): Viewport {
  const worldX = viewport.x + screenX / viewport.scale;
  const worldY = viewport.y + screenY / viewport.scale;
  return { x: worldX - screenX / scale, y: worldY - screenY / scale, scale };
}

/** Convert a canvas-space point to world (level pixel) space. */
export function screenToWorld(
  viewport: Readonly<Viewport>,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: viewport.x + screenX / viewport.scale,
    y: viewport.y + screenY / viewport.scale,
  };
}

/**
 * Convert a canvas-space point to a cell coordinate.
 *
 * `Math.floor` rather than truncation: a world coordinate of `-1` belongs to
 * cell `-1`, not cell `0`, and getting that wrong makes painting near the top
 * or left edge land one cell inside.
 */
export function screenToCell(
  viewport: Readonly<Viewport>,
  screenX: number,
  screenY: number,
  gridSize: number,
): { cx: number; cy: number } {
  const world = screenToWorld(viewport, screenX, screenY);
  const size = gridSize > 0 ? gridSize : 1;
  return { cx: Math.floor(world.x / size), cy: Math.floor(world.y / size) };
}

/** Keep a viewport within reach of the content, allowing a margin of slack. */
export function clampViewport(
  viewport: Readonly<Viewport>,
  content: Readonly<{ width: number; height: number }>,
  view: Readonly<{ width: number; height: number }>,
): Viewport {
  const visibleW = view.width / viewport.scale;
  const visibleH = view.height / viewport.scale;
  // A quarter-view of slack keeps edge cells reachable without letting the
  // level be flung off screen entirely.
  const slackX = visibleW / 4;
  const slackY = visibleH / 4;
  const minX = -slackX;
  const minY = -slackY;
  const maxX = Math.max(minX, content.width - visibleW + slackX);
  const maxY = Math.max(minY, content.height - visibleH + slackY);
  return {
    ...viewport,
    x: Math.min(Math.max(viewport.x, minX), maxX),
    y: Math.min(Math.max(viewport.y, minY), maxY),
  };
}
