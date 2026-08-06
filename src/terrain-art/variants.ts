import type { TerrainArtDualGridMask, TerrainMaterialDefinition, TerrainVariantDefinition } from './types';

export type TerrainArtExposure = 'top' | 'side' | 'interior';

function mix(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

/** Classify a mask for variant eligibility without inspecting draw order or viewport. */
export function terrainArtMaskExposure(mask: TerrainArtDualGridMask): TerrainArtExposure {
  const hasNorth = (mask & 3) !== 0;
  const hasSouth = (mask & 12) !== 0;
  if (hasSouth && !hasNorth) return 'top';
  if (mask === 15) return 'interior';
  return 'side';
}

/** Deterministically select a weighted eligible variant for one occurrence. */
export function selectTerrainArtVariant(
  material: Readonly<TerrainMaterialDefinition>, mask: TerrainArtDualGridMask,
  dualX: number, dualY: number, visualSeed: number, pinnedVariantId?: string,
): Readonly<TerrainVariantDefinition> | null {
  const eligible = material.variants.filter((variant) => variant.enabled && variant.weight > 0 &&
    variant.eligibleMasks.includes(mask) &&
    (variant.exposure === 'any' || variant.exposure === terrainArtMaskExposure(mask)));
  if (pinnedVariantId !== undefined) {
    const pinned = eligible.find((variant) => variant.id === pinnedVariantId);
    if (pinned !== undefined) return pinned;
  }
  if (eligible.length === 0) return material.variants.find((variant) => variant.enabled && variant.id === 'default') ??
    material.variants.find((variant) => variant.enabled) ?? null;
  const total = eligible.reduce((sum, variant) => sum + variant.weight, 0);
  let sample = mix((visualSeed ^ Math.imul(dualX + 0x4000, 0x9e3779b1) ^ Math.imul(dualY + 0x4000, 0x85ebca6b) ^ Math.imul(mask, 0xc2b2ae35)) >>> 0) / 0x100000000 * total;
  for (const variant of eligible) {
    sample -= variant.weight;
    if (sample < 0) return variant;
  }
  return eligible[eligible.length - 1] ?? null;
}
