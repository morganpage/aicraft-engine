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
 * ⚠ **Facing-mirror requirement (the moonwalk trap).** The returned offsets
 * are LOCAL-space relative to the (untranslated, unmirrored) body root. They
 * ASSUME the caller wraps the draw in `ctx.scale(facing, 1)` (mirroring
 * around the body's vertical axis) at RENDER time. If you feed these offsets
 * straight into world-space drawing without the facing-mirror scale, a
 * left-facing character will moonwalk: feet swing in local rightward phase
 * while the body visually faces left. Silent failure — no error, just a
 * backwards-looking stride. See `drawSimpleFeet` in `./simple-feet.ts` for
 * the canonical `save → translate → scale(facing, 1) → draw → restore` wrap.
 *
 * Feet swing forward/back as `cos(phase)`: forward (+stride) at phase 0, back
 * (-stride) at phase π. A foot lifts via `max(0, -sin(phase))` — during the
 * SECOND half of the cycle (phase ∈ [π, 2π]) when cos is RISING (the foot is
 * traveling back→front). This is the **swing phase**: the foot is airborne
 * while swinging forward, matching the canonical walk-cycle convention (lift
 * during forward swing). During the FIRST half (phase ∈ [0, π]) the foot is
 * grounded — the **stance phase** — and slides from front→back as the body
 * moves over the planted foot (`cos` is falling). The right foot is π out of
 * phase with the left, so the two feet trade stance/swing every half cycle.
 *
 * The hip bobs DOWNWARD twice per cycle (`-|sin(phase)|`) — once per foot
 * plant — and sways laterally in counter-phase with the feet. All math is pure
 * sin/cos; identical across IEEE 754 platforms.
 *
 * Offsets use the Canvas2D axis convention (+X right, +Y down) but are
 * relative to the body root in the body's LOCAL frame (the frame established
 * by the caller's `ctx.translate(bodyX, bodyY); ctx.scale(facing, 1)`). The
 * hip offset is applied to the character root; foot offsets are applied
 * relative to the (untranslated) root and may be fed to an IK solver or drawn
 * directly.
 *
 * Pure reader: returns a new `LocomotionPose`; never mutates `state`.
 *
 * @param state - current locomotion state (only `phase` is read)
 * @param config - gait amplitudes
 * @returns hip + left/right foot offsets in px (LOCAL-space — see warning)
 */
export function evaluateLocomotion(
  state: LocomotionState,
  config: GaitConfig,
): LocomotionPose {
  const phi = state.phase;

  const leftFootOffset: Vec2 = {
    x: Math.cos(phi) * config.strideLength,
    y: Math.max(0, -Math.sin(phi)) * config.strideHeight,
  };

  const phiRight = phi + Math.PI;
  const rightFootOffset: Vec2 = {
    x: Math.cos(phiRight) * config.strideLength,
    y: Math.max(0, -Math.sin(phiRight)) * config.strideHeight,
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

// ---------------------------------------------------------------------------
// Extensions: displacement-driven walk phase + airborne tuck blend.
// Additive — the exports above are unchanged.
// ---------------------------------------------------------------------------

/**
 * Airborne tuck pose configuration. When the character leaves the ground, the
 * walk-cycle foot offset blends toward `tuckOffset` (feet drawn up toward the
 * body); `hipRaise` shifts the hip upward and is applied by the consumer to the
 * hip offset (not by `blendAirborneTuck`, which blends a single foot offset).
 *
 * Note: a single `tuckOffset` (rather than separate left/right poses) keeps
 * `blendAirborneTuck`'s signature `(footOffset, airborneBlend, config)`
 * unambiguous — both feet tuck toward the same relative pose. Consumers wanting
 * per-foot asymmetry can pass different `TuckConfig` objects per foot.
 */
export interface TuckConfig {
  /** Foot tuck offset when airborne (relative to rest). Default `{x: 0, y: -2}`. */
  readonly tuckOffset: Readonly<Vec2>;
  /** Hip raise in px (negative = upward). Applied by the consumer to the hip. Default `-3`. */
  readonly hipRaise: number;
}

/**
 * Default airborne tuck pose. Tunable; consumers spread this into their own.
 */
export const DEFAULT_TUCK: Readonly<TuckConfig> = {
  tuckOffset: { x: 0, y: -2 },
  hipRaise: -3,
};

/**
 * Advance phase by actual horizontal displacement (anti-foot-slide).
 *
 * Phase advances by `dx / (strideLength · π)`, coupling the walk cycle directly
 * to physical movement. When the character stops (`dx = 0`), the phase freezes
 * — feet stay planted. This solves the "foot sliding" problem where time-driven
 * phase (`advanceLocomotion`) drifts from physical speed.
 *
 * Same return type as `advanceLocomotion` (`LocomotionState`), so consumers can
 * switch between time-driven and displacement-driven per character without
 * changing their state variable type.
 *
 * **Determinism contract:** same `(state, dx, config)` → byte-identical result,
 * forever. Pure: returns a new `LocomotionState`; the input is never mutated.
 * Never throws.
 *
 * ⚠ Do NOT call both `advanceLocomotion` and `advanceLocomotionByDisplacement`
 * in the same tick — this double-advances the phase. The choice is per
 * character, not per frame: time-driven for walk-in-place characters,
 * displacement-driven for translating characters.
 *
 * ⚠ **Facing-mirror interaction:** `dx` is world-space displacement (positive =
 * right). When a consumer also mirrors character geometry for facing (e.g.
 * `ctx.scale(facing, 1)`), passing signed world-space `dx` here reverses the
 * gait phase for leftward walking, and the mirror reverses the geometry — a
 * double reversal that produces a visually incorrect walk. Consumers using
 * geometry mirrors should pass LOCAL-space displacement (`dx * facing`) so the
 * phase always advances forward in local space, letting the mirror handle the
 * visual direction.
 *
 * And at RENDER time, you MUST still apply `ctx.scale(facing, 1)` around the
 * draw (see `drawSimpleFeet` JSDoc in `./simple-feet.ts` for the canonical
 * `save → translate → scale(facing, 1) → draw → restore` wrap) — the offsets
 * returned by `evaluateLocomotion` are LOCAL-space and assume that mirror is
 * in effect. Forgetting the render-side mirror produces a moonwalk: the
 * character faces one way while their feet swing in the opposite direction's
 * phase. The `dx * facing` fix above addresses the SIMULATION side; this
 * mirror addresses the RENDER side. Both are required.
 *
 * @param state - current locomotion state
 * @param dx - actual horizontal displacement this tick (positive = right, in px)
 * @param config - gait parameters (`strideLength` is the key input)
 * @returns the next `LocomotionState` with phase wrapped to `[0, 2π)`
 *
 * @example
 * ```ts
 * // Frozen while airborne; displacement-driven while grounded.
 * if (!jumpPose.airborne) {
 *   loco = advanceLocomotionByDisplacement(loco, dx, DEFAULT_GAIT);
 * }
 * ```
 */
export function advanceLocomotionByDisplacement(
  state: LocomotionState,
  dx: number,
  config: GaitConfig,
): LocomotionState {
  const dPhase = dx / (config.strideLength * Math.PI);
  const phase = (state.phase + dPhase) % TWO_PI;
  return { phase: phase < 0 ? phase + TWO_PI : phase };
}

/**
 * Blend a walk-cycle foot offset toward an airborne tuck pose.
 *
 * When airborne, the character's legs tuck up (feet drawn toward the body)
 * rather than continuing the walk cycle's swing. This linearly interpolates
 * between the walk-cycle offset and the tuck offset using `airborneBlend`.
 *
 * - `airborneBlend = 0` → pure walk-cycle offset (grounded).
 * - `airborneBlend = 1` → pure tuck offset (fully airborne).
 * - `airborneBlend = 0.5` → midpoint.
 *
 * **Determinism contract:** pure function of `(footOffset, airborneBlend, config)`.
 * Same inputs → same output, forever. No side effects. Returns a fresh `Vec2`;
 * the input is never mutated.
 *
 * @param footOffset - walk-cycle foot offset from `evaluateLocomotion`
 * @param airborneBlend - blend weight `[0, 1]` from `evaluateJump().airborneBlend`
 * @param config - tuck pose configuration
 * @returns the blended `Vec2` offset
 *
 * @example
 * ```ts
 * const pose = evaluateLocomotion(loco, DEFAULT_GAIT);
 * const leftFoot = blendAirborneTuck(pose.leftFootOffset, jumpPose.airborneBlend, DEFAULT_TUCK);
 * ```
 */
export function blendAirborneTuck(
  footOffset: Readonly<Vec2>,
  airborneBlend: number,
  config: TuckConfig,
): Vec2 {
  const t = airborneBlend;
  return {
    x: footOffset.x + (config.tuckOffset.x - footOffset.x) * t,
    y: footOffset.y + (config.tuckOffset.y - footOffset.y) * t,
  };
}
