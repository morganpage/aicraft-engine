/**
 * Procedural level generator (Phase 4 — Blueprint and baseline realization).
 *
 * Combines route graph generation, rhythm/pacing planning, motif-based
 * geometry construction, and physics-constrained realization into a
 * deterministic pipeline that produces complete, valid `LevelData` from
 * a seed.
 *
 * Determinism summary:
 *  - All random variation uses `mulberry32` (seeded PRNG).
 *  - No `Math.random`, no `Date.now`, no global mutable state.
 *  - Every export is a pure function over plain data.
 *  - Same `(seed, config)` → same output, forever.
 *
 * @module
 */

export type {
  LevelGenConfig,
  RouteNode,
  RouteEdge,
  RouteGraph,
  PacingBeat,
  RequiredMechanic,
  LevelBlueprint,
  RepairRecord,
  GenerationDiagnostic,
  QualityWeights,
  LevelQualityReport,
  JumpSafetyMetric,
  QualityDiagnostic,
  ReachabilityConfidence,
  ReachabilityResult,
  VerificationStatus,
  VerificationDiagnostic,
  VerificationResult,
  GenerationReport,
  GeneratedLevel,
} from './types';

export type { PhysicsConstraints } from './physics';
export type { Motif } from './motifs';

export {
  DEFAULT_LEVEL_GEN_CONFIG,
  DEFAULT_TILE_SEMANTICS,
  DEFAULT_QUALITY_WEIGHTS,
  MAX_GENERATED_CELLS,
  DEFAULT_CANDIDATE_COUNT,
  DEFAULT_MAX_REPAIR_PASSES,
  MIN_SAFETY_MARGIN,
} from './constants';

export {
  deriveMaxJumpDistance,
  deriveMaxStepUp,
  derivePhysicsConstraints,
} from './physics';

export { generateRoute } from './route';
export { generateRhythm } from './rhythm';

export {
  MOTIF_CATALOG,
  findMotif,
  findCompatibleMotifs,
} from './motifs';

export { realizeBlueprint } from './realize';

export {
  generateBlueprint,
  generateLevel,
} from './generate';

export type {
  QualityConfig,
} from './quality';
export {
  evaluateLevelQuality,
} from './quality';

export type {
  CandidateSearchConfig,
  CandidateResult,
  CandidateSearchResult,
} from './candidates';
export {
  generateCandidates,
} from './candidates';

// ---------------------------------------------------------------------------
// Diversity / Novelty archive (Phase 7)
// ---------------------------------------------------------------------------

export type {
  LevelFingerprint,
  NoveltyArchive,
} from './diversity';
export {
  computeLevelFingerprint,
  createNoveltyArchive,
  addToArchive,
  noveltyScore,
} from './diversity';

// ---------------------------------------------------------------------------
// Calibration / Difficulty bands (Phase 7)
// ---------------------------------------------------------------------------

export type {
  DifficultyBand,
  CalibrationConfig,
  CalibrationResult,
  PerturbationConfig,
  PerturbationResult,
} from './calibration';
export {
  LOW_DIFFICULTY_BAND,
  MEDIUM_DIFFICULTY_BAND,
  HIGH_DIFFICULTY_BAND,
  calibrateDifficulty,
  runLowSkillPerturbation,
} from './calibration';
