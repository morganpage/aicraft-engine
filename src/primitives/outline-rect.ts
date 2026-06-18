/**
 * Flat-fill rect with a 1px dark outline — the canonical "interactive entity"
 * look for ultra-minimalist procedural rendering.
 *
 * Coordinates are floored so outlines land on the pixel grid (no anti-alias
 * seams). Matches GDD §11.3 art rules: flat colors, 1px outline, integer pixels.
 *
 * Extracted from Spitekeep `render/sprites.ts:66`.
 */

/** Default outline color (Spitekeep's near-black devil outline). */
export const DEFAULT_OUTLINE_COLOR = '#1d1128';

/**
 * Draw a flat-filled rectangle with a 1px dark outline.
 *
 * The fill is drawn at `(floor(x), floor(y))` with size `(floor(w), floor(h))`.
 * The outline is drawn inset by 0.5px so it lands on the pixel grid cleanly
 * (Canvas strokes the centerline of the path; the 0.5 offset prevents the
 * 1px stroke from bleeding across two physical pixels).
 *
 * @param ctx - the canvas 2D context (caller owns transform/state)
 * @param x - left edge (will be floored)
 * @param y - top edge (will be floored)
 * @param w - width (will be floored)
 * @param h - height (will be floored)
 * @param fill - fill color as `#rrggbb`
 * @param outline - outline color as `#rrggbb`; defaults to `DEFAULT_OUTLINE_COLOR`
 */
export function outlineRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  outline: string = DEFAULT_OUTLINE_COLOR,
): void {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fw = Math.floor(w);
  const fh = Math.floor(h);
  ctx.fillStyle = fill;
  ctx.fillRect(fx, fy, fw, fh);
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1);
}
