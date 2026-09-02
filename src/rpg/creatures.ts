/**
 * Species definitions and creature instances.
 *
 * Definition/instance separation is absolute: species content never stores
 * per-creature values (HP, level, learned moves), and save data never
 * duplicates species stats. Derived stats follow the starter balance
 * envelope: max HP `baseStats.hp + 3 × level`, others `baseStats + level`.
 */

import type { CreatureStats, RpgSpeciesId, RpgTypeId, RpgMoveId, RpgCreatureInstanceId } from './types';

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
