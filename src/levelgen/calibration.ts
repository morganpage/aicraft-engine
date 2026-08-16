/**
 * Difficulty band calibration and low-skill perturbation helpers for
 * procedural level generation.
 *
 * Provides:
 * - Pre-defined difficulty bands (low, medium, high) with configurable ranges.
 * - A `calibrateDifficulty` function that classifies a level's measured
 *   difficulty into the appropriate band.
 * - A `runLowSkillPerturbation` function that runs verification with degraded
 *   bot parameters to assess level robustness under low-skill play.
 *
 * **Determinism:** All functions are pure — same input → same output, forever.
 * No `Math.random`, no `Date.now()`, no global mutable state. Never throws.
 *
 * @module
 */

import type { LevelData } from '../level/types';
import type {
  VerificationResult,
  LevelQualityReport,
} from './types';
import { evaluateLevelQuality } from './quality';
import { verifyLevel } from '../leveltest/verify';
import type { LevelTestConfig } from '../leveltest/verify';
import type { PlatformerInput } from '../platformer/types';
import type { PolledEdge } from '../input/types';
import type { BotPolicy, BotContext } from '../leveltest/policies';
import { DEFAULT_BOT_POLICIES } from '../leveltest/policies';
import { mulberry32 } from '../rng/mulberry32';
import { canonicalize } from '../level/serialize';

// ---------------------------------------------------------------------------
// DifficultyBand
// ---------------------------------------------------------------------------

/**
 * A named difficulty band with a target difficulty.
 *
 * Bands partition the `[0, 1]` difficulty space into segments such as
 * `{ low: [0, 0.33], medium: [0.33, 0.67], high: [0.67, 1.0] }`.
 */
export interface DifficultyBand {
  /** Schema version. Must be `1`. */
  readonly version: 1;
  /** Human-readable label. */
  readonly label: 'low' | 'medium' | 'high';
  /** Minimum difficulty threshold (inclusive). */
  readonly minDifficulty: number;
  /** Maximum difficulty threshold (inclusive). */
  readonly maxDifficulty: number;
  /** Target difficulty within this band. */
  readonly targetDifficulty: number;
}

// ---------------------------------------------------------------------------
// Standard difficulty bands
// ---------------------------------------------------------------------------

/**
 * Low difficulty band: `[0, 0.33]` with target `0.15`.
 *
 * Suitable for early-game or tutorial levels where the player faces minimal
 * challenge.
 */
export const LOW_DIFFICULTY_BAND: DifficultyBand = Object.freeze({
  version: 1,
  label: 'low',
  minDifficulty: 0,
  maxDifficulty: 1 / 3,  // 0.333...
  targetDifficulty: 0.15,
});

/**
 * Medium difficulty band: `[0.33, 0.67]` with target `0.5`.
 *
 * Suitable for mid-game levels with moderate challenge, gaps, and hazards.
 */
export const MEDIUM_DIFFICULTY_BAND: DifficultyBand = Object.freeze({
  version: 1,
  label: 'medium',
  minDifficulty: 1 / 3,  // 0.333...
  maxDifficulty: 2 / 3,  // 0.666...
  targetDifficulty: 0.5,
});

/**
 * High difficulty band: `[0.67, 1.0]` with target `0.85`.
 *
 * Suitable for late-game or optional-challenge levels with tight jumps,
 * hazardous corridors, and precision requirements.
 */
export const HIGH_DIFFICULTY_BAND: DifficultyBand = Object.freeze({
  version: 1,
  label: 'high',
  minDifficulty: 2 / 3,  // 0.666...
  maxDifficulty: 1.0,
  targetDifficulty: 0.85,
});

/**
 * Default set of difficulty bands used when no custom bands are provided.
 * Ordered from lowest to highest difficulty.
 */
const DEFAULT_DIFFICULTY_BANDS: readonly DifficultyBand[] = Object.freeze([
  LOW_DIFFICULTY_BAND,
  MEDIUM_DIFFICULTY_BAND,
  HIGH_DIFFICULTY_BAND,
]);

// ---------------------------------------------------------------------------
// Calibration config and result
// ---------------------------------------------------------------------------

/**
 * Configuration for {@link calibrateDifficulty}.
 *
 * All fields are optional. When `bands` is omitted, the three standard bands
 * (low, medium, high) are used.
 */
export interface CalibrationConfig {
  /** Custom difficulty bands to use instead of the defaults. */
  readonly bands?: readonly DifficultyBand[];
}

/**
 * The result of calibrating a level's difficulty into a band.
 */
export interface CalibrationResult {
  /** Schema version. Must be `1`. */
  readonly version: 1;
  /** The difficulty band the level was classified into. */
  readonly band: DifficultyBand;
  /** The level's measured difficulty from quality evaluation. */
  readonly measuredDifficulty: number;
  /** Whether the measured difficulty falls within the band's range. */
  readonly withinBand: boolean;
  /** Diagnostic messages (e.g. boundary-edge warnings). */
  readonly diagnostics: readonly string[];
}

// ---------------------------------------------------------------------------
// calibrateDifficulty
// ---------------------------------------------------------------------------

/**
 * Calibrate a generated level's measured difficulty into a difficulty band.
 *
 * Classifies the level into the appropriate band based on its
 * `measuredDifficulty` (from the quality report). Returns the band,
 * whether the difficulty is within range, and any diagnostic messages.
 *
 * **Determinism:** Same `(level, verification, quality, config)` → same
 * result, forever.
 * **Never throws.** Invalid inputs degrade gracefully (first band with
 * diagnostics).
 *
 * @param level        - The generated level data.
 * @param verification - Verification result for this level.
 * @param quality      - Quality report containing `measuredDifficulty`.
 * @param config       - Optional calibration config (custom bands).
 * @returns A {@link CalibrationResult} — never throws.
 *
 * @example
 * ```ts
 * const result = calibrateDifficulty(level, verification, quality);
 * console.log(`Band: ${result.band.label}, within: ${result.withinBand}`);
 * ```
 */
export function calibrateDifficulty(
  _level: LevelData,
  verification: VerificationResult | undefined,
  quality: LevelQualityReport,
  config?: CalibrationConfig,
): CalibrationResult {
  try {
    const bands =
      config?.bands && Array.isArray(config.bands) && config.bands.length > 0
        ? config.bands
        : DEFAULT_DIFFICULTY_BANDS;

    const measuredDifficulty =
      quality?.measuredDifficulty != null &&
      typeof quality.measuredDifficulty === 'number' &&
      Number.isFinite(quality.measuredDifficulty)
        ? quality.measuredDifficulty
        : 0;

    const diagnostics: string[] = [];

    // The verification parameter earns its keep (0.17.0): a verification that
    // did not prove the level beatable is surfaced, not silently ignored.
    if (verification?.status === 'inconclusive') {
      diagnostics.push(
        'Verification was inconclusive — difficulty is calibrated against an unverified level.',
      );
    } else if (verification?.status === 'proven-unreachable') {
      diagnostics.push(
        'Verification proved the level unreachable — difficulty calibration is advisory only.',
      );
    }

    // Find the band containing the measured difficulty
    let band = bands[0];

    // First, try to match by range
    let foundExact = false;
    for (const b of bands) {
      if (measuredDifficulty >= b.minDifficulty && measuredDifficulty <= b.maxDifficulty) {
        band = b;
        foundExact = true;
        break;
      }
    }

    // If no band matched (e.g., boundary gap), find closest by midpoint
    if (!foundExact) {
      let minDist = Infinity;
      for (const b of bands) {
        const mid = (b.minDifficulty + b.maxDifficulty) / 2;
        const dist = Math.abs(measuredDifficulty - mid);
        if (dist < minDist) {
          minDist = dist;
          band = b;
        }
      }
      diagnostics.push(
        `Measured difficulty ${measuredDifficulty.toFixed(4)} fell between defined bands; ` +
        `assigned to nearest band "${band.label}".`,
      );
    }

    const withinBand =
      measuredDifficulty >= band.minDifficulty &&
      measuredDifficulty <= band.maxDifficulty;

    return {
      version: 1,
      band,
      measuredDifficulty,
      withinBand,
      diagnostics: Object.freeze(diagnostics) as readonly string[],
    };
  } catch {
    // Graceful degradation
    return {
      version: 1,
      band: LOW_DIFFICULTY_BAND,
      measuredDifficulty: 0,
      withinBand: true,
      diagnostics: Object.freeze(['Calibration failed unexpectedly.']) as readonly string[],
    };
  }
}

// ---------------------------------------------------------------------------
// Perturbation
// ---------------------------------------------------------------------------

/**
 * Configuration for low-skill perturbation runs.
 *
 * All fields are optional with sensible defaults that simulate a player
 * who reacts slower, holds jump less, and sometimes misses dashes.
 */
export interface PerturbationConfig {
  /** Ticks of delay before the bot reacts to inputs (default `3`). */
  readonly reactionDelayTicks?: number;
  /** Ticks of delay before the bot jumps after deciding to (default `2`). */
  readonly jumpDelayTicks?: number;
  /** Fraction to reduce jump hold time (default `0.2` = 20% reduction). */
  readonly jumpHoldReduction?: number;
  /** Probability of missing an intended dash (default `0.1` = 10%). */
  readonly missedDashChance?: number;
}

/**
 * The result of a low-skill perturbation run.
 *
 * Compares the original difficulty against the perturbed difficulty and
 * reports whether the level is still beatable by the degraded bot.
 */
export interface PerturbationResult {
  /** Schema version. Must be `1`. */
  readonly version: 1;
  /** Original difficulty (unperturbed). */
  readonly originalDifficulty: number;
  /** Difficulty after perturbation (should be >= original). */
  readonly perturbedDifficulty: number;
  /** Whether the degraded bot was still able to beat the level. */
  readonly stillBeatable: boolean;
  /** Diagnostic messages from the perturbation run. */
  readonly diagnostics: readonly string[];
}

// ---------------------------------------------------------------------------
// Default perturbation parameters
// ---------------------------------------------------------------------------

/** Default ticks of reaction delay for the perturbation bot. */
const DEFAULT_REACTION_DELAY_TICKS = 3;
/** Default ticks of jump delay for the perturbation bot. */
const DEFAULT_JUMP_DELAY_TICKS = 2;
/** Default fraction to reduce jump hold time. */
const DEFAULT_JUMP_HOLD_REDUCTION = 0.2;
/** Default probability of missing a dash. */
const DEFAULT_MISSED_DASH_CHANCE = 0.1;

// ---------------------------------------------------------------------------
// Degraded policy factory
// ---------------------------------------------------------------------------

/**
 * Create a degraded bot policy that wraps a base policy with:
 *  - Reaction delay (initial idle ticks).
 *  - Delayed jumping.
 *  - Reduced jump hold time.
 *  - Optional missed dashes.
 *
 * The wrapper is deterministic — it uses the tick number and a seeded RNG
 * derived from the level canonical hash for the missed-dash chance.
 *
 * Exported at the module level (not the barrel) so the delay semantics are
 * unit-testable without driving a full verification run.
 *
 * @param basePolicy  - The bot policy to wrap.
 * @param config      - Perturbation parameters.
 * @param rng         - A seeded RNG for missed-dash decisions.
 * @returns A degraded bot policy function.
 */
export function createDegradedPolicy(
  basePolicy: BotPolicy,
  config: Required<PerturbationConfig>,
  rng: () => number,
): BotPolicy {
  let reactionRemaining = config.reactionDelayTicks;
  let jumpDelayed = 0;
  let lastJumpPressed = false;

  return (state: import('../platformer/types').PlatformerState, ctx: BotContext): PlatformerInput => {
    // Reaction delay: first N ticks output idle
    if (reactionRemaining > 0) {
      reactionRemaining--;
      return {
        moveX: 0,
        jump: { held: false, pressed: false, released: false },
        dash: { held: false, pressed: false, released: false },
      };
    }

    // Get base action from the original policy
    const baseInput = basePolicy(state, ctx);

    // Modifications
    let moveX = baseInput.moveX;
    let jumpHeld = baseInput.jump.held;
    let jumpPressed = baseInput.jump.pressed;
    let jumpReleased = baseInput.jump.released;
    // Dash is nullable — handle gracefully
    let dash: PolledEdge | null = baseInput.dash;

    // Jump delay: re-fire the press N ticks later. Two hazards make a naive
    // counter wrong. The base `pressed` edge lasts exactly one tick, so gating
    // the re-fire on it drops every delay ≥ 2 (the edge is long gone at
    // expiry). And decrementing on the arming tick makes N=1 fire on the SAME
    // tick — zero delay. So: latch the press (counter > 0), skip the decrement
    // on the arming tick so N means N ticks, and fire a synthetic edge on
    // expiry regardless of the current base edge. A delay of 0 is a pure
    // passthrough (nothing is armed).
    if (jumpPressed && !lastJumpPressed && config.jumpDelayTicks > 0) {
      jumpDelayed = config.jumpDelayTicks;
      // Don't press jump yet — delay it
      jumpPressed = false;
      jumpHeld = false;
    } else if (jumpDelayed > 0) {
      jumpDelayed--;
      if (jumpDelayed === 0) {
        // Fire the latched press — the base edge cannot still be true here.
        jumpPressed = true;
        jumpHeld = true;
      } else {
        jumpHeld = false;
      }
    }

    // Edge hygiene: while a press is latched, the base release edge must not
    // leak through — the consumer has not seen the press yet, so a `released`
    // before any `pressed` is a lie on the wire. No re-emit on expiry: the
    // kernel's variable-jump cut keys on held-STATE, not this edge.
    if (jumpDelayed > 0) jumpReleased = false;

    // Jump hold reduction: if holding jump, reduce hold time
    if (jumpHeld && config.jumpHoldReduction > 0) {
      // Probabilistic release: each tick there's a chance to release early
      if (rng() < config.jumpHoldReduction) {
        jumpHeld = false;
        jumpReleased = true;
      }
    }

    // Missed dash: sometimes skip the dash action
    if (dash != null && dash.pressed && rng() < config.missedDashChance) {
      dash = null;
    }

    lastJumpPressed = baseInput.jump.pressed;

    return {
      moveX,
      jump: { held: jumpHeld, pressed: jumpPressed, released: jumpReleased },
      dash,
    };
  };
}

// ---------------------------------------------------------------------------
// runLowSkillPerturbation
// ---------------------------------------------------------------------------

/**
 * Run a low-skill perturbation assessment on a platformer level.
 *
 * The perturbation runs the level verification with modified bot parameters
 * that simulate a less-skilled player (reaction delay, delayed jumping,
 * reduced jump hold, missed dashes). The result compares the original
 * difficulty against the perturbed difficulty and indicates whether the
 * level remains beatable.
 *
 * **Determinism:** Same `(level, config)` → same result, forever.
 * The missed-dash randomness is seeded from the level's canonical hash.
 * **Never throws.** Invalid inputs degrade gracefully.
 *
 * @param level  - The generated level data to assess.
 * @param config - Optional perturbation parameters.
 * @returns A {@link PerturbationResult} — never throws.
 *
 * @example
 * ```ts
 * const result = runLowSkillPerturbation(levelData);
 * if (result.stillBeatable) {
 *   console.log('Level is robust to low-skill play.');
 * }
 * console.log(`Difficulty increase: ${result.perturbedDifficulty - result.originalDifficulty}`);
 * ```
 */
export function runLowSkillPerturbation(
  level: LevelData,
  config?: PerturbationConfig,
): PerturbationResult {
  try {
    const lvl = level ?? ({} as LevelData);

    // Merge config with defaults
    const cfg: Required<PerturbationConfig> = {
      reactionDelayTicks:
        typeof config?.reactionDelayTicks === 'number' && Number.isFinite(config.reactionDelayTicks)
          ? Math.max(0, Math.floor(config.reactionDelayTicks))
          : DEFAULT_REACTION_DELAY_TICKS,
      jumpDelayTicks:
        typeof config?.jumpDelayTicks === 'number' && Number.isFinite(config.jumpDelayTicks)
          ? Math.max(0, Math.floor(config.jumpDelayTicks))
          : DEFAULT_JUMP_DELAY_TICKS,
      jumpHoldReduction:
        typeof config?.jumpHoldReduction === 'number' && Number.isFinite(config.jumpHoldReduction)
          ? Math.max(0, Math.min(1, config.jumpHoldReduction))
          : DEFAULT_JUMP_HOLD_REDUCTION,
      missedDashChance:
        typeof config?.missedDashChance === 'number' && Number.isFinite(config.missedDashChance)
          ? Math.max(0, Math.min(1, config.missedDashChance))
          : DEFAULT_MISSED_DASH_CHANCE,
    };

    const diagnostics: string[] = [];

    // -----------------------------------------------------------------------
    // Step 1: Run original verification
    // -----------------------------------------------------------------------
    const originalVerification = verifyLevel(lvl);
    const originalQuality = evaluateLevelQuality(lvl, originalVerification);
    const originalDifficulty = originalQuality.measuredDifficulty;

    // -----------------------------------------------------------------------
    // Step 2: Create degraded policies
    // -----------------------------------------------------------------------

    // Derive a seed for missed-dash RNG from the level's canonical hash
    const canonicalStr = canonicalize(lvl);
    let rngSeed = 0;
    for (let i = 0; i < canonicalStr.length; i++) {
      rngSeed = Math.imul(rngSeed ^ canonicalStr.charCodeAt(i), 0x01000193) >>> 0;
    }
    // XOR with a perturbation salt
    rngSeed = (rngSeed ^ 0x50455254) >>> 0; // "PERT"

    const rng = mulberry32(rngSeed);

    const degradedPolicies: BotPolicy[] = [];
    for (const policy of DEFAULT_BOT_POLICIES) {
      degradedPolicies.push(createDegradedPolicy(policy, cfg, rng));
    }

    // -----------------------------------------------------------------------
    // Step 3: Run degraded verification
    // -----------------------------------------------------------------------
    const testConfig: LevelTestConfig = {
      policies: degradedPolicies,
    };

    const perturbedVerification = verifyLevel(lvl, testConfig);
    const perturbedQuality = evaluateLevelQuality(lvl, perturbedVerification);
    const perturbedDifficulty = perturbedQuality.measuredDifficulty;

    // -----------------------------------------------------------------------
    // Step 4: Determine beatability
    // -----------------------------------------------------------------------
    const stillBeatable = perturbedVerification.status === 'proven-beatable';

    if (perturbedVerification.status === 'inconclusive') {
      diagnostics.push(
        'Perturbed verification was inconclusive (no bot found a winning path).',
      );
    }

    diagnostics.push(
      `Original difficulty: ${originalDifficulty.toFixed(4)}, ` +
      `Perturbed difficulty: ${perturbedDifficulty.toFixed(4)}`,
    );

    return {
      version: 1,
      originalDifficulty,
      perturbedDifficulty,
      stillBeatable,
      diagnostics: Object.freeze(diagnostics) as readonly string[],
    };
  } catch {
    // Graceful degradation
    return {
      version: 1,
      originalDifficulty: 0,
      perturbedDifficulty: 0,
      stillBeatable: false,
      diagnostics: Object.freeze(['Perturbation assessment failed unexpectedly.']) as readonly string[],
    };
  }
}
