/**
 * Pure progression ops for collectible ownership.
 *
 * Mirrors `cosmetics/ownership.ts` (`grantSkin`-shape) and the pure-
 * progression-ops discipline in `docs/architecture.md`:
 *
 *   - **Immutable in** → the input {@link CollectibleSave} is never mutated.
 *   - **JSON-clone out** → a fresh, deep-cloned state is returned every call.
 *   - **Never throws** → invalid ids, malformed/missing save fields, and
 *     already-collected ids all degrade to a sensible no-op.
 *
 * Call these ONLY on pickup events (one call per `derivePickups` result).
 * They perform a `JSON.parse(JSON.stringify())` deep clone per call, which
 * is negligible for event-driven calls but would be wasteful inside the
 * per-frame loop.
 *
 * `collected` is kept as a plain, alphabetically-sorted `string[]` after
 * every collect — never a `Set`/`Map` — so serialisation order is canonical
 * regardless of grant order.
 *
 * @module
 */

import type { CollectibleSave } from './types';

/**
 * Deep-clone a {@link CollectibleSave} via JSON round-trip, then normalise
 * any missing/wrong-typed fields. Returns a fresh object every call.
 *
 * JSON round-trip (matches `cosmetics/ownership.ts:cloneSave`) is guaranteed
 * safe here: `CollectibleSave` holds only plain arrays/primitives — no
 * `Set`, `Map`, functions, or circular refs. The post-clone normalisation
 * makes the ops defensive against corrupt saves where `collected` is
 * missing or wrong-typed at runtime.
 */
function cloneSave(save: CollectibleSave): CollectibleSave {
  const src = save !== null && typeof save === 'object' ? save : {};
  const next = JSON.parse(JSON.stringify(src)) as CollectibleSave;
  if (!Array.isArray(next.collected)) next.collected = [];
  return next;
}

/**
 * Mark an entity as collected.
 *
 * Appends `entityId` to `collected`, then re-sorts canonically (alphabetical).
 * If the entity is already collected, this is a no-op (the returned save is
 * value-equal to the input). Never throws; an empty/non-string `entityId` is
 * a silent no-op.
 *
 * **`EntityId` (number) vs save-id (string) asymmetry.** The save stores ids
 * as `string` for canonical sorted-`string[]` serialization (mirrors
 * `CosmeticSave.owned`). The consumer bridges with `String(entityId)`:
 *
 * @example
 * ```ts
 * const { collected } = derivePickups(playerRect, collectibles, save);
 * for (const id of collected) {
 *   save = collect(save, String(id));
 * }
 * hasCollected(save, String(id)); // true
 * ```
 *
 * @param save     - Current collectible save (never mutated).
 * @param entityId - Entity id to mark collected. Pass `String(entityId)`
 *                   because the save uses string ids canonically.
 * @returns A fresh {@link CollectibleSave} with the id added (or value-equal
 *          to the input if already collected / invalid id).
 */
export function collect(save: CollectibleSave, entityId: string): CollectibleSave {
  if (typeof entityId !== 'string' || entityId.length === 0) return cloneSave(save);
  const next = cloneSave(save);
  if (!next.collected.includes(entityId)) {
    next.collected.push(entityId);
    next.collected.sort();
  }
  return next;
}

/**
 * Test whether an entity has been collected.
 *
 * Returns `true` iff `entityId` appears in `collected`. Never throws on a
 * malformed save (missing/non-array `collected` is treated as empty).
 *
 * @param save     - Current collectible save (never mutated).
 * @param entityId - Entity id to test.
 * @returns `true` iff the id is in `collected`; `false` for an invalid id
 *          (empty/non-string) or a malformed save.
 */
export function hasCollected(save: CollectibleSave, entityId: string): boolean {
  if (typeof entityId !== 'string' || entityId.length === 0) return false;
  const collected =
    save !== null && typeof save === 'object' && Array.isArray(save.collected)
      ? save.collected
      : [];
  return collected.includes(entityId);
}
