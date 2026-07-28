/**
 * Type definitions for the level-test module (`src/leveltest/`).
 *
 * This module provides static reachability analysis and trajectory sampling
 * for platformer levels. It is the platformer-specific layer atop the generic
 * simulation-test module (`src/simtest/`), consuming `CompiledLevel` from the
 * runtime bridge (`src/platformer/level-runtime.ts`) rather than raw `LevelData`.
 *
 * **Determinism:** All functions are pure — same input → same output, forever.
 * No `Math.random`, no `Date.now()`, no DOM reads, no global mutable state.
 * BFS visit order is pinned by lexicographic `Surface.id`.
 *
 * **Truthfulness rules:**
 * - A sound over-approximation may prove unreachable when no path exists.
 * - A heuristic graph may suggest reachable/unreachable but cannot prove failure.
 * - A level using unsupported mechanics returns `unsupported`/inconclusive.
 *
 * @module
 */

import type { JumpArcConfig } from './trajectory';

// ---------------------------------------------------------------------------
// ReachabilityConfidence
// ---------------------------------------------------------------------------

/**
 * Describes the abstraction mode of a reachability analysis.
 *
 * - `'sound-over-approximation'`: every plausible jump is included; the graph
 *   may overestimate reachability but never underestimates. A missing path
 *   is proof of unreachability.
 * - `'heuristic'`: a best-effort graph that may miss valid routes or include
 *   impossible ones. Cannot prove unreachability.
 * - `'unsupported'`: the level uses mechanics (e.g. moving platforms) that
 *   are not modeled. The graph is built for diagnostic purposes but cannot
 *   support reachability decisions.
 */
export type ReachabilityConfidence =
  | 'sound-over-approximation'
  | 'heuristic'
  | 'unsupported';

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

/**
 * A standing surface extracted from compiled level geometry.
 *
 * Each `Solid` in `CompiledLevel.staticSolids` produces one surface for its
 * top face. The `id` matches the source solid's `id` (e.g. `'entity-1'` or
 * `'tile-0-400-800-16'`) for stable traceability.
 */
export interface Surface {
  /** Stable identifier matching the source solid's `id`. */
  readonly id: string;
  /** World-space X of the surface's left edge. */
  readonly x: number;
  /** World-space Y of the surface's top face (the standing Y). */
  readonly y: number;
  /** Surface width in world units. */
  readonly width: number;
  /** `true` if this surface is a one-way passthrough platform. */
  readonly passthrough: boolean;
  /** The source entity's numeric id, if the solid came from a level entity. */
  readonly entityId?: number;
}

// ---------------------------------------------------------------------------
// JumpEdge
// ---------------------------------------------------------------------------

/**
 * A directed edge in the reachability graph — a feasible jump from one
 * standing surface to another.
 */
export interface JumpEdge {
  /** The source surface. */
  readonly from: Surface;
  /** The destination surface. */
  readonly to: Surface;
  /** `true` if the jump requires a dash to complete. */
  readonly requiresDash: boolean;
  /** Estimated airtime in seconds. */
  readonly airtime: number;
  /** Difficulty score in `[0, 1]` (higher = harder). */
  readonly difficulty: number;
}

// ---------------------------------------------------------------------------
// ReachGraph
// ---------------------------------------------------------------------------

/**
 * The complete directed graph of standing surfaces and feasible jumps for
 * a compiled level.
 */
export interface ReachGraph {
  /** All extracted standing surfaces, sorted by `id` (lexicographic). */
  readonly surfaces: readonly Surface[];
  /** All feasible jump edges between surfaces. */
  readonly edges: readonly JumpEdge[];
}

// ---------------------------------------------------------------------------
// ReachabilityResult
// ---------------------------------------------------------------------------

/**
 * The complete result of a static reachability analysis.
 */
export interface ReachabilityResult {
  /** Schema version. Must be `1`. */
  readonly version: 1;
  /** Abstraction mode describing what this result can prove. */
  readonly confidence: ReachabilityConfidence;
  /**
   * `true` when at least one exit surface is reachable from the spawn surface
   * via the reachability graph. When `confidence` is `'unsupported'`, this is
   * always `false` (inconclusive).
   */
  readonly reachable: boolean;
  /** The full reachability graph (always built, even for unsupported levels). */
  readonly graph: ReachGraph;
  /** The surface the player starts on, or `null` if no surface at spawn. */
  readonly spawnSurface: Surface | null;
  /** Surfaces that correspond to exit entities in the level. */
  readonly exitSurfaces: readonly Surface[];
  /** Subset of `graph.surfaces` reachable from the spawn surface. */
  readonly reachableSurfaces: readonly Surface[];
  /**
   * Surfaces reachable from spawn but not backward-reachable from any exit.
   * Only populated when `verifySoftlocks` is enabled in config.
   */
  readonly softlockSurfaces: readonly Surface[];
  /** Human-readable diagnostics for editors and debugging. */
  readonly diagnostics: readonly string[];
}

// ---------------------------------------------------------------------------
// ReachabilityConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for reachability analysis.
 */
export interface ReachabilityConfig {
  /**
   * Jump-arc config for computing edge feasibility. When omitted, defaults
   * are derived from `DEFAULT_PLATFORMER_CONFIG`.
   */
  readonly jumpArc?: JumpArcConfig;
  /**
   * If `true`, run backward BFS from exit surfaces to detect softlocks
   * (surfaces that are forward-reachable from spawn but not backward-reachable
   * from any exit). Default `false`.
   */
  readonly verifySoftlocks?: boolean;
}
