/**
 * Stable springy-rod primitive — a unified, blowout-proof solver for
 * secondary-dynamics rods (antennae, tails, manes, capes). Combines Verlet
 * integration + PBD distance constraints + Provot next-nearest-neighbor bend
 * constraints + a directional rest-pose spring + a tapered tip-weight nudge in
 * a single function, with structural stability guards baked in.
 *
 * **Why this exists.** `advanceSpringChain` enforces only adjacent-node
 * distances, so a chain buckles, kinks, and — under extreme conditions
 * (teleport, lag spike, violent anchor motion) — numerically blows out,
 * painting a "line covering half the screen." The showcase's good antenna
 * exists only because `showcase/helpers/slime-knight.ts` layers three local
 * corrections (`applyAntennaBendConstraints`, `applyAntennaRestPose`,
 * `applyAntennaTipWeight`) on top — production-quality code that no other
 * consumer gets, allocated 4 arrays per frame, and easy to compose in the
 * wrong order. This module ships the same math as a single pure call.
 *
 * **The blowout-proof contract (NON-OPTIONAL).** Every call runs:
 *   1. Epsilon-guarded division: any `|delta| < 1e-4` falls back to the rest
 *      direction as the unit vector and treats the distance as `1e-4`, so
 *      division-by-near-zero cannot amplify a correction to astronomical
 *      coordinates.
 *   2. Implicit velocity clamping: each node's `(curr - prev)` is clamped to
 *      `±5 * segmentLength` per sub-step, so a single-frame teleport cannot
 *      impart a permanent whip velocity.
 *   3. Strain limiting: after constraints, any adjacent distance greater than
 *      `1.5 * segmentLength` is hard-clamped along the segment vector.
 *   4. NaN/Infinity reset: if any coordinate is non-finite after solving, the
 *      entire chain is rebuilt along `restDirection` off the anchor at rest
 *      (zero velocity). A blowout cannot persist for more than one frame.
 *
 * These guards are structural — they cannot be disabled via config. They are
 * the reason this primitive exists.
 *
 * **Determinism contract.** Same `(nodes, anchorX, anchorY, dt, config)` →
 * byte-identical output, forever. No `Math.random`, no `Date.now()`, no global
 * state, no DOM reads. The caller owns the fixed-timestep accumulator (same
 * convention as `advanceSpringChain`): pass a constant `dt` (e.g. `1` at
 * 60 Hz, or `1/60`).
 *
 * **Purity.** `advanceSpringRod` returns a NEW array of NEW `VerletNode`
 * objects; the input array and its nodes are never mutated. Never throws.
 *
 * @see docs/design/spring-rod-proposal.md — approved design (Approach A).
 * @see docs/research/springy-rod.md — prior-art menu + stability techniques.
 * @see showcase/helpers/slime-knight.ts — the showcase pipeline this replaces.
 */

import type { Vec2 } from './types';
import type { VerletNode } from './spring';

/**
 * Minimum distance used in any division. Below this, the solver substitutes a
 * fallback unit vector (the rest direction) and uses this value as the
 * divisor. Prevents the division-by-near-zero explosion that caused the
 * original blowout.
 */
const EPSILON = 1e-4;

/**
 * Maximum stretch factor for the strain-limit hard cap. After all constraints,
 * any adjacent distance greater than `segmentLength * MAX_STRETCH_FACTOR` is
 * clamped along the segment vector. Catches PBD's residual stretch under
 * extreme load.
 */
const MAX_STRETCH_FACTOR = 1.5;

/**
 * Maximum implicit-velocity factor. Each node's `(curr - prev)` is clamped to
 * `±segmentLength * MAX_VELOCITY_FACTOR` before Verlet integration. Caps the
 * single-frame displacement, preventing whip/lash from violent anchor motion.
 */
const MAX_VELOCITY_FACTOR = 5;

/**
 * Safe fallback rest direction when the configured `restDirection` is
 * zero-length or non-finite. Matches `DEFAULT_SPRING_ROD.restDirection`
 * (downward) so the rebuild in NaN reset looks identical to a fresh
 * `createSpringRod` call with the default config.
 */
const FALLBACK_REST_DIRECTION: Readonly<Vec2> = { x: 0, y: 1 };

/**
 * Spring rod configuration. Controls rest-pose direction, stiffness, tip sag,
 * and solver sub-stepping. Stability guards (epsilon, velocity clamp, NaN
 * reset, strain limit) are baked in and non-optional.
 *
 * All fields are `readonly` — spread `DEFAULT_SPRING_ROD` and override
 * individual fields rather than mutating in place.
 */
export interface SpringRodConfig {
  /** Rest distance between adjacent nodes in px. */
  readonly segmentLength: number;
  /**
   * Direction from root to tip (normalized internally). Examples:
   * `{x: 0, y: 1}` downward tail; `{x: 0.32, y: -1}` forward-leaning antenna;
   * `{x: -1, y: 0}` backward-flowing mane. Zero-length / non-finite values
   * fall back to `{x: 0, y: 1}`.
   */
  readonly restDirection: Vec2;
  /**
    * High-level stiffness in `[0, 1]`. `0` = floppy rope, `1` = near-rigid
    * rod. Maps internally to:
    *   - `constraintIterations = round(1 + stiffness * 7)` (1 at 0, 8 at 1).
    *   - Bend stiffness taper `0.75 + 0.25 * stiffness` (base) → `0.75` (tip).
    *   - Rest-pose stiffness taper `0.5 * stiffness` (base) → `0.3 * stiffness` (tip).
    *
    * The consumer never sees the derived constants.
    */
  readonly stiffness: number;
  /**
   * Positional nudge applied to each node per tick, scaled by `i / (count - 1)`
   * (base ~0, tip full). The nudge is added in the +Y direction (canvas down
   * = positive Y), modeling tip mass sagging the rod. `0` disables. Because
   * the nudge is per-tick, the equilibrium sag is `tipWeight` divided by the
   * effective restorative stiffness at the tip.
   */
  readonly tipWeight: number;
  /**
   * Solver sub-steps per call. Each sub-step runs the full pipeline (Verlet +
   * distance + bend + rest-pose + tip-weight + guards) on `dt / subSteps`.
   * Distributes forces over smaller increments for stability under high
   * stiffness or large `dt`. Default `1`. Values `< 1` or non-finite clamp to
   * `1`.
   */
  readonly subSteps: number;
  /** Gravity X in px / tick². Wind / lateral forces. Default `0`. */
  readonly gravityX: number;
  /** Gravity Y in px / tick². Downward pull. Default `0`. */
  readonly gravityY: number;
  /**
   * Velocity damping per tick. `1` = no drag, `0.9` = 10% energy lost per
   * tick. Default `0.95`.
   */
  readonly drag: number;
}

/**
 * Default config: a moderate-stiffness downward-hanging rod with no tip sag
 * and no gravity. The consumer spreads this and overrides per element:
 *
 * ```ts
 * // Floppy downward tail with gravity
 * const tail = { ...DEFAULT_SPRING_ROD, stiffness: 0.3, gravityY: 0.5 };
 * // Stiff forward-leaning antenna
 * const antenna = {
 *   ...DEFAULT_SPRING_ROD,
 *   restDirection: { x: 0.32, y: -1 },
 *   stiffness: 0.7,
 *   tipWeight: 0.12,
 * };
 * ```
 */
export const DEFAULT_SPRING_ROD: Readonly<SpringRodConfig> = {
  segmentLength: 4,
  restDirection: { x: 0, y: 1 },
  stiffness: 0.5,
  tipWeight: 0,
  subSteps: 1,
  gravityX: 0,
  gravityY: 0,
  drag: 0.95,
};

/**
 * Normalize a 2D vector with a safe fallback. Non-finite or zero-length input
 * returns `FALLBACK_REST_DIRECTION` so downstream division cannot produce
 * `NaN` or `Infinity`.
 *
 * @param x - vector X component
 * @param y - vector Y component
 * @returns unit-length `{x, y}` (or the safe fallback)
 */
function safeNormalize(x: number, y: number): Vec2 {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ...FALLBACK_REST_DIRECTION };
  const len = Math.sqrt(x * x + y * y);
  if (!(len >= 1e-8)) return { ...FALLBACK_REST_DIRECTION };
  return { x: x / len, y: y / len };
}

/**
 * Create an initial straight chain of `VerletNode`s along a direction from an
 * anchor, with zero implicit velocity. Node `i` sits at
 * `anchor + i * segmentLength * normalize(restDirection)`.
 *
 * Edge cases:
 *   - `count <= 0` → empty array.
 *   - Zero-length / non-finite `restDirection` → safe fallback (downward).
 *
 * @param count - node count (including the pinned root at index 0)
 * @param anchorX - root X
 * @param anchorY - root Y
 * @param segmentLength - distance between adjacent nodes in px
 * @param restDirection - direction vector from root to tip (normalized
 *   internally; zero-length falls back to `{x: 0, y: 1}`)
 * @returns a new `VerletNode[]` in a straight line along `restDirection`,
 *   each node at rest (`prev === current`)
 *
 * @example
 * ```ts
 * // Downward 5-node tail, 4px segments, anchored at (10, 20)
 * const tail = createSpringRod(5, 10, 20, 4, { x: 0, y: 1 });
 * // tail[4] === { x: 10, y: 36, prevX: 10, prevY: 36 }
 * ```
 */
export function createSpringRod(
  count: number,
  anchorX: number,
  anchorY: number,
  segmentLength: number,
  restDirection: Vec2,
): VerletNode[] {
  if (count <= 0 || !Number.isFinite(count)) return [];
  const dir = safeNormalize(restDirection.x, restDirection.y);
  const dx = segmentLength * dir.x;
  const dy = segmentLength * dir.y;
  const nodes: VerletNode[] = [];
  for (let i = 0; i < count; i++) {
    const x = anchorX + i * dx;
    const y = anchorY + i * dy;
    nodes.push({ x, y, prevX: x, prevY: y });
  }
  return nodes;
}

/**
 * Advance a springy rod by one fixed timestep. Pure, deterministic, never
 * throws.
 *
 * **Pipeline per sub-step** (`config.subSteps` passes, each on `dt / subSteps`):
 *   1. Pin the root node (index 0) to the anchor — immovable.
 *   2. Verlet integration for nodes 1..n-1: apply implicit velocity
 *      `(curr - prev) * drag` clamped to `±5 * segmentLength`, plus gravity
 *      `* dt²`.
 *   3. PBD distance constraints (adjacent nodes, rest `segmentLength`) for
 *      `round(1 + stiffness * 7)` iterations. The root absorbs no correction
 *      (node 1 takes 100%); every other pair splits 50/50.
 *   4. Provot bend constraints (i, i+2 at rest `2 * segmentLength`) with
 *      tapered stiffness `0.75 + 0.25 * stiffness` (base) → `0.75` (tip).
 *      For `i = 0`, node 2 takes the full correction; otherwise 50/50.
 *   5. Directional rest-pose spring toward `prev + segmentLength * restDir`,
 *      tapered stiffness `0.5 * stiffness` (base) → `0.3 * stiffness` (tip).
 *   6. Tip-weight nudge: `+tipWeight * i / (count - 1)` in Y per node.
 *   7. Strain limit: clamp any adjacent distance `> 1.5 * segmentLength`.
 *
 * After all sub-steps, the **NaN/Infinity reset** runs: if any coordinate is
 * non-finite, the entire chain is rebuilt via `createSpringRod` off the
 * anchor with `config.restDirection` (so a blowout lasts at most one frame).
 *
 * **Velocity preservation.** Every positional correction (distance, bend,
 * rest-pose, tip-weight, strain-limit) moves BOTH `curr` AND `prev` by the
 * same delta. This is critical: Verlet velocity is implicit (`curr - prev`),
 * so a positional-only correction would inject a spurious velocity spike and
 * re-excite the whip on the next tick. Moving both fields together keeps the
 * implicit velocity unchanged across corrections.
 *
 * **Purity.** Returns a NEW array of NEW `VerletNode` objects; the input
 * array and its nodes are not mutated. Never throws — non-finite `dt`,
 * `subSteps`, or config values produce a safe rebuild rather than an error.
 *
 * @param nodes - current chain state (read-only; not mutated)
 * @param anchorX - world X of the pinned root
 * @param anchorY - world Y of the pinned root
 * @param dt - fixed timestep (caller MUST keep constant for determinism)
 * @param config - rod physics parameters
 * @returns a new `VerletNode[]` (input not mutated)
 *
 * @example
 * ```ts
 * // Upward antenna (leaning forward with facing)
 * let antenna = createSpringRod(5, bodyX, bodyTopY, 4, { x: 0.32, y: -1 });
 * antenna = advanceSpringRod(antenna, bodyX, bodyTopY, 1, {
 *   ...DEFAULT_SPRING_ROD,
 *   restDirection: { x: 0.32 * facing, y: -1 },
 *   stiffness: 0.7,
 *   tipWeight: 0.12,
 * });
 *
 * // Downward tail
 * let tail = createSpringRod(6, hipX, hipY, 4, { x: 0, y: 1 });
 * tail = advanceSpringRod(tail, hipX, hipY, 1, {
 *   ...DEFAULT_SPRING_ROD,
 *   stiffness: 0.3,
 *   gravityY: 0.5,
 * });
 *
 * // Draw as polyline
 * ctx.beginPath();
 * ctx.moveTo(tail[0].x, tail[0].y);
 * for (let i = 1; i < tail.length; i++) ctx.lineTo(tail[i].x, tail[i].y);
 * ctx.stroke();
 * ```
 */
export function advanceSpringRod(
  nodes: readonly VerletNode[],
  anchorX: number,
  anchorY: number,
  dt: number,
  config: SpringRodConfig,
): VerletNode[] {
  if (nodes.length === 0) return [];

  const seg = config.segmentLength;
  const restDir = safeNormalize(config.restDirection.x, config.restDirection.y);

  // Defensive: non-finite dt or broken subSteps → can't integrate; rebuild at
  // rest off the anchor. This is the never-throw path.
  const rawSteps = config.subSteps;
  const subSteps =
    Number.isFinite(rawSteps) && rawSteps >= 1 ? Math.floor(rawSteps) : 1;
  if (!Number.isFinite(dt)) {
    return createSpringRod(nodes.length, anchorX, anchorY, seg, restDir);
  }

  // Derived stiffness constants (computed once — not per sub-step).
  const constraintIterations = Math.max(
    1,
    Math.round(1 + config.stiffness * 7),
  );
  const bendBase = 0.75 + 0.25 * config.stiffness;
  const bendTip = 0.75;
  const restBase = 0.5 * config.stiffness;
  const restTip = 0.3 * config.stiffness;

  const maxVel = seg * MAX_VELOCITY_FACTOR;
  const maxStretch = seg * MAX_STRETCH_FACTOR;
  const subDt = dt / subSteps;
  const dtSq = subDt * subDt;

  // Per-segment rest vector (normalized direction × segmentLength).
  const segRestX = seg * restDir.x;
  const segRestY = seg * restDir.y;

  // Deep clone — input is never mutated.
  const next: VerletNode[] = nodes.map((n) => ({
    x: n.x,
    y: n.y,
    prevX: n.prevX,
    prevY: n.prevY,
  }));

  const last = next.length - 1;

  for (let step = 0; step < subSteps; step++) {
    // 1. Pin root to anchor (immovable; zero implicit velocity for cleanliness).
    next[0].x = anchorX;
    next[0].y = anchorY;
    next[0].prevX = anchorX;
    next[0].prevY = anchorY;

    // 2. Verlet integration for dynamic nodes (with velocity clamp).
    for (let i = 1; i < next.length; i++) {
      const n = next[i];
      let vx = (n.x - n.prevX) * config.drag;
      let vy = (n.y - n.prevY) * config.drag;
      if (vx > maxVel) vx = maxVel;
      else if (vx < -maxVel) vx = -maxVel;
      if (vy > maxVel) vy = maxVel;
      else if (vy < -maxVel) vy = -maxVel;
      n.prevX = n.x;
      n.prevY = n.y;
      n.x = n.x + vx + config.gravityX * dtSq;
      n.y = n.y + vy + config.gravityY * dtSq;
    }

    // 3. PBD distance constraints (adjacent nodes, rest = segmentLength).
    for (let iter = 0; iter < constraintIterations; iter++) {
      for (let i = 1; i < next.length; i++) {
        const prev = next[i - 1];
        const curr = next[i];
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        const dRaw = Math.sqrt(dx * dx + dy * dy);
        // Epsilon guard — fallback to rest direction, treat d as EPSILON so
        // any subsequent division is bounded.
        const d = dRaw >= EPSILON ? dRaw : EPSILON;
        const ux = dRaw >= EPSILON ? dx / dRaw : restDir.x;
        const uy = dRaw >= EPSILON ? dy / dRaw : restDir.y;
        const diff = seg - d;
        const ox = ux * diff;
        const oy = uy * diff;
        if (i === 1) {
          // Root immovable; node 1 absorbs full correction.
          curr.x += ox;
          curr.y += oy;
          curr.prevX += ox;
          curr.prevY += oy;
        } else {
          // Split 50/50 — move curr AND prev together (velocity preservation).
          prev.x -= ox * 0.5;
          prev.y -= oy * 0.5;
          prev.prevX -= ox * 0.5;
          prev.prevY -= oy * 0.5;
          curr.x += ox * 0.5;
          curr.y += oy * 0.5;
          curr.prevX += ox * 0.5;
          curr.prevY += oy * 0.5;
        }
      }
    }

    // 4. Provot bend constraints (i, i+2 at rest = 2 * segmentLength).
    const pairs = next.length - 2;
    for (let i = 0; i < pairs; i++) {
      const a = next[i];
      const b = next[i + 2];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dRaw = Math.sqrt(dx * dx + dy * dy);
      const d = dRaw >= EPSILON ? dRaw : EPSILON;
      const ux = dRaw >= EPSILON ? dx / dRaw : restDir.x;
      const uy = dRaw >= EPSILON ? dy / dRaw : restDir.y;
      const restLen = 2 * seg;
      const diff = restLen - d;
      // Tapered stiffness: pair 0 (base) → bendBase, last pair (tip) → bendTip.
      const t = pairs > 1 ? i / (pairs - 1) : 0;
      const stiff = bendBase + (bendTip - bendBase) * t;
      const ox = ux * diff * stiff;
      const oy = uy * diff * stiff;
      if (i === 0) {
        // Root (node 0) immovable; node 2 absorbs full correction.
        b.x += ox;
        b.y += oy;
        b.prevX += ox;
        b.prevY += oy;
      } else {
        a.x -= ox * 0.5;
        a.y -= oy * 0.5;
        a.prevX -= ox * 0.5;
        a.prevY -= oy * 0.5;
        b.x += ox * 0.5;
        b.y += oy * 0.5;
        b.prevX += ox * 0.5;
        b.prevY += oy * 0.5;
      }
    }

    // 5. Directional rest-pose spring (per-node pull toward prev + segRest).
    if (last >= 1) {
      for (let i = 1; i < next.length; i++) {
        const below = next[i - 1];
        const restX = below.x + segRestX;
        const restY = below.y + segRestY;
        const n = next[i];
        // Tapered stiffness: node 1 (base) → restBase, last node → restTip.
        const t = last > 1 ? (i - 1) / (last - 1) : 0;
        const stiff = restBase + (restTip - restBase) * t;
        const dx = (restX - n.x) * stiff;
        const dy = (restY - n.y) * stiff;
        n.x += dx;
        n.y += dy;
        n.prevX += dx;
        n.prevY += dy;
      }
    }

    // 6. Tip-weight nudge (downward Y, scaled by chain position).
    if (config.tipWeight !== 0 && last >= 1) {
      for (let i = 1; i < next.length; i++) {
        const frac = i / last;
        const dy = config.tipWeight * frac;
        const n = next[i];
        n.y += dy;
        n.prevY += dy;
      }
    }

    // 7. Strain limit — hard cap on adjacent distance after constraints.
    // Inner-to-outer pass: each clamp on pair (i-1, i) is visible to the next
    // pair (i, i+1). Only `curr` moves; `prev` is left alone so the inner
    // chain (already settled by constraints) is not perturbed. Velocity
    // preserved by moving curr AND prev together.
    for (let i = 1; i < next.length; i++) {
      const prev = next[i - 1];
      const curr = next[i];
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (Number.isFinite(d) && d > maxStretch) {
        // Guard against d === 0 (cannot happen here since d > maxStretch > 0,
        // but the explicit check keeps the static analyzer happy).
        const scale = maxStretch / d;
        const targetX = prev.x + dx * scale;
        const targetY = prev.y + dy * scale;
        const deltaX = targetX - curr.x;
        const deltaY = targetY - curr.y;
        curr.x += deltaX;
        curr.y += deltaY;
        curr.prevX += deltaX;
        curr.prevY += deltaY;
      }
    }
  }

  // Final NaN/Infinity reset — the nuclear safety net. If any coordinate is
  // non-finite (e.g. from corrupted input or a guard that somehow leaked),
  // rebuild the entire chain along restDirection off the anchor at rest.
  for (let i = 0; i < next.length; i++) {
    const n = next[i];
    if (
      !Number.isFinite(n.x) ||
      !Number.isFinite(n.y) ||
      !Number.isFinite(n.prevX) ||
      !Number.isFinite(n.prevY)
    ) {
      return createSpringRod(next.length, anchorX, anchorY, seg, restDir);
    }
  }

  return next;
}
