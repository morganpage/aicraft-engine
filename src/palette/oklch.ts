/**
 * OKLCH ↔ sRGB color-space conversion. Hand-rolled, zero-dependency (~the 54
 * lines of matrix math from `docs/research/algorithmic-palette-substitution.md`).
 * Composes the existing `parseHex`/`toHex` from `src/primitives/color.ts` for
 * the hex convenience helpers — it does NOT re-implement hex parsing.
 *
 * OKLCH is perceptually uniform: hue rotation preserves perceived brightness,
 * which is why palette generation and contrast repair both operate here.
 *
 * @module
 */

import type { RGB } from '../primitives/color';
import { parseHex, toHex } from '../primitives/color';
import type { Oklch } from './types';

// --- sRGB linearization (transfer function) -------------------------------

const SRGB_GAMMA_CUTOFF = 0.04045;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_GAMMA_OFFSET = 0.055;
const SRGB_GAMMA_DIVISOR = 1.055;
const SRGB_GAMMA_EXP = 2.4;

// Inverse (gamma compression) thresholds.
const LIN_CUTOFF = 0.0031308;
const LIN_LINEAR_FACTOR = 12.92;
const LIN_GAMMA_FACTOR = 1.055;
const LIN_GAMMA_OFFSET = 0.055;
const LIN_GAMMA_EXP = 1 / 2.4;

const DEG = 180 / Math.PI;

// sRGB (linear) → LMS matrix (Björn Ottosson's OKLab publish).
const M_LIN_TO_LMS = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];

// LMS' (cube-rooted) → OKLab matrix.
const M_LP_TO_LAB = [
  [0.2104542553, 0.7936177850, -0.0040720468],
  [1.9779984951, -2.4285922050, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.8086757660],
];

// OKLab → LMS' matrix (inverse of M_LP_TO_LAB).
const M_LAB_TO_LP = [
  [1.0, 0.3963377774, 0.2158037573],
  [1.0, -0.1055613458, -0.0638541728],
  [1.0, -0.0894841775, -1.2914855414],
];

// LMS → linear sRGB matrix (inverse of M_LIN_TO_LMS).
const M_LMS_TO_LIN = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.7076147010],
];

const linearizeChannel = (c: number): number =>
  c <= SRGB_GAMMA_CUTOFF
    ? c / SRGB_LINEAR_DIVISOR
    : Math.pow((c + SRGB_GAMMA_OFFSET) / SRGB_GAMMA_DIVISOR, SRGB_GAMMA_EXP);

const gammaCompress = (c: number): number =>
  c <= LIN_CUTOFF
    ? c * LIN_LINEAR_FACTOR
    : LIN_GAMMA_FACTOR * Math.pow(c, LIN_GAMMA_EXP) - LIN_GAMMA_OFFSET;

/**
 * Convert sRGB (channels `0–255`) to OKLCH.
 *
 * Pure function; no host access, no `Math.random`.
 *
 * @param rgb - sRGB color with channels in `[0, 255]`.
 * @returns OKLCH record with `l` in `[0, 1]`, `c` in `[0, ~0.4]`,
 *  `h` in `[0, 360)`.
 */
export function rgbToOklch(rgb: RGB): Oklch {
  const rl = linearizeChannel(rgb.r / 255);
  const gl = linearizeChannel(rgb.g / 255);
  const bl = linearizeChannel(rgb.b / 255);

  const lms0 = M_LIN_TO_LMS[0][0] * rl + M_LIN_TO_LMS[0][1] * gl + M_LIN_TO_LMS[0][2] * bl;
  const lms1 = M_LIN_TO_LMS[1][0] * rl + M_LIN_TO_LMS[1][1] * gl + M_LIN_TO_LMS[1][2] * bl;
  const lms2 = M_LIN_TO_LMS[2][0] * rl + M_LIN_TO_LMS[2][1] * gl + M_LIN_TO_LMS[2][2] * bl;

  const lp = Math.cbrt(lms0);
  const mp = Math.cbrt(lms1);
  const sp = Math.cbrt(lms2);

  const labL = M_LP_TO_LAB[0][0] * lp + M_LP_TO_LAB[0][1] * mp + M_LP_TO_LAB[0][2] * sp;
  const labA = M_LP_TO_LAB[1][0] * lp + M_LP_TO_LAB[1][1] * mp + M_LP_TO_LAB[1][2] * sp;
  const labB = M_LP_TO_LAB[2][0] * lp + M_LP_TO_LAB[2][1] * mp + M_LP_TO_LAB[2][2] * sp;

  const c = Math.sqrt(labA * labA + labB * labB);
  let h = Math.atan2(labB, labA) * DEG;
  if (h < 0) h += 360;

  return { l: labL, c, h };
}

/**
 * Convert OKLCH back to sRGB (channels `0–255`).
 *
 * **Gamut mapping is a simple clamp.** Out-of-gamut channels are clamped to
 * `[0, 255]`; this may produce a small hue shift for highly-saturated
 * near-gamut-boundary colors. Generation keeps chroma ≤ {@link MAX_CHROMA}
 * (~0.35), which is safely in-gamut, so clamping is a no-op for generated
 * palettes. Use a separate gamut-mapper if you need closest-in-gamut results.
 *
 * @see MAX_CHROMA
 * @param oklch - OKLCH color.
 * @returns sRGB record with channels clamped to `[0, 255]` (floats — final
 *  8-bit rounding happens in {@link toHex} when composing {@link oklchToHex}).
 */
export function oklchToRgb(oklch: Oklch): RGB {
  const hRad = oklch.h / DEG;
  const a = oklch.c * Math.cos(hRad);
  const b = oklch.c * Math.sin(hRad);

  const lp = M_LAB_TO_LP[0][0] * oklch.l + M_LAB_TO_LP[0][1] * a + M_LAB_TO_LP[0][2] * b;
  const mp = M_LAB_TO_LP[1][0] * oklch.l + M_LAB_TO_LP[1][1] * a + M_LAB_TO_LP[1][2] * b;
  const sp = M_LAB_TO_LP[2][0] * oklch.l + M_LAB_TO_LP[2][1] * a + M_LAB_TO_LP[2][2] * b;

  const ll = lp * lp * lp;
  const mm = mp * mp * mp;
  const ss = sp * sp * sp;

  const r = M_LMS_TO_LIN[0][0] * ll + M_LMS_TO_LIN[0][1] * mm + M_LMS_TO_LIN[0][2] * ss;
  const g = M_LMS_TO_LIN[1][0] * ll + M_LMS_TO_LIN[1][1] * mm + M_LMS_TO_LIN[1][2] * ss;
  const bl = M_LMS_TO_LIN[2][0] * ll + M_LMS_TO_LIN[2][1] * mm + M_LMS_TO_LIN[2][2] * ss;

  const clamp = (v: number): number => Math.max(0, Math.min(255, v * 255));
  return { r: clamp(gammaCompress(r)), g: clamp(gammaCompress(g)), b: clamp(gammaCompress(bl)) };
}

/**
 * Convenience: `#rrggbb` hex → OKLCH. Composes {@link parseHex} +
 * {@link rgbToOklch}.
 *
 * @param hex - `#rrggbb` hex string (throws on malformed input — programmer
 *  error, inheriting {@link parseHex}'s contract).
 * @returns OKLCH record.
 */
export function hexToOklch(hex: string): Oklch {
  return rgbToOklch(parseHex(hex));
}

/**
 * Convenience: OKLCH → `#rrggbb` hex. Composes {@link oklchToRgb} +
 * {@link toHex}; the 8-bit rounding that absorbs float-LSB differences across
 * JS engines happens here at the boundary.
 *
 * @param oklch - OKLCH color.
 * @returns `#rrggbb` hex string.
 */
export function oklchToHex(oklch: Oklch): string {
  return toHex(oklchToRgb(oklch));
}
