/**
 * Platformer-level verification — the canonical tri-state verification entry
 * point.
 *
 * `verifyLevel` is the combined verification pipeline:
 * 1. Validate the level structurally
 * 2. Compile the level into runtime format
 * 3. Run static reachability analysis
 * 4. Create a platformer simulation adapter
 * 5. Run bounded bot-policy simulation
 * 6. Map winning traces to `Replay` format
 * 7. Return a tri-state `VerificationResult`
 *
 * **Determinism:** All functions are pure — same `(level, config)` → same
 * output, forever. No `Math.random`, no `Date.now()`, no DOM reads, no
 * global mutable state. Never throw (degrade gracefully on malformed input).
 *
 * **Honesty rules:**
 * - A successful bot trace → `'proven-beatable'` with winning replay.
 * - Static over-approximation failure → `'proven-unreachable'`.
 * - Bot exhaustion → `'inconclusive'` (not proof of impossibility).
 * - Structural validation failure → `'inconclusive'`.
 *
 * @module
 */

import type { Replay, ReplayConfig } from '../replay/types';
import { replayHash } from '../replay/hash';
import { CURRENT_PHYSICS_VERSION } from '../replay/constants';
import type { LevelData, ValidationResult } from '../level/types';
import type { CompileLevelOptions, CompiledLevel } from '../platformer/level-runtime';
import { compileLevel } from '../platformer/level-runtime';
import type { PlatformerInput } from '../platformer/types';
import type {
  SimulationTrace,
  SimulationPolicy,
  ScenarioVerificationResult,
} from '../simtest/types';
import { verifyScenario } from '../simtest/runner';
import { validateLevel } from '../level/validate';
import { analyzeReachability } from './reachability';
import type { ReachabilityResult } from './types';
import { createPlatformerAdapter } from './adapter';
import type { PlatformerSimulationState } from './adapter';
import type { WinCondition } from './win-conditions';
import { DEFAULT_WIN_CONDITION } from './win-conditions';
import { DEFAULT_BOT_POLICIES } from './policies';
import type { BotPolicy, BotContext } from './policies';
import { DEFAULT_JUMP } from '../animation/jump';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Tri-state verification status for a platformer level.
 *
 * - `'proven-beatable'`: a bot produced a winning replay under the
 *   authoritative fixed-step kernel.
 * - `'proven-unreachable'`: a sound static over-approximation found no
 *   possible route to any non-trap exit.
 * - `'inconclusive'`: neither proved nor disproved — the pipeline could
 *   not determine beatability (bot exhaustion, unsupported mechanics,
 *   structural issues, etc.).
 */
export type VerificationStatus =
  | 'proven-beatable'
  | 'proven-unreachable'
  | 'inconclusive';

/**
 * Configuration for {@link verifyLevel} and {@link verifyCompiledLevel}.
 *
 * All fields have sensible defaults:
 * - `compileOptions`: empty (uses default player dimensions and config)
 * - `fixedDt`: `1/60` (60 Hz)
 * - `maxTicks`: `6000` (100 seconds at 60 Hz)
 * - `policies`: {@link DEFAULT_BOT_POLICIES} (cautious, direct, collector)
 * - `seed`: `0`
 * - `winCondition`: {@link DEFAULT_WIN_CONDITION} (reach any non-trap exit)
 * - `verifySoftlocks`: `false`
 */
export interface LevelTestConfig {
  /** Compile options (player dimensions, config, tile type map). */
  readonly compileOptions?: Readonly<CompileLevelOptions>;
  /** Fixed simulation timestep in seconds. Default `1/60`. */
  readonly fixedDt?: number;
  /** Maximum ticks per policy run. Default `6000`. */
  readonly maxTicks?: number;
  /** Bot policies to evaluate. Default {@link DEFAULT_BOT_POLICIES}. */
  readonly policies?: readonly BotPolicy[];
  /** Seed for deterministic initial state. Default `0`. */
  readonly seed?: number;
  /** Win condition predicate. Default {@link DEFAULT_WIN_CONDITION}. */
  readonly winCondition?: WinCondition;
  /** If `true`, run softlock detection in reachability analysis. Default `false`. */
  readonly verifySoftlocks?: boolean;
}

/**
 * The complete result of a level verification.
 */
export interface VerificationResult {
  /** Schema version. Must be `1`. */
  readonly version: 1;
  /** Tri-state verification status. */
  readonly status: VerificationStatus;
  /** Structural validation result. */
  readonly structural: ValidationResult;
  /** Static reachability analysis result. */
  readonly reachability: ReachabilityResult;
  /** Generic simulation scenario result. */
  readonly scenario: ScenarioVerificationResult<PlatformerInput>;
  /**
   * Winning replay, if `status === 'proven-beatable'`.
   * Maps the generic winning trace to the existing `Replay` format.
   */
  readonly winningReplay?: Replay;
  /**
   * Deterministic hash of the winning replay, if `status === 'proven-beatable'`.
   * Computed via `replayHash`.
   */
  readonly winningReplayHash?: number;
  /** Verification diagnostics. */
  readonly diagnostics: readonly VerificationDiagnostic[];
}

/**
 * A diagnostic message produced during the verification pipeline.
 */
export interface VerificationDiagnostic {
  /** Severity of the diagnostic. */
  readonly severity: 'info' | 'warning' | 'error';
  /** Machine-readable code (e.g. `'VALIDATION_ERROR'`). */
  readonly code: string;
  /** Human-readable message. */
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default seed when `config.seed` is omitted. */
const DEFAULT_SEED = 0;

// ---------------------------------------------------------------------------
// Shared pipeline (used by both verifyLevel and verifyCompiledLevel)
// ---------------------------------------------------------------------------

/**
 * Internal shared verification pipeline.
 *
 * Performs steps 3–7 given a level, its compiled form, and config.
 * Steps 1 (validation) and 2 (compilation) are handled by the caller
 * so `verifyCompiledLevel` can skip compilation.
 */
function runVerificationPipeline(
  level: LevelData,
  compiled: CompiledLevel,
  structural: ValidationResult,
  config: LevelTestConfig,
): VerificationResult {
  const diagnostics: VerificationDiagnostic[] = [];

  // -----------------------------------------------------------------------
  // Step 3: Static reachability analysis
  // -----------------------------------------------------------------------
  let reachability: ReachabilityResult;
  try {
    reachability = analyzeReachability(level, {
      verifySoftlocks: config.verifySoftlocks,
    });
  } catch {
    reachability = {
      version: 1,
      confidence: 'unsupported',
      reachable: false,
      graph: { surfaces: [], edges: [] },
      spawnSurface: null,
      exitSurfaces: [],
      reachableSurfaces: [],
      softlockSurfaces: [],
      diagnostics: ['Reachability analysis failed.'],
    };
    diagnostics.push({
      severity: 'warning',
      code: 'REACHABILITY_ERROR',
      message: 'Static reachability analysis encountered an error.',
    });
  }

  // -----------------------------------------------------------------------
  // Step 4: Create adapter and wrap policies
  // -----------------------------------------------------------------------
  const adapter = createPlatformerAdapter(compiled, level, config);
  const policies: readonly BotPolicy[] = config.policies ?? DEFAULT_BOT_POLICIES;

  const wrappedPolicies: readonly SimulationPolicy<
    PlatformerSimulationState,
    PlatformerInput
  >[] = policies.map((botPolicy) => {
    return (
      simState: Readonly<PlatformerSimulationState>,
      simContext: {
        readonly tick: number;
        readonly fixedDt: number;
        readonly seed: number;
        readonly actions: readonly PlatformerInput[];
      },
    ): PlatformerInput | undefined => {
      try {
        const botCtx: BotContext = {
          entities: level.entities ?? [],
          solids: compiled.staticSolids,
          movingPlatforms: compiled.movingPlatforms,
          tick: simContext.tick,
          dt: simContext.fixedDt,
          jumpConfig: config.compileOptions?.config?.jump ?? DEFAULT_JUMP,
          save: simState.save,
        };
        return botPolicy(simState.platformerState, botCtx);
      } catch {
        // Never throw from the policy wrapper — return idle input
        return { moveX: 0, jump: { held: false, pressed: false, released: false }, dash: { held: false, pressed: false, released: false } };
      }
    };
  });

  // -----------------------------------------------------------------------
  // Step 5: Run scenario verification
  // -----------------------------------------------------------------------
  let scenario: ScenarioVerificationResult<PlatformerInput>;
  try {
    scenario = verifyScenario(adapter, {
      seed: config.seed ?? DEFAULT_SEED,
      fixedDt: config.fixedDt,
      maxTicks: config.maxTicks,
      policies: wrappedPolicies,
    });
  } catch {
    scenario = {
      version: 1,
      status: 'inconclusive',
      runs: [],
      diagnostics: [
        {
          severity: 'error' as const,
          code: 'SCENARIO_ERROR',
          message: 'verifyScenario threw unexpectedly.',
        },
      ],
    };
  }

  // -----------------------------------------------------------------------
  // Step 6: Map winning trace to Replay, if applicable
  // -----------------------------------------------------------------------
  let winningReplay: Replay | undefined;
  let winningReplayHashValue: number | undefined;

  if (scenario.status === 'proven-success' && scenario.winningTrace) {
    try {
      const trace: SimulationTrace<PlatformerInput> = scenario.winningTrace;
      const initial = JSON.parse(JSON.stringify(compiled.initialState));
      const safeDt = config.fixedDt ?? 1 / 60;
      const tickRate = Math.round(1 / safeDt);

      // Build a frozen Replay from the simulation trace
      winningReplay = Object.freeze({
        seed: trace.seed,
        initial,
        frames: (trace.actions as unknown) as any,
        config: Object.freeze({ tickRate, physicsVersion: CURRENT_PHYSICS_VERSION } as ReplayConfig),
      }) as unknown as Replay;

      winningReplayHashValue = replayHash(winningReplay);
    } catch {
      diagnostics.push({
        severity: 'warning',
        code: 'REPLAY_MAP_ERROR',
        message: 'Failed to map winning trace to Replay format.',
      });
    }
  }

  // -----------------------------------------------------------------------
  // Step 7: Determine final status
  // -----------------------------------------------------------------------
  let status: VerificationStatus;

  if (!structural.valid) {
    status = 'inconclusive';
    if (!diagnostics.some((d) => d.code === 'VALIDATION_ERROR')) {
      diagnostics.push({
        severity: 'info',
        code: 'STATUS_INCONCLUSIVE',
        message:
          'Status is inconclusive due to structural validation failure.',
      });
    }
  } else if (
    reachability.confidence === 'sound-over-approximation' &&
    !reachability.reachable &&
    reachability.exitSurfaces.length > 0
  ) {
    status = 'proven-unreachable';
  } else if (scenario.status === 'proven-success') {
    status = 'proven-beatable';
  } else {
    status = 'inconclusive';
    diagnostics.push({
      severity: 'info',
      code: 'STATUS_INCONCLUSIVE',
      message:
        'Verification is inconclusive. Neither a winning replay was found ' +
        'nor static analysis proved unreachability.',
    });
  }

  return {
    version: 1 as const,
    status,
    structural,
    reachability,
    scenario,
    winningReplay,
    winningReplayHash: winningReplayHashValue,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// verifyLevel
// ---------------------------------------------------------------------------

/**
 * Run the full verification pipeline on a platformer level.
 *
 * The pipeline:
 * 1. Validate the level structurally (`validateLevel`).
 * 2. Compile the level (`compileLevel` with supplied compile options).
 * 3. Run static reachability analysis (`analyzeReachability`).
 * 4. Create the platformer simulation adapter.
 * 5. Run `verifyScenario` with configured bot policies.
 * 6. Map winning traces to `Replay` format and compute `replayHash`.
 * 7. Determine final tri-state status.
 *
 * **Never throws.** All errors are caught and converted to diagnostics.
 *
 * @example
 * ```ts
 * const result = verifyLevel(levelData);
 * if (result.status === 'proven-beatable') {
 *   console.log('Level is beatable. Hash:', result.winningReplayHash);
 * } else if (result.status === 'proven-unreachable') {
 *   console.log('Level is impossible (static analysis).');
 * } else {
 *   console.log('Result inconclusive. Diagnostics:', result.diagnostics);
 * }
 * ```
 *
 * @param level  - The level data to verify.
 * @param config - Optional verification configuration.
 * @returns A {@link VerificationResult} — never throws.
 */
export function verifyLevel(
  level: LevelData,
  config?: LevelTestConfig,
): VerificationResult {
  const cfg: LevelTestConfig = config ?? {};

  // -----------------------------------------------------------------------
  // Step 1: Structural validation
  // -----------------------------------------------------------------------
  let structural: ValidationResult;
  try {
    structural = validateLevel(level);
  } catch {
    structural = { valid: false, errors: [] };
  }

  // -----------------------------------------------------------------------
  // Step 2: Compile
  // -----------------------------------------------------------------------
  let compiled: CompiledLevel;
  try {
    compiled = compileLevel(level, cfg.compileOptions);
  } catch {
    // Minimal compiled level on failure
    compiled = {
      staticSolids: [],
      movingPlatforms: [],
      initialState: null as any,
      tileQuery: () => 'empty' as const,
    };
  }

  return runVerificationPipeline(level, compiled, structural, cfg);
}

// ---------------------------------------------------------------------------
// verifyCompiledLevel
// ---------------------------------------------------------------------------

/**
 * Verify a platformer level that has already been compiled.
 *
 * Same pipeline as {@link verifyLevel} but skips the compilation step and
 * uses the provided `CompiledLevel` directly. Useful when the consumer has
 * already compiled the level (e.g. with custom tile semantics).
 *
 * The static reachability analysis still recompiles the level internally
 * (it needs the compile-time surface extraction), but the simulation
 * adapter uses the provided compiled level directly.
 *
 * **Never throws.** All errors are caught and converted to diagnostics.
 *
 * @example
 * ```ts
 * const compiled = compileGeneratedLevel(generated, tileSemantics);
 * const result = verifyCompiledLevel(levelData, compiled);
 * ```
 *
 * @param level    - The original level data.
 * @param compiled - The pre-compiled level.
 * @param config   - Optional verification config. `compileOptions` is
 *                   accepted but ignored during simulation (the provided
 *                   compiled level is used directly).
 * @returns A {@link VerificationResult} — never throws.
 */
export function verifyCompiledLevel(
  level: LevelData,
  compiled: CompiledLevel,
  config?: Omit<LevelTestConfig, 'compileOptions'>,
): VerificationResult {
  const cfg: LevelTestConfig = { ...config };

  // Step 1: Structural validation
  let structural: ValidationResult;
  try {
    structural = validateLevel(level);
  } catch {
    structural = { valid: false, errors: [] };
  }

  return runVerificationPipeline(level, compiled, structural, cfg);
}
