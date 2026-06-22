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

// =============================================================================
// Seamless-tiled parallax (Optimal Branching Remainder)
//
// Closes the gap that `parallaxOffset` leaves open: how to wrap a seamless
// tile infinitely across the viewport at a parallax depth, without drawing
// fully-off-screen copies on perfect grid alignment. See
// `docs/design/seamless-tiled-parallax-decision.md`.
// =============================================================================

/**
 * Result geometry for a seamless-tiled parallax layer along one axis.
 *
 * Returned by `tiledParallaxRange`. The consumer writes the draw loop:
 *
 * ```ts
 * const r = tiledParallaxRange(cam.x, PARALLAX_FAR, 256, viewport.width);
 * for (let i = 0; i < r.copies; i++) {
 *   drawTile(ctx, r.startX + i * 256);
 * }
 * ```
 */
export interface TiledParallaxRange {
  /**
   * Leftmost (or topmost) screen-space coordinate to begin drawing.
   * Always ≤ 0 (negative or zero). Negative means the first tile is
   * partially off-screen left.
   */
  readonly startX: number;
  /**
   * Number of tile copies needed to fully cover the viewport. Always ≥ 1,
   * except when `tileWidth <= 0` (the degenerate guard) where it is 0.
   */
  readonly copies: number;
}

/**
 * Compute the draw geometry for a seamlessly tiled parallax background layer
 * along a single axis.
 *
 * Given a camera coordinate, a parallax depth factor, a seamless tile size,
 * and a viewport size, returns the leftmost screen-space coordinate to start
 * drawing at and how many tile copies are needed to fully cover the viewport.
 *
 * Uses the Optimal Branching Remainder formula: when the camera aligns
 * perfectly with the tile grid, `startX` is exactly `0` — avoiding a
 * wasted off-screen `drawImage` call on the left edge.
 *
 * The consumer writes the draw loop:
 * ```ts
 * const r = tiledParallaxRange(cam.x, PARALLAX_FAR, 256, viewport.width);
 * for (let i = 0; i < r.copies; i++) {
 *   drawMyTile(ctx, r.startX + i * 256, y);
 * }
 * ```
 *
 * **Defensive guard:** If `tileWidth` is zero or negative, returns
 * `{ startX: 0, copies: 0 }` — preventing infinite loops
 * and division-by-zero. Documented; consumer checks `copies > 0`.
 *
 * **Sub-pixel seam mitigation:** To prevent 1px gaps between tiles at
 * sub-pixel camera positions, the consumer can draw each tile 1px wider
 * than its logical width: `drawImage(img, x, y, tileWidth + 1, tileHeight)`.
 * This "overscan" overlaps adjacent tiles by 1px, eliminating seams while
 * preserving smooth sub-pixel scrolling. For pixel-art games, integer-snapping
 * `startX` via `Math.round` is an alternative.
 *
 * **Performance note:** `tileWidth < 1` produces many copies to cover the
 * viewport — typically undesirable, but the helper does not enforce a minimum.
 *
 * Pure: no side effects, no DOM access, no mutation, no `Math.random`.
 * Output is deterministic for identical inputs across calls.
 *
 * @param camera - camera world coordinate along this axis
 * @param factor - parallax depth factor (0 = static, 1 = gameplay speed)
 * @param tileWidth - pixel width of one seamless tile (must be > 0 for valid geometry)
 * @param viewportWidth - pixel width of the viewport along this axis
 * @returns `{ startX, copies }` — geometry for the draw loop; tile spacing is the original `tileWidth`
 *
 * @example
 * ```ts
 * // Side-scroller: far mountain layer, 256px tile, 800px viewport
 * const r = tiledParallaxRange(1200, PARALLAX_FAR, 256, 800);
 * // r.startX ≈ -100 (shifted left to cover viewport edge)
 * // r.copies = 4 (enough 256px tiles to cover 800px)
 * for (let i = 0; i < r.copies; i++) {
 *   drawMountainTile(ctx, r.startX + i * 256, 0);
 * }
 * ```
 *
 * @example
 * ```ts
 * // 4-layer side-scroller — one range per layer, one loop per layer
 * import { tiledParallaxRange, PARALLAX_FAR, PARALLAX_MID, PARALLAX_NEAR } from 'aicraft-engine/src/primitives';
 *
 * const layers = [
 *   { factor: 0.15, tileWidth: 512, draw: drawSkyFog },
 *   { factor: 0.30, tileWidth: 256, draw: drawFortress },
 *   { factor: 0.55, tileWidth: 128, draw: drawStatues },
 *   { factor: 0.85, tileWidth: 64,  draw: drawChains },
 * ];
 *
 * function renderBackground(ctx, cameraX, viewportWidth, viewportHeight) {
 *   for (const layer of layers) {
 *     const range = tiledParallaxRange(cameraX, layer.factor, layer.tileWidth, viewportWidth);
 *     for (let i = 0; i < range.copies; i++) {
 *       layer.draw(ctx, range.startX + i * layer.tileWidth, 0, layer.tileWidth, viewportHeight);
 *     }
 *   }
 * }
 * ```
 */
export function tiledParallaxRange(
  camera: number,
  factor: number,
  tileWidth: number,
  viewportWidth: number,
): TiledParallaxRange {
  if (tileWidth <= 0) {
    return { startX: 0, copies: 0 };
  }
  const offset = -(camera * factor);
  let startX = offset % tileWidth;
  if (startX > 0) {
    startX -= tileWidth;
  }
  // Normalize -0 to +0: matches `parallaxOffset`'s convention so consumers
  // can rely on Object.is(startX, 0) at perfect grid alignment.
  if (startX === 0) {
    startX = 0;
  }
  const copies = Math.max(1, Math.ceil((viewportWidth - startX) / tileWidth));
  return { startX, copies };
}

/**
 * Draw a seamlessly tiled parallax background layer along one axis.
 *
 * Convenience wrapper: computes geometry via `tiledParallaxRange` and
 * calls `drawTile` for each copy. The callback is asset-agnostic — the
 * consumer provides the drawing logic, so there's no `CanvasImageSource`
 * coupling.
 *
 * Computes the Optimal Branching Remainder geometry internally and calls
 * `drawTile` for each copy needed to cover the viewport. The callback
 * receives the canvas context and the screen-space x coordinate where
 * the tile should be drawn — the consumer decides what to draw at
 * that position.
 *
 * **Defensive guard:** If `tileWidth` is zero or negative, `drawTile`
 * is never called (zero copies). Documented; no infinite loops.
 *
 * **Sub-pixel seam mitigation:** For smooth float scrolling, draw with
 * `tileWidth + 1` (overscan) inside the callback to prevent sub-pixel
 * seam gaps. For pixel-art sharpness, apply
 * `Math.round(startX + i * tileWidth)` at the call site — the callback's
 * `screenX` is a true float.
 *
 * **Performance note:** Sub-pixel tile widths (`tileWidth < 1`) produce
 * many copies and are typically undesirable; this helper does not enforce
 * a minimum.
 *
 * Pure of side effects beyond the caller-provided `drawTile` callback.
 * No DOM reads, no `Math.random`, no global state mutation.
 *
 * @param ctx - canvas rendering context
 * @param drawTile - callback invoked once per tile copy; receives `(ctx, screenX)`
 * @param camera - camera world coordinate along this axis
 * @param factor - parallax depth factor (0 = static, 1 = gameplay speed)
 * @param tileWidth - pixel width of one seamless tile (must be > 0 for valid geometry)
 * @param viewportWidth - pixel width of the viewport along this axis
 *
 * @example
 * ```ts
 * // Draw a far fortress layer across the viewport
 * drawTiledParallax(
 *   ctx,
 *   (c, x) => { c.drawImage(fortressImg, x, 0, 256, 480); },
 *   cam.x,
 *   PARALLAX_FAR,
 *   256,
 *   viewport.width,
 * );
 * ```
 *
 * @example
 * ```ts
 * // 4-layer side-scroller — one wrapper call per layer
 * import { drawTiledParallax } from 'aicraft-engine/src/primitives';
 *
 * function renderBackground(ctx, cameraX, viewportWidth, viewportHeight) {
 *   drawTiledParallax(ctx, (c, x) => { c.fillStyle = '#1a1028'; c.fillRect(x, 0, 512, viewportHeight); }, cameraX, 0.15, 512, viewportWidth);
 *   drawTiledParallax(ctx, (c, x) => { c.drawImage(fortressImg, x, 0, 256, 480); }, cameraX, 0.30, 256, viewportWidth);
 *   drawTiledParallax(ctx, (c, x) => { drawStatueSilhouette(c, x + 64, 200, 128); }, cameraX, 0.55, 128, viewportWidth);
 *   drawTiledParallax(ctx, (c, x) => { drawHangingChains(c, x + 32, 0, 64, viewportHeight); }, cameraX, 0.85, 64, viewportWidth);
 * }
 * ```
 */
export function drawTiledParallax(
  ctx: CanvasRenderingContext2D,
  drawTile: (ctx: CanvasRenderingContext2D, screenX: number) => void,
  camera: number,
  factor: number,
  tileWidth: number,
  viewportWidth: number,
): void {
  const range = tiledParallaxRange(camera, factor, tileWidth, viewportWidth);
  for (let i = 0; i < range.copies; i++) {
    drawTile(ctx, range.startX + i * tileWidth);
  }
}
