/**
 * Item definitions and inventory state.
 *
 * v1 items are data-driven with two kinds: potions restore a fixed HP amount,
 * capture items add a basis-point catch bonus. Pure count operations arrive
 * with Milestone 2.
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
