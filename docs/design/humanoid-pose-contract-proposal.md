# API Proposal: Humanoid Pose Evaluator Contract

> Target pillar: 2 (Cosmetics / Platformer). Module: `src/character/humanoid/pose.ts`.
> Builds on research: `docs/research/humanoid-platformer-visual-reference.md` (Godot phase-to-phase table, §Phase-to-phase range table).
> Builds on plan: `docs/design/humanoid-visual-revision-plan.md` (§Implementation shape / Pure pose layer, §Phase H1.5).
> Status: DRAFT.

## Consumer Need

`draw.ts` currently invents lower-body, upper-body, and whole-body offsets independently (`evaluateHumanoidLowerBodyPose`, `evaluateHumanoidUpperBodyPose`, `poseYOffset`). The measured Godot landmark table in the research note now provides a concrete target: 11 landmark classes across 11 required phases. The new `pose.ts` seam replaces these scattered evaluators with a single pure function that:

- Produces a complete canonical (right-facing) set of landmarks from `HumanoidVisualState` + `HumanoidConfig`;
- Derives **named gait phases** from the continuous `locomotion.phase` so tests and the renderer can assert on 'contact' vs 'passing' vs 'highPoint' rather than raw radians;
- Blends idle → gait → airborne → targeted-arm → landing → ceiling in a fixed, documented order so the renderer never chooses the blend sequence;
- Solves all four limb IK chains and reports both joint and end-effector positions, preserving exact configured limb lengths;
- Returns only finite numbers for any defensive input (non-finite `dt`, unreachable `armTarget`, invalid phase).

This contract settles the shape BEFORE any production code changes, so `draw.ts`, `state.ts`, and `character-humanoid.test.ts` all target the same interface.

---

## Approach A: Flat Landmark Record — `evaluatePose`

**Source pattern:** the plan's Measurement protocol (§Required landmarks) lists landmarks as a flat enumeration: "crown and head centre; visible eye or face-direction marker; near/far shoulder; ..." This is the closest TypeScript representation.

### Signature sketch

```ts
// src/character/humanoid/pose.ts

import type { Vec2 } from '../../animation/types';
import { solveLimb } from '../../animation/ik/limb';
import { evaluateLocomotion, blendLocomotionToStance } from '../../animation/locomotion';
import type { HumanoidAirPose, HumanoidConfig, HumanoidVisualState } from './types';

/**
 * Named gait phase derived from the continuous locomotion phase.
 *
 * Mapping from `locomotion.phase` to named phase uses the measured Godot
 * frame-to-phase alignment (research note §Phase-to-phase range table):
 * the Godot run cycle (frames 0–4) maps to [contact, recoil, passing,
 * highPoint, oppositeContact]. The engine divides the [0, 2π) phase space
 * into named ranges; the exact arcs are calibrated to match the displacement-
 * driven phase integration and may be tuned during H3 visual review.
 */
export type GaitPhase =
  | 'idle'
  | 'contact'
  | 'recoil'
  | 'passing'
  | 'highPoint'
  | 'oppositeContact';

/**
 * Per-tick blend contribution weights.
 *
 * These sum to ≤1 and encode the fixed blend order the evaluator applies.
 * Renderers may use them for diagnostic overlays or secondary interpolation.
 */
export interface BlendWeights {
  /** Contribution of the neutral idle pose [0, 1]. Equals state.idleBlend. */
  readonly idle: number;
  /** Contribution of displacement-driven gait [0, 1]. Equals 1 - idleBlend
   *  (reduced by subsequent blend steps when airborne/landing/ceiling active). */
  readonly gait: number;
  /** Contribution of airborne tuck [0, 1]. Non-zero only when !grounded. */
  readonly airborne: number;
  /** Contribution of landing compression [0, 1]. Equals state.landingBlend. */
  readonly landing: number;
  /** Contribution of ceiling mirror [0, 1]. Non-zero only when
   *  state.ceilingBlend > 0. */
  readonly ceiling: number;
}

/**
 * Complete canonical right-facing humanoid pose.
 *
 * Every landmark is finite and non-null for a well-formed state+config pair.
 * The pose is always right-facing; mirroring is applied at render time via
 * `ctx.scale(facing, 1)` — never by swapping near/far fields.
 */
export interface HumanoidPose {
  // --- Phase metadata ---
  readonly gaitPhase: GaitPhase;
  readonly airPose: HumanoidAirPose;
  readonly blendWeights: BlendWeights;

  // --- Head ---
  readonly crown: Readonly<Vec2>;
  readonly headCentre: Readonly<Vec2>;
  readonly eye: Readonly<Vec2>;

  // --- Torso ---
  readonly nearShoulder: Readonly<Vec2>;  // +x side (more exposed)
  readonly farShoulder: Readonly<Vec2>;   // -x side (partly occluded)
  readonly pelvisCentre: Readonly<Vec2>;  // origin for unsupported poses

  // --- Arms (solved via solveLimb, full chain reported) ---
  // Upper-arm root = shoulder position (not duplicated — nearShoulder/farShoulder
  // serve as the arm-chain root).
  readonly nearElbow: Readonly<Vec2>;
  readonly nearHand: Readonly<Vec2>;
  readonly farElbow: Readonly<Vec2>;
  readonly farHand: Readonly<Vec2>;

  // --- Legs (solved via solveLimb, full chain reported) ---
  readonly nearHip: Readonly<Vec2>;
  readonly nearKnee: Readonly<Vec2>;
  readonly nearAnkle: Readonly<Vec2>;
  readonly nearFoot: Readonly<Vec2>;
  readonly farHip: Readonly<Vec2>;
  readonly farKnee: Readonly<Vec2>;
  readonly farAnkle: Readonly<Vec2>;
  readonly farFoot: Readonly<Vec2>;
}

/**
 * Evaluate a complete canonical right-facing humanoid pose.
 *
 * Pure: same (state, config) → byte-identical HumanoidPose.
 * Never throws. All output landmarks are finite for any finite input.
 *
 * Blend order (fixed, documented):
 *   1. Start from neutral idle pose (both feet at idleStanceWidth,
 *      arms at relaxed IDLE_ARM_EXTENSION). Breathing is NOT part of
 *      the pose evaluator — it is applied as a render-time scale in
 *      draw.ts (breathe(tick, config.breath)).
 *   2. Blend in gait displacement (via evaluateLocomotion + stance blend)
 *      weighted by (1 - state.idleBlend).
 *   3. If airborne (airPose !== 'grounded'), blend legs toward tuck
 *      and adjust arms for ascent/apex/descent silhouette.
 *   4. If state.armTarget is set, blend the near arm toward the target
 *      using HUMANOID_TARGET_ARM_BLEND. Far arm stays in gait/idle role.
 *   5. If state.landingBlend > 0, compress pelvis and bend both knees
 *      toward the landing-compression target.
 *   6. If state.ceilingBlend > 0, mirror airborne vertical displacement
 *      to invert ascent/descent and landing orientation.
 *
 * @param state - HumanoidVisualState (locomotion, idleBlend, airPose,
 *   landingBlend, launchBlend, ceilingBlend, armTarget)
 * @param config - HumanoidConfig (limb lengths, torso dimensions, gait)
 * @param localArmTarget - optional arm target in canonical local space
 *   (right-facing frame, origin at body root). Caller (draw.ts) converts
 *   world targets to local space before passing. Tests may pass Vec2 directly.
 *   Unreachable targets are clamped to full extension — never non-finite.
 *   Omitted/undefined means the arm stays in its gait/idle pose.
 * @returns the resolved HumanoidPose
 *
 * @example
 * ```ts
 * const pose = evaluatePose(state, config);
 * console.log(pose.gaitPhase);                  // 'contact' | 'passing' | ...
 * console.log(pose.nearFoot.x, pose.nearFoot.y); // planted foot position
 * ```
 *
 * @example
 * ```ts
 * // With arm target (local space):
 * const pose = evaluatePose(state, config, { x: 10, y: -5 });
 * ```
 */
export function evaluatePose(
  state: HumanoidVisualState,
  config: HumanoidConfig,
  localArmTarget?: Readonly<Vec2>,
): HumanoidPose {
  // ... implementation in H2/H3 ...
}
```

### Gait phase derivation

```ts
// src/character/humanoid/pose.ts (phase derivation helper)

/**
 * Derive named gait phase from continuous locomotion phase.
 *
 * The phase-to-name mapping is calibrated against the Godot robot's 10-frame
 * run cycle (research note §Phase-to-phase range table). The displacement-
 * driven phase advance means one full stride (left foot contact → left foot
 * contact) covers 2π radians. Named phase boundaries:
 *
 * | Phase range         | GaitPhase          | Godot frame(s) |
 * |---------------------|--------------------|----------------|
 * | whole cycle         | idle               | 30 (idleBlend≈1) |
 * | [0π, 0.3π)         | contact            | 0              |
 * | [0.3π, 0.8π)       | recoil             | 1              |
 * | [0.8π, 1.3π)       | passing            | 2              |
 * | [1.3π, 1.7π)       | highPoint          | 3              |
 * | [1.7π, 2π)         | oppositeContact    | 4              |
 *
 * When state.idleBlend exceeds HUMANOID_IDLE_PHASE_THRESHOLD (no gait
 * contribution), returns 'idle'. Otherwise gaitPhase always reflects
 * the underlying continuous phase regardless of idleBlend.
 *
 * All constants are defined in `src/character/humanoid/constants.ts`
 * with citations to the Godot phase-to-phase range table.
 */
function deriveGaitPhase(phase: number, idleBlend: number): GaitPhase {
  if (idleBlend > HUMANOID_IDLE_PHASE_THRESHOLD) return 'idle';
  const p = ((phase % TWO_PI) + TWO_PI) % TWO_PI;
  if (p < HUMANOID_CONTACT_PHASE_END) return 'contact';
  if (p < HUMANOID_RECOIL_PHASE_END) return 'recoil';
  if (p < HUMANOID_PASSING_PHASE_END) return 'passing';
  if (p < HUMANOID_HIGH_POINT_PHASE_END) return 'highPoint';
  return 'oppositeContact';
}
```

### Blend order (fixed, documented)

The single `evaluatePose` function encodes the blend order internally. The order is:

1. **Idle** — construct pure-idle geometry: both feet at `±HUMANOID_IDLE_STANCE_WIDTH/2`, knees at natural extension, hands at `IDLE_ARM_EXTENSION` fraction of total arm length below shoulder, elbows bent outward at `HUMANOID_IDLE_ELBOW_OUTSET`. Torso dimensions from `config`. Head geometry from `config.headRadius`. Breathing is NOT applied here — it is a render-time concern in `draw.ts` via `breathe(tick, config.breath)`.
2. **Gait** — overlay `evaluateLocomotion(state.locomotion, config.gait)` displacement on hip and feet, then `blendLocomotionToStance` with `state.idleBlend`. Arms swing in phase opposition to legs via `sin(phase) * config.gait.strideLength * 0.6` (scaled by `1 - idleBlend`).
3. **Airborne** — if `state.airPose !== 'grounded'`, blend legs toward tuck target (`HUMANOID_AIRBORNE_TUCK`). The tuck is tighter for 'apex' than 'ascent'/'descent' per the plan's "Apex is more compact than ascent or descent" rule. Arms adjust: gather for ascent, spread for descent.
4. **Targeted arm** — if `localArmTarget` is provided, solve the near arm IK chain toward the target. Far arm retains its gait/idle pose. Untargeted arm is unchanged.
5. **Landing** — if `state.landingBlend > 0`, lower pelvis toward `HUMANOID_LANDING_PELVIS_Y`, bend both feet toward `HUMANOID_LANDING_FOOT_SPREAD`, and increase knee flexion. The landing compression is deeper than the Godot crouch proxy (research note §Notes for inferred production targets: landings should target pelvis at `-0.25H to -0.30H`).
6. **Ceiling** — if `state.ceilingBlend > 0`, mirror the vertical displacement of airborne/landing poses to invert gravity direction.

### Finite-output guarantee

The function clamps/guards at every IK call site:

- `state.locomotion.phase`: wrapped to `[0, 2π)` by `advanceLocomotionByDisplacement` before reaching the evaluator. Evaluator reads it as-is (already finite).
- `solveLimb`: never throws. Unreachable targets → full extension with `solved = false`.
- `Number.isFinite` guard on `state.idleBlend`, `state.landingBlend`, `state.ceilingBlend` before each blend step.
- `localArmTarget`: `solveLimb` handles unreachable targets gracefully.

### Limb length preservation

Every leg and arm IK chain is solved via `solveLimb` with the exact `config.thighLength`, `config.shinLength`, `config.upperArmLength`, `config.lowerArmLength`. The evaluator's JSDoc documents a tolerance of `1e-4` in local pixel units (matching `IK_POSITION_TOLERANCE_SQ = 0.0001`).

### Near/far semantics

- All field names use `near`/`far` prefixes, not `left`/`right`. Near = more exposed side (higher x in the canonical right-facing frame). Far = more occluded side (lower x).
- Near/far roles are computed once at the top of `evaluatePose` and preserved through to the return value.
- Mirroring is NOT applied here. `draw.ts` wraps the entire canvas output in `ctx.scale(facing, 1)`.

### Constants flow

Measured Godot targets from the research note are stored in `src/character/humanoid/constants.ts` as named constants with citations. This file already exists and gains the following new exports:

```ts
// In src/character/humanoid/constants.ts (additions):

/** 2π for phase wrapping — avoids repeated Math.PI * 2. */
export const TWO_PI = Math.PI * 2;

/** idleBlend threshold above which the gait phase is reported as 'idle'.
 *  At idleBlend ≈ 1, gait contribution is negligible. The boundary at 0.999
 *  prevents floating-point flicker between 'idle' and a gait phase during
 *  full idle. */
export const HUMANOID_IDLE_PHASE_THRESHOLD = 0.999;

/**
 * End of the contact phase in radians (0.3π).
 *
 * Godot frame 0 (contact, measured) → frame 1 (recoil, measured).
 * Contact occupies the first 0.2π of the 2π stride (1 of 10 run frames);
 * the boundary at 0.3π adds a transition buffer for visual clarity.
 * See research note §Phase-to-phase range table: frame 0 = contact.
 */
export const HUMANOID_CONTACT_PHASE_END = 0.9424777961; // 0.3π

/**
 * End of the recoil phase in radians (0.8π).
 *
 * Godot frame 1 (recoil, measured). Recoil spans frames 1–2; the boundary
 * at 0.8π covers frames 1 and most of frame 2's transition zone.
 * See research note §Phase-to-phase range table: frame 1 = recoil.
 */
export const HUMANOID_RECOIL_PHASE_END = 2.5132741229;  // 0.8π

/**
 * End of the passing phase in radians (1.3π).
 *
 * Godot frame 2 (passing, measured). Passing covers frames 2–3;
 * the boundary at 1.3π captures the swing-foot-under-body posture.
 * See research note §Phase-to-phase range table: frame 2 = passing.
 */
export const HUMANOID_PASSING_PHASE_END = 4.0840704497;  // 1.3π

/**
 * End of the high-point phase in radians (1.7π).
 *
 * Godot frame 3 (high point, measured). High point covers frames 3–4;
 * the boundary at 1.7π captures the rising-body posture before opposite
 * contact. See research note §Phase-to-phase range table: frame 3 = high point.
 */
export const HUMANOID_HIGH_POINT_PHASE_END = 5.340707511;  // 1.7π

/** Near shoulder offset from origin, measured from Godot frame 30: +0.228H.
 *  Human-proportion inferred range: +0.20H to +0.30H (Tyson Tan analysis).
 *  At H=24 this gives ~5.47 px. We use the midpoint of the inferred range. */
export const HUMANOID_IDLE_NEAR_SHOULDER_X = 0.25 * 24; // ≈ 6.0

/** Far shoulder offset from origin, Godot frame 30: -0.263H.
 *  Inferred range: -0.25H to -0.35H. */
export const HUMANOID_IDLE_FAR_SHOULDER_X = -0.30 * 24; // ≈ -7.2
```

All magic number targets in `pose.ts` reference these constants. No number is inlined.

### Usage example: draw.ts consuming HumanoidPose

```ts
// Inside updated drawHumanoid (Phase H2):
const pose = evaluatePose(state, config, localTarget);

ctx.save();
ctx.translate(body.x + body.width / 2, body.y + body.height);
ctx.scale(body.facing * scale, scale);

// Explicit depth passes (plan §Renderer layer):
// 1. Far leg
drawLimb(ctx, pose.farHip, pose.farKnee, pose.farAnkle, pose.farFoot,
  palette.outline, palette.base, 3, 1.8);
// 2. Far arm
drawLimb(ctx, pose.farShoulder, pose.farElbow, pose.farHand,
  palette.outline, palette.base, 3, 1.5);
// 3. Torso mass (breathing applied here — render-time only)
ctx.save();
ctx.translate(pose.pelvisCentre.x, (pose.nearShoulder.y + pose.pelvisCentre.y) / 2);
ctx.scale(breathScale.scaleX, breathScale.scaleY);
drawTorso(ctx, config, palette);
ctx.restore();
// 4. Near leg
drawLimb(ctx, pose.nearHip, pose.nearKnee, pose.nearAnkle, pose.nearFoot,
  palette.outline, palette.accent, 3.4, 1.8);
// 5. Near arm
drawLimb(ctx, pose.nearShoulder, pose.nearElbow, pose.nearHand,
  palette.outline, palette.feature, 3, 1.5);
// 6. Head + face
drawHead(ctx, pose, config, palette);
ctx.restore();
```

### Usage example: test asserting on HumanoidPose

```ts
// In src/tests/character-humanoid.test.ts:
import { evaluatePose, type HumanoidPose } from '../character/humanoid/pose';

it('idle feet are grounded, ordered, and non-crossing', () => {
  const config = deriveHumanoidConfig(1);
  const state = createHumanoidVisualState(config);
  const pose = evaluatePose(state, config);

  // Finite check (H6 requirement)
  const landmarks: Readonly<Vec2>[] = [
    pose.crown, pose.headCentre, pose.eye,
    pose.nearShoulder, pose.farShoulder, pose.pelvisCentre,
    pose.nearHip, pose.nearKnee, pose.nearFoot,
    pose.farHip, pose.farKnee, pose.farFoot,
  ];
  expect(landmarks.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);

  // Feet ordered and non-crossing
  expect(pose.nearFoot.x).toBeGreaterThan(pose.farFoot.x);

  // Feet grounded
  expect(pose.nearFoot.y).toBeCloseTo(0, 1);
  expect(pose.farFoot.y).toBeCloseTo(0, 1);

  // Limb lengths preserved
  expect(distance(pose.nearHip, pose.nearKnee)).toBeCloseTo(config.thighLength, 1);
  expect(distance(pose.nearKnee, pose.nearFoot)).toBeCloseTo(config.shinLength, 1);
});

it('gait phase is derived from continuous phase', () => {
  const config = deriveHumanoidConfig(1);
  let state = createHumanoidVisualState(config);
  // Walk for several ticks
  for (let i = 0; i < 200; i++) {
    state = advanceHumanoidVisual(config, state, motion({ dx: 4 }), 1);
  }
  const pose = evaluatePose(state, config);
  // Should not be idle
  expect(pose.gaitPhase).not.toBe('idle');
  // Phase is a known named phase
  expect(['contact', 'recoil', 'passing', 'highPoint', 'oppositeContact']).toContain(pose.gaitPhase);
});

it('contact has greater foot separation than passing', () => {
  const config = deriveHumanoidConfig(1);
  // ... sweep through phase, collect foot separation at contact vs passing
  // Use evaluatePose(state, config).nearFoot.x - farFoot.x
  // Contact separation > passing separation (H6 requirement)
});
```

### Trade-offs

| Criterion | Assessment |
|---|---|
| **Ergonomics (draw.ts)** | Moderate. Draw passes need to pick individual landmarks from the flat record. The `drawLimb` helper receives root/joint/end tuples explicitly. Slightly verbose but explicit. |
| **Ergonomics (tests)** | Strong. Every landmark is a direct field. `pose.nearFoot.x` reads clearly. No nesting to traverse. |
| **Determinism clarity** | Strong. `evaluatePose` is a single pure function with no side effects. Signature makes purity obvious. |
| **Runtime cost** | Low. Single function, single pass. Two `solveLimb` calls (near leg, far leg) + two for arms = 4 IK solves. Same as current code. |
| **Consumer complexity** | Low. One function to import. One return type to understand. |
| **Fit to measured data** | Strong. The flat landmark list maps 1:1 to the research note's Required landmarks table. The `GaitPhase` enum maps to the Measured phases table. The procedural solver always computes every joint, so output is non-nullable (nullability is confined to the research measurement table only). |
| **Mirroring correctness** | Strong. Near/far are field names, not computed from position. No risk of role reversal. |

---

## Approach B: Layered Limb Composition — `composePose`

**Source pattern:** the plan's Renderer layer (explicit depth passes: far leg → far arm → torso → near leg → near arm → head) and the existing `HumanoidLowerBodyPose`/`HumanoidUpperBodyPose` shape in `draw.ts`.

### Signature sketch

```ts
// src/character/humanoid/pose.ts

import type { Vec2 } from '../../animation/types';
import type { HumanoidAirPose, HumanoidConfig, HumanoidVisualState } from './types';

// --- Shared with Approach A ---
export type GaitPhase =
  | 'idle'
  | 'contact'
  | 'recoil'
  | 'passing'
  | 'highPoint'
  | 'oppositeContact';

export interface BlendWeights {
  readonly idle: number;
  readonly gait: number;
  readonly airborne: number;
  readonly landing: number;
  readonly ceiling: number;
}

// --- New layered types ---

/**
 * A fully solved two-bone limb chain.
 *
 * Three positions: root (hip/shoulder), joint (knee/elbow), end (ankle/hand).
 * All positions are in canonical right-facing local space.
 */
export interface LimbChain {
  readonly root: Readonly<Vec2>;
  readonly joint: Readonly<Vec2>;
  readonly end: Readonly<Vec2>;
}

/**
 * Head pose with silhouette and facial feature position.
 */
export interface HeadPose {
  readonly centre: Readonly<Vec2>;  // centre of head circle
  readonly crown: Readonly<Vec2>;   // top of head (centre + [0, -radius])
  readonly eye: Readonly<Vec2>;     // eye position (travel-side offset)
  // radius is NOT duplicated — read config.headRadius directly
}

/**
 * Torso volume as a procedural mass.
 *
 * The three-quarter torso is not a symmetric rectangle. `topNear`/`topFar`/
 * `bottomNear`/`bottomFar` define an irregular quadrilateral that reads as
 * turned toward the viewer.
 *
 * Naming follows the canonical near/far convention used throughout:
 * near = more exposed side (higher x in right-facing frame),
 * far = more occluded side (lower x).
 */
export interface TorsoPose {
  readonly topCentre: Readonly<Vec2>;       // midpoint between shoulders
  readonly bottomCentre: Readonly<Vec2>;     // pelvis centre
  readonly topNear: Readonly<Vec2>;          // near shoulder + torso-width offset
  readonly topFar: Readonly<Vec2>;           // far shoulder + torso-width offset
  readonly bottomNear: Readonly<Vec2>;       // near hip + torso-width offset
  readonly bottomFar: Readonly<Vec2>;        // far hip + torso-width offset
  readonly width: number;                    // config.torsoWidth
}

/**
 * Canonical right-facing pose composition, structured by the depth-order
 * the renderer will draw in.
 *
 * Every field is finite and non-null for well-formed inputs.
 * The procedural solver always computes every joint, so the output type
 * uses non-nullable `Readonly<Vec2>`. Nullability is confined to the
 * research/measurement representation only (see Godot landmark table in
 * `docs/research/humanoid-platformer-visual-reference.md`), not the
 * evaluator output.
 */
export interface PoseComposition {
  // --- Phase metadata ---
  readonly gaitPhase: GaitPhase;
  readonly airPose: HumanoidAirPose;
  readonly blendWeights: BlendWeights;

  // --- Body groups (listed in render depth order) ---
  readonly farLeg: LimbChain;      // drawn first
  readonly farArm: LimbChain;
  readonly torso: TorsoPose;       // includes pelvis
  readonly nearLeg: LimbChain;
  readonly nearArm: LimbChain;
  readonly head: HeadPose;         // drawn last (before foreground accents)
}

/**
 * Canonical right-facing pose composition with typed limb groups.
 *
 * Blend order (fixed, documented, identical to Approach A):
 * 1. Idle → 2. Gait → 3. Airborne → 4. Targeted arm → 5. Landing → 6. Ceiling
 *
 * Pure: same (state, config) → byte-identical PoseComposition.
 * Never throws. All output coordinates are finite.
 *
 * Layer-separation rule: the evaluator takes a pre-converted local arm
 * target (canonical right-facing local space, origin at body root).
 * World→local conversion is the responsibility of draw.ts (see
 * draw.ts:242-248). The evaluator MUST NOT import or couple to
 * CharacterBodyFrame / world-space types.
 *
 * @param state - HumanoidVisualState (locomotion, idleBlend, airPose,
 *   landingBlend, launchBlend, ceilingBlend, armTarget)
 * @param config - HumanoidConfig (limb lengths, torso dimensions, gait)
 * @param localArmTarget - optional local-space arm target in canonical
 *   right-facing frame (origin at body root). Passed by draw.ts after
 *   world-space conversion. Omitted/undefined means the arm stays in its
 *   gait/idle pose.
 * @returns resolved PoseComposition with typed limb groups
 *
 * @example
 * ```ts
 * const pose = composePose(state, config);
 * // Verify near leg length:
 * const nearLegLen = distance(pose.nearLeg.root, pose.nearLeg.joint)
 *                  + distance(pose.nearLeg.joint, pose.nearLeg.end);
 * expect(nearLegLen).toBeCloseTo(config.thighLength + config.shinLength, 1);
 * ```
 */
export function composePose(
  state: HumanoidVisualState,
  config: HumanoidConfig,
  localArmTarget?: Readonly<Vec2>,
): PoseComposition {
  // ... implementation in H2/H3 ...
}
```

### Gait phase derivation

Same `deriveGaitPhase` helper as Approach A — identical typed enum, identical phase-range mapping in `constants.ts`. The derivation is independent of the return shape. The same `HUMANOID_IDLE_PHASE_THRESHOLD` constant governs when `idleBlend` triggers the `'idle'` phase.

### Blend order

Identical to Approach A. The six-step blend order is encoded inside `composePose`. Neither approach exposes the order to callers.

### Usage example: draw.ts consuming PoseComposition

```ts
// Inside updated drawHumanoid (Phase H2):
const pose = composePose(state, config, localTarget);

ctx.save();
ctx.translate(body.x + body.width / 2, body.y + body.height);
ctx.scale(body.facing * scale, scale);

// The depth passes ARE the fields in order.
// 1. Far leg
drawLimb(ctx, pose.farLeg.root, pose.farLeg.joint, pose.farLeg.end,
  palette.outline, palette.base, 3, 1.8);
// 2. Far arm
drawLimb(ctx, pose.farArm.root, pose.farArm.joint, pose.farArm.end,
  palette.outline, palette.base, 3, 1.5);
// 3. Torso mass (breathing applied here as a render-time scale)
ctx.save();
ctx.translate(pose.torso.bottomCentre.x, (pose.torso.topCentre.y + pose.torso.bottomCentre.y) / 2);
ctx.scale(breathScale.scaleX, breathScale.scaleY);
// Use torso quadrilateral corners for the three-quarter shape
drawTorsoQuad(ctx, pose.torso, palette);
ctx.restore();
// 4. Near leg
drawLimb(ctx, pose.nearLeg.root, pose.nearLeg.joint, pose.nearLeg.end,
  palette.outline, palette.accent, 3.4, 1.8);
// 5. Near arm
drawLimb(ctx, pose.nearArm.root, pose.nearArm.joint, pose.nearArm.end,
  palette.outline, palette.feature, 3, 1.5);
// 6. Head + face
drawHead(ctx, pose.head, config, palette);
ctx.restore();
```

### Usage example: test asserting on PoseComposition

```ts
it('idle feet are grounded, ordered, and non-crossing', () => {
  const config = deriveHumanoidConfig(1);
  const state = createHumanoidVisualState(config);
  const pose = composePose(state, config);

  // Finite check — traverse all Vec2 fields in all groups
  const allVec2s: Readonly<Vec2>[] = [
    pose.head.centre, pose.head.crown, pose.head.eye,
    pose.torso.topCentre, pose.torso.bottomCentre,
    pose.torso.topNear, pose.torso.topFar,
    pose.torso.bottomNear, pose.torso.bottomFar,
    pose.farLeg.root, pose.farLeg.joint, pose.farLeg.end,
    pose.farArm.root, pose.farArm.joint, pose.farArm.end,
    pose.nearLeg.root, pose.nearLeg.joint, pose.nearLeg.end,
    pose.nearArm.root, pose.nearArm.joint, pose.nearArm.end,
  ];
  expect(allVec2s.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);

  // Feet ordered (near foot is right side in canonical frame)
  expect(pose.nearLeg.end.x).toBeGreaterThan(pose.farLeg.end.x);

  // IK lengths preserved
  expect(distance(pose.nearLeg.root, pose.nearLeg.joint)).toBeCloseTo(config.thighLength, 1);
  expect(distance(pose.nearLeg.joint, pose.nearLeg.end)).toBeCloseTo(config.shinLength, 1);
  expect(distance(pose.nearArm.root, pose.nearArm.joint)).toBeCloseTo(config.upperArmLength, 1);
  expect(distance(pose.nearArm.joint, pose.nearArm.end)).toBeCloseTo(config.lowerArmLength, 1);
});
```

### Trade-offs

| Criterion | Assessment |
|---|---|
| **Ergonomics (draw.ts)** | Strong. The 6 depth passes map 1:1 to the 6 groups in `PoseComposition`. The renderer iterates over `farLeg, farArm, torso, nearLeg, nearArm, head` — the exact order the plan specifies. No need to know which landmarks belong in which pass. |
| **Ergonomics (tests)** | Moderate. `pose.nearLeg.end.x` is slightly more verbose than `pose.nearFoot.x` but carries more structure. Assertions on IK chains are natural (`distance(pose.nearLeg.root, pose.nearLeg.joint)` is the thigh; `distance(pose.nearLeg.joint, pose.nearLeg.end)` is the shin). |
| **Determinism clarity** | Strong. `composePose` is a single pure function. Same signature, same guarantees. |
| **Runtime cost** | Same as A. 4 IK solves. No additional composition overhead. |
| **Consumer complexity** | Low. Slightly more nested types to learn, but the structure directly mirrors the drawing problem. |
| **Fit to measured data** | Moderate. The Godot measurement table is flat (not grouped into LimbChains). An armature-level comparison requires extracting `nearKnee.x` from `pose.nearLeg.joint.x` — a small indirection. The landmark table maps naturally but not directly. |
| **Mirroring correctness** | Strong. `nearLeg`/`farLeg` are typed field names. No confusion with left/right. |
| **Blend-order documentation** | Strong. The struct itself documents the depth ordering. A reader sees `farLeg → farArm → torso → nearLeg → nearArm → head` directly in the type. |

---

## Comparison Table

| Criterion | A: Flat Landmark (`evaluatePose`) | B: Layered (`composePose`) |
|---|---|---|
| **Draw.ts ergonomics** | Moderate — renderer picks landmarks per pass | Strong — groups ARE the passes |
| **Test ergonomics** | Strong — direct field access | Moderate — nested access, but IK assertions are natural |
| **Measurement protocol fit** | Direct 1:1 mapping | Indirect (field → chain.end) |
| **IK assertion naturalness** | Manual distance(shoulder, elbow) | Natural chain.root → chain.joint |
| **Near/far clarity** | Field prefixes | Group prefixes |
| **Depth-order documentation** | Implicit in render pass | Explicit in type field order |
| **Type size** | ~20 fields (most Vec2) | ~6 groups + metadata |
| **Extensibility for new landmarks** | Add field | Add group or add field to group |
| **Determinism clarity** | Equal (single pure fn) | Equal (single pure fn) |
| **Null handling** | Non-nullable — procedural solver computes all joints | Non-nullable — procedural solver computes all joints |
| **Three-quarter torso shape** | Not addressed (flat landmark) | `TorsoPose` includes quadrilateral corners — explicitly supports three-quarter construction |
| **Runtime cost** | Equal (both do 4 IK solves) | Equal |

---

## Recommendation

**Alternative B: Layered Limb Composition (`composePose` → `PoseComposition`).**

The decisive reason: **the layered structure IS the depth pass order.** The plan explicitly lists 7 render passes (far leg, far arm, torso+pelvis, near leg, near arm, head, foreground). In Approach B, these correspond directly to the fields of `PoseComposition`. The renderer iterates the struct fields in type order and calls `drawLimb`/`drawTorso`/`drawHead`. There is no mapping step, no "which landmarks go in which pass" question. This is the shape the renderer naturally consumes.

Approach A is a better fit for direct comparison with the measurement protocol, but the measurement protocol is a design-time reference, not a runtime consumer. `draw.ts` does the rendering, not the Godot table. For the primary consumer (draw.ts), B is cleaner.

The IK chain grouping also makes the H6 tests more expressive: `distance(pose.nearLeg.root, pose.nearLeg.joint)` is explicitly "the thigh length is preserved" rather than `distance(pose.nearHip, pose.nearKnee)` which requires the reader to know which fields are the thigh endpoints.

The single risk with B is that the nested structure is slightly more verbose for simple field access in tests. The trade-off is worth it because test clarity benefits from the explicit chain grouping (IK length assertions read without comments).

---

## Resolved Open Questions and Architect's Rulings

The following four open questions were reviewed by `@architect`. The rulings are binding and reflected in the proposal above.

### Ruling OQ1 — Nullable vs computed

**Decision:** The evaluator's output type is **non-nullable** for all landmarks in BOTH approaches. Nullability is confined to the research/measurement representation (`docs/research/humanoid-platformer-visual-reference.md` Godot table) only. The procedural solver always computes every joint, so output uses non-nullable `Readonly<Vec2>`.

**Impact on proposal:** Both output types use `Readonly<Vec2>` without `null`. The `GaitPhase` derivation and `BlendWeights` use regular types. The research document retains `null` where Godot landmarks were not visually distinct (elbows, hands, etc.), but the evaluator derives them procedurally.

### Ruling OQ2 — Breathing location

**Decision:** Breathing **stays in `draw.ts`** as a render-time scale. The `pose.ts` evaluator signature has **NO `tick` parameter**. Remove the contradiction: blend-order step 1 must NOT reference "breathing applied via tick". Keep `pose.ts` focused on structural geometry.

**Impact on proposal:** All references to breathing have been removed from the pose evaluator's blend order (both approaches). The `composePose` and `evaluatePose` signatures have no `tick` parameter. Breathing is documented in the draw.ts usage examples as a render-time scale applied via `ctx.scale(breathScale.scaleX, breathScale.scaleY)`. This resolves the determinism-dimension FAIL identified in the architect's review.

### Ruling OQ3 — armTarget conversion

**Decision:** The evaluator takes a **pre-converted local target** (`composePose(state, config, localArmTarget?)`, canonical right-facing local space, origin at body root). The world→local conversion stays in `draw.ts` (it already does it at `draw.ts:242-248`). The evaluator must NOT import or couple to `CharacterBodyFrame` / world-space types.

**Impact on proposal:** Both signatures take `localArmTarget?: Readonly<Vec2>` with no coupling to world-space types. The JSDoc documents this layer-separation rule explicitly: "Caller (draw.ts) converts world targets to local space before passing." The existing draw.ts:242-248 code is the authoritative conversion site.

### Ruling OQ4 — GaitPhase when idle+gait both active

**Decision:** `gaitPhase` is **always derived from the continuous phase** regardless of `idleBlend`. When `idleBlend` exceeds the idle threshold (`HUMANOID_IDLE_PHASE_THRESHOLD`), `gaitPhase === 'idle'`; otherwise it is one of `contact`/`recoil`/`passing`/`highPoint`/`oppositeContact`. The threshold is documented as a named constant in `src/character/humanoid/constants.ts`.

**Impact on proposal:** The `deriveGaitPhase` helper checks `idleBlend > HUMANOID_IDLE_PHASE_THRESHOLD` (replacing the magic `0.999`). Below the threshold, phase is always derived from the continuous `locomotion.phase`. The threshold constant is defined with its value (`0.999`) and a comment explaining its purpose (floating-point flicker prevention).

---

## Test Migration

Phase H1.5 removes the two intermediate evaluators from `draw.ts`:

| Removed export | From | Replacement |
|---|---|---|
| `evaluateHumanoidLowerBodyPose` | `src/character/humanoid/draw.ts` | `composePose` in `src/character/humanoid/pose.ts` |
| `evaluateHumanoidUpperBodyPose` | `src/character/humanoid/draw.ts` | `composePose` in `src/character/humanoid/pose.ts` |
| `poseYOffset` (internal) | `src/character/humanoid/draw.ts` | Absorbed into `composePose`'s blend order |

The existing test file `src/tests/character-humanoid.test.ts` imports both removed evaluators at lines 12–14:

```ts
import {
  evaluateHumanoidLowerBodyPose,
  evaluateHumanoidUpperBodyPose,
} from '../character/humanoid/draw';
```

These tests must be migrated to the new `composePose` evaluator as part of Phase H6. The migration path:

1. Replace the import: `import { composePose } from '../character/humanoid/pose';`
2. Replace `evaluateHumanoidLowerBodyPose(config, state)` calls with `composePose(state, config)`, adjusting field access to the grouped `PoseComposition` shape.
3. Replace `evaluateHumanoidUpperBodyPose(config, state, torsoTop)` calls — the upper body no longer requires a separate `torsoTop` parameter; all geometry is resolved in the single `composePose` call.

Neither removed evaluator is re-exported from the public barrel (`src/character/humanoid/index.ts` or `src/index.ts`), so this is **not a consumer-facing break**. The test migration is internal to the repository.

The new `composePose` test coverage is designed to match or exceed the coverage of the removed evaluators (neutral stance invariants, finite output, IK length preservation, limb ordering, non-crossing segments, gait phase classification, airborne arm/leg adjustment, arm-target blending, landing compression, and ceiling inversion).

---

## Revision Notes

This revision (2026-07-29) was prepared in response to `@architect`'s `NEEDS REVISION` review. All line-anchored objections (1–11) and the four binding open-question rulings (OQ1–OQ4) from the architect's critique are resolved in this document. Key changes:

| Ref | Change |
|---|---|
| #1 | Removed breathing from blend order step 1 (contradiction: no-tick signature vs breathing from tick). Resolved by OQ2. |
| #2 | `Math.PI * 2` → `TWO_PI` named constant in `constants.ts`. |
| #3 | `idleBlend > 0.999` → `idleBlend > HUMANOID_IDLE_PHASE_THRESHOLD` named constant. |
| #4 | Defined `HUMANOID_CONTACT_PHASE_END` / `RECOIL_PHASE_END` / `PASSING_PHASE_END` / `HIGH_POINT_PHASE_END` with values and Godot citations. |
| #5 | Dropped `nearUpperArm`/`farUpperArm` from `HumanoidPose`; shoulder is the single root. |
| #6 | Renamed `TorsoPose` corners: `topLeft`→`topNear`, `topRight`→`topFar`, `bottomLeft`→`bottomNear`, `bottomRight`→`bottomFar`. |
| #7 | Added `ceiling: number` to `BlendWeights`. |
| #8 | Removed `radius` from `HeadPose`; renderer reads `config.headRadius`. |
| #9 | JSDoc: "null = gait/idle arm" → "omitted/undefined" to match optional `?` signature. |
| #10 | Added `launchBlend` to `@param state` docs in both approaches (listed all fields). |
| #11 | Replaced inline `import('./types').HumanoidAirPose` with top-level `import type { HumanoidAirPose } from './types'`. |
| OQ1 | Non-nullable output: stated explicitly in both approaches. |
| OQ2 | No `tick` parameter; breathing is render-time in draw.ts. |
| OQ3 | Pre-converted local target; draw.ts owns world→local conversion. |
| OQ4 | GaitPhase always derived from continuous phase; `HUMANOID_IDLE_PHASE_THRESHOLD` governs idle return. |
| #12 (test migration) | Added explicit Test Migration section documenting removed evaluators and the migration path for H6. |
