/**
 * Static reachability analysis for platformer levels.
 *
 * Builds a directed graph of standing surfaces extracted from a compiled
 * level, then performs BFS to determine which surfaces are reachable from
 * the spawn surface. Detects softlocks via optional backward BFS from
 * exit surfaces.
 *
 * **Determinism:** All functions are pure — same input → same output, forever.
 * No `Math.random`, no `Date.now()`, no DOM reads, no global mutable state.
 * BFS visit order is pinned by lexicographic `Surface.id`.
 *
 * **Confidence levels:**
 * - `sound-over-approximation`: every feasible-looking jump is included.
 *   A missing path proves unreachability for the modeled subset of mechanics.
 * - `heuristic`: best-effort graph; cannot prove unreachability.
 * - `unsupported`: level uses moving platforms or other time-varying surfaces
 *   that are not yet modeled. Graph is built for editor diagnostics only.
 *
 * @module
 */

import type { LevelData } from '../level/types';
import type { CompiledLevel } from '../platformer/level-runtime';
import { compileLevel, entityIdFromSolidId } from '../platformer/level-runtime';
import { createPlatformerState } from '../platformer/kernel';
import { DEFAULT_PLATFORMER_CONFIG, DEFAULT_PLAYER_WIDTH, DEFAULT_PLAYER_HEIGHT } from '../platformer/constants';
import { computeJumpArc } from './trajectory';
import type { JumpArcConfig } from './trajectory';
import type {
  Surface,
  JumpEdge,
  ReachGraph,
  ReachabilityResult,
  ReachabilityConfig,
  ReachabilityConfidence,
} from './types';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default jump-arc config used when none is provided. */
const DEFAULT_JUMP_ARC_CONFIG: JumpArcConfig = {
  playerWidth: DEFAULT_PLAYER_WIDTH,
  playerHeight: DEFAULT_PLAYER_HEIGHT,
  platformerConfig: DEFAULT_PLATFORMER_CONFIG,
  safetyMargin: 0,
};

// ---------------------------------------------------------------------------
// Surface extraction
// ---------------------------------------------------------------------------

/**
 * Extract standing surfaces from a `CompiledLevel`.
 *
 * Each solid in `staticSolids` contributes one surface. The surface is the
 * top face of the solid — the Y value a character would stand on.
 *
 * Surfaces are sorted by `id` (lexicographic) for deterministic visit order.
 */
function extractSurfaces(compiled: CompiledLevel): Surface[] {
  const surfaces: Surface[] = [];

  for (const solid of compiled.staticSolids) {
    const id = solid.id ?? '';
    // Deduped onto the public `entityIdFromSolidId` (returns `undefined` for
    // tile-derived `tile-…` ids, which are not reversible to an entity).
    const entityId = entityIdFromSolidId(id);
    surfaces.push({
      id,
      x: solid.x,
      y: solid.y,
      width: solid.width,
      passthrough: solid.passthrough ?? false,
      entityId,
    });
  }

  // Stable sort for deterministic BFS visit order
  surfaces.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return surfaces;
}

// ---------------------------------------------------------------------------
// Edge computation
// ---------------------------------------------------------------------------

/**
 * Compute jump edges between all pairs of surfaces.
 *
 * Each edge is computed via `computeJumpArc` and included only if
 * `feasible === true`. A surface always has a trivial edge to itself
 * (stand in place). Self-edges are omitted from the edge list but
 * implicitly handled by BFS (a surface is always reachable from itself).
 */
function computeEdges(
  surfaces: Surface[],
  config: JumpArcConfig,
): JumpEdge[] {
  const edges: JumpEdge[] = [];

  for (const from of surfaces) {
    for (const to of surfaces) {
      // Skip self-edges (already on the surface)
      if (from.id === to.id) continue;

      const result = computeJumpArc(
        { x: from.x, y: from.y, width: from.width },
        { x: to.x, y: to.y, width: to.width },
        config,
      );

      if (result.feasible) {
        edges.push({
          from,
          to,
          requiresDash: result.requiresDash,
          airtime: result.airtime,
          difficulty: result.difficulty,
        });
      }
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Spawn / exit surface helpers
// ---------------------------------------------------------------------------

/**
 * Find the surface the player is standing on at the spawn point.
 *
 * The player's feet at spawn are at `spawn.y + playerHeight` (since spawn
 * coordinates correspond to the top-left of the player body). We look for
 * a surface whose top face equals that Y value and whose X-range overlaps
 * the player's body.
 *
 * Returns `null` when no surface matches (player spawns in the air or
 * inside geometry).
 */
function findSpawnSurface(
  surfaces: Surface[],
  spawn: { readonly x: number; readonly y: number },
  playerWidth: number,
  playerHeight: number,
): Surface | null {
  const feetY = spawn.y + playerHeight;
  const playerRight = spawn.x + playerWidth;

  let best: Surface | null = null;
  let bestOverlap = 0;

  for (const s of surfaces) {
    // The surface's top must be at or below the player's feet (within 1px tolerance)
    if (s.y > feetY + 1 || s.y < feetY - 1) continue;

    // The player's body must horizontally overlap the surface
    const overlapLeft = Math.max(spawn.x, s.x);
    const overlapRight = Math.min(playerRight, s.x + s.width);
    const overlap = Math.max(0, overlapRight - overlapLeft);

    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = s;
    }
  }

  return best;
}

/**
 * Find surfaces that correspond to exit entities in the level.
 *
 * An exit surface is a surface whose entity id matches an `exit` kind entity
 * in the level, and whose top face is at or just below the exit entity's
 * bottom edge.
 */
function findExitSurfaces(
  surfaces: Surface[],
  level: LevelData,
): Surface[] {
  // Collect all exit entity ids
  const exitEntityIds = new Set<number>();
  for (const entity of level.entities ?? []) {
    if (entity && entity.kind === 'exit') {
      exitEntityIds.add(entity.id);
    }
  }

  // Find surfaces whose entity id is an exit entity
  // If no entity-matched surface exists, find surfaces overlapping exit rects
  const result: Surface[] = [];
  const seen = new Set<string>();

  for (const s of surfaces) {
    if (s.entityId !== undefined && exitEntityIds.has(s.entityId)) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        result.push(s);
      }
    }
  }

  // If no surfaces matched by entity id, try overlap with exit rects
  if (result.length === 0) {
    for (const entity of level.entities ?? []) {
      if (entity && entity.kind === 'exit') {
        const exitBottom = entity.rect.y + entity.rect.height;
        for (const s of surfaces) {
          if (seen.has(s.id)) continue;
          // Surface is below the exit, within a tile height
          if (s.y >= exitBottom - 16 && s.y <= exitBottom + 4) {
            // Horizontal overlap
            const overlapLeft = Math.max(s.x, entity.rect.x);
            const overlapRight = Math.min(s.x + s.width, entity.rect.x + entity.rect.width);
            if (overlapRight - overlapLeft > 0) {
              seen.add(s.id);
              result.push(s);
            }
          }
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// BFS
// ---------------------------------------------------------------------------

/**
 * Run forward BFS from a set of surface ids.
 *
 * Visit order is deterministic: surfaces are visited in lexicographic `id`
 * order at each frontier expansion.
 *
 * @param edges - The jump edges in the reachability graph.
 * @param startIds - Surface ids to start BFS from.
 * @returns A set of reachable surface ids.
 */
function forwardBfs(edges: JumpEdge[], startIds: Set<string>): Set<string> {
  const visited = new Set<string>(startIds);
  const queue: string[] = [...startIds];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const edge of edges) {
      if (edge.from.id === current && !visited.has(edge.to.id)) {
        visited.add(edge.to.id);
        queue.push(edge.to.id);
      }
    }

    // Deterministic: sort queue after each expansion
    queue.sort();
  }

  return visited;
}

/**
 * Run backward BFS from a set of target surface ids.
 *
 * Follows edges in reverse (`edge.to → edge.from`). Visit order is
 * lexicographic for determinism.
 */
function backwardBfs(edges: JumpEdge[], targetIds: Set<string>): Set<string> {
  const visited = new Set<string>(targetIds);
  const queue: string[] = [...targetIds];

  // Build reverse adjacency for efficiency
  const reverseAdj = new Map<string, string[]>();
  for (const edge of edges) {
    const adj = reverseAdj.get(edge.to.id);
    if (adj) {
      adj.push(edge.from.id);
    } else {
      reverseAdj.set(edge.to.id, [edge.from.id]);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = reverseAdj.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    // Deterministic sort
    queue.sort();
  }

  return visited;
}

// ---------------------------------------------------------------------------
// buildReachGraph
// ---------------------------------------------------------------------------

/**
 * Build the reachability graph for a compiled level.
 *
 * Extracts standing surfaces from `compiled.staticSolids`, computes jump
 * edges between all pairs via `computeJumpArc`, and returns the complete
 * graph structure.
 *
 * Moving platforms in `compiled.movingPlatforms` do not contribute surfaces;
 * the graph is still built for diagnostic purposes when moving platforms
 * are present, but the confidence is `'unsupported'`.
 *
 * **Pure:** never mutates input, never throws. Malformed solids are skipped
 * gracefully.
 *
 * @param compiled - A compiled level (from `compileLevel` or `compileGeneratedLevel`).
 * @param config   - Optional reachability config (jump-arc overrides, etc.).
 * @returns The reachability graph with surfaces and jump edges.
 *
 * @example
 * ```ts
 * const compiled = compileLevel(myLevel);
 * const graph = buildReachGraph(compiled);
 * // graph.surfaces.length > 0
 * // graph.edges includes feasible jumps
 * ```
 */
export function buildReachGraph(
  compiled: CompiledLevel,
  config?: ReachabilityConfig,
): ReachGraph {
  const jumpArc = config?.jumpArc ?? DEFAULT_JUMP_ARC_CONFIG;
  const surfaces = extractSurfaces(compiled);
  const edges = computeEdges(surfaces, jumpArc);

  return { surfaces, edges };
}

// ---------------------------------------------------------------------------
// analyzeReachability
// ---------------------------------------------------------------------------

/**
 * Perform a full static reachability analysis on a level.
 *
 * This is the canonical entry point for editor-level diagnostics. It:
 * 1. Compiles the level (structural/runtime transform).
 * 2. Extracts standing surfaces from static geometry.
 * 3. Computes feasible jump edges via `computeJumpArc`.
 * 4. Finds the spawn and exit surfaces.
 * 5. Runs forward BFS to determine reachable surfaces.
 * 6. Optionally runs backward BFS to detect softlocks.
 * 7. Reports confidence, diagnostics, and structured results.
 *
 * **Pure:** never mutates input, never throws. Degrades gracefully on
 * malformed level data (returns empty surfaces and diagnostics).
 *
 * @param level  - The level data to analyze.
 * @param config - Optional config (compile options, jump arc overrides,
 *                 softlock detection toggle).
 * @returns A `ReachabilityResult` with the full analysis.
 *
 * @example
 * ```ts
 * const result = analyzeReachability(myLevel, { verifySoftlocks: true });
 * if (result.reachable) {
 *   console.log('Level is beatable (static analysis).');
 * }
 * if (result.softlockSurfaces.length > 0) {
 *   console.log('Softlock detected:', result.softlockSurfaces.length, 'surfaces');
 * }
 * ```
 */
export function analyzeReachability(
  level: LevelData,
  config?: ReachabilityConfig,
): ReachabilityResult {
  const diagnostics: string[] = [];

  // -----------------------------------------------------------------------
  // Step 1: Compile
  // -----------------------------------------------------------------------
  let compiled: CompiledLevel;
  try {
    compiled = compileLevel(level);
  } catch {
    // Belt-and-braces (compileLevel documents itself as never-throwing): a
    // real placeholder state, never `null as any` flowing downstream.
    compiled = {
      staticSolids: [],
      movingPlatforms: [],
      initialState: createPlatformerState(0, 0),
      tileQuery: () => 'empty' as const,
    };
    diagnostics.push('Failed to compile level for reachability analysis.');
  }

  // -----------------------------------------------------------------------
  // Step 2: Build graph
  // -----------------------------------------------------------------------
  const jumpArc: JumpArcConfig = config?.jumpArc ?? {
    ...DEFAULT_JUMP_ARC_CONFIG,
    platformerConfig: DEFAULT_PLATFORMER_CONFIG,
  };
  const surfaces = extractSurfaces(compiled);
  const edges = computeEdges(surfaces, jumpArc);

  // -----------------------------------------------------------------------
  // Step 3: Determine confidence
  // -----------------------------------------------------------------------
  const hasMovingPlatforms = compiled.movingPlatforms.length > 0;
  let confidence: ReachabilityConfidence;
  if (hasMovingPlatforms) {
    confidence = 'unsupported';
    diagnostics.push(
      `Level contains ${compiled.movingPlatforms.length} moving platform(s). ` +
      'Time-varying reachability is not yet implemented. Results are diagnostic only.',
    );
  } else {
    confidence = 'sound-over-approximation';
  }

  // -----------------------------------------------------------------------
  // Step 4: Find spawn and exit surfaces
  // -----------------------------------------------------------------------
  const playerWidth = jumpArc.playerWidth;
  const playerHeight = jumpArc.playerHeight;

  let spawnSurface: Surface | null = null;
  try {
    const spawn = level.spawn ?? { x: 0, y: 0 };
    spawnSurface = findSpawnSurface(surfaces, spawn, playerWidth, playerHeight);
    if (!spawnSurface) {
      diagnostics.push('No standing surface found at spawn point.');
    }
  } catch {
    diagnostics.push('Failed to resolve spawn surface.');
  }

  let exitSurfaces: Surface[] = [];
  try {
    exitSurfaces = findExitSurfaces(surfaces, level);
    if (exitSurfaces.length === 0) {
      diagnostics.push('No exit surfaces found in level.');
    }
  } catch {
    diagnostics.push('Failed to resolve exit surfaces.');
  }

  // -----------------------------------------------------------------------
  // Step 5: Forward BFS
  // -----------------------------------------------------------------------
  let reachableIds = new Set<string>();
  let reachableSurfaces: Surface[] = [];

  if (spawnSurface) {
    try {
      reachableIds = forwardBfs(edges, new Set([spawnSurface.id]));
      reachableSurfaces = surfaces.filter((s) => reachableIds.has(s.id));
    } catch {
      diagnostics.push('Forward BFS encountered an error.');
      reachableIds = new Set([spawnSurface.id]);
      reachableSurfaces = [spawnSurface];
    }
  }

  // -----------------------------------------------------------------------
  // Step 6: Reachability verdict
  // -----------------------------------------------------------------------
  const anyExitReachable = exitSurfaces.length > 0 && exitSurfaces.some((s) => reachableIds.has(s.id));
  const reachable = !hasMovingPlatforms && anyExitReachable;

  if (!anyExitReachable && exitSurfaces.length > 0 && !hasMovingPlatforms) {
    diagnostics.push('No exit surface is reachable from spawn.');
  }

  // -----------------------------------------------------------------------
  // Step 7: Softlock detection (opt-in)
  // -----------------------------------------------------------------------
  let softlockSurfaces: Surface[] = [];

  if (config?.verifySoftlocks && exitSurfaces.length > 0) {
    try {
      const exitIds = new Set(exitSurfaces.map((s) => s.id));
      const backwardReachable = backwardBfs(edges, exitIds);
      softlockSurfaces = reachableSurfaces.filter(
        (s) => !backwardReachable.has(s.id),
      );
      if (softlockSurfaces.length > 0) {
        diagnostics.push(
          `${softlockSurfaces.length} surface(s) are reachable from spawn but not ` +
          'backward-reachable from any exit (potential softlock).',
        );
      }
    } catch {
      diagnostics.push('Backward BFS for softlock detection encountered an error.');
    }
  }

  // -----------------------------------------------------------------------
  // Step 8: Return structured result
  // -----------------------------------------------------------------------
  return {
    version: 1 as const,
    confidence,
    reachable,
    graph: { surfaces, edges },
    spawnSurface,
    exitSurfaces,
    reachableSurfaces,
    softlockSurfaces,
    diagnostics,
  };
}
