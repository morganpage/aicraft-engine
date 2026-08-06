/**
 * aicraft-engine — top-level barrel.
 *
 * See `README.md` for the library overview and `docs/architecture.md` for
 * the layer model. Import from individual modules for tree-shaking, or from
 * this barrel for convenience.
 */
export * from './primitives';
export * from './rng';
export * from './particles';
export * from './animation';
export * from './palette';
export * from './cosmetics';
export * from './iap';
export * from './collision';
export * from './camera';
export * from './input';
export * from './game-loop';
export * from './game-state';
export * from './audio';
export * from './save';
export * from './blend';
export * from './easing';
export * from './music';
export * from './platformer';
export * from './level';
export * from './ldtk';
export * from './editor';
export * from './collectibles';
export * from './replay';
export * from './simtest';
export * from './terrain';
export * from './terrain-art';
export * from './character';
// leveltest — values and types for the verification module
export type {
  ReachabilityConfidence,
  Surface,
  JumpEdge,
  ReachGraph,
  ReachabilityResult,
  ReachabilityConfig,
  JumpArcConfig,
  JumpArcResult,
  VerificationStatus,
  LevelTestConfig,
  VerificationResult,
  VerificationDiagnostic,
  PlatformerSimulationState,
  BotPolicy,
  BotContext,
  WinCondition,
} from './leveltest';
export {
  computeJumpArc,
  buildReachGraph,
  analyzeReachability,
  verifyLevel,
  verifyCompiledLevel,
  createPlatformerAdapter,
  cautiousPolicy,
  directPolicy,
  collectorPolicy,
  DEFAULT_BOT_POLICIES,
  reachedExit,
  collectedAll,
  reachedExitWithKey,
  DEFAULT_WIN_CONDITION,
} from './leveltest';

// levelgen — explicit exports (omitting names defined in leveltest to avoid ambiguity)
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
  GenerationReport,
  GeneratedLevel,
  PhysicsConstraints,
  Motif,
  QualityConfig,
  CandidateSearchConfig,
  CandidateResult,
  CandidateSearchResult,
} from './levelgen';
export {
  DEFAULT_LEVEL_GEN_CONFIG,
  DEFAULT_TILE_SEMANTICS,
  DEFAULT_QUALITY_WEIGHTS,
  MAX_GENERATED_CELLS,
  DEFAULT_CANDIDATE_COUNT,
  DEFAULT_MAX_REPAIR_PASSES,
  MIN_SAFETY_MARGIN,
  deriveMaxJumpDistance,
  deriveMaxStepUp,
  derivePhysicsConstraints,
  generateRoute,
  generateRhythm,
  MOTIF_CATALOG,
  findMotif,
  findCompatibleMotifs,
  realizeBlueprint,
  generateBlueprint,
  generateLevel,
  evaluateLevelQuality,
  generateCandidates,
} from './levelgen';
