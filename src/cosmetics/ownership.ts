/**
 * Pure progression ops for cosmetic ownership (Pillar 2b).
 *
 * Mirrors Spitekeep's `platform/progress.ts` (`markCompleted`-style shape) and
 * the pure-progression-ops discipline in `docs/architecture.md`:
 *
 *   - **Immutable in** → the input {@link CosmeticSave} is never mutated.
 *   - **JSON-clone out** → a fresh, deep-cloned state is returned every call.
 *   - **Never throws** → invalid ids, unknown slots, unowned equips, and even
 *     malformed/missing save fields degrade to a sensible no-op.
 *
 * Call these ONLY on user actions (equip/unequip/purchase). They perform a
 * `JSON.parse(JSON.stringify())` deep clone per call, which is negligible for
 * event-driven calls but would be wasteful inside the per-frame loop.
 *
 * `owned` is kept as a plain, alphabetically-sorted `string[]` after every
 * grant — never a `Set`/`Map` — so serialisation order is canonical regardless
 * of grant order.
 *
 * @module
 */

import type { CosmeticSave, EquipSlot } from './types';
import { EQUIP_SLOTS } from './constants';

/**
 * Deep-clone a {@link CosmeticSave} via JSON round-trip, then normalise any
 * missing/wrong-typed fields. Returns a fresh object every call.
 *
 * JSON round-trip (matches Spitekeep's `cloneSave` exactly) is guaranteed safe
 * here: `CosmeticSave` holds only plain arrays/objects/primitives — no `Set`,
 * `Map`, functions, or circular refs. The post-clone normalisation makes the
 * ops defensive against corrupt saves where `owned`/`equipped` are missing or
 * wrong-typed at runtime.
 */
function cloneSave(save: CosmeticSave): CosmeticSave {
  const src = save !== null && typeof save === 'object' ? save : {};
  const next = JSON.parse(JSON.stringify(src)) as CosmeticSave;
  if (!Array.isArray(next.owned)) next.owned = [];
  if (next.equipped === null || typeof next.equipped !== 'object') next.equipped = {};
  return next;
}

/** Type-narrowing guard for a valid {@link EquipSlot}. */
function isValidSlot(slot: unknown): slot is EquipSlot {
  return typeof slot === 'string' && (EQUIP_SLOTS as readonly string[]).includes(slot);
}

/**
 * Grant a skin to the player.
 *
 * Appends `skinId` to `owned`, then re-sorts canonically (alphabetical). If the
 * skin is already owned, this is a no-op (the returned save is value-equal to
 * the input). Never throws; an empty/non-string `skinId` is a silent no-op.
 *
 * @param save   - Current cosmetic save (never mutated).
 * @param skinId - Skin ID to grant.
 * @returns A fresh {@link CosmeticSave} with the skin added (or value-equal if
 *          already owned / invalid id).
 */
export function grantSkin(save: CosmeticSave, skinId: string): CosmeticSave {
  if (typeof skinId !== 'string' || skinId.length === 0) return cloneSave(save);
  const next = cloneSave(save);
  if (!next.owned.includes(skinId)) {
    next.owned.push(skinId);
    next.owned.sort();
  }
  return next;
}

/**
 * Equip an owned skin into a specific slot.
 *
 * Verifies **ownership** (the skin is in `owned`) — NOT manifest existence —
 * so generated or promotionally-granted skins can be equipped. An unowned
 * skin, an invalid slot, or an empty id is a silent no-op (returned save is
 * value-equal to the input). Never throws.
 *
 * @param save   - Current cosmetic save (never mutated).
 * @param slot   - Equipment slot (`'body'`, `'head'`, or `'trail'`).
 * @param skinId - Skin ID to equip (must already be in `owned`).
 * @returns A fresh {@link CosmeticSave} with the slot filled, or value-equal
 *          to the input on a no-op.
 */
export function equipSkin(
  save: CosmeticSave,
  slot: EquipSlot,
  skinId: string,
): CosmeticSave {
  if (!isValidSlot(slot)) return cloneSave(save);
  if (typeof skinId !== 'string' || skinId.length === 0) return cloneSave(save);
  const owned = save !== null && Array.isArray(save.owned) ? save.owned : [];
  if (!owned.includes(skinId)) return cloneSave(save);
  const next = cloneSave(save);
  next.equipped[slot] = skinId;
  return next;
}

/**
 * Unequip whatever is in a specific slot.
 *
 * If the slot is already empty or the slot name is invalid, this is a silent
 * no-op (returned save is value-equal to the input). Never throws.
 *
 * @param save - Current cosmetic save (never mutated).
 * @param slot - Equipment slot to clear.
 * @returns A fresh {@link CosmeticSave} with the slot cleared, or value-equal
 *          to the input on a no-op.
 */
export function unequipSkin(save: CosmeticSave, slot: EquipSlot): CosmeticSave {
  if (!isValidSlot(slot)) return cloneSave(save);
  const equipped =
    save !== null && save.equipped !== null && typeof save.equipped === 'object'
      ? save.equipped
      : {};
  if (equipped[slot] === undefined) return cloneSave(save);
  const next = cloneSave(save);
  delete next.equipped[slot];
  return next;
}
