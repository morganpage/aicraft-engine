/**
 * Jump-arc precomputation and trajectory sampling for platformer levels.
 *
 * The trajectory sampler evaluates whether a jump from one standing surface
 * to another is feasible given the authoritative physics. It evaluates the
 * **joint** trajectory — computing the actual airtime from the vertical
 * displacement, then deriving the achievable horizontal distance — rather
 * than checking independent horizontal and vertical maxima.
 *
 * **Determinism:** All functions are pure — same input → same output, forever.
 * No `Math.random`, no `Date.now()`, no DOM reads, no global mutable state.
 *
 * **Phase 3 note:** These formulas are conservative estimates that agree with
 * fixed-step simulation within documented bounds for simple cases. They are
 * **not** proof of traversability for complex trajectories (ceiling collisions,
 * variable-height cutoffs, double-jumps, etc.).
 *
 * @module
 */

import type { PlatformerConfig } from '../platformer/types';

// ---------------------------------------------------------------------------
// JumpArcConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for jump-arc sampling.
 *
 * Player dimensions (`playerWidth`, `playerHeight`) are provided for forward
 * compatibility with more detailed trajectory simulation. Phase 3 uses the
 * authoritative `PlatformerConfig` for physics, not player body dimensions.
 *
 * @example
 * ```ts
 * const config: JumpArcConfig = {
 *   playerWidth: 16,
 *   playerHeight: 24,
 *   platformerConfig: DEFAULT_PLATFORMER_CONFIG,
 *   safetyMargin: 0.1,
 * };
 * ```
 */
export interface JumpArcConfig {
  /** Player body width in world units. */
  readonly playerWidth: number;
  /** Player body height in world units. */
  readonly playerHeight: number;
  /** Authoritative platformer tuning config (source of truth for jump physics). */
  readonly platformerConfig: Readonly<PlatformerConfig>;
  /**
   * Safety margin as a fraction in `[0, 1)`. Effective max distance is
   * reduced by this fraction (e.g. `0.1` = 10% margin). Default `0`.
   */
  readonly safetyMargin?: number;
}

// ---------------------------------------------------------------------------
// JumpArcResult
// ---------------------------------------------------------------------------

/**
 * The result of evaluating a jump arc between two surfaces.
 *
 * All numeric fields are finite. `feasible` is `true` when the gap can be
 * cleared (possibly requiring a dash). `requiresDash` is `true` only when
 * the jump needs a dash to be feasible.
 */
export interface JumpArcResult {
  /** `true` if the gap can be cleared with or without a dash. */
  readonly feasible: boolean;
  /** Horizontal gap between the closest edges of the two surfaces (≥ 0). */
  readonly horizontalDistance: number;
  /** Vertical distance from takeoff to landing (positive = step up). */
  readonly verticalDistance: number;
  /** Estimated airtime in seconds for the jump arc (finite, ≥ 0). */
  readonly airtime: number;
  /** Difficulty score in `[0, 1]` (0 = trivial, 1 = maximum flat jump). */
  readonly difficulty: number;
  /** `true` when a dash is required to cover the gap. */
  readonly requiresDash: boolean;
  /**
   * Fraction of the available horizontal distance remaining after the gap.
   * Positive when feasible (how "safe" the jump is), negative when not
   * feasible (how much the player is short by).
   */
  readonly marginRemaining: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a number to `[0, 1]`. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Clamp a number to finite and at least 0. */
function clampFinite(v: number, min: number): number {
  if (!Number.isFinite(v)) return min;
  return v < min ? min : v;
}

// ---------------------------------------------------------------------------
// computeJumpArc
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a jump from one standing surface to another is feasible.
 *
 * The function uses apex-parameterized jump physics from the authoritative
 * `PlatformerConfig` to compute the joint trajectory. It derives gravity
 * and launch velocity from `jump.apexHeight` and `jump.timeToApex`, then
 * calculates the total airtime given the vertical displacement between
 * surfaces. The maximum horizontal distance achievable during that airtime
 * is compared against the horizontal gap between the surfaces.
 *
 * A configurable safety margin reduces the effective max distance, and dash
 * boost is considered for jumps that exceed normal capability.
 *
 * **Pure:** never mutates input, never throws. Non-finite inputs are clamped
 * gracefully.
 *
 * @param from - The takeoff surface (the one the player is standing on).
 * @param to   - The target landing surface.
 * @param config - Jump-arc configuration including player dimensions and
 *                 authoritative platformer config.
 * @returns A `JumpArcResult` with feasibility, distances, difficulty, and margin.
 *
 * @example
 * ```ts
 * const result = computeJumpArc(
 *   { x: 0, y: 280, width: 64 },
 *   { x: 96, y: 280, width: 64 },
 *   {
 *     playerWidth: 16,
 *     playerHeight: 24,
 *     platformerConfig: DEFAULT_PLATFORMER_CONFIG,
 *   },
 * );
 * // result.feasible === (gap 32 <= max distance)
 * ```
 */
export function computeJumpArc(
  from: { readonly x: number; readonly y: number; readonly width: number },
  to: { readonly x: number; readonly y: number; readonly width: number },
  config: JumpArcConfig,
): JumpArcResult {
  // -----------------------------------------------------------------------
  // Defensive clamping (never throw on non-finite input)
  // -----------------------------------------------------------------------
  const fx = clampFinite(from.x, 0);
  const fy = clampFinite(from.y, 0);
  const fw = Math.max(0, clampFinite(from.width, 0));
  const tx = clampFinite(to.x, 0);
  const ty = clampFinite(to.y, 0);
  const tw = Math.max(0, clampFinite(to.width, 0));

  const jumpConfig = config.platformerConfig.jump;
  const apexHeight = clampFinite(jumpConfig.apexHeight, 1);
  const timeToApex = clampFinite(jumpConfig.timeToApex, 0.001);
  const moveSpeed = clampFinite(config.platformerConfig.moveSpeed, 0);
  const dashSpeed = clampFinite(config.platformerConfig.dashSpeed, 0);
  const dashDuration = clampFinite(config.platformerConfig.dashDuration, 0);
  const safetyMargin = typeof config.safetyMargin === 'number'
    ? clampFinite(config.safetyMargin, 0)
    : 0;

  // -----------------------------------------------------------------------
  // Horizontal gap between surface edges (air between them)
  // -----------------------------------------------------------------------
  const rightmostLeftEdge = Math.max(fx, tx);
  const leftmostRightEdge = Math.min(fx + fw, tx + tw);
  const gap = Math.max(0, rightmostLeftEdge - leftmostRightEdge);

  // -----------------------------------------------------------------------
  // Vertical displacement (positive = landing higher than takeoff)
  // -----------------------------------------------------------------------
  const verticalDistance = ty - fy;

  // -----------------------------------------------------------------------
  // Derived jump physics
  //   gravity = 2 * apexHeight / timeToApex²
  //   launchVelocity = -2 * apexHeight / timeToApex
  // -----------------------------------------------------------------------
  const gravity = (2 * apexHeight) / (timeToApex * timeToApex);

  // -----------------------------------------------------------------------
  // Impossible height check (step-up too high)
  // -----------------------------------------------------------------------
  // With +Y down, verticalDistance = ty - fy is negative when landing is
  // above takeoff. The player's apex is at fy - apexHeight. Landing at ty
  // is impossible when ty < fy - apexHeight, i.e. -verticalDistance > apexHeight.
  if (verticalDistance < -apexHeight) {
    // The landing is higher than the player can reach.
    const flatAirtime = 2 * timeToApex;
    const maxHoriz = moveSpeed * flatAirtime;
    return {
      feasible: false,
      horizontalDistance: gap,
      verticalDistance,
      airtime: flatAirtime,
      difficulty: clamp01(gap / (maxHoriz || 1)),
      requiresDash: false,
      // How far above apex the landing is (as fraction of apexHeight)
      marginRemaining: -(verticalDistance + apexHeight) / apexHeight,
    };
  }

  // -----------------------------------------------------------------------
  // Joint trajectory: compute airtime from vertical displacement
  // -----------------------------------------------------------------------
  // The player launches from fy, rises to fy - apexHeight (the apex), then
  // falls to the landing at ty. With +Y down, the fall distance from apex
  // to landing is:
  //
  //   fallDistance = ty - (fy - apexHeight)
  //                = (ty - fy) + apexHeight
  //                = verticalDistance + apexHeight
  //
  // For a flat jump (verticalDistance = 0): fallDistance = apexHeight
  // For a step-up (verticalDistance < 0):   fallDistance < apexHeight
  // For a step-down (verticalDistance > 0):  fallDistance > apexHeight
  const riseTime = timeToApex;
  const fallDistance = Math.max(0, apexHeight + verticalDistance);
  const fallTime = Math.sqrt((2 * fallDistance) / gravity);
  const airtime = riseTime + fallTime;

  // -----------------------------------------------------------------------
  // Maximum horizontal distance during this jump arc
  // -----------------------------------------------------------------------
  const maxHorizontal = moveSpeed * airtime;
  const safetyFactor = 1 - safetyMargin;
  const effectiveMaxHorizontal = maxHorizontal * safetyFactor;

  // -----------------------------------------------------------------------
  // Feasibility without dash
  // -----------------------------------------------------------------------
  const feasible = gap <= effectiveMaxHorizontal;

  // -----------------------------------------------------------------------
  // Dash boost
  // -----------------------------------------------------------------------
  // If the jump exceeds normal range but is within normal + dash, it
  // requires a dash. The dash provides a fixed horizontal burst.
  const dashBoost = dashSpeed * dashDuration;
  const dashExtended = dashBoost * safetyFactor;
  const requiresDash = !feasible && gap <= effectiveMaxHorizontal + dashExtended;

  // -----------------------------------------------------------------------
  // Margin remaining
  // -----------------------------------------------------------------------
  const effectiveLimit = requiresDash
    ? effectiveMaxHorizontal + dashExtended
    : effectiveMaxHorizontal;
  const marginRemaining = effectiveLimit > 0
    ? (effectiveLimit - gap) / effectiveLimit
    : 0;

  // -----------------------------------------------------------------------
  // Difficulty (relative to flat-ground max jump)
  // -----------------------------------------------------------------------
  const flatMaxDist = 2 * moveSpeed * timeToApex;
  const difficulty = clamp01(gap / (flatMaxDist || 1));

  return {
    feasible: feasible || requiresDash,
    horizontalDistance: gap,
    verticalDistance,
    airtime,
    difficulty,
    requiresDash,
    marginRemaining,
  };
}
