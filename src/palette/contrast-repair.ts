/**
 * WCAG AA contrast repair.
 *
 * Repairs contrast violations between checked slot pairs by binary-searching
 * the foreground slot's OKLCH lightness. Uses a **fixed** iteration count
 * ({@link CONTRAST_REPAIR_ITERATIONS}) — never a `while`/epsilon loop — so the
 * repair is bounded and cross-engine-deterministic, mirroring the IK solvers.
 *
 * **Precomputed at generation/load, never per-frame.**
 *
 * @module
 */

import { contrastRatio } from '../primitives/color';
import {
  CONTRAST_PAIRS,
  CONTRAST_REPAIR_ITERATIONS,
  WCAG_AA_TARGET_RATIO,
} from './constants';
import { hexToOklch, oklchToHex } from './oklch';
import type { Oklch, Palette, ContrastRepairOptions } from './types';

/**
 * Search the foreground's OKLCH lightness for a value that meets `targetRatio`
 * against the (fixed) background hex.
 *
 * The search is a fixed-iteration binary search. The direction (lighten vs
 * darken) is chosen by **which extreme — `l = 0` or `l = 1` — yields the higher
 * ratio against the background**, rather than by the foreground's current
 * lightness. This matters: a light foreground against a saturated mid-tone
 * background often cannot reach 4.5:1 by lightening (white still falls short)
 * but can by darkening — and vice versa. For any solid background, one of the
 * two extremes always reaches ≥ ~4.58:1, so this rule selects the achievable
 * direction.
 *
 * If no compliant lightness is found within the iteration budget, the
 * closest-to-compliant extreme is returned (best-effort fallback — the function
 * never throws).
 *
 * @param fg   - Foreground OKLCH (hue/chroma preserved; only `l` varies).
 * @param bgHex - Background hex (held fixed).
 * @param targetRatio - Target WCAG contrast ratio.
 * @returns The repaired foreground as a `#rrggbb` hex string.
 */
function searchLightness(fg: Oklch, bgHex: string, targetRatio: number): string {
  const fgHex = oklchToHex(fg);
  const origRatio = contrastRatio(fgHex, bgHex);
  if (origRatio >= targetRatio) {
    return fgHex;
  }

  const atLight = contrastRatio(oklchToHex({ l: 1, c: fg.c, h: fg.h }), bgHex);
  const atDark = contrastRatio(oklchToHex({ l: 0, c: fg.c, h: fg.h }), bgHex);
  const goLight = atLight >= atDark;

  let low = goLight ? fg.l : 0;
  let high = goLight ? 1 : fg.l;

  // Track the best-effort candidate (highest ratio seen) so the fallback never
  // returns an unchecked extreme. `compliantL` is the compliant lightness
  // closest to the original (tightened toward it each time it's beaten).
  let compliantL: number | null = null;
  let bestEffortL = fg.l;
  let bestEffortRatio = origRatio;

  for (let i = 0; i < CONTRAST_REPAIR_ITERATIONS; i++) {
    const mid = (low + high) / 2;
    const candidate = oklchToHex({ l: mid, c: fg.c, h: fg.h });
    const ratio = contrastRatio(candidate, bgHex);
    if (ratio >= targetRatio) {
      compliantL = mid;
      // Compliant — tighten toward the original lightness (less violent shift).
      if (goLight) high = mid;
      else low = mid;
    } else {
      if (ratio > bestEffortRatio) {
        bestEffortRatio = ratio;
        bestEffortL = mid;
      }
      // Not compliant — push further from the original lightness.
      if (goLight) low = mid;
      else high = mid;
    }
  }

  const finalL = compliantL ?? bestEffortL;
  return oklchToHex({ l: finalL, c: fg.c, h: fg.h });
}

/**
 * Repair WCAG AA contrast violations in a palette by adjusting each checked
 * foreground slot's OKLCH lightness. Hue and chroma are preserved.
 *
 * Uses a fixed **{@link CONTRAST_REPAIR_ITERATIONS}-iteration binary search**
 * (deterministic, bounded, no `while`/epsilon loop). The checked pairs are
 * {@link CONTRAST_PAIRS}: `outline`/`base`, `feature`/`base`,
 * `outline`/`background`.
 *
 * **Pre-computed at generation/load time — never call per-frame.**
 *
 * **Throws on malformed hex input** (programmer error, inheriting `parseHex`'s
 * contract); never throws for valid input. If a pair is mathematically
 * unfixable (e.g. the foreground cannot reach the target ratio in either
 * direction), the closest-to-compliant extreme is returned — best-effort, no
 * throw.
 *
 * Pure: returns a brand-new {@link Palette}; the input is not mutated.
 *
 * @example
 * ```ts
 * const safe = repairContrast(handAuthoredPalette);
 * ```
 *
 * @param palette - The palette to repair. Not mutated.
 * @param opts    - Optional target-ratio override.
 * @returns A new {@link Palette} with repaired slot values (`#rrggbb`).
 */
export function repairContrast(
  palette: Palette,
  opts?: ContrastRepairOptions,
): Palette {
  const target = opts?.targetRatio ?? WCAG_AA_TARGET_RATIO;

  // Mutable working copy so pairs cascade (outline appears in two pairs: the
  // second pair sees the first pair's repaired value). The input is never
  // touched.
  const work: Record<keyof Palette, string> = { ...palette };

  for (const pair of CONTRAST_PAIRS) {
    const fgOklch = hexToOklch(work[pair.fg]);
    work[pair.fg] = searchLightness(fgOklch, work[pair.bg], target);
  }

  return {
    outline: work.outline,
    base: work.base,
    accent: work.accent,
    feature: work.feature,
    background: work.background,
  };
}
