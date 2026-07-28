/**
 * Generic deterministic simulation-test module.
 *
 * This module owns the foundational simulation-test infrastructure:
 *   - Fixed-tick orchestration and budgets
 *   - Policy execution
 *   - Trace recording, playback, and fingerprints
 *   - Success vs inconclusive semantics
 *   - Callback-error diagnostics
 *
 * The module has **zero imports** from `platformer/`, `level/`, `editor/`,
 * `collectibles/`, or any consumer game. It only knows how to drive a
 * generic `SimulationAdapter<TState, TAction>`.
 *
 * @module
 */

export type {
  SimulationOutcome,
  SimulationTermination,
  SimulationPolicyContext,
  SimulationPolicy,
  SimulationTrace,
  SimulationRunResult,
  ScenarioVerificationResult,
  ScenarioTestConfig,
  SimulationPlaybackResult,
  SimulationDiagnostic,
  SimulationAdapter,
} from './types';

export { verifyScenario, playSimulationTrace } from './runner';
export { simulationTraceHash } from './trace';
