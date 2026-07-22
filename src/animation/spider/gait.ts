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
   * Rest position X offset from body center (local space, facing=1).
   * Computed at creation: `footX - bodyX`. Used by `advanceGait` to
   * recompute the world-space rest position when the body moves.
   * When `facing=-1`, the world rest X = `bodyX + restLocalX * facing`.
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
  /** Per-leg rest positions (angle + distance). Length must match total legs. */
  readonly legRestPositions: readonly LegRestPosition[];
  /** Number of sub-sample steps when sampling ground downward (1 = simple, 3+ = thorough). */
  readonly groundSampleSteps: number;
  /** Scale factor for reduced-motion accessibility (0 = no animation, 1 = full). */
  readonly motionScale: number;
}

/**
 * Default max ground-sampling distance in px. Used when the caller does not
 * specify a limit. Roughly 4 tiles at 16px.
 */
const DEFAULT_GROUND_SAMPLE_MAX_DISTANCE = 60;

/**
 * Stagger fraction for coordinated mode's within-set rolling wave.
 * Each leg in a set activates at a different phase, with windows spaced
 * by `stagger * (setEnd - setStart)`. The window width is tuned so at
 * most 2 legs of the same set are swinging simultaneously.
 */
const COORDINATED_STAGGER_FRACTION = 0.4;

/**
 * Activation window width as a fraction of the set phase range.
 * Each leg's activation window is `[activationPhase, activationPhase + width]`.
 * The width is narrow enough that with the stagger, at most 2 legs overlap.
 * Width of 0.16 → ~0.5 rad at set range π. Stagger of 0.4 → ~1.26 rad spacing.
 * At overlap check: gap (0.4-0.16=0.24 of range ≈ 0.75 rad) > 0, so triple
 * overlap is avoided when the third leg activates after the first finishes.
 */
const COORDINATED_WINDOW_WIDTH = 0.16;

/**
 * Create initial gait state for N legs per side.
 *
 * Legs are arranged symmetrically. Each leg's rest position is set to the
 * provided world-space position. Rest offsets are computed from the initial
 * body position so `advanceGait` can recompute rest positions when the body
 * moves. Sets are assigned alternately: even indices → 'A', odd → 'B'.
 *
 * @param config - gait configuration (used for leg count validation)
 * @param legRestPositions - world-space initial rest positions for each leg
 * @param bodyX - initial body center X (used to compute rest offsets)
 * @param bodyY - initial body center Y (used to compute rest offsets)
 * @returns fresh {@link GaitState}
 */
export function createGaitState(
  _config: SpiderGaitConfig,
  legRestPositions: readonly Vec2[],
  bodyX: number = 0,
  bodyY: number = 0,
): GaitState {
  const safeBodyX = Number.isFinite(bodyX) ? bodyX : 0;
  const safeBodyY = Number.isFinite(bodyY) ? bodyY : 0;

  const legs: GaitLegState[] = legRestPositions.map((pos, i) => ({
    id: `L${i + 1}`,
    set: (i % 2 === 0 ? 'A' : 'B') as 'A' | 'B',
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
    restLocalX: pos.x - safeBodyX,
    restLocalY: pos.y - safeBodyY,
  }));
  return { legs, phase: 0 };
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
 * Pure reader. If the leg is planted, returns `footX`/`footY`. If swinging,
 * samples the quadratic Bezier arc at `stepPhase`.
 *
 * @param leg - leg state
 * @returns world-space foot position
 */
export function getGaitFootPosition(leg: GaitLegState): Vec2 {
  if (!leg.isSwinging || leg.stepPhase <= 0) {
    return { x: leg.footX, y: leg.footY };
  }
  return sampleStepArc(
    { x: leg.startX, y: leg.startY },
    { x: leg.midX, y: leg.midY },
    { x: leg.endX, y: leg.endY },
    leg.stepPhase,
  );
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
 * tucks toward the body (doesn't stretch infinitely).
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

  const safeFacing: 1 | -1 = facing === 1 || facing === -1 ? facing : 1;

  const speed = Math.sqrt(vx * vx + vy * vy);
  const newPhase = speed > 1
    ? (state.phase + speed * config.phaseAdvanceRate * dt) % (Math.PI * 2)
    : state.phase;

  const motionScale = Number.isFinite(config.motionScale) ? config.motionScale : 1;
  const effectiveStepHeight = config.stepHeight * motionScale;

  const newLegs: GaitLegState[] = [];
  const legCount = state.legs.length;

  for (let i = 0; i < legCount; i++) {
    const leg = state.legs[i];

    // Compute world-space rest position from stored local offsets.
    // restLocalX is relative to body at facing=1; multiply by facing for mirror.
    const restWorldX = bodyX + leg.restLocalX * safeFacing;
    const restWorldY = bodyY + leg.restLocalY;

    if (leg.isSwinging) {
      // Advance swing phase
      const newStepPhase = Math.min(1, leg.stepPhase + dt / config.stepDuration);
      if (newStepPhase >= 1) {
        // Plant the foot
        newLegs.push({
          ...leg,
          footX: leg.endX,
          footY: leg.endY,
          stepPhase: 0,
          isSwinging: false,
        });
      } else {
        // Interpolate along the step arc
        const pos = sampleStepArc(
          { x: leg.startX, y: leg.startY },
          { x: leg.midX, y: leg.midY },
          { x: leg.endX, y: leg.endY },
          newStepPhase,
        );
        newLegs.push({
          ...leg,
          footX: pos.x,
          footY: pos.y,
          stepPhase: newStepPhase,
        });
      }
    } else {
      // Check if this leg should start stepping
      let shouldStep = false;

      if (config.mode === 'coordinated') {
        // Coordinated mode: alternating tetrapod with within-set rolling wave.
        // Set A phase: [0, π), Set B phase: [π, 2π).
        // Each leg has a narrow activation WINDOW (not open-ended range)
        // so that at most 2 legs of the same set are swinging simultaneously.
        const setStart = leg.set === 'A' ? 0 : Math.PI;
        const setEnd = leg.set === 'A' ? Math.PI : Math.PI * 2;
        const setRange = setEnd - setStart;

        // Find this leg's position within its set
        const setLegIndices: number[] = [];
        for (let j = 0; j < legCount; j++) {
          if (state.legs[j].set === leg.set) {
            setLegIndices.push(j);
          }
        }
        const withinSetIndex = setLegIndices.indexOf(leg.index);

        const activationPhase = setStart + withinSetIndex * COORDINATED_STAGGER_FRACTION * setRange;
        const windowEnd = activationPhase + COORDINATED_WINDOW_WIDTH * setRange;
        const inWindow = newPhase >= activationPhase && newPhase < windowEnd;
        const inSet = newPhase >= setStart && newPhase < setEnd;
        shouldStep = inWindow && inSet && speed > 1;
      } else {
        // Frantic mode: free-stepping with neighbour-lock.
        // A leg does not start if an adjacent leg is already swinging.
        const prevIdx = (i - 1 + legCount) % legCount;
        const nextIdx = (i + 1) % legCount;
        const prevSwinging = state.legs[prevIdx].isSwinging;
        const nextSwinging = state.legs[nextIdx].isSwinging;
        shouldStep = !prevSwinging && !nextSwinging;
      }

      if (shouldStep) {
        // Check comfort radius
        const dx = restWorldX - leg.footX;
        const dy = restWorldY - leg.footY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > config.comfortRadius) {
          // Compute overshoot target
          const targetX = restWorldX + vx * config.overshootFactor;
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
            // Start a step arc
            const startX = leg.footX;
            const startY = leg.footY;
            const endX = ground.point.x;
            const endY = ground.point.y;

            newLegs.push({
              ...leg,
              stepPhase: 0.001,
              startX,
              startY,
              endX,
              endY,
              midX: (startX + endX) / 2,
              midY: Math.min(startY, endY) - effectiveStepHeight,
              isSwinging: true,
              footX: startX,
              footY: startY,
            });
            continue;
          } else {
            // Fail-safe: tuck foot toward body (don't stretch infinitely).
            // Move foot 30% toward body center, with a small downward offset.
            const tuckX = bodyX + (restWorldX - bodyX) * 0.3;
            const tuckY = bodyY + 5;
            newLegs.push({ ...leg, footX: tuckX, footY: tuckY });
            continue;
          }
        }
      }

      // No step triggered — keep leg as-is
      newLegs.push(leg);
    }
  }

  return { legs: newLegs, phase: newPhase };
}
