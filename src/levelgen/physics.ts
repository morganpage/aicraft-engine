/**
 * Physics constraint derivation for level generation.
 *
 * Derives maximum jump distances, step-up heights, and gap widths from the
 * authoritative `PlatformerConfig`. These constraints are used during
 * realization to ensure all required trajectories are feasible.
 *
 * **Important:** The formulas below are conservative estimates, not proofs
 * of traversability. True feasibility depends on the full joint trajectory
 * (horizontal + vertical displacement), player body dimensions, and
 * fixed-timestep integration. See the trajectory sampler in `leveltest/`
 * for authoritative verification.
 *
 * Determinism: pure functions, no global state, no `Math.random`, no
 * `Date.now`. Same inputs → same outputs forever.
 *
 * @module
 */

import type { PlatformerConfig } from '../platformer/types';

/**
 * Physics constraints derived from a `PlatformerConfig` and tile size.
 *
 * All distances are in pixels.
 */
export interface PhysicsConstraints {
  /** Maximum horizontal distance reachable by a single jump (pixels). */
  readonly maxJumpDistance: number;
  /** Maximum vertical step-up height reachable by a single jump (pixels). */
  readonly maxStepUp: number;
  /** Maximum horizontal gap a jump can clear (pixels). */
  readonly maxGapWidth: number;
  /** Maximum step-up height in whole tiles. */
  readonly maxStepUpTiles: number;
  /** Horizontal speed boost from a dash (pixels/s). */
  readonly dashBoost: number;
}

/**
 * Derive the estimated maximum horizontal jump distance.
 *
 * Uses the simple formula: `2 × moveSpeed × timeToApex`. This assumes the
 * player runs at full speed for the full duration of the jump's rising
 * phase. Actual reachable distance may vary based on air control, jump
 * hold time, and gravity.
 *
 * **Not a proof of traversability.** Use the trajectory sampler in
 * `leveltest/` for authoritative verification.
 *
 * Pure: never throws; returns `0` for non-finite inputs.
 *
 * @param config - Authoritative platformer config.
 * @returns Estimated horizontal jump distance in pixels.
 *
 * @example
 * ```ts
 * const dist = deriveMaxJumpDistance(DEFAULT_PLATFORMER_CONFIG);
 * // dist ≈ 2 * 200 * 0.28 = 112 px
 * ```
 */
export function deriveMaxJumpDistance(config: Readonly<PlatformerConfig>): number {
  if (!config || typeof config.moveSpeed !== 'number' || typeof config.jump?.timeToApex !== 'number') {
    return 0;
  }
  if (!Number.isFinite(config.moveSpeed) || !Number.isFinite(config.jump.timeToApex)) {
    return 0;
  }
  return 2 * config.moveSpeed * config.jump.timeToApex;
}

/**
 * Derive the estimated maximum vertical step-up height.
 *
 * Uses the apex height from the jump config. The apex height is the maximum
 * vertical displacement a jump can achieve from a standing start.
 *
 * Pure: never throws; returns `0` for non-finite inputs.
 *
 * @param config - Authoritative platformer config.
 * @returns Estimated maximum step-up height in pixels.
 *
 * @example
 * ```ts
 * const stepUp = deriveMaxStepUp(DEFAULT_PLATFORMER_CONFIG);
 * // stepUp ≈ 48 px (DEFAULT_JUMP.apexHeight)
 * ```
 */
export function deriveMaxStepUp(config: Readonly<PlatformerConfig>): number {
  if (!config || typeof config.jump?.apexHeight !== 'number') {
    return 0;
  }
  if (!Number.isFinite(config.jump.apexHeight)) {
    return 0;
  }
  return config.jump.apexHeight;
}

/**
 * Derive all physics constraints from a platformer config and tile size.
 *
 * Combines individual derivations into a single record for convenience.
 * All returned distances are in pixels.
 *
 * Pure: never throws; returns zeroed constraints for non-finite inputs.
 *
 * @example
 * ```ts
 * const pc = derivePhysicsConstraints(DEFAULT_PLATFORMER_CONFIG, 16);
 * // pc.maxJumpDistance ≈ 112
 * // pc.maxStepUp ≈ 48
 * // pc.maxGapWidth ≈ 112
 * // pc.maxStepUpTiles ≈ 3
 * ```
 *
 * @param config   - Authoritative platformer config.
 * @param tileSize - Tile size in pixels (must be > 0).
 * @returns Complete physics constraints record.
 */
export function derivePhysicsConstraints(
  config: Readonly<PlatformerConfig>,
  tileSize: number,
): PhysicsConstraints {
  const maxJumpDistance = deriveMaxJumpDistance(config);
  const maxStepUp = deriveMaxStepUp(config);
  const tileSizeValid = typeof tileSize === 'number' && Number.isFinite(tileSize) && tileSize > 0;
  const ts = tileSizeValid ? tileSize : 16;

  return {
    maxJumpDistance,
    maxStepUp,
    maxGapWidth: maxJumpDistance,
    maxStepUpTiles: Math.floor(maxStepUp / ts),
    dashBoost: config?.dashEnabled && Number.isFinite(config.dashSpeed)
      ? (config.dashSpeed ?? 0)
      : 0,
  };
}
