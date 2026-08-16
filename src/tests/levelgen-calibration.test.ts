/**
 * Tests for the level generation calibration module.
 *
 * Coverage:
 * - Difficulty band constants have correct ranges
 * - calibrateDifficulty returns a valid CalibrationResult
 * - Level with measured difficulty 0.2 → LOW band
 * - Level with measured difficulty 0.5 → MEDIUM band
 * - Level with measured difficulty 0.8 → HIGH band
 * - withinBand is true when measured difficulty is in band range
 * - Custom bands are accepted
 * - Non-finite inputs → never throws
 * - runLowSkillPerturbation returns valid result
 * - Perturbed difficulty ≥ original difficulty
 * - Non-finite perturbation inputs → never throws
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import {
  LOW_DIFFICULTY_BAND,
  MEDIUM_DIFFICULTY_BAND,
  HIGH_DIFFICULTY_BAND,
  calibrateDifficulty,
  createDegradedPolicy,
  runLowSkillPerturbation,
} from '../levelgen/calibration';
import type { CalibrationConfig, PerturbationConfig } from '../levelgen/calibration';
import type { BotPolicy } from '../leveltest/policies';
import type { PlatformerInput } from '../platformer/types';
import type {
  LevelQualityReport,
  VerificationResult,
} from '../levelgen/types';
import type { LevelData } from '../level/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal VerificationResult for calibration testing.
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
      confidence: 'heuristic',
      reachable: true,
      nodeCount: 10,
      summary: 'Reachable (heuristic).',
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
 * Create a LevelQualityReport with a specified measuredDifficulty.
 */
function makeQualityReport(measuredDifficulty: number): LevelQualityReport {
  return {
    version: 1,
    score: 0.5,
    pacing: 0.5,
    variety: 0.5,
    fairness: 0.5,
    exploration: 0.5,
    difficultyFit: 0.5,
    readability: 0.5,
    measuredDifficulty,
    safetyMargins: [],
    diagnostics: [],
  };
}

/**
 * Create a minimal LevelData for calibration testing.
 */
function makeLevel(overrides?: Partial<LevelData>): LevelData {
  return {
    version: 1,
    id: 'test-level',
    name: 'Test Level',
    width: 960,
    height: 540,
    tileSize: 16,
    spawn: { x: 32, y: 32 },
    tiles: {
      data: new Array(60 * 34).fill(0),
      cols: 60,
      rows: 34,
      tileSize: 16,
    },
    entities: [
      { id: 1, kind: 'spawn', rect: { x: 32, y: 32, width: 16, height: 24 }, props: {} },
      { id: 2, kind: 'exit', rect: { x: 800, y: 400, width: 32, height: 48 }, props: { isTrap: false, locked: false } },
    ],
    nextEntityId: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Difficulty band tests
// ---------------------------------------------------------------------------

describe('Difficulty bands', () => {
  it('LOW_DIFFICULTY_BAND has correct range [0, 0.33] and target 0.15', () => {
    expect(LOW_DIFFICULTY_BAND.version).toBe(1);
    expect(LOW_DIFFICULTY_BAND.label).toBe('low');
    expect(LOW_DIFFICULTY_BAND.minDifficulty).toBe(0);
    expect(LOW_DIFFICULTY_BAND.maxDifficulty).toBeCloseTo(0.33, 2);
    expect(LOW_DIFFICULTY_BAND.targetDifficulty).toBeCloseTo(0.15, 2);
  });

  it('MEDIUM_DIFFICULTY_BAND has correct range [0.33, 0.67] and target 0.5', () => {
    expect(MEDIUM_DIFFICULTY_BAND.version).toBe(1);
    expect(MEDIUM_DIFFICULTY_BAND.label).toBe('medium');
    expect(MEDIUM_DIFFICULTY_BAND.minDifficulty).toBeCloseTo(0.33, 2);
    expect(MEDIUM_DIFFICULTY_BAND.maxDifficulty).toBeCloseTo(0.67, 2);
    expect(MEDIUM_DIFFICULTY_BAND.targetDifficulty).toBeCloseTo(0.5, 2);
  });

  it('HIGH_DIFFICULTY_BAND has correct range [0.67, 1.0] and target 0.85', () => {
    expect(HIGH_DIFFICULTY_BAND.version).toBe(1);
    expect(HIGH_DIFFICULTY_BAND.label).toBe('high');
    expect(HIGH_DIFFICULTY_BAND.minDifficulty).toBeCloseTo(0.67, 2);
    expect(HIGH_DIFFICULTY_BAND.maxDifficulty).toBe(1.0);
    expect(HIGH_DIFFICULTY_BAND.targetDifficulty).toBeCloseTo(0.85, 2);
  });

  it('bands cover the full [0, 1] range without gaps', () => {
    expect(LOW_DIFFICULTY_BAND.minDifficulty).toBe(0);
    expect(LOW_DIFFICULTY_BAND.maxDifficulty).toBeCloseTo(MEDIUM_DIFFICULTY_BAND.minDifficulty, 2);
    expect(MEDIUM_DIFFICULTY_BAND.maxDifficulty).toBeCloseTo(HIGH_DIFFICULTY_BAND.minDifficulty, 2);
    expect(HIGH_DIFFICULTY_BAND.maxDifficulty).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// calibrateDifficulty tests
// ---------------------------------------------------------------------------

describe('calibrateDifficulty', () => {
  it('returns a valid CalibrationResult with version 1', () => {
    const level = makeLevel();
    const verification = makeVerificationResult();
    const quality = makeQualityReport(0.5);

    const result = calibrateDifficulty(level, verification, quality);

    expect(result).toBeDefined();
    expect(result.version).toBe(1);
    expect(typeof result.measuredDifficulty).toBe('number');
    expect(typeof result.withinBand).toBe('boolean');
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });

  it('classifies measured difficulty 0.2 as LOW band', () => {
    const level = makeLevel();
    const verification = makeVerificationResult();
    const quality = makeQualityReport(0.2);

    const result = calibrateDifficulty(level, verification, quality);

    expect(result.band.label).toBe('low');
  });

  it('classifies measured difficulty 0.5 as MEDIUM band', () => {
    const level = makeLevel();
    const verification = makeVerificationResult();
    const quality = makeQualityReport(0.5);

    const result = calibrateDifficulty(level, verification, quality);

    expect(result.band.label).toBe('medium');
  });

  it('classifies measured difficulty 0.8 as HIGH band', () => {
    const level = makeLevel();
    const verification = makeVerificationResult();
    const quality = makeQualityReport(0.8);

    const result = calibrateDifficulty(level, verification, quality);

    expect(result.band.label).toBe('high');
  });

  it('sets withinBand = true when measured difficulty is within the band range', () => {
    const level = makeLevel();
    const verification = makeVerificationResult();
    const quality = makeQualityReport(0.5); // medium band

    const result = calibrateDifficulty(level, verification, quality);

    expect(result.withinBand).toBe(true);
  });

  it('classifies difficulty exactly at band boundary correctly', () => {
    const level = makeLevel();
    const verification = makeVerificationResult();

    // Exactly at 1/3 boundary — should be LOW (inclusive on max)
    const qualityLow = makeQualityReport(1 / 3);
    const resultLow = calibrateDifficulty(level, verification, qualityLow);
    expect(resultLow.band.label).toBe('low');

    // Just above 1/3 (0.34) — should be MEDIUM
    const qualityMed = makeQualityReport(0.34);
    const resultMed = calibrateDifficulty(level, verification, qualityMed);
    expect(resultMed.band.label).toBe('medium');

    // Exactly at 2/3 boundary — should be MEDIUM (inclusive on max)
    const qualityMed2 = makeQualityReport(2 / 3);
    const resultMed2 = calibrateDifficulty(level, verification, qualityMed2);
    expect(resultMed2.band.label).toBe('medium');

    // Just above 2/3 (0.67) — should be HIGH
    const qualityHigh = makeQualityReport(0.67);
    const resultHigh = calibrateDifficulty(level, verification, qualityHigh);
    expect(resultHigh.band.label).toBe('high');
  });

  it('uses custom bands when provided via CalibrationConfig', () => {
    const customBand = {
      version: 1 as const,
      label: 'low' as const,
      minDifficulty: 0,
      maxDifficulty: 0.5,
      targetDifficulty: 0.25,
    };
    const config: CalibrationConfig = {
      bands: [customBand],
    };

    const level = makeLevel();
    const verification = makeVerificationResult();
    const quality = makeQualityReport(0.3);

    const result = calibrateDifficulty(level, verification, quality, config);

    expect(result.band.label).toBe('low');
    expect(result.band.maxDifficulty).toBe(0.5);
    expect(result.withinBand).toBe(true);
  });

  it('reports measuredDifficulty in the result', () => {
    const level = makeLevel();
    const verification = makeVerificationResult();
    const quality = makeQualityReport(0.42);

    const result = calibrateDifficulty(level, verification, quality);

    expect(result.measuredDifficulty).toBeCloseTo(0.42, 5);
  });

  it('never throws on null or undefined inputs', () => {
    // @ts-expect-error — testing invalid input
    expect(() => calibrateDifficulty(null, null, null)).not.toThrow();
    // @ts-expect-error — testing invalid input
    expect(() => calibrateDifficulty(undefined, undefined, undefined)).not.toThrow();
  });

  it('never throws on non-finite measured difficulty', () => {
    const level = makeLevel();
    const verification = makeVerificationResult();

    expect(() => {
      calibrateDifficulty(level, verification, makeQualityReport(NaN));
    }).not.toThrow();

    expect(() => {
      calibrateDifficulty(level, verification, makeQualityReport(Infinity));
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// createDegradedPolicy — jump delay tests
// ---------------------------------------------------------------------------

/**
 * The degraded wrapper reads no state of its own — it forwards to the base
 * policy — so a scripted base policy that ignores its arguments drives it.
 */
function scriptedPolicy(script: readonly PlatformerInput[]): BotPolicy {
  let tick = 0;
  return (): PlatformerInput => script[Math.min(tick++, script.length - 1)];
}

const holdInput = (pressed: boolean): PlatformerInput =>
  ({ moveX: 0, jump: { held: true, pressed, released: false }, dash: null });

describe('createDegradedPolicy — jump delay', () => {
  // Both rows of the delay table must be pinned: asserting only "the jump
  // eventually fires" would pass against a fix that leaves the arming-tick
  // off-by-one (delay 1 firing on the SAME tick = zero delay), and the old
  // code dropped the press entirely at delay ≥ 2 because the base `pressed`
  // edge is 1 tick long and cannot still be true at expiry.
  const cfg = (jumpDelayTicks: number) => ({
    reactionDelayTicks: 0,
    jumpDelayTicks,
    jumpHoldReduction: 0,
    missedDashChance: 0,
  });
  const inertRng = (): number => 0; // 0 < 0 is false → hold/dash RNG never fires

  it('delay 1 fires exactly 1 tick late, not on the arming tick', () => {
    const policy = createDegradedPolicy(
      scriptedPolicy([holdInput(true), holdInput(false), holdInput(false), holdInput(false)]),
      cfg(1),
      inertRng,
    );
    const t0 = policy(null as never, {} as never);
    const t1 = policy(null as never, {} as never);
    const t2 = policy(null as never, {} as never);
    expect(t0.jump.pressed).toBe(false); // armed — suppressed this tick
    expect(t1.jump.pressed).toBe(true);  // fires exactly 1 tick later
    expect(t1.jump.held).toBe(true);
    expect(t2.jump.pressed).toBe(false); // and only once
    expect(t2.jump).toEqual({ held: true, pressed: false, released: false });
  });

  it('delay 2 fires exactly 2 ticks late, not dropped', () => {
    const policy = createDegradedPolicy(
      scriptedPolicy([
        holdInput(true), holdInput(false), holdInput(false), holdInput(false), holdInput(false),
      ]),
      cfg(2),
      inertRng,
    );
    const t0 = policy(null as never, {} as never);
    const t1 = policy(null as never, {} as never);
    const t2 = policy(null as never, {} as never);
    const t3 = policy(null as never, {} as never);
    expect(t0.jump.pressed).toBe(false); // armed
    expect(t1.jump.pressed).toBe(false); // still inside the delay window
    expect(t2.jump.pressed).toBe(true);  // fires exactly 2 ticks later
    expect(t3.jump.pressed).toBe(false); // and only once
  });

  it('never emits released before the delayed pressed (orphan release suppressed)', () => {
    // Press at t0, release at t1 — both inside the delay-2 window. Pre-fix the
    // base released edge passed straight through, so the consumer saw
    // released(t1) BEFORE the synthetic pressed(t2) and nothing after it. The
    // kernel's variable-jump cut keys on held-STATE (not this edge), so
    // suppressing the orphan needs no re-emit — held already drops the tick
    // after the synthetic press.
    const press = holdInput(true);
    const release: PlatformerInput = { moveX: 0, jump: { held: false, pressed: false, released: true }, dash: null };
    const idle: PlatformerInput = { moveX: 0, jump: { held: false, pressed: false, released: false }, dash: null };
    const policy = createDegradedPolicy(scriptedPolicy([press, release, idle, idle]), cfg(2), inertRng);
    const out = [0, 1, 2, 3].map(() => policy(null as never, {} as never));
    expect(out[0].jump.released).toBe(false);  // arming tick
    expect(out[1].jump.released).toBe(false);  // suppressed during the window
    expect(out[2].jump.pressed).toBe(true);    // fire tick
    expect(out[3].jump.released).toBe(false);  // passthrough resumes clean
  });

  it('delay 0 is a passthrough (no arming)', () => {
    const policy = createDegradedPolicy(
      scriptedPolicy([holdInput(true), holdInput(false)]),
      cfg(0),
      inertRng,
    );
    expect(policy(null as never, {} as never).jump.pressed).toBe(true);
    expect(policy(null as never, {} as never).jump.pressed).toBe(false);
  });

  it('suppresses jump hold during the delay window', () => {
    const policy = createDegradedPolicy(
      scriptedPolicy([holdInput(true), holdInput(false), holdInput(false)]),
      cfg(2),
      inertRng,
    );
    const t0 = policy(null as never, {} as never);
    const t1 = policy(null as never, {} as never);
    expect(t0.jump.held).toBe(false);
    expect(t1.jump.held).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runLowSkillPerturbation tests
// ---------------------------------------------------------------------------

describe('runLowSkillPerturbation', () => {
  it('returns a valid PerturbationResult with version 1', () => {
    const level = makeLevel();

    const result = runLowSkillPerturbation(level);

    expect(result).toBeDefined();
    expect(result.version).toBe(1);
    expect(typeof result.originalDifficulty).toBe('number');
    expect(typeof result.perturbedDifficulty).toBe('number');
    expect(typeof result.stillBeatable).toBe('boolean');
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });

  it('returns finite difficulty values in [0, 1]', () => {
    const level = makeLevel();

    const result = runLowSkillPerturbation(level);

    expect(Number.isFinite(result.originalDifficulty)).toBe(true);
    expect(Number.isFinite(result.perturbedDifficulty)).toBe(true);
    expect(result.originalDifficulty).toBeGreaterThanOrEqual(0);
    expect(result.originalDifficulty).toBeLessThanOrEqual(1);
    expect(result.perturbedDifficulty).toBeGreaterThanOrEqual(0);
    expect(result.perturbedDifficulty).toBeLessThanOrEqual(1);
  });

  it('perturbed difficulty is >= original difficulty', () => {
    const level = makeLevel();

    const result = runLowSkillPerturbation(level);

    // Perturbation makes the level harder (or equally hard) for the bot
    expect(result.perturbedDifficulty).toBeGreaterThanOrEqual(result.originalDifficulty - 0.001);
  });

  it('accepts custom perturbation config', () => {
    const level = makeLevel();
    const config: PerturbationConfig = {
      reactionDelayTicks: 5,
      jumpDelayTicks: 3,
      jumpHoldReduction: 0.5,
      missedDashChance: 0.3,
    };

    const result = runLowSkillPerturbation(level, config);

    expect(result.version).toBe(1);
    expect(Number.isFinite(result.originalDifficulty)).toBe(true);
    expect(Number.isFinite(result.perturbedDifficulty)).toBe(true);
  });

  it('never throws on null or undefined inputs', () => {
    // @ts-expect-error — testing invalid input
    expect(() => runLowSkillPerturbation(null)).not.toThrow();
    // @ts-expect-error — testing invalid input
    expect(() => runLowSkillPerturbation(undefined)).not.toThrow();
  });

  it('never throws on non-numeric config values', () => {
    const level = makeLevel();

    // NaN is a valid number type, no @ts-expect-error needed
    expect(() => runLowSkillPerturbation(level, { reactionDelayTicks: NaN })).not.toThrow();
    expect(() => runLowSkillPerturbation(level, { jumpDelayTicks: NaN })).not.toThrow();
    // Infinity is a valid number type, no @ts-expect-error needed
    expect(() => runLowSkillPerturbation(level, { jumpHoldReduction: Infinity })).not.toThrow();
  });

  it('returns stillBeatable as a boolean', () => {
    const level = makeLevel();

    const result = runLowSkillPerturbation(level);

    expect(typeof result.stillBeatable).toBe('boolean');
  });
});
