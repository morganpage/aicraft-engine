/**
 * Named `PlatformerConfig` presets for common platformer feels (Pillar 4 glue).
 *
 * Each preset spreads `DEFAULT_PLATFORMER_CONFIG` and overrides a handful of
 * fields to capture a recognizable feel. Spread a preset into your own
 * object to override individual fields without re-typing the whole record.
 *
 * Pure data: no `Math.random`, no `Date.now`, no DOM reads. Deterministic.
 *
 * @module
 */

import { DEFAULT_PLATFORMER_CONFIG } from './constants';
import type { PlatformerConfig } from './types';

/**
 * Snappy precision feel (Celeste-like). The default config already targets
 * this feel — this preset is the canonical alias for it.
 *
 * - Tight ground control, snappy jump, gentle wall-slide.
 * - Dash enabled (one per airborne cycle).
 * - No double-jump.
 *
 * Spread `PRECISION_PLATFORMER` into your own object to override individual
 * fields without losing the defaults.
 */
export const PRECISION_PLATFORMER: Readonly<PlatformerConfig> = {
  ...DEFAULT_PLATFORMER_CONFIG,
};

/**
 * Classic 8/16-bit feel (Mario-like). Higher gravity for a heavier fall,
 * faster ground run, no abilities — the player relies on jump timing alone.
 *
 * - Gravity bumped to ~1400 px/s² for a punchier fall.
 * - Move speed up to 240 px/s.
 * - Reduced air control (0.5) — stiffer in the air like the genre classic.
 * - No dash, no wall-slide, no double-jump.
 */
export const CLASSIC_PLATFORMER: Readonly<PlatformerConfig> = {
  ...DEFAULT_PLATFORMER_CONFIG,
  gravity: 1400,
  maxFallSpeed: 700,
  moveSpeed: 240,
  airControl: 0.5,
  wallSlideEnabled: false,
  dashEnabled: false,
  maxDashes: 0,
  doubleJumpEnabled: false,
  maxDoubleJumps: 0,
};

/**
 * Exploration feel (Hollow Knight-like). Floaty jumps, generous air control,
 * wall-slide for vertical traversal — but no dash (add it later via your own
 * override if your build unlocks it as an ability).
 *
 * - Gravity lowered to ~800 px/s² for longer hangs.
 * - Slower run (180 px/s).
 * - Air control 0.9 — almost full ground control while airborne.
 * - Wall-slide on (no wall-jump lock change).
 * - No dash, no double-jump.
 */
export const EXPLORATION_PLATFORMER: Readonly<PlatformerConfig> = {
  ...DEFAULT_PLATFORMER_CONFIG,
  gravity: 800,
  maxFallSpeed: 500,
  moveSpeed: 180,
  airControl: 0.9,
  wallSlideEnabled: true,
  dashEnabled: false,
  maxDashes: 0,
  doubleJumpEnabled: false,
  maxDoubleJumps: 0,
};

/**
 * Puzzle / pit-death feel (Spitekeep-like). Tight grid movement, one jump,
 * no abilities — every death is the player's fault, not the controller's.
 *
 * - Gravity 1200 px/s² for a quick, legible fall (Spitekeep's lava pits).
 * - Slow move speed (120 px/s) so tile-precise positioning is achievable.
 * - Very tight air control (0.3) — jumps are a commitment.
 * - No dash, no wall-slide, no double-jump.
 */
export const PUZZLE_PLATFORMER: Readonly<PlatformerConfig> = {
  ...DEFAULT_PLATFORMER_CONFIG,
  gravity: 1200,
  maxFallSpeed: 600,
  moveSpeed: 120,
  airControl: 0.3,
  wallSlideEnabled: false,
  dashEnabled: false,
  maxDashes: 0,
  doubleJumpEnabled: false,
  maxDoubleJumps: 0,
};
