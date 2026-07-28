/**
 * Default configs and limits for the procedural level generator.
 *
 * All tunable values live here — no magic numbers in the generation logic.
 *
 * @module
 */

import type { LevelGenConfig, QualityWeights } from './types';
import type { GeneratedTileSemantics } from '../level/tile-semantics';

/**
 * Default level generation configuration.
 *
 * Creates a 60×15 tile level (960×540 px at 16px tiles), at 0.5 difficulty,
 * with 8 evaluation candidates.
 */
export const DEFAULT_LEVEL_GEN_CONFIG: Readonly<LevelGenConfig> = {
  cols: 60,
  rows: 15,
  tileSize: 16,
  difficulty: 0.5,
  candidateCount: 8,
  maxRepairPasses: 2,
};

/**
 * Default tile semantics: value `1` = solid, value `2` = passthrough.
 */
export const DEFAULT_TILE_SEMANTICS: Readonly<GeneratedTileSemantics> = {
  solid: [1],
  passthrough: [2],
};

/**
 * Default quality evaluation weights. All values in `[0, 1]`; they need
 * not sum to exactly `1.0` — scores are normalized by the evaluator.
 */
export const DEFAULT_QUALITY_WEIGHTS: Readonly<QualityWeights> = {
  pacing: 0.2,
  variety: 0.15,
  fairness: 0.2,
  exploration: 0.15,
  difficultyFit: 0.2,
  readability: 0.1,
};

/**
 * Maximum number of generated tile cells. Generation validates `cols * rows`
 * against this before allocating.
 *
 * `1_000_000` tiles at 16 px = 16M px² (e.g. 1000×1000 tiles).
 */
export const MAX_GENERATED_CELLS = 1_000_000;

/**
 * Default number of candidates to generate and evaluate. Configurable via
 * `LevelGenConfig.candidateCount`.
 */
export const DEFAULT_CANDIDATE_COUNT = 8;

/**
 * Default maximum targeted repair passes. Configurable via
 * `LevelGenConfig.maxRepairPasses`.
 */
export const DEFAULT_MAX_REPAIR_PASSES = 2;

/**
 * Default entity id start. Matches `DEFAULT_ENTITY_ID_START` from level constants.
 */
export const DEFAULT_ENTITY_ID_START = 1;

/**
 * Default player width in pixels.
 */
export const DEFAULT_PLAYER_WIDTH = 16;

/**
 * Default player height in pixels.
 */
export const DEFAULT_PLAYER_HEIGHT = 24;

/**
 * Default fixed simulation timestep in seconds (60 Hz).
 */
export const DEFAULT_FIXED_DT = 1 / 60;

/**
 * Minimum safety margin in pixels for jump feasibility.
 */
export const MIN_SAFETY_MARGIN = 2;

/**
 * Seed derivation salt for route generation sub-seeds.
 */
export const ROUTE_SEED_SALT = 0x52545545; // "ROUE"

/**
 * Seed derivation salt for rhythm generation sub-seeds.
 */
export const RHYTHM_SEED_SALT = 0x52485954; // "RHYT"

/**
 * Seed derivation salt for realization sub-seeds.
 */
export const REALIZE_SEED_SALT = 0x5245414c; // "REAL"

/**
 * Seed derivation salt for candidate index derivation.
 */
export const CANDIDATE_SEED_SALT = 0x43414e44; // "CAND"

/**
 * Default level id prefix.
 */
export const DEFAULT_LEVEL_ID_PREFIX = 'generated-';
