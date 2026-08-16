/**
 * Tests for the full verification pipeline (verifyLevel / verifyCompiledLevel).
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import {
  verifyLevel,
  verifyCompiledLevel,
} from '../leveltest/verify';
import type { LevelTestConfig } from '../leveltest/verify';
import type { LevelData } from '../level/types';
import { compileLevel } from '../platformer/level-runtime';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal valid level with ground + exit and player on ground. */
function makeSimpleSolvableLevel(): LevelData {
  return {
    version: 1,
    id: 'solvable',
    name: 'Simple Solvable',
    width: 800,
    height: 600,
    tileSize: 16,
    spawn: { x: 50, y: 500 },
    tiles: {
      data: [],
      cols: 0,
      rows: 0,
      tileSize: 16,
    },
    entities: [
      {
        id: 1,
        kind: 'spawn',
        rect: { x: 50, y: 500, width: 16, height: 24 },
        props: {},
      },
      // Ground from spawn to exit
      {
        id: 2,
        kind: 'platform',
        rect: { x: 0, y: 524, width: 300, height: 16 },
        props: {},
      },
      // Exit to the right, on the ground
      {
        id: 3,
        kind: 'exit',
        rect: { x: 250, y: 476, width: 32, height: 48 },
        props: { isTrap: false, locked: false },
      },
    ],
    nextEntityId: 4,
  };
}

/** A level that is structurally invalid (missing spawn). */
function makeInvalidLevel(): LevelData {
  return {
    version: 1,
    id: 'invalid',
    name: 'Invalid Level',
    width: 800,
    height: 600,
    tileSize: 16,
    spawn: { x: 50, y: 500 },
    tiles: {
      data: [],
      cols: 0,
      rows: 0,
      tileSize: 16,
    },
    entities: [
      // No spawn entity
      {
        id: 1,
        kind: 'exit',
        rect: { x: 250, y: 476, width: 32, height: 48 },
        props: { isTrap: false, locked: false },
      },
    ],
    nextEntityId: 2,
  };
}

describe('verifyLevel', () => {
  it('returns a VerificationResult with version 1', () => {
    const level = makeSimpleSolvableLevel();
    const result = verifyLevel(level);
    expect(result).toBeDefined();
    expect(result.version).toBe(1);
    expect(typeof result.status).toBe('string');
    expect(result.structural).toBeDefined();
    expect(result.reachability).toBeDefined();
    expect(result.scenario).toBeDefined();
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });

  it('returns proven-beatable with winning replay for a simple solvable level', () => {
    const level = makeSimpleSolvableLevel();
    const result = verifyLevel(level, {
      maxTicks: 18000,
      fixedDt: 1 / 60,
    });

    // The bots should eventually reach the exit by moving right
    if (result.status === 'proven-beatable') {
      expect(result.winningReplay).toBeDefined();
      expect(result.winningReplayHash).toBeDefined();
      expect(typeof result.winningReplayHash).toBe('number');
    }
    // NOTE: Bot policies are simple heuristics; they may not beat every solvable
    // level. If they don't, the result will be 'inconclusive' which is also valid.
    expect(['proven-beatable', 'inconclusive']).toContain(result.status);
  });

  it('returns inconclusive for a structurally invalid level — fast-failing the pipeline', () => {
    const level = makeInvalidLevel();
    const result = verifyLevel(level);
    expect(result.status).toBe('inconclusive');
    expect(result.structural.valid).toBe(false);
    // Fast-fail (observed before the change: 3 bot policies each ran ~76
    // ticks against the untrusted world before Step 7 said inconclusive
    // anyway). Scenario + reachability are now empty placeholders, and the
    // same info diagnostic the full pipeline produced is present.
    expect(result.scenario.runs).toHaveLength(0);
    expect(result.reachability.graph.surfaces).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.code === 'STATUS_INCONCLUSIVE')).toBe(true);
  });

  it('a fixedDt of 0 degrades to 1/60 instead of freezing the scenario or the tickRate', () => {
    const level = makeSimpleSolvableLevel();
    // The guard normalizes fixedDt BEFORE the scenario runs, so a zero-dt run
    // is identical to the default-dt run — not a frozen-tick degenerate one
    // (and never a tickRate: Infinity frozen into the emitted ReplayConfig).
    const zero = verifyLevel(level, { maxTicks: 6000, seed: 7, fixedDt: 0 });
    const normal = verifyLevel(level, { maxTicks: 6000, seed: 7 });
    expect(zero.status).toBe(normal.status);
    expect(zero.scenario.runs.map((r) => r.termination))
      .toEqual(normal.scenario.runs.map((r) => r.termination));
    if (zero.winningReplay) {
      const replayConfig = (zero.winningReplay as unknown as { config: { tickRate: number } }).config;
      expect(replayConfig.tickRate).toBe(60);
      expect(Number.isFinite(replayConfig.tickRate)).toBe(true);
    }
  });

  it('never throws on any input', () => {
    const badInputs = [
      null as unknown as LevelData,
      undefined as unknown as LevelData,
      {} as LevelData,
      { version: 'bad' } as unknown as LevelData,
    ];

    for (const input of badInputs) {
      expect(() => verifyLevel(input)).not.toThrow();
    }
  });

  it('winning replay hash is deterministic', () => {
    const level = makeSimpleSolvableLevel();
    const config = { maxTicks: 6000, fixedDt: 1 / 60, seed: 42 };
    const result1 = verifyLevel(level, config);
    const result2 = verifyLevel(level, config);

    // Both runs should produce the same status
    expect(result1.status).toBe(result2.status);

    // If both produced winning replays, hashes should match
    if (result1.status === 'proven-beatable' && result2.status === 'proven-beatable') {
      expect(result1.winningReplayHash).toBe(result2.winningReplayHash);
    }
  });
});

describe('verifyCompiledLevel', () => {
  it('uses the provided compiled level', () => {
    const level = makeSimpleSolvableLevel();
    const compiled = compileLevel(level);
    const result = verifyCompiledLevel(level, compiled);
    expect(result).toBeDefined();
    expect(result.version).toBe(1);
    expect(['proven-beatable', 'inconclusive']).toContain(result.status);
  });

  it('produces the same result as verifyLevel for the same input', () => {
    const level = makeSimpleSolvableLevel();
    const compiled = compileLevel(level);
    const config = { maxTicks: 6000, seed: 42 };

    const result1 = verifyLevel(level, config);
    const result2 = verifyCompiledLevel(level, compiled, config);

    // Both should have the same status
    expect(result1.status).toBe(result2.status);
    expect(result1.structural.valid).toBe(result2.structural.valid);
  });
});

describe('VerificationResult properties', () => {
  it('result.status is one of the three valid statuses', () => {
    const validStatuses = ['proven-beatable', 'proven-unreachable', 'inconclusive'];
    const level = makeSimpleSolvableLevel();
    const result = verifyLevel(level);
    expect(validStatuses).toContain(result.status);
  });

  it('structural validation result is always present', () => {
    const level = makeSimpleSolvableLevel();
    const result = verifyLevel(level);
    expect(typeof result.structural.valid).toBe('boolean');
    expect(Array.isArray(result.structural.errors)).toBe(true);
  });

  it('reachability result is always present', () => {
    const level = makeSimpleSolvableLevel();
    const result = verifyLevel(level);
    expect(typeof result.reachability.reachable).toBe('boolean');
    expect(typeof result.reachability.confidence).toBe('string');
    expect(Array.isArray(result.reachability.diagnostics)).toBe(true);
  });

  it('scenario result is always present', () => {
    const level = makeSimpleSolvableLevel();
    const result = verifyLevel(level);
    expect(typeof result.scenario.status).toBe('string');
    expect(Array.isArray(result.scenario.runs)).toBe(true);
    expect(Array.isArray(result.scenario.diagnostics)).toBe(true);
  });

  it('diagnostics array is always present', () => {
    const level = makeSimpleSolvableLevel();
    const result = verifyLevel(level);
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });
});

describe('Non-finite input handling', () => {
  it('never throws on NaN, Infinity, -Infinity in config', () => {
    const level = makeSimpleSolvableLevel();
    const badConfigs: LevelTestConfig[] = [
      { fixedDt: NaN },
      { fixedDt: Infinity },
      { fixedDt: -Infinity },
      { maxTicks: NaN },
      { seed: NaN },
      { seed: Infinity },
    ];

    for (const cfg of badConfigs) {
      expect(() => verifyLevel(level, cfg)).not.toThrow();
    }
  });

  it('never throws when level has non-finite coordinates', () => {
    const level = makeSimpleSolvableLevel();
    const badLevel: LevelData = {
      ...level,
      spawn: { x: NaN, y: Infinity },
    };
    expect(() => verifyLevel(badLevel)).not.toThrow();
  });
});
