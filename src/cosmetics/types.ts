/**
 * Type definitions for the cosmetics module (Pillar 2b).
 *
 * A skin is a serializable parameter preset ("the algorithm IS the art" — no
 * art files). {@link SkinPreset.palette} is exactly the shipped 5-slot
 * {@link Palette} from `src/palette/`; all color logic delegates there. No
 * color code lives in this module.
 *
 * Determinism note: every field below is a primitive or plain object so the
 * whole shape survives a JSON round-trip and reproduces identically across
 * engines. There are no timestamps (they would break determinism).
 *
 * @module
 */

import type { Palette } from '../palette/types';

/**
 * Rarity tiers for cosmetics. Typed union — never a free string.
 *
 * Metadata only in manifest v1: it drives UI styling, not mechanics. Adding a
 * tier later (e.g. `'mythic'`) is a non-breaking union expansion.
 */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

/**
 * Cosmetic equipment regions.
 *
 * **This is a SEPARATE namespace from the skeletal rig's `slotMap`.** Rig
 * `slotMap` keys are consumer-defined *attachment* slots used for IK/locomotion
 * targeting (e.g. `'root'`, `'left_foot'`); `EquipSlot` values are *cosmetic
 * regions* that the consumer maps to draw callbacks. A name like `'head'` may
 * appear in both by coincidence, but the two concepts are independent — do not
 * assume an equip slot resolves to a rig slot.
 */
export type EquipSlot = 'body' | 'head' | 'trail';

/**
 * Serializable parameter preset defining a procedural character skin.
 *
 * Contains only primitive values and plain objects — no functions, closures,
 * `Set`, or `Map`. This guarantees JSON-roundtrip fidelity and deterministic
 * serialisation across JS engines.
 *
 * The {@link palette} is the settled 5-slot {@link Palette}; draw callbacks
 * consume slots by name, so swapping a skin is a reference swap, not a code
 * change.
 *
 * Minimal v1: `features` / `gait` / `particles` are deferred to manifest v2
 * (game-specific; safe to add via the versioned migration safety net).
 */
export interface SkinPreset {
  /** Unique identifier (e.g. `'devil-neon'`). Used for equip/ownership lookups. */
  readonly id: string;
  /** User-facing display name (e.g. `'Neon Devil'`). */
  readonly name: string;
  /** Rarity tier — UI metadata only in v1, no mechanical effect. */
  readonly rarity: Rarity;
  /** 5-slot colour palette. Exactly the {@link Palette} type from `src/palette`. */
  readonly palette: Palette;
  /** Uniform render-scale multiplier applied by the consumer's draw callbacks. */
  readonly scale: number;
}

/**
 * Versioned cosmetic manifest — load-once, read-many content.
 *
 * `skins` is `readonly` (justified divergence from {@link CosmeticSave}'s
 * mutable fields): manifests are parsed once and then only ever read, never
 * mutated after parse. The `readonly` modifier signals that intent at the type
 * level.
 */
export interface CosmeticManifest {
  /** Schema version. Incremented on breaking shape changes. */
  readonly version: number;
  /** Validated skin presets. Always non-empty after {@link migrateManifest}. */
  readonly skins: readonly SkinPreset[];
}

/**
 * Player cosmetic ownership and equipment state — the mutable save sub-object.
 *
 * **Fields are intentionally NOT `readonly`**: ownership ops clone the save
 * then mutate the clone in place, so `readonly` plus an `as`-cast would be
 * misleading ceremony. Purity is enforced by the clone-then-return discipline
 * in `ownership.ts`, not by field modifiers.
 *
 * `owned` is a plain sorted `string[]` — never a `Set`/`Map` — for
 * deterministic serialisation. `equipped` uses `Partial<Record>` because not
 * every slot must be filled.
 */
export interface CosmeticSave {
  /** Owned skin IDs, sorted alphabetically and deduped after every grant. */
  owned: string[];
  /** Equipped skin ID per slot. Missing slots are unequipped. */
  equipped: Partial<Record<EquipSlot, string>>;
}
