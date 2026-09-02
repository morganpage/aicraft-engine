/**
 * Item definitions and pure inventory operations.
 *
 * The inventory is a sorted array of `{ itemId, quantity }` entries with
 * positive integer counts; zero-count entries are removed, never stored.
 * All operations are pure and never throw — invalid quantities are no-ops.
 */

import type { RpgItemId } from './types';

/** The two starter item kinds. */
export type RpgItemKind = 'potion' | 'capture';

/** An item definition. Exactly one kind-specific field applies. */
export interface ItemDefinition {
  readonly id: RpgItemId;
  readonly name: string;
  readonly kind: RpgItemKind;
  /** Potion: flat HP restored (up to the creature's maximum HP). */
  readonly healAmount?: number;
  /** Capture item: basis points added to the capture chance. */
  readonly catchBonusBasisPoints?: number;
}

/** One inventory line. Entries with quantity 0 are removed, never stored. */
export interface InventoryEntry {
  readonly itemId: RpgItemId;
  readonly quantity: number;
}

/** The player's inventory: sorted entries with positive integer counts. */
export type InventoryState = readonly InventoryEntry[];

function coerceCount(quantity: number): number {
  if (!Number.isFinite(quantity)) return 0;
  return Math.floor(quantity);
}

/** Count of one item currently held. */
export function getItemCount(inventory: InventoryState, itemId: RpgItemId): number {
  for (const entry of inventory) {
    if (entry.itemId === itemId) return entry.quantity;
  }
  return 0;
}

/**
 * Add a quantity of an item, keeping entries sorted by item id. A
 * non-positive quantity is a no-op. Never throws.
 */
export function grantItem(
  inventory: InventoryState,
  itemId: RpgItemId,
  quantity: number,
): InventoryState {
  const add = coerceCount(quantity);
  if (add <= 0) return inventory;
  const next: InventoryEntry[] = [];
  let merged = false;
  for (const entry of inventory) {
    if (entry.itemId === itemId) {
      next.push({ itemId, quantity: entry.quantity + add });
      merged = true;
    } else {
      next.push(entry);
    }
  }
  if (!merged) next.push({ itemId, quantity: add });
  next.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  return next;
}

/**
 * Remove a quantity of an item, dropping the entry at zero. Consuming more
 * than is held (or a non-positive quantity) is a no-op, so battle legality
 * checks and consumption can never desynchronize counts. Never throws.
 */
export function consumeItem(
  inventory: InventoryState,
  itemId: RpgItemId,
  quantity: number,
): InventoryState {
  const remove = coerceCount(quantity);
  if (remove <= 0) return inventory;
  const held = getItemCount(inventory, itemId);
  if (held < remove) return inventory;
  const next: InventoryEntry[] = [];
  for (const entry of inventory) {
    if (entry.itemId === itemId) {
      const remaining = entry.quantity - remove;
      if (remaining > 0) next.push({ itemId, quantity: remaining });
    } else {
      next.push(entry);
    }
  }
  return next;
}
