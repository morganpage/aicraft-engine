/**
 * Route graph generation — path-first macro layout.
 *
 * Generates a {@link RouteGraph} from a seed and config. The route graph
 * establishes start, exit, critical-path ordering, optional branches, and
 * reward locations before any geometry is placed.
 *
 * The generator produces a Spelunky-style serializable path graph. The
 * same `(seed, config)` always produces the same route.
 *
 * Determinism: uses `mulberry32` for all randomness. No `Math.random`,
 * no `Date.now`, no global mutable state.
 *
 * @module
 */

import type { LevelGenConfig, RouteGraph, RouteNode, RouteEdge } from './types';
import { mulberry32, nextInt } from '../rng/mulberry32';
import { ROUTE_SEED_SALT } from './constants';

/**
 * Generate a deterministic route graph from a seed and config.
 *
 * The route consists of:
 * - One start node at the left edge (tile column 1–2).
 * - One exit node at the right edge (tile column cols-3 – cols-2).
 * - 0–2 branch nodes based on difficulty (more branches at higher difficulty).
 * - Optional reward nodes at branches.
 * - Main edges connecting the start → exit path.
 * - Branch edges leading to branch/reward nodes.
 *
 * The graph is guaranteed connected: every node is reachable from start
 * via some path.
 *
 * Pure: never mutates input, never throws. Returns a valid `RouteGraph`.
 *
 * @param seed   - Deterministic seed.
 * @param config - Level generation config (dimensions, difficulty).
 * @returns A connected route graph.
 *
 * @example
 * ```ts
 * const route = generateRoute(42, { cols: 60, rows: 15, tileSize: 16, difficulty: 0.5 });
 * // route.nodes[0].kind === 'start'
 * // route.nodes[1].kind === 'exit'  (or a branch node)
 * ```
 */
export function generateRoute(
  seed: number,
  config: Readonly<LevelGenConfig>,
): RouteGraph {
  const rng = mulberry32((seed >>> 0) ^ ROUTE_SEED_SALT);

  // Defensive null/undefined check for config.
  const safeConfig: LevelGenConfig = config ?? {};

  // Parse config with safe defaults.
  const cols = (typeof safeConfig.cols === 'number' && safeConfig.cols > 0) ? safeConfig.cols : 60;
  const rows = (typeof safeConfig.rows === 'number' && safeConfig.rows > 0) ? safeConfig.rows : 15;
  const difficulty = (typeof safeConfig.difficulty === 'number' && Number.isFinite(safeConfig.difficulty))
    ? Math.max(0, Math.min(1, safeConfig.difficulty))
    : 0.5;

  // Ground surface row (walkable surface). Row 0 is top; ground surface is
  // typically row rows-2 (one tile above the bottom solid row).
  const groundY = rows - 2;

  // Start node at left edge, on the ground surface.
  const startX = 1 + (cols > 6 ? 1 : 0);
  const start: RouteNode = {
    id: 'start',
    x: startX,
    y: groundY,
    kind: 'start',
  };

  // Exit node at right edge, on the ground surface.
  const exitX = cols - 3;
  const exit: RouteNode = {
    id: 'exit',
    x: exitX,
    y: groundY,
    kind: 'exit',
  };

  const nodes: RouteNode[] = [start, exit];
  const edges: RouteEdge[] = [];

  // Determine branch count: 0 at very low difficulty, up to 2 at high.
  const branchCount = difficulty < 0.3 ? 0 : difficulty < 0.7 ? 1 : 2;

  // Add branch nodes.
  for (let i = 0; i < branchCount; i++) {
    const branchId = `branch-${i}`;
    const rewardId = `reward-${i}`;

    // Branch node offset: X between startX + 4 and exitX - 4
    const minX = Math.max(startX + 4, Math.floor(cols * 0.25 * (i + 1)));
    const maxX = Math.min(exitX - 4, Math.floor(cols * 0.75 * (i + 1)));
    const branchX = minX <= maxX ? nextInt(rng, minX, maxX) : Math.floor((startX + exitX) / 2);

    // Branch goes upward (lower Y = higher on screen). Height is 2-4 tiles up.
    const branchY = Math.max(1, groundY - nextInt(rng, 2, 4));

    const branchNode: RouteNode = {
      id: branchId,
      x: branchX,
      y: branchY,
      kind: 'branch',
    };

    // Reward node: slightly above (1 tile) and offset (left or right 1 tile) from branch
    const rewardX = branchX + (rng() < 0.5 ? -1 : 1);
    const clampedRewardX = Math.max(1, Math.min(cols - 2, rewardX));
    const clampedRewardY = Math.max(0, branchY - 1);

    const rewardNode: RouteNode = {
      id: rewardId,
      x: clampedRewardX,
      y: clampedRewardY,
      kind: 'reward',
    };

    nodes.push(branchNode, rewardNode);

    // Edge: from previous main node to branch
    const prevMainId = i === 0 ? 'start' : `branch-${i - 1}`;
    edges.push({
      from: prevMainId,
      to: branchId,
      kind: 'branch',
    });

    // Edge: from branch to reward
    edges.push({
      from: branchId,
      to: rewardId,
      kind: 'branch',
    });

    // Edge: from reward back to branch (must come back)
    edges.push({
      from: rewardId,
      to: branchId,
      kind: 'branch',
    });

    // Edge: from branch to next main node (or exit)
    const nextMainId = i === branchCount - 1 ? 'exit' : `branch-${i + 1}`;
    edges.push({
      from: branchId,
      to: nextMainId,
      kind: 'branch',
    });
  }

  // If no branches, add direct main edge from start to exit.
  if (branchCount === 0) {
    edges.push({ from: 'start', to: 'exit', kind: 'main' });
  }

  return {
    version: 1,
    nodes,
    edges,
  };
}
