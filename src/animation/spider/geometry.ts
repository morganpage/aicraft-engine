/**
 * Pure three-segment spider leg geometry module.
 *
 * Computes hip positions, fixed coxa endpoints, femur+tibia annuli,
 * target workspace projection, and the full analytical three-segment
 * IK solve (coxa + femur + tibia).
 *
 * **Determinism contract.** Pure, deterministic, no host access, no
 * `Math.random`, no `Date.now()`, no global state, no DOM reads.
 * Same inputs → identical output. Never throws.
 *
 * @module
 */

import type { Vec2 } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shared leg geometry configuration used by both the gait solver and the
 * renderer. Defines the three-segment leg lengths and workspace bounds.
 *
 * Every tunable is a field — no magic numbers in the implementation.
 */
export interface SpiderLegGeometryConfig {
  /** Hip joint radius from body center in px. Controls where the coxa attaches to the body. */
  readonly hipRadius: number;
  /** Coxa (first segment, closest to body) length in px. */
  readonly coxaLength: number;
  /** Femur (second segment) length in px. */
  readonly femurLength: number;
  /** Tibia (third segment, foot end) length in px. */
  readonly tibiaLength: number;
  /** Minimum extension ratio — femur+tibia distance below which the leg folds. */
  readonly minExtensionRatio: number;
  /** Maximum extension ratio — femur+tibia distance above which the leg extends. */
  readonly maxExtensionRatio: number;
  /** Joint safety margin in px — physical dead-zone at annulus boundaries. */
  readonly jointSafetyMargin: number;
  /**
   * Minimum femur and distal (tibia) outward advance as a fraction of each
   * segment's length.
   *
   * Enforces the anatomical fore/aft chain: the tibia must advance at least
   * `tibiaLength * minDistalAdvanceRatio` px along the leg's outward axis so it
   * reads as extending outward rather than reversing back toward the body
   * (the folded-Z silhouette). Dimensionless — unchanged when a spider is
   * scaled. Shared because both gait target generation and the renderer
   * fallback must enforce the same value.
   */
  readonly minDistalAdvanceRatio: number;
}

/**
 * Femur+tibia annulus bounds computed from geometry config.
 * Used to constrain targets and validate reachability.
 */
export interface FemurTibiaAnnuli {
  /** Hard minimum distance from coxa tip to foot (below this: fold). */
  readonly hardMin: number;
  /** Soft minimum — preferred minimum working distance. */
  readonly softMin: number;
  /** Soft maximum — preferred maximum working distance. */
  readonly softMax: number;
  /** Hard maximum distance from coxa tip to foot (above this: extend). */
  readonly hardMax: number;
}

/**
 * Structured result for a leg's step request. Replaces ambiguous scalar
 * thresholds with explicit fields.
 *
 * `needsStep` is true when:
 * - restError > comfortRadius (foot drifted from rest), OR
 * - coxa-foot distance is outside softMin/softMax (absolute workspace violation)
 *
 * Hard violations rank above soft, then greater error, then stable index.
 */
export interface LegStepRequest {
  /** Whether this leg needs to step. */
  readonly needsStep: boolean;
  /** Combined urgency scalar for ranking (higher = more urgent). */
  readonly urgency: number;
  /** Distance from foot to rest world position. */
  readonly restError: number;
  /** Workspace error magnitude (distance outside soft annulus, 0 if inside). */
  readonly workspaceError: number;
  /**
   * Anatomical sector error in px: how far short of the minimum outward tibia
   * advance the current planted foot is (0 when the tibia already extends
   * outward). A folded-Z foot has sectorError > 0 and must replant.
   */
  readonly sectorError: number;
  /** Whether the foot is outside hardMin/hardMax (absolute violation). */
  readonly hardViolation: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeNum(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Coerce a value to a strictly-positive finite number, falling back when the
 * input is non-finite or non-positive. Used for segment lengths (hipRadius,
 * coxaLength, femurLength, tibiaLength) where a zero or negative length would
 * produce a degenerate annulus or collapse the IK solve.
 */
function safePositive(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function safeVec2(v: Vec2, fallbackX: number, fallbackY: number): Vec2 {
  return {
    x: Number.isFinite(v.x) ? v.x : fallbackX,
    y: Number.isFinite(v.y) ? v.y : fallbackY,
  };
}

/**
 * Vertical (downward) component of the coxa direction, as a fraction of the
 * horizontal anterior/posterior spread. The coxa extends mostly outward
 * horizontally with a slight downward droop, giving the classic spider splay
 * where coxae fan out and the femur/tibia reach down to the ground.
 *
 * Escalation candidate: promote to {@link SpiderLegGeometryConfig} if
 * consumers need to tune it per-creature.
 */
const COXA_VERTICAL_BIAS = 0.3;

/** Default distal advance ratio when the config omits/mis-sets the field. */
const DEFAULT_MIN_DISTAL_ADVANCE_RATIO = 0.1;

/** Fixed iteration count for the sector bisection search (determinism). */
const SECTOR_BISECTION_ITERATIONS = 12;

/** Floating tolerance used when exposing a positive sector-recovery error. */
const SECTOR_VALIDITY_EPSILON = 1e-8;

// ---------------------------------------------------------------------------
// Anatomical sector helpers (internal)
// ---------------------------------------------------------------------------

/**
 * Facing-relative outward sign for a leg. Anterior legs (mirrored restLocalX >
 * 0) advance toward increasing world X; posterior legs toward decreasing X.
 * A degenerate (zero) restLocalX falls back to facing so the sign stays
 * deterministic without reading velocity or mutable render state.
 */
function getLegOutwardSign(restLocalX: number, facing: 1 | -1): 1 | -1 {
  const safeFacing: 1 | -1 = facing === -1 ? -1 : 1;
  const mirrored = safeNum(restLocalX, 0) * safeFacing;
  return mirrored >= 0 ? 1 : -1;
}

/**
 * Both analytical femur+tibia knee solutions for a coxa→target chain.
 *
 * Returns the two circle-intersection knees (the two elbow branches). Does NOT
 * choose a branch. When the target is unreachable (beyond max or below min
 * reach), both branches collapse to the single degenerate knee on the
 * coxa→target ray so callers still get finite, fixed-femur-length points.
 */
function solveFemurTibiaBranches(
  coxa: Vec2,
  target: Vec2,
  femurLen: number,
  tibiaLen: number,
): readonly [Vec2, Vec2] {
  const dx = target.x - coxa.x;
  const dy = target.y - coxa.y;
  const dist = Math.hypot(dx, dy);
  const maxReach = femurLen + tibiaLen;
  const minReach = Math.abs(femurLen - tibiaLen);

  if (dist < 1e-8) {
    // Degenerate: target on the coxa. Put the knee straight up by femurLen.
    const knee = { x: coxa.x, y: coxa.y - femurLen };
    return [knee, knee];
  }

  const ux = dx / dist;
  const uy = dy / dist;

  if (dist >= maxReach) {
    const knee = { x: coxa.x + ux * femurLen, y: coxa.y + uy * femurLen };
    return [knee, knee];
  }
  if (dist <= minReach) {
    // Foot inside the inner circle: knee on the ray at femurLen (folded).
    const knee = { x: coxa.x + ux * femurLen, y: coxa.y + uy * femurLen };
    return [knee, knee];
  }

  const a = (femurLen * femurLen - tibiaLen * tibiaLen + dist * dist) / (2 * dist);
  const hSq = femurLen * femurLen - a * a;
  const h = Math.sqrt(Math.max(0, hSq));
  const baseX = coxa.x + a * ux;
  const baseY = coxa.y + a * uy;

  return [
    { x: baseX - h * uy, y: baseY + h * ux },
    { x: baseX + h * uy, y: baseY - h * ux },
  ];
}

/** Diagnostics for one knee branch, used by both selection and tests. */
interface LegBranchEvaluation {
  readonly knee: Vec2;
  readonly femurAdvance: number;
  readonly distalAdvance: number;
  readonly kneeIsUpward: boolean;
  readonly satisfiesSector: boolean;
}

/**
 * Evaluate one knee branch against the anatomical sector constraints:
 * - femurAdvance = (knee.x - coxa.x) * outwardSign >= 0
 * - distalAdvance = (foot.x - knee.x) * outwardSign >= tibiaLen * minRatio
 * - kneeIsUpward: knee.y <= max(coxa.y, foot.y)
 */
function evaluateLegBranch(
  knee: Vec2,
  coxa: Vec2,
  foot: Vec2,
  outwardSign: 1 | -1,
  femurLen: number,
  tibiaLen: number,
  minDistalAdvanceRatio: number,
): LegBranchEvaluation {
  const femurAdvance = (knee.x - coxa.x) * outwardSign;
  const distalAdvance = (foot.x - knee.x) * outwardSign;
  const minRatio = Math.max(
    0,
    safeNum(minDistalAdvanceRatio, DEFAULT_MIN_DISTAL_ADVANCE_RATIO),
  );
  const minFemur = femurLen * minRatio;
  const minDistal = tibiaLen * minRatio;
  const kneeIsUpward = knee.y <= Math.max(coxa.y, foot.y) + 1e-8;
  const satisfiesSector = femurAdvance >= minFemur - 1e-8 &&
    distalAdvance >= minDistal - 1e-8;
  return { knee, femurAdvance, distalAdvance, kneeIsUpward, satisfiesSector };
}

/**
 * Choose the anatomically valid knee branch for a coxa→foot chain, preferring
 * (lexicographically): sector-satisfying, then upward, then nearest the
 * anatomical pole, with a stable branch-order tie-break.
 */
function selectKneeBranch(
  coxa: Vec2,
  foot: Vec2,
  outwardSign: 1 | -1,
  femurLen: number,
  tibiaLen: number,
  minDistalAdvanceRatio: number,
  poleNX: number,
  poleNY: number,
): Vec2 {
  const [k1, k2] = solveFemurTibiaBranches(coxa, foot, femurLen, tibiaLen);
  const e1 = evaluateLegBranch(
    k1, coxa, foot, outwardSign, femurLen, tibiaLen, minDistalAdvanceRatio,
  );
  const e2 = evaluateLegBranch(
    k2, coxa, foot, outwardSign, femurLen, tibiaLen, minDistalAdvanceRatio,
  );

  // Rank: sector (2) > upward (1) > pole proximity, higher is better.
  const rank = (e: LegBranchEvaluation): number =>
    (e.satisfiesSector ? 2 : 0) + (e.kneeIsUpward ? 1 : 0);
  const r1 = rank(e1);
  const r2 = rank(e2);
  if (r1 !== r2) return r1 > r2 ? k1 : k2;

  // Tie on category → nearest the anatomical pole direction from the coxa.
  const poleDist = (k: Vec2): number => {
    const dx = k.x - coxa.x;
    const dy = k.y - coxa.y;
    const len = Math.hypot(dx, dy) || 1;
    // 1 - cos(angle to pole): smaller is closer to the pole.
    return 1 - (dx / len * poleNX + dy / len * poleNY);
  };
  const p1 = poleDist(k1);
  const p2 = poleDist(k2);
  if (Math.abs(p1 - p2) > 1e-9) return p1 < p2 ? k1 : k2;
  // Exact tie: stable branch order.
  return k1;
}

/** Does a sector-valid (outward + upward) branch exist for this foot? */
function sectorValidAt(
  coxa: Vec2,
  foot: Vec2,
  outwardSign: 1 | -1,
  femurLen: number,
  tibiaLen: number,
  minDistalAdvanceRatio: number,
): boolean {
  const [k1, k2] = solveFemurTibiaBranches(coxa, foot, femurLen, tibiaLen);
  for (const k of [k1, k2]) {
    const e = evaluateLegBranch(
      k, coxa, foot, outwardSign, femurLen, tibiaLen, minDistalAdvanceRatio,
    );
    if (e.satisfiesSector && e.kneeIsUpward) return true;
  }
  return false;
}

/**
 * Find the outward foot X, at a fixed Y, whose coxa distance lies in
 * `[boundMin, boundMax]` AND admits an anatomically valid knee branch, chosen
 * nearest to `desiredX`. Returns `null` when no valid X exists at this Y.
 *
 * Sector validity is monotone in outward magnitude (a foot too close folds the
 * tibia back; pushing it outward straightens the chain), so a fixed-count
 * bisection deterministically locates the validity boundary.
 */
function sectorFeasibleX(
  coxa: Vec2,
  desiredX: number,
  y: number,
  femurLen: number,
  tibiaLen: number,
  outwardSign: 1 | -1,
  minDistalAdvanceRatio: number,
  boundMin: number,
  boundMax: number,
): number | null {
  const dy = y - coxa.y;
  const dySq = dy * dy;
  if (boundMax * boundMax < dySq) return null; // this Y is out of radial reach

  const loMag = Math.sqrt(Math.max(0, boundMin * boundMin - dySq));
  const hiMag = Math.sqrt(Math.max(0, boundMax * boundMax - dySq));
  if (hiMag < loMag) return null;

  const footAt = (mag: number): Vec2 => ({ x: coxa.x + outwardSign * mag, y });
  const validAt = (mag: number): boolean =>
    sectorValidAt(coxa, footAt(mag), outwardSign, femurLen, tibiaLen, minDistalAdvanceRatio);

  if (!validAt(hiMag)) return null; // even fully extended can't satisfy the sector

  // Locate the smallest valid magnitude via fixed-count bisection.
  let boundaryMag: number;
  if (validAt(loMag)) {
    boundaryMag = loMag;
  } else {
    let invalid = loMag;
    let valid = hiMag;
    for (let i = 0; i < SECTOR_BISECTION_ITERATIONS; i++) {
      const mid = (invalid + valid) / 2;
      if (validAt(mid)) valid = mid; else invalid = mid;
    }
    boundaryMag = valid;
  }

  // Clamp the desired outward magnitude into the valid interval [boundary, hi].
  const desiredMag = (desiredX - coxa.x) * outwardSign;
  const finalMag = Math.max(boundaryMag, Math.min(hiMag, desiredMag));
  return coxa.x + outwardSign * finalMag;
}

// ---------------------------------------------------------------------------
// computeHipPosition
// ---------------------------------------------------------------------------

/**
 * Compute the hip joint world position from body center, facing, and
 * the leg's rest-local offset.
 *
 * The hip sits on a circle of `hipRadius` around the body center, in the
 * direction determined by the rest-local vector (mirrored by facing).
 *
 * Pure, deterministic, never throws. Non-finite inputs fall back to safe defaults.
 */
export function computeHipPosition(
  bodyX: number,
  bodyY: number,
  facing: 1 | -1,
  restLocal: Vec2,
  geometry: SpiderLegGeometryConfig,
): Vec2 {
  const cx = safeNum(bodyX, 0);
  const cy = safeNum(bodyY, 0);
  const safeFacing: 1 | -1 = facing === -1 ? -1 : 1;
  const local = safeVec2(restLocal, 0, 0);
  const hipR = safePositive(geometry.hipRadius, 8);

  const localX = local.x * safeFacing;
  const localY = local.y;
  const localLen = Math.hypot(localX, localY);

  if (localLen < 1e-8) {
    return { x: cx, y: cy + hipR };
  }

  const nx = localX / localLen;
  const ny = localY / localLen;
  return { x: cx + nx * hipR, y: cy + ny * hipR };
}

// ---------------------------------------------------------------------------
// computeCoxaEndpoint — horizontal splay with small downward bias
// ---------------------------------------------------------------------------

/**
 * Compute the coxa (first segment) endpoint. The coxa extends from the hip
 * primarily HORIZONTALLY (anterior/posterior spread) with a small downward
 * bias ({@link COXA_VERTICAL_BIAS}), at exact `coxaLength`.
 *
 * Anterior legs (mirrored restLocalX > 0) fan forward; posterior legs
 * (mirrored restLocalX < 0) fan backward. The direction mirrors under facing.
 * Extending mostly horizontally preserves vertical reach so the femur/tibia
 * chain can arch down to the ground instead of being compressed against the
 * body.
 *
 * Pure, deterministic, never throws.
 */
export function computeCoxaEndpoint(
  hip: Vec2,
  facing: 1 | -1,
  restLocal: Vec2,
  geometry: SpiderLegGeometryConfig,
): Vec2 {
  const h = safeVec2(hip, 0, 0);
  const safeFacing: 1 | -1 = facing === -1 ? -1 : 1;
  const local = safeVec2(restLocal, 0, 0);
  const coxaLen = safePositive(geometry.coxaLength, 8);

  // Horizontal sign follows the mirrored rest-local X; a degenerate (zero)
  // rest-local falls back to facing so the coxa still splays outward.
  const mirroredX = local.x * safeFacing;
  const horizSign = Math.sign(mirroredX) || safeFacing;
  const dirLen = Math.hypot(horizSign, COXA_VERTICAL_BIAS);
  const dirX = horizSign / dirLen;
  const dirY = COXA_VERTICAL_BIAS / dirLen;

  return {
    x: h.x + dirX * coxaLen,
    y: h.y + dirY * coxaLen,
  };
}

// ---------------------------------------------------------------------------
// computeFemurTibiaAnnuli — jointSafetyMargin is in px
// ---------------------------------------------------------------------------

/**
 * Compute the femur+tibia annulus bounds from geometry config.
 *
 * `jointSafetyMargin` is in px (physical dead-zone):
 * - hardMin = |femur - tibia| + margin
 * - hardMax = femur + tibia - margin
 * - softMin = clamp(total * minExtensionRatio, hardMin, hardMax)
 * - softMax = clamp(total * maxExtensionRatio, hardMin, hardMax)
 *
 * Defensive: always guarantees hardMin <= softMin <= softMax <= hardMax.
 *
 * Pure, deterministic, never throws.
 */
export function computeFemurTibiaAnnuli(
  geometry: SpiderLegGeometryConfig,
): FemurTibiaAnnuli {
  const femurLen = safePositive(geometry.femurLength, 19);
  const tibiaLen = safePositive(geometry.tibiaLength, 21);
  const minRatio = safeNum(geometry.minExtensionRatio, 0.45);
  const maxRatio = safeNum(geometry.maxExtensionRatio, 0.94);
  const margin = safeNum(geometry.jointSafetyMargin, 0.5);

  const totalLen = femurLen + tibiaLen;
  const diffLen = Math.abs(femurLen - tibiaLen);

  const rawHardMin = diffLen + margin;
  const rawHardMax = totalLen - margin;

  const midHard = (rawHardMin + rawHardMax) / 2;
  const hardMin = Math.min(rawHardMin, midHard);
  const hardMax = Math.max(rawHardMax, midHard);

  const softMin = Math.max(hardMin, Math.min(hardMax, totalLen * minRatio));
  const softMax = Math.max(hardMin, Math.min(hardMax, totalLen * maxRatio));

  return {
    hardMin,
    softMin: Math.max(hardMin, softMin),
    softMax: Math.min(hardMax, Math.max(softMin, softMax)),
    hardMax,
  };
}

// ---------------------------------------------------------------------------
// projectTargetIntoWorkspace
// ---------------------------------------------------------------------------

/**
 * Project a foot target into the feasible femur+tibia workspace (soft annulus).
 *
 * Clamps the coxa-to-foot distance to [softMin, softMax] so every rendered
 * leg stays within the comfortable extension range [minExtensionRatio,
 * maxExtensionRatio]. This prevents trailing legs from stretching to near-
 * full extension while planted. The direction from coxa to target is preserved.
 *
 * Pure, deterministic, never throws.
 */
export function projectTargetIntoWorkspace(
  coxa: Vec2,
  target: Vec2,
  geometry: SpiderLegGeometryConfig,
): Vec2 {
  const c = safeVec2(coxa, 0, 0);
  const t = safeVec2(target, c.x, c.y);

  const dx = t.x - c.x;
  const dy = t.y - c.y;
  const dist = Math.hypot(dx, dy);

  const annuli = computeFemurTibiaAnnuli(geometry);

  if (dist < 1e-8) {
    return { x: c.x, y: c.y + annuli.softMin };
  }

  const nx = dx / dist;
  const ny = dy / dist;
  const clampedDist = Math.max(annuli.softMin, Math.min(annuli.softMax, dist));

  return {
    x: c.x + nx * clampedDist,
    y: c.y + ny * clampedDist,
  };
}

// ---------------------------------------------------------------------------
// projectGroundedTargetIntoWorkspace — restLocalX-aware tie-break
// ---------------------------------------------------------------------------

/**
 * Project a grounded foot target into a position that is BOTH radially feasible
 * and anatomically valid, preserving the sampled ground Y whenever possible.
 *
 * A target inside the radial annulus is not sufficient: it must also admit a
 * knee branch whose tibia advances outward (no folded-Z). The foot is moved
 * horizontally to the nearest outward X — soft annulus preferred, hard annulus
 * as fallback — that satisfies both. Ground Y is never sacrificed to reach the
 * sector while any valid X exists at that height; only when no X on the whole
 * outward ray works is Y clamped toward the coxa (caller then keeps the planted
 * foot rather than adopting a collapsed pose).
 *
 * The outward side is the leg's mirrored restLocalX direction (anterior legs
 * forward, posterior legs backward), so results mirror exactly under facing.
 *
 * Pure, deterministic, never throws.
 */
export function projectGroundedTargetIntoWorkspace(
  coxa: Vec2,
  target: Vec2,
  geometry: SpiderLegGeometryConfig,
  facing: 1 | -1,
  restLocalX: number,
): Vec2 {
  const c = safeVec2(coxa, 0, 0);
  const t = safeVec2(target, c.x, c.y);
  const safeFacing: 1 | -1 = facing === -1 ? -1 : 1;
  const annuli = computeFemurTibiaAnnuli(geometry);
  const femurLen = safePositive(geometry.femurLength, 19);
  const tibiaLen = safePositive(geometry.tibiaLength, 21);
  const minRatio = safeNum(geometry.minDistalAdvanceRatio, DEFAULT_MIN_DISTAL_ADVANCE_RATIO);
  const outwardSign = getLegOutwardSign(restLocalX, safeFacing);

  // Prefer the soft annulus, then fall back to the hard annulus. In both cases
  // require an anatomically valid knee branch at the chosen X.
  const soft = sectorFeasibleX(
    c, t.x, t.y, femurLen, tibiaLen, outwardSign, minRatio, annuli.softMin, annuli.softMax,
  );
  if (soft !== null) return { x: soft, y: t.y };

  const hard = sectorFeasibleX(
    c, t.x, t.y, femurLen, tibiaLen, outwardSign, minRatio, annuli.hardMin, annuli.hardMax,
  );
  if (hard !== null) return { x: hard, y: t.y };

  // No valid X at this ground height: clamp toward the coxa along the
  // outward-and-groundward direction at hardMax so the pose stays finite and
  // uncollapsed. Ground Y cannot be preserved here.
  const dy = t.y - c.y;
  const absDy = Math.abs(dy);
  if (absDy >= annuli.hardMax) {
    return { x: c.x, y: c.y + annuli.hardMax * Math.sign(dy || 1) };
  }
  const adx = Math.sqrt(Math.max(0, annuli.hardMax * annuli.hardMax - dy * dy));
  return { x: c.x + outwardSign * adx, y: t.y };
}

// ---------------------------------------------------------------------------
// computeLegStepRequest — structured result, absolute workspace validity
// ---------------------------------------------------------------------------

/**
 * Compute a structured step request for a leg.
 *
 * `needsStep` is true when:
 * - restError > comfortRadius (foot drifted from rest), OR
 * - coxa-foot distance is outside softMin/softMax (absolute workspace violation), OR
 * - the foot violates the anatomical sector (tibia folds back toward the body)
 *
 * Workspace and sector validity are absolute: an initially misconfigured or
 * terrain-shifted rest target must request recovery even if the foot is at its
 * rest position.
 *
 * Urgency ranks hard radial violations first, then anatomical fold violations,
 * then soft radial, then rest error, then stable index. No magic multipliers.
 *
 * Pure, deterministic, never throws.
 */
export function computeLegStepRequest(
  bodyX: number,
  bodyY: number,
  facing: 1 | -1,
  restLocal: Vec2,
  footPos: Vec2,
  geometry: SpiderLegGeometryConfig,
  comfortRadius: number,
): LegStepRequest {
  const bx = safeNum(bodyX, 0);
  const by = safeNum(bodyY, 0);
  const safeFacing: 1 | -1 = facing === -1 ? -1 : 1;
  const local = safeVec2(restLocal, 0, 0);
  const foot = safeVec2(footPos, bx, by);
  const safeComfort = safeNum(comfortRadius, 10);

  // Rest-error: distance from foot to rest world position
  const restX = bx + local.x * safeFacing;
  const restY = by + local.y;
  const restError = Math.hypot(foot.x - restX, foot.y - restY);

  // Workspace check: absolute — even at-rest feet outside soft annulus need recovery
  const hip = computeHipPosition(bx, by, safeFacing, local, geometry);
  const coxa = computeCoxaEndpoint(hip, safeFacing, local, geometry);
  const footDist = Math.hypot(foot.x - coxa.x, foot.y - coxa.y);
  const annuli = computeFemurTibiaAnnuli(geometry);

  const hardViolation = footDist < annuli.hardMin - 1e-8 || footDist > annuli.hardMax + 1e-8;

  let workspaceError = 0;
  if (footDist < annuli.softMin - 1e-8) {
    workspaceError = annuli.softMin - footDist;
  } else if (footDist > annuli.softMax + 1e-8) {
    workspaceError = footDist - annuli.softMax;
  }

  // Sector check: solve the planted foot's knee and measure the distal advance
  // shortfall. A folded-Z (tibia reversing toward the body) yields sectorError > 0.
  const femurLen = safePositive(geometry.femurLength, 19);
  const tibiaLen = safePositive(geometry.tibiaLength, 21);
  const minRatio = safeNum(geometry.minDistalAdvanceRatio, DEFAULT_MIN_DISTAL_ADVANCE_RATIO);
  const outwardSign = getLegOutwardSign(local.x, safeFacing);
  const knee = selectKneeBranch(
    coxa, foot, outwardSign, femurLen, tibiaLen, minRatio,
    // pole is only a tie-break here; a straight-up default suffices.
    0, -1,
  );
  const femurAdvance = (knee.x - coxa.x) * outwardSign;
  const distalAdvance = (foot.x - knee.x) * outwardSign;
  const safeMinRatio = Math.max(0, minRatio);
  const minFemur = femurLen * safeMinRatio;
  const minDistal = tibiaLen * safeMinRatio;
  const hasValidBranch = sectorValidAt(
    coxa, foot, outwardSign, femurLen, tibiaLen, minRatio,
  );
  const femurError = femurAdvance < minFemur ? minFemur - femurAdvance : 0;
  const distalError = distalAdvance < minDistal ? minDistal - distalAdvance : 0;
  // Renderer sector validity requires an outward tibia AND an upward knee.
  // Preserve a positive error when no branch satisfies both, even if the
  // selected branch's distal advance alone happens to pass.
  const sectorError = hasValidBranch
    ? 0
    : Math.max(femurError, distalError, SECTOR_VALIDITY_EPSILON * 2);

  // needsStep: rest drift, soft workspace violation, or anatomical fold
  const needsStep = restError > safeComfort || workspaceError > 0 || sectorError > 1e-8;

  // Urgency ranking (ordinal): hard radial > anatomical fold > soft radial > rest.
  const urgency = hardViolation ? 3 + workspaceError + sectorError + restError
    : sectorError > 1e-8 ? 2 + sectorError + restError
    : workspaceError > 0 ? 1 + workspaceError + restError
    : restError;

  return { needsStep, urgency, restError, workspaceError, sectorError, hardViolation };
}

// ---------------------------------------------------------------------------
// solveThreeSegmentLeg
// ---------------------------------------------------------------------------

/**
 * Solve the full three-segment spider leg IK: coxa + femur + tibia.
 *
 * Pipeline:
 * 1. Compute hip from body/facing/restLocal/hipRadius.
 * 2. Compute fixed coxa endpoint from hip using restLocal direction.
 * 3. Project target into the femur+tibia radial workspace, then into the
 *    anatomical sector (nearest outward X admitting an outward tibia).
 * 4. Select the knee branch: sector-satisfying, then upward, then nearest the
 *    anatomical pole (up + outward), with a stable tie-break.
 *
 * The sector projection is a visual fallback for transient targets (swing
 * interpolation, body turns); proactive gait requests should make it rare. Each
 * segment length remains at the configured length within floating tolerance.
 *
 * Pure, deterministic, never throws. All output coordinates are finite.
 */
export function solveThreeSegmentLeg(
  bodyX: number,
  bodyY: number,
  facing: 1 | -1,
  restLocal: Vec2,
  target: Vec2,
  geometry: SpiderLegGeometryConfig,
): {
  readonly hipX: number;
  readonly hipY: number;
  readonly coxaX: number;
  readonly coxaY: number;
  readonly kneeX: number;
  readonly kneeY: number;
  readonly footX: number;
  readonly footY: number;
} {
  const hip = computeHipPosition(bodyX, bodyY, facing, restLocal, geometry);
  const coxa = computeCoxaEndpoint(hip, facing, restLocal, geometry);
  const foot = projectTargetIntoWorkspace(coxa, target, geometry);

  const femurLen = safePositive(geometry.femurLength, 19);
  const tibiaLen = safePositive(geometry.tibiaLength, 21);
  const minRatio = safeNum(geometry.minDistalAdvanceRatio, DEFAULT_MIN_DISTAL_ADVANCE_RATIO);
  const safeFacing: 1 | -1 = facing === -1 ? -1 : 1;
  const local = safeVec2(restLocal, 0, 0);
  const outwardSign = getLegOutwardSign(local.x, safeFacing);

  // Anatomical pole: UPWARD (negative Y) plus an outward component along the
  // mirrored rest-local X, so knees arch above the body regardless of rest
  // angle. A degenerate rest-local yields a straight-up pole (0, -1).
  const mirroredX = local.x * safeFacing;
  const mirroredLen = Math.hypot(mirroredX, local.y);
  const normX = mirroredLen > 1e-8 ? mirroredX / mirroredLen : 0;
  const poleLen = Math.hypot(normX * femurLen, -femurLen);
  const poleNX = poleLen > 1e-8 ? (normX * femurLen) / poleLen : 0;
  const poleNY = poleLen > 1e-8 ? -femurLen / poleLen : -1;

  const knee = selectKneeBranch(
    coxa, foot, outwardSign, femurLen, tibiaLen, minRatio, poleNX, poleNY,
  );

  return {
    hipX: hip.x,
    hipY: hip.y,
    coxaX: coxa.x,
    coxaY: coxa.y,
    kneeX: knee.x,
    kneeY: knee.y,
    footX: foot.x,
    footY: foot.y,
  };
}
