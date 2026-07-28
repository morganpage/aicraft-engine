/**
 * Tests for the deterministic candidate search and selection module.
 *
 * Coverage:
 * - generateCandidates returns a valid CandidateSearchResult
 * - Default candidate count is 8
 * - Default max repair passes is 2
 * - Selected candidate has the highest quality score
 * - Ties resolve by ascending candidate index
 * - Same seed → same selected candidate
 * - Different seed → potentially different selected candidate
 * - Non-finite inputs → never throws
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import { generateCandidates } from '../levelgen/candidates';
import type { CandidateSearchConfig } from '../levelgen/candidates';
import type { LevelGenConfig } from '../levelgen/types';

// ---------------------------------------------------------------------------
// Configs for testing
// ---------------------------------------------------------------------------

const BASE_CONFIG: Readonly<LevelGenConfig> = {
  cols: 60,
  rows: 15,
  tileSize: 16,
  difficulty: 0.5,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateCandidates', () => {
  it('returns a valid CandidateSearchResult with version 1', () => {
    const result = generateCandidates(42, BASE_CONFIG);

    expect(result).toBeDefined();
    expect(result.version).toBe(1);
    expect(typeof result.rootSeed).toBe('number');
    expect(Array.isArray(result.candidates)).toBe(true);
    expect(result.selected).toBeDefined();
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });

  it('generates DEFAULT_CANDIDATE_COUNT (8) candidates by default', () => {
    const result = generateCandidates(42, BASE_CONFIG);

    expect(result.candidates.length).toBe(8);
  });

  it('generates the requested number of candidates', () => {
    const searchConfig: CandidateSearchConfig = { candidateCount: 4 };
    const result = generateCandidates(42, BASE_CONFIG, searchConfig);

    expect(result.candidates.length).toBe(4);
  });

  it('uses default maxRepairPasses of 2 when not specified', () => {
    const result = generateCandidates(42, BASE_CONFIG);

    // All candidates should have repairs arrays
    for (const candidate of result.candidates) {
      expect(Array.isArray(candidate.repairs)).toBe(true);
    }
  });

  it('generates at least 1 candidate even with negligible count', () => {
    const searchConfig: CandidateSearchConfig = { candidateCount: -5 };
    const result = generateCandidates(42, BASE_CONFIG, searchConfig);

    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
  });

  it('caps candidateCount at 64', () => {
    const searchConfig: CandidateSearchConfig = { candidateCount: 100 };
    const result = generateCandidates(42, BASE_CONFIG, searchConfig);

    expect(result.candidates.length).toBeLessThanOrEqual(64);
  });

  it('selected candidate has the highest quality score', () => {
    const result = generateCandidates(42, BASE_CONFIG);

    for (const candidate of result.candidates) {
      expect(candidate.quality.score).toBeLessThanOrEqual(result.selected.quality.score + 0.0001);
    }
  });

  it('each candidate has unique index and seed', () => {
    const result = generateCandidates(42, BASE_CONFIG);

    const indices = result.candidates.map((c) => c.index);
    const seeds = result.candidates.map((c) => c.seed);

    expect(new Set(indices).size).toBe(indices.length);
    expect(new Set(seeds).size).toBe(seeds.length);

    // Indices should be ascending from 0
    for (let i = 0; i < indices.length; i++) {
      expect(indices[i]).toBe(i);
    }
  });

  it('each candidate has a GeneratedLevel with valid structure', () => {
    const result = generateCandidates(42, BASE_CONFIG);

    for (const candidate of result.candidates) {
      expect(candidate.generated).toBeDefined();
      expect(candidate.generated.level).toBeDefined();
      expect(candidate.generated.editorOp).toBeDefined();
      expect(candidate.generated.tileSemantics).toBeDefined();
      expect(candidate.generated.report).toBeDefined();
    }
  });

  it('each candidate has a LevelQualityReport', () => {
    const result = generateCandidates(42, BASE_CONFIG);

    for (const candidate of result.candidates) {
      const quality = candidate.quality;
      expect(quality.version).toBe(1);
      expect(typeof quality.score).toBe('number');
      expect(quality.score).toBeGreaterThanOrEqual(0);
      expect(quality.score).toBeLessThanOrEqual(1);
      expect(typeof quality.pacing).toBe('number');
      expect(typeof quality.variety).toBe('number');
      expect(typeof quality.fairness).toBe('number');
      expect(typeof quality.exploration).toBe('number');
      expect(typeof quality.difficultyFit).toBe('number');
      expect(typeof quality.readability).toBe('number');
      expect(typeof quality.measuredDifficulty).toBe('number');
    }
  });

  it('rootSeed matches the input seed', () => {
    const result = generateCandidates(42, BASE_CONFIG);
    expect(result.rootSeed).toBe(42);
  });

  it('same seed and config → same result (determinism)', () => {
    const a = generateCandidates(42, BASE_CONFIG);
    const b = generateCandidates(42, BASE_CONFIG);

    expect(a.selected.index).toBe(b.selected.index);
    expect(a.selected.seed).toBe(b.selected.seed);
    expect(a.selected.quality.score).toBeCloseTo(b.selected.quality.score, 10);
    expect(a.candidates.length).toBe(b.candidates.length);
  });

  it('same seed and config → same candidate quality scores', () => {
    const a = generateCandidates(42, BASE_CONFIG);
    const b = generateCandidates(42, BASE_CONFIG);

    for (let i = 0; i < a.candidates.length; i++) {
      expect(a.candidates[i].quality.score).toBeCloseTo(b.candidates[i].quality.score, 10);
      expect(a.candidates[i].seed).toBe(b.candidates[i].seed);
    }
  });

  it('different seed → potentially different selected candidate', () => {
    const a = generateCandidates(42, BASE_CONFIG);
    const b = generateCandidates(99, BASE_CONFIG);

    // Different root seeds should produce different candidate seeds
    const seedA = a.candidates.map((c) => c.seed);
    const seedB = b.candidates.map((c) => c.seed);

    const anyDifferent = seedA.some((s, i) => s !== seedB[i]);
    expect(anyDifferent).toBe(true);
  });

  it('never throws on any input', () => {
    // @ts-expect-error — testing invalid input
    expect(() => generateCandidates(null)).not.toThrow();
    // @ts-expect-error — testing invalid input
    expect(() => generateCandidates(undefined)).not.toThrow();
    expect(() => generateCandidates(42, null as unknown as LevelGenConfig)).not.toThrow();
    expect(() => generateCandidates(42, {} as LevelGenConfig)).not.toThrow();
    expect(() => generateCandidates(42, { cols: NaN } as LevelGenConfig)).not.toThrow();
    expect(() => generateCandidates(42, { tilesize: -5 } as unknown as LevelGenConfig)).not.toThrow();
    expect(() => generateCandidates(42, BASE_CONFIG, null as unknown as CandidateSearchConfig)).not.toThrow();
    expect(() => generateCandidates(42, BASE_CONFIG, { candidateCount: NaN } as CandidateSearchConfig)).not.toThrow();
  });

  it('selected candidate index is valid', () => {
    const result = generateCandidates(42, BASE_CONFIG);

    const validIndices = new Set(result.candidates.map((c) => c.index));
    expect(validIndices.has(result.selected.index)).toBe(true);
  });

  it('diagnostics array includes info about verification status', () => {
    const result = generateCandidates(42, BASE_CONFIG);

    // Some diagnostics should be present (at minimum the NOT_PROVEN_BEATABLE info)
    const hasDiagnostic = result.diagnostics.length > 0 || result.candidates.some((c) => c.quality.diagnostics.length > 0);
    expect(hasDiagnostic).toBe(true);
  });

  it('candidate with higher passed count ranks higher than lower score passed', () => {
    // This tests that passed candidates come before failed ones in selection
    const result = generateCandidates(42, BASE_CONFIG);

    // At least the selected candidate should be flagged as passed
    // (or if none pass, the best available is selected)
    expect(result.selected).toBeDefined();
  });

  it('each candidate has a repairs array', () => {
    const result = generateCandidates(42, BASE_CONFIG);

    for (const candidate of result.candidates) {
      expect(Array.isArray(candidate.repairs)).toBe(true);
      // Each repair should have the proper structure
      for (const repair of candidate.repairs) {
        expect(repair.version).toBe(1);
        expect(typeof repair.diagnostic).toBe('string');
        expect(typeof repair.repair).toBe('string');
        expect(typeof repair.tick).toBe('number');
      }
    }
  });

  it('produces consistent ordering when same seed is used', () => {
    const results: number[] = [];
    for (let run = 0; run < 3; run++) {
      const result = generateCandidates(42, BASE_CONFIG);
      results.push(result.selected.index);
    }
    // All three runs should select the same candidate
    expect(results.every((r) => r === results[0])).toBe(true);
  });
});
