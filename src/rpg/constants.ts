/**
 * Version numbers, RNG draw budgets, structural limits, and default
 * configuration for the RPG module.
 *
 * Version semantics:
 * - `RPG_STATE_SCHEMA_VERSION` / `RPG_SAVE_SCHEMA_VERSION` change when the
 *   serialized shape of state/saves changes (migration territory).
 * - `RPG_RULES_VERSION` changes when any simulated outcome can differ for
 *   the same commands — formulas, roll order, draw budgets, defaults. Golden
 *   transcripts and saves bind to it.
 */

import type { RpgConfig } from './state';

/** Serialized shape version of `RpgState` (activity union, fields). */
export const RPG_STATE_SCHEMA_VERSION = 1;

/** Authored content bundle schema version accepted by `compileRpgContent`. */
export const RPG_CONTENT_SCHEMA_VERSION = 1;

/** Save envelope schema version produced/consumed by the save pipeline. */
export const RPG_SAVE_SCHEMA_VERSION = 1;

/** Battle and progression rules version; golden transcripts bind to it. */
export const RPG_RULES_VERSION = 1;

/** Creature generator grammar version recorded in visual manifests. */
export const RPG_GENERATOR_VERSION = 1;

// ---------------------------------------------------------------------------
// Fixed RNG draw budgets
// ---------------------------------------------------------------------------

/**
 * World-stream rolls consumed for every eligible grass arrival, in order —
 * trigger, species, wild level — even when the trigger fails. A fixed budget
 * keeps encounter streams stable against later branching changes.
 */
export const ENCOUNTER_ROLL_PACK_SIZE = 3;

/**
 * Battle-stream draws per legal Fight command: enemy move choice, order
 * tie-break, player accuracy/critical/variance, wild accuracy/critical/
 * variance. All eight are consumed even when a roll is unneeded or an actor
 * faints before acting.
 */
export const BATTLE_FIGHT_DRAW_BUDGET = 8;

/** Battle draws per legal Catch command: capture, then the wild attack pack. */
export const BATTLE_CATCH_DRAW_BUDGET = 4;

/** Battle draws per legal Switch command: the wild attack pack. */
export const BATTLE_SWITCH_DRAW_BUDGET = 3;

/** Battle draws per legal Flee command: flee, then the wild attack pack. */
export const BATTLE_FLEE_DRAW_BUDGET = 4;

// ---------------------------------------------------------------------------
// Structural limits (locked vertical-slice decisions)
// ---------------------------------------------------------------------------

/** Maximum creatures in the party; capture is illegal at this size. */
export const RPG_MAX_PARTY_SIZE = 6;

/** Maximum moves one creature may know; further learning is deferred. */
export const RPG_MAX_MOVES_PER_CREATURE = 4;

/** Level cap for starter content progression. */
export const RPG_LEVEL_CAP = 20;

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

/**
 * Default fixed-tick configuration. `tickDuration` matches the engine
 * `DEFAULT_FIXED_DT` (seconds); the controller reports a diagnostic when
 * `step` receives a `fixedDt` that disagrees with it.
 */
export const DEFAULT_RPG_CONFIG: Readonly<RpgConfig> = Object.freeze({
  tickDuration: 1 / 60,
  stepDurationTicks: 8,
  transitionDurationTicks: 18,
});
