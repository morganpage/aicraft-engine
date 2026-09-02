/**
 * The creative surface of the starter game. This is the file a builder is
 * expected to edit: change the seed, world shape, starting party, starting
 * inventory, and dialogue copy — everything else is engine composition.
 */

import {
  createStarterContentBundle,
  STARTER_FIELD_MAP_ID,
  STARTER_FIELD_START_ID,
} from 'aicraft-engine';
import type { RpgContentBundle } from 'aicraft-engine';

/** One seed drives species, world layout, and every encounter stream. */
export const GAME_SEED = 2026;

export const SPAWN = {
  mapId: STARTER_FIELD_MAP_ID,
  anchorId: STARTER_FIELD_START_ID,
} as const;

export const STARTING_PARTY = [
  // The first generated species at the envelope starter level.
  // Swap in any compiled species id to change your partner.
  // { speciesId: '<species-id-from-content>', level: 4 },
] as const;

export const STARTING_INVENTORY = [
  { itemId: 'capture-orb', quantity: 3 },
  { itemId: 'potion', quantity: 2 },
] as const;

/** The save key under localStorage (or the injected storage backend). */
export const SAVE_KEY = 'meadow-tamers-save';

/**
 * Assemble the game's content bundle. The engine starter bundle provides
 * types, moves, items, encounter table, dialogue, generated species, and
 * the generated two-map world — all from `GAME_SEED`. Override any array
 * here to reshape the game; run it through `compileRpgContent` (the game
 * object does that for you).
 */
export function buildGameContent(): RpgContentBundle {
  return createStarterContentBundle(GAME_SEED);
}
