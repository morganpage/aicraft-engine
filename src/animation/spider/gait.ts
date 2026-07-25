/**
 * Deterministic gait solver for the procedural spider.
 *
 * Pure, tick/dt-driven, zero host access, zero `Math.random`. Advances an
 * alternating-tetrapod or frantic free-stepping gait, triggers foot steps
 * when the comfort radius is exceeded, and interpolates parabolic Bezier
 * step arcs.
 *
 * **Determinism contract.** Same `(state, bodyX, bodyY, vx, vy, facing, dt,
 * config, tileQuery, tileSize, tick)` → byte-identical output, forever.
 * No `Math.random`, no `Date.now()`, no global state, no DOM reads.
 *
 * **Purity.** Every public function returns a NEW object; inputs are never
 * mutated. Never throws.
 *
 * @module
 */

import type { Vec2 } from '../types';
import type { TileSolidityQuery } from '../../collision/types';
import { sampleGround } from './ground-sample';
import type { SpiderLegGeometryConfig } from './geometry';
import { computeLegStepRequest, computeHipPosition, computeCoxaEndpoint, projectGroundedTargetIntoWorkspace, type LegStepRequest } from './geometry';

/**
 * Spider gait mode.
 *
 * - `'coordinated'` — strict alternating tetrapod: Set A and Set B are 180°
 *   out of phase; within each set, legs step in a rolling wave (not all at
 *   once).
 * - `'frantic'` — free-stepping: each leg steps as soon as its comfort radius
 *   is exceeded, unless an adjacent leg (by index) is already swinging
 *   (neighbour-lock).
 */
export type SpiderGaitMode = 'coordinated' | 'frantic';

/**
 * Per-leg rest position definition (angle + distance from body center).
 */
export interface LegRestPosition {
  /** Angle in degrees from the +X axis (canvas convention: 90° = straight down). */
  readonly angle: number;
  /** Distance from body center in px. */
  readonly distance: number;
}

/**
 * Per-leg state within the gait solver. Pure data, no rendering concerns.
 */
export interface GaitLegState {
  /** Leg identifier (e.g. 'L1', 'R3'). */
  readonly id: string;
  /** Gait set assignment: 'A' or 'B' (for coordinated mode). */
  readonly set: 'A' | 'B';
  /** Current foot world X position. */
  readonly footX: number;
  /** Current foot world Y position. */
  readonly footY: number;
  /** Step animation phase in `[0, 1]`. 0 = planted, >0 = mid-step. */
  readonly stepPhase: number;
  /** Step arc start X (world). */
  readonly startX: number;
  /** Step arc start Y (world). */
  readonly startY: number;
  /** Step arc end X (world). */
  readonly endX: number;
  /** Step arc end Y (world). */
  readonly endY: number;
  /** Step arc mid X (world, lifted by stepHeight). */
  readonly midX: number;
  /** Step arc mid Y (world, lifted by stepHeight). */
  readonly midY: number;
  /** Whether this leg is currently in swing phase. */
  readonly isSwinging: boolean;
  /** Index in the legs array (for neighbour lookups). */
  readonly index: number;
  /**
   * Rest position X offset from body center (local space).
   * Computed at creation: `footX - bodyX`. Used by `advanceGait` to
   * recompute the world-space rest position when the body moves.
   * It remains stable when facing changes so planted feet do not swap sides.
   */
  readonly restLocalX: number;
  /**
   * Rest position Y offset from body center (local space).
   * Computed at creation: `footY - bodyY`. Not affected by facing.
   */
  readonly restLocalY: number;
}

/**
 * Gait solver state. Carried across ticks.
 *
 * This is **authoritative deterministic-core state** (persisted in
 * `EnemyState.data`, pure-clone progression, full TDD). It is NOT
 * renderer-caching: it is the input to the next {@link advanceGait}, not a
 * rederived cache.
 */
export interface GaitState {
  /** Per-leg states. Length = `legCount * 2`. */
  readonly legs: readonly GaitLegState[];
  /** Global gait phase in radians, `[0, 2π)`. */
  readonly phase: number;
  /** Facing used for the current leg-to-foot pairing. Missing legacy values imply +1. */
  readonly facing?: 1 | -1;
  /** Coordinated set currently being serviced. Missing legacy values derive from phase. */
  readonly activeSet?: 'A' | 'B';
  /** Leg indices already serviced during the current coordinated set activation. */
  readonly servicedLegs?: readonly number[];
}

/**
 * Gait solver configuration. Every tunable is a field — no magic numbers.
 */
export interface SpiderGaitConfig {
  /** Gait mode. */
  readonly mode: SpiderGaitMode;
  /** Number of legs per side. Total legs = `legCount * 2`. */
  readonly legCount: number;
  /** Comfort radius in px — foot must drift this far from rest before stepping. */
  readonly comfortRadius: number;
  /** Overshoot factor in `[0, 1]` — how far ahead of rest to step, scaled by velocity. */
  readonly overshootFactor: number;
  /** Step arc height in px. */
  readonly stepHeight: number;
  /** Step duration in seconds (time to complete one foot lift-and-plant). */
  readonly stepDuration: number;
  /** Phase advance rate for coordinated mode (radians per unit speed per tick). */
  readonly phaseAdvanceRate: number;
  /** Per-side leg rest positions (angle + distance). */
  readonly legRestPositions: readonly LegRestPosition[];
  /** Number of sub-sample steps when sampling ground downward (1 = simple, 3+ = thorough). */
  readonly groundSampleSteps: number;
  /** Scale factor for reduced-motion accessibility (0 = no animation, 1 = full). */
  readonly motionScale: number;
  /** Shared leg geometry config (three-segment coxa/femur/tibia). */
  readonly geometry: SpiderLegGeometryConfig;
}

/**
 * Default max ground-sampling distance in px. Used when the caller does not
 * specify a limit. Roughly 4 tiles at 16px.
 */
const DEFAULT_GROUND_SAMPLE_MAX_DISTANCE = 60;

/**
 * Epsilon for anatomical sector-error detection (a folded tibia). Matches the
 * threshold used in {@link computeLegStepRequest} so a leg is classified as
 * critical here for exactly the error magnitude that marks it invalid there.
 */
const SECTOR_EPSILON = 1e-8;

/**
 * Create initial gait state for N legs per side.
 *
 * Legs are arranged symmetrically. Each leg's rest position is set to the
 * provided world-space position. Rest offsets are computed from the initial
 * body position so `advanceGait` can recompute rest positions when the body
 * moves. Each side alternates sets, with the mirrored side using the opposite
 * pattern to form a stable tetrapod gait.
 *
 * @param config - gait configuration (used for leg count validation)
 * @param legRestPositions - world-space initial rest positions for each leg
 * @param bodyX - initial body center X (used to compute rest offsets)
 * @param bodyY - initial body center Y (used to compute rest offsets)
 * @param initialFacing - facing used to canonicalize mirrored rest offsets
 * @returns fresh {@link GaitState}
 */
export function createGaitState(
  config: SpiderGaitConfig,
  legRestPositions: readonly Vec2[],
  bodyX: number = 0,
  bodyY: number = 0,
  initialFacing: 1 | -1 = 1,
): GaitState {
  const safeBodyX = Number.isFinite(bodyX) ? bodyX : 0;
  const safeBodyY = Number.isFinite(bodyY) ? bodyY : 0;
  const safeFacing: 1 | -1 = initialFacing === -1 ? -1 : 1;
  const legsPerSide = Number.isFinite(config.legCount) && config.legCount > 0
    ? Math.max(1, Math.floor(config.legCount))
    : Math.max(1, Math.ceil(legRestPositions.length / 2));

  const legs: GaitLegState[] = legRestPositions.map((pos, i) => {
    const sideIndex = Math.floor(i / legsPerSide);
    const indexWithinSide = i % legsPerSide;
    return {
      id: `L${i + 1}`,
      set: ((sideIndex + indexWithinSide) % 2 === 0 ? 'A' : 'B') as 'A' | 'B',
      footX: pos.x,
      footY: pos.y,
      stepPhase: 0,
      startX: pos.x,
      startY: pos.y,
      endX: pos.x,
      endY: pos.y,
      midX: pos.x,
      midY: pos.y,
      isSwinging: false,
      index: i,
      restLocalX: (pos.x - safeBodyX) * safeFacing,
      restLocalY: pos.y - safeBodyY,
    };
  });
  return { legs, phase: 0, facing: safeFacing, activeSet: 'A', servicedLegs: [] };
}

/**
 * Quadratic Bezier sample for parabolic step arc.
 *
 * Computes `B(t) = (1-t)²·start + 2(1-t)t·mid + t²·end`.
 *
 * Pure: same `(start, mid, end, t)` → same output. Never throws.
 * Non-finite `t` clamps to `[0, 1]`.
 *
 * @param start - arc start point (world)
 * @param mid - arc midpoint (world, lifted)
 * @param end - arc endpoint (world)
 * @param t - interpolation parameter in `[0, 1]`
 * @returns interpolated point on the quadratic Bezier curve
 */
export function sampleStepArc(start: Vec2, mid: Vec2, end: Vec2, t: number): Vec2 {
  const tc = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const mt = 1 - tc;
  return {
    x: mt * mt * start.x + 2 * mt * tc * mid.x + tc * tc * end.x,
    y: mt * mt * start.y + 2 * mt * tc * mid.y + tc * tc * end.y,
  };
}

/**
 * Get the current foot world position for a leg.
 *
 * Pure reader. Returns the authoritative stored `footX`/`footY`. For a
 * planted leg this is its world-locked plant point; for a swinging leg it is
 * the sector-projected Bezier sample stored each tick by {@link advanceGait}
 * (see swing progression). Because that stored swing position is placed on the
 * soft femur+tibia annulus via {@link projectGroundedTargetIntoWorkspace}, it
 * is already at or outside the hard annulus, so a renderer that re-projects it
 * through {@link solveThreeSegmentLeg} applies a near-identity correction —
 * keeping gait/render geometry in agreement without renderer feedback.
 *
 * Callers that need the raw (pre-projection) Bezier sample for an in-flight
 * swing can call {@link sampleStepArc} directly with the leg's arc fields.
 *
 * @param leg - leg state
 * @returns world-space foot position (stored authoritative foot)
 */
export function getGaitFootPosition(leg: GaitLegState): Vec2 {
  return { x: leg.footX, y: leg.footY };
}

/**
 * Advance the gait solver by one tick. Pure, deterministic, never throws.
 *
 * **Coordinated mode:** Set A legs step while Set B are planted (180°
 * phase offset). Within each set, legs are phase-offset so they step in
 * sequence (rolling wave), not all at once.
 *
 * **Frantic mode:** each leg steps independently when comfort radius is
 * exceeded, unless an adjacent leg (by index) is already swinging
 * (neighbour-lock).
 *
 * Step arcs are quadratic Bezier (`start` → `mid` → `end`) sampled by
 * `stepPhase`.
 *
 * Ground sampling is **lazy**: `sampleGround` is called ONLY for legs whose
 * comfort-radius check triggers a step this tick. For v1, the sampling
 * direction is hard-coded downward `{x:0, y:1}` (floor-only scope). Future
 * wall/ceiling support is a non-breaking config-field strategy — NOT built
 * now.
 *
 * **Fail-safe:** if `sampleGround` returns `hasGround: false`, the foot
 * stays planted at its current position (non-collapsing deterministic behavior).
 *
 * **Idle recovery:** workspace violations are detected at all times (including
 * idle) using the same geometry, allowing feet to replant when the body moves
 * without requiring speed > 1.
 *
 * @param state - current gait state (fresh copy returned; input not mutated)
 * @param bodyX - body center X in world space
 * @param bodyY - body center Y in world space
 * @param vx - body horizontal velocity in px/s
 * @param vy - body vertical velocity in px/s
 * @param facing - +1 right, -1 left
 * @param dt - fixed timestep in seconds
 * @param config - gait configuration
 * @param tileQuery - tile solidity query (pure, no host access)
 * @param tileSize - tile grid cell size in px
 * @param tick - current simulation tick
 * @returns fresh {@link GaitState}
 */
export function advanceGait(
  state: GaitState,
  bodyX: number,
  bodyY: number,
  vx: number,
  vy: number,
  facing: 1 | -1,
  dt: number,
  config: SpiderGaitConfig,
  tileQuery: TileSolidityQuery,
  tileSize: number,
  _tick: number,
): GaitState {
  // Defensive: degenerate inputs → safe defaults.
  if (!Number.isFinite(bodyX)) bodyX = 0;
  if (!Number.isFinite(bodyY)) bodyY = 0;
  if (!Number.isFinite(vx)) vx = 0;
  if (!Number.isFinite(vy)) vy = 0;
  if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
  if (!Number.isFinite(tileSize) || tileSize <= 0) tileSize = 16;

  const safeFacing: 1 | -1 = facing === -1 ? -1 : 1;
  const previousFacing: 1 | -1 = state.facing === -1 ? -1 : 1;
  const facingChanged = safeFacing !== previousFacing;
  const sideCount = Math.floor(state.legs.length / 2);
  // Facing reversal: remap legs to their anatomical partners (front↔rear within
  // each side) and REBASE every mapped leg as planted. Old-facing swing arc
  // fields (start/mid/end/stepPhase/isSwinging) are never copied through — the
  // next tick's critical recovery builds a fresh new-facing arc from the
  // rebased planted foot. A swinging partner's stored Y is a lifted arc height,
  // not the floor, so such rebases are re-grounded; planted partners keep their
  // world Y (world-lock). The rebased foot is projected into the NEW-facing
  // sector so it does not fold immediately on the turn.
  const sourceLegs = !facingChanged || sideCount === 0
    ? state.legs
    : state.legs.map((leg, index) => {
        const groundAt = (x: number, fallbackY: number): number => {
          const g = sampleGround(
            x, bodyY, 0, 1, DEFAULT_GROUND_SAMPLE_MAX_DISTANCE, tileSize, tileQuery,
          );
          return g.hasGround ? g.point.y : fallbackY;
        };
        if (sideCount === 1) {
          // One-leg-per-side: no anatomical partner, so mirror each foot's X
          // across the body and rebase planted. X stays an exact mirror (no
          // sector projection) so the one-leg-per-side mirror contract holds.
          // Re-ground only if this leg was mid-swing (lifted Y); planted legs
          // keep their world Y. Deterministic mirror.
          const cur = getGaitFootPosition(leg);
          const mx = bodyX - (cur.x - bodyX);
          const my = leg.isSwinging ? groundAt(mx, cur.y) : cur.y;
          return {
            ...leg,
            footX: mx,
            footY: my,
            startX: mx,
            startY: my,
            endX: mx,
            endY: my,
            midX: mx,
            midY: my,
            stepPhase: 0,
            isSwinging: false,
          };
        }
        const sideStart = index < sideCount ? 0 : sideCount;
        const ordinal = index - sideStart;
        const partner = state.legs[sideStart + sideCount - 1 - ordinal];
        // The partner's current authoritative position becomes this leg's
        // rebased planted foot. A PLANTED partner whose position stays
        // sector-valid under the new facing keeps its exact world point
        // (world-lock through the anatomical remap). A SWINGING partner (stored
        // position is an old-facing arc sample with a lifted Y) or a planted
        // partner whose position would fold/hard-violate under the new facing
        // is re-grounded to the floor and projected into the new-facing sector
        // (gait geometry) so critical recovery can build a fresh new-facing arc
        // from a valid start. The leg's partner pairing is unchanged; only an
        // invalid/swinging foot is relocated.
        const cur = getGaitFootPosition(partner);
        let rx = cur.x;
        let ry = cur.y;
        const newFacingReq = computeLegStepRequest(
          bodyX, bodyY, safeFacing,
          { x: leg.restLocalX, y: leg.restLocalY },
          cur, config.geometry, config.comfortRadius,
        );
        const partnerInvalid = partner.isSwinging
          || newFacingReq.sectorError > SECTOR_EPSILON
          || newFacingReq.hardViolation;
        if (partnerInvalid) {
          const restLocalVec = { x: leg.restLocalX, y: leg.restLocalY };
          const hip = computeHipPosition(bodyX, bodyY, safeFacing, restLocalVec, config.geometry);
          const coxa = computeCoxaEndpoint(hip, safeFacing, restLocalVec, config.geometry);
          const floorY = partner.isSwinging ? groundAt(cur.x, cur.y) : cur.y;
          const authoredRestX = bodyX + leg.restLocalX * safeFacing;
          const rebased = projectGroundedTargetIntoWorkspace(
            coxa, { x: authoredRestX, y: floorY }, config.geometry, safeFacing, leg.restLocalX,
          );
          rx = rebased.x;
          ry = rebased.y;
        }
        return {
          ...leg,
          footX: rx,
          footY: ry,
          startX: rx,
          startY: ry,
          endX: rx,
          endY: ry,
          midX: rx,
          midY: ry,
          stepPhase: 0,
          isSwinging: false,
        };
      });

  const speed = Math.sqrt(vx * vx + vy * vy);
  const newPhase = speed > 0.01
    ? (state.phase + speed * config.phaseAdvanceRate * dt) % (Math.PI * 2)
    : state.phase;
  const desiredSet: 'A' | 'B' = newPhase < Math.PI ? 'A' : 'B';

  // Unified per-leg step request: compute structured result for each planted
  // leg using the exact renderer geometry (coxa endpoint, annuli).
  const geometry = config.geometry;

  // Predict one swing duration ahead for both urgency and landing placement.
  // Critical-set scheduling below handles service latency; looking farther
  // ahead here over-prioritizes distant targets and can starve nearer plants.
  const safeStepDuration = Number.isFinite(config.stepDuration) ? config.stepDuration : 0.18;
  const predictedBodyX = bodyX + vx * safeStepDuration;
  const predictedBodyY = bodyY + vy * safeStepDuration;

  // Cache each leg's predicted step request once (predicted = where the body
  // will sit at step completion, so urgency reflects the post-step comfort
  // state). The cache drives the global urgency ranking, the critical-violation
  // scan below, the active-set service check, and the coordinated fallback —
  // eliminating the previous O(n^2) per-candidate recomputation.
  const predictedReqs: LegStepRequest[] = new Array(sourceLegs.length);
  let highestUrgencyIndex = -1;
  let highestUrgency = -1;
  let anyNeedsStep = false;
  // Critical candidate: a PLANTED leg with a hard radial violation OR an
  // anatomical sector fold (tibia reversing toward the body). Selected across
  // BOTH gait sets so a folded leg is never starved by minor drift in the
  // currently-active set. Highest urgency wins; stable lowest-index tie-break.
  let criticalIndex = -1;
  let criticalUrgency = -1;
  for (let ci = 0; ci < sourceLegs.length; ci++) {
    const candidate = sourceLegs[ci];
    const footPos = { x: candidate.footX, y: candidate.footY };
    const restLocal = { x: candidate.restLocalX, y: candidate.restLocalY };
    const req = computeLegStepRequest(
      predictedBodyX, predictedBodyY, safeFacing, restLocal, footPos, geometry, config.comfortRadius,
    );
    predictedReqs[ci] = req;
    if (candidate.isSwinging) continue;
    if (req.needsStep) anyNeedsStep = true;
    if (req.urgency > highestUrgency) {
      highestUrgency = req.urgency;
      highestUrgencyIndex = ci;
    }
    if (req.hardViolation || req.sectorError > SECTOR_EPSILON || req.workspaceError > SECTOR_EPSILON) {
      if (req.urgency > criticalUrgency) {
        criticalUrgency = req.urgency;
        criticalIndex = ci;
      }
    }
  }

  const previousActiveSet: 'A' | 'B' = state.activeSet ??
    (state.phase < Math.PI ? 'A' : 'B');
  // A facing reversal invalidates the old set-activation bookkeeping: the
  // rebased legs no longer correspond to the previously-serviced indices, and
  // any rebased sector-invalid leg must be reachable by critical recovery this
  // tick. Clear stale servicedLegs so the active-set handoff starts clean and
  // the active set can route to critical recovery.
  const storedServiced = facingChanged ? [] : (state.servicedLegs ?? []);
  const previousServiced = config.mode === 'coordinated'
    ? storedServiced.filter((index) => sourceLegs[index]?.set === previousActiveSet)
    : storedServiced;
  const previousSetNeedsService = sourceLegs.some((candidate) => {
    if (candidate.set !== previousActiveSet) return false;
    if (candidate.isSwinging) return true;
    if (previousServiced.includes(candidate.index)) return false;
    return predictedReqs[candidate.index].needsStep;
  });
  const previousSetWasServiced = previousServiced.some((index) =>
    sourceLegs[index]?.set === previousActiveSet,
  );
  const phaseActiveSet = previousSetNeedsService
    ? previousActiveSet
    : previousSetWasServiced
      ? (previousActiveSet === 'A' ? 'B' : 'A')
      : desiredSet;
  const currentSwingingCount = sourceLegs.filter((c) => c.isSwinging).length;
  // Critical eligibility — a critical leg (over-extended or folded) may step
  // bypassing active-set and maxSwinging, but still respects pair-lock (its
  // corresponding near/far partner must be planted) and a 5/8 support ceiling.
  let criticalEligible = false;
  if (criticalIndex >= 0) {
    const cPairIndex = sideCount > 0
      ? (criticalIndex < sideCount ? criticalIndex + sideCount : criticalIndex - sideCount)
      : -1;
    const cPairSwinging = cPairIndex >= 0 && sourceLegs[cPairIndex]?.isSwinging === true;
    criticalEligible = !cPairSwinging && currentSwingingCount < Math.floor(sourceLegs.length * 0.625);
  }
  // When a critical leg can step, route the active set to it so servicing
  // proceeds as a proper rolling wave within its own set (avoiding the
  // single-leg cross-set disruption). This overrides ordinary active-set
  // continuation even when the previous set still carries ordinary drift.
  const criticalOverrideSet = criticalEligible ? sourceLegs[criticalIndex].set : null;
  // Highest-urgency leg gets priority regardless of set
  const coordinatedActiveSet = criticalOverrideSet
    ?? (anyNeedsStep && currentSwingingCount === 0 && !previousSetNeedsService
      ? sourceLegs[highestUrgencyIndex].set
      : phaseActiveSet);
  const nextServiced = config.mode === 'frantic'
    ? previousServiced.length >= sourceLegs.length ? [] : [...previousServiced]
    : coordinatedActiveSet === previousActiveSet
      ? [...previousServiced]
      : [];

  const motionScale = Number.isFinite(config.motionScale) ? config.motionScale : 1;
  const effectiveStepHeight = config.stepHeight * motionScale;

  const newLegs: GaitLegState[] = [];
  const legCount = sourceLegs.length;
  let startedThisTick = false;

  for (let i = 0; i < legCount; i++) {
    const leg = sourceLegs[i];

    const restWorldX = bodyX + leg.restLocalX * safeFacing;
    const restWorldY = bodyY + leg.restLocalY;

    if (leg.isSwinging) {
      // Advance swing phase
      const newStepPhase = Math.min(1, leg.stepPhase + dt / config.stepDuration);
      if (newStepPhase >= 1) {
        // Plant the foot at the sector-valid, floor-grounded landing target.
        newLegs.push({
          ...leg,
          footX: leg.endX,
          footY: leg.endY,
          stepPhase: 0,
          isSwinging: false,
        });
      } else {
        // Store the raw Bezier position. The renderer's solveThreeSegmentLeg
        // already projects into the valid workspace; projecting here through
        // projectGroundedTargetIntoWorkspace distorts the arc by up to 6px on
        // small steps, producing the visual "skating" effect where feet slide
        // sideways instead of following a natural lift-and-plant trajectory.
        const raw = sampleStepArc(
          { x: leg.startX, y: leg.startY },
          { x: leg.midX, y: leg.midY },
          { x: leg.endX, y: leg.endY },
          newStepPhase,
        );
        newLegs.push({
          ...leg,
          footX: raw.x,
          footY: raw.y,
          stepPhase: newStepPhase,
        });
      }
    } else {
      // Check if this leg should start stepping
      let shouldStep = false;
      const totalSwinging = sourceLegs.filter((candidate) => candidate.isSwinging).length;
      const maxSwinging = Math.max(3, Math.floor(legCount / 3));
      const pairIndex = i < sideCount ? i + sideCount : i - sideCount;
      const pairSwinging = sideCount > 0 && sourceLegs[pairIndex]?.isSwinging === true;

      if (config.mode === 'coordinated') {
        // Start the most overdue planted leg in the active set. A stable index
        // tie-break keeps the rolling wave deterministic without phase-window
        // starvation at high speed.
        //
        // Critical bypass: the single highest-urgency critical candidate (hard
        // radial or anatomical sector violation) is allowed past the active-set
        // and servicedLegs filters so a folded leg is recovered within a
        // bounded window even when the opposite set perpetually carries minor
        // drift. The bypass never skips the corresponding-pair lock, the
        // opposite-set swing exclusion, the maxSwinging cap, or one-start-per-
        // tick; ordinary candidates keep their normal alternating/fair behavior.
        const activeSet = coordinatedActiveSet;
        const oppositeSetSwinging = sourceLegs.some(
          (candidate) => candidate.set !== activeSet && candidate.isSwinging,
        );
        let overdueIndex = -1;
        let overdueUrgency = -1;
        let selectedUrgent = false;
        for (const candidate of sourceLegs) {
          if (candidate.isSwinging) continue;
          const isCriticalBypass = candidate.index === criticalIndex && criticalEligible;
          if (!isCriticalBypass) {
            if (candidate.set !== activeSet) continue;
            if (nextServiced.includes(candidate.index)) continue;
          }
          const candidatePair = candidate.index < sideCount
            ? candidate.index + sideCount
            : candidate.index - sideCount;
          if (sideCount > 0 && sourceLegs[candidatePair]?.isSwinging) continue;
          // Highest urgency leg gets priority
          if (candidate.index === highestUrgencyIndex && anyNeedsStep) {
            overdueIndex = candidate.index;
            selectedUrgent = true;
            continue;
          }
          if (selectedUrgent) continue;
          // Fallback: most overdue by cached predicted step request
          const req = predictedReqs[candidate.index];
          if (req.urgency > overdueUrgency) {
            overdueUrgency = req.urgency;
            overdueIndex = candidate.index;
          }
        }
        // The critical candidate preempts ordinary selection so the folded leg
        // is serviced this tick (or as soon as its support locks clear). It can
        // be reselected on later ticks if it remains invalid after a completed
        // or failed attempt; the no-ground fail-safe keeps the foot planted so
        // there is no spin or mutation.
        if (criticalIndex >= 0 && criticalEligible) {
          overdueIndex = criticalIndex;
        }
        const selectedIsCritical = criticalEligible &&
          leg.index === criticalIndex && leg.index === overdueIndex;
        // No speed>1 gate — idle recovery is allowed
        shouldStep = leg.index === overdueIndex &&
          (selectedIsCritical || !startedThisTick) &&
          (selectedIsCritical || (!pairSwinging && totalSwinging < maxSwinging && leg.set === activeSet && !oppositeSetSwinging));
      } else {
        // Frantic mode remains independent but respects side-neighbour,
        // corresponding-pair, and total support locks.
        let overdueIndex = -1;
        let overdueUrgency = -1;
        let selectedUrgent = false;
        for (const candidate of sourceLegs) {
          if (candidate.isSwinging) continue;
          // Critical bypass: over-extended/folded legs skip neighbour, pair,
          // AND serviced filters so they step immediately.
          const isCriticalCandidate = candidate.index === criticalIndex && criticalEligible;
          if (!isCriticalCandidate && nextServiced.includes(candidate.index)) continue;
          if (isCriticalCandidate) {
            overdueIndex = candidate.index;
            selectedUrgent = true;
            continue;
          }
          if (!isCriticalCandidate) {
            const candidateSideStart = candidate.index < sideCount ? 0 : sideCount;
            const ordinal = candidate.index - candidateSideStart;
            const prevIndex = ordinal > 0 ? candidate.index - 1 : -1;
            const nextIndex = ordinal + 1 < sideCount ? candidate.index + 1 : -1;
            const candidatePair = candidate.index < sideCount
              ? candidate.index + sideCount
              : candidate.index - sideCount;
            if ((prevIndex >= 0 && sourceLegs[prevIndex].isSwinging) ||
                (nextIndex >= 0 && sourceLegs[nextIndex].isSwinging) ||
                (sideCount > 0 && sourceLegs[candidatePair]?.isSwinging)) {
              continue;
            }
          }
          // Highest urgency leg gets priority
          if (candidate.index === highestUrgencyIndex && anyNeedsStep) {
            overdueIndex = candidate.index;
            selectedUrgent = true;
            continue;
          }
          if (selectedUrgent) continue;
          // Fallback: most overdue by step request
          const footPos = { x: candidate.footX, y: candidate.footY };
          const restLocal = { x: candidate.restLocalX, y: candidate.restLocalY };
          const req = computeLegStepRequest(
            bodyX, bodyY, safeFacing, restLocal, footPos, geometry, config.comfortRadius,
          );
          if (req.urgency > overdueUrgency) {
            overdueUrgency = req.urgency;
            overdueIndex = candidate.index;
          }
        }
        // No speed>1 gate — idle recovery is allowed
        const franticIsCritical = criticalEligible &&
          leg.index === criticalIndex && leg.index === overdueIndex;
        shouldStep = leg.index === overdueIndex &&
          (franticIsCritical || (!pairSwinging && totalSwinging < maxSwinging && !startedThisTick));
      }

      if (shouldStep) {
        // Check if this leg actually needs to step using structured request
        const footPos = { x: leg.footX, y: leg.footY };
        const restLocal = { x: leg.restLocalX, y: leg.restLocalY };
        const req = computeLegStepRequest(
          bodyX, bodyY, safeFacing, restLocal, footPos, geometry, config.comfortRadius,
        );

        if (req.needsStep) {
          // Extension-aware overshoot: legs that are currently compressed
          // (low coxa-to-foot ratio) get a larger forward correction so they
          // decompress; extended legs get less so they recompress. This
          // equalizes step sizes and prevents the shuffling cycle where a
          // compressed leg takes tiny steps and never reaches mid-extension.
          const restLocalVec = { x: leg.restLocalX, y: leg.restLocalY };
          const stepCoxa = computeCoxaEndpoint(
            computeHipPosition(bodyX, bodyY, safeFacing, restLocalVec, geometry),
            safeFacing, restLocalVec, geometry,
          );
          const coxaToFoot = Math.hypot(leg.footX - stepCoxa.x, leg.footY - stepCoxa.y);
          const totalFemurTibia = geometry.femurLength + geometry.tibiaLength;
          const currentRatio = totalFemurTibia > 0 ? coxaToFoot / totalFemurTibia : 0;
          const midRatio = (geometry.minExtensionRatio + geometry.maxExtensionRatio) / 2;
          const deficit = midRatio - currentRatio;
          const velocityOvershoot = vx * config.overshootFactor;
          // Clamp correction: compressed legs get extra forward push, but
          // extended legs can't push the target behind rest (no backward
          // steps). This prevents the "lift and come down without stepping
          // forward" defect.
          const maxNegativeCorrection = Math.min(0, velocityOvershoot);
          const rawCorrection = deficit * totalFemurTibia * safeFacing;
          const extensionCorrection = rawCorrection < maxNegativeCorrection
            ? maxNegativeCorrection
            : rawCorrection;

          // Compute overshoot target with extension correction
          const targetX = restWorldX + velocityOvershoot + extensionCorrection;
          const targetY = restWorldY + vy * config.overshootFactor;

          // Lazy ground sampling (downward only, v1)
          const ground = sampleGround(
            targetX,
            targetY,
            0,
            1,
            DEFAULT_GROUND_SAMPLE_MAX_DISTANCE,
            tileSize,
            tileQuery,
          );

          if (ground.hasGround) {
            // Landing target: floor-grounded (preserves ground.point.y) and
            // sector-valid at the predicted landing-time coxa (stepDuration
            // ahead), so the swing end is anatomically reachable on plant.
            const landingCoxa = computeCoxaEndpoint(
              computeHipPosition(predictedBodyX, predictedBodyY, safeFacing, restLocalVec, geometry),
              safeFacing, restLocalVec, geometry,
            );
            const projectedEnd = projectGroundedTargetIntoWorkspace(
              landingCoxa, ground.point, geometry, safeFacing, leg.restLocalX,
            );

            // Current-time coxa (stepCoxa already computed above for the
            // extension-aware overshoot), used to project the arc's start
            // into the sector so first swing samples do not retain a large
            // renderer correction.
            const projectedStart = projectGroundedTargetIntoWorkspace(
              stepCoxa, { x: leg.footX, y: leg.footY }, geometry, safeFacing, leg.restLocalX,
            );
            const startX = projectedStart.x;
            const startY = projectedStart.y;
            const endX = projectedEnd.x;
            const endY = projectedEnd.y;

            // Outward-aware arc: lift the apex by stepHeight. (mid projection
            // temporarily disabled for diagnosis.)
            const liftY = Math.min(startY, endY) - effectiveStepHeight;
            const midX = (startX + endX) / 2;
            const midY = liftY;

            newLegs.push({
              ...leg,
              stepPhase: 0.001,
              startX,
              startY,
              endX,
              endY,
              midX,
              midY,
              isSwinging: true,
              footX: startX,
              footY: startY,
            });
            if (!nextServiced.includes(leg.index)) {
              nextServiced.push(leg.index);
            }
            startedThisTick = true;
            continue;
          } else {
            // Fail-safe: keep foot planted at its current position
            // (non-collapsing deterministic behavior — no dangerous teleport)
            newLegs.push(leg);
            if (!nextServiced.includes(leg.index)) {
              nextServiced.push(leg.index);
            }
            startedThisTick = true;
            continue;
          }
        }
      }

      // Planted feet are world-locked. Do not rebase them — sliding a
      // planted foot every tick to chase a sector-valid position looks
      // visually worse than letting the renderer's radial clamping handle
      // a brief over-extension. The step scheduler will eventually service
      // the foot through a proper swing.
      newLegs.push(leg);
    }
  }

  return {
    legs: newLegs,
    phase: newPhase,
    facing: safeFacing,
    activeSet: config.mode === 'coordinated' ? coordinatedActiveSet : desiredSet,
    servicedLegs: nextServiced,
  };
}
