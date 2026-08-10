/**
 * Flat-fill rect with a 1px dark outline — the canonical "interactive entity"
 * look for ultra-minimalist procedural rendering.
 *
 * Coordinates are floored so outlines land on the pixel grid (no anti-alias
 * seams). Matches GDD §11.3 art rules: flat colors, 1px outline, integer pixels.
 */

/** Default outline color (near-black). */
export const DEFAULT_OUTLINE_COLOR = '#1d1128';

/**
 * Fill-extent policy for {@link outlineRect}.
 *
 * - `'floor'` (default): fill extent = `floor(w)` and `floor(h)`. Truncates
 *   ~1px short on fractional positions. Fine for static integer-position
 *   rects.
 * - `'ceil'`: fill extent = `ceil(x+w) - floor(x)` and `ceil(y+h) - floor(y)`.
 *   Covers the full geometric bounds. Use for fractional-position rects
 *   (sliding tiles, moving-void fragments, animated sprites) to prevent the
 *   1px void slivers that `'floor'` would leave behind.
 *
 * For integer positions both modes are identical: `ceil(x+w) - floor(x) == w`
 * when `x, w ∈ ℤ`.
 */
export type OutlineCoverage = 'floor' | 'ceil';

/**
 * Draw a flat-filled rectangle with a 1px dark outline.
 *
 * The fill is drawn at `(floor(x), floor(y))`. Its size depends on
 * {@link OutlineCoverage} — `'floor'` truncates to `floor(w)`/`floor(h)`;
 * `'ceil'` extends to `ceil(x+w)`/`ceil(y+h)` so the full geometric bounds
 * are covered. The outline is drawn inset by 0.5px so it lands on the pixel
 * grid cleanly (Canvas strokes the centerline of the path; the 0.5 offset
 * prevents the 1px stroke from bleeding across two physical pixels).
 *
 * @param ctx - the canvas 2D context (caller owns transform/state)
 * @param x - left edge (will be floored)
 * @param y - top edge (will be floored)
 * @param w - width (extent depends on `coverage`)
 * @param h - height (extent depends on `coverage`)
 * @param fill - fill color as `#rrggbb`
 * @param outline - outline color as `#rrggbb`; defaults to `DEFAULT_OUTLINE_COLOR`
 * @param coverage - `'floor'` (default) truncates the fill to `floor(w)`/`floor(h)`;
 *   `'ceil'` extends the fill to `ceil(x+w) - floor(x)`/`ceil(y+h) - floor(y)` so
 *   fractional-position rects cover their full geometric bounds (no 1px void
 *   slivers). No-op for integer positions.
 */
export function outlineRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  outline: string = DEFAULT_OUTLINE_COLOR,
  coverage: OutlineCoverage = 'floor',
): void {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  // 'ceil' covers the full [floor(x), ceil(x+w)] pixel range — prevents 1px
  // void slivers on fractional-position rects (sliding tiles, moving-void
  // fragments). 'floor' truncates to floor(w) (current behavior). For integer
  // positions both are identical: ceil(x+w) - floor(x) == w when x, w ∈ ℤ.
  const fw = coverage === 'ceil' ? Math.ceil(x + w) - fx : Math.floor(w);
  const fh = coverage === 'ceil' ? Math.ceil(y + h) - fy : Math.floor(h);
  ctx.fillStyle = fill;
  ctx.fillRect(fx, fy, fw, fh);
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1);
}
