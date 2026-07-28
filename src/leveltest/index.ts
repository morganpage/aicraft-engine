/**
 * Level-test module — static reachability analysis, trajectory sampling,
 * and tri-state verification for platformer levels.
 *
 * This module provides the platformer-specific verification layer atop the
 * generic simulation-test module (`src/simtest/`). It composes:
 *
 * - Jump-arc trajectory sampling (`computeJumpArc`)
 * - Reachability graph construction (`buildReachGraph`)
 * - Full static reachability analysis (`analyzeReachability`)
 * - Platformer simulation adapter (`createPlatformerAdapter`)
 * - Bot policies (`cautiousPolicy`, `directPolicy`, `collectorPolicy`)
 * - Win conditions (`reachedExit`, `collectedAll`, `reachedExitWithKey`)
 * - Tri-state verification (`verifyLevel`, `verifyCompiledLevel`)
 *
 * **Determinism:** All functions are pure — same input → same output, forever.
 * No `Math.random`, no `Date.now()`, no DOM reads, no global mutable state.
 *
 * @module
 */

export type {
  ReachabilityConfidence,
  Surface,
  JumpEdge,
  ReachGraph,
  ReachabilityResult,
  ReachabilityConfig,
} from './types';

export type {
  JumpArcConfig,
  JumpArcResult,
} from './trajectory';

export type {
  VerificationStatus,
  LevelTestConfig,
  VerificationResult,
  VerificationDiagnostic,
} from './verify';

export type {
  PlatformerSimulationState,
} from './adapter';

export type {
  BotPolicy,
  BotContext,
} from './policies';

export type {
  WinCondition,
} from './win-conditions';

export {
  computeJumpArc,
} from './trajectory';

export {
  buildReachGraph,
  analyzeReachability,
} from './reachability';

export {
  verifyLevel,
  verifyCompiledLevel,
} from './verify';

export {
  createPlatformerAdapter,
} from './adapter';

export {
  cautiousPolicy,
  directPolicy,
  collectorPolicy,
  DEFAULT_BOT_POLICIES,
} from './policies';

export {
  reachedExit,
  collectedAll,
  reachedExitWithKey,
  DEFAULT_WIN_CONDITION,
} from './win-conditions';
