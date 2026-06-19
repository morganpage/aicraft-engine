/**
 * Named constants for the palette module. No magic numbers live in the
 * generation/repair algorithms — every tunable is here or in a config object.
 *
 * @module
 */

import type { ContrastPair, GenerationStrategy } from './types';

/**
 * WCAG AA minimum contrast ratio for normal text (4.5:1). GDD §11.3.
 */
export const WCAG_AA_TARGET_RATIO = 4.5;

/**
 * Number of binary-search iterations used by {@link repairContrast}.
 *
 * This is a **FIXED** count — never a convergence epsilon and never a
 * `while`/epsilon loop. 8 iterations yield ~1/256 lightness precision
 * (channel-level accuracy) and guarantee bounded, cross-engine-deterministic
 * completion. Mirrors the fixed-iteration discipline of
 * `IK_CCD_DEFAULT_ITERATIONS` / `IK_FABRIK_DEFAULT_ITERATIONS`.
 */
export const CONTRAST_REPAIR_ITERATIONS = 8;

/**
 * Maximum OKLCH chroma used by generation. Values above ~0.35 risk sRGB gamut
 * violations (and the hue shift that clamping then introduces). See
 * {@link oklchToRgb} for the clamp-and-gamut-shift contract.
 */
export const MAX_CHROMA = 0.35;

/**
 * Minimum OKLCH lightness for "dark" slots (outline). Keeps the outline
 * near-black so it reads against any mid-tone body.
 */
export const MIN_LIGHTNESS = 0.05;

/**
 * Maximum OKLCH lightness for "light" slots (background). Keeps the
 * background from becoming pure white (which would clip and wash out).
 */
export const MAX_LIGHTNESS = 0.97;

/**
 * Slot pairs checked by {@link repairContrast}. Each pair is
 * `[foreground, background]`; the foreground slot's lightness is adjusted to
 * meet the target ratio against the (fixed) background slot.
 *
 * `accent` vs `base` is intentionally NOT checked — both are "fill" colors and
 * need not contrast (clothing may share the body's lightness band).
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'outline', bg: 'base' },
  { fg: 'feature', bg: 'base' },
  { fg: 'outline', bg: 'background' },
] as const;

/**
 * Default generation strategy (three evenly spaced hues — the most aesthetically
 * balanced choice for character skins).
 */
export const DEFAULT_STRATEGY: GenerationStrategy = 'triadic';

/**
 * Default base lightness for the `base` slot. Set in the upper-mid band so the
 * body color is a readable light-mid tone: the near-black outline contrasts it
 * with margin, and the `feature` slot has contrast headroom when repaired.
 */
export const DEFAULT_BASE_LIGHTNESS = 0.7;

/**
 * Default base chroma for colored slots. Moderate — clean flat colors that stay
 * well inside the sRGB gamut.
 */
export const DEFAULT_BASE_CHROMA = 0.15;

/**
 * Default amplitude of per-slot lightness jitter. Modest, to keep the contrast
 * structure intact while adding subtle variety.
 */
export const DEFAULT_LIGHTNESS_JITTER = 0.05;

/**
 * Default amplitude of per-slot chroma jitter.
 */
export const DEFAULT_CHROMA_JITTER = 0.04;

/**
 * Hue offsets (degrees from the seeded base hue) applied to the `accent` and
 * `feature` slots, keyed by {@link GenerationStrategy}.
 */
export const STRATEGY_HUE_OFFSETS: Readonly<
  Record<GenerationStrategy, { readonly accent: number; readonly feature: number }>
> = {
  complementary: { accent: 180, feature: 150 },
  analogous: { accent: 30, feature: -30 },
  triadic: { accent: 120, feature: 240 },
};

/**
 * Lightness multiplier shaping the `accent` slot from the base lightness.
 */
export const ACCENT_LIGHTNESS_FACTOR = 0.9;

/**
 * Chroma multiplier shaping the `accent` slot from the base chroma.
 */
export const ACCENT_CHROMA_FACTOR = 0.8;

/**
 * Lightness multiplier shaping the `feature` slot from the base lightness
 * (clamped to {@link MAX_LIGHTNESS} after the multiplier is applied).
 */
export const FEATURE_LIGHTNESS_FACTOR = 1.15;

/**
 * Chroma for the `feature` slot — the highest-saturation slot. Capped so the
 * feature can still reach extreme WCAG luminances (near-black / near-white) for
 * guaranteed contrast repair via lightness alone. Higher values would "trap"
 * the feature in a mid-luminance band and leave `feature`/`base` unrepairable
 * for some seeds.
 */
export const FEATURE_CHROMA = 0.15;

/**
 * Chroma for the `outline` slot — near-achromatic so the outline reads as a
 * deep shadow rather than a colored stroke.
 */
export const OUTLINE_CHROMA = 0.02;

/**
 * Chroma for the `background` slot — near-achromatic so the scene background
 * stays neutral.
 */
export const BACKGROUND_CHROMA = 0.01;
