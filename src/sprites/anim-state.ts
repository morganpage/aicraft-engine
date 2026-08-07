/**
 * Character-agnostic animation-state deriver.
 *
 * Maps a minimal physics surface (`supported`, `speedX`, `velocityY`, …) onto
 * a semantic animation kind (`'idle'` / `'walk'` / `'ascent'` / `'apex'` /
 * `'descent'`). The branching mirrors `../character/humanoid/state.ts`'
 * `airPose` derivation so sprite characters animate with the same intent as
 * the procedural humanoid. Crucially, the SAME primitive drives both the
 * player (built from `PlatformerState.core`) and enemies (built from
 * `EnemyState` + a grounded check) — there is no player-specific logic here.
 *
 * Determinism: pure, no `Math.random` / `Date.now`.
 *
 * @module
 */

/** Semantic animation key. Maps 1:1 to a character's `animations` entry. */
export type SpriteAnimKind = 'idle' | 'walk' | 'ascent' | 'apex' | 'descent';

/**
 * Minimal physics surface any animated body can supply. Deliberately tiny so
 * both the player and enemies can construct it without coupling to a
 * specific simulation type.
 */
export interface SpriteAnimInputs {
  /** True when the body is supported by ground this tick. */
  readonly supported: boolean;
  /** Horizontal speed in px/s (sign indicates direction). */
  readonly speedX: number;
  /** Vertical velocity in px/s (world-down positive under normal gravity). */
  readonly velocityY: number;
  /** `1` for normal gravity (down), `-1` for inverted. Used so airborne
   * ascent/descent reads correctly on ceilings/walls. Default `1`. */
  readonly gravityDir?: 1 | -1;
  /** Absolute horizontal speed above which the body is "walking" vs "idle". */
  readonly walkThreshold?: number;
}

/** Defaults if the caller omits optional fields. */
const DEFAULT_WALK_THRESHOLD = 12; // px/s — below this the body reads as idle

/**
 * Derive the semantic animation kind from physics. Pure.
 *
 * Grounded: `|speedX| > threshold` → `'walk'`, else `'idle'`.
 * Airborne: `velocityY * gravityDir < 0` → `'ascent'`, `> 0` → `'descent'`,
 * else `'apex'`.
 *
 * Matches `humanoid/state.ts:50-56` thresholds (-0.5 / +0.5 vertical), scaled
 * to px/s.
 */
export function deriveSpriteAnimKind(inputs: SpriteAnimInputs): SpriteAnimKind {
  const gravityDir = inputs.gravityDir ?? 1;
  const threshold = inputs.walkThreshold ?? DEFAULT_WALK_THRESHOLD;
  if (inputs.supported) {
    return Math.abs(inputs.speedX) > threshold ? 'walk' : 'idle';
  }
  // Relative-to-gravity vertical velocity: negative = moving up, positive =
  // moving down. Same convention as `humanoid/state.ts`.
  const rel = (inputs.velocityY ?? 0) * gravityDir;
  if (rel < -0.5) return 'ascent';
  if (rel > 0.5) return 'descent';
  return 'apex';
}
