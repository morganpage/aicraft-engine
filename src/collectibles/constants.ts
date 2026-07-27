/**
 * Tunables and canonical defaults for the collectibles module.
 *
 * No magic numbers live outside this file. Consumers may import these to
 * author levels, build their own catalog entries, or seed editors.
 *
 * @module
 */

import type { LevelRect } from '../level/types';

/**
 * Default rect for a placed collectible. 16×16 (one tile) at the origin —
 * the consumer translates to the placement position at instantiate time.
 */
export const DEFAULT_COLLECTIBLE_RECT: Readonly<LevelRect> = {
  x: 0,
  y: 0,
  width: 16,
  height: 16,
};

/**
 * Default `value` for a placed coin. Mirrors Mario's "1 coin = 1 unit" rule.
 * The consumer owns value semantics — this is the library's only numeric
 * opinion for collectibles.
 */
export const DEFAULT_COLLECTIBLE_VALUE = 1;
