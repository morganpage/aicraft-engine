/**
 * Seeded species generation from fixed grammars.
 *
 * Produces valid, JSON-serializable `SpeciesDefinition`s: names composed
 * from original syllable banks (normalized to safe ids, screened against a
 * reserved-name blacklist with deterministic reroll), one of five
 * non-franchise body plans, exact stat budgets from fixed archetypes, a
 * valid learnset drawn from the supplied move catalog, and a serializable
 * visual manifest. The blacklist reduces accidental trademark collisions;
 * shipped starter content still gets human review before publication.
 */

import { advanceRng, createRngState } from '../rng/state';
import { deriveSeed } from '../rng/derive-seed';
import { RPG_GENERATOR_VERSION } from './constants';
import type {
  CreatureStats,
  RpgMoveId,
  RpgSpeciesId,
  RpgTypeId,
} from './types';
import type { CreatureVisualManifest, MoveDefinition, RpgBodyPlan, SpeciesDefinition } from './creatures';

const NAME_STARTS = ['Bo', 'Lu', 'Mi', 'Ta', 'Ve', 'Ka', 'Py', 'Or', 'Su', 'Ny', 'Ga', 'Fe'] as const;
const NAME_MIDS = ['ra', 'lo', 'me', 'ki', 'tu', 'na', 've', 'sha', 'do', 'ri'] as const;
const NAME_ENDS = ['nix', 'ling', 'pod', 'fin', 'wisp', 'bug', 'cub', 'ray', 'mit', 'dle'] as const;

const NAME_BLACKLIST: ReadonlySet<string> = new Set([
  'pikachu', 'eevee', 'charmander', 'squirtle', 'bulbasaur', 'jigglypuff',
  'snorlax', 'meowth', 'psyduck', 'growlithe', 'diglett', 'vulpix',
  'slowpoke', 'magikarp', 'pokemon', 'pokémon', 'raichu', 'clefairy',
  'rattata', 'zubat', 'onix', 'gyarados', 'dragonite', 'mewtwo', 'mew',
]);

const BODY_PLANS: readonly RpgBodyPlan[] = ['blob', 'quadruped', 'avian', 'sprout', 'shell'];

/** Exact stat budgets (sum 48, each stat 8–16) keyed by archetype. */
const ARCHETYPES: readonly { readonly name: string; readonly stats: CreatureStats }[] = [
  { name: 'balanced', stats: { hp: 12, attack: 12, defense: 12, speed: 12 } },
  { name: 'sturdy', stats: { hp: 14, attack: 10, defense: 14, speed: 10 } },
  { name: 'swift', stats: { hp: 10, attack: 12, defense: 10, speed: 16 } },
  { name: 'bruiser', stats: { hp: 14, attack: 14, defense: 10, speed: 10 } },
  { name: 'guardian', stats: { hp: 16, attack: 10, defense: 10, speed: 12 } },
  { name: 'tricky', stats: { hp: 10, attack: 16, defense: 12, speed: 10 } },
];

const CATCH_BASIS_POINTS: Readonly<Record<RpgBodyPlan, number>> = {
  blob: 5000,
  quadruped: 3500,
  avian: 3000,
  sprout: 4500,
  shell: 2500,
};

const EXP_YIELDS: Readonly<Record<RpgBodyPlan, number>> = {
  blob: 30,
  quadruped: 34,
  avian: 28,
  sprout: 26,
  shell: 40,
};

const FEATURE_POOL: Readonly<Record<RpgBodyPlan, readonly string[]>> = {
  blob: ['antenna', 'spots', 'cheekPuffs'],
  quadruped: ['horn', 'tailFan', 'mane'],
  avian: ['crest', 'wingTips', 'beakMark'],
  sprout: ['leafCrown', 'bloom', 'vineWraps'],
  shell: ['spiral', 'spikes', 'rimBand'],
};

/** The move catalog the generator may draw learnsets from. */
export interface SpeciesCatalog {
  readonly typeIds: readonly RpgTypeId[];
  readonly moves: readonly MoveDefinition[];
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function composeName(rngWord: number, withMid: boolean): string {
  const start = NAME_STARTS[Math.floor(rngWord * NAME_STARTS.length) % NAME_STARTS.length];
  if (!withMid) {
    const end = NAME_ENDS[Math.floor(rngWord * 997) % NAME_ENDS.length];
    return `${start}${end}`;
  }
  const mid = NAME_MIDS[Math.floor(rngWord * NAME_MIDS.length) % NAME_MIDS.length];
  const end = NAME_ENDS[Math.floor(rngWord * 991) % NAME_ENDS.length];
  return `${start}${mid}${end}`;
}

function safeId(name: string): RpgSpeciesId {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'creature';
}

function generateName(state: number, attempt: number, index: number): string {
  let rng = createRngState(state);
  for (let i = 0; i < attempt; i++) rng = advanceRng(rng).state;
  const word = advanceRng(rng).value;
  const withMid = (index + attempt) % 2 === 0;
  return composeName(word, withMid);
}

function basicMoveForType(catalog: SpeciesCatalog, typeId: RpgTypeId): MoveDefinition | null {
  let fallback: MoveDefinition | null = null;
  for (const move of catalog.moves) {
    if (move.typeId !== typeId) continue;
    if (!fallback || move.power < fallback.power) fallback = move;
  }
  return fallback;
}

function strongMoveForType(catalog: SpeciesCatalog, typeId: RpgTypeId): MoveDefinition | null {
  let fallback: MoveDefinition | null = null;
  for (const move of catalog.moves) {
    if (move.typeId !== typeId) continue;
    if (!fallback || move.power > fallback.power) fallback = move;
  }
  return fallback;
}

function visualManifest(
  seed: number,
  index: number,
  bodyPlan: RpgBodyPlan,
): CreatureVisualManifest {
  const paletteSeed = deriveSeed(seed, 'species-palette', index);
  const proportionSeed = deriveSeed(seed, 'species-proportions', index);
  const featureSeed = deriveSeed(seed, 'species-features', index);
  const pool = FEATURE_POOL[bodyPlan];
  const featureCount = 1 + (featureSeed % pool.length === 0 ? 0 : 1);
  const features: string[] = [];
  for (let i = 0; i < featureCount; i++) {
    const pick = pool[(featureSeed + i * 7 + 3) % pool.length];
    if (!features.includes(pick)) features.push(pick);
  }
  const scale = 0.85 + ((proportionSeed % 100) / 100) * 0.4;
  return {
    generatorVersion: RPG_GENERATOR_VERSION,
    bodyPlan,
    paletteSeed,
    proportions: { bodyScale: Math.round(scale * 100) / 100 },
    features,
  };
}

/**
 * Generate one species for a catalog slot. Deterministic per
 * `(seed, index)`; the body plan cycles the five grammars and the type
 * cycles the catalog's type list so a set of six covers every plan and
 * every type at least once.
 */
export function generateSpecies(
  seed: number,
  index: number,
  catalog: SpeciesCatalog,
): SpeciesDefinition {
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const bodyPlan = BODY_PLANS[safeIndex % BODY_PLANS.length];
  const typeId = catalog.typeIds[safeIndex % catalog.typeIds.length] ?? 'ember';
  const archetype = ARCHETYPES[(safeIndex + Math.floor(deriveSeed(seed, 'species-archetype', safeIndex) % ARCHETYPES.length)) % ARCHETYPES.length];

  const nameState = deriveSeed(seed, 'species-name', safeIndex);
  let name = generateName(nameState, 0, safeIndex);
  for (let attempt = 1; attempt <= 8; attempt++) {
    if (!NAME_BLACKLIST.has(normalizeName(name))) break;
    name = generateName(nameState, attempt, safeIndex);
  }
  if (NAME_BLACKLIST.has(normalizeName(name))) {
    name = `Meadow${safeIndex + 1}`;
  }

  const learnset: { level: number; moveId: RpgMoveId }[] = [];
  const basic = basicMoveForType(catalog, typeId);
  const strong = strongMoveForType(catalog, typeId);
  if (basic && !learnset.some((entry) => entry.moveId === basic.id)) {
    learnset.push({ level: 1, moveId: basic.id });
  }
  if (strong && strong.id !== basic?.id) {
    learnset.push({ level: 4, moveId: strong.id });
  }

  return {
    id: safeId(name),
    name,
    typeId,
    baseStats: archetype.stats,
    catchBasisPoints: CATCH_BASIS_POINTS[bodyPlan],
    expYield: EXP_YIELDS[bodyPlan],
    learnset,
    visual: visualManifest(seed, safeIndex, bodyPlan),
  };
}

/**
 * Generate the six-species starter set: every body plan and every catalog
 * type appears at least once, and ids are unique (a numeric suffix resolves
 * any name collision deterministically).
 */
export function generateSpeciesSet(
  seed: number,
  catalog: SpeciesCatalog,
  count: number = 6,
): readonly SpeciesDefinition[] {
  const safeCount = Math.min(24, Math.max(1, Math.floor(count) || 6));
  const species: SpeciesDefinition[] = [];
  const usedIds = new Set<string>();
  for (let index = 0; index < safeCount; index++) {
    let candidate = generateSpecies(seed, index, catalog);
    if (usedIds.has(candidate.id)) {
      candidate = { ...candidate, id: `${candidate.id}-${index + 1}` };
    }
    usedIds.add(candidate.id);
    species.push(candidate);
  }
  return species;
}
