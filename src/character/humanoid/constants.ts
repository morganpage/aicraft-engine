import type { BreathConfig } from '../../animation/squash-stretch';
import type { GaitConfig } from '../../animation/locomotion';
import type { HumanoidConfig } from './types';

/** Reference collision width used to scale the procedural drawing. */
export const HUMANOID_BASE_WIDTH = 16;
/** Reference collision height used to scale the procedural drawing. */
export const HUMANOID_BASE_HEIGHT = 24;

/** Default displacement-driven humanoid gait. */
export const HUMANOID_GAIT: Readonly<GaitConfig> = {
  baseFrequency: 0.05,
  strideLength: 3.4,
  strideHeight: 2.8,
  hipBobHeight: 0.8,
  hipSwayWidth: 0.55,
};

/** Default subtle idle breathing. */
export const HUMANOID_BREATH: Readonly<BreathConfig> = {
  frequency: 0.018,
  amplitude: 0.025,
};

export const HUMANOID_POSE_DECAY_PER_SECOND = 7;
export const HUMANOID_OUTLINE_WIDTH = 0.6;
export const HUMANOID_TARGET_ARM_BLEND = 0.72;

// ---------------------------------------------------------------------------
// Render-fidelity constants (Phase H2.5).
//
// Consumed only by `draw.ts`. All sizes are in canonical right-facing local
// pixels (the same space `composePose` emits), BEFORE the body-frame scale
// `ctx.scale(facing * scale, scale)` is applied — so they scale with the
// character and degrade gracefully at the 16×24 and 8×12 sheet scales.
// ---------------------------------------------------------------------------

// --- Whole-limb silhouette half-widths ------------------------------------
// Each limb is traced as ONE continuous tapered outline (root → joint → end,
// plus a short hand or foot termination) so no internal stroke ever crosses a
// joint, wrist, or ankle. Upper segments read wider than lower; the joint width
// drives a mitered bend that stays clean (the near-straight idle knees/elbows
// fall back to a bevel, so the taper reads as a smooth continuous limb).

/** Half-width of the thigh at the hip (widest leg segment). */
export const HUMANOID_THIGH_HALF_WIDTH = 1.3;
/** Half-width at the knee (mitered bend between thigh and shin). */
export const HUMANOID_KNEE_HALF_WIDTH = 0.9;
/** Half-width of the shin at the ankle (lower-leg end + foot root). */
export const HUMANOID_SHIN_HALF_WIDTH = 0.68;
/** Half-width of the upper arm at the shoulder. */
export const HUMANOID_UPPER_ARM_HALF_WIDTH = 1.05;
/** Half-width at the elbow (mitered bend between upper arm and forearm). */
export const HUMANOID_ELBOW_HALF_WIDTH = 0.78;
/** Half-width of the rounded hand/fist that terminates the forearm. */
export const HUMANOID_HAND_HALF_WIDTH = 0.92;
/** Half-width of the toe that terminates the foot (forward of the ankle). */
export const HUMANOID_TOE_HALF_WIDTH = 0.58;

// --- Depth reinforcement (near = foreground, far = recedes) ---------------
// Near limbs are drawn thicker + brighter (lit, forward); far limbs thinner +
// slightly darker (shadowed, recessed). The far treatment is deliberately
// gentle so a far limb still reads as a solid limb receding behind the torso,
// not a wireframe stick that vanishes against the near limbs.

/** Near limbs are drawn this much thicker than nominal (foreground read). */
export const HUMANOID_NEAR_WIDTH_GAIN = 1.12;
/** Far limbs are drawn this much thinner than nominal (gentle recession). */
export const HUMANOID_FAR_WIDTH_GAIN = 0.93;
/** Near-limb fill channels are multiplied by this factor (brighter / lit). */
export const HUMANOID_NEAR_SHADE = 1.08;
/** Far-limb fill channels are multiplied by this factor (slightly shadowed). */
export const HUMANOID_FAR_SHADE = 0.9;

// --- Foot termination -----------------------------------------------------
// The foot is the final forward (+x) segment of the leg outline, extending past
// the ankle toward the travel side. Sharing the shin's outline (instead of an
// overlaid ellipse) removes the ankle seam.

/** Forward length of the foot segment past the ankle (toward +x travel). */
export const HUMANOID_FOOT_TOE_OUTSET = 1.15;

// --- Head treatments ------------------------------------------------------

/** Stroked-arc band thickness of the `cap` head style (follows the head curve). */
export const HUMANOID_CAP_THICKNESS = 1.5;
/** Radians the cap arc dips past the top hemisphere on each side. */
export const HUMANOID_CAP_OVERHANG = 0.35;
/** Half-width of the `crest` base at the crown. */
export const HUMANOID_CREST_BASE_HALF = 1.1;
/** Height of the `crest` tuft above the crown. */
export const HUMANOID_CREST_HEIGHT = 2.0;

// --- Face -----------------------------------------------------------------
// The face is a clipped shaded "muzzle/cheek" plane on the +x travel side of
// the head (a filled region, never a thin stroke) with the eye set into it.
// Clipping to the head circle keeps every mark inside the silhouette, so at
// 16×24 / 8×12 the face degrades to a soft shaded plane + eye dot instead of
// spiky vector lines.

/** Eye dot radius. */
export const HUMANOID_EYE_RADIUS = 0.95;
/** Cheek-plane centre as a fraction from the head centre toward the eye. */
export const HUMANOID_FACE_CHEEK_CENTER = 0.6;
/** Cheek-plane horizontal radius (clipped to the head circle at draw time). */
export const HUMANOID_FACE_CHEEK_RX = 2.0;
/** Cheek-plane vertical radius (clipped to the head circle at draw time). */
export const HUMANOID_FACE_CHEEK_RY = 1.8;
/** Cheek-plane vertical offset below the eye (toward the snout). */
export const HUMANOID_FACE_CHEEK_DY = 0.2;
/** Blend fraction from skin (accent) toward outline for the muzzle tone. */
export const HUMANOID_FACE_MUZZLE_MIX = 0.38;
/** Small lateral separation keeps relaxed hands clear of the torso. */
export const HUMANOID_IDLE_HAND_OUTSET = 0.55;
/** Fraction of total arm length used by a relaxed, slightly bent arm.
 *  Shoulder-to-hand distance reaches this fraction of the full arm length,
 *  so the elbow carries a shallow bend rather than a chicken-wing fold
 *  (research §Normalized neutral-pose rules: arm reach `> 0.9 *` total). */
export const HUMANOID_IDLE_ARM_EXTENSION = 0.94;
/** Rate at which the neutral stance blends in/out. */
export const HUMANOID_IDLE_BLEND_PER_SECOND = 10;

// ---------------------------------------------------------------------------
// Internal pose-evaluator constants (Phase H1.5 / H2).
//
// These are NOT re-exported from `src/character/humanoid/index.ts` (the public
// barrel). They are consumed only by `pose.ts` and `draw.ts`. Values are cited
// to the Godot MIT robot measured baseline
// (`docs/research/humanoid-platformer-visual-reference.md`). Entries marked
// `inferred` have no direct Godot frame and are derived from the measured
// ranges plus the Tyson Tan three-quarter analysis.
// ---------------------------------------------------------------------------

/** 2π for phase wrapping — avoids repeated `Math.PI * 2` in hot paths. */
export const TWO_PI = Math.PI * 2;

/**
 * `idleBlend` threshold above which the gait phase is reported as `'idle'`.
 *
 * At `idleBlend ≈ 1` the gait contribution is negligible. The `0.999`
 * boundary prevents floating-point flicker between `'idle'` and a named gait
 * phase during full idle. See decision OQ4.
 */
export const HUMANOID_IDLE_PHASE_THRESHOLD = 0.999;

/**
 * End of the contact phase in radians (`0.3π`).
 *
 * Godot frame 0 = contact (research §Phase-to-phase range table). Contact
 * occupies the first slice of the `2π` stride; the boundary at `0.3π` adds a
 * transition buffer for visual clarity.
 */
export const HUMANOID_CONTACT_PHASE_END = Math.PI * 0.3;

/**
 * End of the recoil phase in radians (`0.8π`). Godot frame 1 = recoil.
 */
export const HUMANOID_RECOIL_PHASE_END = Math.PI * 0.8;

/**
 * End of the passing phase in radians (`1.3π`). Godot frame 2 = passing
 * (swing foot passes under the body).
 */
export const HUMANOID_PASSING_PHASE_END = Math.PI * 1.3;

/**
 * End of the high-point phase in radians (`1.7π`). Godot frame 3 = high
 * point (body rises before opposite contact).
 */
export const HUMANOID_HIGH_POINT_PHASE_END = Math.PI * 1.7;

// --- Neutral idle geometry (Godot frame 30 normalized targets) -------------

/**
 * Idle leg extension: hip-to-foot distance as a fraction of
 * `thighLength + shinLength`. Keeps idle knees "nearly extended but not
 * locked" and satisfies the research rule "legs use at least 90% of available
 * extension" (inferred — Godot robot leg landmarks were not separately
 * measurable; derived from the pelvis-height measurement).
 */
export const HUMANOID_IDLE_LEG_EXTENSION = 0.965;

/**
 * Idle foot separation as a fraction of body height `H`. Godot frame 30
 * measured feet at `±0.105H` → separation `0.210H`. Both feet remain planted
 * inside the research's `0.10H–0.22H` stable-base range.
 */
export const HUMANOID_IDLE_FOOT_SEPARATION_H = 0.21;

/**
 * Pelvis (and hip-row) forward lean toward the travel side as a fraction of
 * `H`. Godot frame 30 pelvis centre measured at `+0.009H`. The slight forward
 * offset contributes to the cheated three-quarter read without crossing the
 * support base.
 */
export const HUMANOID_IDLE_PELVIS_X_H = 0.009;

/**
 * Near-shoulder position as a fraction of `config.shoulderWidth` from the
 * centreline. Godot frame 30: near shoulder `+0.228H`, far shoulder
 * `-0.263H` — the near shoulder sits closer to the centreline (more exposed
 * front) while the far shoulder is wider (partly occluded back). The pair
 * `0.45 / 0.55` reproduces that asymmetry inside the configured total span.
 */
export const HUMANOID_NEAR_SHOULDER_FRACTION = 0.45;

/**
 * Eye (face-direction marker) displacement toward the travel side as a
 * fraction of `H`. Godot frame 30 measured the face-direction pixel at
 * `+0.053H`. The renderer adds `config.eyeOffsetX` on top for seed variation.
 */
export const HUMANOID_IDLE_EYE_X_H = 0.053;

/**
 * Horizontal hip span as a fraction of the idle foot separation. Hips are
 * narrower than the feet (human stance), keeping each knee over its foot.
 * Inferred (Godot hip landmarks were `null`).
 */
export const HUMANOID_IDLE_HIP_SPAN_FACTOR = 0.75;

/** Shoulder row vertical drop below the torso top (local pixels). Inferred. */
export const HUMANOID_SHOULDER_DROP = 2.2;

/**
 * Head/torso vertical overlap so the head nestles onto the shoulder row.
 *
 * The torso polygon's top edge sits at the shoulder row (`torsoTopY +
 * HUMANOID_SHOULDER_DROP`); this offset drops the head centre so its lower
 * arc overlaps the shoulders by ~0.4px (matching the original nestle) instead
 * of floating above them. Inferred.
 */
export const HUMANOID_HEAD_TORSO_OVERLAP = 2.6;

/**
 * Far-side depth offsets (local pixels). The far shoulder and far hip sit
 * fractionally lower than the near-side roots, breaking perfect near/far
 * pairing and signalling recession (Tyson Tan: "lower the farther eye").
 * Sub-pixel at small render scales; tuned to stay inside the leg-extension
 * slack so far-leg IK never locks. Inferred.
 */
export const HUMANOID_FAR_SHOULDER_DROP = 0.4;
export const HUMANOID_FAR_HIP_DROP = 0.3;

/**
 * Tolerance for limb-length preservation through the analytical IK solver,
 * in local pixels. Mirrors `IK_POSITION_TOLERANCE_SQ`'s `0.01` linear
 * tolerance (sqrt of `0.0001`). Every solved chain segment matches its
 * configured bone length within this epsilon.
 */
export const HUMANOID_LIMB_LENGTH_TOLERANCE = 0.01;

/** Default deterministic humanoid configuration. */
export const DEFAULT_HUMANOID_SEED = 0x48554d41;

/** Type-check seam populated by `config.ts` without mutable module state. */
export type DefaultHumanoidConfig = Readonly<HumanoidConfig>;
