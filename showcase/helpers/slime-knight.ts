/**
 * The canonical slime-knight — a single composed character built from library
 * primitives. One seed produces one character forever: palette, body
 * proportions, gait rhythm, antenna physics, and breathing amplitudes are all
 * derived deterministically from the seed.
 *
 * Composition stack:
 *   - Body:    rounded-rectangle squircle (flat fill + chunky outline pass).
 *   - Eye:     canvas circle in `palette.feature` + outline pupil + white
 *              highlight (matches the in-game-shapes aesthetic).
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
 */
export const HERO_GROUND_Y = HERO_CANVAS_SIZE * 0.82;

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
 * Extra wrap margin beyond `bodyWidth/2` when the hero walks off one canvas
 * edge and reappears at the other. Covers the forward foot's reach:
 * roughly `0.22 · bodyWidth` (hip offset) + `strideLength` (~4) + `shoe/2` (~9).
 * Keeps feet from poking out at the wrap boundary.
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
  gaitStrideLenMul: { min: 0.7, max: 1.3 }, // × DEFAULT_GAIT.strideLength
  gaitStrideHtMul: { min: 0.6, max: 1.4 }, // × DEFAULT_GAIT.strideHeight
  gaitHipBobMul: { min: 0.5, max: 1.5 }, // × DEFAULT_GAIT.hipBobHeight
  gaitHipSwayMul: { min: 0.5, max: 1.5 }, // × DEFAULT_GAIT.hipSwayWidth
  springGravityMul: { min: 0.8, max: 1.2 }, // × DEFAULT_SPRING.gravityY
  springDrag: { min: 0.92, max: 0.98 },
  breathFreqMul: { min: 0.8, max: 1.2 }, // × DEFAULT_BREATH.frequency
  breathAmpMul: { min: 0.7, max: 1.3 }, // × DEFAULT_BREATH.amplitude
} as const;

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
   * Horizontal displacement this tick in canvas px. `0` = idle (phase frozen,
   * feet planted); nonzero = walk with phase synced to translation;
   * `undefined` = legacy time-driven walk-in-place (back-compat for benchmarks).
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
    gravityY:
      -Math.abs(DEFAULT_SPRING.gravityY) *
      lerp(R.springGravityMul.min, R.springGravityMul.max, nextFloat(rng, 0, 1)),
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
 * phase starts at 0; the antenna chain extends straight UP from the body
 * top with zero implicit velocity.
 *
 * The antenna is an UPWARD element (not a hanging tail), so we build the
 * nodes manually here — `createSpringChain` from the library is correctly
 * designed for DOWNWARD-hanging chains (tails, hair) and would lay the
 * antenna nodes out over the hero's face. Mirroring its node shape but
 * inverting the Y direction gives the upward rest pose; the
 * `advanceSpringChain` solver is direction-agnostic (it pins node[0] to
 * the anchor each tick and only enforces segment lengths), so the upward
 * init composes with it cleanly.
 *
 * @param config - seed-derived static config
 * @returns the initial frame state
 */
export function createHeroFrameState(config: HeroConfig): HeroFrameState {
  const anchor = bodyTopAtRest(config);
  const antenna: VerletNode[] = [];
  for (let i = 0; i < config.antennaSegments; i++) {
    const y = anchor.y - i * config.antennaSegmentLength;
    antenna.push({ x: anchor.x, y, prevX: anchor.x, prevY: y });
  }
  return {
    config,
    locomotion: { phase: 0 },
    antenna,
    jump: createJumpState(DEFAULT_JUMP),
    x: 0,
    facing: 1,
  };
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
 *   `advanceLocomotionByDisplacement` (walk-across). The phase advances by
 *   `walkDx / (strideLength · π)` so feet plant without sliding, and the
 *   hero's `x` offset wraps at the canvas edges for endless traversal.
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
    locomotion = advanceLocomotionByDisplacement(
      state.locomotion,
      dx,
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
  const anchor = bodyTop(config, pose.hipOffset, jumpLift, x);
  const antenna = advanceSpringChain(
    state.antenna,
    anchor.x,
    anchor.y,
    dt,
    config.springConfig,
  );

  return { config, locomotion, antenna, jump, x, facing };
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
 *  defaults to 0 (rest / legacy walk-in-place path). */
function bodyTop(
  config: HeroConfig,
  hipOffset: Readonly<{ x: number; y: number }>,
  jumpLift = 0,
  xOffset = 0,
): { x: number; y: number } {
  return {
    x: HERO_CENTER_X + xOffset + hipOffset.x,
    y: heroCenterY(config) + hipOffset.y + jumpLift - config.bodyHeight / 2,
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
 *     so the product is too). Applied to body + eye.
 *   - **Airborne tuck blend:** walk-cycle foot offsets blend toward
 *     `DEFAULT_TUCK.tuckOffset` by `jumpPose.airborneBlend` before IK.
 *
 * Facing (`state.facing`): the character is drawn un-mirrored = facing RIGHT
 * (knees point right, the platformer convention) and mirrored horizontally
 * around its body center when `facing === -1`. The mirror wraps ONLY the
 * character — the caller's background + shadow must be painted BEFORE this
 * call so they are not mirrored.
 *
 * @param ctx - target canvas 2D context (caller owns transform/state)
 * @param state - per-frame state (locomotion phase + antenna chain + jump +
 *   facing)
 * @param tick - current tick (drives the pure breath oscillator)
 */
export function drawSlimeKnight(
  ctx: CanvasRenderingContext2D,
  state: HeroFrameState,
  tick: number,
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

  // Body lift: jump yOffset (negative = up) + airborne hip raise (tuck).
  // Body center shifts by `state.x` for the walk-across traversal (wraps at
  // the canvas edges in `stepHero`); everything below derives from `bodyCx`.
  const jumpLift = jumpPose.yOffset + DEFAULT_TUCK.hipRaise * jumpPose.airborneBlend;
  const bodyCx = HERO_CENTER_X + state.x + pose.hipOffset.x;
  const bodyCy = heroCenterY(config) + pose.hipOffset.y + jumpLift;

  // Feet: x swings forward/back, y is a LIFT height (subtract from ground line).
  // Add jumpPose.yOffset so the feet lift WITH the body while airborne (the hip
  // rises by jumpLift which includes hipRaise, the feet only by yOffset → tuck).
  const gY = HERO_GROUND_Y;
  const hipY = bodyCy + config.bodyHeight / 2;
  const hipLeftX = bodyCx - config.bodyWidth * 0.22;
  const hipRightX = bodyCx + config.bodyWidth * 0.22;

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
  // character geometry below. Mirroring around `charCx = HERO_CENTER_X +
  // state.x` flips the hip sway, leg stance, knee direction, and antenna sway
  // consistently; the symmetric body + centered cyclops eye + symmetric
  // antenna stay visually put. `facing === +1` is a no-op (scale 1);
  // `facing === -1` mirrors horizontally around the body center.
  const charCx = HERO_CENTER_X + state.x;
  ctx.save();
  ctx.translate(charCx, 0);
  ctx.scale(state.facing, 1);
  ctx.translate(-charCx, 0);

  // 1. Legs (drawn first so the body overlaps the hip joints).
  //    bendDir = -1 puts the knee on the +X side of the hip→foot line: for a
  //    vertical leg the perpendicular is `v = (-uy·bendDir, ux·bendDir) =
  //    (+1, 0)`, so the knee points RIGHT — the platformer convention (un-
  //    mirrored = facing right). When the caller mirrors with facing = -1 the
  //    whole leg (knee included) flips visually to point LEFT, correct for
  //    leftward motion. The foot-swing offsets from evaluateLocomotion are
  //    unchanged: they set which foot leads at a given phase, NOT the facing.
  drawLimb(ctx, { x: hipLeftX, y: hipY }, leftFoot, config.boneLengths.thigh,
    config.boneLengths.shin, -1, palette);
  drawLimb(ctx, { x: hipRightX, y: hipY }, rightFoot, config.boneLengths.thigh,
    config.boneLengths.shin, -1, palette);

  // 2. Body — rounded squircle (flat fill + chunky outline pass) + composed
  //    scale (breath × jumpScale; both volume-preserving → product is too).
  const breath = breathe(tick, config.breathConfig);
  const sx = breath.scaleX * jumpPose.scale.scaleX;
  const sy = breath.scaleY * jumpPose.scale.scaleY;
  ctx.save();
  ctx.translate(bodyCx, bodyCy);
  ctx.scale(sx, sy);
  drawBody(ctx, config, palette);
  ctx.restore();

  // 3. Antenna — Verlet chain already advanced in stepHero (anchor tracks the
  //    jump lift). Stroke through nodes.
  drawAntenna(ctx, state.antenna, palette);

  // 4. Eye — drawn AFTER the body so it sits on top. Recompute the composed
  //    body transform so the eye tracks the breathing + squashed body.
  ctx.save();
  ctx.translate(bodyCx, bodyCy);
  ctx.scale(sx, sy);
  drawEye(ctx, config, palette);
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
 * Cyclops eye: feature-colored sclera + outline pupil + white highlight.
 * Sits slightly above the body center (matching the in-game-shapes look).
 *
 * Centered on the current transform origin (the body center).
 */
function drawEye(
  ctx: CanvasRenderingContext2D,
  config: HeroConfig,
  palette: Palette,
): void {
  const eyeCx = 0;
  const eyeCy = -config.bodyHeight * 0.12;
  const r = config.eyeRadius;

  // Sclera — feature color, chunky outline.
  ctx.beginPath();
  ctx.arc(eyeCx, eyeCy, r, 0, Math.PI * 2);
  ctx.fillStyle = palette.feature;
  ctx.fill();
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = CHUNKY_OUTLINE_WIDTH;
  ctx.stroke();

  // Pupil — outline color, sized to read as a single confident gaze.
  const pupilR = r * 0.42;
  ctx.beginPath();
  ctx.arc(eyeCx, eyeCy, pupilR, 0, Math.PI * 2);
  ctx.fillStyle = palette.outline;
  ctx.fill();

  // Highlight — tiny white dot, upper-left of the pupil. The spark of life.
  ctx.beginPath();
  ctx.arc(eyeCx - pupilR * 0.45, eyeCy - pupilR * 0.45, Math.max(1, pupilR * 0.35),
    0, Math.PI * 2);
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

  // Foot — a rounded-rect shoe at the ankle, accent fill + outline. Sized to
  // read proportionally against the thicker leg (18×10 vs the old 14×8).
  const shoeW = 18;
  const shoeH = 10;
  ctx.fillStyle = palette.accent;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = CHUNKY_OUTLINE_WIDTH;
  roundRectPath(ctx, ankle.x - shoeW * 0.65, ankle.y - shoeH / 2, shoeW, shoeH, 3);
  ctx.fill();
  ctx.stroke();
}

/**
 * Antenna: stroke a chunky outline + accent core through the Verlet chain,
 * then cap the tip with a small accent ball. The root node is the body-top
 * anchor (drawn as part of the line, not separately).
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
  strokeVerlet(ctx, nodes);

  // Core (narrower, on top).
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2;
  strokeVerlet(ctx, nodes);

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
function strokeVerlet(
  ctx: CanvasRenderingContext2D,
  nodes: readonly VerletNode[],
): void {
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  for (let i = 1; i < nodes.length; i++) ctx.lineTo(nodes[i].x, nodes[i].y);
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
