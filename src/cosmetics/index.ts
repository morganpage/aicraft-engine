/**
 * Cosmetics module (Pillar 2b) — algorithmic skin variation.
 *
 * Skin presets, versioned manifests, defensive migration, deterministic
 * seeded generation, and pure ownership operations. Builds on the settled
 * palette module (`src/palette/`) for all color logic.
 *
 * Determinism summary:
 *   - Generation uses `mulberry32` exclusively.
 *   - `owned` is a plain sorted `string[]` (never `Set`/`Map`).
 *   - Ownership ops are pure progression ops (immutable in, JSON-clone out,
 *     never mutate, never throw).
 *   - `migrateManifest` never throws on any input.
 *
 * @module
 */

export type {
  Rarity,
  EquipSlot,
  SkinPreset,
  CosmeticManifest,
  CosmeticSave,
} from './types';

export {
  MANIFEST_VERSION,
  DEFAULT_RARITY,
  SCALE_MIN,
  SCALE_MAX,
  JITTER_SCALE_MIN,
  JITTER_SCALE_MAX,
  MAX_SIGNATURE_RETRIES,
  EQUIP_SLOTS,
  RARITY_TIERS,
  DEFAULT_SCALE,
  DEFAULT_PALETTE,
  DEFAULT_SKIN_PRESET,
  DEFAULT_COSMETIC_SAVE,
  DEFAULT_MANIFEST,
} from './constants';

export { migrateManifest } from './migrate';

export { generateSkinVariants } from './generate';

export { grantSkin, equipSkin, unequipSkin } from './ownership';
