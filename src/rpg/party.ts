/**
 * Party state and pure party operations.
 *
 * The party is an ordered array of creature instances (index 0 leads) with
 * a hard maximum of `RPG_MAX_PARTY_SIZE`. All operations are pure and never
 * throw — capacity violations are no-ops.
 */

import type { CreatureInstance, SpeciesDefinition } from './creatures';
import { deriveMaxHp } from './creatures';
import { RPG_MAX_PARTY_SIZE } from './constants';
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

/** Whether one more creature can join the party. */
export function partyHasSpace(party: PartyState, max: number = RPG_MAX_PARTY_SIZE): boolean {
  return party.length < max;
}

/**
 * Append a captured creature. Exceeding capacity is a no-op (capture
 * legality is checked before the attempt; this is the defensive backstop).
 */
export function appendCreature(party: PartyState, creature: CreatureInstance): PartyState {
  if (party.length >= RPG_MAX_PARTY_SIZE) return party;
  return [...party, creature];
}

/** Index of the first non-fainted creature, or `-1` when all are fainted. */
export function firstAliveIndex(party: PartyState): number {
  for (let i = 0; i < party.length; i++) {
    if (party[i].currentHp > 0) return i;
  }
  return -1;
}

/** Number of non-fainted creatures. */
export function aliveCount(party: PartyState): number {
  let count = 0;
  for (const member of party) {
    if (member.currentHp > 0) count += 1;
  }
  return count;
}
