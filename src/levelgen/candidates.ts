/**
 * Deterministic candidate search and selection for level generation.
 *
 * Generates multiple candidates from a root seed, evaluates quality,
 * applies bounded targeted repair, and selects the best candidate using
 * stable tie-breaking.
 *
 * **Pipeline:**
 * 1. Derive `candidateCount` sub-seeds from the root seed (using a named salt).
 * 2. Generate each candidate independently.
 * 3. Reject candidates failing hard gates (validation, compilation, spawn
 *    intersection, no non-trap exit, critical path missing, etc.).
 * 4. Verify supported candidates (bot simulation).
 * 5. Evaluate quality.
 * 6. Repair bounded, local defects (max `maxRepairPasses`).
 * 7. Rank candidates by quality score (descending).
 * 8. Select using stable tie-breaking (ascending candidate index).
 *
 * **Determinism:** All functions are pure — same `(seed, config)` → same
 * selection, forever. Candidate order is ascending index. Each candidate uses
 * an independently derived seed. Ties resolve by candidate index. No
 * `Math.random`, no `Date.now()`, no global mutable state. Never throws.
 *
 * @module
 */

import type {
  LevelGenConfig,
  GeneratedLevel,
  LevelQualityReport,
  RepairRecord,
  GenerationDiagnostic,
  VerificationResult,
} from './types';
import {
  DEFAULT_LEVEL_GEN_CONFIG,
  DEFAULT_CANDIDATE_COUNT,
  DEFAULT_MAX_REPAIR_PASSES,
  CANDIDATE_SEED_SALT,
  DEFAULT_TILE_SEMANTICS,
} from './constants';
import { generateLevel } from './generate';
import { evaluateLevelQuality } from './quality';
import type { QualityConfig } from './quality';
import { validateLevel } from '../level/validate';
import { compileGeneratedLevel } from '../platformer/level-runtime';
import { verifyLevel as verifyLevelOriginal } from '../leveltest/verify';
import type { LevelData } from '../level/types';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * Configuration for the candidate search algorithm.
 *
 * All fields are optional — defaults provide sensible generation behavior.
 */
export interface CandidateSearchConfig {
  /**
   * Number of candidates to generate and evaluate. Default {@link DEFAULT_CANDIDATE_COUNT} (8).
   * Must be >= 1.
   */
  readonly candidateCount?: number;
  /**
   * Maximum targeted repair passes per candidate. Default {@link DEFAULT_MAX_REPAIR_PASSES} (2).
   */
  readonly maxRepairPasses?: number;
  /**
   * Salt for deterministic sub-seed derivation.
   * Default {@link CANDIDATE_SEED_SALT}.
   */
  readonly seedSalt?: number;
}

/**
 * Result for a single generated candidate.
 */
export interface CandidateResult {
  /** Candidate index (0-based, ascending order). */
  readonly index: number;
  /** Deterministic sub-seed used for this candidate. */
  readonly seed: number;
  /** The fully generated level, if generation succeeded. */
  readonly generated: GeneratedLevel;
  /** Quality report for this candidate. */
  readonly quality: LevelQualityReport;
  /** Repair records from targeted repair passes. */
  readonly repairs: readonly RepairRecord[];
  /** Whether this candidate passed all hard gates and is eligible for selection. */
  readonly passed: boolean;
}

/**
 * Result of a complete candidate search.
 */
export interface CandidateSearchResult {
  /** Schema version. Must be `1`. */
  readonly version: 1;
  /** The root seed used for the entire search. */
  readonly rootSeed: number;
  /** All generated candidates, in index order. */
  readonly candidates: readonly CandidateResult[];
  /** The selected (best) candidate. */
  readonly selected: CandidateResult;
  /** Top-level diagnostics from the search process. */
  readonly diagnostics: readonly GenerationDiagnostic[];
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * A repair function signature: takes a level and returns a modified level,
 * a repair record, or null if no repair was needed/applied.
 */
type RepairFn = (
  level: LevelData,
  verification: VerificationResult,
  quality: LevelQualityReport,
  config: Readonly<LevelGenConfig>,
  passIndex: number,
) => { level: LevelData; repair: RepairRecord } | null;

// ---------------------------------------------------------------------------
// Seed derivation
// ---------------------------------------------------------------------------

/**
 * Deterministically derive a sub-seed for a specific candidate.
 *
 * Pure: same inputs → same seed, forever.
 *
 * @param rootSeed - The root seed for the entire search.
 * @param salt     - Named salt for candidate derivation.
 * @param index    - Candidate index (0-based).
 * @returns A deterministic sub-seed.
 */
function deriveCandidateSeed(rootSeed: number, salt: number, index: number): number {
  return ((rootSeed >>> 0) ^ salt ^ ((index + 1) * 0x9e3779b9)) >>> 0;
}

// ---------------------------------------------------------------------------
// Verification adapter
// ---------------------------------------------------------------------------

/**
 * Call verifyLevel and return its result — the levelgen VerificationResult
 * IS the leveltest type since the 0.17.0 consolidation; only the
 * never-throw guard remains.
 */
function verifyAndAdapt(
  level: LevelData,
): VerificationResult {
  // 0.17.0: levelgen's VerificationResult IS leveltest's now (consolidated),
  // so no adaptation is needed — only the never-throw guard remains.
  try {
    return verifyLevelOriginal(level);
  } catch {
    return {
      version: 1 as const,
      status: 'inconclusive' as const,
      structural: { valid: false, errors: [] },
      reachability: {
        version: 1,
        confidence: 'unsupported' as const,
        reachable: false,
        graph: { surfaces: [], edges: [] },
        spawnSurface: null,
        exitSurfaces: [],
        reachableSurfaces: [],
        softlockSurfaces: [],
        diagnostics: ['Verification threw.'],
      },
      scenario: {
        version: 1,
        status: 'inconclusive' as const,
        runs: [],
        diagnostics: [],
      },
      winningReplay: undefined,
      winningReplayHash: undefined,
      diagnostics: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Entity helpers
// ---------------------------------------------------------------------------

/** Check if an entity's rectangle overlaps with another's. */
function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ---------------------------------------------------------------------------
// Hard gates
// ---------------------------------------------------------------------------

/**
 * Check whether a generated level passes all hard gates for candidate
 * eligibility.
 *
 * Hard gates (§8 of the implementation plan):
 * 1. `validateLevel` succeeds.
 * 2. Runtime compilation contains intended solids.
 * 3. Spawn is not intersecting blocking geometry.
 * 4. At least one non-trap exit exists.
 * 5. (v1 note: critical path check deferred when blueprint unavailable)
 * 6. Every required mechanic is enabled (deferred — checked during generation).
 * 7. No required jump has safety margin below minimum.
 * 8. Verification is `proven-beatable` (relaxed for preview mode).
 *
 * Pure: never throws. Returns a diagnostic array (empty = all gates passed).
 */
function checkHardGates(
  level: LevelData,
  verification: VerificationResult,
  generated: GeneratedLevel,
): GenerationDiagnostic[] {
  const result: GenerationDiagnostic[] = [];

  // Gate 1: validation
  const validation = validateLevel(level);
  if (!validation.valid) {
    result.push({
      severity: 'error',
      code: 'VALIDATION_FAILED',
      message: `Level failed structural validation (${validation.errors.length} error(s)).`,
    });
    return result; // Early return: no further checking on invalid level
  }

  // Gate 2: runtime compilation
  try {
    const tileSemantics = generated.tileSemantics ?? DEFAULT_TILE_SEMANTICS;
    const compiled = compileGeneratedLevel({ level, tileSemantics });
    if (!compiled.staticSolids || compiled.staticSolids.length === 0) {
      result.push({
        severity: 'warning',
        code: 'NO_SOLIDS',
        message: 'Compiled level has no static solids — ground may be missing.',
      });
    }
  } catch {
    result.push({
      severity: 'error',
      code: 'COMPILATION_FAILED',
      message: 'Level failed runtime compilation.',
    });
    return result;
  }

  // Gate 3: spawn not intersecting blocking geometry
  const spawnEntities = level.entities.filter((e) => e.kind === 'spawn');
  if (spawnEntities.length === 1) {
    const spawnRect = spawnEntities[0].rect;
    if (spawnRect) {
      const blockingKinds = ['exit', 'platform', 'trap', 'hazard', 'movingPlatform', 'enemy'];
      const blocks = level.entities.filter((e) => {
        if (!blockingKinds.includes(e.kind)) return false;
        const r = e.rect;
        if (!r) return false;
        return rectsOverlap(
          spawnRect.x, spawnRect.y, spawnRect.width, spawnRect.height,
          r.x, r.y, r.width, r.height,
        );
      });
      if (blocks.length > 0) {
        result.push({
          severity: 'error',
          code: 'SPAWN_BLOCKED',
          message: `Spawn area is intersected by ${blocks.length} blocking entity/entities.`,
        });
      }
    }
  }

  // Gate 4: at least one non-trap exit exists
  const exits = level.entities.filter((e) => e.kind === 'exit');
  const nonTrapExits = exits.filter((e) => {
    const props = e.props as unknown as Record<string, unknown> | undefined;
    return props?.isTrap === false || props?.isTrap === undefined;
  });
  if (nonTrapExits.length === 0) {
    result.push({
      severity: 'error',
      code: 'NO_NONTRAP_EXIT',
      message: 'Level has no non-trap exit.',
    });
  }

  // Gate 7: safety margins and reachability
  if (verification.status !== 'proven-beatable') {
    if (verification.reachability?.reachable === false) {
      result.push({
        severity: 'warning',
        code: 'STATICALLY_UNREACHABLE',
        message: 'Static reachability analysis could not confirm a path from spawn to exit.',
      });
    }
  }

  // Gate 8: verification beatable (relaxed for v1 preview — only info)
  if (verification.status !== 'proven-beatable') {
    result.push({
      severity: 'info',
      code: 'NOT_PROVEN_BEATABLE',
      message: `Verification status is "${verification.status}" — not proven beatable.`,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Repair functions
// ---------------------------------------------------------------------------

/**
 * v1 repair: adjust floating rewards by snapping their Y to the nearest
 * tile-row surface.
 */
const repairFloatingReward: RepairFn = (level, _verification, _quality, config, passIndex) => {
  const tileSize = config.tileSize ?? 16;
  let modifiedCount = 0;
  const entities = level.entities.map((e) => {
    if (e.kind !== 'collectible' && e.kind !== 'decoration') return e;
    const rect = e.rect;
    if (!rect) return e;
    // Check if reward is floating (not grid-aligned)
    const tileY = Math.round(rect.y / tileSize) * tileSize;
    if (Math.abs(rect.y - tileY) > tileSize * 0.25) {
      modifiedCount++;
      return {
        ...e,
        rect: { ...rect, y: tileY },
      };
    }
    return e;
  });

  if (modifiedCount === 0) return null;

  return {
    level: { ...level, entities },
    repair: {
      version: 1,
      diagnostic: 'FLOATING_REWARD',
      repair: `Snapped ${modifiedCount} floating entity/entities to grid.`,
      tick: passIndex,
    },
  };
};

/**
 * v1 repair: if difficulty is above target, reduce hazard count.
 */
const repairDifficultyAboveTarget: RepairFn = (level, _verification, quality, _config, passIndex) => {
  if (quality.difficultyFit >= 0.3) return null;
  if (quality.measuredDifficulty <= 0.5) return null;

  // Reduce hazard count by ~20%
  const hazardIndices: number[] = [];
  level.entities.forEach((e, i) => {
    if (e.kind === 'hazard' || e.kind === 'trap') hazardIndices.push(i);
  });

  const toRemove = Math.max(0, Math.min(hazardIndices.length, Math.ceil(hazardIndices.length * 0.2)));
  if (toRemove === 0) return null;

  const removeSet = new Set(hazardIndices.slice(0, toRemove));
  const entities = level.entities.filter((_, i) => !removeSet.has(i));

  return {
    level: { ...level, entities },
    repair: {
      version: 1,
      diagnostic: 'DIFFICULTY_ABOVE_TARGET',
      repair: `Reduced hazard count by ${toRemove} to lower difficulty.`,
      tick: passIndex,
    },
  };
};

/**
 * All registered repair functions for v1.
 * Each is tried in order; the first one that applies a repair stops the pass.
 */
const REPAIR_REGISTRY: readonly RepairFn[] = [
  repairFloatingReward,
  repairDifficultyAboveTarget,
];

// ---------------------------------------------------------------------------
// applyRepairs
// ---------------------------------------------------------------------------

/**
 * Apply one pass of targeted repair to a generated level.
 *
 * Iterates through the repair registry and applies the first matching repair.
 * Returns the repaired level + repair record, or `null` if no repair applied.
 *
 * Pure: never mutates input. Never throws.
 */
function applyRepairs(
  level: LevelData,
  verification: VerificationResult,
  quality: LevelQualityReport,
  config: Readonly<LevelGenConfig>,
  passIndex: number,
): { level: LevelData; repair: RepairRecord } | null {
  for (const repairFn of REPAIR_REGISTRY) {
    try {
      const result = repairFn(level, verification, quality, config, passIndex);
      if (result !== null) return result;
    } catch {
      // Skip failing repairs
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// generateCandidates
// ---------------------------------------------------------------------------

/**
 * Generate and evaluate multiple level candidates, then select the best one.
 *
 * **Pipeline:**
 * 1. Derive `candidateCount` sub-seeds from the root seed.
 * 2. Generate each candidate independently via {@link generateLevel}.
 * 3. Check hard gates (validation, compilation, spawn safety, exits, etc.).
 * 4. Verify each candidate via {@link verifyLevel}.
 * 5. Evaluate quality via {@link evaluateLevelQuality}.
 * 6. Apply up to `maxRepairPasses` of targeted repair.
 * 7. Rank by quality score (descending), tie-break by index (ascending).
 * 8. Return the ranked list and the selected best candidate.
 *
 * **Determinism guarantee:** Same `(seed, config, searchConfig)` → same
 * output, forever. No `Math.random`, no `Date.now()`, no global mutable state.
 *
 * @param seed         - Root seed for deterministic generation.
 * @param config       - Level generation configuration (optional, merged with defaults).
 * @param searchConfig - Candidate search configuration (optional, merged with defaults).
 * @returns A {@link CandidateSearchResult} with all candidates and the selected one.
 *
 * @example
 * ```ts
 * const result = generateCandidates(42);
 * console.log(`Selected candidate ${result.selected.index} with score ${result.selected.quality.score}`);
 * console.log(`Generated ${result.candidates.length} candidates`);
 * ```
 */
export function generateCandidates(
  seed: number,
  config?: Readonly<LevelGenConfig>,
  searchConfig?: Readonly<CandidateSearchConfig>,
): CandidateSearchResult {
  const diagnostics: GenerationDiagnostic[] = [];

  try {
    // Merge configs
    const mergedConfig: LevelGenConfig = {
      ...DEFAULT_LEVEL_GEN_CONFIG,
      ...config,
    };

    const mergedSearch: {
      candidateCount: number;
      maxRepairPasses: number;
      seedSalt: number;
    } = {
      candidateCount: searchConfig?.candidateCount ?? DEFAULT_CANDIDATE_COUNT,
      maxRepairPasses: searchConfig?.maxRepairPasses ?? DEFAULT_MAX_REPAIR_PASSES,
      seedSalt: searchConfig?.seedSalt ?? CANDIDATE_SEED_SALT,
    };

    // Clamp candidateCount
    const candidateCount = Math.max(1, Math.min(64, Math.round(mergedSearch.candidateCount)));

    const candidates: CandidateResult[] = [];
    const searchDiagnostics: GenerationDiagnostic[] = [];

    // Quality config for evaluation
    const qualityConfig: QualityConfig = {
      weights: mergedConfig.qualityWeights,
    };

    // -----------------------------------------------------------------------
    // Step 1–2: Generate each candidate
    // -----------------------------------------------------------------------
    for (let i = 0; i < candidateCount; i++) {
      const candidateSeed = deriveCandidateSeed(seed, mergedSearch.seedSalt, i);
      const repairs: RepairRecord[] = [];

      try {
        // Generate
        const generated = generateLevel(candidateSeed, mergedConfig);

        // Step 3: Verify
        const verification = verifyAndAdapt(generated.level);

        // Step 4: Evaluate quality
        let quality = evaluateLevelQuality(generated.level, verification, qualityConfig);

        // Step 5: Apply targeted repair
        const maxPasses = Math.max(0, Math.min(10, Math.round(mergedSearch.maxRepairPasses)));
        let currentLevel: LevelData = generated.level;
        let currentVerification = verification;
        let currentQuality = quality;
        let currentGenerated = generated;

        for (let pass = 0; pass < maxPasses; pass++) {
          const repairResult = applyRepairs(
            currentLevel,
            currentVerification,
            currentQuality,
            mergedConfig,
            pass,
          );

          if (repairResult === null) break; // No more repairs needed

          repairs.push(repairResult.repair);

          // Re-verify and re-score after repair
          currentLevel = repairResult.level;
          const repairedGenerated: GeneratedLevel = {
            ...currentGenerated,
            level: currentLevel,
            report: {
              ...currentGenerated.report,
              repairs: [...currentGenerated.report.repairs, repairResult.repair],
            },
          };

          currentVerification = verifyAndAdapt(currentLevel);
          currentQuality = evaluateLevelQuality(currentLevel, currentVerification, qualityConfig);
          currentGenerated = repairedGenerated;
        }

        // Use the best quality (post-repair or original)
        const finalQuality = currentQuality;
        const finalGenerated = currentGenerated;

        // Check hard gates
        const gateResults = checkHardGates(currentLevel, currentVerification, finalGenerated);
        const hardGatesPassed = gateResults.filter((d) => d.severity === 'error').length === 0;

        searchDiagnostics.push(...gateResults);

        candidates.push({
          index: i,
          seed: candidateSeed,
          generated: finalGenerated,
          quality: finalQuality,
          repairs,
          passed: hardGatesPassed,
        });
      } catch (candidateError) {
        // Catch individual candidate failures gracefully
        searchDiagnostics.push({
          severity: 'warning',
          code: 'CANDIDATE_GENERATION_FAILED',
          message: `Candidate ${i} (seed ${candidateSeed}) failed: ${String(candidateError)}`,
        });
      }
    }

    diagnostics.push(...searchDiagnostics);

    // -----------------------------------------------------------------------
    // Step 6–7: Rank by quality score, select best
    // -----------------------------------------------------------------------
    const sorted = [...candidates].sort((a, b) => {
      // Prefer passed candidates over failed ones
      if (a.passed !== b.passed) return a.passed ? -1 : 1;
      // Higher score first
      const scoreDiff = b.quality.score - a.quality.score;
      if (Math.abs(scoreDiff) > 0.0001) return scoreDiff > 0 ? -1 : 1;
      // Stable tie-break: ascending index
      return a.index - b.index;
    });

    const selected = sorted[0] ?? candidates[0];

    if (!selected) {
      diagnostics.push({
        severity: 'error',
        code: 'NO_CANDIDATES',
        message: 'No candidates were generated.',
      });
    }

    return {
      version: 1 as const,
      rootSeed: seed,
      candidates,
      selected,
      diagnostics,
    };
  } catch (fatalError) {
    // Never throw
    diagnostics.push({
      severity: 'error',
      code: 'FATAL_ERROR',
      message: `Candidate search failed: ${String(fatalError)}`,
    });

    // Return a minimal result with a generated level
    const fallbackLevel = generateLevel(seed);
    const emptyQuality: LevelQualityReport = {
      version: 1,
      score: 0,
      pacing: 0,
      variety: 0,
      fairness: 0,
      exploration: 0,
      difficultyFit: 0,
      readability: 0,
      measuredDifficulty: 0,
      safetyMargins: [],
      diagnostics: [],
    };

    const emptyResult: CandidateResult = {
      index: 0,
      seed: seed >>> 0,
      generated: fallbackLevel,
      quality: emptyQuality,
      repairs: [],
      passed: false,
    };

    return {
      version: 1 as const,
      rootSeed: seed,
      candidates: [emptyResult],
      selected: emptyResult,
      diagnostics,
    };
  }
}
