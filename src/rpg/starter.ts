/**
 * The canonical starter content bundle: four ring-relationship types, eight
 * moves (basic + strong per type), two items, one grass encounter table,
 * one NPC dialogue tree with choices/conditions/effects, six generated
 * species, and the generated two-map world — all keyed to one seed.
 *
 * This is the reference composition the starter game and engine tests
 * build on; a clean-room builder authors their own bundle through the same
 * public types. All names are original; nothing here derives from
 * franchise content.
 */

import { generateRpgWorld, STARTER_FIELD_START_ID, DEFAULT_WORLD_GEN_CONFIG } from './mapgen';
import { generateSpeciesSet } from './creature-generator';
import { RPG_LEVEL_CAP } from './constants';
import type { RpgContentBundle, RpgTypeDefinition } from './content';
import type { MoveDefinition, SpeciesDefinition } from './creatures';
import type { ItemDefinition } from './inventory';
import type { EncounterTable } from './encounters';
import type { DialogueDefinition } from './dialogue';
import type { RpgTypeId } from './types';

const NEUTRAL = { numerator: 1, denominator: 1 } as const;
const SUPER = { numerator: 2, denominator: 1 } as const;
const RESIST = { numerator: 1, denominator: 2 } as const;

/** The four original types: ember > grove > spark > tide > ember. */
export const STARTER_TYPES: readonly RpgTypeDefinition[] = [
  {
    id: 'ember',
    name: 'Ember',
    effectiveness: { ember: NEUTRAL, tide: RESIST, grove: SUPER, spark: NEUTRAL },
  },
  {
    id: 'tide',
    name: 'Tide',
    effectiveness: { ember: SUPER, tide: NEUTRAL, grove: RESIST, spark: NEUTRAL },
  },
  {
    id: 'grove',
    name: 'Grove',
    effectiveness: { ember: RESIST, tide: NEUTRAL, grove: NEUTRAL, spark: SUPER },
  },
  {
    id: 'spark',
    name: 'Spark',
    effectiveness: { ember: NEUTRAL, tide: SUPER, grove: RESIST, spark: NEUTRAL },
  },
];

export const STARTER_TYPE_IDS: readonly RpgTypeId[] = STARTER_TYPES.map((type) => type.id);

const BASIC_POWER = 6;
const STRONG_POWER = 10;
const BASIC_ACCURACY = 10000;
const STRONG_ACCURACY = 9000;

function basicMove(id: string, name: string, typeId: RpgTypeId): MoveDefinition {
  return { id, name, typeId, power: BASIC_POWER, accuracyBasisPoints: BASIC_ACCURACY, priority: 0 };
}

function strongMove(id: string, name: string, typeId: RpgTypeId): MoveDefinition {
  return { id, name, typeId, power: STRONG_POWER, accuracyBasisPoints: STRONG_ACCURACY, priority: 0 };
}

/** Eight moves: one basic and one stronger move for each type. */
export const STARTER_MOVES: readonly MoveDefinition[] = [
  basicMove('ember-jab', 'Ember Jab', 'ember'),
  strongMove('ember-burst', 'Ember Burst', 'ember'),
  basicMove('tide-splash', 'Tide Splash', 'tide'),
  strongMove('tide-crash', 'Tide Crash', 'tide'),
  basicMove('grove-whip', 'Grove Whip', 'grove'),
  strongMove('grove-slam', 'Grove Slam', 'grove'),
  basicMove('spark-nip', 'Spark Nip', 'spark'),
  strongMove('spark-bolt', 'Spark Bolt', 'spark'),
];

/** Two items: one potion and one capture item. */
export const STARTER_ITEMS: readonly ItemDefinition[] = [
  { id: 'potion', name: 'Potion', kind: 'potion', healAmount: 20 },
  { id: 'capture-orb', name: 'Capture Orb', kind: 'capture', catchBonusBasisPoints: 2000 },
];

const GRASS_TABLE_ID = DEFAULT_WORLD_GEN_CONFIG.encounterTableId;
const GRASS_TRIGGER_BASIS_POINTS = 2500;
const WILD_MIN_LEVEL = 3;
const WILD_MAX_LEVEL = 5;

/** The starter NPC dialogue: choices, conditions, flag + item effects. */
export const STARTER_DIALOGUE: DialogueDefinition = {
  id: 'dlg-field-guide',
  entryNodeId: 'greet',
  nodes: [
    {
      id: 'greet',
      speakerId: 'field-guide',
      text: 'Welcome to the meadow! Wild creatures rustle in the tall grass south of here.',
      choices: [
        { id: 'ask', text: 'Any advice?', next: 'tip', conditions: [{ kind: 'flagEquals', flag: 'metGuide', value: false }] },
        { id: 'ask-again', text: 'What was that advice again?', next: 'again-tip', conditions: [{ kind: 'flagEquals', flag: 'metGuide', value: true }] },
        { id: 'bye', text: 'Just passing through.', next: 'farewell' },
      ],
    },
    {
      id: 'tip',
      speakerId: 'field-guide',
      text: 'Weaken a creature before throwing your capture orb. Remember the ring: ember burns grove, grove grounds spark, spark bites tide, tide douses ember.',
      next: 'farewell',
    },
    {
      id: 'again-tip',
      speakerId: 'field-guide',
      text: 'Weaken first, capture second. And rest at the house whenever your team hurts.',
      next: 'farewell',
    },
    {
      id: 'farewell',
      speakerId: 'field-guide',
      text: 'Take these for the road. Good luck out there!',
      effects: [
        { kind: 'setFlag', flag: 'metGuide', value: true },
        { kind: 'giveItem', itemId: 'capture-orb', quantity: 2 },
        { kind: 'giveItem', itemId: 'potion', quantity: 1 },
      ],
    },
  ],
};

/**
 * Assemble the starter bundle for one seed: fixed types/moves/items/
 * dialogue, six generated species, and the generated world. The returned
 * bundle is plain JSON-serializable data; run it through
 * `compileRpgContent` before play.
 */
export function createStarterContentBundle(seed: number): RpgContentBundle {
  const species: readonly SpeciesDefinition[] = generateSpeciesSet(seed, {
    typeIds: STARTER_TYPE_IDS,
    moves: STARTER_MOVES,
  });
  const encounters: readonly EncounterTable[] = [
    {
      id: GRASS_TABLE_ID,
      triggerBasisPoints: GRASS_TRIGGER_BASIS_POINTS,
      entries: species.map((def, i) => ({
        speciesId: def.id,
        weight: 4 + (i % 2),
        minLevel: WILD_MIN_LEVEL,
        maxLevel: WILD_MAX_LEVEL,
      })),
    },
  ];
  return {
    schemaVersion: 1,
    types: STARTER_TYPES,
    moves: STARTER_MOVES,
    species,
    items: STARTER_ITEMS,
    encounters,
    dialogues: [STARTER_DIALOGUE],
    maps: generateRpgWorld(seed, { encounterTableId: GRASS_TABLE_ID }).maps,
  };
}

/** Spawn anchor of the starter world's outdoor map. */
export const STARTER_SPAWN_ANCHOR_ID = STARTER_FIELD_START_ID;

/** Starter party: the first generated species at level 4 (envelope rule). */
export const STARTER_PARTY_LEVEL = 4;

/** Wild level range constants for balance tests. */
export const STARTER_WILD_LEVEL_RANGE = { min: WILD_MIN_LEVEL, max: WILD_MAX_LEVEL, cap: RPG_LEVEL_CAP } as const;
