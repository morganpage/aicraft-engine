/**
 * Party state. Pure operations (capacity checks, captures, switches) arrive
 * with Milestone 2; the contract is fixed here because battle state and the
 * facade both reference it.
 */

import type { CreatureInstance } from './creatures';

/**
 * The player's creature party, ordered. Length stays within
 * `[1, RPG_MAX_PARTY_SIZE]` outside terminal defeat states; index 0 leads.
 */
export type PartyState = readonly CreatureInstance[];
