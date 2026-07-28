/**
 * Deterministic terrain-foundation types.
 *
 * Phase 1 contains geometry and addressing contracts only. Materials and
 * drawing are added in Phase 2.
 *
 * @module
 */

import type { LevelRect } from '../level/types';

/** Eight-neighbor connection bitmask. */
export type TerrainNeighborMask = number;

/** Named booleans plus the compact eight-neighbor bitmask. */
export interface TerrainNeighborhood {
  readonly mask: TerrainNeighborMask;
  readonly north: boolean;
  readonly northEast: boolean;
  readonly east: boolean;
  readonly southEast: boolean;
  readonly south: boolean;
  readonly southWest: boolean;
  readonly west: boolean;
  readonly northWest: boolean;
}

/** Sparse connection lookup over ordered tile-value pairs observed in a grid. */
export interface TerrainConnectionTable {
  readonly connects: (centerValue: number, neighborValue: number) => boolean;
}

/** The authoritative world-space rectangle currently visible. */
export interface TerrainViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Half-open visible grid indices. */
export interface VisibleTileRange {
  readonly startCol: number;
  readonly endCol: number;
  readonly startRow: number;
  readonly endRow: number;
}

/** Half-open world-space interval along one rectangle edge. */
export interface ExposedSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * Exposed edge intervals. Top/bottom spans use X; left/right spans use Y.
 */
export interface TerrainRectExposure {
  readonly top: readonly ExposedSpan[];
  readonly right: readonly ExposedSpan[];
  readonly bottom: readonly ExposedSpan[];
  readonly left: readonly ExposedSpan[];
}

/** Static terrain rectangle used during level preparation. */
export interface TerrainRectInput {
  readonly key: number;
  readonly rect: Readonly<LevelRect>;
  readonly familyId: number;
  readonly minimumSpan?: number;
}

/** Options for static rectangle exposure preparation. */
export interface ComputeRectExposureOptions {
  readonly connects?: (centerFamily: number, neighborFamily: number) => boolean;
  readonly epsilon?: number;
}

/** Colors used by a terrain material. Only `fill` is required when authoring. */
export interface TerrainPalette {
  readonly fill: string;
  readonly top?: string;
  readonly side?: string;
  readonly shadow?: string;
  readonly outline?: string;
  readonly detail?: string;
  readonly accent?: string;
}

export type BuiltinSurfaceDetail =
  | 'none'
  | 'mortar'
  | 'cracks'
  | 'rivulets'
  | 'rivets'
  | 'crystal';

/** Loose author-facing terrain material. Normalize once before drawing. */
export interface TerrainMaterialInput {
  readonly id: string;
  readonly palette: Readonly<TerrainPalette>;
  readonly topThickness?: number;
  readonly sideDepth?: number;
  readonly outlineWidth?: number;
  readonly cornerSize?: number;
  readonly surfaceDetail?: BuiltinSurfaceDetail;
  readonly detailDensity?: number;
  readonly detailScale?: number;
}

export type TerrainRectRole = 'solid' | 'passthrough' | 'moving' | 'hazard';
