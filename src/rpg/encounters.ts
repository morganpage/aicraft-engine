/**
 * Encounter tables for step-triggered wild encounters.
 *
 * Checks run on semantic `stepCompleted` events — never frame time or pixel
 * distance — and consume a fixed three-roll pack per eligible grass arrival
 * (trigger, species, level) even when the trigger fails, so the world
 * stream's cursor is immune to later branching changes.
 */

import type { SerializableRngState } from '../rng/state';
import { nextRngInt } from '../rng/state';
import { deriveSeed } from '../rng/derive-seed';
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

/** The outcome of one fixed three-roll encounter pack. */
export interface EncounterRollResult {
  readonly worldRng: SerializableRngState;
  /** The rolled encounter, or `null` when the trigger failed. */
  readonly encounter: {
    readonly speciesId: RpgSpeciesId;
    readonly level: number;
  } | null;
}

/**
 * Consume one fixed three-roll pack against a table: trigger, weighted
 * species, wild level — in that order, regardless of the trigger result.
 * Defensive: an empty/invalid table consumes its rolls and triggers nothing.
 */
export function rollEncounter(
  worldRng: SerializableRngState,
  table: EncounterTable,
): EncounterRollResult {
  let rng = worldRng;

  const triggerDraw = nextRngInt(rng, 0, 9999);
  rng = triggerDraw.state;

  const entries = table.entries ?? [];
  const totalWeight = entries.reduce((sum, entry) => sum + Math.max(0, Math.floor(entry.weight) || 0), 0);
  const speciesDraw = nextRngInt(rng, 0, Math.max(0, totalWeight - 1));
  rng = speciesDraw.state;

  let chosen: EncounterEntry | null = null;
  if (totalWeight > 0) {
    let cursor = speciesDraw.value;
    for (const entry of entries) {
      const weight = Math.max(0, Math.floor(entry.weight) || 0);
      if (cursor < weight) {
        chosen = entry;
        break;
      }
      cursor -= weight;
    }
  }

  const minLevel = chosen ? Math.max(1, Math.floor(chosen.minLevel) || 1) : 1;
  const maxLevel = chosen ? Math.max(minLevel, Math.floor(chosen.maxLevel) || minLevel) : 1;
  const levelDraw = nextRngInt(rng, minLevel, maxLevel);
  rng = levelDraw.state;

  const triggerBasisPoints = Math.min(10000, Math.max(0, Math.floor(table.triggerBasisPoints) || 0));
  const triggered = triggerDraw.value < triggerBasisPoints && chosen !== null;

  return {
    worldRng: rng,
    encounter: triggered && chosen ? { speciesId: chosen.speciesId, level: levelDraw.value } : null,
  };
}

/**
 * Derive the deterministic seed pair for one started encounter: the battle
 * stream seed and the wild creature's individual seed. Addressed by the
 * stable encounter index, never by call order.
 */
export function deriveEncounterSeeds(
  rootSeed: number,
  encounterIndex: number,
): { readonly battleSeed: number; readonly creatureSeed: number } {
  return {
    battleSeed: deriveSeed(rootSeed, 'encounter', encounterIndex),
    creatureSeed: deriveSeed(rootSeed, 'encounter-creature', encounterIndex),
  };
}

