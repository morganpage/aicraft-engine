/**
 * Parallax background helper.
 *
 * Computes the scroll offset for a parallax background layer given the camera
 * position and a depth factor. The consumer translates the canvas by the
 * returned offset before drawing the layer:
 *
 * ```ts
 * const off = parallaxOffset(cam.x, cam.y, PARALLAX_FAR);
 * ctx.translate(off.x, off.y);
 * drawStarfield(ctx);
 * ```
 *
 * Pure: no side effects, no DOM access, no mutation, no `Math.random`.
 * Output is deterministic for identical inputs across calls.
 */

/** Typical factor for far background layers (distant mountains, stars). */
export const PARALLAX_FAR = 0.25;

/** Typical factor for mid-depth layers (hills, trees, structures). */
export const PARALLAX_MID = 0.5;

/** Gameplay-layer factor (same scroll as the world). */
export const PARALLAX_NEAR = 1.0;

/**
 * Compute the scroll offset for a parallax layer given the camera position.
 *
 * The offset is `camera * factor` per axis. The consumer translates the
 * canvas by this offset before drawing the layer:
 *   `ctx.translate(offset.x, offset.y); drawLayer();`
 *
 * Factor convention:
 *   - `0` = static (doesn't scroll — fixed background, e.g., a sky gradient).
 *   - `0.2–0.4` = far (slow scroll — distant mountains, stars).
 *   - `0.5` = mid (half-speed — hills, trees).
 *   - `1.0` = gameplay speed (same scroll as the world — the main tile layer).
 *   - `>1.0` = foreground (scrolls faster than the camera — close foreground props).
 *
 * Pure: no side effects, no DOM, no mutation.
 *
 * @param cameraX - camera world X position
 * @param cameraY - camera world Y position
 * @param factor  - depth factor (0 = static, 1 = gameplay, <1 = far, >1 = near)
 * @returns `{ x: -cameraX * factor, y: -cameraY * factor }` (negative because
 *   the layer moves OPPOSITE to the camera — as the camera moves right, layers
 *   scroll left)
 *
 * @example
 * ```ts
 * parallaxOffset(100, 50, 0.5); // { x: -50, y: -25 }  mid layer
 * parallaxOffset(100, 50, 0);   // { x: 0, y: 0 }      static sky
 * parallaxOffset(100, 50, 2);   // { x: -200, y: -100 } foreground
 * ```
 */
export function parallaxOffset(
  cameraX: number,
  cameraY: number,
  factor: number,
): { x: number; y: number } {
  const x = -cameraX * factor;
  const y = -cameraY * factor;
  // Normalize -0 to +0: a static/origin camera yields a clean (0,0) offset
  // rather than signed zero (which would fail Object.is / toEqual equality and
  // has no semantic meaning for a scroll offset).
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}
