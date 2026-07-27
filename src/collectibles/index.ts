/**
 * Collectibles / pickups — Pillar 2 (save) + level-entity extension.
 *
 * Adds the additive `'collectible'` `EntityKind` to the level taxonomy (in
 * `src/level/types.ts`) and ships a pure-progression-ops owned-state
 * (`CollectibleSave`) mirroring `src/cosmetics/ownership.ts`. Pickups are
 * consumer-derived from deterministic AABB collision (the platformer kernel
 * stays unaware of collectibles, so replays re-derive the same pickup events
 * from the same inputs — zero replay impact).
 *
 * Per-level scoping is CONSUMER-OWNED: the library ships a flat
 * `CollectibleSave` (`{ collected: string[] }`); consumers maintain
 * `Record<levelId, CollectibleSave>` and "reset for level" by
 * dropping/replacing that level's entry. No `resetForLevel` op is shipped.
 *
 * @module
 */

export type { CollectibleSave, CollectibleEntity } from './types';
export type { PickupDerivation, PlayerRect } from './derive-pickups';

export { collect, hasCollected } from './collectibles';
export { derivePickups } from './derive-pickups';

export { DEFAULT_COLLECTIBLE_RECT, DEFAULT_COLLECTIBLE_VALUE } from './constants';
