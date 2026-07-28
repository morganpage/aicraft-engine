/**
 * Pacing/rhythm plan generation.
 *
 * Generates a sequence of {@link PacingBeat}s from a seed and config.
 * The rhythm follows a default intensity curve:
 *
 * ```text
 * introduction → build-up → rest → escalation → climax → release
 * ```
 *
 * Each beat maps to a horizontal segment of the level. The same
 * `(seed, config)` always produces the same rhythm.
 *
 * Determinism: uses `mulberry32` for all randomness. No `Math.random`,
 * no `Date.now`, no global mutable state.
 *
 * @module
 */

import type { LevelGenConfig, PacingBeat } from './types';
import { mulberry32, pick } from '../rng/mulberry32';
import { RHYTHM_SEED_SALT } from './constants';

/**
 * A phase of the default intensity curve. Each phase maps to a section
 * of the level and determines the pool of compatible beats.
 */
type CurvePhase =
  | 'introduction'
  | 'build-up'
  | 'rest'
  | 'escalation'
  | 'climax'
  | 'release';

/**
 * Beat pools for each curve phase. Lower-intensity phases have fewer
 * challenging beats in their pool.
 */
const BEAT_POOLS: Record<CurvePhase, readonly PacingBeat[]> = {
  'introduction': ['introduce', 'run', 'rest'],
  'build-up': ['run', 'jump', 'rest'],
  'rest': ['rest', 'run', 'reward'],
  'escalation': ['jump', 'precisionJump', 'run', 'dash', 'branch'],
  'climax': ['precisionJump', 'jump', 'climax', 'dash'],
  'release': ['run', 'rest', 'release', 'reward'],
};

/**
 * Order of curve phases. The rhythm advances through these in sequence;
 * when the beat count exceeds the number of phases, the curve loops back
 * to 'escalation' (pushing intensity up).
 */
const CURVE_ORDER: readonly CurvePhase[] = [
  'introduction',
  'build-up',
  'rest',
  'escalation',
  'climax',
  'release',
];

/**
 * Maximum number of beats to generate.
 */
const MAX_BEATS = 32;

/**
 * Generate a deterministic pacing/rhythm sequence.
 *
 * The number of beats is derived from the level width and difficulty.
 * Each beat is selected from a phase-appropriate pool using seeded
 * randomness, following the default intensity curve.
 *
 * Pure: never mutates input, never throws. Returns a non-empty array
 * of pacing beats.
 *
 * @param seed   - Deterministic seed.
 * @param config - Level generation config (columns, difficulty).
 * @returns Array of pacing beats, one per level segment.
 *
 * @example
 * ```ts
 * const rhythm = generateRhythm(42, { cols: 60, rows: 15, tileSize: 16, difficulty: 0.5 });
 * // rhythm[0] === 'introduce'
 * // rhythm[rhythm.length - 1] === 'release'
 * ```
 */
export function generateRhythm(
  seed: number,
  config: Readonly<LevelGenConfig>,
): readonly PacingBeat[] {
  const rng = mulberry32((seed >>> 0) ^ RHYTHM_SEED_SALT);

  // Defensive null/undefined check for config.
  const safeConfig: LevelGenConfig = config ?? {};

  // Parse config with safe defaults.
  const cols = (typeof safeConfig.cols === 'number' && safeConfig.cols > 0) ? safeConfig.cols : 60;
  const difficulty = (typeof safeConfig.difficulty === 'number' && Number.isFinite(safeConfig.difficulty))
    ? Math.max(0, Math.min(1, safeConfig.difficulty))
    : 0.5;

  // Number of beats scales with level width and difficulty.
  // At difficulty 0.5 and cols=60: ~7 beats. At difficulty 1.0: up to ~14.
  const rawBeatCount = Math.max(4, Math.floor(cols / 8 * (0.5 + difficulty * 0.5)));
  const beatCount = Math.min(rawBeatCount, MAX_BEATS);

  const beats: PacingBeat[] = [];

  for (let i = 0; i < beatCount; i++) {
    // Map beat index to curve phase.
    // First few beats follow CURVE_ORDER; after that, loop back to escalation.
    const phaseIndex = Math.min(i, CURVE_ORDER.length - 1);
    const phase = CURVE_ORDER[Math.min(phaseIndex, CURVE_ORDER.length - 1)];

    const pool = BEAT_POOLS[phase];
    let beat = pick<PacingBeat>(rng, pool);

    // At higher difficulty, push some beats toward more intense variants.
    if (difficulty > 0.7 && rng() < 0.3) {
      const upgradePool = BEAT_POOLS['escalation'];
      beat = pick<PacingBeat>(rng, upgradePool);
    }

    beats.push(beat);
  }

  // Ensure the final beat is always 'release' for a gentle ending.
  if (beats.length > 0 && beats[beats.length - 1] !== 'release') {
    beats[beats.length - 1] = 'release';
  }

  return beats;
}
