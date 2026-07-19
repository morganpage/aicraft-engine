/**
 * Section 3 — Playable platformer playground.
 *
 * The "proof that the stack works" composite. A fully playable mini-platformer
 * on a 600×400 canvas (drawn at 1.25× zoom for a larger character read) that wires the
 * platformer kernel together with eleven sibling library modules:
 *   - `stepPlatformer` from `platformer/` is the authoritative deterministic
 *     step function. It owns the actor's position, velocity, contacts, and
 *     ability state (jump / wall-slide / dash / double-jump). It runs the
 *     locked update order: carry → abilities → horizontal input → gravity →
 *     axis collision → contacts/events. The showcase tunes a custom
 *     `PLAYGROUND_PLATFORMER_CONFIG` so the character feels identical to the
 *     pre-kernel hand-rolled physics (same gravity, jump height, move speed).
 *   - `createGameLoop` drives a fixed-step (1/60 s) loop with the library's
 *     own defensive rAF adapter — the first showcase section to use the
 *     game-loop module rather than a hand-rolled rAF loop.
 *   - `createKeyboardAdapter` polls input EXACTLY once per fixed tick and
 *     drains pressed/released edges (no stuck keys, no auto-repeat).
 *   - `createTouchButtonSet` tracks three on-screen overlay buttons
 *     (`◀` left / `▶` right / `Jump`) for coarse-pointer devices —
 *     multi-touch-safe (per-element `pointerId` sets + a global document
 *     safety net). The buttons are declarative markup in index.html,
 *     revealed only on touch devices via `@media (pointer: coarse)` in
 *     style.css. `orEdges` OR-merges keyboard + touch per action each tick
 *     so either device drives the player. No reset button — R-key reset is
 *     a power-user convenience and the fall-off respawn handles death.
 *   - The kernel calls `resolveAxisX`/`resolveAxisY` internally against the
 *     per-tick `Solid[]` level (static geometry + the gap's fragments),
 *     including a one-way passthrough platform.
 *   - `gapSolids` + `createGapMotion` + `advanceGapMotion` from `collision`
 *     drive a sweeping moving gap along a long floor segment (sweep +
 *     pingpong). The span's static floor is carved out so the gap's fragments
 *     are the sole floor inside it; a player standing on the span when the gap
 *     reaches them falls through (pit-death, not overlap) and respawns at
 *     spawn — the platformer-context demo of the moving-gap primitive. The
 *     fragments are tagged with stable string ids (`gap-0`, `gap-1`) so the
 *     kernel's riding-tracker can carry actors that stand on them; the
 *     displacement provider is a no-op for v1 (the fragments don't actually
 *     translate horizontally — they're rebuilds of the same span).
 *   - `createCamera` / `updateCamera` lerp + clamp the camera across the
 *     960×320 world (2× the viewport width — the camera follows).
 *   - `createHitStop` / `triggerHitStop` / `stepHitStop` / `isHitStopActive`
 *     freeze the simulation for a few ticks on a hard landing — the
 *     temporal-juice counterpart to squash & stretch.
 *   - `volumeScale` from `animation/squash-stretch` produces a volume-
 *     preserving (scaleX × scaleY === 1) squash on landing and a launch
 *     stretch on jump, decaying back to neutral each tick via a single
 *     `squashOffset` (volume-preserving throughout recovery). Triggered from
 *     `state.events.justLanded` / `.justLaunched` so the FX is grounded in
 *     the kernel's authoritative event pulses.
 *   - `spawn` + `step` from `particles` emit deterministic landing-dust bursts
 *     and per-step dust puffs synced to the walk-cycle foot-plant transitions
 *     (alpha-faded filled circles) — not a fixed timer.
 *   - `sineShake` + `shakeEnvelope` from `animation/oscillators` drive a
 *     decaying screen shake on hard landings (visual-only — never feeds back
 *     into camera state, so sim determinism is preserved).
 *   - `advanceLocomotionByDisplacement` + `evaluateLocomotion` from
 *     `animation/locomotion` integrate a displacement-driven walk-cycle phase
 *     (stop moving → dx=0 → phase freezes → feet planted) and derive hip/foot
 *     offsets via pure sin/cos — the trigonometric alternative to full IK.
 *   - `drawSimpleFeet` from `animation/simple-feet` renders two body-colored
 *     foot rects positioned by the locomotion pose (drawn behind the body so
 *     only the soles peek out at the bottom).
 *   - `createAudioAdapter` from `audio` synthesizes footstep / jump / landing
 *     SFX on the fly (oscillator tones + filtered noise) — defensive, lazily
 *     unlocked on first user gesture, no-op in Node.
 *
 * Plus three rendering primitives from `primitives/`:
 *   - `outlineRect` draws platforms + the character (flat fill + 1px outline).
 *   - `parallaxOffset` scrolls a starfield at 0.3× camera speed (demonstrates
 *     parallax).
 *   - `drawGlow` stamps a subtle additive glow under the character
 *     (demonstrates additive blending).
 *
 * Character personality — a cute purple cyclops, deliberately distinct from
 * Spitekeep's devil-orange character:
 *   - `breathe` + `DEFAULT_BREATH` from `animation/squash-stretch` apply a
 *     subtle ±5% vertical idle breathing oscillation, composed on top of the
 *     squash/stretch scale by multiplying the two `Scale2D` pairs.
 *   - Idle feet blend: when grounded + below the footstep-speed threshold, the
 *     locomotion foot offsets ease toward zero (neutral stance) over ~12 ticks
 *     so the character settles into a natural standing pose instead of freezing
 *     mid-stride; snaps back to the live walk cycle in ~5 ticks when moving.
 *   - A blinking cyclops eye (6×5 dark rect with a 2×2 white sparkle) drawn in
 *     a body-local + facing-mirrored transform; collapses to a 6×1 line every
 *     ~2-4 sec for ~83ms (render-tick driven — visual-only, never touches sim).
 *   - An expressive mouth: a gentle quadratic-curve smile when grounded, a
 *     small "o" (3×2) when airborne.
 *
 * Motion-gated: if the user prefers reduced motion, a single static frame is
 * rendered (character standing at spawn, camera at origin) and the loop is
 * never started. Matches the hero / lava-pool gate exactly.
 *
 * Local state: this section does NOT extend `GlobalState` — the playground
 * runs entirely on local game state (the platformer kernel state, camera,
 * hit-stop). The `store` parameter is accepted to match the section-init
 * signature but is intentionally unused (prefixed `_`).
 *
 * Page-scroll safety: arrow keys + Space scroll the page by default. A
 * `keydown` listener on `window` calls `preventDefault()` on those keys
 * ONLY when the playground section is in the viewport (tracked via an
 * IntersectionObserver). Scrolled out → page scrolls normally.
 */

import { createGameLoop, type GameLoop } from '../../src/game-loop';
import {
  createKeyboardAdapter,
  createTouchButtonSet,
  orEdges,
  type KeyboardAdapter,
  type PolledEdge,
  type TouchButtonSetAdapter,
} from '../../src/input';
import {
  gapSolids,
  createGapMotion,
  advanceGapMotion,
  DEFAULT_GAP_WIDTH,
  DEFAULT_GAP_SPEED,
  type Solid,
  type GapSpanConfig,
  type GapMotionConfig,
  type GapMotionState,
} from '../../src/collision';
import { createCamera, updateCamera, type Camera } from '../../src/camera';
import {
  createHitStop,
  triggerHitStop,
  stepHitStop,
  isHitStopActive,
  outlineRect,
  parallaxOffset,
  drawGlow,
  resizeCanvasToBackingStore,
} from '../../src/primitives';
import { volumeScale, breathe, DEFAULT_BREATH } from '../../src/animation/squash-stretch';
import { sineShake, shakeEnvelope } from '../../src/animation/oscillators';
import {
  spawn,
  step as stepParticles,
  particleAlphaCurve,
  particleSizeCurve,
  type Particle,
} from '../../src/particles';
import { mulberry32 } from '../../src/rng';
import {
  advanceLocomotionByDisplacement,
  evaluateLocomotion,
  type GaitConfig,
  type LocomotionState,
  type LocomotionPose,
} from '../../src/animation/locomotion';
import { drawSimpleFeet, DEFAULT_SIMPLE_FEET } from '../../src/animation/simple-feet';
import { createFootPlantState, advanceFootPlant } from '../../src/animation';
import { createAudioAdapter, type AudioAdapter } from '../../src/audio';
import {
  createPlatformerState,
  stepPlatformer,
  DEFAULT_PLATFORMER_CONFIG,
  type PlatformerConfig,
  type PlatformerInput,
  type PlatformerState,
  type SolidDisplacementProvider,
} from '../../src/platformer';
import { DEFAULT_JUMP } from '../../src/animation/jump';
import { shouldAnimate } from '../helpers/motion-gate';
import type { Store } from '../store';
import type { GlobalState } from '../main';

// --- World / viewport dimensions -------------------------------------------

/**
 * Idle edge — the zero state `{held, pressed, released} = {false,false,false}`.
 * Used as the fallback for `orEdges` when a keyboard or touch slot is absent
 * (defensive: `orEdges` is not null-safe, so missing slots fall back to this
 * rather than throwing). Mirrors the `IDLE` constant in the input adapters.
 */
const IDLE_EDGE: PolledEdge = { held: false, pressed: false, released: false };

/** Full world width. 2× viewport — the camera follows the player horizontally. */
const WORLD_W = 960;
/** Full world height. Same as the viewport — no vertical camera scroll. */
const WORLD_H = 320;
/** Viewport width. The canvas's intrinsic horizontal resolution. */
const VIEW_W = 600;
/** Viewport height. The canvas's intrinsic vertical resolution. */
const VIEW_H = 400;
/**
 * Render zoom factor — scales the world up so the character reads larger on
 * the bigger canvas. The camera viewport is divided by this so camera clamping
 * sees the same world area as before (480×320 effective).
 */
const CANVAS_ZOOM = 1.25;

// --- Level layout (world-space Solids) --------------------------------------

/** Ground floor top-surface Y. The player stands on top (y = GROUND_Y − PLAYER_H). */
const GROUND_Y = 288;
/** Ground floor thickness (px). */
const GROUND_HEIGHT = 32;
/**
 * X where the moving-gap span begins. The ground floor is split here: static
 * floor on both sides, gap-owned span in the middle (no static floor under
 * the span — the gap's `gapSolids` fragments are the sole floor inside it).
 */
const GAP_SPAN_X = 400;
/** Moving-gap span width (px). Wide enough to be a threatening hazard zone. */
const GAP_SPAN_WIDTH = 400;

/**
 * Static collision surfaces EXCLUDING the gap-owned span. The ground floor is
 * split into two fragments around the carved span; the player can stand safely
 * on either fragment. The span's fragments (from `gapSolids`, recomputed each
 * tick from `gapState`) are appended at resolve time — see `tickSolids` in the
 * fixed step.
 */
const STATIC_PLATFORMS: Solid[] = [
  // Ground floor — left fragment (world left to the gap span).
  { x: 0, y: GROUND_Y, width: GAP_SPAN_X, height: GROUND_HEIGHT },
  // Ground floor — right fragment (gap span end to world right).
  {
    x: GAP_SPAN_X + GAP_SPAN_WIDTH,
    y: GROUND_Y,
    width: WORLD_W - (GAP_SPAN_X + GAP_SPAN_WIDTH),
    height: GROUND_HEIGHT,
  },
  // Left wall.
  { x: 0, y: 0, width: 16, height: GROUND_Y },
  // Right wall.
  { x: WORLD_W - 16, y: 0, width: 16, height: GROUND_Y },
  // Floating platforms.
  { x: 160, y: 224, width: 96, height: 16 },
  { x: 320, y: 176, width: 80, height: 16 },
  { x: 640, y: 160, width: 96, height: 16 },
  { x: 800, y: 224, width: 80, height: 16 },
  // Passthrough platform (one-way — jump up through, land on top).
  { x: 480, y: 224, width: 96, height: 16, passthrough: true },
];

/**
 * The moving-gap span — a carved-out section of the ground floor. Has NO
 * static floor; the gap's `gapSolids` fragments (recomputed each tick from
 * `gapState`) are the sole floor inside it. A player standing on the span
 * when the gap reaches them falls through into the pit below and respawns.
 * Mirrors Spitekeep's movingVoid-demo level structure.
 */
const GAP_SPAN: GapSpanConfig = {
  x: GAP_SPAN_X,
  y: GROUND_Y,
  width: GAP_SPAN_WIDTH,
  height: GROUND_HEIGHT,
};

/**
 * Gap motion — `sweep` + `pingpong`. The gap sweeps back and forth along the
 * span, recurring so a visitor always sees the hazard within a few seconds.
 * Path endpoints are the clamp bounds (gap flush at each span edge); ordered
 * right → left so the gap starts at the far end and sweeps toward the player
 * (who enters the span from the left), matching the user's described scenario.
 */
const GAP_MOTION: GapMotionConfig = {
  travelMode: 'sweep',
  speed: DEFAULT_GAP_SPEED,
  gapWidth: DEFAULT_GAP_WIDTH,
  loopMode: 'pingpong',
  path: [
    { x: GAP_SPAN_X + GAP_SPAN_WIDTH - DEFAULT_GAP_WIDTH / 2, y: 0 },
    { x: GAP_SPAN_X + DEFAULT_GAP_WIDTH / 2, y: 0 },
  ],
};

// --- Player -----------------------------------------------------------------

/** Player collision-box width (px). */
const PLAYER_W = 24;
/** Player collision-box height (px). */
const PLAYER_H = 32;
/** Spawn X (px from world origin). Inside the left wall, on the ground. */
const SPAWN_X = 48;
/** Spawn Y (px from world origin). Standing on the ground floor (288 − 32). */
const SPAWN_Y = 256;

// --- Platformer kernel tuning -----------------------------------------------
//
// The kernel works in px/s and seconds; the pre-kernel playground worked in
// per-tick units at 60 Hz. The conversions are noted inline (× 60 for px/tick
// → px/s; × 60² for px/tick² → px/s²). The `jump` sub-config's apexHeight /
// timeToApex are derived from the original JUMP_VELOCITY and GRAVITY using
// the formulas documented on `JumpConfig`:
//   physics.gravity        = 2 · apexHeight / timeToApex²
//   physics.launchVelocity = −2 · apexHeight / timeToApex
// → apexHeight = |JUMP_VELOCITY|² / (2 · GRAVITY) = 9² / (2 · 0.5) = 81
//   timeToApex  = |JUMP_VELOCITY| / GRAVITY       = 9 / 0.5       = 18 ticks = 0.3 s
//
// All jump features the kernel supports but the original playground did NOT
// use (coyote time, jump buffering, anticipation, variable-height cutoff,
// fall-multiplier, kernel-owned landing squash) are disabled by setting their
// configs to no-op values. The showcase's richer impact-scaled squash system
// (driven from `state.events.justLanded`) is preserved end-to-end.

/**
 * Per-tick gravity in px/s². Original `GRAVITY = 0.5 px/tick²` × 60² = 1800.
 *
 * The kernel applies this in step 5 (integrate forces). The jump state
 * machine inside `advanceJump` ALSO integrates `physics.gravity` (derived
 * from apexHeight/timeToApex) during ballistic phases — that integration
 * governs the rising-phase transition timing. Both gravities match (1800),
 * which preserves the original's apex height and total airtime exactly (76.5
 * px above launch, ~17 ticks rise + ~17 ticks fall).
 */
const PLAYGROUND_GRAVITY = 1800;
/**
 * Terminal fall velocity in px/s. Original `MAX_FALL = 12 px/tick` × 60 = 720.
 */
const PLAYGROUND_MAX_FALL = 720;
/**
 * Ground move speed in px/s. Original `MOVE_SPEED = 3 px/tick` × 60 = 180.
 */
const PLAYGROUND_MOVE_SPEED = 180;
/**
 * Air-control multiplier in [0,1] (dimensionless). Original `AIR_CONTROL = 0.5`
 * (also dimensionless). NOTE: the kernel's air behavior RAMP-clamps vx toward
 * `moveSpeed` by this fraction per tick rather than snapping. With
 * `airControl = 0.5`, sustained air input still reaches full `moveSpeed`
 * (since 180 + (180-180)*0.5 = 180); only direction-reversals in mid-air feel
 * slightly weightier than the original's instant snap. Documented behavior
 * change, accepted for v1.
 */
const PLAYGROUND_AIR_CONTROL = 0.5;

/**
 * Tuning for the playground's platformer kernel. Spread
 * `DEFAULT_PLATFORMER_CONFIG` (which itself spreads `DEFAULT_JUMP` for the
 * `jump` sub-config) and override only the fields that differ.
 *
 * `wallSlideEnabled`, `dashEnabled`, `doubleJumpEnabled` are false — the
 * original playground is a minimal move+jump demo and does not exercise those
 * abilities.
 */
const PLAYGROUND_PLATFORMER_CONFIG: Readonly<PlatformerConfig> = {
  ...DEFAULT_PLATFORMER_CONFIG,
  gravity: PLAYGROUND_GRAVITY,
  maxFallSpeed: PLAYGROUND_MAX_FALL,
  moveSpeed: PLAYGROUND_MOVE_SPEED,
  airControl: PLAYGROUND_AIR_CONTROL,
  jump: {
    ...DEFAULT_JUMP,
    apexHeight: 81,
    timeToApex: 0.3,
    // Disable every kernel jump feature the original playground did not use.
    // `landingSquashMin: 1` ⇒ squashDepth = (1-1)*… = 0 ⇒ no kernel landing
    // squash. The showcase's impact-scaled squashOffset system is preserved
    // and triggered explicitly from `state.events.justLanded` in the step.
    coyoteTime: 0,
    jumpBufferTime: 0,
    anticipationDuration: 0,
    jumpCutoffFactor: 1,
    fallMultiplier: 1,
    landingSquashMin: 1,
    landingSquashStiffness: 0,
    landingSquashDamping: 0,
    anticipationSquash: 1,
    launchStretch: 1,
    airborneBlendRampUp: 0,
    airborneBlendRampDown: 0,
  },
  wallSlideEnabled: false,
  dashEnabled: false,
  doubleJumpEnabled: false,
};

/**
 * Per-tick gravity in px/s, expressed in original-tick units for the impact-
 * velocity reconstruction. The original `vyBeforeResolve = preVy + GRAVITY`
 * (per-tick). In kernel space, `preVy` is captured before `stepPlatformer` and
 * the equivalent is `preVy + GRAVITY_PER_TICK_AS_PX_PER_SEC` (= 0.5 × 60 = 30).
 *
 * Why this is correct even though the kernel integrates gravity twice during
 * a ballistic fall (once inside `advanceJump`, once in step 5): tick-by-tick
 * trace shows the kernel's effective landing velocity for a full-jump arc is
 * 510 px/s, identical to the original's `vyBeforeResolve`. The double
 * integration cancels out across the trajectory (apex height + airtime both
 * match the original exactly).
 */
const IMPACT_GRAVITY_PER_TICK_PX_PER_SEC = 30;
/**
 * Fall-off-world respawn margin. The player resets to spawn once their top
 * edge exceeds WORLD_H + this margin — the pit-death consequence of falling
 * through the moving gap (the floor is gone; gravity pulls them into the void).
 * Gives a brief visible fall before the respawn so the death reads clearly.
 */
const RESPAWN_FALL_MARGIN = 64;
/** Hit-stop freeze duration on a hard landing (ticks). */
const HIT_STOP_DURATION = 4;
/**
 * Minimum impact velocity that triggers a hit-stop freeze, in ORIGINAL per-tick
 * units (px/tick). The kernel works in px/s, so comparisons multiply this by
 * 60. Soft landings (stepping off a low platform) don't freeze; big falls do.
 */
const HIT_STOP_THRESHOLD_TICKS = 6;
/**
 * Maximum squash depth on landing. A deltaY of −0.3 yields scaleY 0.7 and
 * scaleX 1.43 (43% wider — organic, not the absurd 20× of the pre-fix bug).
 * Caps the normalized squash so even terminal-velocity landings stay readable.
 */
const MAX_SQUASH = 0.3;
/**
 * Reference downward velocity the squash is normalized against, in ORIGINAL
 * per-tick units (px/tick). Equal to the magnitude of the original
 * `JUMP_VELOCITY` (9 px/tick), so a full-jump-arc landing maps to the full
 * squash budget; smaller falls scale down proportionally. Comparisons multiply
 * by 60 to compare against the kernel's px/s impact velocity.
 */
const REFERENCE_VELOCITY_TICKS = 9;
/**
 * Per-tick multiplier applied to `squashOffset` toward neutral (0). ~18% decay
 * per tick → resolves in ~15 ticks (~250ms at 60Hz). Exponential decay on the
 * single offset preserves the volume invariant throughout recovery.
 */
const SQUASH_DECAY = 0.82;
/**
 * Vertical stretch applied on jump launch (Celeste-style post-launch stretch).
 * Positive deltaY → scaleY > 1 (taller), scaleX < 1 (thinner). Resolves via
 * the same `SQUASH_DECAY` as the landing squash. Triggered from the kernel's
 * `state.events.justLaunched` pulse.
 */
const LAUNCH_STRETCH = 0.15;
/** Camera-target offset (px) in the player's facing direction (lookahead). */
const CAMERA_LOOKAHEAD = 40;

/**
 * Playground-specific gait — wider stride and higher lift than DEFAULT_GAIT
 * so the walk reads clearly on a 32px-tall character. Doubling strideLength
 * from 4 to 8 halves the step cadence (~2.3 steps/sec — natural walk rhythm)
 * and makes each step visually pronounced.
 */
const PLAYGROUND_GAIT: Readonly<GaitConfig> = {
  baseFrequency: 0.05,
  strideLength: 8,
  strideHeight: 5,
  hipBobHeight: 2,
  hipSwayWidth: 1,
};

/** Dust-burst particle fill — warm tan, clearly visible against the dark bg. */
const COLOR_DUST_LANDING = '#9a8060';
/** Footstep-dust fill — slightly darker than landing dust for visual hierarchy. */
const COLOR_DUST_FOOTSTEP = '#8a7050';
/**
 * Minimum horizontal speed for footstep dust to spawn, in ORIGINAL per-tick
 * units (px/tick). Comparisons against the kernel's px/s `core.vx` multiply
 * this by 60. Standing still (vx≈0, feet already planted) doesn't fire.
 */
const FOOTSTEP_MIN_SPEED_TICKS = 1;

// --- Audio recipe constants ---
/** Footstep sound: short low-freq noise burst — a soft "tap". */
const FOOTSTEP_SOUND_DUR = 40;      // ms
/** Footstep sound: lowpass cutoff (Hz) — muffles the burst into a thud. */
const FOOTSTEP_SOUND_FREQ = 200;    // Hz
/** Footstep sound: peak gain — quiet (it fires every step). */
const FOOTSTEP_SOUND_PEAK = 0.12;
/** Screen-shake duration (render ticks) on a hard landing. */
const SHAKE_DURATION = 10;
/** Screen-shake x-axis frequency — decorrelated from y for an organic wobble. */
const SHAKE_FREQ_X = 1.5;
/** Screen-shake y-axis frequency. */
const SHAKE_FREQ_Y = 2.3;
/** Cap on shake magnitude so the freeze-frame never throws the read off. */
const SHAKE_MAX_MAGNITUDE = 6;
/** Shake magnitude per unit of impact velocity (pre-cap). */
const SHAKE_MAGNITUDE_PER_IMPACT = 0.5;
/** Particle-stepping gravity for dust (px/tick²). Mild so dust hangs briefly. */
const DUST_GRAVITY = 0.15;
/** Particle-stepping drag for dust. Quick settle so puffs don't skate. */
const DUST_DRAG = 0.92;

// --- Palette ----------------------------------------------------------------

/** Background fill — cave-warm near-black (matches lava-pool for cohesion). */
const COLOR_BG = '#1a0d0a';
/** Solid-platform fill — dark earthy brown. */
const COLOR_PLATFORM = '#3a2418';
/** Passthrough-platform fill — slightly lighter brown for visual distinction. */
const COLOR_PLATFORM_PASSTHROUGH = '#4a3020';
/** Moving-gap void fill — near-black, reads as a pit / absence of floor.
 *  Distinct from COLOR_BG so the gap reads as "a hole in the platform," not
 *  "the platform ends here." */
const COLOR_VOID = '#0a0506';
/** Player fill — soft purple. Cute + friendly, deliberately distinct from
 *  Spitekeep's devil orange (#FE5701) so the two characters read as different
 *  castes at a glance. */
const COLOR_PLAYER = '#6c5ce7';
/** Face feature color (eye + mouth) — matches DEFAULT_OUTLINE_COLOR for visual
 *  cohesion with the body's outline. */
const COLOR_FACE = '#1d1128';
/** Parallax starfield dot fill. */
const COLOR_STAR = '#5a4a3a';

// --- Starfield --------------------------------------------------------------

/** Deterministic seed for the parallax starfield. Same value → same stars. */
const STAR_SEED = 1337;
/** Number of parallax dots. Enough to read as a starfield, not so many they
 *  distract from the gameplay silhouettes. */
const STAR_COUNT = 40;

/**
 * Pre-computed starfield positions in world space. Generated once at module
 * load with a seeded RNG so the starfield is identical across page loads
 * (deterministic dressing, not random clutter). Rendered at
 * `parallaxOffset(camera.x, camera.y, 0.3)` each frame.
 */
const STARS: ReadonlyArray<{ x: number; y: number; size: number }> = (() => {
  const rng = mulberry32(STAR_SEED);
  const out: { x: number; y: number; size: number }[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    out.push({
      x: rng() * WORLD_W,
      y: rng() * WORLD_H,
      size: rng() < 0.25 ? 2 : 1,
    });
  }
  return out;
})();

// --- Codes whose default action is suppressed while the playground is onscreen

/** Keyboard codes whose default page action (scroll / space-press button) we
 *  suppress so the player can play without scrolling the page. */
const SUPPRESSED_CODES: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'KeyR',
]);

// --- Moving-gap carry wiring ------------------------------------------------
//
// The kernel reads `Solid.id` to populate `Contacts.groundId` and applies
// per-tick displacement via the optional `SolidDisplacementProvider` (step 2
// — carry actors before ability processing). `gapSolids` emits brand-new
// `Solid` records each tick (no ids), so the kernel would see `groundId: null`
// even when the player is standing on a gap fragment — carry would never
// engage. We tag the fragments positionally with stable ids (`gap-0`,
// `gap-1`) so the kernel's contact tracking survives re-creation of the
// fragment array. The displacement provider is a no-op (`{dx:0, dy:0}`) for
// v1: the gap fragments don't actually translate horizontally, they're
// rebuilds of the same span. The wiring is in place so a future change that
// makes the span translate (real moving-platform carry) just swaps in a real
// provider with no other edits here.

/**
 * Tag each fragment emitted by `gapSolids` with a stable positional id so the
 * kernel's riding-tracker can identify the surface the player is standing on
 * across re-creation of the per-tick solids array. Positional indexing is
 * fine because `gapSolids` always emits 0–2 fragments in left-to-right order.
 *
 * @param solids - gap fragments emitted by `gapSolids(GAP_SPAN, …)` this tick
 * @returns a new array of solids with stable `id` fields (`gap-0`, `gap-1`)
 */
const tagGapSolids = (solids: readonly Solid[]): Solid[] =>
  solids.map((s, i) => ({ ...s, id: `gap-${i}` }));

/**
 * No-op displacement provider — every moving-gap fragment reports zero
 * displacement because the span doesn't actually translate horizontally (the
 * gap sweeps along it, but the fragments themselves are static rebuilds).
 * Returning `{dx:0, dy:0}` lets the riding-tracker's `applyCarry` short-
 * circuit (the tracker returns the input core unchanged when both components
 * are zero, so there is no allocation overhead in the hot path).
 *
 * Solids without an id (the static platforms) never trigger a provider call
 * because the kernel gates the lookup on `core.contacts.groundId !== null`.
 */
const GAP_DISPLACEMENT_PROVIDER: SolidDisplacementProvider = () => ({
  dx: 0,
  dy: 0,
});

/**
 * Initialize the playground section.
 *
 * Wires the keyboard + touch adapters, game loop, and rendering pipeline.
 * Returns without starting the loop when reduced motion is preferred (a
 * single static frame is rendered instead). Returns a `dispose` callback
 * that tears down both input adapters (keyboard + touch), the
 * IntersectionObserver, and the window keydown listeners — defensive for
 * future single-page-app use (currently never called by the showcase, which
 * is single-mount).
 *
 * @param container - the `<section id="playground">` element
 * @param _store - the global observable store. Intentionally unused — the
 *   playground has no shared-seed concept (the player is local game state,
 *   not generated cosmetics). Accepted only to match the section-init
 *   signature.
 * @returns A `dispose` callback. Call it to tear down listeners + observers
 *   (idempotent — safe to call multiple times; the input adapters' own
 *   `dispose` methods are idempotent and the observer/listener removals are
 *   no-ops if already removed).
 */
export function initPlayground(
  container: HTMLElement,
  // Underscore-prefixed: TypeScript's `noUnusedParameters` exempts these.
  _store: Store<GlobalState>,
): () => void {
  const canvas = container.querySelector<HTMLCanvasElement>('.playground-canvas')!;
  const ctx = canvas.getContext('2d')!;
  // DPR-aware backing store: canvas.width/height = CSS size × devicePixelRatio
  // so the canvas renders crisp on Retina / high-DPI mobile. Applied ONCE at
  // setup as the base transform; all per-frame transforms (camera translate,
  // CANVAS_ZOOM scale, facing mirror) compose on top via ctx.save/scale/
  // translate/restore. CSS sizing is owned by style.css.
  const dpr = resizeCanvasToBackingStore(canvas, VIEW_W, VIEW_H);
  ctx.scale(dpr, dpr);

  // --- Local game state ----------------------------------------------------

  /**
   * Build the initial kernel state at spawn. `createPlatformerState` returns
   * a grounded-but-`onGround:false` state (the kernel doesn't pre-check
   * collision); we override `onGround` to true so the first render frame
   * matches the original "standing on the floor" pose without a 1-tick
   * settle. Subsequent ticks are entirely kernel-driven.
   */
  const makeInitialPlatformerState = (): PlatformerState => {
    const s = createPlatformerState(
      SPAWN_X,
      SPAWN_Y,
      PLAYGROUND_PLATFORMER_CONFIG,
      PLAYER_W,
      PLAYER_H,
    );
    return { ...s, core: { ...s.core, onGround: true } };
  };

  // The authoritative game state for this playground. Reassigned to a fresh
  // record each tick by `stepPlatformer` (the kernel is pure — it never
  // mutates the input state and returns a brand-new record). The renderer
  // reads `platformState.core.x / y / facing / onGround / vx / vy`.
  let platformState: PlatformerState = makeInitialPlatformerState();

  let camera: Camera = createCamera();
  let hitStop = createHitStop();

  // Squash/stretch deformation as a single volume-preserving offset (0 = neutral,
  // negative = squashed short, positive = stretched tall). `volumeScale` is
  // applied fresh each render so scaleX × scaleY stays exactly 1 throughout
  // decay — independent-axis lerps (the pre-fix approach) violate the invariant.
  let squashOffset = 0;

  // Dust particles (landing bursts + per-step footstep puffs). Stepped each
  // active tick with mild gravity + drag; rendered as alpha-fading circles.
  let dustParticles: Particle[] = [];

  // Locomotion phase accumulator — drives the simple-feet positions. Phase
  // advances by actual horizontal displacement (not time), giving emergent
  // foot-lock: stop moving → dx=0 → phase freezes → feet planted. Pure
  // progression op (returns a new LocomotionState each tick).
  let loco: LocomotionState = { phase: 0 };

  // Foot-plant detector state — threaded through the shared `advanceFootPlant`
  // engine primitive each tick so it can observe the >0 → 0 descent edge of
  // each foot's lift height (a foot "plants" when its lift transitions from >0
  // airborne to 0 grounded). Each plant spawns a dust puff + a footstep tap,
  // synced to the ACTUAL walk cycle instead of a fixed timer. Pure progression
  // op (returns a new state each tick).
  let plantState = createFootPlantState();

  // Audio adapter — defensive (lazy AudioContext, never-throw, no-op in Node).
  // Unlocked on first user gesture (see unlock listener below the keyboard
  // adapter); playback is a silent no-op until then (browser autoplay policy).
  const audio: AudioAdapter = createAudioAdapter();

  // Screen-shake state. `shakeTick` advances in the render pass (visual-only);
  // the offset never feeds back into camera state, so sim determinism holds.
  let shakeTick = 0;
  let shakeMagnitude = 0;

  // Idle feet blend weight [0,1]. 0 = full walk pose, 1 = full neutral stance.
  // Eases toward 1 when grounded + below the footstep-speed threshold (so feet
  // settle to a natural standing pose); snaps toward 0 when moving. Updated in
  // the fixed step; read in render to blend the locomotion foot offsets.
  let idleBlend = 0;

  // Render-tick clock for visual-only oscillations (breathing). Advances once
  // per render frame, never per fixed step, so it stays decoupled from the sim.
  let renderTick = 0;

  // Blink timing (render ticks). Visual-only — Math.random is acceptable here
  // (decorative side-effect, never feeds simulation state).
  // blinkCountdown: time until next blink fires (~2-4 sec between blinks).
  // blinkRemaining: remaining closed-eye duration (0 = eye open).
  let blinkCountdown = 120;
  let blinkRemaining = 0;

  // Moving-gap motion state — owns the gap's current center + width. Advanced
  // once per fixed tick via advanceGapMotion (pure: returns a new state) BEFORE
  // the per-tick solids are composed, so the gap is at its new position when
  // the resolver runs (mirrors Spitekeep's update.ts: advance hazard → resolve).
  // Reset to its initial sweep position by resetPlayer() (R-key + fall-off).
  let gapState: GapMotionState = createGapMotion(GAP_MOTION);

  // --- Input adapter -------------------------------------------------------
  //
  // Poll EXACTLY once per fixed tick — input edges (pressed / released) are
  // drained per poll, so polling at the fixed-step rate keeps the edge window
  // at exactly one tick (no double-fire, no missed presses).
  const keyboard: KeyboardAdapter = createKeyboardAdapter({
    codeToAction: {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      KeyA: 'left',
      KeyD: 'right',
      Space: 'jump',
      KeyR: 'reset',
    },
  });

  // --- Touch adapter (on-screen buttons for coarse-pointer devices) -------
  //
  // Three overlay <button>s in .playground-stage (left / right / jump), hidden
  // by default on desktop and revealed on touch devices via
  // `@media (pointer: coarse)` in style.css. On desktop (display:none) the
  // adapter still attaches listeners but pointer events never fire on a hidden
  // element — the slots report idle edges forever, which OR-merge harmlessly
  // with the keyboard. Array order is POSITIONAL and load-bearing:
  //   [0] = left, [1] = right, [2] = jump.
  // `null` elements (markup missing in an older mount) produce idle slots —
  // `createTouchButtonSet` handles null defensively. `reset` stays
  // keyboard-only (R-key power-user convenience; the touch UI is minimal).
  const touchLeftBtn = container.querySelector<HTMLButtonElement>(
    '.playground-touch-btn--left',
  );
  const touchRightBtn = container.querySelector<HTMLButtonElement>(
    '.playground-touch-btn--right',
  );
  const touchJumpBtn = container.querySelector<HTMLButtonElement>(
    '.playground-touch-btn--jump',
  );
  const touch: TouchButtonSetAdapter = createTouchButtonSet({
    elements: [touchLeftBtn, touchRightBtn, touchJumpBtn],
  });

  // --- Audio unlock --------------------------------------------------------
  //
  // Browser autoplay policy requires a user gesture before AudioContext can
  // make sound. One-shot listener on the first keydown OR pointerdown anywhere
  // on the page arms playback; self-removes after firing. Idempotent with
  // `audio.unlock()` (which itself is idempotent), so spurious triggers are
  // harmless.
  const unlockAudio = (): void => {
    audio.unlock();
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('pointerdown', unlockAudio);
  };
  window.addEventListener('keydown', unlockAudio);
  window.addEventListener('pointerdown', unlockAudio);

  // --- Render --------------------------------------------------------------

  /** Render the current state at the current camera position. Pure draw —
   *  no state mutation. Called once per render frame by the game loop. */
  const render = (): void => {
    // Clear with the background fill.
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // Screen-shake offset (visual-only). Computed in render so the wobble
    // tracks the host refresh rate; gated by `shakeMagnitude` so no offset is
    // applied when inactive. `shakeTick` advances only while a shake runs and
    // the magnitude decays to 0 after SHAKE_DURATION render ticks.
    let shakeX = 0;
    let shakeY = 0;
    if (shakeMagnitude > 0) {
      const envelope = shakeEnvelope(shakeTick, SHAKE_DURATION, shakeMagnitude);
      const s = sineShake(shakeTick, envelope, SHAKE_FREQ_X, SHAKE_FREQ_Y);
      shakeX = s.x;
      shakeY = s.y;
      shakeTick += 1;
      if (shakeTick > SHAKE_DURATION) {
        shakeMagnitude = 0;
      }
    }

    // Camera transform — the world is drawn in world space and shifted so the
    // camera's top-left lands at the viewport's origin. Math.round keeps
    // outlines on the pixel grid (no fractional-pixel seams). The shake offset
    // is added unrounded — a brief wobble is meant to jitter sub-pixel.
    ctx.save();
    ctx.scale(CANVAS_ZOOM, CANVAS_ZOOM);
    ctx.translate(-Math.round(camera.x) + shakeX, -Math.round(camera.y) + shakeY);

    // Parallax starfield — scrolls at 0.3× the camera, so the stars lag the
    // gameplay layer. parallaxOffset returns the OPPOSITE-of-camera delta
    // (stars scroll left as the camera moves right); we add it on top of the
    // camera translate so the net factor is 0.3× the world scroll.
    const parallax = parallaxOffset(camera.x, camera.y, 0.3);
    ctx.translate(parallax.x, parallax.y);
    ctx.fillStyle = COLOR_STAR;
    for (const star of STARS) {
      ctx.fillRect(Math.floor(star.x), Math.floor(star.y), star.size, star.size);
    }
    // Undo the parallax translate before drawing the world-space gameplay
    // layer (the camera translate is still in effect — that one we keep).
    ctx.translate(-parallax.x, -parallax.y);

    // Static platforms — solid vs passthrough get visually distinct fills so
    // the player can read which they’ll land on from below. The two ground
    // floor fragments (y === GROUND_Y) are SKIPPED here: the ground is drawn
    // as one continuous rect below so the floor reads as a single platform.
    // Drawing the fragments individually would stroke vertical lines at
    // x = GAP_SPAN_X and x = GAP_SPAN_X + GAP_SPAN_WIDTH (the span edges),
    // which telegraphs the hazard's travel bounds — the player should
    // discover the hole by seeing it move, not by reading boundary markers.
    // The fragments still exist in STATIC_PLATFORMS for collision (see
    // tickSolids); only the render read changes. Walls, floating platforms,
    // and the passthrough platform render unchanged.
    for (const plat of STATIC_PLATFORMS) {
      if (plat.y === GROUND_Y) continue;
      outlineRect(
        ctx,
        plat.x,
        plat.y,
        plat.width,
        plat.height,
        plat.passthrough ? COLOR_PLATFORM_PASSTHROUGH : COLOR_PLATFORM,
      );
    }

    // Continuous ground floor + moving void punch. The ground is drawn as ONE
    // rect spanning the full world width so it reads as a single continuous
    // platform — no per-fragment outlines, no static vertical lines marking
    // the gap-span boundaries. The void is then punched on top, opening a
    // clean hole that moves with `gapState`. The hole is the only visible
    // feature on the ground; its left/right edges (which MOVE) are the crisp
    // readable feature that defines the opening. Collision is a separate read
    // of the same gap state (gapSolids in tickSolids) — render and physics
    // share the source of truth but never desync because both derive from
    // gapState on the same tick (mirrors Spitekeep's renderer discipline).
    //
    // Ground rect — fill + 1px outline. Vertical outline lines land ONLY at
    // the world edges (x = 0, x = WORLD_W); the top/bottom edges span the
    // full width and will be opened by the void punch below.
    outlineRect(ctx, 0, GROUND_Y, WORLD_W, GROUND_HEIGHT, COLOR_PLATFORM);

    // Void punch — the clamped gap region painted in COLOR_VOID on top of the
    // ground rect. Covers the floor fill AND its top/bottom outline in the
    // gap region so the hole opens cleanly; the void's left/right edges are
    // hard color edges (platform → void → platform). Clamp mirrors gapSolids'
    // guard-4 clamp; config is fixed (gapWidth=64 < spanWidth=400) so the
    // normal case always holds and the pathological guards never trigger here.
    const gapHalf = gapState.width / 2;
    const minCenter = GAP_SPAN.x + gapHalf;
    const maxCenter = GAP_SPAN.x + GAP_SPAN.width - gapHalf;
    const voidCenter = Math.max(minCenter, Math.min(maxCenter, gapState.centerX));
    const voidX = voidCenter - gapHalf;
    ctx.fillStyle = COLOR_VOID;
    ctx.fillRect(voidX, GROUND_Y, gapState.width, GROUND_HEIGHT);

    // Dust particles — drawn before the player so the character reads on top
    // of the puff. Alpha-fade + size-shrink over life (same pattern as the
    // lava-pool section's fire-particle renderer).
    drawDust(ctx, dustParticles);

    // Player — recompute the volume-preserving scale from the single
    // `squashOffset` each frame, center the squash horizontally, and
    // bottom-align vertically so the feet stay planted on the ground (a squash
    // reads as "compress down," not "shrink and float").
    const scale = volumeScale(squashOffset);
    // Idle breathing — subtle ±5% vertical oscillation composed ON TOP of the
    // squash/stretch scale (multiply the two volume-preserving Scale2D pairs).
    // renderTick advances once per render frame (visual-only) so breathing
    // paces with the host refresh rate, independent of the fixed-step sim.
    const breath = breathe(renderTick, DEFAULT_BREATH);
    const dw = platformState.core.width * scale.scaleX * breath.scaleX;
    const dh = platformState.core.height * scale.scaleY * breath.scaleY;
    const dx = platformState.core.x + (platformState.core.width - dw) / 2;
    const dy = platformState.core.y + (platformState.core.height - dh);

    // Subtle additive glow under the character — demonstrates drawGlow.
    // Very low intensity so it reads as ambient warmth, not a light source.
    drawGlow(
      ctx,
      platformState.core.x + platformState.core.width / 2,
      platformState.core.y + platformState.core.height / 2,
      20,
      COLOR_PLAYER,
      0.15,
    );

    // Simple feet — two body-colored rects positioned by the locomotion phase.
    // Drawn BEFORE the body so the body covers their upper portion (only the
    // soles peek out at the bottom). Uses drawSimpleFeet from
    // animation/simple-feet.ts — the trigonometric alternative to full IK (no
    // joints, no solver, just cos/sin of the phase accumulator). Foot-lock is
    // emergent: stop moving → phase freezes → feet stay planted. The pose is
    // re-evaluated here from the current `loco` state (pure read) so the feet
    // track the exact phase even though the step function advanced it once per
    // fixed tick and render runs at host refresh rate.
    const locoPose = evaluateLocomotion(loco, PLAYGROUND_GAIT);
    // Blend foot offsets toward zero (neutral stance) when idle. At idleBlend=1,
    // both feet sit at x=0, y=0 → drawSimpleFeet places them at ±idleSpread
    // from the midline → a natural standing pose. Eases in over ~12 ticks when
    // grounded + not moving (set in the step function); snaps back to the live
    // walk-cycle pose in ~5 ticks when movement resumes.
    const blendedPose: LocomotionPose = {
      hipOffset: locoPose.hipOffset,
      leftFootOffset: {
        x: locoPose.leftFootOffset.x * (1 - idleBlend),
        y: locoPose.leftFootOffset.y * (1 - idleBlend),
      },
      rightFootOffset: {
        x: locoPose.rightFootOffset.x * (1 - idleBlend),
        y: locoPose.rightFootOffset.y * (1 - idleBlend),
      },
    };
    ctx.save();
    // Translate to body bottom-center (where the feet meet the ground). Uses
    // the UNSQUASHED bottom so feet stay glued to the floor during a landing
    // squash (the body compresses above them — reads as weight into the floor).
    ctx.translate(
      platformState.core.x + platformState.core.width / 2,
      platformState.core.y + platformState.core.height,
    );
    // Mirror for facing — the locomotion offsets are computed in local space
    // (the step function passed localDx = vx * facing), so the mirror here
    // correctly un-mirrors them back to world-space swing direction.
    ctx.scale(platformState.core.facing, 1);
    // baseY = -3 so the feet overlap the body's lower edge by ~3px — the body
    // draws on top (next call), covering the overlap so only the bottom ~2px
    // of each foot reads as a visible sole peeking out below the body.
    drawSimpleFeet(ctx, blendedPose, {
      ...DEFAULT_SIMPLE_FEET,
      baseY: -3,
      color: COLOR_PLAYER,
    });
    ctx.restore();

    outlineRect(ctx, dx, dy, dw, dh, COLOR_PLAYER);

    // --- Face features (cute cyclops eye + expressive mouth) ---
    // Drawn after the body rect, inside a body-local + facing-mirrored
    // transform so the eye/sparkle shift toward the gaze-leading side. All
    // timing here is render-tick driven (visual-only) — it never feeds back
    // into the fixed-step simulation, so Math.random for blink variation is
    // an acceptable decorative side-effect.
    //
    // Blink countdown: every ~2-4 sec collapse the eye to a thin line for
    // ~83ms (5 render ticks at 60fps).
    blinkCountdown -= 1;
    if (blinkCountdown <= 0) {
      blinkRemaining = 5;
      blinkCountdown = 120 + Math.floor(Math.random() * 120);
    }
    const blinking = blinkRemaining > 0;
    if (blinking) blinkRemaining -= 1;

    ctx.save();
    // Face origin: horizontal center of the body, ~35% down from the top
    // (upper third = face area). Uses the breathing-scaled dw/dh so the face
    // rides the breath with the body.
    ctx.translate(dx + dw / 2, dy + dh * 0.35);
    ctx.scale(platformState.core.facing, 1);

    ctx.fillStyle = COLOR_FACE;
    if (blinking) {
      // Closed eye — thin horizontal line.
      ctx.fillRect(-3, -1, 6, 1);
    } else {
      // Open eye — wide cute cyclops eye (6×5).
      ctx.fillRect(-3, -3, 6, 5);
      // White sparkle in the upper-right for a "cute" glint. Mirrored with the
      // facing scale above so it sits on the gaze-leading side.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(1, -2, 2, 2);
      ctx.fillStyle = COLOR_FACE;
    }

    // Mouth — reads grounded vs airborne.
    if (!platformState.core.onGround) {
      // Airborne "o" — small surprised mouth (3×2).
      ctx.fillRect(-1, 4, 3, 2);
    } else {
      // Grounded smile — a shallow upward arc via a quadratic curve (corners
      // high, middle dipping low → reads as a happy mouth). Control point
      // y=7 pulls the midpoint below the y=4 endpoints.
      ctx.strokeStyle = COLOR_FACE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-3, 4);
      ctx.quadraticCurveTo(0, 7, 3, 4);
      ctx.stroke();
    }

    ctx.restore();

    ctx.restore();

    // Screen-space UI — drawn without the camera transform so it stays
    // anchored to the viewport, not the world.
    drawHUD(ctx);

    // Advance the render-tick clock (drives idle breathing). Visual-only —
    // never read by the fixed-step simulation.
    renderTick += 1;
  };

  /** Draw the heads-up display — a small status line at the top-left. */
  const drawHUD = (ctx: CanvasRenderingContext2D): void => {
    ctx.font = '11px ui-monospace, "SF Mono", "Fira Code", monospace';
    ctx.fillStyle = '#7a6a5a';
    const frozen = isHitStopActive(hitStop) ? '  [FROZEN]' : '';
    ctx.fillText(
      `x:${Math.round(platformState.core.x)}  y:${Math.round(platformState.core.y)}  ${platformState.core.onGround ? 'grounded' : 'airborne'}${frozen}`,
      8,
      16,
    );
  };

  /**
   * Draw dust particles as alpha-faded filled circles. Reuses the lava-pool
   * section's particle-render pattern (`particleAlphaCurve` +
   * `particleSizeCurve`) so the dust reads consistently with the other
   * procedural-FX sections. Each particle fades 1.0 → 0 alpha and shrinks from
   * its spawn size down to a 1px minimum over its lifetime; `globalAlpha` is
   * reset after so subsequent draws aren't translucent.
   */
  const drawDust = (
    ctx: CanvasRenderingContext2D,
    particles: readonly Particle[],
  ): void => {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const alpha = particleAlphaCurve(p, 1.0, 0);
      const radius = particleSizeCurve(p, p.size, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color ?? COLOR_DUST_LANDING;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1, radius), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  /**
   * Spawn a tiny per-step dust puff at a given world-space x (the planted
   * foot's position). Used by the locomotion-phase foot-plant detector below —
   * each visible step lands → one puff. Reassigns `dustParticles` to a new
   * array (pure-progression-ops discipline; the input array is never mutated).
   *
   * Reads `platformState.core.y + height` for the player's bottom edge so the
   * puff spawns at the sole's contact point.
   */
  const spawnFootstepDust = (x: number): void => {
    const dust = spawn(x, platformState.core.y + platformState.core.height - 1, {
      count: 2,
      speed: 0.5,
      life: 12,
      size: 2.5,
      color: COLOR_DUST_FOOTSTEP,
    });
    dustParticles = [...dustParticles, ...dust];
  };

  /**
   * Reset the platformer state to spawn + clear all transient FX. Shared by
   * the R-key manual reset and the fall-off-world respawn (the moving-gap pit
   * death). Re-initializes the kernel state via `makeInitialPlatformerState`
   * (so ability slices and events are fresh) and re-initializes the gap motion
   * so the hazard re-starts cleanly from its initial sweep position (far end →
   * toward the player).
   */
  const resetPlayer = (): void => {
    platformState = makeInitialPlatformerState();
    squashOffset = 0;
    dustParticles = [];
    shakeMagnitude = 0;
    shakeTick = 0;
    // Reset locomotion + the foot-plant detector (engine primitive) so feet
    // re-plant cleanly at spawn (no stale mid-stride pose, no spurious
    // foot-plant firing).
    loco = { phase: 0 };
    plantState = createFootPlantState();
    idleBlend = 0;
    gapState = createGapMotion(GAP_MOTION);
  };

  // --- Fixed-step game loop (createGameLoop) --------------------------------
  //
  // This is the first showcase section to use the library's own createGameLoop
  // (the hero + lava-pool use hand-rolled rAF loops). The loop drives the
  // fixed-step sim at exactly 60 Hz regardless of the host's refresh rate;
  // visibilitychange is handled internally (pause-on-hidden, reset accumulator
  // on regain).

  const loop: GameLoop = createGameLoop({
    fixedDt: 1 / 60,
    step: () => {
      // 1. Poll input — drain edge latches once per fixed tick. Keyboard and
      //    touch are OR-merged per action so EITHER device drives the player:
      //    `held` is OR'd (either source holding = held); pressed/released
      //    edges are OR'd (either source producing the edge = it fires this
      //    tick). Touch edges come from the on-screen buttons — idle on
      //    desktop where the buttons are display:none. `reset` stays
      //    keyboard-only (no touch reset button by design). The `?? IDLE_EDGE`
      //    fallback guards against a missing slot (orEdges is not null-safe).
      const kb = keyboard.poll();
      const t = touch.poll(); // [leftEdge, rightEdge, jumpEdge] — positional
      const leftEdge = orEdges(kb['left'] ?? IDLE_EDGE, t[0] ?? IDLE_EDGE);
      const rightEdge = orEdges(kb['right'] ?? IDLE_EDGE, t[1] ?? IDLE_EDGE);
      const jumpEdge = orEdges(kb['jump'] ?? IDLE_EDGE, t[2] ?? IDLE_EDGE);

      // 2. Advance hit-stop timer regardless of the freeze so the freeze
      //    actually ends. When active, skip the rest of the step (the temporal-
      //    juice contract: sim freezes). FX also freeze with the sim here — the
      //    dust step + footstep-plant detection + locomotion phase advance
      //    below are all skipped, so the freeze reads as a clean hold on the
      //    squashed pose. Only the screen-shake offset (advanced in render,
      //    visual-only) continues through the freeze, which sells the impact.
      hitStop = stepHitStop(hitStop, 1);
      if (isHitStopActive(hitStop)) return;

      // 3. Reset (R-key) — instant teleport back to spawn. Edge-triggered
      //    (pressed, not held) so holding R doesn't keep re-teleporting.
      //    Keyboard-only (no touch reset button by design — touch UI stays
      //    minimal: move+jump). Done BEFORE the kernel step so the kernel
      //    processes the fresh spawn state this tick (the kernel applies
      //    gravity, then collision re-lands — net effect: no movement, since
      //    the player is at rest on the floor). Reset is exempt from the
      //    onscreen gate so it works even when the section is scrolled off.
      if (kb['reset']?.pressed) {
        resetPlayer();
      }

      // 4. Compose `PlatformerInput` from polled edges. moveX is derived
      //    from the left/right held state: -1 / 0 / +1, with both-held and
      //    neither-held mapping to 0 (matches the original "no input"
      //    semantics — the kernel's `applyHorizontalInput` zeroes vx when
      //    moveX=0 on the ground and leaves vx unchanged in the air). The
      //    kernel takes `PolledEdge` for jump directly; it reads `.held`
      //    for the variable-height cutoff (disabled here via
      //    jumpCutoffFactor=1) and `.pressed` for the launch trigger.
      //    Onscreen gate: only respond to input while this section is
      //    visible. Both the hero and this section listen on `window`, so
      //    without this gate pressing ←/→/A/D/Space drives both
      //    simultaneously. The keyboard adapter still polls + drains edges
      //    every step regardless, so no stale-edge accumulation. `reset`
      //    is exempt (works offscreen too — see step 3 above).
      const moveX: -1 | 0 | 1 = !onscreen
        ? 0
        : leftEdge.held === rightEdge.held
          ? 0
          : leftEdge.held
            ? -1
            : 1;
      const jumpInput: PolledEdge = onscreen ? jumpEdge : IDLE_EDGE;
      const input: PlatformerInput = { moveX, jump: jumpInput, dash: null };

      // 5. Capture pre-step vy for impact-velocity reconstruction. The
      //    kernel zeroes vy on landing inside its step 6 (collision
      //    resolution), so the impact velocity is gone by the time the new
      //    state is returned. The original code captured `vyBeforeResolve`
      //    (post-gravity, pre-resolve) and used it to scale squash /
      //    hit-stop / shake. We reconstruct the equivalent in per-tick
      //    units as `(preVy + IMPACT_GRAVITY_PER_TICK_PX_PER_SEC) / 60`,
      //    mirroring the original `vyBeforeResolve = preVy + GRAVITY`
      //    (per-tick). Verified by tick-trace: this gives the same impact
      //    velocity as the original for any given jump arc (510 px/s = 8.5
      //    px/tick for a full-jump landing).
      const preVy = platformState.core.vy;

      // 6. Advance the moving gap BEFORE composing the per-tick solids, so
      //    the gap is at its new position when the kernel's collision
      //    resolution runs (mirrors Spitekeep's update.ts: advance hazard
      //    → resolve player). Pure: returns a new GapMotionState; never
      //    mutates.
      gapState = advanceGapMotion(gapState, 1, GAP_MOTION);

      // 7. Compose per-tick solids: static geometry + the gap's fragments
      //    (rebuilt each tick from the advanced gapState — the span has NO
      //    static floor; the fragments are the sole floor inside it). The
      //    gap fragments are tagged with stable ids (`gap-0`, `gap-1`) via
      //    `tagGapSolids` so the kernel's riding-tracker can identify the
      //    surface the player is on across re-creation of the array (carry
      //    is wired via GAP_DISPLACEMENT_PROVIDER, currently a no-op).
      const tickSolids: Solid[] = [
        ...STATIC_PLATFORMS,
        ...tagGapSolids(
          gapSolids(GAP_SPAN, { centerX: gapState.centerX, width: gapState.width }),
        ),
      ];

      // 8. Step the platformer kernel — the single authoritative call that
      //    replaced ~250 lines of hand-rolled physics integration. The
      //    kernel runs the locked update order: carry → abilities (only
      //    jump is enabled in PLAYGROUND_PLATFORMER_CONFIG — wall-slide,
      //    dash, double-jump short-circuit to no-ops) → horizontal input →
      //    gravity → axis collision (resolveAxisX then resolveAxisY) →
      //    contacts & events. Pure: returns a brand-new PlatformerState;
      //    the input state is never mutated.
      const result = stepPlatformer(
        platformState,
        input,
        tickSolids,
        1 / 60,
        PLAYGROUND_PLATFORMER_CONFIG,
        GAP_DISPLACEMENT_PROVIDER,
      );
      platformState = result.state;

      // 9. Fall-off-world respawn — if the player fell through the moving
      //    gap (or off any edge), reset to spawn once they're below the
      //    world bottom + margin. This is the pit-death consequence of the
      //    moving-gap primitive: the floor is gone, so gravity pulls them
      //    into the void. Reset + return skips FX detection and the rest
      //    of this tick (the player is back at spawn; next tick starts
      //    fresh).
      if (platformState.core.y > WORLD_H + RESPAWN_FALL_MARGIN) {
        resetPlayer();
        return;
      }

      // 10. Drive effects from kernel events. The kernel emits single-tick
      //     boolean pulses for justLanded / justLaunched / hitCeiling /
      //     hitWall / startedWallSlide / wallJumpLaunched / dashStarted /
      //     doubleJumped; we read the two this playground cares about
      //     (justLaunched, justLanded) and trigger the existing FX
      //     (squash, dust, audio, hit-stop). The FX logic is preserved
      //     verbatim from the pre-kernel code — only the trigger source
      //     changed (was `yRes.landed && !player.onGround`, now
      //     `state.events.justLanded`).

      // Launch stretch + jump sound — on the single tick the jump ability
      // actually launched the actor. With `anticipationDuration: 0` in the
      // config this fires one tick AFTER the press (the kernel transitions
      // grounded → anticipating → rising across two ticks even with a
      // zero duration, because phase transitions happen on the next
      // tick's switch entry). Minor behavior change from the original
      // (which launched same-tick); the 17ms lag is imperceptible.
      if (platformState.events.justLaunched) {
        // Launch stretch (Celeste-style post-launch): the physics launch
        // is instant, the visual stretch sells the upward thrust. Positive
        // offset → scaleY > 1 (taller) + scaleX < 1 (thinner); resolves
        // via SQUASH_DECAY over ~15 ticks.
        squashOffset = LAUNCH_STRETCH;
        // Jump sound — quick upward sine sweep (200→400 Hz) reading as a
        // "boing". Defensive: no-op pre-unlock / in Node / when muted.
        audio.playTone('sine', 200, 400, 80, 0.2);
      }

      // Landing FX — squash + dust + shake + hit-stop, all gated by
      // impact velocity. Triggered by the kernel's justLanded pulse
      // (airborne → grounded transition), so walking along flat ground
      // doesn't continuously re-squash.
      if (platformState.events.justLanded) {
        // Reconstruct impact velocity in ORIGINAL per-tick units (px/tick)
        // so the existing FX thresholds (HIT_STOP_THRESHOLD_TICKS,
        // REFERENCE_VELOCITY_TICKS) compare apples-to-apples with the
        // tuned values from the pre-kernel code. px/s → px/tick = ÷60;
        // the `+ IMPACT_GRAVITY_PER_TICK_PX_PER_SEC` mirrors one tick of
        // original gravity, then ÷60 returns to per-tick.
        const impactPerTick =
          Math.max(0, preVy + IMPACT_GRAVITY_PER_TICK_PX_PER_SEC) / 60;

        if (impactPerTick > 2) {
          // Landing squash — normalize impact against
          // REFERENCE_VELOCITY_TICKS and cap at MAX_SQUASH. At impact=9:
          // deltaY=−0.3 → scaleY 0.7, scaleX 1.43. At impact=3:
          // deltaY=−0.1 → scaleY 0.9, scaleX 1.11. volumeScale keeps
          // scaleX × scaleY === 1 so it reads as weight.
          squashOffset = -MAX_SQUASH * Math.min(1, impactPerTick / REFERENCE_VELOCITY_TICKS);

          // Landing dust burst — count scales with impact, ejected
          // upward (angleOffset −π/2) and outward around the feet.
          const dustCount = Math.min(6, Math.floor(impactPerTick * 0.7));
          if (dustCount > 0) {
            const dust = spawn(
              platformState.core.x + platformState.core.width / 2,
              platformState.core.y + platformState.core.height - 2,
              {
                count: dustCount,
                speed: Math.max(1, impactPerTick * 0.25),
                life: 18,
                size: 3,
                color: COLOR_DUST_LANDING,
                angleOffset: -Math.PI / 2,
              },
            );
            dustParticles = [...dustParticles, ...dust];
          }
        }
        if (impactPerTick > HIT_STOP_THRESHOLD_TICKS) {
          // Hard landing — freeze the sim for a few ticks (temporal juice)
          // and kick a decaying screen shake. Shake magnitude scales with
          // impact, capped so the wobble stays readable.
          hitStop = triggerHitStop(hitStop, HIT_STOP_DURATION);
          shakeTick = 0;
          shakeMagnitude = Math.min(
            SHAKE_MAX_MAGNITUDE,
            impactPerTick * SHAKE_MAGNITUDE_PER_IMPACT,
          );
        }

        // Landing sound — proportional to impact. Hard landings (above
        // the hit-stop threshold) get a heavier low-mid thud; soft
        // landings get a lighter tap (same family as a footstep but
        // slightly louder). Below impact=2 nothing plays (sub-stepping
        // off a curb reads as silence).
        if (impactPerTick > HIT_STOP_THRESHOLD_TICKS) {
          audio.playNoise(80, 'lowpass', 300, 0.3);
        } else if (impactPerTick > 2) {
          audio.playNoise(50, 'lowpass', 250, 0.18);
        }
      }

      // 11. Idle feet blend — ease toward a neutral standing stance when
      //     grounded + still, snap back toward the live walk pose when
      //     moving. Keeps the feet from freezing mid-stride on stop (~12
      //     ticks to settle, ~5 to release). Reads core.vx in px/s and
      //     compares against FOOTSTEP_MIN_SPEED_TICKS * 60 (the original
      //     per-tick threshold scaled to px/s).
      if (
        platformState.core.onGround &&
        Math.abs(platformState.core.vx) < FOOTSTEP_MIN_SPEED_TICKS * 60
      ) {
        idleBlend = Math.min(1, idleBlend + 0.08);
      } else {
        idleBlend = Math.max(0, idleBlend - 0.2);
      }

      // 12. Step dust particles — advance + cull (pure: returns a new
      //     array). Runs on active ticks only (skipped during hit-stop
      //     freeze above) so dust freezes with the sim, matching the
      //     freeze-frame contract.
      dustParticles = stepParticles(dustParticles, 1, {
        gravity: DUST_GRAVITY,
        drag: DUST_DRAG,
      });

      // 13. Advance locomotion phase by actual horizontal displacement.
      //     Only when grounded — airborne characters don't walk (and
      //     leaving the phase static while airborne is what freezes the
      //     feet in a readable "tucked" pose rather than cycling mid-air).
      //     Pass LOCAL-space dx ((vx/60) * facing — px/s → px/tick, then
      //     facing-mirrored) because the body is drawn under
      //     ctx.scale(facing, 1); world-space dx would double-mirror the
      //     gait. evaluateLocomotion then derives hip/foot offsets as
      //     pure sin/cos of the phase.
      if (platformState.core.onGround) {
        const localDx = (platformState.core.vx / 60) * platformState.core.facing;
        loco = advanceLocomotionByDisplacement(loco, localDx, PLAYGROUND_GAIT);
      }
      const locoPose = evaluateLocomotion(loco, PLAYGROUND_GAIT);

      // 14. Per-step dust + audio — detect foot-plant transitions from
      //     the locomotion phase via the shared `advanceFootPlant` engine
      //     primitive. A foot "plants" when its lift height transitions
      //     from >0 (swinging airborne) to 0 (grounded). This syncs dust
      //     + sound to the ACTUAL walk cycle, not a fixed timer — each
      //     visible step gets a puff + a tap. Gated by
      //     FOOTSTEP_MIN_SPEED_TICKS so standing still (vx≈0, feet
      //     already planted) doesn't fire. The offset is applied to the
      //     world-space foot x (already un-mirrored via +facing/-facing).
      const footstepMinSpeedPxPerSec = FOOTSTEP_MIN_SPEED_TICKS * 60;
      const plant = advanceFootPlant(
        plantState,
        locoPose.leftFootOffset.y,
        locoPose.rightFootOffset.y,
      );
      plantState = plant.state;
      if (
        plant.events.leftPlanted &&
        Math.abs(platformState.core.vx) > footstepMinSpeedPxPerSec
      ) {
        spawnFootstepDust(
          platformState.core.x +
            platformState.core.width / 2 -
            platformState.core.facing * 5,
        );
        audio.playNoise(FOOTSTEP_SOUND_DUR, 'lowpass', FOOTSTEP_SOUND_FREQ, FOOTSTEP_SOUND_PEAK);
      }
      if (
        plant.events.rightPlanted &&
        Math.abs(platformState.core.vx) > footstepMinSpeedPxPerSec
      ) {
        spawnFootstepDust(
          platformState.core.x +
            platformState.core.width / 2 +
            platformState.core.facing * 5,
        );
        audio.playNoise(FOOTSTEP_SOUND_DUR, 'lowpass', FOOTSTEP_SOUND_FREQ, FOOTSTEP_SOUND_PEAK);
      }

      // 15. Decay squash back to neutral — exponential on the single
      //     offset so the volume invariant (scaleX × scaleY === 1) holds
      //     throughout recovery. Independent-axis lerps (the pre-fix
      //     approach) break it.
      squashOffset *= SQUASH_DECAY;

      // 16. Camera — lerp + clamp toward the player, with the target
      //     offset slightly in the facing direction (lookahead) so the
      //     player sees more of the level ahead. updateCamera returns a
      //     fresh Camera (pure-progression-ops discipline; never mutates).
      camera = updateCamera(
        camera,
        {
          x: platformState.core.x + platformState.core.facing * CAMERA_LOOKAHEAD,
          y: platformState.core.y,
          width: platformState.core.width,
          height: platformState.core.height,
        },
        { width: WORLD_W, height: WORLD_H },
        { width: VIEW_W / CANVAS_ZOOM, height: VIEW_H / CANVAS_ZOOM },
      );
    },
    render: () => {
      render();
    },
  });

  // --- Initial paint (also serves as the static reduced-motion frame) ------

  render();

  // --- Page-scroll guard ---------------------------------------------------
  //
  // ArrowLeft / ArrowRight / Space scroll the page by default and would
  // interrupt the player. We suppress them ONLY while the playground section
  // is onscreen, so scrolling past it works normally.
  //
  // An IntersectionObserver tracks onscreen-ness; the keydown handler reads
  // a local boolean so the per-keystroke check is O(1) (no getBoundingClientRect
  // in the hot path).
  let onscreen = false;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        onscreen = entry.isIntersecting;
      }
    },
    { threshold: 0.01 },
  );
  observer.observe(container);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!onscreen) return;
    if (SUPPRESSED_CODES.has(e.code)) e.preventDefault();
  };
  // Capture-phase listener: preventDefault before the browser acts on the
  // scroll gesture.
  window.addEventListener('keydown', onKeyDown, { capture: true });

  // --- Teardown -----------------------------------------------------------
  //
  // Defensive cleanup for future single-page-app use (the showcase is
  // currently single-mount so main.ts never calls this). Tears down BOTH
  // input adapters — keyboard AND touch — so neither leaks window/document/
  // element listeners, plus the IntersectionObserver and the two window
  // keydown/pointerdown aux listeners (scroll-guard + audio-unlock). The
  // game loop owns its own visibilitychange teardown internally. All
  // underlying `dispose()` / `disconnect()` / `removeEventListener` calls
  // are idempotent, so calling this multiple times is safe.
  const dispose = (): void => {
    keyboard.dispose();
    touch.dispose();
    observer.disconnect();
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('pointerdown', unlockAudio);
  };

  // --- Motion gate ---------------------------------------------------------

  // Reduced-motion branch: the render() above is the single static frame
  // (character at spawn, camera at origin). Do NOT start the loop. The
  // dispose callback is still returned so listeners attached above (input
  // adapters, observer, scroll-guard) can be cleaned up.
  if (shouldAnimate()) {
    return dispose;
  }

  loop.start();

  // The loop's own visibilitychange handler pauses-on-hidden; we don't need
  // a second one here (unlike the hand-rolled hero / lava-pool loops).

  return dispose;
}

// ---------------------------------------------------------------------------
// Section-local helpers (not part of the library)
// ---------------------------------------------------------------------------
//
// (All section-local helpers are inlined into initPlayground above for
// locality with the canvas/context they close over. No module-scope helpers
// needed.)
