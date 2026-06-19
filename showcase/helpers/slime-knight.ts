/**
 * The canonical slime-knight — a single composed character built from library
 * primitives. One seed produces one character forever: palette, body
 * proportions, gait rhythm, antenna physics, and breathing amplitudes are all
 * derived deterministically from the seed.
 *
 * Composition stack:
 *   - Body:    rounded-rectangle squircle (flat fill + chunky outline pass).
 *   - Eye:     canvas circle in `palette.feature` + outline pupil + white
 *              highlight (matches the in-game-shapes aesthetic). The pupil
 *              offsets toward a per-frame gaze vector (`look`) so the eye
 *              tracks the travel direction, and the face renders as 1 eye
 *              (cyclops, the default) or 2 eyes (showcase toggle).
 *   - Legs:    two 2-bone IK limbs via `solveLimb`, driven by foot targets
 *              from `evaluateLocomotion`.
 *   - Antenna: a Verlet spring chain via `advanceSpringChain`, anchored at
 *              the body top and swaying under gravity + hip motion.
 *   - Breath:  volume-preserving scale via `breathe` / `volumeScale`, applied
 *              around the body center.
 *
 * Showcase-local: NOT a library export. The library provides the building
 * blocks; the showcase assembles them. Shared between hero, determinism
 * prover, and cosmetics sections.
 */

import {
  breathe,
  advanceSpringChain,
  advanceLocomotion,
  advanceLocomotionByDisplacement,
  advanceJump,
  createJumpState,
  evaluateLocomotion,
  evaluateJump,
  blendAirborneTuck,
  solveLimb,
  DEFAULT_BREATH,
  DEFAULT_GAIT,
  DEFAULT_JUMP,
  DEFAULT_SPRING,
  DEFAULT_TUCK,
  type BreathConfig,
  type GaitConfig,
  type JumpInputs,
  type JumpState,
  type LocomotionState,
  type SpringConfig,
  type VerletNode,
} from '../../src/animation';
import { DEFAULT_OUTLINE_COLOR, lerp } from '../../src/primitives';
import { mulberry32, nextFloat, nextInt } from '../../src/rng';
import { generatePalette, type Palette } from '../../src/palette';

// ---------------------------------------------------------------------------
// Layout constants — canvas-local. Tunable.
// ---------------------------------------------------------------------------

/** Hero canvas size (square). The character is composed in this coordinate space. */
export const HERO_CANVAS_SIZE = 320;

/** Body center X (canvas px). */
const HERO_CENTER_X = HERO_CANVAS_SIZE / 2;

/**
 * Vertical position of the foot-plant line (canvas px). Fixed regardless of
 * seed so the shadow and ground line (drawn by the section) never drift from
 * where the feet actually land. Exported so `sections/hero.ts` draws the
 * ground line + shadow at exactly this Y.
 *
 * Ratio 0.88 (raised from 0.82 per user feedback "feet a little lower"): the
 * feet plant ~20px lower on the 320px canvas, and since `heroCenterY(config)`
 * is derived from `HERO_GROUND_Y`, the body / head / antenna move down
 * together so the whole character sits lower in the frame.
 */
export const HERO_GROUND_Y = HERO_CANVAS_SIZE * 0.88;

/**
 * Body center Y for a given config, derived FROM the ground line so the
 * feet always plant on `HERO_GROUND_Y` at rest. Working up from the ground:
 *   ground  = hip + reach
 *   hip     = bodyCenter + bodyHeight/2
 *   → bodyCenter = ground − bodyHeight/2 − reach
 *
 * Per-seed body heights and bone lengths move the body center up/down, but
 * the feet stay anchored to the ground line.
 */
function heroCenterY(config: HeroConfig): number {
  const reach =
    (config.boneLengths.thigh + config.boneLengths.shin) * LEG_REACH_RATIO;
  return HERO_GROUND_Y - config.bodyHeight / 2 - reach;
}

/** Outline width (canvas px) used for the chunky Sokpop outline pass. */
const CHUNKY_OUTLINE_WIDTH = 3;

/**
 * Ratio of the hip→foot vertical distance to the total leg-bone length.
 *
 * `0.9` means the legs start slightly bent (foot distance is 90% of full
 * reach), so `solveLimb` produces a natural knee bend at rest and has room
 * to compress during the walk cycle without fully extending.
 */
const LEG_REACH_RATIO = 0.9;

/**
 * Off-screen buffer added to `bodyWidth/2` when the hero walks off one canvas
 * edge and reappears at the other. With co-located hips (Change B) and the
 * forward-foot shoe offset (Change C), the forward foot's reach from the body
 * center is `strideLength + shoeForward + shoeW/2 ≈ 10 + 7 + 9 = 26` px —
 * well inside the body's half-width (35-45), so the foot never pokes past the
 * body silhouette. The margin is a comfortable buffer so the hero fully exits
 * the frame before reappearing on the opposite side.
 */
const HERO_WALK_WRAP_MARGIN_FOOT = 16;

// ---------------------------------------------------------------------------
// HERO_RANGES — every tunable magic number lives here.
// ---------------------------------------------------------------------------

/**
 * Tunable generation ranges for the hero. Consumers can override individual
 * fields by spreading their own config.
 *
 * `base + nextInt(rng, 0, jitter)` produces an inclusive `[base, base+jitter]`
 * range. `lerp(min, max, nextFloat(rng, 0, 1))` produces a continuous
 * `[min, max)` range.
 */
export const HERO_RANGES = {
  bodyWidth: { base: 70, jitter: 20 }, // [70, 90]
  bodyHeight: { base: 60, jitter: 16 }, // [60, 76]
  eyeRadius: { base: 13, jitter: 5 }, // [13, 18]
  thigh: { base: 22, jitter: 8 }, // [22, 30]
  shin: { base: 20, jitter: 8 }, // [20, 28]
  antennaSegments: { base: 3, jitter: 3 }, // [3, 6]
  antennaSegmentLength: { base: 9, jitter: 5 }, // [9, 14]
  gaitFrequencyMul: { min: 0.8, max: 1.2 }, // × DEFAULT_GAIT.baseFrequency
  // Bigger steps: {1.5, 2.5} → {3.0, 4.5} so feet swing further forward/back
  // (post-jitter stride DEFAULT_GAIT.strideLength(4) × [3.0, 4.5] = 12-18px,
  // vs 6-10px before — a clearly bigger step, still well within the ~70-90px
  // body width). The wider splay is what makes the legs visibly cross during
  // the walk cycle. RNG draw type unchanged (still nextFloat → lerp); only
  // the lerp endpoints moved.
  gaitStrideLenMul: { min: 3.0, max: 4.5 }, // × DEFAULT_GAIT.strideLength
  // Proportional lift bump: {0.6, 1.4} → {1.5, 2.5} so bigger strides read as
  // real steps (post-jitter lift DEFAULT_GAIT.strideHeight(3) × [1.5, 2.5] =
  // 4.5-7.5px), not flat shuffling feet.
  gaitStrideHtMul: { min: 1.5, max: 2.5 }, // × DEFAULT_GAIT.strideHeight
  gaitHipBobMul: { min: 0.5, max: 1.5 }, // × DEFAULT_GAIT.hipBobHeight
  gaitHipSwayMul: { min: 0.5, max: 1.5 }, // × DEFAULT_GAIT.hipSwayWidth
  springGravityMul: { min: 0.8, max: 1.2 }, // × DEFAULT_SPRING.gravityY
  springDrag: { min: 0.92, max: 0.98 },
  breathFreqMul: { min: 0.8, max: 1.2 }, // × DEFAULT_BREATH.frequency
  breathAmpMul: { min: 0.7, max: 1.3 }, // × DEFAULT_BREATH.amplitude
} as const;

// ---------------------------------------------------------------------------
// Antenna physics tuning — showcase-local springy-rod model
// ---------------------------------------------------------------------------
//
// Target read: "ball on the end of a springy, bendy metal rod." The antenna
//   1. leans slightly FORWARD (in the facing direction);
//   2. is springy/bendy, NOT a rigid mast;
//   3. has a weighted ball at the tip that SAGS under its own weight and
//      BOUNCES during walk/jump (velocity-driven, not just static sag);
//   4. does NOT flop like a scarf (issue #4 — the original problem the old
//      singleton `ANTENNA_STIFFNESS = 0.7` rigidity was added to fix).
//
// The new model replaces that singleton with FOUR named constants composed
// across two showcase-local passes run AFTER the library `advanceSpringChain`
// step in `stepHero`:
//   - `applyAntennaRestPose`  — directional spring toward a forward-tilted
//     rest vector, with BASE→TIP tapered stiffness (below).
//   - `applyAntennaTipWeight` — positional downward nudge proportional to
//     node position along the chain (the ball's weight bending the rod).
//
// The base>tip stiffness ordering + the tip-weight gradient compound toward
// the tip → sag concentrates at the tip → "rod bending under a point load,"
// not tentacle/whip. This is the middle ground between the old rigid mast
// (too stiff, no life) and the original un-stiffened scarf-flop (issue #4):
// springy but not floppy. All four values are starting points — the
// benchmarker may tune. They are named constants so tuning is a one-line
// change per value.

/**
 * Antenna directional spring — base stiffness. The showcase-local
 * `applyAntennaRestPose` correction pulls every node toward a forward-tilted
 * rest vector (see ANTENNA_FORWARD_LEAN_X) by a tapered fraction of the
 * deviation: the BASE node (index 1, just above the anchor) is pulled by
 * ANTENNA_BASE_STIFFNESS, the TIP node (last) by ANTENNA_TIP_STIFFNESS, and
 * nodes between by linear interpolation. Base-stiffer-than-tip concentrates
 * freedom at the tip so the rod bends like a beam under a point load, not
 * like a tentacle or whip.
 *
 * Lower than the old singleton ANTENNA_STIFFNESS=0.7 because the target read
 * is "springy rod," not "rigid mast." If the benchmarker reads it as too
 * floppy (scarf regression, issue #4), RAISE BOTH constants together; if too
 * rigid, LOWER BOTH. Keep the base>tip ordering.
 */
const ANTENNA_BASE_STIFFNESS = 0.35;

/** Paired with ANTENNA_BASE_STIFFNESS — the TIP-end stiffness. See its JSDoc. */
const ANTENNA_TIP_STIFFNESS = 0.22;

/**
 * Antenna forward lean (showcase-local). The per-segment rest vector tilts
 * forward by this fraction of the segment length (in +X, code space). The
 * existing ctx.scale(facing, 1) mirror in drawSlimeKnight flips it for
 * facing === -1, so the antenna leans forward in screen space for both
 * directions — NO facing-aware logic inside the physics.
 *
 * The rest vector per segment is { x: seg * lean, y: -sqrt(seg² - (seg*lean)²) },
 * i.e. a unit segment rotated forward by atan(lean). 0.32 ≈ 17.7° forward
 * (raised from 0.22 / ~12.4° per user feedback "point a little further
 * forward"). Feeds `applyAntennaRestPose`'s per-segment rest vector AND
 * `createHeroFrameState`'s initial chain layout (both read this constant, so
 * one change updates both). The bend constraint (`applyAntennaBendConstraints`)
 * is unaffected — it uses `2 * segmentLength` (straight-rod rest length)
 * independently of the lean.
 */
const ANTENNA_FORWARD_LEAN_X = 0.32;

/**
 * Antenna tip weight (showcase-local). A positional downward nudge applied
 * AFTER the rest-pose correction, proportional to node position along the
 * chain (i/(n-1)): the base gets ~0, the tip gets the full weight. This
 * models the ball's mass bending the rod. Move curr AND prev by the same
 * delta to preserve implicit Verlet velocity (same discipline as the rest-
 * pose correction).
 *
 * NOTE (architect): at these magnitudes the STATIC-equilibrium tip sag is
 * sub-pixel (~weight/tipStiff ≈ 0.5px). The "bouncing ball" read comes from
 * VELOCITY-DRIVEN dynamics during walk/jump — anchor motion transfers
 * velocity through the chain, the tip lags, and this weight nudge amplifies
 * the lag into visible bounce. If the dynamic read is too subtle, RAISE THIS
 * CONSTANT FIRST (visible sag = target feel) before lowering the stiffness
 * constants (lowering stiffness risks the scarf-flop regression, issue #4).
 */
const ANTENNA_TIP_WEIGHT = 0.12;

/**
 * Antenna gravity scale (showcase-local). The library's `advanceSpringChain`
 * applies `gravityY` during Verlet integration. Set to `0`: solver gravity is
 * now redundant with the showcase-local `applyAntennaTipWeight` nudge, which
 * owns the downward ball-weight sag explicitly (and in a tapered, tip-focused
 * way a uniform solver gravity could not). Keeping solver gravity on would
 * double-apply the sag AND fight the rest-pose correction during jump
 * landings (the old up-float read). With zero solver gravity, the only
 * vertical sag is the showcase-local tip weight; the only sway is velocity
 * transfer through the chain from anchor motion = gentle tip lag + bounce.
 *
 * The RNG draw for `springGravityMul` (seed-contract draw #13) is preserved in
 * `deriveHeroConfig` and multiplied through, so this scale can be raised later
 * without touching the 16-draw seed order.
 */
const ANTENNA_GRAVITY_SCALE = 0;

// ---------------------------------------------------------------------------
// Antenna bend resistance — showcase-local Provot next-nearest-neighbor springs
// ---------------------------------------------------------------------------
//
// Target read: "ball on the end of a springy, bendy metal ROD," not a rope or
// chain. The library solver only enforces ADJACENT-node distances (free-hinge
// joints), so under violent anchor motion (jump landings) the chain can buckle
// and kink — the "rope/chain" read the user flagged. The Provot bend constraint
// adds distance constraints between NEXT-NEAREST neighbors (i, i+2) with rest
// length 2·segmentLength (the straight-rod distance). This resists bending so
// the chain reads as a bendy solid rod. COEXISTS with `applyAntennaRestPose`:
// the bend springs own inter-segment smoothness (anti-buckling); the absolute
// forward-lean spring owns world-space orientation. Both run every tick (see
// `applyAntennaBendConstraints`).

/**
 * Antenna bend stiffness — base joint (closest to the body anchor). The
 * showcase-local Provot bend constraint (applyAntennaBendConstraints) pulls
 * each i-to-i+2 node pair toward its straight-rod rest distance; the base
 * joint gets this stiffness, the tip joint gets ANTENNA_BEND_STIFFNESS_TIP,
 * linearly tapered between. Higher = more rod-like resistance to buckling.
 *
 * Raised from the prototype's 0.6 after the benchmarker found 0.6 too weak
 * (the bend correction was overwhelmed by velocity transfer during jump
 * landings). 0.9 gave visible smooth-rod resistance without freezing the
 * chain rigid; bumped again to 0.95 per user feedback ("still be a bit
 * stiffer") alongside the matching tip raise. Tunable.
 */
const ANTENNA_BEND_STIFFNESS_BASE = 0.95;

/**
 * Antenna bend stiffness — tip joint (furthest from the anchor, where the
 * ball sits). Lower than the base so the tip has more freedom to bend under
 * the ball's weight — the rod bends most near the load, not at the root.
 * Tapered linearly from the base value across the i-to-i+2 pairs. Raised
 * from 0.65 → 0.75 per user feedback ("still be a bit stiffer"); the base>
 * tip ordering is preserved.
 */
const ANTENNA_BEND_STIFFNESS_TIP = 0.75;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Seed-derived static configuration. The same seed always yields the exact
 * same `HeroConfig`. The `speed` field is the runtime gait speed multiplier
 * (0 = idle, 1 = walk, 2 = run); it is NOT derived from the seed and may be
 * mutated by the caller (e.g. from a slider) before drawing.
 */
export interface HeroConfig {
  /** The seed this config was derived from. */
  readonly seed: number;
  /** Generated palette (independent rng stream — see deriveHeroConfig). */
  readonly palette: Palette;
  /** Gait amplitudes + cadence for the locomotion cycle. */
  readonly gaitConfig: GaitConfig;
  /** Verlet spring parameters for the antenna. */
  readonly springConfig: SpringConfig;
  /** Volume-preserving breathing parameters. */
  readonly breathConfig: BreathConfig;
  /** Bone lengths for each leg (thigh + shin), in canvas px. */
  readonly boneLengths: { thigh: number; shin: number };
  /** Antenna node count (including the immovable root). */
  readonly antennaSegments: number;
  /** Rest distance between adjacent antenna nodes. */
  readonly antennaSegmentLength: number;
  /** Cyclops eye radius in canvas px. */
  readonly eyeRadius: number;
  /** Body bounding-box width in canvas px (drawn centered on the body origin). */
  readonly bodyWidth: number;
  /** Body bounding-box height in canvas px. */
  readonly bodyHeight: number;
  /** Runtime gait speed multiplier (NOT seed-derived; caller-owned). */
  speed: number;
}

/**
 * Per-frame mutable state carried between ticks. The fields below are the
 * ONLY pieces of state that depend on prior frames (phase memory for
 * locomotion, velocity memory for the Verlet chain). Everything else is a
 * pure function of `config` + `tick`.
 */
export interface HeroFrameState {
  /** Seed-derived static config (immutable; `speed` may be mutated). */
  readonly config: HeroConfig;
  /** Locomotion phase accumulator (advanced each tick). */
  locomotion: LocomotionState;
  /** Antenna Verlet chain (advanced each tick). */
  antenna: VerletNode[];
  /** Jump state machine (advanced each tick; grounded no-op until triggered). */
  jump: JumpState;
  /**
   * Horizontal offset from the canvas center in px (positive = right). Used
   * only by the displacement-driven walk path (`HeroInputs.walkDx`); stays at
   * `0` for the legacy time-driven walk-in-place path. Wraps at the canvas
   * edges so the hero traverses endlessly without a visible pop.
   */
  x: number;
  /**
   * Horizontal facing direction. `+1` = face right (the un-mirrored default;
   * knees point right, the platformer convention), `-1` = face left (the
   * character is mirrored horizontally around its body center at draw time).
   * Persisted across ticks: when the caller stops passing a concrete `facing`
   * (e.g. on key release / idle), the previous value is kept so the character
   * does not snap back to a default. Initialized to `+1` (right) for
   * backward-compat with the benchmark path that never passes `facing`.
   */
  facing: 1 | -1;
  /**
   * Eye count for the face: `1` = cyclops (the seed-canonical default, drawn
   * as a single sclera centered on the body), `2` = two-eyed (two smaller
   * sclerae at ±eyeSpacing). Showcase-only state — NOT seed-derived (the RNG
   * consumption order in `deriveHeroConfig` is untouched); defaults to `1` so
   * the benchmark path (`stepHero(frame, dt)` with no inputs) and any caller
   * that never passes `eyeCount` get the original cyclops and byte-identical
   * `hero-final-*.png` output. Persisted across ticks the same way `facing`
   * is: omit `eyeCount` in `HeroInputs` to carry the previous value forward.
   */
  eyeCount: 1 | 2;
}

/**
 * Per-tick inputs from the showcase, combining jump edges with the optional
 * horizontal walk displacement. Replaces the old `stepHero(state, dt,
 * jumpInputs?)` shape so callers no longer pass `isGrounded` (collision is
 * owned by the showcase and computed internally from `state.jump.y`).
 *
 * **Walk mode discriminator:** `walkDx` decides how the locomotion phase
 * advances. If `walkDx` is `undefined`, `stepHero` falls back to the legacy
 * time-driven `advanceLocomotion` (walk-in-place, used by benchmark renders).
 * If `walkDx` is provided (even `0`), the phase is displacement-driven via
 * `advanceLocomotionByDisplacement` — `0` freezes the cycle (feet planted,
 * idle pose); nonzero walks the hero across the canvas with phase synced to
 * translation so feet don't slide.
 */
export interface HeroInputs {
  /** Edge-triggered jump press this tick (button click / spacebar down). */
  readonly jumpPressed?: boolean;
  /** Continuous jump hold (held = full jump; released early = short hop). */
  readonly jumpHeld?: boolean;
  /**
   * Horizontal displacement this tick in WORLD-space canvas px (positive =
   * right). `0` = idle (phase frozen, feet planted); nonzero = walk with phase
   * synced to translation; `undefined` = legacy time-driven walk-in-place
   * (back-compat for benchmarks). The world-space `walkDx` also advances the
   * hero's `x` offset directly; for PHASE advancement, `stepHero` converts it
   * to local space (`walkDx * facing`) before calling
   * `advanceLocomotionByDisplacement` so the gait always advances forward
   * regardless of facing (the renderer's mirror handles the visual direction).
   */
  readonly walkDx?: number;
  /**
   * Desired facing this tick. `+1` = face right, `-1` = face left. When
   * provided, the returned state's `facing` is set to it; when omitted, the
   * previous `facing` is carried forward (so the character keeps its last
   * facing while idle). The benchmark path omits it and stays at the initial
   * `+1` (face right) forever.
   */
  readonly facing?: 1 | -1;
  /**
   * Desired eye count this tick. `1` = cyclops (default), `2` = two-eyed. When
   * provided, the returned state's `eyeCount` is set to it; when omitted, the
   * previous `eyeCount` is carried forward (so toggling once persists until
   * toggled again). The benchmark path omits it and stays at the initial `1`
   * (cyclops) forever → `hero-final-*.png` stays byte-identical.
   */
  readonly eyeCount?: 1 | 2;
}

// ---------------------------------------------------------------------------
// deriveHeroConfig — the seed contract
// ---------------------------------------------------------------------------

/**
 * Derive a complete hero configuration from a single 32-bit seed.
 *
 * Same seed → same config → same hero, forever. No `Math.random`, no
 * `Date.now`.
 *
 * **RNG consumption order** (the seed contract):
 * The palette is generated FIRST via `generatePalette(seed)`, which creates
 * its OWN internal `mulberry32(seed)` stream. The local `rng` below starts
 * FRESH from the same seed — two independent streams from the same seed.
 * Then the local `rng` is consumed in this exact order:
 *
 *   1.  bodyWidth           (nextInt)
 *   2.  bodyHeight          (nextInt)
 *   3.  eyeRadius           (nextInt)
 *   4.  thigh               (nextInt)
 *   5.  shin                (nextInt)
 *   6.  gait.baseFrequency  (nextFloat → lerp)
 *   7.  gait.strideLength   (nextFloat → lerp)
 *   8.  gait.strideHeight   (nextFloat → lerp)
 *   9.  gait.hipBobHeight   (nextFloat → lerp)
 *   10. gait.hipSwayWidth   (nextFloat → lerp)
 *   11. antennaSegments     (nextInt)
 *   12. antennaSegmentLength(nextFloat)
 *   13. spring.gravityY     (nextFloat → lerp)
 *   14. spring.drag         (nextFloat → lerp)
 *   15. breath.frequency    (nextFloat → lerp)
 *   16. breath.amplitude    (nextFloat → lerp)
 *
 * Reordering these calls would change every golden hero. Do not reorder.
 *
 * @param seed - 32-bit unsigned integer seed
 * @returns a fully populated, frozen-ish HeroConfig (the `speed` field is
 *   intentionally writable for runtime control)
 */
export function deriveHeroConfig(seed: number): HeroConfig {
  const rng = mulberry32(seed);
  const R = HERO_RANGES;

  // Palette: generatePalette creates its own mulberry32(seed) internally.
  // Our rng below starts fresh from the same seed for body proportions —
  // two independent streams from the same seed.
  const palette = generatePalette(seed);

  // Body proportions — draw order 1..3.
  const bodyWidth = R.bodyWidth.base + nextInt(rng, 0, R.bodyWidth.jitter);
  const bodyHeight = R.bodyHeight.base + nextInt(rng, 0, R.bodyHeight.jitter);
  const eyeRadius = R.eyeRadius.base + nextInt(rng, 0, R.eyeRadius.jitter);

  // Bone lengths — draw order 4..5.
  const thigh = R.thigh.base + nextInt(rng, 0, R.thigh.jitter);
  const shin = R.shin.base + nextInt(rng, 0, R.shin.jitter);

  // Gait — jittered multiplicatively from DEFAULT_GAIT. Draw order 6..10.
  const gaitConfig: GaitConfig = {
    baseFrequency:
      DEFAULT_GAIT.baseFrequency *
      lerp(R.gaitFrequencyMul.min, R.gaitFrequencyMul.max, nextFloat(rng, 0, 1)),
    strideLength:
      DEFAULT_GAIT.strideLength *
      lerp(R.gaitStrideLenMul.min, R.gaitStrideLenMul.max, nextFloat(rng, 0, 1)),
    strideHeight:
      DEFAULT_GAIT.strideHeight *
      lerp(R.gaitStrideHtMul.min, R.gaitStrideHtMul.max, nextFloat(rng, 0, 1)),
    hipBobHeight:
      DEFAULT_GAIT.hipBobHeight *
      lerp(R.gaitHipBobMul.min, R.gaitHipBobMul.max, nextFloat(rng, 0, 1)),
    hipSwayWidth:
      DEFAULT_GAIT.hipSwayWidth *
      lerp(R.gaitHipSwayMul.min, R.gaitHipSwayMul.max, nextFloat(rng, 0, 1)),
  };

  // Antenna geometry + spring physics — draw order 11..14.
  const antennaSegments = R.antennaSegments.base + nextInt(rng, 0, R.antennaSegments.jitter);
  const antennaSegmentLength =
    R.antennaSegmentLength.base + nextFloat(rng, 0, R.antennaSegmentLength.jitter);
  const springConfig: SpringConfig = {
    ...DEFAULT_SPRING,
    segmentLength: antennaSegmentLength,
    // Antenna is an UPWARD element, so gravity must bias it upward
    // (negative Y). `-Math.abs(...)` keeps the sign negative regardless of
    // the multiplier draw and is self-documenting: the minus signals "this
    // is an upward antenna, not a hanging tail." The absolute magnitude
    // still scales with DEFAULT_SPRING.gravityY × the springGravityMul draw.
    //
    // ANTENNA_GRAVITY_SCALE (currently 0) zeroes solver gravity: the
    // showcase-local `applyAntennaTipWeight` nudge now owns the ball's
    // downward sag explicitly (in a tapered, tip-focused way a uniform
    // solver gravity could not), and solver gravity would double-apply it
    // AND fight `applyAntennaRestPose` during landings. The RNG draw #13
    // (springGravityMul) is still consumed here so the seed contract's 16-draw
    // order is unchanged; raising ANTENNA_GRAVITY_SCALE re-activates it.
    gravityY:
      -Math.abs(DEFAULT_SPRING.gravityY) *
      lerp(R.springGravityMul.min, R.springGravityMul.max, nextFloat(rng, 0, 1)) *
      ANTENNA_GRAVITY_SCALE,
    drag: lerp(R.springDrag.min, R.springDrag.max, nextFloat(rng, 0, 1)),
  };

  // Breathing — draw order 15..16.
  const breathConfig: BreathConfig = {
    frequency:
      DEFAULT_BREATH.frequency *
      lerp(R.breathFreqMul.min, R.breathFreqMul.max, nextFloat(rng, 0, 1)),
    amplitude:
      DEFAULT_BREATH.amplitude *
      lerp(R.breathAmpMul.min, R.breathAmpMul.max, nextFloat(rng, 0, 1)),
  };

  return {
    seed,
    palette,
    gaitConfig,
    springConfig,
    breathConfig,
    boneLengths: { thigh, shin },
    antennaSegments,
    antennaSegmentLength,
    eyeRadius,
    bodyWidth,
    bodyHeight,
    speed: 1,
  };
}

// ---------------------------------------------------------------------------
// Frame state — create + step
// ---------------------------------------------------------------------------

/**
 * Create the initial per-frame state for a hero at rest. The locomotion
 * phase starts at 0; the antenna chain extends along the FORWARD-TILTED rest
 * vector used by `applyAntennaRestPose` (lean ANTENNA_FORWARD_LEAN_X forward
 * from vertical) with zero implicit velocity, so the first frame is at rest
 * — no initial-frame whip.
 *
 * The antenna is an UPWARD element (not a hanging tail), so we build the
 * nodes manually here — `createSpringChain` from the library is correctly
 * designed for DOWNWARD-hanging chains (tails, hair) and would lay the
 * antenna nodes out over the hero's face. Mirroring its node shape but
 * inverting the Y direction (and tilting +X by the forward lean) gives the
 * rest pose; the `advanceSpringChain` solver is direction-agnostic (it pins
 * node[0] to the anchor each tick and only enforces segment lengths), so the
 * tilted init composes with it cleanly.
 *
 * @param config - seed-derived static config
 * @returns the initial frame state
 */
export function createHeroFrameState(config: HeroConfig): HeroFrameState {
  const anchor = bodyTopAtRest(config);
  const antenna: VerletNode[] = [];
  // Forward-tilted rest vector — MUST match applyAntennaRestPose's per-segment
  // vector so the first frame is at rest (no initial-frame whip). See that
  // function for the geometry.
  const rx = config.antennaSegmentLength * ANTENNA_FORWARD_LEAN_X;
  const ry = -Math.sqrt(
    config.antennaSegmentLength * config.antennaSegmentLength - rx * rx,
  );
  for (let i = 0; i < config.antennaSegments; i++) {
    const x = anchor.x + i * rx;
    const y = anchor.y + i * ry;
    antenna.push({ x, y, prevX: x, prevY: y });
  }
  return {
    config,
    locomotion: { phase: 0 },
    antenna,
    jump: createJumpState(DEFAULT_JUMP),
    x: 0,
    facing: 1,
    eyeCount: 1,
  };
}

/**
 * Apply Provot next-nearest-neighbor bend springs to the antenna chain.
 *
 * For each node pair (i, i+2), a distance constraint with rest length
 * 2*segmentLength (the straight-rod distance) resists bending. This prevents
 * the chain from buckling or kinking under violent anchor motion (jump
 * landings) — the "rope/chain" read the user flagged. COEXISTS with
 * applyAntennaRestPose: the bend springs own inter-segment smoothness
 * (anti-buckling); the absolute forward-lean spring owns world-space
 * orientation. Pipeline in stepHero:
 *
 *   advanceSpringChain → applyAntennaBendConstraints → applyAntennaRestPose → applyAntennaTipWeight
 *
 * Root handling: when i === 0, node 0 (the pinned root) is immovable and
 * node 2 takes the full correction — mirrors the distance constraint's i===1
 * special case in spring.ts. For i > 0, the correction splits 50/50.
 *
 * Tapered stiffness: pair i=0 (base) → ANTENNA_BEND_STIFFNESS_BASE, last pair
 * (tip) → ANTENNA_BEND_STIFFNESS_TIP, linear between.
 *
 * Operates in place on the fresh chain from advanceSpringChain (already a deep
 * copy — state.antenna is never mutated). Moves curr AND prev by the same
 * delta to preserve implicit Verlet velocity (same discipline as
 * applyAntennaRestPose / applyAntennaTipWeight).
 *
 * @param nodes - fresh chain from advanceSpringChain (mutated + returned)
 * @param segmentLength - rest distance between adjacent nodes
 * @returns the same array (mutated in place) for chaining
 */
export function applyAntennaBendConstraints(
  nodes: VerletNode[],
  segmentLength: number,
): VerletNode[] {
  const restLen = 2 * segmentLength;
  const pairs = nodes.length - 2; // i ranges 0..n-3
  for (let i = 0; i < pairs; i++) {
    const a = nodes[i];
    const b = nodes[i + 2];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d === 0) continue;
    const diff = restLen - d;
    const ox = (dx / d) * diff;
    const oy = (dy / d) * diff;
    // Tapered stiffness: pair i=0 (base) → BASE, pair i=pairs-1 (tip) → TIP.
    const t = pairs > 1 ? i / (pairs - 1) : 0;
    const stiff =
      ANTENNA_BEND_STIFFNESS_BASE +
      (ANTENNA_BEND_STIFFNESS_TIP - ANTENNA_BEND_STIFFNESS_BASE) * t;
    const corrx = ox * stiff;
    const corry = oy * stiff;
    if (i === 0) {
      // Root (node 0) immovable; node 2 takes full correction.
      b.x += corrx;
      b.y += corry;
      b.prevX += corrx;
      b.prevY += corry;
    } else {
      // Split 50/50 — move curr AND prev together (velocity preservation).
      a.x -= corrx * 0.5;
      a.y -= corry * 0.5;
      a.prevX -= corrx * 0.5;
      a.prevY -= corry * 0.5;
      b.x += corrx * 0.5;
      b.y += corry * 0.5;
      b.prevX += corrx * 0.5;
      b.prevY += corry * 0.5;
    }
  }
  return nodes;
}

/**
 * Apply the antenna's directional spring: pull every node toward a forward-
 * tilted rest pose (per-segment vector rotated ANTENNA_FORWARD_LEAN_X forward
 * from vertical), with tapered stiffness (base-stiffer-than-tip). Replaces the
 * old `stiffenAntenna` straight-up correction — the library solver has no
 * preferred-direction term, so this showcase-local positional correction owns
 * the rest pose exactly as before, just with a forward tilt + a taper.
 *
 * Operates in place on the fresh chain from `advanceSpringChain` (already a
 * deep copy — `state.antenna` is never mutated), preserving `stepHero`'s pure-
 * progression-ops boundary. Moves curr AND prev by the same delta to preserve
 * implicit Verlet velocity (otherwise the positional jump reads as a velocity
 * spike and re-excites the whip).
 *
 * Node 0 (anchor, re-pinned by the solver) untouched. Taper: node 1 uses
 * ANTENNA_BASE_STIFFNESS, the last node uses ANTENNA_TIP_STIFFNESS, between
 * linear on `i/(n-1)`. Both gradients compound toward the tip (stiffness ↓,
 * tip-weight ↑ in the separate pass below) → sag concentrates at the tip →
 * "rod bending under ball weight," not tentacle/whip.
 *
 * @param nodes - fresh chain from `advanceSpringChain` (mutated + returned)
 * @param segmentLength - rest distance between adjacent nodes
 * @returns the same array (mutated in place) for chaining
 */
export function applyAntennaRestPose(
  nodes: VerletNode[],
  segmentLength: number,
): VerletNode[] {
  // Forward-tilted per-segment rest vector. Unit length = segmentLength,
  // rotated forward by atan(ANTENNA_FORWARD_LEAN_X) from straight-up.
  const rx = segmentLength * ANTENNA_FORWARD_LEAN_X;
  const ry = -Math.sqrt(segmentLength * segmentLength - rx * rx);
  const last = nodes.length - 1;
  for (let i = 1; i < nodes.length; i++) {
    const below = nodes[i - 1];
    const restX = below.x + rx;
    const restY = below.y + ry;
    const n = nodes[i];
    // Tapered stiffness: base (i=1) → ANTENNA_BASE_STIFFNESS, tip (i=last) →
    // ANTENNA_TIP_STIFFNESS, linear between.
    const t = last > 1 ? (i - 1) / (last - 1) : 0;
    const stiff =
      ANTENNA_BASE_STIFFNESS +
      (ANTENNA_TIP_STIFFNESS - ANTENNA_BASE_STIFFNESS) * t;
    const dx = (restX - n.x) * stiff;
    const dy = (restY - n.y) * stiff;
    // Move both current and prev by the same delta to preserve implicit Verlet
    // velocity (otherwise the position jump reads as a velocity spike and the
    // chain whips).
    n.x += dx;
    n.y += dy;
    n.prevX += dx;
    n.prevY += dy;
  }
  return nodes;
}

/**
 * Apply the antenna tip weight: a positional downward nudge proportional to
 * node position along the chain (base ~0, tip full ANTENNA_TIP_WEIGHT). Models
 * the ball's mass bending the rod. Applied AFTER `applyAntennaRestPose` so the
 * stiffness correction sets the rest orientation first and this sags the tip
 * down from there (reverse order would have stiffness un-do the sag).
 *
 * Same velocity-preservation discipline: curr AND prev move by the same delta.
 * Operates in place on the fresh chain from `advanceSpringChain`.
 *
 * @param nodes - fresh chain (mutated + returned)
 * @returns the same array (mutated in place) for chaining
 */
export function applyAntennaTipWeight(nodes: VerletNode[]): VerletNode[] {
  const last = nodes.length - 1;
  if (last < 1) return nodes;
  for (let i = 1; i < nodes.length; i++) {
    const frac = i / last; // base (i=1) → small, tip (i=last) → 1.0
    const dy = ANTENNA_TIP_WEIGHT * frac;
    const n = nodes[i];
    // curr AND prev move together — preserve implicit Verlet velocity.
    n.y += dy;
    n.prevY += dy;
  }
  return nodes;
}

/**
 * Advance the hero's per-frame state by one fixed timestep.
 *
 * Runs the jump state machine, the locomotion phase accumulator, and the
 * antenna Verlet chain. The antenna anchor is recomputed from the locomotion
 * hip offset AND the current jump lift so the chain tracks the body during a
 * jump. The breath scale is NOT advanced here — it is a pure function of
 * `tick` composed with the jump scale at draw time.
 *
 * **Grounded check:** the showcase's "collision" is trivial — flat ground at
 * `jump.y === 0`. `isGrounded = state.jump.y >= 0`. This is computed
 * internally; callers never pass it. The library never reads collision.
 *
 * **Walk mode (the `walkDx` discriminator):**
 * - `inputs === undefined` OR `inputs.walkDx === undefined` → legacy
 *   time-driven `advanceLocomotion` (walk-in-place). Used by benchmark renders
 *   so `hero-final-*.png` stays byte-identical to the pre-walk-across output.
 * - `inputs.walkDx !== undefined` AND nonzero → displacement-driven
 *   `advanceLocomotionByDisplacement` (walk-across). The phase advances by the
 *   LOCAL-space displacement `(walkDx * facing) / (strideLength · π)` — the
 *   `facing` factor converts world-space `walkDx` to local-space so the phase
 *   always advances forward (see `advanceLocomotionByDisplacement`'s
 *   facing-mirror warning); the renderer's `ctx.scale(facing, 1)` mirror
 *   handles the visual direction. The hero's world-space `x` offset still
 *   translates by signed `walkDx` and wraps at the canvas edges for endless
 *   traversal.
 * - `inputs.walkDx === 0` → displacement-driven but phase FROZEN (feet planted,
 *   idle pose). The hero stands still.
 *
 * Jump inputs (`jumpPressed` / `jumpHeld`) work in ALL three modes — jumping
 * while walking continues the horizontal translation (jump and walk are
 * independent state machines).
 *
 * **Facing:** `inputs.facing` (`+1` right / `-1` left), when provided, sets the
 * returned state's `facing`; when omitted, the previous `facing` is carried
 * forward. The renderer mirrors the character horizontally when `facing === -1`.
 * The benchmark path (no inputs) stays at the initial `+1` forever.
 *
 * **Eye count:** `inputs.eyeCount` (`1` cyclops / `2` two-eyed), when provided,
 * sets the returned state's `eyeCount`; when omitted, the previous `eyeCount`
 * is carried forward. The renderer draws one or two sclerae accordingly. The
 * benchmark path (no inputs) stays at the initial `1` (cyclops) forever →
 * `hero-final-*.png` stays byte-identical. `eyeCount` is showcase state, NOT
 * seed-derived — the 16-draw RNG order in `deriveHeroConfig` is untouched.
 *
 * Pure: returns a new `HeroFrameState`; the input is not mutated.
 *
 * @param state - current frame state
 * @param dt - fixed timestep (caller MUST keep this constant, e.g. 1/60)
 * @param inputs - optional combined jump + walk inputs; omitted entirely for
 *   the legacy walk-in-place path used by benchmarks
 * @returns the next frame state
 */
export function stepHero(
  state: HeroFrameState,
  dt: number,
  inputs?: HeroInputs,
): HeroFrameState {
  const { config } = state;

  // Facing: take the caller's value when provided, otherwise carry the
  // previous frame's facing forward. The benchmark path (no `inputs`) keeps
  // the initial `+1` (face right) forever — backward-compat. The showcase
  // always passes a concrete `facing` so the character persists its last
  // direction while idle rather than snapping back to a default.
  const facing: 1 | -1 = inputs?.facing ?? state.facing;

  // Eye count: same carry-forward pattern as `facing`. Defaults to the
  // previous frame's value when omitted, so the benchmark path
  // (`stepHero(frame, dt)` with no inputs) stays at the initial `1`
  // (cyclops) forever → `hero-final-*.png` stays byte-identical. The
  // showcase toggles it via `HeroInputs.eyeCount` and it persists.
  const eyeCount: 1 | 2 = inputs?.eyeCount ?? state.eyeCount;

  // Grounded check from the current jump state (flat ground at y = 0). Always
  // computed internally — callers never pass isGrounded.
  const isGrounded = state.jump.y >= 0;

  // Jump inputs default to a grounded no-op when the caller passes none (the
  // legacy benchmark path), preserving byte-identical walk-in-place output.
  const jumpInputs: JumpInputs = {
    jumpPressed: inputs?.jumpPressed ?? false,
    jumpHeld: inputs?.jumpHeld ?? false,
    isGrounded,
  };

  let jump = advanceJump(state.jump, jumpInputs, dt, DEFAULT_JUMP);
  if (jump.phase === 'grounded' || jump.phase === 'landing') {
    jump = { ...jump, y: 0 };
  }

  // Walk: displacement-driven when walkDx is provided (even 0 → phase frozen,
  // feet planted). Time-driven walk-in-place when walkDx is undefined (legacy
  // back-compat for benchmark renders that call stepHero(frame, dt)).
  let locomotion: LocomotionState;
  let x = state.x;
  if (inputs !== undefined && inputs.walkDx !== undefined) {
    const dx = inputs.walkDx;
    // Advance phase by LOCAL-space displacement (dx * facing), not the signed
    // world-space `dx`. The renderer mirrors geometry with `ctx.scale(facing, 1)`
    // in `drawSlimeKnight`; passing signed `dx` here would reverse the gait
    // phase for leftward walking AND the mirror would reverse the geometry — a
    // double reversal that makes walk-left look like a broken reset. Local-
    // space `dx * facing` is always positive when actually walking (rightward
    // walk: dx>0 × facing+1 = +; leftward walk: dx<0 × facing-1 = +), so the
    // phase always advances forward and the mirror alone handles the visual
    // direction. World-space position below still uses signed `dx`. See
    // docs/design/walk-cycle-correction-decision.md.
    locomotion = advanceLocomotionByDisplacement(
      state.locomotion,
      dx * facing,
      config.gaitConfig,
    );
    if (dx !== 0) {
      x = wrapHeroX(x + dx, config.bodyWidth);
    }
  } else {
    locomotion = advanceLocomotion(
      state.locomotion,
      config.speed,
      dt,
      config.gaitConfig,
    );
  }

  const pose = evaluateLocomotion(locomotion, config.gaitConfig);

  // Antenna anchor tracks the lifted body: jump yOffset (negative = up) plus
  // the airborne hip raise (legs tuck → hip rides up), AND the horizontal `x`
  // offset so the chain follows the body during a walk-across. Keeps the chain
  // pinned to the body top throughout the jump arc + traversal.
  const jumpPose = evaluateJump(jump);
  const jumpLift = jumpPose.yOffset + DEFAULT_TUCK.hipRaise * jumpPose.airborneBlend;
  // Antenna anchor tracks the SCALED body top (jump scale + landing drop) so
  // the root stays connected to the body during the landing squat. See bodyTop.
  const anchor = bodyTop(config, pose.hipOffset, jumpLift, x, jumpPose.scale.scaleY);
  let antenna = advanceSpringChain(
    state.antenna,
    anchor.x,
    anchor.y,
    dt,
    config.springConfig,
  );
  // Showcase-local bend resistance (Provot next-nearest-neighbor springs):
  // enforces inter-segment smoothness so the chain reads as a bendy solid rod,
  // not a rope/chain that buckles under jump landings. COEXISTS with
  // applyAntennaRestPose below (bend = smoothness, rest-pose = forward lean).
  antenna = applyAntennaBendConstraints(antenna, config.antennaSegmentLength);
  // Showcase-local angular stiffness so the antenna stays upright with gentle
  // tip sway instead of flopping (issue #4). The library solver only enforces
  // segment lengths; this correction adds the preferred (vertical) direction.
  antenna = applyAntennaRestPose(antenna, config.antennaSegmentLength);
  // Showcase-local tip weight so the ball's mass bends the rod (sag
  // concentrates at the tip). Applied last so the stiffness corrections set
  // the orientation first; reverse order would have stiffness un-do the sag.
  antenna = applyAntennaTipWeight(antenna);

  return { config, locomotion, antenna, jump, x, facing, eyeCount };
}

/**
 * Wrap a hero `x` offset at the canvas edges so the hero traverses endlessly
 * without a visible pop. The wrap fires when the hero's body has FULLY exited
 * one edge: margin = `bodyWidth/2 + HERO_WALK_WRAP_MARGIN_FOOT` covers the
 * body plus the forward foot's reach.
 *
 * @param x - proposed new x offset (already incremented by this tick's walkDx)
 * @param bodyWidth - the hero's body width (drives the wrap margin)
 * @returns the wrapped x offset
 */
function wrapHeroX(x: number, bodyWidth: number): number {
  const half = HERO_CANVAS_SIZE / 2;
  const margin = bodyWidth / 2 + HERO_WALK_WRAP_MARGIN_FOOT;
  if (x > half + margin) return -half - margin;
  if (x < -half - margin) return half + margin;
  return x;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Body top center at rest (no locomotion offset). */
function bodyTopAtRest(config: HeroConfig): { x: number; y: number } {
  return { x: HERO_CENTER_X, y: heroCenterY(config) - config.bodyHeight / 2 };
}

/** Body top center given a hip offset and optional jump lift (where the
 *  antenna root sits this tick). `jumpLift` is the vertical body displacement
 *  from the jump (yOffset + airborne hip raise); defaults to 0 (rest/walk).
 *  `xOffset` shifts the anchor horizontally for the walk-across traversal;
 *  defaults to 0 (rest / legacy walk-in-place path).
 *
 *  `jumpScaleY` (defaults to 1) mirrors `drawSlimeKnight`'s landing-squat
 *  correction so the antenna anchor rides the SCALED body top during landing:
 *  center-origin body scaling with `jumpScaleY < 1` pulls the visual body top
 *  UP, which previously left the anchor floating ~26px above the squashed body.
 *  Dropping the body center by the squashed height (`landingDrop`) and scaling
 *  the half-height by `jumpScaleY` puts the anchor exactly at the drawn body
 *  top — modulo the ±~1.5px breath residual, since breath is a function of
 *  `tick` (computed at draw time) and the anchor here can only track the JUMP
 *  scale. The `landingDrop` + `effectiveBodyCy` expressions intentionally
 *  duplicate `drawSlimeKnight`'s; keep them in sync if either changes. */
function bodyTop(
  config: HeroConfig,
  hipOffset: Readonly<{ x: number; y: number }>,
  jumpLift = 0,
  xOffset = 0,
  jumpScaleY = 1,
): { x: number; y: number } {
  const landingDrop = jumpScaleY < 1 ? (1 - jumpScaleY) * config.bodyHeight : 0;
  const effectiveBodyCy =
    heroCenterY(config) + hipOffset.y + jumpLift + landingDrop;
  return {
    x: HERO_CENTER_X + xOffset + hipOffset.x,
    y: effectiveBodyCy - (config.bodyHeight / 2) * jumpScaleY,
  };
}

// ---------------------------------------------------------------------------
// drawSlimeKnight — the canonical renderer
// ---------------------------------------------------------------------------

/**
 * Render the slime-knight into a 2D canvas context. The caller owns the
 * background and the clear; this function draws only the character (body +
 * legs + eye + antenna).
 *
 * Jump composition (mirrors `benchmarks/_scripts/locomotion-walk-jump-render.ts`):
 *   - **Body lift:** `bodyCy` shifts by `jumpPose.yOffset` (negative = up) plus
 *     the airborne hip raise. Feet lift by `yOffset` only (not the hip raise),
 *     so the legs compress into the tuck pose while airborne.
 *   - **Scale composition:** `breath × jumpPose.scale` (both volume-preserving,
 *     so the product is too). Computed UP FRONT so the hip Y can track the
 *     scaled body bottom (Change A); applied to body + eye.
 *   - **Airborne tuck blend:** walk-cycle foot offsets blend toward
 *     `DEFAULT_TUCK.tuckOffset` by `jumpPose.airborneBlend` before IK.
 *
 * Side-view walk model (hero leg overhaul):
 *   - **Hip-tracking (Change A):** `hipY = bodyCy + (bodyHeight/2) ·
 *     composedScaleY`. The hip attaches to the SCALED body bottom, so breath
 *     + jump scale visibly compress / extend the knees (idle breath → subtle
 *     knee oscillation; launch stretch → knees bend; landing squash → knees
 *     extend).
 *   - **Co-located hips + crossing walk (Change B):** both hips sit at
 *     `bodyCx` (side-view stance). The forward leg is drawn ON TOP of the back
 *     leg so the shins cross properly; the draw order is decided by foot X
 *     (facing-agnostic — the outer `ctx.scale(facing, 1)` mirror preserves
 *     call order, so the on-top leg stays on-top after mirroring).
 *   - **Forward foot (Change C):** the shoe is offset +X from the ankle so
 *     the toe points forward (in un-mirrored code space); the facing mirror
 *     flips it for `facing === -1`.
 *
 * Facing (`state.facing`): the character is drawn un-mirrored = facing RIGHT
 * (knees point right, the platformer convention) and mirrored horizontally
 * around its body center when `facing === -1`. The mirror wraps ONLY the
 * character — the caller's background + shadow must be painted BEFORE this
 * call so they are not mirrored.
 *
 * @param ctx - target canvas 2D context (caller owns transform/state)
 * @param state - per-frame state (locomotion phase + antenna chain + jump +
 *   facing + eyeCount)
 * @param tick - current tick (drives the pure breath oscillator)
 * @param look - optional gaze direction this frame, each component in
 *   `[-1, 1]`. The pupil offsets toward this vector: `look.x` shifts it
 *   forward/back (sign-corrected for the facing mirror — see `drawEye`),
 *   `look.y` shifts it up (`<0`) or down (`>0`). When omitted (the benchmark
 *   path), defaults to `{x: 0, y: 0}` so the cyclops pupil stays centered and
 *   `hero-final-*.png` stays byte-identical. The showcase computes this each
 *   tick from the walk direction + jump phase.
 */
export function drawSlimeKnight(
  ctx: CanvasRenderingContext2D,
  state: HeroFrameState,
  tick: number,
  look: { x: number; y: number } = { x: 0, y: 0 },
): void {
  const { config } = state;
  const palette = config.palette;
  const pose = evaluateLocomotion(state.locomotion, config.gaitConfig);
  const jumpPose = evaluateJump(state.jump);

  // Airborne tuck: blend walk-cycle foot offsets toward the tuck pose before IK.
  // airborneBlend=0 → pure walk offset; =1 → full tuck. No-op when grounded.
  const leftFootOffset = blendAirborneTuck(
    pose.leftFootOffset,
    jumpPose.airborneBlend,
    DEFAULT_TUCK,
  );
  const rightFootOffset = blendAirborneTuck(
    pose.rightFootOffset,
    jumpPose.airborneBlend,
    DEFAULT_TUCK,
  );

  // Composed scale (Change A keystone): breath × jumpPose scale, computed UP
  // FRONT so the hip Y can track the SCALED body bottom rather than the
  // unscaled body center + bodyHeight/2. Both `breathe` and `evaluateJump` are
  // pure readers; hoisting them above the hip math changes nothing about the
  // scale values themselves (the body still uses `ctx.scale(sx, sy)` below) —
  // it only makes the hip origin follow the visual body bottom as the body
  // breathes / squashes / stretches. Geometric effect:
  //   - idle breath (scaleY ≈ 1 ± 0.05): subtle hip Y oscillation → subtle
  //     knee bend oscillation (the user-visible "knees breathing" effect);
  //   - launch stretch (scaleY = 1.15): body bottom moves DOWN → hip drops →
  //     hip-to-foot distance shrinks → knees bend more (legs tuck under);
  //   - landing squash (scaleY dips to 0.7): center-origin scaling alone would
  //     move the body bottom UP and extend the legs straight ("pancake on
  //     stilts"); the landing-drop correction below translates the body center
  //     DOWN so the hip drops and the knees bend — the proper squat read.
  // This is center-origin scaling, so the bottom tracks `bodyCy + h/2 · scaleY`.
  const breath = breathe(tick, config.breathConfig);
  const composedScaleX = breath.scaleX * jumpPose.scale.scaleX;
  const composedScaleY = breath.scaleY * jumpPose.scale.scaleY;

  // Body lift: jump yOffset (negative = up) + airborne hip raise (tuck).
  // Body center shifts by `state.x` for the walk-across traversal (wraps at
  // the canvas edges in `stepHero`); everything below derives from `bodyCx`.
  const jumpLift = jumpPose.yOffset + DEFAULT_TUCK.hipRaise * jumpPose.airborneBlend;
  const bodyCx = HERO_CENTER_X + state.x + pose.hipOffset.x;
  const bodyCy = heroCenterY(config) + pose.hipOffset.y + jumpLift;

  // Landing squat correction. Center-origin body scaling pulls the hip UP on
  // jump-induced squash (composedScaleY < 1), which extends the legs straight
  // toward the planted feet — a "pancake on stilts" read instead of a squat.
  // Drop the body center by the squashed height so the hip moves DOWN (knees
  // bend via solveLimb) and the head comes down (deep squat read). Gated on
  // the JUMP scale only (not breath): landingDrop = 0 whenever jumpScaleY >= 1,
  // so idle breath keeps its center-origin behavior exactly and the GREENLIT
  // idle knee oscillation is unchanged.
  const jumpScaleY = jumpPose.scale.scaleY;
  const landingDrop = jumpScaleY < 1 ? (1 - jumpScaleY) * config.bodyHeight : 0;
  const effectiveBodyCy = bodyCy + landingDrop;

  // Hips — co-located at the body center X (Change B). With both hips on the
  // same vertical axis (side-view stance), the foot offsets swing the feet
  // forward/back past each other so the legs visibly cross during the walk
  // cycle. Zero X parallax keeps the silhouette cleanest; a ±1-2px depth
  // parallax would also work but adds visual noise without aiding the read.
  // The hip Y tracks the SCALED body bottom (Change A) — NOT the unscaled
  // `bodyCy + bodyHeight/2` — so breath + jump scale move the hip origin.
  const hipY = effectiveBodyCy + (config.bodyHeight / 2) * composedScaleY;
  const hipLeftX = bodyCx;
  const hipRightX = bodyCx;

  // Feet: x swings forward/back from the co-located hip; y is a LIFT height
  // (subtract from ground line). Add jumpPose.yOffset so the feet lift WITH
  // the body while airborne (the hip rises by jumpLift which includes
  // hipRaise, the feet only by yOffset → tuck).
  const gY = HERO_GROUND_Y;
  const leftFoot = {
    x: hipLeftX + leftFootOffset.x,
    y: gY - leftFootOffset.y + jumpPose.yOffset,
  };
  const rightFoot = {
    x: hipRightX + rightFootOffset.x,
    y: gY - rightFootOffset.y + jumpPose.yOffset,
  };

  // Mirror the character around its walk-offset axis when facing left. The
  // background + shadow are painted separately by the section BEFORE this
  // function is called and must NOT mirror, so this transform wraps ONLY the
  // character geometry below. `facing === +1` is a no-op (scale 1);
  // `facing === -1` mirrors horizontally around the body center.
  const charCx = HERO_CENTER_X + state.x;
  ctx.save();
  ctx.translate(charCx, 0);
  ctx.scale(state.facing, 1);
  ctx.translate(-charCx, 0);

  // 1. Legs in FIXED DEPTH ORDER. The left leg is the "near" leg (always drawn
  //    LAST / on top); the right leg is the "far" leg (always drawn FIRST /
  //    behind). There is NO swap during the walk cycle — the near leg always
  //    occludes the far leg when they cross, exactly as in a real side-view walk
  //    where one leg is permanently closer to the camera.
  //
  //    Previous versions tried to swap based on foot X (which foot is more
  //    forward) or foot Y (which foot is lifted). Both produced a visible "leg
  //    pop" at the swap point because the legs were not perfectly overlapping
  //    at the moment of the swap. A fixed near/far ordering eliminates the pop
  //    entirely — the legs simply cross with a consistent depth relationship.
  //
  //    Facing-agnostic: `ctx.scale(facing, 1)` mirrors X coordinates but does
  //    NOT change the order in which `drawLimb` is called, so the near leg
  //    stays on top after the mirror. The `bendDir = -1` on both legs is
  //    unchanged.
  const leftHip = { x: hipLeftX, y: hipY };
  const rightHip = { x: hipRightX, y: hipY };
  drawLimb(ctx, rightHip, rightFoot, config.boneLengths.thigh,
    config.boneLengths.shin, -1, palette);
  drawLimb(ctx, leftHip, leftFoot, config.boneLengths.thigh,
    config.boneLengths.shin, -1, palette);

  // 2. Body — rounded squircle (flat fill + chunky outline pass) + composed
  //    scale (breath × jumpScale; both volume-preserving → product is too).
  //    `composedScaleX/Y` were hoisted above the hip math (Change A) — same
  //    values as before, just reused so the hip origin and the drawn body
  //    agree on the same scale.
  ctx.save();
  ctx.translate(bodyCx, effectiveBodyCy);
  ctx.scale(composedScaleX, composedScaleY);
  drawBody(ctx, config, palette);
  ctx.restore();

  // 3. Antenna — Verlet chain already advanced in stepHero (anchor tracks the
  //    jump lift). Re-pin node 0 to the COMPOSED-SCALE body top at draw time so
  //    the base tracks breath + jump + landing exactly like the hips track the
  //    body bottom. The solver in stepHero runs with its jump-scale anchor only
  //    (breath is a function of `tick` and unavailable there) → the visual base
  //    was ~±1.5px off the body top during breath, reading as "not attached."
  //    This is a DRAW-LOCAL copy (`state.antenna` is never mutated — the draw
  //    stays a pure read of state). The solver still owns the physics; only the
  //    visual base position is corrected. Mirrors the hip Y formula (hip uses
  //    +bodyHeight/2 from center, the antenna base uses -bodyHeight/2).
  const antennaBaseX = bodyCx;
  const antennaBaseY = effectiveBodyCy - (config.bodyHeight / 2) * composedScaleY;
  const antennaForDraw = state.antenna.map((n, i) =>
    i === 0
      ? { x: antennaBaseX, y: antennaBaseY, prevX: antennaBaseX, prevY: antennaBaseY }
      : n
  );
  drawAntenna(ctx, antennaForDraw, palette);

  // 4. Eye — drawn AFTER the body so it sits on top. Recompute the composed
  //    body transform so the eye tracks the breathing + squashed body. The
  //    `look` vector (gaze direction) offsets the pupil toward the travel
  //    direction; `eyeCount` selects cyclops (1) vs two-eyed (2).
  ctx.save();
  ctx.translate(bodyCx, effectiveBodyCy);
  ctx.scale(composedScaleX, composedScaleY);
  drawEye(ctx, config, palette, state.eyeCount, look);
  ctx.restore();

  // Close the facing-mirror transform (matches the save above).
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Sub-draw helpers
// ---------------------------------------------------------------------------

/**
 * Body: flat fill + chunky outline rendered as a rounded-rectangle squircle
 * (corner radius ≈ 20% of the shorter side), matching the in-game-shapes
 * aesthetic. Sharp-cornered squares read as mechanical; the radius gives
 * the soft slime silhouette the benchmarker asked for.
 *
 * Centered on the current transform origin (the caller handles translate +
 * breath scale).
 */
function drawBody(
  ctx: CanvasRenderingContext2D,
  config: HeroConfig,
  palette: Palette,
): void {
  const w = config.bodyWidth;
  const h = config.bodyHeight;
  // ~20% of the shorter side → 70×60 gives r≈12, matching the benchmark's r=10.
  const r = Math.min(w, h) * 0.2;

  // Flat fill.
  roundRectPath(ctx, -w / 2, -h / 2, w, h, r);
  ctx.fillStyle = palette.base;
  ctx.fill();

  // Chunky outline pass on the same rounded path.
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = CHUNKY_OUTLINE_WIDTH;
  ctx.stroke();
}

/**
 * Eye rendering: cyclops (1 sclera) or two-eyed (2 smaller sclerae). The pupil
 * offsets toward the `look` gaze vector so the eye tracks the travel direction.
 *
 * **Pupil offset (mirror-sign corrected).** This function runs INSIDE the
 * body-local transform, which itself runs INSIDE `drawSlimeKnight`'s facing
 * mirror (`ctx.scale(state.facing, 1)`). To make the pupil look FORWARD (the
 * walk direction) on screen, the local-space pupil offset must come out as
 * "forward" AFTER the mirror. Trace it for a left-walking hero
 * (`look.x = -1`, `facing = -1`): if we naively offset by `look.x · reach` in
 * local X we get local `-X`, which the `facing = -1` mirror maps to screen
 * `+X` (RIGHT) — backwards. The fix: offset by `Math.abs(look.x) · reach` in
 * local `+X` always. Then:
 *   - walking right (`look.x = +1`, `facing = +1`): local `+X` → screen `+X` (right). ✓
 *   - walking left  (`look.x = -1`, `facing = -1`): local `+X` → screen `-X` (left).  ✓
 *   - idle facing right (`look.x = +1`, `facing = +1`): screen right. ✓
 *   - idle facing left  (`look.x = -1`, `facing = -1`): screen left.  ✓
 * `look.x ∈ [-1, 1]` so `abs` scales continuously (a future mouse-look could
 * feed fractional values); today the showcase only passes `0`, `+1`, or `-1`.
 *
 * The Y axis is NOT mirrored (only X is), so `look.y` maps straight through:
 * negative = up (rising), positive = down (falling).
 *
 * When `look = {0, 0}` (the benchmark path) every offset is `0` → the cyclops
 * pupil + highlight land exactly where the pre-look version drew them →
 * `hero-final-*.png` stays byte-identical.
 *
 * **Two-eyed mode (`eyeCount === 2`).** Two sclerae at `±eyeSpacing`
 * (`≈ bodyWidth · 0.18`), each radius `eyeRadius · 0.7` so both fit on the
 * face with a small gap between them and well inside the body silhouette.
 * Both pupils track the SAME `look` vector (the eyes verge together toward
 * the gaze target). Highlights are placed on the upper-LEFT of each pupil in
 * local space — the same convention as the cyclops — so the highlight language
 * stays consistent across modes (after the facing mirror both highlights flip
 * to upper-right together when facing left; they remain a symmetric pair).
 *
 * @param ctx - target canvas 2D context (caller owns the body-local transform)
 * @param config - hero config (supplies eyeRadius, bodyWidth, bodyHeight)
 * @param palette - color palette (feature sclera, outline pupil, white highlight)
 * @param eyeCount - `1` = cyclops, `2` = two-eyed
 * @param look - gaze vector this frame, each component in `[-1, 1]`
 */
function drawEye(
  ctx: CanvasRenderingContext2D,
  config: HeroConfig,
  palette: Palette,
  eyeCount: 1 | 2,
  look: { x: number; y: number },
): void {
  const eyeCy = -config.bodyHeight * 0.12;

  if (eyeCount === 1) {
    // Cyclops — single full-size sclera centered on the body midline.
    drawSingleEye(ctx, 0, eyeCy, config.eyeRadius, look, palette);
    return;
  }

  // Two-eyed — two smaller sclerae symmetric about the body midline. Spacing
  // and shrink factor chosen so both eyes fit comfortably inside the body
  // silhouette with a small gap between them (see JSDoc for the range math).
  const eyeSpacing = config.bodyWidth * 0.18;
  const scleraR = config.eyeRadius * 0.7;
  drawSingleEye(ctx, -eyeSpacing, eyeCy, scleraR, look, palette);
  drawSingleEye(ctx, +eyeSpacing, eyeCy, scleraR, look, palette);
}

/**
 * Draw one sclera + pupil + highlight at a given local center. Shared by the
 * cyclops and two-eyed paths so the sclera/pupil/highlight code is written
 * once. The pupil offsets toward `look` (mirror-sign corrected — see
 * `drawEye`'s JSDoc) and the white highlight tracks the pupil's offset
 * position (upper-left of the pupil in local space).
 *
 * @param ctx - target canvas 2D context (caller owns the transform)
 * @param cx - sclera center X in body-local space
 * @param cy - sclera center Y in body-local space
 * @param scleraR - sclera radius in canvas px (pupil + highlight derive from it)
 * @param look - gaze vector this frame, each component in `[-1, 1]`
 * @param palette - color palette
 */
function drawSingleEye(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scleraR: number,
  look: { x: number; y: number },
  palette: Palette,
): void {
  // Sclera — feature color, chunky outline.
  ctx.beginPath();
  ctx.arc(cx, cy, scleraR, 0, Math.PI * 2);
  ctx.fillStyle = palette.feature;
  ctx.fill();
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = CHUNKY_OUTLINE_WIDTH;
  ctx.stroke();

  // Pupil — outline color, offset toward the gaze vector. `pupilReach` is the
  // max safe travel: sclera radius minus pupil radius ≈ scleraR · (1 - 0.42) =
  // scleraR · 0.58; 0.4 leaves a comfortable margin so the pupil never kisses
  // the sclera edge.
  const pupilR = scleraR * 0.42;
  const pupilReach = scleraR * 0.4;
  const pupilCx = cx + Math.abs(look.x) * pupilReach;
  const pupilCy = cy + look.y * pupilReach;
  ctx.beginPath();
  ctx.arc(pupilCx, pupilCy, pupilR, 0, Math.PI * 2);
  ctx.fillStyle = palette.outline;
  ctx.fill();

  // Highlight — tiny white dot, upper-left of the pupil's offset position.
  // Tracks the pupil so the "spark of life" stays glued to the gaze.
  ctx.beginPath();
  ctx.arc(
    pupilCx - pupilR * 0.45,
    pupilCy - pupilR * 0.45,
    Math.max(1, pupilR * 0.35),
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

/**
 * One IK-driven leg: 2-bone chain solved analytically, drawn as two thick
 * accent-colored capsules with a chunky outline and a rounded foot.
 *
 * The limb solver is defensive (never throws); if the target is unreachable
 * the leg simply extends straight toward it.
 */
function drawLimb(
  ctx: CanvasRenderingContext2D,
  hip: { x: number; y: number },
  foot: { x: number; y: number },
  thighLen: number,
  shinLen: number,
  bendDir: number,
  palette: Palette,
): void {
  const solve = solveLimb(hip, foot, thighLen, shinLen, { bendDir });
  const knee = solve.jointPos;
  const ankle = solve.endPos;

  // Outline pass — thicker, drawn first so the accent fill sits on top.
  // Two segments: hip→knee, knee→ankle. 18px matches the benchmark's thick
  // rounded-rect stubs (10px wide + 2px outline ≈ 14px visual; we go a touch
  // heavier so the IK joint still reads as a single confident limb).
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 18;
  strokePolyline(ctx, [hip, knee, ankle]);

  // Accent fill — narrower, drawn on top to leave a chunky outline rim.
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 14;
  strokePolyline(ctx, [hip, knee, ankle]);

  // Foot — rounded-rect shoe placed FORWARD of the ankle (Change C). The
  // shoe's center is offset +X from the ankle by `shoeForward ≈ 0.4 · shoeW`,
  // so the ankle sits just behind the shoe's midpoint (heel-side) and the toe
  // extends forward. In un-mirrored code space +X is "forward" for facing-right
  // (the platformer default); the outer `ctx.scale(facing, 1)` mirror in
  // `drawSlimeKnight` flips +X to -X for `facing === -1`, so the toe
  // automatically points in the facing direction — no per-facing branch
  // needed here, and the same call works for both facings.
  //
  // The 0.4 ratio is a magic number local to this renderer (consistent with
  // the existing `shoeW = 18` / `shoeH = 10` locals). It places the ankle
  // near the heel so the shoe reads as a forward-pointing foot rather than
  // the previous stub-behind-ankle silhouette.
  const shoeW = 18;
  const shoeH = 10;
  const shoeForward = shoeW * 0.4;
  const shoeCx = ankle.x + shoeForward;
  const shoeCy = ankle.y;
  ctx.fillStyle = palette.accent;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = CHUNKY_OUTLINE_WIDTH;
  roundRectPath(ctx, shoeCx - shoeW / 2, shoeCy - shoeH / 2, shoeW, shoeH, 3);
  ctx.fill();
  ctx.stroke();
}

/**
 * Antenna: stroke a chunky outline + accent core through the Verlet chain as a
 * C1-smooth midpoint Bezier curve (`strokeBezier` via `quadraticCurveTo`), then
 * cap the tip with a small accent ball. The root node is the body-top anchor
 * (drawn as part of the line, not separately). The Bezier curve gives C1 visual
 * continuity so the antenna reads as a smooth rod even where the underlying
 * nodes have slight angular changes — complementing the bend-constraint physics
 * (a slightly-kinked chain still renders as a smooth curve).
 */
function drawAntenna(
  ctx: CanvasRenderingContext2D,
  nodes: readonly VerletNode[],
  palette: Palette,
): void {
  if (nodes.length < 2) return;

  // Outline pass (thicker, drawn first).
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 5;
  strokeBezier(ctx, nodes);

  // Core (narrower, on top).
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2;
  strokeBezier(ctx, nodes);

  // Tip ball.
  const tip = nodes[nodes.length - 1];
  const ballR = 5;
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, ballR, 0, Math.PI * 2);
  ctx.fillStyle = palette.accent;
  ctx.fill();
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Canvas path helpers (showcase-local; not library material)
// ---------------------------------------------------------------------------

/** Stroke a polyline through an array of points with the current ctx style. */
function strokePolyline(
  ctx: CanvasRenderingContext2D,
  pts: readonly { x: number; y: number }[],
): void {
  if (pts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

/** Stroke a polyline through Verlet node positions with the current ctx style. */
export function strokeVerlet(
  ctx: CanvasRenderingContext2D,
  nodes: readonly VerletNode[],
): void {
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  for (let i = 1; i < nodes.length; i++) ctx.lineTo(nodes[i].x, nodes[i].y);
  ctx.stroke();
}

/**
 * Stroke a smooth C1 curve through Verlet nodes using midpoint Bezier
 * (`quadraticCurveTo`). The control point is the physics node; the on-curve
 * point is the midpoint between adjacent nodes. First and last nodes are
 * on-curve endpoints. Native Canvas2D — zero allocations, deterministic.
 *
 * Complementary to the bend-constraint physics: even a slightly-kinked
 * underlying chain renders as a smooth curve, compounding the rod read.
 */
function strokeBezier(
  ctx: CanvasRenderingContext2D,
  nodes: readonly VerletNode[],
): void {
  if (nodes.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  for (let i = 1; i < nodes.length - 1; i++) {
    const xc = (nodes[i].x + nodes[i + 1].x) / 2;
    const yc = (nodes[i].y + nodes[i + 1].y) / 2;
    ctx.quadraticCurveTo(nodes[i].x, nodes[i].y, xc, yc);
  }
  ctx.lineTo(nodes[nodes.length - 1].x, nodes[nodes.length - 1].y);
  ctx.stroke();
}

/** Build a rounded-rect path (does not fill or stroke — caller does that). */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// Re-export so main.ts can inject the library outline color into CSS without
// a second import path. (Convenience only — main.ts already imports it directly.)
export { DEFAULT_OUTLINE_COLOR };
