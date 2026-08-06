import { solveLimb } from '../../animation/ik/limb';
import type { Vec2 } from '../../animation/types';
import {
  HUMANOID_CONTACT_PHASE_END,
  HUMANOID_FAR_HIP_DROP,
  HUMANOID_FAR_SHOULDER_DROP,
  HUMANOID_HEAD_TORSO_OVERLAP,
  HUMANOID_HIGH_POINT_PHASE_END,
  HUMANOID_IDLE_ARM_EXTENSION,
  HUMANOID_IDLE_EYE_X_H,
  HUMANOID_IDLE_FOOT_SEPARATION_H,
  HUMANOID_IDLE_HIP_SPAN_FACTOR,
  HUMANOID_IDLE_LEG_EXTENSION,
  HUMANOID_IDLE_PELVIS_X_H,
  HUMANOID_IDLE_HAND_OUTSET,
  HUMANOID_NEAR_SHOULDER_FRACTION,
  HUMANOID_PASSING_PHASE_END,
  HUMANOID_RECOIL_PHASE_END,
  HUMANOID_SHOULDER_DROP,
  HUMANOID_TARGET_ARM_BLEND,
  HUMANOID_IDLE_PHASE_THRESHOLD,
  TWO_PI,
} from './constants';
import type { HumanoidAirPose, HumanoidConfig, HumanoidVisualState } from './types';

/**
 * Named gait phase derived from the continuous locomotion phase.
 *
 * Mapping uses the Godot robot's measured frame-to-phase alignment (research
 * §Phase-to-phase range table). `'idle'` is reported when `idleBlend` exceeds
 * {@link HUMANOID_IDLE_PHASE_THRESHOLD}; otherwise one of the five named
 * stride phases is derived from `locomotion.phase`.
 */
export type GaitPhase =
  | 'idle'
  | 'contact'
  | 'recoil'
  | 'passing'
  | 'highPoint'
  | 'oppositeContact';

/**
 * Per-tick blend-contribution weights. Diagnostic reflection of
 * `HumanoidVisualState`; the geometry blend that consumes them is wired in
 * Phases H3 (gait) and H4 (airborne / landing / ceiling). For H2 every
 * non-idle contribution reports its state honestly while the emitted geometry
 * stays idle-equivalent.
 *
 * `idle` + `gait` cover the grounded stance; `airborne`, `landing`, and
 * `ceiling` are orthogonal state pulses. They need not sum to exactly `1`.
 */
export interface BlendWeights {
  /** Neutral idle contribution `[0, 1]`. Equals `state.idleBlend`. */
  readonly idle: number;
  /** Displacement-driven gait contribution `[0, 1]`. Non-zero only grounded. */
  readonly gait: number;
  /** Airborne tuck contribution `[0, 1]`. Non-zero only when not grounded. */
  readonly airborne: number;
  /** Landing compression contribution `[0, 1]`. Equals `state.landingBlend`. */
  readonly landing: number;
  /** Ceiling-mirror contribution `[0, 1]`. Equals `state.ceilingBlend`. */
  readonly ceiling: number;
}

/**
 * A fully solved two-bone limb chain in canonical right-facing local space.
 *
 * `root` is the hip or shoulder, `joint` is the knee or elbow, and `end` is
 * the ankle or hand. Every segment preserves its configured bone length
 * within {@link HUMANOID_LIMB_LENGTH_TOLERANCE}.
 */
export interface LimbChain {
  readonly root: Readonly<Vec2>;
  readonly joint: Readonly<Vec2>;
  readonly end: Readonly<Vec2>;
}

/**
 * Head pose with silhouette anchor and facial-feature position. The renderer
 * reads `config.headRadius` for the circle radius (not duplicated here).
 */
export interface HeadPose {
  /** Centre of the head circle. */
  readonly centre: Readonly<Vec2>;
  /** Crown (top of head), carrying a slight forward lean toward travel. */
  readonly crown: Readonly<Vec2>;
  /** Face-direction marker, displaced toward the travel side. */
  readonly eye: Readonly<Vec2>;
}

/**
 * Torso volume as an irregular quadrilateral that reads as a turned mass.
 *
 * The four corners are NOT a symmetric rectangle: the near/far shoulders are
 * asymmetric (the near shoulder sits closer to the centreline, the far
 * shoulder wider and slightly lower), and the chest tapers to a narrower hip
 * row. Naming follows the canonical near/far convention used throughout:
 * near = more exposed side (higher `x` in the right-facing frame),
 * far = more occluded side (lower `x`).
 */
export interface TorsoPose {
  /** Midpoint between the two shoulders. */
  readonly topCentre: Readonly<Vec2>;
  /** Pelvis centre (midpoint between the two hips). */
  readonly bottomCentre: Readonly<Vec2>;
  /** Near (travel-side) top corner — near shoulder position. */
  readonly topNear: Readonly<Vec2>;
  /** Far top corner — far shoulder position. */
  readonly topFar: Readonly<Vec2>;
  /** Near bottom corner — near hip position. */
  readonly bottomNear: Readonly<Vec2>;
  /** Far bottom corner — far hip position. */
  readonly bottomFar: Readonly<Vec2>;
  /** `config.torsoWidth`, for renderer mass/rounding. */
  readonly width: number;
}

/**
 * Canonical right-facing pose composition, structured by the depth order the
 * renderer draws in: `farLeg → farArm → torso → nearLeg → nearArm → head`.
 *
 * Every field is finite and non-null for well-formed inputs. The procedural
 * solver always computes every joint, so the output type uses non-nullable
 * `Readonly<Vec2>` (nullability is confined to the research measurement
 * representation only).
 */
export interface PoseComposition {
  /** Named gait phase derived from `state.locomotion.phase`. */
  readonly gaitPhase: GaitPhase;
  /** Mirrored airborne presentation pose from `state`. */
  readonly airPose: HumanoidAirPose;
  /** Diagnostic blend weights reflecting `state`. */
  readonly blendWeights: BlendWeights;

  /** Far leg (drawn first, recedes behind the torso). */
  readonly farLeg: LimbChain;
  /** Far arm (drawn before the torso, partly occluded). */
  readonly farArm: LimbChain;
  /** Torso and pelvis mass. */
  readonly torso: TorsoPose;
  /** Near leg (drawn after the torso, stronger read). */
  readonly nearLeg: LimbChain;
  /** Near arm (drawn after the near leg, most exposed). */
  readonly nearArm: LimbChain;
  /** Head and face (drawn last, before foreground accents). */
  readonly head: HeadPose;
}

/** Coerce a numeric input to a finite value, falling back when non-finite. */
function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Blend an idle hand position toward a local arm target. Non-finite or
 * omitted targets are ignored (the idle hand is returned unchanged), so an
 * unreachable or malformed target never produces non-finite geometry.
 */
function blendTargetHand(
  idle: Readonly<Vec2>,
  target: Readonly<Vec2> | undefined,
  blend: number,
): { x: number; y: number } {
  if (
    target === undefined
    || !Number.isFinite(target.x)
    || !Number.isFinite(target.y)
  ) {
    return { x: idle.x, y: idle.y };
  }
  return {
    x: idle.x + (target.x - idle.x) * blend,
    y: idle.y + (target.y - idle.y) * blend,
  };
}

/** Clamp a finite value to `[min, max]`; non-finite inputs return `fallback`. */
function clampFinite(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return value < min ? min : value > max ? max : value;
}

/**
 * Derive the named gait phase from the continuous locomotion phase.
 *
 * Returns `'idle'` when `idleBlend` exceeds
 * {@link HUMANOID_IDLE_PHASE_THRESHOLD} (decision OQ4). Otherwise the wrapped
 * `[0, 2π)` phase is mapped to a named stride phase via the four phase-end
 * constants calibrated against the Godot run cycle.
 */
export function deriveGaitPhase(
  phase: number,
  idleBlend: number,
): GaitPhase {
  const idle = clampFinite(idleBlend, 0, 1, 1);
  if (idle > HUMANOID_IDLE_PHASE_THRESHOLD) return 'idle';
  const p = finite(phase, 0);
  const wrapped = (((p % TWO_PI) + TWO_PI) % TWO_PI) as number;
  if (wrapped < HUMANOID_CONTACT_PHASE_END) return 'contact';
  if (wrapped < HUMANOID_RECOIL_PHASE_END) return 'recoil';
  if (wrapped < HUMANOID_PASSING_PHASE_END) return 'passing';
  if (wrapped < HUMANOID_HIGH_POINT_PHASE_END) return 'highPoint';
  return 'oppositeContact';
}

/** Solve a two-bone chain, never throwing and always returning finite output. */
function solveChain(
  root: Readonly<Vec2>,
  target: Readonly<Vec2>,
  lengthA: number,
  lengthB: number,
  bendDir: number,
): LimbChain {
  const safeA = lengthA > 0 && Number.isFinite(lengthA) ? lengthA : 1;
  const safeB = lengthB > 0 && Number.isFinite(lengthB) ? lengthB : 1;
  const result = solveLimb(root, target, safeA, safeB, { bendDir });
  const joint = {
    x: finite(result.jointPos.x, root.x),
    y: finite(result.jointPos.y, root.y),
  };
  const end = {
    x: finite(result.endPos.x, root.x),
    y: finite(result.endPos.y, root.y),
  };
  return {
    root: { x: root.x, y: root.y },
    joint,
    end,
  };
}

/**
 * Compose a complete canonical right-facing humanoid pose.
 *
 * Pure: the same `(state, config, localArmTarget)` always produces a
 * byte-identical {@link PoseComposition}. Never throws; every output
 * coordinate is finite for any input (non-finite motion samples, unreachable
 * arm targets, and malformed phases are sanitized at the boundary).
 *
 * Blend order (fixed, documented): **idle → gait → airborne → targeted arm →
 * landing → ceiling.** In Phase H2 only the **idle** and **targeted-arm**
 * contributions produce geometry; the gait (H3), airborne, landing, and
 * ceiling (H4) contributions are wired into the order but return
 * idle-equivalent geometry, marked with `// H3` / `// H4` TODOs. A walking or
 * airborne character therefore renders as a standing idle until those phases
 * land — expected on this branch.
 *
 * Layer separation (decision OQ1–OQ4):
 * - Output is non-nullable for every landmark.
 * - No `tick` parameter; breathing is a render-time scale applied in `draw.ts`.
 * - `localArmTarget` is pre-converted to canonical right-facing local space by
 *   the caller (`draw.ts`); this function never imports world-space types.
 * - `gaitPhase` is always derived from `state.locomotion.phase`.
 *
 * Mirroring: near/far depth roles are semantic and never flip. Only the final
 * screen transform mirrors (handled in `draw.ts`), so the canonical pose is
 * independent of `state.facing`.
 *
 * @param state - humanoid visual state (locomotion, blends, air pose)
 * @param config - immutable humanoid proportions and styling
 * @param localArmTarget - optional near-arm target in canonical right-facing
 *   local space (origin at body root). Unreachable targets clamp to full
 *   extension via the IK solver; non-finite targets are ignored.
 * @returns the resolved pose composition
 *
 * @example
 * ```ts
 * const pose = composePose(state, config);
 * // Near shin length is preserved within the solver tolerance:
 * const shinLen = Math.hypot(
 *   pose.nearLeg.joint.x - pose.nearLeg.end.x,
 *   pose.nearLeg.joint.y - pose.nearLeg.end.y,
 * );
 * ```
 */
export function composePose(
  state: HumanoidVisualState,
  config: HumanoidConfig,
  localArmTarget?: Readonly<Vec2>,
): PoseComposition {
  const phase = finite(state?.locomotion?.phase, 0);
  const idleBlend = clampFinite(state?.idleBlend, 0, 1, 1);
  const landingBlend = clampFinite(state?.landingBlend, 0, 1, 0);
  const ceilingBlend = clampFinite(state?.ceilingBlend, 0, 1, 0);
  const airPose: HumanoidAirPose = state?.airPose ?? 'grounded';
  const gaitPhase = deriveGaitPhase(phase, idleBlend);

  const thigh = config.thighLength > 0 && Number.isFinite(config.thighLength)
    ? config.thighLength
    : 1;
  const shin = config.shinLength > 0 && Number.isFinite(config.shinLength)
    ? config.shinLength
    : 1;
  const upperArm = config.upperArmLength > 0
    && Number.isFinite(config.upperArmLength)
    ? config.upperArmLength
    : 1;
  const lowerArm = config.lowerArmLength > 0
    && Number.isFinite(config.lowerArmLength)
    ? config.lowerArmLength
    : 1;
  const torsoHeight = Number.isFinite(config.torsoHeight)
    ? Math.max(0, config.torsoHeight)
    : 0;
  const headRadius = Number.isFinite(config.headRadius)
    ? Math.max(0, config.headRadius)
    : 0;
  const shoulderWidth = Number.isFinite(config.shoulderWidth)
    ? Math.max(0, config.shoulderWidth)
    : 0;
  const eyeOffsetX = Number.isFinite(config.eyeOffsetX) ? config.eyeOffsetX : 0;

  // --- Vertical stack (length-preserving; drives body height H) -----------
  const legLength = thigh + shin;
  const hipY = -legLength * HUMANOID_IDLE_LEG_EXTENSION;
  const torsoTopY = hipY - torsoHeight;
  const shoulderY = torsoTopY + HUMANOID_SHOULDER_DROP;
  const headCentreY = torsoTopY - headRadius + HUMANOID_HEAD_TORSO_OVERLAP;
  const crownY = headCentreY - headRadius;
  const bodyHeight = Math.max(1, -crownY);

  // --- Horizontal Godot-normalized offsets, scaled to the actual body height
  const footHalfSeparation =
    (HUMANOID_IDLE_FOOT_SEPARATION_H * bodyHeight) / 2;
  const pelvisX = HUMANOID_IDLE_PELVIS_X_H * bodyHeight;
  const hipHalf = footHalfSeparation * HUMANOID_IDLE_HIP_SPAN_FACTOR;
  const nearShoulderX = shoulderWidth * HUMANOID_NEAR_SHOULDER_FRACTION;
  const farShoulderX = -shoulderWidth * (1 - HUMANOID_NEAR_SHOULDER_FRACTION);
  const eyeX = HUMANOID_IDLE_EYE_X_H * bodyHeight + eyeOffsetX;

  // --- Step 1: neutral idle geometry ------------------------------------
  const farHipY = hipY + HUMANOID_FAR_HIP_DROP;
  const farShoulderY = shoulderY + HUMANOID_FAR_SHOULDER_DROP;

  const nearFoot = { x: pelvisX + footHalfSeparation, y: 0 };
  const farFoot = { x: pelvisX - footHalfSeparation, y: 0 };
  const nearHip = { x: pelvisX + hipHalf, y: hipY };
  const farHip = { x: pelvisX - hipHalf, y: farHipY };
  const nearShoulder = { x: nearShoulderX, y: shoulderY };
  const farShoulder = { x: farShoulderX, y: farShoulderY };

  const handDrop = (upperArm + lowerArm) * HUMANOID_IDLE_ARM_EXTENSION;
  const nearHandIdle = {
    x: nearShoulderX + HUMANOID_IDLE_HAND_OUTSET,
    y: shoulderY + handDrop,
  };
  const farHand = {
    x: farShoulderX - HUMANOID_IDLE_HAND_OUTSET,
    y: farShoulderY + handDrop,
  };

  // --- Step 2: gait displacement (H3 — idle-equivalent for now) ----------
  // TODO(H3): overlay evaluateLocomotion(state.locomotion, config.gait) on
  // hips/feet and counter-swing the arms, weighted by (1 - idleBlend). Until
  // then the feet/hips/arms stay at their idle positions.

  // --- Step 3: airborne tuck (H4 — idle-equivalent for now) --------------
  // TODO(H4): when airPose !== 'grounded', blend legs toward the tuck target
  // and gather/spread the arms by ascent/apex/descent. Idle geometry below.

  // --- Step 4: targeted near arm ----------------------------------------
  // Only the near arm reaches toward a target; the far arm retains its idle
  // role. The blend is applied to the hand position, then the IK solver
  // places the elbow and clamps an unreachable target to full extension.
  const nearHand = blendTargetHand(
    nearHandIdle,
    localArmTarget,
    HUMANOID_TARGET_ARM_BLEND,
  );

  // --- Step 5: landing compression (H4 — idle-equivalent for now) --------
  // TODO(H4): when landingBlend > 0, lower the pelvis and bend both knees.
  // Idle geometry below. (landingBlend is reported in blendWeights.)

  // --- Step 6: ceiling mirror (H4 — idle-equivalent for now) -------------
  // TODO(H4): when ceilingBlend > 0, invert the airborne/landing vertical
  // displacement. Idle geometry below. (ceilingBlend is reported in blendWeights.)

  // --- IK solves (length-preserving, finite) ----------------------------
  // Bend directions keep each knee on its own anatomical side and each elbow
  // outside the torso: near-side joints offset toward +x, far-side toward -x.
  const nearLeg = solveChain(nearHip, nearFoot, thigh, shin, -1);
  const farLeg = solveChain(farHip, farFoot, thigh, shin, 1);
  const nearArm = solveChain(nearShoulder, nearHand, upperArm, lowerArm, -1);
  const farArm = solveChain(farShoulder, farHand, upperArm, lowerArm, 1);

  // --- Torso mass + head ------------------------------------------------
  const topCentre = {
    x: (nearShoulder.x + farShoulder.x) / 2,
    y: (shoulderY + farShoulderY) / 2,
  };
  const bottomCentre = {
    x: (nearHip.x + farHip.x) / 2,
    y: (hipY + farHipY) / 2,
  };
  const torso: TorsoPose = {
    topCentre,
    bottomCentre,
    topNear: { x: nearShoulder.x, y: nearShoulder.y },
    topFar: { x: farShoulder.x, y: farShoulder.y },
    bottomNear: { x: nearHip.x, y: nearHip.y },
    bottomFar: { x: farHip.x, y: farHip.y },
    width: config.torsoWidth,
  };

  const head: HeadPose = {
    centre: { x: pelvisX, y: headCentreY },
    crown: { x: pelvisX, y: crownY },
    eye: { x: pelvisX + eyeX, y: headCentreY - headRadius * 0.4 },
  };

  const blendWeights: BlendWeights = {
    idle: idleBlend,
    gait: airPose === 'grounded' ? Math.max(0, 1 - idleBlend) : 0,
    airborne: airPose === 'grounded' ? 0 : Math.max(0, 1 - idleBlend),
    landing: landingBlend,
    ceiling: ceilingBlend,
  };

  return {
    gaitPhase,
    airPose,
    blendWeights,
    farLeg,
    farArm,
    torso,
    nearLeg,
    nearArm,
    head,
  };
}

/**
 * Build an idle {@link PoseComposition} for a given seed. Pure, canvas-free
 * sample entry point for benchmark rendering and skeleton overlays.
 *
 * The renderer (`drawHumanoid`) renders the same pose to pixels; this helper
 * exposes the resolved landmarks so a benchmark script can overlay the
 * skeleton, sweep seeds/facings, and inspect geometry without duplicating the
 * evaluator.
 *
 * @param seed - deterministic config seed
 * @param motionOverrides - optional partial motion sample applied for a single
 *   tick before sampling (default: pure idle, grounded, right-facing)
 * @returns the idle (or lightly advanced) pose composition
 */
export function sampleIdlePose(
  config: HumanoidConfig,
  state: HumanoidVisualState = {
    locomotion: { phase: 0 },
    facing: 1,
    idleBlend: 1,
    airPose: 'grounded',
    launchBlend: 0,
    landingBlend: 0,
    ceilingBlend: 0,
    armTarget: null,
  },
  localArmTarget?: Readonly<Vec2>,
): PoseComposition {
  return composePose(state, config, localArmTarget);
}
