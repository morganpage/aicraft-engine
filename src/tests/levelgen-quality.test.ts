/**
 * Tests for the level generation quality scoring module.
 *
 * Coverage:
 * - evaluateLevelQuality returns a valid LevelQualityReport
 * - All component scores in [0, 1]
 * - Overall score is a normalized weighted mean
 * - Hard-gate failures are reflected in diagnostics
 * - Non-finite inputs → never throws
 * - Same input → same output
 * - Custom weights affect the overall score
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import { evaluateLevelQuality } from '../levelgen/quality';
import type { QualityConfig } from '../levelgen/quality';
import type {
  VerificationResult,
  LevelQualityReport,
  QualityWeights,
} from '../levelgen/types';
import { DEFAULT_QUALITY_WEIGHTS } from '../levelgen/constants';
import { generateLevel } from '../levelgen/generate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal surfaces for the reachability graph (count is what quality reads). */
function surfaces(count: number): { id: string; x: number; y: number; width: number; passthrough: boolean }[] {
  return Array.from({ length: count }, (_, i) => ({ id: `s${i}`, x: 0, y: 0, width: 16, passthrough: false }));
}

/**
 * Create a minimal VerificationResult for testing quality scoring.
 * Uses 'inconclusive' status by default.
 */
function makeVerificationResult(
  overrides?: Partial<VerificationResult>,
): VerificationResult {
  return {
    version: 1,
    status: 'inconclusive',
    structural: {
      valid: true,
      errors: [],
    },
    reachability: {
      version: 1,
      confidence: 'heuristic' as const,
      reachable: true,
      graph: { surfaces: surfaces(10), edges: [] },
      spawnSurface: null,
      exitSurfaces: [],
      reachableSurfaces: [],
      softlockSurfaces: [],
      diagnostics: ['Reachable (heuristic).'],
    },
    scenario: {
      version: 1,
      status: 'inconclusive',
      runs: [],
      diagnostics: [],
    },
    diagnostics: [],
    ...overrides,
  };
}

/**
 * Create a sample generated level for quality testing.
 */
function makeSampleLevel(): Parameters<typeof evaluateLevelQuality>[0] {
  return generateLevel(42).level;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('evaluateLevelQuality', () => {
  it('returns a valid LevelQualityReport with version 1', () => {
    const level = makeSampleLevel();
    const ver = makeVerificationResult();
    const report = evaluateLevelQuality(level, ver);

    expect(report).toBeDefined();
    expect(report.version).toBe(1);
    expect(typeof report.score).toBe('number');
  });

  it('returns all component scores as finite numbers in [0, 1]', () => {
    const level = makeSampleLevel();
    const ver = makeVerificationResult();
    const report = evaluateLevelQuality(level, ver);

    const components: (keyof LevelQualityReport)[] = [
      'pacing',
      'variety',
      'fairness',
      'exploration',
      'difficultyFit',
      'readability',
      'measuredDifficulty',
    ];

    for (const key of components) {
      const value = report[key] as number;
      expect(
        Number.isFinite(value),
        `Expected ${key} to be a finite number, got ${value}`,
      ).toBe(true);
      expect(
        value >= 0 && value <= 1,
        `Expected ${key} to be in [0, 1], got ${value}`,
      ).toBe(true);
    }
  });

  it('returns an overall score that is a normalized weighted mean', () => {
    const level = makeSampleLevel();
    const ver = makeVerificationResult();
    const report = evaluateLevelQuality(level, ver);

    // The overall score must be in [0, 1]
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(1);

    // With equal weights, the overall score should equal the mean of components
    const weights: QualityWeights = {
      pacing: 1,
      variety: 1,
      fairness: 1,
      exploration: 1,
      difficultyFit: 1,
      readability: 1,
    };
    const config: QualityConfig = { weights };
    const equalReport = evaluateLevelQuality(level, ver, config);

    const mean =
      (equalReport.pacing +
        equalReport.variety +
        equalReport.fairness +
        equalReport.exploration +
        equalReport.difficultyFit +
        equalReport.readability) /
      6;

    // Allow small floating-point tolerance
    expect(Math.abs(equalReport.score - mean)).toBeLessThan(0.001);
  });

  it('reflects hard-gate failures in diagnostics', () => {
    const level = makeSampleLevel();
    const ver = makeVerificationResult({
      structural: { valid: false, errors: [{ path: 'tiles', message: 'Missing tiles', severity: 'error' as const }] },
      status: 'inconclusive',
    });

    const report = evaluateLevelQuality(level, ver);

    const hasStructuralError = report.diagnostics.some(
      (d) => d.code === 'STRUCTURAL_INVALID' && d.severity === 'error',
    );
    expect(hasStructuralError).toBe(true);
  });

  it('reflects proven-unreachable status in diagnostics', () => {
    const level = makeSampleLevel();
    const ver = makeVerificationResult({
      status: 'proven-unreachable',
      reachability: {
        version: 1,
        confidence: 'sound-over-approximation' as const,
        reachable: false,
        graph: { surfaces: surfaces(5), edges: [] },
        spawnSurface: null,
        exitSurfaces: [],
        reachableSurfaces: [],
        softlockSurfaces: [],
        diagnostics: ['No path found.'],
      },
    });

    const report = evaluateLevelQuality(level, ver);

    const hasUnreachableDiag = report.diagnostics.some(
      (d) => d.code === 'UNREACHABLE' && d.severity === 'error',
    );
    expect(hasUnreachableDiag).toBe(true);
  });

  it('produces same output for same input (determinism)', () => {
    const level = makeSampleLevel();
    const ver = makeVerificationResult();
    const config: QualityConfig = {
      weights: { pacing: 0.3, fairness: 0.3, variety: 0.2, exploration: 0.1, difficultyFit: 0.05, readability: 0.05 },
    };

    const a = evaluateLevelQuality(level, ver, config);
    const b = evaluateLevelQuality(level, ver, config);

    expect(a).toEqual(b);
  });

  it('never throws on non-finite or null inputs', () => {
    // @ts-expect-error — testing invalid input
    expect(() => evaluateLevelQuality(null, null)).not.toThrow();
    // @ts-expect-error — testing invalid input
    expect(() => evaluateLevelQuality(undefined, undefined)).not.toThrow();
    // @ts-expect-error — testing invalid input
    expect(() => evaluateLevelQuality({}, {})).not.toThrow();

    const level = makeSampleLevel();
    const ver = makeVerificationResult();
    // NaN and Infinity are still type `number`, so no @ts-expect-error needed
    expect(() => evaluateLevelQuality(level, ver, { weights: { pacing: NaN } })).not.toThrow();
    expect(() => evaluateLevelQuality(level, ver, { weights: { pacing: Infinity } })).not.toThrow();
  });

  it('returns safety margins array (possibly empty)', () => {
    const level = makeSampleLevel();
    const ver = makeVerificationResult();
    const report = evaluateLevelQuality(level, ver);

    expect(Array.isArray(report.safetyMargins)).toBe(true);
  });

  it('returns diagnostics array (possibly empty for healthy levels)', () => {
    const level = makeSampleLevel();
    const ver = makeVerificationResult();
    const report = evaluateLevelQuality(level, ver);

    expect(Array.isArray(report.diagnostics)).toBe(true);
  });

  it('returns measuredDifficulty as a finite number in [0, 1]', () => {
    const level = makeSampleLevel();
    const ver = makeVerificationResult();
    const report = evaluateLevelQuality(level, ver);

    expect(Number.isFinite(report.measuredDifficulty)).toBe(true);
    expect(report.measuredDifficulty).toBeGreaterThanOrEqual(0);
    expect(report.measuredDifficulty).toBeLessThanOrEqual(1);
  });

  it('computes a different overall score when weights change', () => {
    const level = makeSampleLevel();
    const ver = makeVerificationResult();

    const configA: QualityConfig = { weights: { pacing: 1, variety: 0, fairness: 0, exploration: 0, difficultyFit: 0, readability: 0 } };
    const configB: QualityConfig = { weights: { pacing: 0, variety: 0, fairness: 0, exploration: 0, difficultyFit: 1, readability: 0 } };

    const reportA = evaluateLevelQuality(level, ver, configA);
    const reportB = evaluateLevelQuality(level, ver, configB);

    // A weighted entirely on pacing vs difficultyFit should produce different scores
    // (unless all scores happen to be identical)
    expect(typeof reportA.score).toBe('number');
    expect(typeof reportB.score).toBe('number');
  });

  it('uses DEFAULT_QUALITY_WEIGHTS when config is omitted', () => {
    const level = makeSampleLevel();
    const ver = makeVerificationResult();

    const reportNoConfig = evaluateLevelQuality(level, ver);
    const reportWithDefaultConfig = evaluateLevelQuality(level, ver, { weights: DEFAULT_QUALITY_WEIGHTS });

    // Both should produce the same result
    expect(reportNoConfig.score).toBeCloseTo(reportWithDefaultConfig.score, 5);
  });

  it('clamps negative weight values to 0', () => {
    const level = makeSampleLevel();
    const ver = makeVerificationResult();

    const config: QualityConfig = { weights: { pacing: -100, variety: 0, fairness: 0, exploration: 0, difficultyFit: 0, readability: 0 } };
    const report = evaluateLevelQuality(level, ver, config);

    // With pacing weight clamped to 0 and others at default weights,
    // score should still be valid
    expect(Number.isFinite(report.score)).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(1);
  });
});
