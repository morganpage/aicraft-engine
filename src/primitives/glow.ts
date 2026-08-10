/**
 * Additive radial-gradient glow stamp.
 *
 * Draws a brightest-at-center, fade-to-transparent glow at `(x, y)` using
 * `globalCompositeOperation = 'lighter'` so overlapping glows accumulate
 * (correct physical light behavior). Closes the palette's reserved
 * `feature` role: weapon glow, magical highlights, eye glow, lava
 * brightness.
 *
 * Pure rendering helper — takes a `CanvasRenderingContext2D`, draws, and
 * restores state (composite + fillStyle) on exit. No state leak.
 */

import { parseHex } from './color';

/** Default peak alpha at the glow center when no `intensity` is given. */
export const DEFAULT_GLOW_INTENSITY = 1;

/**
 * Draw an additive radial-gradient glow at `(x, y)`. The glow is brightest
 * at the center (`color` at full `intensity`) and fades to transparent at
 * `radius`. Uses `globalCompositeOperation = 'lighter'` for additive
 * blending so overlapping glows accumulate (correct physical light
 * behavior).
 *
 * Restores composite + fillStyle after drawing (no state leak).
 *
 * @param ctx       - the canvas rendering context (caller owns transform)
 * @param x         - center X (pixel coords)
 * @param y         - center Y (pixel coords)
 * @param radius    - glow radius in pixels (fade-to-transparent distance)
 * @param color     - glow color (`#rrggbb` hex string)
 * @param intensity - peak alpha at center [0, 1]. Default 1 (full color).
 *
 * @example
 * ```ts
 * // Bright orange weapon glow
 * drawGlow(ctx, swordTipX, swordTipY, 24, '#ff8800', 0.8);
 * ```
 */
export function drawGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  intensity: number = DEFAULT_GLOW_INTENSITY,
): void {
  const clampedRadius = Math.max(0, radius);
  if (clampedRadius === 0) return;

  const clampedIntensity = Math.max(0, Math.min(1, intensity));

  const { r, g, b } = parseHex(color);

  ctx.save();
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, clampedRadius);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${clampedIntensity})`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, clampedRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
