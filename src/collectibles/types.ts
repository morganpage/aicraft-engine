/**
 * Type definitions for the collectibles module (Pillar 2 — pure save ops;
 * consumed alongside the `'collectible'` entity kind from `src/level/`).
 *
 * `CollectibleSave` mirrors `CosmeticSave` from `src/cosmetics/types.ts`:
 *
 *   - **Fields are intentionally NOT `readonly`**: pure progression ops clone
 *     the save then mutate the clone in place (mirrors `cosmetics/ownership.ts`),
 *     so `readonly` plus an `as`-cast would be misleading ceremony. Purity is
 *     enforced by the clone-then-return discipline in `collectibles.ts`, not
 *     by field modifiers.
 *   - `collected` is a plain, alphabetically-sorted `string[]` — never a
 *     `Set`/`Map` — for canonical, deterministic serialization regardless
 *     of grant order.
 *
 * Determinism note: every field is a primitive or plain array so the whole
 * shape survives a JSON round-trip and reproduces identically across engines.
 * No timestamps, no closures, no `Set`/`Map`.
 *
 * @module
 */

import type { LevelEntity } from '../level/types';

/**
 * Player collected-state — the mutable save sub-object for collectibles.
 *
 * **`EntityId` (number) vs save-id (string) asymmetry.** Entity ids are
 * `number` (`EntityId`) in the level schema; the save stores them as `string`
 * for canonical sorted-`string[]` serialization (mirrors `CosmeticSave.owned`).
 * The consumer bridges with `String(entityId)`:
 *
 * ```ts
 * const { collected } = derivePickups(playerRect, collectibles, save);
 * for (const id of collected) {
 *   save = collect(save, String(id));
 * }
 * ```
 *
 * **Per-level scoping is consumer-owned.** The library ships a flat
 * `CollectibleSave` (`{ collected: string[] }`). The consumer maintains
 * `Record<levelId, CollectibleSave>`; "reset for level" = drop/replace that
 * level's entry. No `resetForLevel` op is shipped.
 */
export interface CollectibleSave {
  /** Collected entity ids (as strings), sorted alphabetically and deduped. */
  collected: string[];
}

/**
 * A `LevelEntity` narrow on `kind: 'collectible'`. Convenience alias so
 * consumers (and `derivePickups`) can name the variant without writing
 * `Extract<LevelEntity, { kind: 'collectible' }>` everywhere.
 */
export type CollectibleEntity = Extract<LevelEntity, { kind: 'collectible' }>;
