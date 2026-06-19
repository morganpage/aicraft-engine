/**
 * Seed-driven harmonic palette generation.
 *
 * Deterministically produces a full, contrast-safe {@link Palette} from a
 * 32-bit seed. Generation happens in OKLCH (perceptually uniform, so hue
 * rotation preserves perceived brightness), then converts to 8-bit hex at the
 * boundary via {@link oklchToHex}. The result is always run through
 * {@link repairContrast} so the checked slot pairs meet WCAG AA.
 *
 * Determinism: uses `mulberry32` exclusively (never `Math.random`), draws RNG
 * values in a fixed order, and rounds to 8-bit hex at the boundary — so the
 * same seed yields the same palette across every JS engine.
 *
 * @module
 */

import { mulberry32 } from '../rng/mulberry32';
import { contrastRatio } from '../primitives/color';
import {
  ACCENT_CHROMA_FACTOR,
  ACCENT_LIGHTNESS_FACTOR,
  BACKGROUND_CHROMA,
  CONTRAST_REPAIR_ITERATIONS,
  DEFAULT_BASE_CHROMA,
  DEFAULT_BASE_LIGHTNESS,
  DEFAULT_CHROMA_JITTER,
  DEFAULT_LIGHTNESS_JITTER,
  DEFAULT_STRATEGY,
  FEATURE_CHROMA,
  FEATURE_LIGHTNESS_FACTOR,
  MAX_CHROMA,
  MAX_LIGHTNESS,
  MIN_LIGHTNESS,
  OUTLINE_CHROMA,
  STRATEGY_HUE_OFFSETS,
  WCAG_AA_TARGET_RATIO,
} from './constants';
import { repairContrast } from './contrast-repair';
import { hexToOklch, oklchToHex } from './oklch';
import type { GenerationConfig, Oklch, Palette } from './types';

/** Map a `mulberry32` sample in `[0, 1)` to a signed `[-1, 1]` unit. */
const signed = (n: number): number => n * 2 - 1;

/**
 * Wrap a hue into `[0, 360)`.
 */
const wrapHue = (h: number): number => ((h % 360) + 360) % 360;

/**
 * Guarantee `base` is light enough that the near-black `outline` contrasts it
 * at WCAG AA. Some saturated hues (deep blues/purples) at a given OKLCH
 * lightness map to a WCAG luminance below the threshold where black can reach
 * 4.5:1 — and in that case no outline lightness can simultaneously contrast a
 * too-dark base AND a near-white background (the two outline pairs fight). The
 * fix is structural: raise `base`'s OKLCH lightness until black contrasts it,
 * so outline stays dark and naturally contrasts both base and background.
 *
 * Deterministic fixed-iter binary search (`CONTRAST_REPAIR_ITERATIONS`).
 * Hue/chroma preserved; only `l` varies. If base already contrasts the outline,
 * this is a no-op.
 *
 * @param baseHex    - Generated base hex.
 * @param outlineHex - Outline hex (held fixed; near-black).
 * @returns Base hex guaranteed to contrast `outlineHex` at WCAG AA, or the
 *  closest-to-compliant result if base cannot reach the target before
 *  `MAX_LIGHTNESS`.
 */
function ensureBaseContrastsOutline(baseHex: string, outlineHex: string): string {
  if (contrastRatio(baseHex, outlineHex) >= WCAG_AA_TARGET_RATIO) {
    return baseHex;
  }
  const base = hexToOklch(baseHex);
  let lo = base.l;
  let hi = MAX_LIGHTNESS;
  let best: Oklch = base;
  let bestRatio = contrastRatio(baseHex, outlineHex);
  for (let i = 0; i < CONTRAST_REPAIR_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const cand = { l: mid, c: base.c, h: base.h };
    const candHex = oklchToHex(cand);
    const r = contrastRatio(candHex, outlineHex);
    if (r >= WCAG_AA_TARGET_RATIO) {
      best = cand;
      bestRatio = r;
      hi = mid;
    } else {
      if (r > bestRatio) {
        best = cand;
        bestRatio = r;
      }
      lo = mid;
    }
  }
  return oklchToHex(best);
}

/**
 * Deterministically generate a full {@link Palette} from a 32-bit seed.
 *
 * Same `seed` + `config` → same {@link Palette} forever, on every JS engine.
 * The returned palette is contrast-repaired: `outline`/`base`, `feature`/`base`
 * and `outline`/`background` all meet WCAG AA (4.5:1) where mathematically
 * possible.
 *
 * All five slots (including `outline` and `background`) are derived from the
 * seed: `outline` sits at {@link MIN_LIGHTNESS}, `background` at
 * {@link MAX_LIGHTNESS}, and the three colored slots (`base`/`accent`/`feature`)
 * rotate around the seeded base hue per {@link STRATEGY_HUE_OFFSETS}.
 *
 * Uses `mulberry32` for all randomness — never `Math.random`.
 *
 * @example
 * ```ts
 * // 100 unique, contrast-safe character palettes
 * const palettes = Array.from({ length: 100 }, (_, i) => generatePalette(i + 1));
 * ```
 *
 * @param seed   - 32-bit integer seed for the PRNG.
 * @param config - Optional generation tuning. All fields have safe defaults.
 * @returns A complete, contrast-safe {@link Palette}. All slots are `#rrggbb`.
 */
export function generatePalette(seed: number, config?: GenerationConfig): Palette {
  const strategy = config?.strategy ?? DEFAULT_STRATEGY;
  const baseLightness = config?.baseLightness ?? DEFAULT_BASE_LIGHTNESS;
  const baseChroma = config?.baseChroma ?? DEFAULT_BASE_CHROMA;
  const lightnessJitter = config?.lightnessJitter ?? DEFAULT_LIGHTNESS_JITTER;
  const chromaJitter = config?.chromaJitter ?? DEFAULT_CHROMA_JITTER;

  const rng = mulberry32(seed >>> 0);

  // Fixed draw order — do not reorder; it would change every golden value.
  const baseHue = rng() * 360;
  const baseLNoise = signed(rng());
  const baseCNoise = signed(rng());
  const accentLNoise = signed(rng());
  const accentCNoise = signed(rng());
  const featureLNoise = signed(rng());
  const featureCNoise = signed(rng());

  const offsets = STRATEGY_HUE_OFFSETS[strategy];
  const accentHue = wrapHue(baseHue + offsets.accent);
  const featureHue = wrapHue(baseHue + offsets.feature);

  const clampL = (v: number): number =>
    v < MIN_LIGHTNESS ? MIN_LIGHTNESS : v > MAX_LIGHTNESS ? MAX_LIGHTNESS : v;
  const clampC = (v: number): number => (v < 0 ? 0 : v > MAX_CHROMA ? MAX_CHROMA : v);

  const outlineHex = oklchToHex({ l: MIN_LIGHTNESS, c: OUTLINE_CHROMA, h: baseHue });
  const backgroundHex = oklchToHex({ l: MAX_LIGHTNESS, c: BACKGROUND_CHROMA, h: baseHue });

  const baseHex = ensureBaseContrastsOutline(
    oklchToHex({
      l: clampL(baseLightness + baseLNoise * lightnessJitter),
      c: clampC(baseChroma + baseCNoise * chromaJitter),
      h: baseHue,
    }),
    outlineHex,
  );
  const accentHex = oklchToHex({
    l: clampL(baseLightness * ACCENT_LIGHTNESS_FACTOR + accentLNoise * lightnessJitter),
    c: clampC(baseChroma * ACCENT_CHROMA_FACTOR + accentCNoise * chromaJitter),
    h: accentHue,
  });
  const featureHex = oklchToHex({
    l: clampL(
      Math.min(MAX_LIGHTNESS, baseLightness * FEATURE_LIGHTNESS_FACTOR) +
        featureLNoise * lightnessJitter,
    ),
    c: clampC(FEATURE_CHROMA + featureCNoise * chromaJitter),
    h: featureHue,
  });

  const raw: Palette = {
    outline: outlineHex,
    base: baseHex,
    accent: accentHex,
    feature: featureHex,
    background: backgroundHex,
  };

  return repairContrast(raw);
}
