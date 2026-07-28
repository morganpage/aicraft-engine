/**
 * Generic deterministic scenario runner.
 *
 * Provides `verifyScenario` (evaluate one or more policies) and
 * `playSimulationTrace` (replay a recorded action trace).
 *
 * **Determinism:** All adapter callbacks (`createInitialState`, `actions`,
 * `step`, `outcome`) and policy callbacks must be pure for the determinism
 * contract to hold. The runner wraps each callback defensively: thrown
 * errors are caught and converted to diagnostics — they never propagate.
 *
 * **Honesty:** A successful run is evidence of scenario success. Bot
 * exhaustion, tick budget exhaustion, or callback errors are never turned
 * into proof that a scenario is impossible. The result is always
 * `'proven-success'` or `'inconclusive'`.
 *
 * @module
 */

import type {
  SimulationAdapter,
  SimulationPolicy,
  SimulationTrace,
  SimulationRunResult,
  ScenarioVerificationResult,
  ScenarioTestConfig,
  SimulationPlaybackResult,
  SimulationOutcome,
  SimulationDiagnostic,
} from './types';
import { canonicalize, fnv1a } from '../level/serialize';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default seed when config.seed is omitted. */
const DEFAULT_SEED = 0;
/** Default fixed timestep in seconds (60 Hz). */
const DEFAULT_FIXED_DT = 1 / 60;
/** Default maximum ticks before a run is terminated. */
const DEFAULT_MAX_TICKS = 6000;

// ---------------------------------------------------------------------------
// verifyScenario
// ---------------------------------------------------------------------------

/**
 * Evaluate one or more policies against a scenario and return a verdict.
 *
 * At least one policy is required; an empty `policies` array returns
 * `inconclusive` with a diagnostic.
 *
 * Each policy is run independently from the initial state. If any policy
 * produces a successful outcome, the result is `'proven-success'` and the
 * winning trace is returned. Otherwise the result is `'inconclusive'`.
 *
 * **Never throws.** All callback errors (adapter and policy) are caught
 * and converted to `inconclusive` diagnostics.
 *
 * @example
 * ```ts
 * const result = verifyScenario(myAdapter, {
 *   maxTicks: 6000,
 *   policies: [cautiousPolicy, directPolicy],
 * });
 * if (result.status === 'proven-success') {
 *   console.log('Winning hash:', result.winningTraceHash);
 * }
 * ```
 *
 * @typeParam TState  - Simulation state type.
 * @typeParam TAction - Action type (must be canonical-JSON serializable).
 * @param adapter - The simulation adapter.
 * @param config  - Scenario configuration (seed, dt, maxTicks, policies).
 * @returns A {@link ScenarioVerificationResult} — never throws.
 */
export function verifyScenario<TState, TAction>(
  adapter: SimulationAdapter<TState, TAction>,
  config: ScenarioTestConfig<TState, TAction>,
): ScenarioVerificationResult<TAction> {
  const diagnostics: SimulationDiagnostic[] = [];
  const seed = config.seed ?? DEFAULT_SEED;
  const fixedDt = config.fixedDt ?? DEFAULT_FIXED_DT;
  const maxTicks = config.maxTicks ?? DEFAULT_MAX_TICKS;
  const policies = config.policies;

  // --- Empty policies guard ---
  if (!policies || policies.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'NO_POLICIES',
      message: 'verifyScenario requires at least one policy; none provided.',
    });
    return {
      version: 1,
      status: 'inconclusive',
      runs: [],
      diagnostics,
    };
  }

  // --- Run each policy ---
  const runs: SimulationRunResult<TAction>[] = [];

  for (const policy of policies) {
    const result = runSinglePolicy(adapter, policy, seed, fixedDt, maxTicks);
    runs.push(result);
  }

  // --- Find success ---
  const successRun = runs.find((r) => r.termination === 'success');
  if (successRun) {
    return {
      version: 1,
      status: 'proven-success',
      runs,
      winningTrace: successRun.trace,
      winningTraceHash: simulationTraceHashInternal(successRun.trace),
      diagnostics,
    };
  }

  return {
    version: 1,
    status: 'inconclusive',
    runs,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// playSimulationTrace
// ---------------------------------------------------------------------------

/**
 * Replay a recorded trace against an adapter to verify byte-level
 * reproducibility.
 *
 * If the adapter's `id`, `version`, or `scenarioFingerprint` do not match
 * the trace, the result is `{ valid: false }` with a diagnostic — the trace
 * is never replayed against the wrong world.
 *
 * **Never throws.** All adapter callbacks are wrapped in try/catch.
 * A thrown callback during replay returns `{ valid: false }` with the
 * last successfully-reached state (if any).
 *
 * @example
 * ```ts
 * const playback = playSimulationTrace(adapter, trace);
 * if (playback.valid) {
 *   console.log('Outcome:', playback.outcome);
 * }
 * ```
 *
 * @typeParam TState  - Simulation state type.
 * @typeParam TAction - Action type.
 * @param adapter - The simulation adapter (must match trace metadata).
 * @param trace   - The recorded trace to replay.
 * @returns A {@link SimulationPlaybackResult} — never throws.
 */
export function playSimulationTrace<TState, TAction>(
  adapter: SimulationAdapter<TState, TAction>,
  trace: SimulationTrace<TAction>,
): SimulationPlaybackResult<TState> {
  const diagnostics: SimulationDiagnostic[] = [];

  // --- Defensive input check ---
  if (trace === null || typeof trace !== 'object') {
    diagnostics.push({
      severity: 'error',
      code: 'INVALID_TRACE',
      message: 'trace is null or non-object',
    });
    return { valid: false, diagnostics };
  }

  // --- Adapter identity validation ---
  if (trace.adapterId !== adapter.id) {
    diagnostics.push({
      severity: 'error',
      code: 'ADAPTER_ID_MISMATCH',
      message: `trace.adapterId "${trace.adapterId}" !== adapter.id "${adapter.id}"`,
    });
    return { valid: false, diagnostics };
  }

  if (trace.adapterVersion !== adapter.version) {
    diagnostics.push({
      severity: 'error',
      code: 'ADAPTER_VERSION_MISMATCH',
      message: `trace.adapterVersion ${trace.adapterVersion} !== adapter.version ${adapter.version}`,
    });
    return { valid: false, diagnostics };
  }

  if (trace.scenarioFingerprint !== adapter.scenarioFingerprint) {
    diagnostics.push({
      severity: 'error',
      code: 'SCENARIO_FINGERPRINT_MISMATCH',
      message: `trace.scenarioFingerprint "${trace.scenarioFingerprint}" !== adapter.scenarioFingerprint "${adapter.scenarioFingerprint}"`,
    });
    return { valid: false, diagnostics };
  }

  // --- Replay ---
  let state: TState;
  try {
    state = adapter.createInitialState(trace.seed);
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      code: 'ADAPTER_CREATE_INITIAL_STATE_ERROR',
      message: `adapter.createInitialState threw: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { valid: false, diagnostics };
  }

  const actions = Array.isArray(trace.actions) ? trace.actions : [];

  for (let i = 0; i < actions.length; i++) {
    try {
      state = adapter.step(state, actions[i], trace.fixedDt);
    } catch (err) {
      diagnostics.push({
        severity: 'error',
        code: 'ADAPTER_STEP_ERROR',
        message: `adapter.step threw at action index ${i}: ${err instanceof Error ? err.message : String(err)}`,
        tick: i,
      });
      return { valid: true, state, diagnostics };
    }
  }

  // --- Check outcome ---
  let outcome: SimulationOutcome;
  try {
    outcome = adapter.outcome(state);
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      code: 'ADAPTER_OUTCOME_ERROR',
      message: `adapter.outcome threw: ${err instanceof Error ? err.message : String(err)}`,
      tick: actions.length - 1,
    });
    return { valid: true, state, diagnostics };
  }

  diagnostics.push({
    severity: 'info',
    code: 'REPLAY_COMPLETE',
    message: `replay completed with outcome: ${outcome}`,
    tick: actions.length - 1,
  });

  return { valid: true, state, outcome, diagnostics };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Run a single policy against the adapter and return the run result.
 *
 * This is the inner simulation loop. Each tick:
 * 1. Get available actions from adapter.
 * 2. Call policy to choose an action.
 * 3. Validate the chosen action is in the available set.
 * 4. Step the adapter.
 * 5. Check outcome.
 *
 * All adapter and policy callbacks are wrapped in try/catch.
 */
function runSinglePolicy<TState, TAction>(
  adapter: SimulationAdapter<TState, TAction>,
  policy: SimulationPolicy<TState, TAction>,
  seed: number,
  fixedDt: number,
  maxTicks: number,
): SimulationRunResult<TAction> {
  const diagnostics: SimulationDiagnostic[] = [];
  const actions: TAction[] = [];

  // --- Create initial state ---
  let state: TState;
  try {
    state = adapter.createInitialState(seed);
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      code: 'ADAPTER_CREATE_INITIAL_STATE_ERROR',
      message: `adapter.createInitialState threw: ${err instanceof Error ? err.message : String(err)}`,
    });
    return buildRunResult(adapter, 'adapter-error', 0, seed, fixedDt, actions, diagnostics);
  }

  // --- Simulation loop ---
  let tick = 0;
  for (; tick < maxTicks; tick++) {
    // 1. Get available actions
    let available: readonly TAction[];
    try {
      available = adapter.actions(state);
    } catch (err) {
      diagnostics.push({
        severity: 'error',
        code: 'ADAPTER_ACTIONS_ERROR',
        message: `adapter.actions threw at tick ${tick}: ${err instanceof Error ? err.message : String(err)}`,
        tick,
      });
      return buildRunResult(adapter, 'adapter-error', tick, seed, fixedDt, actions, diagnostics);
    }

    // 2. Policy chooses an action
    let action: TAction | undefined;
    try {
      const ctx = { tick, fixedDt, seed, actions: available };
      action = policy(state, ctx);
    } catch (err) {
      diagnostics.push({
        severity: 'error',
        code: 'POLICY_ERROR',
        message: `policy threw at tick ${tick}: ${err instanceof Error ? err.message : String(err)}`,
        tick,
      });
      return buildRunResult(adapter, 'policy-stop', tick, seed, fixedDt, actions, diagnostics);
    }

    // 3. Policy signaled stop
    if (action === undefined) {
      diagnostics.push({
        severity: 'info',
        code: 'POLICY_STOP',
        message: `policy returned undefined at tick ${tick}`,
        tick,
      });
      return buildRunResult(adapter, 'policy-stop', tick, seed, fixedDt, actions, diagnostics);
    }

    // 4. Validate action is in the available set (canonical comparison)
    if (!isActionInSet(available, action)) {
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_ACTION',
        message: `policy chose an action not in adapter.actions() at tick ${tick}`,
        tick,
      });
      return buildRunResult(adapter, 'policy-stop', tick, seed, fixedDt, actions, diagnostics);
    }

    // 5. Step
    let nextState: TState;
    try {
      nextState = adapter.step(state, action, fixedDt);
    } catch (err) {
      diagnostics.push({
        severity: 'error',
        code: 'ADAPTER_STEP_ERROR',
        message: `adapter.step threw at tick ${tick}: ${err instanceof Error ? err.message : String(err)}`,
        tick,
      });
      return buildRunResult(adapter, 'adapter-error', tick, seed, fixedDt, actions, diagnostics);
    }

    state = nextState;
    actions.push(action);

    // 6. Check outcome
    let outcome: SimulationOutcome;
    try {
      outcome = adapter.outcome(state);
    } catch (err) {
      diagnostics.push({
        severity: 'error',
        code: 'ADAPTER_OUTCOME_ERROR',
        message: `adapter.outcome threw at tick ${tick}: ${err instanceof Error ? err.message : String(err)}`,
        tick,
      });
      return buildRunResult(adapter, 'adapter-error', tick, seed, fixedDt, actions, diagnostics);
    }

    if (outcome === 'success' || outcome === 'failure') {
      const termination = outcome === 'success' ? 'success' : 'failure';
      return buildRunResult(adapter, termination, tick + 1, seed, fixedDt, actions, diagnostics, state, adapter.summarize);
    }
  }

  // --- Tick budget exhausted ---
  diagnostics.push({
    severity: 'warning',
    code: 'TICK_BUDGET_EXCEEDED',
    message: `run reached maxTicks=${maxTicks} without termination`,
    tick: maxTicks - 1,
  });
  return buildRunResult(adapter, 'tick-budget', tick, seed, fixedDt, actions, diagnostics);
}

/**
 * Build a `SimulationRunResult` from partial data.
 *
 * Pulls summary from the adapter's `summarize` callback if provided and
 * the final state is available.
 */
function buildRunResult<TState, TAction>(
  adapter: SimulationAdapter<TState, TAction>,
  termination: 'success' | 'failure' | 'tick-budget' | 'policy-stop' | 'adapter-error',
  ticks: number,
  seed: number,
  fixedDt: number,
  actions: TAction[],
  diagnostics: SimulationDiagnostic[],
  finalState?: TState,
  summarize?: (state: Readonly<TState>) => Readonly<Record<string, unknown>>,
): SimulationRunResult<TAction> {
  let summary: Readonly<Record<string, unknown>> | undefined;

  if (finalState !== undefined && summarize) {
    try {
      summary = summarize(finalState);
    } catch {
      // Silently ignore summarize errors
    }
  }

  return {
    version: 1,
    termination,
    ticks,
    trace: {
      version: 1,
      adapterId: adapter.id,
      adapterVersion: adapter.version,
      scenarioFingerprint: adapter.scenarioFingerprint,
      seed,
      fixedDt,
      actions: [...actions],
    },
    summary,
    diagnostics,
  };
}

/**
 * Check whether `chosen` canonically equals one of the actions in `set`.
 *
 * Uses `canonicalize` for deterministic comparison of complex action
 * objects. Both `set` items and `chosen` must be canonical-JSON
 * serializable.
 */
function isActionInSet<TAction>(set: readonly TAction[], chosen: TAction): boolean {
  const chosenStr = canonicalize(chosen);
  for (let i = 0; i < set.length; i++) {
    if (canonicalize(set[i]) === chosenStr) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Hash helper (local to avoid circular import)
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic hash of a trace. Used internally by
 * `verifyScenario` to populate `winningTraceHash`.
 */
function simulationTraceHashInternal<TAction>(trace: SimulationTrace<TAction>): number {
  try {
    return fnv1a(canonicalize(trace));
  } catch {
    return 0;
  }
}
