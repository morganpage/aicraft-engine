/**
 * Unit-aware config scaling for the platformer kernel (Workstream D1).
 *
 * `PlatformerConfig` is a FLAT record of ~60 fields spanning many physical
 * units — distances (px), velocities (px/s), accelerations (px/s²), times (s),
 * dimensionless ratios, counts, and booleans, plus the nested `jump`
 * (`JumpConfig`) and `squash` (`SquashConfig`) sub-records. The original
 * hardening brief told builders to "scale every pixel value by tileSize/16";
 * applied blindly that corrupts feel: a velocity becomes a distance, a time is
 * stretched, a ratio is inflated, and the jump hierarchy (ground jump < wall
 * jump < spring < super spring) inverts.
 *
 * This module owns the engine's canonical scaler. It classifies EVERY field of
 * `PlatformerConfig` and `JumpConfig` into a physical unit and scales only the
 * distance/velocity/acceleration fields, copying times, ratios, counts, and
 * booleans verbatim. The classification is EXHAUSTIVE and COMPILE-GATED: the
 * classification objects are typed as `{ [K in keyof PlatformerConfig]:
 * ConfigFieldUnit }`, so adding a new field to `PlatformerConfig` without
 * classifying it here is a compile error — the regression gate the plan calls
 * for.
 *
 * `createPrecisionPlatformerConfig` builds a tile-size-appropriate config from
 * the 16px `PRECISION_PLATFORMER` reference and, when a caller overrides the
 * jump apex/time, re-pegs the jump-relative impulses so the feel hierarchy is
 * preserved across tile sizes.
 *
 * Pure + deterministic: every function returns a fresh record and never
 * mutates its input. No `Math.random`, no `Date.now`, no DOM reads. No `any`.
 *
 * @module
 */

import type { JumpConfig } from '../animation/jump';
import type { PlatformerConfig } from './types';
import { PRECISION_PLATFORMER } from './presets';

/**
 * The physical unit of one config field. Drives whether
 * {@link scalePlatformerConfig} multiplies the field by the scale factor or
 * copies it unchanged.
 *
 * - `distance` / `velocity` / `acceleration` — SCALED by the tile-size ratio.
 * - `ratio` / `time` / `count` / `boolean` / `enum` — COPIED unchanged.
 *
 * `enum` is included for completeness (the plan lists it as a category); no
 * current `PlatformerConfig` / `JumpConfig` field is an enum.
 */
export type ConfigFieldUnit =
  | 'distance'
  | 'velocity'
  | 'acceleration'
  | 'ratio'
  | 'time'
  | 'count'
  | 'boolean'
  | 'enum';

/**
 * The tile size the `PRECISION_PLATFORMER` reference config was tuned for.
 * `createPrecisionPlatformerConfig` treats this as the canonical reference;
 * the `referenceTileSize` option exists for explicitness but should match this
 * value (or be omitted) for correct results.
 */
export const PRECISION_REFERENCE_TILE_SIZE = 16;

// ---------------------------------------------------------------------------
// EXHAUSTIVE field classification.
//
// Each object is a mapped type over `keyof`, so the compiler REQUIRES every
// field of the config interface to appear. Adding a field to
// `PlatformerConfig` / `JumpConfig` without classifying it here is a compile
// error — this is the regression gate (ISSUES.md §4.1 / plan risk "Config
// scaler misses new fields"). A runtime sanity check lives in the test suite.
//
// Classification rationale (physical unit, derived from the field docs in
// `types.ts` and the kernel usage in `kernel.ts`):
//   - gravity / fastMaxAccel / runAccel / overspeedReduce / duckFriction →
//     px/s² (accelerations: combined as `* dt` against velocity in
//     `applyHorizontalInput` / `integrateGravity`).
//   - moveSpeed / maxFallSpeed / fastMaxFallSpeed / wallSlideStartMax / the
//     *Vx/*Vy launch impulses / climb & climb-hop speeds → px/s (velocities).
//   - stepHeight / wallProbeDistance / climbUpCheckDist / the two corner-
//     correction tolerances → px (distances / pixel tolerances).
//   - durations (`*Time` / `*Duration` / `coyoteTime` / `grace`) → seconds.
//   - multipliers / factors / the stamina per-second rates & pool sizes →
//     dimensionless (scale-independent; transferred verbatim, mirroring the
//     pegging comments in `constants.ts`).
//   - `jump` / `squash` are nested sub-records: `jump` is scaled per
//     {@link JUMP_CONFIG_FIELD_UNITS}; `squash` is render-only dimensionless
//     and copied unchanged. They are classified `'ratio'` at the top level
//     (i.e. "not linearly scaled here — handled specially").
// ---------------------------------------------------------------------------

/**
 * Exhaustive unit classification of every `PlatformerConfig` field.
 * Compile-gated by the mapped key type.
 */
export const PLATFORMER_CONFIG_FIELD_UNITS: {
  [K in keyof PlatformerConfig]: ConfigFieldUnit;
} = {
  // Accelerations (px/s²) — SCALED.
  gravity: 'acceleration',
  fastMaxAccel: 'acceleration',
  runAccel: 'acceleration',
  overspeedReduce: 'acceleration',
  duckFriction: 'acceleration',

  // Velocities (px/s) — SCALED.
  maxFallSpeed: 'velocity',
  fastMaxFallSpeed: 'velocity',
  moveSpeed: 'velocity',
  wallSlideStartMax: 'velocity',
  wallJumpVx: 'velocity',
  wallJumpVy: 'velocity',
  dashSpeed: 'velocity',
  climbSpeed: 'velocity',
  superJumpVx: 'velocity',
  superWallJumpVx: 'velocity',
  superWallJumpVy: 'velocity',
  wallClimbUpSpeed: 'velocity',
  wallClimbDownSpeed: 'velocity',
  climbHopVy: 'velocity',
  climbHopVx: 'velocity',
  mantleHopVx: 'velocity',
  mantleHopVy: 'velocity',
  springBounceVy: 'velocity',
  springSuperBounceVy: 'velocity',

  // Distances / pixel tolerances (px) — SCALED.
  stepHeight: 'distance',
  wallProbeDistance: 'distance',
  climbUpCheckDist: 'distance',
  upwardCornerCorrection: 'distance',
  dashCornerCorrection: 'distance',
  mantleApexClearance: 'distance',
  mantleLandingInset: 'distance',

  // Times (seconds) — COPIED.
  wallSlideTime: 'time',
  wallJumpLockTime: 'time',
  wallJumpGraceTime: 'time',
  dashDuration: 'time',
  dashStartupTime: 'time',
  dashCooldown: 'time',
  superJumpGrace: 'time',
  climbHopForceTime: 'time',
  climbJumpBoostTime: 'time',
  mantleAssistTime: 'time',
  climbJumpRegrabLockTime: 'time',
  wallSpeedRetentionTime: 'time',
  springVarJumpTime: 'time',
  springAutoJumpTime: 'time',

  // Dimensionless ratios / multipliers — COPIED.
  airAccelMultiplier: 'ratio',
  endDashSpeedFactor: 'ratio',
  endDashUpMult: 'ratio',
  dodgeSlideSpeedMult: 'ratio',
  duckSuperJumpXMult: 'ratio',
  duckSuperJumpYMult: 'ratio',
  // Phase D2 — feel threshold is a ratio (impact-vs-maxFall), so the
  // hard-landing test is identical at every tile size. Unscaled (copied).
  hardLandingThreshold: 'ratio',
  // Stamina costs are per-second RATES against a dimensionless pool, and the
  // pool size itself, all verbatim per `constants.ts` — scale-independent.
  staminaUpCostPerSec: 'ratio',
  staminaStillCostPerSec: 'ratio',
  wallGrabMaxStamina: 'count',
  staminaClimbJumpCost: 'count',

  // Counts — COPIED.
  maxDashes: 'count',
  maxDoubleJumps: 'count',

  // Booleans — COPIED.
  jumpEnabled: 'boolean',
  wallSlideEnabled: 'boolean',
  dashEnabled: 'boolean',
  doubleJumpEnabled: 'boolean',
  climbEnabled: 'boolean',
  groundDuckEnabled: 'boolean',
  wallGrabEnabled: 'boolean',
  mantleEnabled: 'boolean',

  // Nested sub-records — handled specially (not linearly scaled here).
  // `jump` is scaled via `JUMP_CONFIG_FIELD_UNITS`; `squash` is copied as-is.
  jump: 'ratio',
  squash: 'ratio',
};

/**
 * Exhaustive unit classification of every `JumpConfig` field. Compile-gated by
 * the mapped key type. Only `apexHeight` is a distance; everything else is a
 * time, a dimensionless ratio, or a pose-spring constant on a dimensionless
 * scale offset (the landing-squash spring advances `squashOffset`, a scale
 * value, not pixels — so its stiffness/damping are scale-independent).
 */
export const JUMP_CONFIG_FIELD_UNITS: { [K in keyof JumpConfig]: ConfigFieldUnit } = {
  apexHeight: 'distance',
  timeToApex: 'time',
  coyoteTime: 'time',
  jumpBufferTime: 'time',
  anticipationDuration: 'time',
  jumpCutoffFactor: 'ratio',
  fallMultiplier: 'ratio',
  landingSquashMin: 'ratio',
  landingSquashStiffness: 'ratio',
  landingSquashDamping: 'ratio',
  anticipationSquash: 'ratio',
  launchStretch: 'ratio',
  airborneBlendRampUp: 'ratio',
  airborneBlendRampDown: 'ratio',
};

/**
 * The set of units that scale by the tile-size ratio. All other units are
 * copied unchanged. Kept as a `Set` for O(1) membership in the scaler hot path.
 */
const SCALABLE_UNITS: ReadonlySet<ConfigFieldUnit> = new Set([
  'distance',
  'velocity',
  'acceleration',
]);

/**
 * Scale a {@link JumpConfig} by `scale`, multiplying `apexHeight` (the only
 * distance) and copying every other field unchanged. Pure: returns a fresh
 * record.
 *
 * The builder uses a `Record<keyof JumpConfig, unknown>` accumulator because
 * writing through a `keyof JumpConfig` union key triggers TypeScript's
 * indexed-access write rule (the target collapses to the intersection of all
 * value types, i.e. `never` for a heterogeneous record). The final
 * `as JumpConfig` cast is bounded and verified by the test suite; the
 * exhaustive classification objects carry the real compile-time safety.
 *
 * Internal helper exported for direct unit testing.
 */
export function scaleJumpConfig(jump: Readonly<JumpConfig>, scale: number): JumpConfig {
  const scaled = {} as Record<keyof JumpConfig, unknown>;
  for (const key of Object.keys(JUMP_CONFIG_FIELD_UNITS)) {
    const k = key as keyof JumpConfig;
    const unit = JUMP_CONFIG_FIELD_UNITS[k] as ConfigFieldUnit;
    const value = jump[k];
    // Guard: if a distance field is absent (undefined), keep it undefined —
    // `undefined * scale` would yield NaN and silently corrupt behavior.
    // (`apexHeight` is required today, but apply the guard for safety and for
    // parity with `scalePlatformerConfig`.)
    scaled[k] =
      unit === 'distance'
        ? value === undefined
          ? undefined
          : (value as number) * scale
        : value;
  }
  return scaled as JumpConfig;
}

/**
 * Scale a {@link PlatformerConfig} by `scale` (typically `tileSize /
 * referenceTileSize`). Returns a NEW config where every distance / velocity /
 * acceleration field is multiplied by `scale` and every time / ratio / count /
 * boolean field is copied unchanged. The nested `jump` is scaled per
 * {@link JUMP_CONFIG_FIELD_UNITS} (so `jump.apexHeight` scales but
 * `jump.timeToApex` does not). The nested `squash` is copied unchanged (it is
 * render-only and dimensionless).
 *
 * Pure: returns a fresh record; the input is never mutated. Deterministic.
 *
 * @param config - the reference config (e.g. `PRECISION_PLATFORMER`)
 * @param scale - the tile-size ratio to apply (`1` is identity)
 * @returns a new `PlatformerConfig` with world-space magnitudes scaled
 */
export function scalePlatformerConfig(
  config: Readonly<PlatformerConfig>,
  scale: number,
): PlatformerConfig {
  const scaled = {} as Record<keyof PlatformerConfig, unknown>;
  for (const key of Object.keys(PLATFORMER_CONFIG_FIELD_UNITS)) {
    const k = key as keyof PlatformerConfig;
    const unit = PLATFORMER_CONFIG_FIELD_UNITS[k] as ConfigFieldUnit;
    const value = config[k];
    if (SCALABLE_UNITS.has(unit)) {
      // Guard: this loop iterates the CLASSIFICATION keys
      // (keyof PlatformerConfig), not the config's OWN keys, so an OMITTED
      // optional scalable field (e.g. stepHeight, wallProbeDistance) reads as
      // undefined. Multiplying would yield NaN; keep undefined undefined.
      scaled[k] = value === undefined ? undefined : (value as number) * scale;
    } else {
      scaled[k] = value;
    }
  }
  // Nested `jump` is scaled per its own classification (apexHeight is a
  // distance; timeToApex and the pose springs are not).
  scaled.jump = scaleJumpConfig(config.jump, scale);
  // `squash` was copied verbatim by the loop (unit 'ratio'); it is render-only
  // and dimensionless, so no scaling is applied.
  return scaled as PlatformerConfig;
}

/**
 * Options for {@link createPrecisionPlatformerConfig}.
 */
export interface CreatePrecisionPlatformerConfigOptions {
  /** Target tile size in px (e.g. 8, 16, 32). */
  readonly tileSize: number;
  /**
   * Tile size the reference config (`PRECISION_PLATFORMER`) was tuned for.
   * Defaults to {@link PRECISION_REFERENCE_TILE_SIZE} (16). The reference is a
   * 16px config, so passing a value other than 16 rescales relative to that
   * assumed reference and is only correct if you also re-derive the base.
   */
  readonly referenceTileSize?: number;
  /**
   * Desired jump apex in TILES. When provided, sets
   * `jump.apexHeight = jumpApexTiles * tileSize` and triggers the jump-relative
   * impulse re-peg (see {@link createPrecisionPlatformerConfig}). When omitted,
   * the apex scales automatically from the 16px reference (3 tiles by default).
   */
  readonly jumpApexTiles?: number;
  /**
   * Desired time-to-apex in seconds. When provided, sets `jump.timeToApex` and
   * triggers the jump-relative impulse re-peg.
   */
  readonly timeToApex?: number;
  /** Override for `jump.coyoteTime` (seconds). Copied verbatim (a time). */
  readonly coyoteTime?: number;
  /** Override for `wallGrabEnabled`. */
  readonly wallGrabEnabled?: boolean;
  /** Override for `climbEnabled`. */
  readonly climbEnabled?: boolean;
}

/**
 * The launch impulses whose magnitudes were pegged to the jump launch velocity
 * (`JumpSpeed → aicraft-launch`, per `constants.ts`) and that must therefore be
 * re-pegged when the jump apex/time change, so the feel hierarchy (ground jump
 * < wall jump < spring < super spring, and the dash-tech launches) is
 * preserved. `superJumpVy` is NOT in this set because it is derived at runtime
 * from `jumpLaunchVelocity(config.jump)` and so tracks the jump automatically.
 *
 * The set: `wallJumpVx`, `wallJumpVy`, `superJumpVx`, `superWallJumpVx`,
 * `superWallJumpVy`, `climbHopVx`, `climbHopVy`, `mantleHopVx`, `mantleHopVy`,
 * `springBounceVy`, `springSuperBounceVy`.
 *
 * Note: the five horizontal impulses (`wallJumpVx`, `superJumpVx`,
 * `superWallJumpVx`, `climbHopVx`, `mantleHopVx`) were originally pegged to
 * `moveSpeed` in
 * `constants.ts`. We re-peg them to the jump launch alongside the vertical
 * impulses so the WHOLE jump-family scales coherently when a designer asks for
 * a taller/floatier jump — a wall/super/climb jump keeps its arc shape relative
 * to the new jump rather than going flat. A maintainer who prefers to keep the
 * horizontal impulses locked to `moveSpeed` can drop those five; the vertical
 * re-peg is the load-bearing part for the height hierarchy.
 */

/**
 * Build a tile-size-appropriate `PlatformerConfig` from the 16px
 * {@link PRECISION_PLATFORMER} reference.
 *
 * 1. `scale = tileSize / (referenceTileSize ?? 16)`.
 * 2. Start from `scalePlatformerConfig(PRECISION_PLATFORMER, scale)` — every
 *    world-space magnitude (distances, velocities, accelerations, including
 *    `jump.apexHeight`) is scaled; times/ratios/counts/booleans are copied.
 * 3. If `jumpApexTiles` / `timeToApex` are provided, override
 *    `jump.apexHeight = jumpApexTiles * tileSize` and `jump.timeToApex`, then
 *    RE-PEG the jump-relative impulses (the set documented on
 *    `createPrecisionPlatformerConfig`) so their ratio to the new jump
 *    launch is preserved. The re-peg ratio is `newLaunchV / scaledLaunchV`,
 *    where `launchV = 2 · apexHeight / timeToApex` (the apex-parameterized
 *    launch velocity, mirroring `jumpLaunchVelocity`). Because the scaled
 *    impulses already track `scaledLaunchV`, multiplying by this ratio yields
 *    `referenceImpulse · (newLaunchV / referenceLaunchV)` — the exact
 *    relationship that keeps a spring launching ~1.76× the jump, a super wall
 *    jump ~1.52× the jump, etc., regardless of the chosen apex/time.
 * 4. Apply the boolean / coyote-time overrides.
 *
 * Pure + deterministic: returns a fresh record; never reads the host.
 */
export function createPrecisionPlatformerConfig(
  opts: CreatePrecisionPlatformerConfigOptions,
): PlatformerConfig {
  const referenceTileSize = opts.referenceTileSize !== undefined
    && Number.isFinite(opts.referenceTileSize) && opts.referenceTileSize > 0
    ? opts.referenceTileSize
    : PRECISION_REFERENCE_TILE_SIZE;
  const scale = opts.tileSize / referenceTileSize;

  let config = scalePlatformerConfig(PRECISION_PLATFORMER, scale);

  // Launch velocity of the SCALED config before any apex override. This is the
  // baseline the scaled jump-relative impulses currently track.
  const scaledApex = config.jump.apexHeight;
  const scaledTime = config.jump.timeToApex;
  const scaledLaunchV = (2 * scaledApex) / scaledTime;

  // Apply jump apex / time / coyote overrides. A `timeToApex` override of 0
  // (or non-finite) would divide by zero below and multiply every
  // jump-relative impulse by Infinity — fall back to the scaled default,
  // symmetric with the ratio guard.
  const newApex = opts.jumpApexTiles !== undefined ? opts.jumpApexTiles * opts.tileSize : scaledApex;
  const newTimeRaw = opts.timeToApex !== undefined ? opts.timeToApex : scaledTime;
  const newTime = Number.isFinite(newTimeRaw) && newTimeRaw > 0 ? newTimeRaw : scaledTime;
  let jump: JumpConfig = { ...config.jump, apexHeight: newApex, timeToApex: newTime };
  if (opts.coyoteTime !== undefined) {
    jump = { ...jump, coyoteTime: opts.coyoteTime };
  }
  config = { ...config, jump };

  // Re-peg the jump-relative impulses so the feel hierarchy survives the
  // apex/time override (ISSUES.md §4.1 fix). The set is documented above
  // (`wallJumpVx/Vy`, `superJumpVx`, `superWallJumpVx/Vy`, `climbHopVx/Vy`,
  // `springBounceVy`, `springSuperBounceVy`); `superJumpVy` is runtime-derived
  // and tracks the jump automatically.
  if (opts.jumpApexTiles !== undefined || opts.timeToApex !== undefined) {
    const newLaunchV = (2 * newApex) / newTime;
    const ratio = scaledLaunchV === 0 ? 1 : newLaunchV / scaledLaunchV;
    config = {
      ...config,
      wallJumpVx: config.wallJumpVx * ratio,
      wallJumpVy: config.wallJumpVy * ratio,
      superJumpVx: config.superJumpVx * ratio,
      superWallJumpVx: config.superWallJumpVx * ratio,
      superWallJumpVy: config.superWallJumpVy * ratio,
      climbHopVx: config.climbHopVx * ratio,
      climbHopVy: config.climbHopVy * ratio,
      mantleHopVx: config.mantleHopVx * ratio,
      mantleHopVy: config.mantleHopVy * ratio,
      springBounceVy: config.springBounceVy * ratio,
      springSuperBounceVy: config.springSuperBounceVy * ratio,
    };
  }

  // Boolean overrides.
  if (opts.wallGrabEnabled !== undefined) {
    config = { ...config, wallGrabEnabled: opts.wallGrabEnabled };
  }
  if (opts.climbEnabled !== undefined) {
    config = { ...config, climbEnabled: opts.climbEnabled };
  }

  return config;
}
