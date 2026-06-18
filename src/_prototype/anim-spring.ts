/**
 * Verlet-PBD spring-chain prototype.
 *
 * NOT the production spring module (that lives in `src/animation/spring.ts`).
 * Follows pure-progression-ops: `advanceSpringChain` returns a new array of new
 * nodes; the input is never mutated.
 *
 * Determinism contract: the caller MUST pass a fixed `dt` (e.g. always `1` at
 * 60 Hz, or always `1/60` — consistency matters, not the absolute value).
 * Variable `dt` causes Verlet velocity drift and non-deterministic results.
 */

/** A single node in the Verlet chain (current + previous position). */
export interface VerletNode {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
}

/** Spring chain configuration. All tunable; no magic numbers in the solver. */
export interface SpringConfig {
  /** Rest distance between adjacent nodes in px. */
  segmentLength: number;
  /** Gravity X component in px / tick^2. */
  gravityX: number;
  /** Gravity Y component in px / tick^2. */
  gravityY: number;
  /** Velocity damping per tick. `1` = no drag, `0.9` = 10% energy lost. */
  drag: number;
  /** Constraint solver iterations per step (1-3 typical). */
  constraintIterations: number;
}

/** Default config for a hanging tail / hair chain. */
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
 *      `(pos - prev) * drag` plus gravity `* dt^2`.
 *   3. Satisfy distance constraints (PBD) for `constraintIterations` passes.
 *      The root absorbs no correction (node 1 takes 100%); every other pair
 *      splits 50/50.
 *
 * The root's `prevX` / `prevY` are reset to the anchor each step. The root is
 * never integrated and the constraint solver reads positions only, so this does
 * not affect chain dynamics — it just keeps the node's implied velocity at zero
 * for inspection cleanliness.
 *
 * @param nodes - current chain state (read-only)
 * @param anchorX - world X of the pinned root
 * @param anchorY - world Y of the pinned root
 * @param dt - fixed timestep (caller must keep this constant)
 * @param config - spring parameters
 * @returns a new array of VerletNodes
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
    x: n.x, y: n.y, prevX: n.prevX, prevY: n.prevY,
  }));

  // 1. Pin root.
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
 * Create an initial straight chain hanging downward from an anchor.
 *
 * Each node's `prev` equals its current position (zero implicit velocity), so
 * the chain starts at rest.
 *
 * @param count - node count (including the anchor at index 0)
 * @param anchorX - root X
 * @param anchorY - root Y
 * @param segmentLength - distance between adjacent nodes
 * @returns a new array of VerletNodes in a vertical line
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
