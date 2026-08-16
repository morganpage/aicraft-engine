/**
 * Device-pixel-aware translation helpers.
 *
 * These helpers read no DOM or Canvas state. The caller supplies the DPR and
 * owns the context save/restore boundary.
 *
 * @module
 */

/** A translation aligned to the supplied backing-store pixel grid. */
export interface SnappedTranslation {
  readonly x: number;
  readonly y: number;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function positiveDpr(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Snap a world-space translation to the device-pixel grid.
 *
 * Invalid coordinates become zero and an invalid DPR degrades to one. The
 * function is pure and never reads `window.devicePixelRatio`.
 *
 * NOTE: this snaps a WORLD-SPACE translation only — it ignores zoom. For a
 * camera render transform under a (possibly fractional) zoom, prefer the
 * zoom-aware `cameraTransform` / `applyCameraTransform` from the `camera`
 * module (0.16.x hardening): rounding in world units inside
 * `ctx.scale(zoom, zoom)` still lands on a fractional DEVICE pixel, which
 * antialiases tile edges into hairline seams. This helper remains the right
 * tool for unscaled UI-space drawing.
 */
export function snapCameraTranslation(
  x: number,
  y: number,
  devicePixelRatio: number,
): SnappedTranslation {
  const dpr = positiveDpr(devicePixelRatio);
  return {
    x: Math.round(finiteOrZero(x) * dpr) / dpr,
    y: Math.round(finiteOrZero(y) * dpr) / dpr,
  };
}

/**
 * Apply {@link snapCameraTranslation} to a rendering context.
 *
 * The caller remains responsible for `save()` and `restore()`.
 */
export function applySnappedTranslate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  devicePixelRatio: number,
): void {
  const snapped = snapCameraTranslation(x, y, devicePixelRatio);
  ctx.translate(snapped.x, snapped.y);
}
