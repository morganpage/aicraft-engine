/**
 * Palette module (Pillar 2a) — the canonical color contract.
 *
 * Re-exports the full palette surface: types, OKLCH conversion, constants,
 * resolution, generation, and contrast repair. The {@link Palette} type is
 * what the cosmetics pillar (Phase 2b) embeds as `SkinPreset.palette`.
 *
 * @module
 */

export type {
  Palette,
  PaletteOverrides,
  Oklch,
  ContrastPair,
  GenerationStrategy,
  GenerationConfig,
  ContrastRepairOptions,
} from './types';

export {
  WCAG_AA_TARGET_RATIO,
  CONTRAST_REPAIR_ITERATIONS,
  MAX_CHROMA,
  MIN_LIGHTNESS,
  MAX_LIGHTNESS,
  CONTRAST_PAIRS,
  DEFAULT_STRATEGY,
  DEFAULT_BASE_LIGHTNESS,
  DEFAULT_BASE_CHROMA,
  DEFAULT_LIGHTNESS_JITTER,
  DEFAULT_CHROMA_JITTER,
  STRATEGY_HUE_OFFSETS,
  ACCENT_LIGHTNESS_FACTOR,
  ACCENT_CHROMA_FACTOR,
  FEATURE_LIGHTNESS_FACTOR,
  FEATURE_CHROMA,
  OUTLINE_CHROMA,
  BACKGROUND_CHROMA,
} from './constants';

export { rgbToOklch, oklchToRgb, hexToOklch, oklchToHex } from './oklch';

export { resolvePalette } from './resolve';

export { generatePalette } from './generate';

export { repairContrast } from './contrast-repair';
