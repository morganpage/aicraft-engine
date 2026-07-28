/**
 * Type definitions for the generic deterministic simulation-test module
 * (`src/simtest/`).
 *
 * This module provides a framework for running deterministic scenarios with
 * configurable policies, recording traces, computing fingerprints, and
 * producing honest "proven-success" or "inconclusive" results.
 *
 * All types are generic over `TState` (simulation state) and `TAction`
 * (per-tick action). Actions must be canonical-JSON serializable (no
 * functions, symbols, or circular references).
 *
 * The module has **zero imports** from `platformer/`, `level/`, `editor/`,
 * `collectibles/`, or any consumer game. It is the generic foundation upon
 * which consumer-specific adapters (e.g. platformer level verification) are
 * built.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// SimulationOutcome
// ---------------------------------------------------------------------------

/**
 * The result of calling `adapter.outcome(state)` after a step.
 *
 * - `'running'` — simulation has not yet terminated.
 * - `'success'` — scenario has been solved (win condition met).
 * - `'failure'` — scenario has been lost (death, softlock, unrecoverable).
 */
export type SimulationOutcome = 'running' | 'success' | 'failure';

// ---------------------------------------------------------------------------
// SimulationTermination
// ---------------------------------------------------------------------------

/**
 * Why a simulation run stopped.
 *
 * - `'success'` — `adapter.outcome()` returned `'success'`.
 * - `'failure'` — `adapter.outcome()` returned `'failure'`.
 * - `'tick-budget'` — run exhausted `maxTicks` without termination.
 * - `'policy-stop'` — policy returned `undefined` or chose an action not in
 *   the adapter's offered actions list. Also covers thrown policy callbacks.
 * - `'adapter-error'` — an adapter callback (`createInitialState`, `actions`,
 *   `step`, or `outcome`) threw.
 */
export type SimulationTermination =
  | 'success'
  | 'failure'
  | 'tick-budget'
  | 'policy-stop'
  | 'adapter-error';

// ---------------------------------------------------------------------------
// SimulationPolicyContext
// ---------------------------------------------------------------------------

/**
 * Context passed to a policy function each tick.
 *
 * @typeParam TAction - The action type for the simulation.
 */
export interface SimulationPolicyContext<TAction> {
  /** Current tick index (0-based). */
  readonly tick: number;
  /** Fixed simulation timestep in seconds (e.g. `1/60`). */
  readonly fixedDt: number;
  /** Seed used for this simulation run. */
  readonly seed: number;
  /** Actions the adapter offers this tick. */
  readonly actions: readonly TAction[];
}

// ---------------------------------------------------------------------------
// SimulationPolicy
// ---------------------------------------------------------------------------

/**
 * A deterministic policy that selects an action each tick, or returns
 * `undefined` to signal "cannot continue" (policy stop).
 *
 * Policies must be pure: same `(state, context)` → same action every time.
 * The runner catches thrown policies and converts them to `inconclusive`
 * diagnostics.
 *
 * @typeParam TState  - Simulation state type.
 * @typeParam TAction - Action type (must be canonical-JSON serializable).
 * @param state   - Current simulation state (read-only).
 * @param context - Context with tick, fixedDt, seed, and available actions.
 * @returns The chosen action, or `undefined` to stop.
 */
export type SimulationPolicy<TState, TAction> = (
  state: Readonly<TState>,
  context: Readonly<SimulationPolicyContext<TAction>>,
) => TAction | undefined;

// ---------------------------------------------------------------------------
// SimulationTrace
// ---------------------------------------------------------------------------

/**
 * A recorded trace of actions taken during a simulation run.
 *
 * The trace is separate from the platformer `Replay` type. It records only
 * the action stream plus the adapter identity that produced the state
 * transitions. The state itself is not serialized — it is recreateable from
 * the seed + adapter.
 *
 * `TAction` must be canonical-JSON serializable.
 *
 * @typeParam TAction - Action type.
 */
export interface SimulationTrace<TAction> {
  /** Schema version. Must be `1`. */
  readonly version: 1;
  /** Adapter identifier (e.g. `"platformer-level"`). */
  readonly adapterId: string;
  /** Adapter behavior version. Bump when step/outcome semantics change. */
  readonly adapterVersion: number;
  /** Fingerprint binding this trace to the exact world/config being tested. */
  readonly scenarioFingerprint: string;
  /** Seed used to create the initial state. */
  readonly seed: number;
  /** Fixed timestep used during simulation. */
  readonly fixedDt: number;
  /** The recorded action stream, in tick order. */
  readonly actions: readonly TAction[];
}

// ---------------------------------------------------------------------------
// SimulationRunResult
// ---------------------------------------------------------------------------

/**
 * The complete result of a single policy run.
 *
 * @typeParam TAction - Action type.
 */
export interface SimulationRunResult<TAction> {
  /** Schema version. Must be `1`. */
  readonly version: 1;
  /** Why the run terminated. */
  readonly termination: SimulationTermination;
  /** How many ticks were executed before termination. */
  readonly ticks: number;
  /** The recorded action trace. */
  readonly trace: SimulationTrace<TAction>;
  /**
   * Optional canonical-JSON summary of the final state for reports and
   * quality metrics. Produced by `adapter.summarize()` if provided.
   */
  readonly summary?: Readonly<Record<string, unknown>>;
  /** Diagnostics collected during the run. */
  readonly diagnostics: readonly SimulationDiagnostic[];
}

// ---------------------------------------------------------------------------
// ScenarioVerificationResult
// ---------------------------------------------------------------------------

/**
 * The aggregated result of running one or more policies against a scenario.
 *
 * - `'proven-success'`: at least one policy produced a successful outcome.
 * - `'inconclusive'`: no policy succeeded. This does **not** mean the
 *   scenario is impossible — only that the bounded, supplied policies could
 *   not find a solution.
 *
 * @typeParam TAction - Action type.
 */
export interface ScenarioVerificationResult<TAction> {
  /** Schema version. Must be `1`. */
  readonly version: 1;
  /** Overall verification status. */
  readonly status: 'proven-success' | 'inconclusive';
  /** Results for each policy run (in policy order). */
  readonly runs: readonly SimulationRunResult<TAction>[];
  /** The winning trace, if `status === 'proven-success'`. */
  readonly winningTrace?: SimulationTrace<TAction>;
  /** Deterministic hash of the winning trace, if available. */
  readonly winningTraceHash?: number;
  /** Top-level diagnostics (e.g. missing policies). */
  readonly diagnostics: readonly SimulationDiagnostic[];
}

// ---------------------------------------------------------------------------
// ScenarioTestConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for a scenario verification run.
 *
 * All numeric fields have defaults when omitted:
 * - `seed = 0`
 * - `fixedDt = 1/60`
 * - `maxTicks = 6000`
 *
 * @typeParam TState  - Simulation state type.
 * @typeParam TAction - Action type.
 */
export interface ScenarioTestConfig<TState, TAction> {
  /** Seed for deterministic initial state creation. Default `0`. */
  readonly seed?: number;
  /** Fixed simulation timestep in seconds. Default `1/60`. */
  readonly fixedDt?: number;
  /** Maximum ticks before the run is terminated. Default `6000`. */
  readonly maxTicks?: number;
  /**
   * Policies to evaluate, in order. At least one policy is required;
   * an empty array produces `inconclusive` with a diagnostic.
   */
  readonly policies: readonly SimulationPolicy<TState, TAction>[];
}

// ---------------------------------------------------------------------------
// SimulationPlaybackResult
// ---------------------------------------------------------------------------

/**
 * The result of replaying a recorded trace via `playSimulationTrace`.
 *
 * @typeParam TState - Simulation state type.
 */
export interface SimulationPlaybackResult<TState> {
  /**
   * Whether the trace was valid against the adapter. `false` when:
   * - adapter id/version/fingerprint mismatch.
   * - the trace input is null or non-object.
   * - an adapter callback throws during replay.
   */
  readonly valid: boolean;
  /** Final simulation state after replaying all actions (if validation passed). */
  readonly state?: TState;
  /** Outcome of the final state (if validation passed). */
  readonly outcome?: SimulationOutcome;
  /** Diagnostics collected during playback. */
  readonly diagnostics: readonly SimulationDiagnostic[];
}

// ---------------------------------------------------------------------------
// SimulationDiagnostic
// ---------------------------------------------------------------------------

/**
 * A diagnostic message from a simulation run.
 *
 * Three severity levels:
 * - `'info'` — notable but not problematic (e.g. policy-stop signal).
 * - `'warning'` — unexpected but not blocking (e.g. tick-budget exhaustion).
 * - `'error'` — a failure that invalidates the run (e.g. adapter throw).
 */
export interface SimulationDiagnostic {
  /** Severity of the diagnostic. */
  readonly severity: 'info' | 'warning' | 'error';
  /** Machine-readable code (e.g. `'ADAPTER_STEP_ERROR'`). */
  readonly code: string;
  /** Human-readable message describing the issue. */
  readonly message: string;
  /** Tick at which the diagnostic occurred, if applicable. */
  readonly tick?: number;
}

// ---------------------------------------------------------------------------
// SimulationAdapter
// ---------------------------------------------------------------------------

/**
 * A generic adapter that defines a simulation world.
 *
 * Implement this interface to connect the generic simulation runner to a
 * specific game or scenario (e.g. platformer levels, gravity-flip puzzles,
 * top-down stealth).
 *
 * All adapter callbacks MUST be pure (deterministic, no side effects) for
 * the determinism contract to hold. The runner wraps each callback in a
 * try/catch and converts thrown errors into `adapter-error` terminations
 * with diagnostics.
 *
 * @typeParam TState  - Simulation state type (need not be serializable).
 * @typeParam TAction - Action type (must be canonical-JSON serializable).
 */
export interface SimulationAdapter<TState, TAction> {
  /**
   * Stable adapter family identifier, e.g. `"platformer-level"`.
   * Used to bind traces to the correct adapter family.
   */
  readonly id: string;

  /**
   * Adapter behavior version. Bump when `step`, `outcome`, or action
   * semantics change. Used to reject traces from older/newer adapter
   * versions during playback.
   */
  readonly version: number;

  /**
   * Fingerprint binding traces to the exact world/config being tested.
   * Typically a hash of level data, config, or adapter parameters.
   * Changes when the underlying world changes, even if the adapter
   * version stays the same.
   */
  readonly scenarioFingerprint: string;

  /**
   * Create the initial simulation state from a deterministic seed.
   *
   * **Must be pure:** same `seed` → same state, every time.
   *
   * @param seed - Deterministic seed for any procedural setup.
   * @returns The initial simulation state.
   */
  createInitialState(seed: number): TState;

  /**
   * Return the set of valid actions the policy may choose from at the
   * current state. The returned list may vary per tick based on state.
   *
   * @param state - Current simulation state (read-only).
   * @returns Available actions this tick.
   */
  actions(state: Readonly<TState>): readonly TAction[];

  /**
   * Advance the simulation by one tick given the chosen action.
   *
   * **Must be pure:** same `(state, action, fixedDt)` → same next state.
   *
   * @param state   - Current simulation state (read-only).
   * @param action  - The chosen action (read-only).
   * @param fixedDt - Fixed timestep for this tick.
   * @returns The new simulation state.
   */
  step(state: Readonly<TState>, action: Readonly<TAction>, fixedDt: number): TState;

  /**
   * Check whether the simulation has reached a terminal outcome.
   *
   * @param state - Current simulation state (read-only).
   * @returns `'running'`, `'success'`, or `'failure'`.
   */
  outcome(state: Readonly<TState>): SimulationOutcome;

  /**
   * Optional stable search/deduplication key for the current state.
   * Consumers may use this to detect loops or revisitied states.
   *
   * @param state - Current simulation state (read-only).
   * @returns A string key for this state.
   */
  stateKey?(state: Readonly<TState>): string;

  /**
   * Optional canonical-JSON summary of the final state for reports and
   * quality metrics. Called once at run termination.
   *
   * @param state - Final simulation state (read-only).
   * @returns A plain record of summary values.
   */
  summarize?(state: Readonly<TState>): Readonly<Record<string, unknown>>;
}
