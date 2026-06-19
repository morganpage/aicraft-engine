/**
 * Type definitions for the palette module (Pillar 2).
 *
 * The {@link Palette} type is the **canonical color contract** the cosmetics
 * pillar (Phase 2b) embeds: `SkinPreset.palette` is exactly this shape, with
 * exactly these slot names. Draw callbacks consume slots by name; swapping a
 * skin is a reference swap, never a code change.
 *
 * The simulation never reads color values — the palette lives in the
 * deterministic core and is only resolved into hex strings for the renderer.
 *
 * @module
 */

/**
 * Canonical semantic-slot palette. Every slot is a `#rrggbb` hex string.
 *
 * The five slots are the minimal set supporting character body rendering
 * (`base`/`accent`/`feature`), readability guarantees (`outline` vs `base`
 * and `background`), and scene composition (`background`).
 *
 * Games map slots to character parts inside their draw callbacks:
 * - `base` → body fill, card face, panel background.
 * - `accent` → clothing, armor, secondary body, markings.
 * - `feature` → eyes, weapon glow, magical highlights (highest saturation).
 * - `outline` → 1px borders, text, deep shadows.
 * - `background` → ground tiles, card backs, neutral UI panels.
 *
 * Adding a sixth slot later is a breaking change; the library has no consumers
 * yet, so the 5-slot set is locked now.
 */
export interface Palette {
  /** Outlines, text, and deep shadows. Must contrast with `base` and `background`. */
  readonly outline: string;
  /** Primary body or fill color of the character/sprite/entity. */
  readonly base: string;
  /** Secondary body color: clothing, armor, markings, or secondary fill. */
  readonly accent: string;
  /** Active highlights: eyes, weapon glows, magical effects. Highest saturation. */
  readonly feature: string;
  /** Ground tiles, card faces, or neutral UI panels. Scene-level background. */
  readonly background: string;
}

/**
 * Partial palette for skin overrides. Missing slots fall back to the base
 * palette value (see {@link resolvePalette}).
 */
export type PaletteOverrides = Partial<Palette>;

/**
 * OKLCH color record. OKLCH is a perceptually uniform color space: equal
 * numeric steps in `l` produce equal perceived brightness changes, which makes
 * hue rotation preserve contrast — the property the palette module relies on.
 *
 * - `l` (lightness): `0` = black, `1` = white.
 * - `c` (chroma): `0` = achromatic (grey); the sRGB-safe upper bound is
 *   {@link MAX_CHROMA} (~0.35).
 * - `h` (hue): degrees in `[0, 360)`.
 */
export interface Oklch {
  /** Lightness `[0, 1]`. Perceptually uniform. */
  readonly l: number;
  /** Chroma `[0, ~0.4]`. `0` is grey; higher is more saturated. */
  readonly c: number;
  /** Hue in degrees `[0, 360)`. */
  readonly h: number;
}

/**
 * A checked foreground/background slot pair for contrast repair.
 * The foreground slot's lightness is adjusted to meet the target ratio
 * against the (fixed) background slot.
 */
export interface ContrastPair {
  /** Slot whose lightness is adjusted. */
  readonly fg: keyof Palette;
  /** Reference slot (held fixed during the search). */
  readonly bg: keyof Palette;
}

/**
 * Harmonic palette-generation strategies. Each strategy fixes the hue offsets
 * applied to the `accent` and `feature` slots relative to the seeded base hue:
 * - `complementary` — accent at +180°, feature split to +150°.
 * - `analogous` — accent at +30°, feature at −30° (tight harmonic band).
 * - `triadic` — accent at +120°, feature at +240° (three evenly spaced hues).
 *
 * The offsets themselves live in {@link STRATEGY_HUE_OFFSETS} (`constants.ts`).
 */
export type GenerationStrategy = 'complementary' | 'analogous' | 'triadic';

/**
 * Configuration for {@link generatePalette}. Every field is optional with a
 * safe default tuned for character skins. For UI/card themes, pass lower chroma
 * (e.g. `baseChroma: 0.08`) and higher base lightness (e.g. `0.7`).
 *
 * No magic numbers live in the generation algorithm — all tunables are here or
 * in `constants.ts`.
 */
export interface GenerationConfig {
  /** Generation strategy. Default {@link DEFAULT_STRATEGY} (`'triadic'`). */
  readonly strategy?: GenerationStrategy;
  /** Base lightness for the `base` slot `[0, 1]`. Default {@link DEFAULT_BASE_LIGHTNESS}. */
  readonly baseLightness?: number;
  /** Base chroma for colored slots `[0, {@link MAX_CHROMA}]`. Default {@link DEFAULT_BASE_CHROMA}. */
  readonly baseChroma?: number;
  /** Lightness jitter amplitude applied per colored slot `[0, ~0.3]`. Default {@link DEFAULT_LIGHTNESS_JITTER}. */
  readonly lightnessJitter?: number;
  /** Chroma jitter amplitude applied per colored slot `[0, ~0.2]`. Default {@link DEFAULT_CHROMA_JITTER}. */
  readonly chromaJitter?: number;
}

/**
 * Options for {@link repairContrast}.
 */
export interface ContrastRepairOptions {
  /**
   * Target WCAG contrast ratio. Default {@link WCAG_AA_TARGET_RATIO} (4.5:1).
   * Increase to `7.0` for AAA compliance.
   */
  readonly targetRatio?: number;
}
