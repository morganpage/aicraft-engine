/**
 * Tunables and canonical defaults for the cosmetics module.
 *
 * No magic numbers live outside this file. Consumers may import these to
 * author skins or build their own migration targets.
 *
 * @module
 */

import type { Palette } from '../palette/types';
import type { CosmeticManifest, CosmeticSave, EquipSlot, Rarity, SkinPreset } from './types';

/** Current manifest schema version. Incremented on breaking shape changes. */
export const MANIFEST_VERSION = 1 as const;

/** Fallback rarity when a parsed skin's rarity is missing or invalid. */
export const DEFAULT_RARITY: Rarity = 'common';

/** Minimum persisted scale multiplier. Below this, characters render invisible. */
export const SCALE_MIN = 0.1;

/** Maximum persisted scale multiplier. Above this, characters render unreasonably large. */
export const SCALE_MAX = 5.0;

/** Lower bound (inclusive) of generated scale jitter. */
export const JITTER_SCALE_MIN = 0.8;

/** Upper bound (exclusive) of generated scale jitter. */
export const JITTER_SCALE_MAX = 1.2;

/** Cap on signature-collision retries per variant before giving up that slot. */
export const MAX_SIGNATURE_RETRIES = 100;

/** All valid equipment slots. Used for iteration and validation. */
export const EQUIP_SLOTS: readonly EquipSlot[] = ['body', 'head', 'trail'] as const;

/** All valid rarity tiers. Used by defensive parsing and UI consumers. */
export const RARITY_TIERS: readonly Rarity[] = [
  'common',
  'rare',
  'epic',
  'legendary',
] as const;

/** Neutral render scale (no change). */
export const DEFAULT_SCALE = 1.0;

/**
 * Default 5-slot palette used when a parsed skin's palette is missing or
 * malformed. Slot values are valid `#rrggbb` per the {@link Palette} contract.
 */
export const DEFAULT_PALETTE: Palette = {
  outline: '#1d1128',
  base: '#ff4a4a',
  accent: '#ffb300',
  feature: '#ff4a4a',
  background: '#f0e6d3',
};

/**
 * Default skin preset. Used as the per-field fallback inside the defensive
 * parser and as the single entry in {@link DEFAULT_MANIFEST}.
 */
export const DEFAULT_SKIN_PRESET: SkinPreset = {
  id: 'default',
  name: 'Default',
  rarity: DEFAULT_RARITY,
  palette: DEFAULT_PALETTE,
  scale: DEFAULT_SCALE,
};

/** Empty cosmetic save state. Nothing owned, nothing equipped. */
export const DEFAULT_COSMETIC_SAVE: CosmeticSave = {
  owned: [],
  equipped: {},
};

/**
 * Default manifest: current version, one default skin. Returned by
 * {@link migrateManifest} when the input is completely invalid or yields no
 * valid skins.
 */
export const DEFAULT_MANIFEST: CosmeticManifest = {
  version: MANIFEST_VERSION,
  skins: [DEFAULT_SKIN_PRESET],
};
