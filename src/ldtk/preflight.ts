/**
 * LDtk platformer project preflight — a PURE, fully deterministic inspection
 * of a parsed {@link LdtkProject}.
 *
 * Produces a structural report the integration layer's "asset preflight" (G3
 * stage) consumes: per-room spawn presence, entity counts by engine kind,
 * connectivity, aggregated capabilities, tile-size consistency, and a list of
 * any entity identifiers that would fall through to the engine's `'trigger'`
 * escape hatch (the unknown-identifier extension point).
 *
 * Determinism / purity: NO host access (no `fetch`, no DOM, no `Date`, no
 * `Math.random`). Same input → same output, bit-for-bit. Never throws — a
 * degenerate or empty project yields an empty/minimal report, not an error.
 *
 * Kind resolution reuses {@link LDTK_DEFAULT_ENTITY_MAP} so this report's
 * notion of "spring" / "dashRefill" / etc. matches exactly what
 * {@link ldtkLevelToLevelData} will produce at runtime.
 *
 * @module
 */

import type { LdtkLevel, LdtkProject } from './types';
import { LDTK_DEFAULT_ENTITY_MAP } from './translate';
import type { LdtkAssetDiagnostic } from './load';

/** Capabilities aggregated across every level of a project. */
export interface LdtkPlatformerCapabilities {
  readonly hazards: boolean;
  readonly collectibles: boolean;
  readonly springs: boolean;
  readonly dashRefills: boolean;
  readonly exits: boolean;
  readonly ladders: boolean;
  readonly movingPlatforms: boolean;
}

/** Per-level summary within a project report. */
export interface LdtkPlatformerLevelReport {
  readonly iid: string;
  readonly identifier: string;
  /** Whether the level contains a spawn entity (Player/Spawn/Start). */
  readonly hasSpawn: boolean;
  /** Authored position (top-left px) of the first spawn entity, if any. */
  readonly spawn?: { readonly x: number; readonly y: number };
  /** Derived tile size for this level (first layer gridSize, else 0). */
  readonly tileSize: number;
  /** Entity counts keyed by resolved engine kind (unknown → `'trigger'`). */
  readonly entityCounts: Readonly<Record<string, number>>;
  /** Distinct neighbouring level iids (from `__neighbours`). */
  readonly neighbourIids: readonly string[];
  /** Reachable from some spawn room via `__neighbours` BFS. */
  readonly connected: boolean;
}

/**
 * Structural inspection of a parsed LDtk platformer project.
 *
 * @see {@link inspectLdtkPlatformerProject} for the full field-by-field contract.
 */
export interface LdtkPlatformerProjectReport {
  readonly levelCount: number;
  readonly levels: readonly LdtkPlatformerLevelReport[];
  /** Unique tile sizes observed across levels (encounter order). */
  readonly tileSizes: readonly number[];
  /** Tileset `relPath`s declared by the project (non-icon, non-empty). */
  readonly tilesetRelPaths: readonly string[];
  /** Total spawn entities across all levels. */
  readonly totalSpawns: number;
  /** Iids of levels without a spawn entity. */
  readonly spawnLessRoomIids: readonly string[];
  /** Iids of levels not reachable from any spawn room via `__neighbours` BFS. */
  readonly disconnectedRoomIids: readonly string[];
  readonly capabilities: LdtkPlatformerCapabilities;
  /**
   * Entity identifiers that resolve to `null` under
   * {@link LDTK_DEFAULT_ENTITY_MAP} and would therefore become `'trigger'` at
   * runtime. Recognized identifiers (Spring, DashRefill, …) are excluded.
   */
  readonly unknownTriggerIdentifiers: readonly string[];
  /** Info / warning diagnostics (never error severity). */
  readonly diagnostics: readonly LdtkAssetDiagnostic[];
}

/** Resolve every level of a project, whether single- or multi-world. */
function allLevels(project: LdtkProject): readonly LdtkLevel[] {
  if (project.worlds.length > 0) {
    return project.worlds.flatMap((w) => w.levels);
  }
  return project.levels;
}

/** Derive a level's tile size from its first layer with a positive gridSize. */
function levelTileSize(level: LdtkLevel): number {
  const layers = level.layerInstances;
  if (layers !== null) {
    for (const l of layers) {
      if (l.__gridSize > 0) return l.__gridSize;
    }
  }
  return 0;
}

/**
 * Collect IntGrid values named `'ladder'` (case-insensitive, exact) across all
 * IntGrid layer definitions. The runtime overlays these as climb space.
 */
function ladderIntGridValues(project: LdtkProject): Set<number> {
  const out = new Set<number>();
  for (const def of project.defs.layers) {
    if (def.__type !== 'IntGrid') continue;
    for (const v of def.intGridValues ?? []) {
      if (v.identifier !== null && v.identifier.toLowerCase() === 'ladder') {
        out.add(v.value);
      }
    }
  }
  return out;
}

/** True if any collision IntGrid cell in any level holds a ladder value. */
function projectHasLadders(levels: readonly LdtkLevel[], ladderValues: Set<number>): boolean {
  if (ladderValues.size === 0) return false;
  for (const level of levels) {
    const layers = level.layerInstances;
    if (layers === null) continue;
    const collision = layers.find((l) => l.__type === 'IntGrid');
    const csv = collision?.intGridCsv;
    if (csv === undefined) continue;
    for (const v of csv) {
      if (ladderValues.has(v)) return true;
    }
  }
  return false;
}

/**
 * Inspect a parsed LDtk platformer project and return a structural report.
 *
 * Walks every level (single- or multi-world), resolving each entity to an
 * engine kind via {@link LDTK_DEFAULT_ENTITY_MAP} (unknown → `'trigger'`),
 * recording spawn presence/location, tile size, neighbour iids, and entity
 * counts. Connectivity is a BFS from every spawn room over the undirected
 * `__neighbours` graph; a room is `connected` iff reachable. Capabilities are
 * OR-aggregated across levels. Diagnostics are info/warning only (preflight
 * never produces errors and never throws).
 *
 * @param project - A parsed {@link LdtkProject} (from {@link parseLdtkProject}).
 * @returns A deterministic {@link LdtkPlatformerProjectReport}.
 */
export function inspectLdtkPlatformerProject(project: LdtkProject): LdtkPlatformerProjectReport {
  const levels = allLevels(project);

  // Per-level summaries + global aggregates.
  const levelReports: LdtkPlatformerLevelReport[] = [];
  const globalCounts: Record<string, number> = {};
  const unknownTrigger = new Set<string>();
  let totalSpawns = 0;

  // Build the (undirected) neighbour graph as we walk levels.
  const adjacency = new Map<string, Set<string>>();

  for (const level of levels) {
    if (!adjacency.has(level.iid)) adjacency.set(level.iid, new Set());
    for (const n of level.__neighbours) {
      if (n.levelIid === '') continue;
      adjacency.get(level.iid)!.add(n.levelIid);
      if (!adjacency.has(n.levelIid)) adjacency.set(n.levelIid, new Set());
      adjacency.get(n.levelIid)!.add(level.iid);
    }
  }

  for (const level of levels) {
    const layers = level.layerInstances ?? [];
    const entityLayers = layers.filter((l) => l.__type === 'Entities');

    const counts: Record<string, number> = {};
    let hasSpawn = false;
    let spawn: { x: number; y: number } | undefined;

    for (const layer of entityLayers) {
      for (const entity of layer.entityInstances ?? []) {
        const resolved = LDTK_DEFAULT_ENTITY_MAP.resolve(entity.__identifier, entity.__tags);
        const kind = resolved ?? 'trigger';
        if (resolved === null) unknownTrigger.add(entity.__identifier);
        counts[kind] = (counts[kind] ?? 0) + 1;
        globalCounts[kind] = (globalCounts[kind] ?? 0) + 1;
        if (kind === 'spawn') {
          totalSpawns++;
          if (!hasSpawn) {
            hasSpawn = true;
            spawn = { x: entity.px[0], y: entity.px[1] };
          }
        }
      }
    }

    const neighbourIids: string[] = [];
    const seen = new Set<string>();
    for (const n of level.__neighbours) {
      if (n.levelIid !== '' && !seen.has(n.levelIid)) {
        seen.add(n.levelIid);
        neighbourIids.push(n.levelIid);
      }
    }

    levelReports.push({
      iid: level.iid,
      identifier: level.identifier,
      hasSpawn,
      ...(spawn !== undefined ? { spawn } : {}),
      tileSize: levelTileSize(level),
      entityCounts: counts,
      neighbourIids,
      // `connected` is finalized after the BFS below.
      connected: true,
    });
  }

  // --- Connectivity: BFS from every spawn room over the neighbour graph. ---
  const spawnRoots = levelReports.filter((r) => r.hasSpawn).map((r) => r.iid);
  const reachable = new Set<string>();
  if (spawnRoots.length > 0) {
    for (const r of spawnRoots) reachable.add(r);
    const queue = [...spawnRoots];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nb of adjacency.get(cur) ?? []) {
        if (!reachable.has(nb)) {
          reachable.add(nb);
          queue.push(nb);
        }
      }
    }
  }
  const connectedByIid = new Map<string, boolean>();
  for (const r of levelReports) {
    // No spawn rooms at all → connectivity is undefined; treat all as connected
    // (nothing to be disconnected FROM) and surface a diagnostic instead.
    const connected = spawnRoots.length === 0 ? true : reachable.has(r.iid);
    connectedByIid.set(r.iid, connected);
  }
  const finalizedLevels = levelReports.map((r) => ({
    ...r,
    connected: connectedByIid.get(r.iid) ?? true,
  }));

  // --- Derived roll-ups. ---
  const spawnLessRoomIids = finalizedLevels.filter((r) => !r.hasSpawn).map((r) => r.iid);
  const disconnectedRoomIids = finalizedLevels.filter((r) => !r.connected).map((r) => r.iid);

  const tileSizeSet = new Set<number>();
  const tileSizes: number[] = [];
  for (const r of finalizedLevels) {
    if (!tileSizeSet.has(r.tileSize)) {
      tileSizeSet.add(r.tileSize);
      tileSizes.push(r.tileSize);
    }
  }

  const tilesetRelPaths: string[] = [];
  for (const t of project.defs.tilesets) {
    if (t.embedAtlas === 'LdtkIcons') continue;
    if (t.relPath !== null && t.relPath !== '') tilesetRelPaths.push(t.relPath);
  }

  const capabilities: LdtkPlatformerCapabilities = {
    hazards: (globalCounts['hazard'] ?? 0) > 0,
    collectibles: (globalCounts['collectible'] ?? 0) > 0,
    springs: (globalCounts['spring'] ?? 0) > 0,
    dashRefills: (globalCounts['dashRefill'] ?? 0) > 0,
    exits: (globalCounts['exit'] ?? 0) > 0,
    ladders: projectHasLadders(levels, ladderIntGridValues(project)),
    movingPlatforms: (globalCounts['movingPlatform'] ?? 0) > 0,
  };

  // --- Diagnostics (info/warning only; preflight never errors). ---
  const diagnostics: LdtkAssetDiagnostic[] = [];
  if (tileSizes.length > 1) {
    diagnostics.push({
      severity: 'warning',
      message: `conflicting tile sizes across levels: ${tileSizes.join(', ')}`,
    });
  }
  if (spawnLessRoomIids.length > 0) {
    diagnostics.push({
      severity: 'warning',
      message: `${spawnLessRoomIids.length} room(s) without a spawn entity: ${spawnLessRoomIids.join(', ')}`,
    });
  }
  if (disconnectedRoomIids.length > 0) {
    diagnostics.push({
      severity: 'warning',
      message: `${disconnectedRoomIids.length} room(s) disconnected (not reachable from any spawn): ${disconnectedRoomIids.join(', ')}`,
    });
  }
  if (spawnRoots.length === 0 && finalizedLevels.length > 0) {
    diagnostics.push({
      severity: 'warning',
      message: 'no spawn rooms found; connectivity not evaluated',
    });
  }

  return {
    levelCount: finalizedLevels.length,
    levels: finalizedLevels,
    tileSizes,
    tilesetRelPaths,
    totalSpawns,
    spawnLessRoomIids,
    disconnectedRoomIids,
    capabilities,
    unknownTriggerIdentifiers: [...unknownTrigger],
    diagnostics,
  };
}
