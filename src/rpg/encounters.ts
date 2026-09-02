/**
 * Encounter tables for step-triggered wild encounters.
 *
 * Checks run on semantic `stepCompleted` events — never frame time or pixel
 * distance — and consume a fixed three-roll pack per eligible grass arrival
 * (trigger, species, level) even when the trigger fails.
 */

import type { RpgEncounterTableId, RpgSpeciesId } from './types';

/** One weighted species possibility in an encounter table. */
export interface EncounterEntry {
  readonly speciesId: RpgSpeciesId;
  readonly weight: number;
  readonly minLevel: number;
  readonly maxLevel: number;
}

/** A grass-zone encounter table. */
export interface EncounterTable {
  readonly id: RpgEncounterTableId;
  /** Chance any eligible grass step starts an encounter, in basis points. */
  readonly triggerBasisPoints: number;
  /** Non-empty weighted entries; weights are positive integers. */
  readonly entries: readonly EncounterEntry[];
}
