/**
 * Verlet-PBD spring chain: physics-based secondary dynamics for hair, tails,
 * cloaks, antennae, ropes.
 *
 * `advanceSpringChain` advances a chain of `VerletNode`s by ONE fixed timestep
 * using Verlet integration + Position-Based Distance constraints (PBD). It is
 * the canonical pure-progression-ops example for this pillar: a new array of
 * new nodes is returned, the input is never mutated — exactly the
 * `src/particles/advance.ts` discipline.
 *
 * **Determinism contract:** the caller MUST pass a fixed `dt` (e.g. always `1`
 * at 60 Hz, or always `1/60` — consistency matters, not the absolute value).
 * Variable `dt` causes Verlet velocity drift and non-deterministic results.
 * The caller owns the fixed-timestep accumulator (matches the particles
 * convention); there is no internal sub-stepping.
 */

/**
 * A single node in the Verlet chain. Position is explicit; velocity is IMPLICIT
 * (derived from the current-minus-previous position each step), which is what
 * makes Verlet unconditionally stable under a fixed timestep.
 */
export interface VerletNode {
  /** Current position X. */
  x: number;
  /** Current position Y. */
  y: number;
  /** Previous position X (the implicit-velocity source). */
  prevX: number;
  /** Previous position Y (the implicit-velocity source). */
  prevY: number;
}

/**
 * Spring chain configuration. All tunable; no magic numbers in the solver.
 */
export interface SpringConfig {
  /** Rest distance between adjacent nodes in px. */
  segmentLength: number;
  /** Gravity X component in px / tick² (wind/lateral forces). */
  gravityX: number;
  /** Gravity Y component in px / tick² (downward pull). */
  gravityY: number;
  /** Velocity damping per tick. `1` = no drag, `0.9` = 10% energy lost. */
  drag: number;
  /**
   * Constraint solver iterations per step. 1–3 is typical for organic
   * secondary motion (hair, tails); raise toward 8+ for near-rigid rods.
   *
   * **PBD softness:** finite-iteration PBD constraints are SOFT — a chain
   * under load stretches slightly, with the top segments (which bear more
   * weight) stretching more than the bottom. Empirically this is ~7% over rest
   * length at 2 iterations and ~1% at 8. This reads as desirably elastic for
   * organic secondary elements; consumers wanting rigid rods should raise
   * `constraintIterations`.
   */
  constraintIterations: number;
}

/**
 * Default config for a hanging tail / hair chain. Tunable; consumers spread
 * this into their own config.
 */
export const DEFAULT_SPRING: Readonly<SpringConfig> = {
  segmentLength: 4,
  gravityX: 0,
  gravityY: 0.5,
  drag: 0.95,
  constraintIterations: 2,
};

/**
 * Advance a Verlet spring chain by one fixed timestep. Pure.
 *
 * Physics order per step:
 *   1. Pin the root node (index 0) to the anchor — immovable.
 *   2. Verlet integration for nodes 1..n-1: apply implicit velocity
 *      `(pos - prev) * drag` plus gravity `* dt²`.
 *   3. Satisfy distance constraints (PBD) for `constraintIterations` passes.
 *      The root absorbs no correction (node 1 takes 100%); every other pair
 *      splits 50/50.
 *
 * The root's `prevX` / `prevY` are reset to the anchor each step so its implied
 * velocity stays zero for inspection cleanliness; the root is never integrated
 * and the constraint solver reads positions only, so this does not affect chain
 * dynamics.
 *
 * Pure: returns a NEW array of NEW `VerletNode` objects; the input array and
 * its nodes are not mutated. Never throws.
 *
 * @param nodes - current chain state (read-only)
 * @param anchorX - world X of the pinned root
 * @param anchorY - world Y of the pinned root
 * @param dt - fixed timestep (caller MUST keep this constant for determinism)
 * @param config - spring parameters
 * @returns a new array of `VerletNode`s (input is not mutated)
 *
 * @example
 * ```ts
 * let tail = createSpringChain(6, player.x, player.y, 4);
 * // Caller owns the fixed-timestep accumulator:
 * accumulator += frameDt;
 * while (accumulator >= 1) {
 *   tail = advanceSpringChain(tail, player.x + 8, player.y + 12, 1, DEFAULT_SPRING);
 *   accumulator -= 1;
 * }
 * ```
 */
export function advanceSpringChain(
  nodes: readonly VerletNode[],
  anchorX: number,
  anchorY: number,
  dt: number,
  config: SpringConfig,
): VerletNode[] {
  if (nodes.length === 0) return [];

  const next: VerletNode[] = nodes.map((n) => ({
    x: n.x,
    y: n.y,
    prevX: n.prevX,
    prevY: n.prevY,
  }));

  // 1. Pin root (immovable anchor).
  next[0].x = anchorX;
  next[0].y = anchorY;
  next[0].prevX = anchorX;
  next[0].prevY = anchorY;

  // 2. Verlet integration for dynamic nodes.
  const dtSq = dt * dt;
  for (let i = 1; i < next.length; i++) {
    const n = next[i];
    const vx = (n.x - n.prevX) * config.drag;
    const vy = (n.y - n.prevY) * config.drag;
    n.prevX = n.x;
    n.prevY = n.y;
    n.x = n.x + vx + config.gravityX * dtSq;
    n.y = n.y + vy + config.gravityY * dtSq;
  }

  // 3. Distance constraints (PBD).
  const seg = config.segmentLength;
  for (let iter = 0; iter < config.constraintIterations; iter++) {
    for (let i = 1; i < next.length; i++) {
      const prev = next[i - 1];
      const curr = next[i];
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d === 0) continue;
      const diff = seg - d;
      const ox = (dx / d) * diff;
      const oy = (dy / d) * diff;
      if (i === 1) {
        // Node 0 is the immovable anchor; node 1 absorbs the full correction.
        curr.x += ox;
        curr.y += oy;
      } else {
        prev.x -= ox * 0.5;
        prev.y -= oy * 0.5;
        curr.x += ox * 0.5;
        curr.y += oy * 0.5;
      }
    }
  }

  return next;
}

/**
 * Create an initial straight chain of `VerletNode`s hanging downward from an
 * anchor point.
 *
 * Each node's `prev` equals its current position (zero implicit velocity), so
 * the chain starts at rest. Node `i` sits at `(anchorX, anchorY + i * segmentLength)`.
 *
 * @param count - node count (including the anchor node at index 0)
 * @param anchorX - root X
 * @param anchorY - root Y
 * @param segmentLength - distance between adjacent nodes
 * @returns a new array of `VerletNode`s in a straight vertical line
 */
export function createSpringChain(
  count: number,
  anchorX: number,
  anchorY: number,
  segmentLength: number,
): VerletNode[] {
  const nodes: VerletNode[] = [];
  for (let i = 0; i < count; i++) {
    const y = anchorY + i * segmentLength;
    nodes.push({ x: anchorX, y, prevX: anchorX, prevY: y });
  }
  return nodes;
}
