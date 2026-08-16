/**
 * Type definitions for the procedural level generator (`src/levelgen/`).
 *
 * These types describe the blueprint, generation pipeline, quality scoring,
 * and verification report for procedurally generated platformer levels.
 *
 * All types are plain readonly data — no closures, no `Set`/`Map`, no
 * circular references. Deterministic contract: same `(seed, config)` →
 * same output, forever.
 *
 * @module
 */

import type { PlatformerConfig } from '../platformer/types';
import type { GeneratedTileSemantics } from '../level/tile-semantics';

// ---------------------------------------------------------------------------
// LevelGenConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for procedural level generation.
 *
 * All fields are optional — defaults live in {@link DEFAULT_LEVEL_GEN_CONFIG}.
 * The same `(seed, config)` pair always produces the same generated level.
 */
export interface LevelGenConfig {
  /** Stable level identifier. Default `''`. */
  readonly id?: string;
  /** Human-facing display name. Default `'Generated Level'`. */
  readonly name?: string;
  /** Number of tile columns (width in tiles). Default `60`. */
  readonly cols?: number;
  /** Number of tile rows (height in tiles). Default `15`. */
  readonly rows?: number;
  /** Pixel size of each tile. Default `16`. */
  readonly tileSize?: number;
  /** Target difficulty in `[0, 1]`. Default `0.5`. */
  readonly difficulty?: number;
  /** Number of deterministic candidates to generate. Default `8`. */
  readonly candidateCount?: number;
  /** Maximum targeted repair passes. Default `2`. */
  readonly maxRepairPasses?: number;
  /** First entity ID to allocate. Default `DEFAULT_ENTITY_ID_START` (1). */
  readonly entityIdStart?: number;
  /**
   * Explicit tile-value semantics for this generated level.
   * Default: `{ solid: [1], passthrough: [2] }`.
   */
  readonly tileSemantics?: Readonly<GeneratedTileSemantics>;
  /**
   * Authoritative platformer configuration for physics constraint
   * derivation. Default: `DEFAULT_PLATFORMER_CONFIG`.
   */
  readonly platformerConfig?: Readonly<PlatformerConfig>;
  /** Player body width in pixels. Default `16`. */
  readonly playerWidth?: number;
  /** Player body height in pixels. Default `24`. */
  readonly playerHeight?: number;
  /** Fixed simulation timestep in seconds. Default `1/60`. */
  readonly fixedDt?: number;
  /** Partial quality weights to override defaults. */
  readonly qualityWeights?: Partial<QualityWeights>;
}

// ---------------------------------------------------------------------------
// Route types
// ---------------------------------------------------------------------------

/**
 * A single node in the macro route graph.
 *
 * Nodes are placed at tile-space positions that describe the rough path a
 * player takes through the level.
 */
export interface RouteNode {
  /** Stable identifier (e.g. `'start'`, `'exit'`, `'branch-0'`). */
  readonly id: string;
  /** X position in tile coordinates. */
  readonly x: number;
  /** Y position in tile coordinates. */
  readonly y: number;
  /** Role of this node in the route. */
  readonly kind: 'start' | 'exit' | 'checkpoint' | 'branch' | 'reward';
}

/**
 * A directed edge between two {@link RouteNode}s.
 */
export interface RouteEdge {
  /** Source node id. */
  readonly from: string;
  /** Target node id. */
  readonly to: string;
  /** Role of this edge in the route. */
  readonly kind: 'main' | 'branch' | 'secret';
}

/**
 * The macro route graph — establishes start, exit, critical-path ordering,
 * optional branches, and reward locations before any geometry is placed.
 */
export interface RouteGraph {
  /** Schema version. Must be `1`. */
  readonly version: 1;
  /** All nodes in the route graph. */
  readonly nodes: readonly RouteNode[];
  /** All edges connecting nodes. */
  readonly edges: readonly RouteEdge[];
}

// ---------------------------------------------------------------------------
// Pacing / rhythm types
// ---------------------------------------------------------------------------

/**
 * A single pacing beat describing the gameplay feel for a segment.
 *
 * - `'introduce'`: gentle beginning, safe and wide.
 * - `'run'`: flat ground, maintain speed.
 * - `'jump'`: requires a single jump over a gap.
 * - `'precisionJump'`: tight landing, requires accurate jump.
 * - `'dash'`: requires the dash ability.
 * - `'rest'`: flat ground, recovery, optional collectible.
 * - `'reward'`: collectibles, no threat.
 * - `'branch'`: optional path splits off.
 * - `'climax'`: most intense section of the level.
 * - `'release'`: gentler section after climax, leading to exit.
 */
export type PacingBeat =
  | 'introduce'
  | 'run'
  | 'jump'
  | 'precisionJump'
  | 'dash'
  | 'rest'
  | 'reward'
  | 'branch'
  | 'climax'
  | 'release';

/**
 * A required gameplay mechanic.
 */
export interface RequiredMechanic {
  /** Mechanic identifier. */
  readonly name: 'jump' | 'dash' | 'doubleJump' | 'wallJump' | 'wallSlide';
  /** Whether this mechanic is enabled for this level. */
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// Blueprint
// ---------------------------------------------------------------------------

/**
 * A deterministic level blueprint — the intermediate representation between
 * macro design and geometry realization.
 *
 * A blueprint can be authored by an LLM, hand-tuned, or procedurally generated.
 * It must pass through {@link realizeBlueprint} to produce concrete level geometry.
 */
export interface LevelBlueprint {
  /** Schema version. Must be `1`. */
  readonly version: 1;
  /** Macro route graph. */
  readonly route: RouteGraph;
  /** Pacing/rhythm plan. */
  readonly pacing: readonly PacingBeat[];
  /** Mechanics required by this blueprint. */
  readonly requiredMechanics: readonly RequiredMechanic[];
  /** Target difficulty `[0, 1]`. */
  readonly targetDifficulty: number;
}

// ---------------------------------------------------------------------------
// Repair and diagnostics
// ---------------------------------------------------------------------------

/**
 * A single targeted repair applied during generation.
 */
export interface RepairRecord {
  /** Schema version. Must be `1`. */
  readonly version: 1;
  /** Machine-readable diagnostic that triggered the repair. */
  readonly diagnostic: string;
  /** Description of the repair applied. */
  readonly repair: string;
  /** Tick (iteration) at which this repair was applied. */
  readonly tick: number;
}

/**
 * A diagnostic message from the generation pipeline.
 */
export interface GenerationDiagnostic {
  /** Severity of the diagnostic. */
  readonly severity: 'info' | 'warning' | 'error';
  /** Machine-readable code (e.g. `'GRID_TOO_LARGE'`). */
  readonly code: string;
  /** Human-readable message describing the issue. */
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Quality scoring
// ---------------------------------------------------------------------------

/**
 * Weight configuration for the quality scoring model.
 *
 * All values must sum to `1.0` (or be normalized before use). Each weight is
 * in `[0, 1]`.
 */
export interface QualityWeights {
  /** Weight for pacing quality. */
  readonly pacing: number;
  /** Weight for variety quality. */
  readonly variety: number;
  /** Weight for fairness quality. */
  readonly fairness: number;
  /** Weight for exploration quality. */
  readonly exploration: number;
  /** Weight for difficulty-fit quality. */
  readonly difficultyFit: number;
  /** Weight for readability quality. */
  readonly readability: number;
}

/**
 * A safety metric for a single jump edge in the level.
 */
export interface JumpSafetyMetric {
  /** Source node id. */
  readonly from: string;
  /** Target node id. */
  readonly to: string;
  /** Safety margin in pixels (positive = safe, negative = unsafe). */
  readonly margin: number;
  /** Whether this jump is feasible with the configured physics. */
  readonly feasible: boolean;
}

/**
 * Diagnostic for quality evaluation.
 */
export interface QualityDiagnostic {
  readonly severity: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly message: string;
}

/**
 * Quality report for a generated level.
 *
 * All component scores are finite values in `[0, 1]`. The overall `score` is
 * a normalized weighted mean of the component scores.
 */
export interface LevelQualityReport {
  /** Schema version. Must be `1`. */
  readonly version: 1;
  /** Overall quality score `[0, 1]`. */
  readonly score: number;
  /** Pacing score `[0, 1]`. */
  readonly pacing: number;
  /** Variety score `[0, 1]`. */
  readonly variety: number;
  /** Fairness score `[0, 1]`. */
  readonly fairness: number;
  /** Exploration score `[0, 1]`. */
  readonly exploration: number;
  /** Difficulty-fit score `[0, 1]`. */
  readonly difficultyFit: number;
  /** Readability score `[0, 1]`. */
  readonly readability: number;
  /** Measured difficulty `[0, 1]` from actual geometry. */
  readonly measuredDifficulty: number;
  /** Estimated critical-path completion ticks, if available. */
  readonly criticalPathTicks?: number;
  /** Safety margins for each jump in the level. */
  readonly safetyMargins: readonly JumpSafetyMetric[];
  /** Quality diagnostics. */
  readonly diagnostics: readonly QualityDiagnostic[];
}

// ---------------------------------------------------------------------------
// Verification result (Phase 4 stub — full implementation in Phase 5)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Verification types — consolidated onto leveltest (0.17.0)
//
// These were hand-re-duplicated here with a 4-field reachability summary
// versus leveltest's 9-field graph result — a divergence that forced
// `as unknown as` bridges in calibration.ts and candidates.ts. They are now
// re-exported from their canonical homes; summarizeReachability projects
// the compact shape levelgen historically consumed.
// ---------------------------------------------------------------------------

import type { ReachabilityConfidence, ReachabilityResult } from '../leveltest/types';
import type {
  VerificationResult,
  VerificationStatus,
  VerificationDiagnostic,
} from '../leveltest/verify';

export type { ReachabilityConfidence, ReachabilityResult };
export type { VerificationResult, VerificationStatus, VerificationDiagnostic };

/** Compact reachability summary — the pre-consolidation levelgen shape. */
export interface VerificationSummary {
  /** Confidence level of the analysis. */
  readonly confidence: ReachabilityConfidence;
  /** Whether a reachable path from spawn to any exit was found. */
  readonly reachable: boolean;
  /** Number of surfaces in the reachability graph. */
  readonly nodeCount: number;
  /** Human-readable summary (joined reachability diagnostics). */
  readonly summary: string;
}

/**
 * Project a leveltest {@link ReachabilityResult} into the compact
 * {@link VerificationSummary} levelgen historically consumed. Pure, total.
 */
export function summarizeReachability(reach: ReachabilityResult): VerificationSummary {
  return {
    confidence: reach.confidence,
    reachable: reach.reachable,
    nodeCount: Array.isArray(reach.graph?.surfaces) ? reach.graph.surfaces.length : 0,
    summary: Array.isArray(reach.diagnostics) ? reach.diagnostics.join('; ') : '',
  };
}

// ---------------------------------------------------------------------------
// Generation report and output
// ---------------------------------------------------------------------------

/**
 * Complete report for a single generation attempt.
 */
export interface GenerationReport {
  /** Schema version. Must be `1`. */
  readonly version: 1;
  /** Root seed used for this generation. */
  readonly seed: number;
  /** Candidate index (0-based) within the candidate search. */
  readonly candidateIndex: number;
  /** Repair records from targeted repair passes. */
  readonly repairs: readonly RepairRecord[];
  /** Verification result (may be stub-based before Phase 5). */
  readonly verification: VerificationResult;
  /** Quality report. */
  readonly quality: LevelQualityReport;
  /** Generation-level diagnostics. */
  readonly diagnostics: readonly GenerationDiagnostic[];
}

/**
 * A fully generated level with its tile semantics, editor operation, and
 * generation report.
 *
 * The `editorOp` is a singular `replaceLevel` operation that reproduces
 * the level byte-for-byte when applied to any editor state:
 *
 * ```ts
 * applyOp(createEditorState(base), generated.editorOp).level
 *   deep-equals generated.level
 * ```
 */
export interface GeneratedLevel {
  /** The generated level data. Passes `validateLevel`. */
  readonly level: import('../level/types').LevelData;
  /** Editor operation that reproduces this level from any base. */
  readonly editorOp: import('../editor/types').EditorOperation & { readonly type: 'replaceLevel' };
  /** Tile-value semantics for this generated level. */
  readonly tileSemantics: GeneratedTileSemantics;
  /** Generation report with diagnostic, verification, and quality data. */
  readonly report: GenerationReport;
}
