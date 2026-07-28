/**
 * Quality scoring for generated platformer levels.
 *
 * Computes six component scores (pacing, variety, fairness, exploration,
 * difficultyFit, readability) — each in `[0, 1]` — and combines them into a
 * normalized weighted mean overall score.
 *
 * Hard-gate failures (validation errors, non-traversable spawn, etc.) are
 * reflected in diagnostics but do not directly zero the score — they instead
 * signal through the candidate selection pipeline that this candidate should
 * be rejected.
 *
 * **Determinism:** All functions are pure — same input → same output, forever.
 * No `Math.random`, no `Date.now()`, no global mutable state. Never throws.
 *
 * @module
 * @packageDocumentation
 */

import type { LevelData, LevelEntity } from '../level/types';
import type {
  VerificationResult,
  QualityWeights,
  LevelQualityReport,
  JumpSafetyMetric,
  QualityDiagnostic,
} from './types';
import { DEFAULT_QUALITY_WEIGHTS } from './constants';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * Configuration for quality evaluation.
 *
 * All fields are optional — defaults live in {@link DEFAULT_QUALITY_WEIGHTS}.
 */
export interface QualityConfig {
  /**
   * Partial weight overrides. Omitted dimensions use defaults.
   * Weights are normalized by the evaluator (they need not sum to 1).
   */
  readonly weights?: Partial<QualityWeights>;
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a number to the `[0, 1]` range. Non-finite values become 0.
 */
function clamp01(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Check whether an entity prop has a specific boolean field.
 * Pure helper to avoid TS casting issues with read-only entity prop types.
 */
function entityPropIs(entity: LevelEntity, key: string, value: boolean): boolean {
  const props = entity.props as Record<string, unknown> | undefined;
  return props?.[key] === value;
}

// ---------------------------------------------------------------------------
// Component scorers
// ---------------------------------------------------------------------------

/**
 * Pacing score: measures entity-distribution entropy across the level's
 * horizontal span, rewarding varied placement and penalising clumping.
 *
 * Score in [0, 1]. Higher = more varied pacing.
 */
function scorePacing(level: LevelData): number {
  const entities = level.entities ?? [];
  if (entities.length < 3) return 0.5;

  const segments = 4;
  const segWidth = level.width / segments;
  const counts = new Array<number>(segments).fill(0);

  for (const entity of entities) {
    const x = entity.rect?.x;
    if (typeof x !== 'number' || !Number.isFinite(x)) continue;
    const idx = Math.min(segments - 1, Math.max(0, Math.floor(x / segWidth)));
    counts[idx]++;
  }

  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0.5;

  // Shannon entropy normalized to [0, 1]
  const logSegs = Math.log2(segments);
  let entropy = 0;
  for (const c of counts) {
    const p = c / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return logSegs > 0 ? clamp01(entropy / logSegs) : 0.5;
}

/**
 * Variety score: measures distinct entity kinds and height-profile variation.
 *
 * Score in [0, 1]. Higher = more variety.
 */
function scoreVariety(level: LevelData): number {
  const entities = level.entities ?? [];
  if (entities.length < 2) return 0.5;

  const kinds = new Set<string>();
  const yPositions = new Set<number>();

  for (const entity of entities) {
    if (typeof entity.kind === 'string') kinds.add(entity.kind);
    const y = entity.rect?.y;
    if (typeof y === 'number' && Number.isFinite(y)) {
      yPositions.add(Math.round(y / (level.tileSize || 16)));
    }
  }

  // Kind diversity (max 6 reasonable kinds)
  const kindScore = clamp01(kinds.size / 6);
  // Height diversity
  const maxHeightSlots = Math.max(1, Math.round((level.height ?? 240) / (level.tileSize || 16)));
  const heightScore = clamp01(yPositions.size / maxHeightSlots);

  return clamp01(kindScore * 0.5 + heightScore * 0.5);
}

/**
 * Fairness score: evaluates jump feasibility, spawn/exit safety, and
 * hazard placement.
 *
 * Score in [0, 1]. Higher = more fair.
 */
function scoreFairness(
  level: LevelData,
  _verification: VerificationResult,
  safetyMargins: JumpSafetyMetric[],
): number {
  const entities = level.entities ?? [];
  let hazardsNearSpawn = 0;
  let hazardsNearExit = 0;
  let totalHazards = 0;

  const spawnX = level.spawn?.x ?? 0;
  const spawnY = level.spawn?.y ?? 0;
  const tileSize = level.tileSize ?? 16;
  const safeRadius = tileSize * 3;

  // Find exits
  const exitEntities = entities.filter((e) => e.kind === 'exit');
  const nonTrapExits = exitEntities.filter((e) => !entityPropIs(e, 'isTrap', true));

  for (const entity of entities) {
    if (entity.kind === 'hazard' || entity.kind === 'trap') {
      totalHazards++;
      const ex = entity.rect?.x ?? 0;
      const ey = entity.rect?.y ?? 0;

      const dxSpawn = Math.abs(ex - spawnX);
      const dySpawn = Math.abs(ey - spawnY);
      if (dxSpawn < safeRadius && dySpawn < safeRadius) hazardsNearSpawn++;

      for (const exitE of nonTrapExits) {
        const exEx = exitE.rect?.x ?? 0;
        const exEy = exitE.rect?.y ?? 0;
        const dxExit = Math.abs(ex - exEx);
        const dyExit = Math.abs(ey - exEy);
        if (dxExit < safeRadius && dyExit < safeRadius) hazardsNearExit++;
      }
    }
  }

  // Safety margin score
  const marginScore =
    safetyMargins.length > 0
      ? clamp01(safetyMargins.filter((m) => m.feasible).length / safetyMargins.length)
      : 0.5;

  // Spawn safety score
  const spawnScore = hazardsNearSpawn === 0 ? 1 : clamp01(1 - hazardsNearSpawn / Math.max(1, totalHazards));

  // Exit safety score
  const exitScore = nonTrapExits.length > 0
    ? (hazardsNearExit === 0 ? 1 : clamp01(1 - hazardsNearExit / Math.max(1, totalHazards)))
    : 0.3;

  return clamp01(marginScore * 0.4 + spawnScore * 0.3 + exitScore * 0.3);
}

/**
 * Exploration score: measures optional branches, collectibles, and
 * secret-area potential.
 *
 * Score in [0, 1]. Higher = more exploration opportunity.
 */
function scoreExploration(level: LevelData): number {
  const entities = level.entities ?? [];
  let branches = 0;
  let collectibles = 0;
  let decorations = 0;

  for (const entity of entities) {
    if (entity.kind === 'collectible') collectibles++;
    if (entity.kind === 'exit') {
      // Branch exits (non-trap) count toward exploration
      if (!entityPropIs(entity, 'isTrap', true)) branches++;
    }
    if (entity.kind === 'decoration') decorations++;
  }

  // Count branch edges via exit count (at least 1 is required for the main exit)
  const branchScore = clamp01(branches > 1 ? (branches - 1) / 3 : 0);
  const collectibleScore = clamp01(collectibles / 8);
  const decorationScore = clamp01(decorations / 5);

  return clamp01(branchScore * 0.4 + collectibleScore * 0.4 + decorationScore * 0.2);
}

/**
 * Difficulty-fit score: compares measured difficulty signals against target.
 *
 * Uses bot performance data from verification when available.
 * Score in [0, 1]. Higher = better fit to target.
 */
function scoreDifficultyFit(
  level: LevelData,
  verification: VerificationResult,
): number {
  const entities = level.entities ?? [];

  // Count hazards and challenges
  const hazardCount = entities.filter((e) => e.kind === 'hazard' || e.kind === 'trap').length;
  const challengeCount = entities.filter((e) => e.kind === 'enemy' || e.kind === 'movingPlatform').length;

  // Bot performance signals
  const scenarioRuns = verification.scenario?.runs ?? [];
  const successRuns = scenarioRuns.filter((r) => r.termination === 'success');
  const totalRuns = scenarioRuns.length;
  const botSuccessRate = totalRuns > 0 ? successRuns.length / totalRuns : 0.5;

  // Target difficulty (approximate from entity density)
  const totalChallenges = hazardCount + challengeCount;
  const levelArea = (level.width ?? 960) * (level.height ?? 240);
  const entityDensity = levelArea > 0 ? totalChallenges / (levelArea / 10000) : 0;

  // Map entity density to measured difficulty
  const measuredDifficulty = clamp01(entityDensity / 15);

  // Bot success should correlate with difficulty:
  // - Low difficulty → high bot success rate
  // - High difficulty → lower bot success rate
  // Score is how well the bot performance aligns with expected
  const expectedBotSuccess = 1 - measuredDifficulty * 0.6;
  const fitScore = 1 - Math.abs(botSuccessRate - expectedBotSuccess);

  return clamp01(fitScore);
}

/**
 * Readability score: evaluates structural clarity and visual separation.
 *
 * Score in [0, 1]. Higher = more readable.
 */
function scoreReadability(level: LevelData): number {
  const entities = level.entities ?? [];
  const tileSize = level.tileSize ?? 16;
  let outOfBounds = 0;
  let totalEntities = 0;

  for (const entity of entities) {
    totalEntities++;
    const rect = entity.rect;
    if (!rect) continue;
    const r = rect as unknown as Record<string, unknown>;
    const x = r.x as number | undefined;
    const y = r.y as number | undefined;
    const width = r.width as number | undefined;
    const height = r.height as number | undefined;
    if (
      typeof x !== 'number' || !Number.isFinite(x) ||
      typeof y !== 'number' || !Number.isFinite(y) ||
      typeof width !== 'number' || !Number.isFinite(width) ||
      typeof height !== 'number' || !Number.isFinite(height)
    ) {
      outOfBounds++;
      continue;
    }
    // Check entity is roughly grid-aligned (within tile tolerance)
    const xOff = Math.abs(Math.round(x / tileSize) * tileSize - x);
    const yOff = Math.abs(Math.round(y / tileSize) * tileSize - y);
    if (xOff > tileSize * 0.25 || yOff > tileSize * 0.25) outOfBounds++;
  }

  const boundsScore = totalEntities > 0 ? clamp01(1 - outOfBounds / totalEntities) : 0.5;

  // Spawn-to-exit direction clarity
  const spawnX = level.spawn?.x ?? 0;
  const exits = entities.filter((e) => e.kind === 'exit');
  let hasClearDirection = false;
  for (const exit of exits) {
    const exitX = exit.rect?.x ?? 0;
    // Exit should be to the right of spawn (typical platformer direction)
    if (exitX > spawnX + (level.width ?? 960) * 0.1) {
      hasClearDirection = true;
      break;
    }
  }

  const directionScore = hasClearDirection ? 1 : 0.5;

  return clamp01(boundsScore * 0.6 + directionScore * 0.4);
}

// ---------------------------------------------------------------------------
// extractSafetyMargins
// ---------------------------------------------------------------------------

/**
 * Extract jump safety metrics from a verification result.
 *
 * Looks at reachability analysis for jump-edge feasibility data.
 */
function extractSafetyMargins(
  verification: VerificationResult,
): JumpSafetyMetric[] {
  const margins: JumpSafetyMetric[] = [];

  // If reachability has data, derive safety margins
  const reachability = verification.reachability;
  if (reachability && typeof reachability === 'object') {
    const r = reachability as unknown as Record<string, unknown>;
    const nodeCount = r.nodeCount as number | undefined;
    if (typeof nodeCount === 'number' && nodeCount > 0) {
      margins.push({
        from: 'spawn',
        to: 'exit',
        margin: reachability.reachable ? 4 : -2,
        feasible: reachability.reachable,
      });
    }
  }

  return margins;
}

// ---------------------------------------------------------------------------
// evaluateLevelQuality
// ---------------------------------------------------------------------------

/**
 * Evaluate the quality of a generated platformer level.
 *
 * Computes six component scores — each in `[0, 1]` — and combines them into
 * a normalized weighted mean overall score. Hard-gate failures are reflected
 * in diagnostics so the candidate selection pipeline can reject unsuitable
 * levels.
 *
 * **Never throws.** All inputs are defensively handled.
 *
 * @param level        - The generated level data to evaluate.
 * @param verification - Verification result for this level (includes reachability
 *                       and bot-simulation data).
 * @param config       - Optional quality configuration (weight overrides).
 * @returns A {@link LevelQualityReport} with all component scores and diagnostics.
 *
 * @example
 * ```ts
 * const report = evaluateLevelQuality(levelData, verificationResult);
 * console.log(`Overall quality: ${report.score}`);
 * console.log(`Pacing: ${report.pacing}, Fairness: ${report.fairness}`);
 * ```
 */
export function evaluateLevelQuality(
  level: LevelData,
  verification: VerificationResult,
  config?: QualityConfig,
): LevelQualityReport {
  const diagnostics: QualityDiagnostic[] = [];

  try {
    // Merge weights (build mutable object from defaults)
    const weights: {
      pacing: number;
      variety: number;
      fairness: number;
      exploration: number;
      difficultyFit: number;
      readability: number;
    } = {
      pacing: DEFAULT_QUALITY_WEIGHTS.pacing,
      variety: DEFAULT_QUALITY_WEIGHTS.variety,
      fairness: DEFAULT_QUALITY_WEIGHTS.fairness,
      exploration: DEFAULT_QUALITY_WEIGHTS.exploration,
      difficultyFit: DEFAULT_QUALITY_WEIGHTS.difficultyFit,
      readability: DEFAULT_QUALITY_WEIGHTS.readability,
    };

    if (config?.weights) {
      const keys = Object.keys(config.weights) as (keyof QualityWeights)[];
      for (const key of keys) {
        const v = config.weights[key];
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
          weights[key] = v;
        }
      }
    }

    // Safety margins
    const safetyMargins: JumpSafetyMetric[] = extractSafetyMargins(verification);

    // Compute component scores (all in [0, 1])
    const pacing = scorePacing(level);
    const variety = scoreVariety(level);
    const fairness = scoreFairness(level, verification, safetyMargins);
    const exploration = scoreExploration(level);
    const difficultyFit = scoreDifficultyFit(level, verification);
    const readability = scoreReadability(level);

    // Measured difficulty (proxy from entity density)
    const totalChallenges = level.entities.filter(
      (e) => e.kind === 'hazard' || e.kind === 'trap' || e.kind === 'enemy' || e.kind === 'movingPlatform',
    ).length;
    const levelArea = (level.width ?? 960) * (level.height ?? 240);
    const entityDensity = levelArea > 0 ? totalChallenges / (levelArea / 10000) : 0;
    const measuredDifficulty = clamp01(entityDensity / 15);

    // Critical path ticks from verification scenario
    const winningRun = verification.scenario?.runs?.find((r) => r.termination === 'success');
    const criticalPathTicks = winningRun?.ticks;

    // Normalized weighted mean
    const weightSum = weights.pacing + weights.variety + weights.fairness +
      weights.exploration + weights.difficultyFit + weights.readability;

    const overallScore = weightSum > 0
      ? clamp01(
          (pacing * weights.pacing +
            variety * weights.variety +
            fairness * weights.fairness +
            exploration * weights.exploration +
            difficultyFit * weights.difficultyFit +
            readability * weights.readability) /
            weightSum,
        )
      : 0;

    // Hard-gate diagnostics
    if (!verification.structural?.valid) {
      diagnostics.push({
        severity: 'error',
        code: 'STRUCTURAL_INVALID',
        message: 'Level failed structural validation — not eligible for selection.',
      });
    }

    if (verification.status === 'proven-unreachable') {
      diagnostics.push({
        severity: 'error',
        code: 'UNREACHABLE',
        message: 'Static analysis proves the level is unreachable from spawn to exit.',
      });
    }

    return {
      version: 1,
      score: overallScore,
      pacing,
      variety,
      fairness,
      exploration,
      difficultyFit,
      readability,
      measuredDifficulty,
      criticalPathTicks,
      safetyMargins,
      diagnostics,
    };
  } catch {
    // Never throw — return zeroed report with error diagnostic
    return {
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
      diagnostics: [
        {
          severity: 'error',
          code: 'QUALITY_EVALUATION_ERROR',
          message: 'Quality evaluation failed unexpectedly.',
        },
      ],
    };
  }
}
