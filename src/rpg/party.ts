/**
 * Party state. Pure operations (capacity checks, captures, switches) arrive
 * with Milestone 2; the contract is fixed here because battle state and the
 * facade both reference it.
 */

import type { CreatureInstance, SpeciesDefinition } from './creatures';
import { deriveMaxHp } from './creatures';
import type { RpgSpeciesId } from './types';

/**
 * The player's creature party, ordered. Length stays within
 * `[1, RPG_MAX_PARTY_SIZE]` outside terminal defeat states; index 0 leads.
 */
export type PartyState = readonly CreatureInstance[];

/**
 * Restore every party member to its derived maximum HP. Members whose
 * species is missing from the lookup are left unchanged (safe no-op) —
 * compiled content guarantees the lookup is complete. Pure: never mutates
 * the input party.
 */
export function healPartyFully(
  party: PartyState,
  species: Readonly<Record<RpgSpeciesId, SpeciesDefinition>>,
): PartyState {
  return party.map((member) => {
    const def = species[member.speciesId];
    if (!def) return member;
    return { ...member, currentHp: deriveMaxHp(def.baseStats.hp, member.level) };
  });
}
