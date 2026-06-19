/**
 * Palette resolution — merge a base palette with optional overrides.
 *
 * Pure progression op: returns a fresh palette, never mutates input, never
 * throws. Missing override slots fall back silently to the base value.
 *
 * @module
 */

import type { Palette, PaletteOverrides } from './types';

/**
 * Resolve a final palette by merging a base palette with optional overrides.
 *
 * Missing override slots fall back silently to the base value — no error, no
 * warning, no derivation. This matches the pure-progression-ops discipline
 * (functions never throw; the consumer knows what colors they want).
 *
 * Pure: returns a brand-new {@link Palette}; the inputs are not mutated.
 *
 * @example
 * ```ts
 * const skin = resolvePalette(basePalette, { base: '#00ff88' });
 * // skin.outline === basePalette.outline (inherited)
 * // skin.base === '#00ff88' (overridden)
 * ```
 *
 * @param base - Base palette providing default slot values.
 * @param overrides - Optional partial overrides. Missing slots use base values.
 * @returns A complete {@link Palette} with all 5 slots populated.
 */
export function resolvePalette(base: Palette, overrides?: PaletteOverrides): Palette {
  return {
    outline: overrides?.outline ?? base.outline,
    base: overrides?.base ?? base.base,
    accent: overrides?.accent ?? base.accent,
    feature: overrides?.feature ?? base.feature,
    background: overrides?.background ?? base.background,
  };
}
