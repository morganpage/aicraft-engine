/**
 * Color math utilities for ultra-minimalist procedural rendering.
 *
 * All functions accept and return `#rrggbb` hex strings (or `RGB` records).
 * Channels are 0-255 integers. Operations are pure and deterministic.
 *
 * @module
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse a `#rrggbb` (or `rrggbb`) hex string into an RGB record.
 * Throws on malformed input — invalid color values are a programmer error,
 * not a runtime condition.
 */
export function parseHex(hex: string): RGB {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  if (clean.length !== 6) {
    throw new Error(`parseHex: expected 6-char hex, got "${hex}"`);
  }
  const n = parseInt(clean, 16);
  if (Number.isNaN(n)) {
    throw new Error(`parseHex: invalid hex "${hex}"`);
  }
  return {
    r: (n >> 16) & 0xff,
    g: (n >> 8) & 0xff,
    b: n & 0xff,
  };
}

/**
 * Convert an RGB record back to a `#rrggbb` hex string.
 * Channels are rounded and clamped to 0..255.
 */
export function toHex({ r, g, b }: RGB): string {
  const clampChannel = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    ((1 << 24) + (clampChannel(r) << 16) + (clampChannel(g) << 8) + clampChannel(b))
      .toString(16)
      .slice(1)
  );
}

/**
 * Multiply a color's channels by `factor` (<1 darkens, >1 lightens).
 * Channels are clamped to 0..255. Extracted from Spitekeep `render/sprites.ts:38`.
 */
export function shade(hex: string, factor: number): string {
  const { r, g, b } = parseHex(hex);
  return toHex({ r: r * factor, g: g * factor, b: b * factor });
}

/**
 * Linear interpolation between two colors. `t=0` returns `a`, `t=1` returns `b`.
 * Used for palette gradients and procedural skin blending.
 */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const lerpChannel = (x: number, y: number) => x + (y - x) * t;
  return toHex({
    r: lerpChannel(ca.r, cb.r),
    g: lerpChannel(ca.g, cb.g),
    b: lerpChannel(ca.b, cb.b),
  });
}

/**
 * Channel-wise complement (255 - channel). Useful as a cheap "anti-color"
 * for procedural skin variation.
 */
export function complement(hex: string): string {
  const { r, g, b } = parseHex(hex);
  return toHex({ r: 255 - r, g: 255 - g, b: 255 - b });
}

/**
 * WCAG 2.x relative luminance of a color, in range 0..1.
 * Used as the input to `contrastRatio`.
 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const linearize = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * WCAG contrast ratio between two colors, in range 1..21.
 * 1 = identical colors, 21 = black vs white.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check WCAG AA contrast (≥4.5:1). This is the rule enforced by GDD §11.3
 * for all gameplay art in Spitekeep-family games.
 */
export function meetsWcagAa(a: string, b: string): boolean {
  return contrastRatio(a, b) >= 4.5;
}
