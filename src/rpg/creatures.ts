/**
 * Species definitions and creature instances.
 *
 * Definition/instance separation is absolute: species content never stores
 * per-creature values (HP, level, learned moves), and save data never
 * duplicates species stats. Derived stats follow the starter balance
 * envelope: max HP `baseStats.hp + 3 × level`, others `baseStats + level`.
 */

import type { CreatureStats, RpgSpeciesId, RpgTypeId, RpgMoveId, RpgCreatureInstanceId } from './types';
import { RPG_LEVEL_CAP, RPG_MAX_MOVES_PER_CREATURE } from './constants';

/** Body-plan grammars available to the creature generator and renderer. */
export type RpgBodyPlan = 'blob' | 'quadruped' | 'avian' | 'sprout' | 'shell';

/**
 * Procedural visual contract for one species: serializable primitive
 * parameters only, never draw callbacks. The creature renderer dispatches on
 * `bodyPlan` and interprets `proportions`/`features`; `paletteSeed` addresses
 * a visual stream via `deriveVisualSeed`.
 */
export interface CreatureVisualManifest {
  readonly generatorVersion: number;
  readonly bodyPlan: RpgBodyPlan;
  readonly paletteSeed: number;
  /** Body-plan-specific numeric proportions (e.g. `{ bodyScale: 1.2 }`). */
  readonly proportions: Readonly<Record<string, number>>;
  /** Named decorative features (e.g. `'horn'`, `'tailFan'`) from the grammar. */
  readonly features: readonly string[];
}

/** One learnable move. Power 0 moves deal fixed minimum damage only. */
export interface MoveDefinition {
  readonly id: RpgMoveId;
  readonly name: string;
  readonly typeId: RpgTypeId;
  readonly power: number;
  /** Accuracy in basis points, 0–10,000 (10,000 never misses). */
  readonly accuracyBasisPoints: number;
  /** Higher priority acts first regardless of speed; 0 is normal. */
  readonly priority: number;
}

/**
 * A species as authored (or generated) content. `catchBasisPoints` is the
 * base capture chance before item bonus and missing-HP bonus.
 */
export interface SpeciesDefinition {
  readonly id: RpgSpeciesId;
  readonly name: string;
  readonly typeId: RpgTypeId;
  readonly baseStats: CreatureStats;
  readonly catchBasisPoints: number;
  readonly expYield: number;
  /** Level-gated moves in ascending level order. */
  readonly learnset: readonly {
    readonly level: number;
    readonly moveId: RpgMoveId;
  }[];
  readonly visual: CreatureVisualManifest;
}

/**
 * One living creature. `currentHp`, `level`, `xp`, and `moveIds` are the only
 * per-individual simulation values; everything else derives from species
 * content. `individualSeed` addresses the optional per-individual stream.
 */
export interface CreatureInstance {
  readonly id: RpgCreatureInstanceId;
  readonly speciesId: RpgSpeciesId;
  readonly individualSeed: number;
  readonly level: number;
  readonly xp: number;
  readonly currentHp: number;
  readonly moveIds: readonly RpgMoveId[];
}

function coerceStat(value: number): number {
  return Number.isFinite(value) ? Math.floor(value) : 0;
}

function clampLevel(level: number): number {
  const safe = Number.isFinite(level) ? Math.floor(level) : 1;
  return Math.min(RPG_LEVEL_CAP, Math.max(1, safe));
}

/**
 * Derived maximum HP per the starter balance envelope:
 * `baseHp + 3 × level`. Defensive: non-finite base stat coerces to zero,
 * level clamps into `[1, RPG_LEVEL_CAP]`. Never throws.
 */
export function deriveMaxHp(baseHp: number, level: number): number {
  return coerceStat(baseHp) + 3 * clampLevel(level);
}

/**
 * Derived battle stats per the starter balance envelope: HP grows with
 * `3 × level`, attack/defense/speed with `1 × level`. Never throws.
 */
export function deriveCreatureStats(base: CreatureStats, level: number): CreatureStats {
  const safeLevel = clampLevel(level);
  return {
    hp: coerceStat(base.hp) + 3 * safeLevel,
    attack: coerceStat(base.attack) + safeLevel,
    defense: coerceStat(base.defense) + safeLevel,
    speed: coerceStat(base.speed) + safeLevel,
  };
}

/**
 * Build a living creature instance from its species. Known moves are the
 * learnset entries at or below the level, in ascending learnset order,
 * capped at `RPG_MAX_MOVES_PER_CREATURE` (later entries are simply not
 * known yet — they arrive through level-ups). HP starts at the derived
 * maximum. Never throws.
 */
export function createCreatureInstance(params: {
  readonly id: string;
  readonly species: SpeciesDefinition;
  readonly level: number;
  readonly individualSeed: number;
}): CreatureInstance {
  const level = clampLevel(params.level);
  const moveIds = params.species.learnset
    .filter((entry) => entry.level <= level)
    .slice(0, RPG_MAX_MOVES_PER_CREATURE)
    .map((entry) => entry.moveId);
  return {
    id: params.id,
    speciesId: params.species.id,
    individualSeed: params.individualSeed >>> 0,
    level,
    xp: 0,
    currentHp: deriveMaxHp(params.species.baseStats.hp, level),
    moveIds,
  };
}
