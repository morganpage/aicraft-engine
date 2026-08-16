/**
 * Deterministic skin-variant generation (Pillar 2b).
 *
 * Produces a batch of visually distinct {@link SkinPreset} variants from a
 * base skin and a 32-bit seed. **Same `(seed, baseSkin, count)` → same
 * `SkinPreset[]` forever, on every JS engine.**
 *
 * Color logic is delegated entirely to `src/palette/` via {@link generatePalette}
 * (which already repairs contrast internally) — this module contains no color
 * code and does not import `repairContrast` separately. Scale is jittered within
 * `[JITTER_SCALE_MIN, JITTER_SCALE_MAX]`.
 *
 * Determinism discipline: `mulberry32` only (never `Math.random`, never
 * `Date.now`); batch uniqueness via a plain-array signature list (not a `Set`,
 * so iteration order is fully deterministic); variant IDs embed a content hash
 * so two different base skins sharing a seed cannot collide.
 *
 * @module
 */

import type { Palette } from '../palette/types';
import { generatePalette } from '../palette/generate';
import { mulberry32, nextFloat } from '../rng/mulberry32';
import type { SkinPreset } from './types';
import {
  JITTER_SCALE_MAX,
  JITTER_SCALE_MIN,
  MAX_SIGNATURE_RETRIES,
} from './constants';
import { fnv1aHash } from '../hash/fnv1a';

/** Prime stride mixing the variant index into the palette sub-seed. */
const SEED_INDEX_STRIDE = 7919;

/**
 * Deterministic FNV-1a 32-bit hash, returned as a base36 string.
 *
 * Chosen for determinism (pure integer math, `Math.imul` — no BigInt, no
 * platform-specific float quirks) and zero dependencies. Two different input
 * strings never share a hash in practice.
 *
 * @param str - UTF-16 code-unit stream to hash.
 * @returns Unsigned 32-bit FNV-1a digest, base36-encoded.
 */
function fnv1aBase36(str: string): string {
  return fnv1aHash(str).toString(36);
}

/**
 * Content hash of a base skin's stable, jitter-relevant fields.
 *
 * Covers the full palette plus `scale` — everything that distinguishes one
 * base skin from another for the purpose of variant-id collision avoidance.
 * Embedded in every generated variant id so two base skins that share a seed
 * produce disjoint id spaces.
 */
function baseSkinContentHash(skin: SkinPreset): string {
  const p = skin.palette;
  return fnv1aBase36(
    `${p.outline}|${p.base}|${p.accent}|${p.feature}|${p.background}|${skin.scale}`,
  );
}

/**
 * Uniqueness signature for a generated variant (palette + scale).
 *
 * Used to guarantee batch uniqueness: two variants in the same batch never
 * share all five palette slots AND scale. `scale` is rounded to a fixed
 * precision so sub-ulp float jitter across engines cannot split equal scales.
 */
function variantSignature(palette: Palette, scale: number): string {
  const p = palette;
  return `${p.outline}|${p.base}|${p.accent}|${p.feature}|${p.background}|${scale.toFixed(4)}`;
}

/**
 * Deterministically generate a batch of visually distinct skin variants.
 *
 * Same `seed` + `baseSkin` + `count` → same {@link SkinPreset}[] forever. Each
 * variant gets a fresh contrast-safe palette (via {@link generatePalette}) and
 * a jittered scale within `[JITTER_SCALE_MIN, JITTER_SCALE_MAX]`.
 *
 * **Batch uniqueness** is guaranteed by signature comparison: if a freshly
 * generated variant's signature already appears in the batch, it is discarded
 * and re-generated (up to {@link MAX_SIGNATURE_RETRIES} attempts for that
 * slot). The seen-signature store is a plain array (not a `Set`) for fully
 * deterministic iteration order.
 *
 * **Variant IDs** are `${baseSkin.id}-var-${i}-${seed}-${hash}`, where `hash`
 * is a base36 FNV-1a of the base skin's palette+scale content. The index `i`
 * and seed already make variants unique within one batch; the content hash
 * additionally makes them unique across different base skins sharing a seed.
 *
 * `count <= 0` returns an empty array.
 *
 * @example
 * ```ts
 * const variants = generateSkinVariants(42, baseSkin, 5);
 * // variants[0].id === 'devil-var-0-42-<hash>' — stable forever.
 * ```
 *
 * @param seed     - 32-bit integer seed for the PRNG.
 * @param baseSkin - Base skin to derive variants from. Palette is replaced;
 *                   `scale` is jittered; `id`/`name`/`rarity` are derived.
 * @param count    - Number of unique variants to generate.
 * @returns Array of unique variants. May be shorter than `count` only if the
 *                   signature space is exhausted within the retry budget.
 */
export function generateSkinVariants(
  seed: number,
  baseSkin: SkinPreset,
  count: number,
): SkinPreset[] {
  if (count <= 0) return [];

  const seedU32 = seed >>> 0;
  const rng = mulberry32(seedU32);
  const variants: SkinPreset[] = [];
  const seenSignatures: string[] = [];
  const hash = baseSkinContentHash(baseSkin);

  for (let i = 0; i < count; i++) {
    let retries = 0;
    while (retries < MAX_SIGNATURE_RETRIES) {
      const paletteSeed = (seedU32 + i * SEED_INDEX_STRIDE + retries) >>> 0;
      const palette = generatePalette(paletteSeed);
      const scale = nextFloat(rng, JITTER_SCALE_MIN, JITTER_SCALE_MAX);
      const sig = variantSignature(palette, scale);

      if (seenSignatures.indexOf(sig) >= 0) {
        retries++;
        continue;
      }
      seenSignatures.push(sig);

      variants.push({
        id: `${baseSkin.id}-var-${i}-${seedU32}-${hash}`,
        name: `${baseSkin.name} Variant ${i + 1}`,
        rarity: baseSkin.rarity,
        palette,
        scale,
      });
      break;
    }
  }

  return variants;
}
