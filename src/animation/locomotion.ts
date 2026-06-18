import type { Vec2 } from './types';

/**
 * Trigonometric locomotion: phase-accumulator walk / run cycles.
 *
 * Phase is integrated from speed each tick (`advanceLocomotion`) and read into
 * hip / foot offsets via sine / cosine (`evaluateLocomotion`). Because phase is
 * a continuous integral of speed, idle→walk→run transitions are glitch-free —
 * there are no phase jumps when speed changes (the failure mode of a naive
 * `tick * speed` formulation).
 *
 * Both functions are pure: `advanceLocomotion` returns a brand-new
 * `LocomotionState` (input never mutated), `evaluateLocomotion` is a stateless
 * reader. Mirrors the `particles/advance` + reader split. Never throws.
 *
 * Reduced-motion: the consumer reads `prefersReducedMotion()` (renderer layer)
 * and calls `scaledGait(config, ~0.2)` to dampen amplitudes. The deterministic
 * core never touches the host probe.
 */

/**
 * Phase-accumulator state. One instance per character; persisted across ticks.
 *
 * `phase` is the integrated gait phase in radians, kept in `[0, 2π)`. It is the
 * ONLY piece of mutable locomotion state; speed and dt are per-tick inputs.
 */
export interface LocomotionState {
  /** Accumulated phase in radians, wrapped to `[0, 2π)`. */
  readonly phase: number;
}

/**
 * Per-character gait parameters. All tunable; no magic numbers in the solver.
 * Different characters (troll vs spider vs slime) carry different configs.
 */
export interface GaitConfig {
  /** Cycles per unit of speed per tick. Drives phase integration rate. */
  baseFrequency: number;
  /** Horizontal foot amplitude in px (forward/back swing). */
  strideLength: number;
  /** Vertical foot-lift amplitude in px (up swing only). */
  strideHeight: number;
  /** Vertical hip-bob amplitude in px (downward dip per foot plant). */
  hipBobHeight: number;
  /** Horizontal hip-sway amplitude in px (lateral weight transfer). */
  hipSwayWidth: number;
}

/**
 * Default gait matching the Spitekeep devil character scale. Tunable; consumers
 * spread this into their own config (`{ ...DEFAULT_GAIT, strideLength: 6 }`).
 */
export const DEFAULT_GAIT: Readonly<GaitConfig> = {
  baseFrequency: 0.05,
  strideLength: 4,
  strideHeight: 3,
  hipBobHeight: 2,
  hipSwayWidth: 1,
};

/**
 * Character pose offsets relative to the root, derived from the current phase.
 *
 * Offsets are in world px (+X right, +Y down, matching Canvas2D). The hip
 * offset is applied to the character root; foot offsets are applied relative to
 * the (untranslated) root and may be fed to an IK solver or drawn directly.
 */
export interface LocomotionPose {
  /** Hip translation offset. */
  readonly hipOffset: Readonly<Vec2>;
  /** Left-foot translation offset. */
  readonly leftFootOffset: Readonly<Vec2>;
  /** Right-foot translation offset. */
  readonly rightFootOffset: Readonly<Vec2>;
}

const TWO_PI = Math.PI * 2;

/**
 * Advance the phase accumulator by one tick.
 *
 * Phase integrates as `phase += speed * baseFrequency * 2π * dt`, then wraps to
 * `[0, 2π)` to prevent floating-point drift at large tick counts. The wrap is
 * what guarantees bounded state over arbitrarily long sessions; the integration
 * (not a `tick * speed` product) is what guarantees smooth speed transitions.
 *
 * Pure: returns a new `LocomotionState`; the input is never mutated.
 *
 * @param state - current locomotion state
 * @param speed - current character speed (units/tick); `0` holds the phase
 * @param dt - timestep (fixed recommended for replay determinism)
 * @param config - gait parameters
 * @returns the next `LocomotionState` with phase wrapped to `[0, 2π)`
 *
 * @example
 * ```ts
 * let loco: LocomotionState = { phase: 0 };
 * loco = advanceLocomotion(loco, player.speed, 1, DEFAULT_GAIT);
 * const pose = evaluateLocomotion(loco, DEFAULT_GAIT);
 * ```
 */
export function advanceLocomotion(
  state: LocomotionState,
  speed: number,
  dt: number,
  config: GaitConfig,
): LocomotionState {
  const dPhase = speed * config.baseFrequency * TWO_PI * dt;
  const phase = (state.phase + dPhase) % TWO_PI;
  return { phase: phase < 0 ? phase + TWO_PI : phase };
}

/**
 * Derive hip / foot offsets from the current phase.
 *
 * Feet swing forward/back as `cos(phase)` and lift only on the forward half of
 * the cycle (`max(0, sin(phase))`), so a foot is on the ground for half the
 * cycle. The right foot is π out of phase with the left. The hip bobs DOWNWARD
 * twice per cycle (`-|sin(phase)|`) — once per foot plant — and sways laterally
 * in counter-phase with the feet. All math is pure sin/cos; identical across
 * IEEE 754 platforms.
 *
 * Pure reader: returns a new `LocomotionPose`; never mutates `state`.
 *
 * @param state - current locomotion state (only `phase` is read)
 * @param config - gait amplitudes
 * @returns hip + left/right foot offsets in px
 */
export function evaluateLocomotion(
  state: LocomotionState,
  config: GaitConfig,
): LocomotionPose {
  const phi = state.phase;

  const leftFootOffset: Vec2 = {
    x: Math.cos(phi) * config.strideLength,
    y: Math.max(0, Math.sin(phi)) * config.strideHeight,
  };

  const phiRight = phi + Math.PI;
  const rightFootOffset: Vec2 = {
    x: Math.cos(phiRight) * config.strideLength,
    y: Math.max(0, Math.sin(phiRight)) * config.strideHeight,
  };

  const hipOffset: Vec2 = {
    x: Math.sin(phi) * config.hipSwayWidth,
    y: -Math.abs(Math.sin(phi)) * config.hipBobHeight,
  };

  return { hipOffset, leftFootOffset, rightFootOffset };
}

/**
 * Scale a `GaitConfig`'s amplitude fields by a factor.
 *
 * Scales `strideLength`, `strideHeight`, `hipBobHeight`, and `hipSwayWidth`.
 * `baseFrequency` is LEFT UNCHANGED: reduced motion should dampen how far a
 * limb swings, not how fast the cycle runs (a slower frequency would also slow
 * the perceived walk cadence, which is a separate concern). Consumers wanting a
 * slower cadence can override `baseFrequency` directly.
 *
 * Primary use: `scaledGait(DEFAULT_GAIT, prefersReducedMotion() ? 0.2 : 1)`.
 *
 * Pure: returns a new `GaitConfig`; the input is never mutated.
 *
 * @param config - source gait
 * @param scale - amplitude multiplier (0.2 = 20% amplitude for reduced motion)
 * @returns a new `GaitConfig` with scaled amplitudes and unchanged frequency
 */
export function scaledGait(config: GaitConfig, scale: number): GaitConfig {
  return {
    baseFrequency: config.baseFrequency,
    strideLength: config.strideLength * scale,
    strideHeight: config.strideHeight * scale,
    hipBobHeight: config.hipBobHeight * scale,
    hipSwayWidth: config.hipSwayWidth * scale,
  };
}
