/**
 * Tests for `buildReachGraph` and `analyzeReachability` — static reachability
 * analysis for platformer levels.
 *
 * These tests construct `LevelData` fixtures, compile them, and verify that
 * reachability results match expectations.
 *
 * Determinism: every test is a pure assertion (same input → same output).
 * No `Math.random`, no `Date.now()`, no global state.
 * Never-throw contract is verified via hostile inputs.
 */
import { describe, it, expect } from 'vitest';
import { buildReachGraph, analyzeReachability } from '../leveltest/reachability';
import { compileLevel } from '../platformer/level-runtime';
import type { LevelData, LevelEntity } from '../level/types';
import { DEFAULT_PLAYER_WIDTH, DEFAULT_PLAYER_HEIGHT } from '../platformer/constants';

// ---------------------------------------------------------------------------
// Constants and test helpers
// ---------------------------------------------------------------------------

const PLAYER_HEIGHT = DEFAULT_PLAYER_HEIGHT; // 24

/**
 * Create a simple flat level with a ground platform, spawn on the left, exit
 * on the right.
 */
function makeFlatLevel(overrides?: {
  groundWidth?: number;
  groundY?: number;
  spawnX?: number;
  exitX?: number;
  gapStart?: number;
  gapWidth?: number;
}): LevelData {
  const groundY = overrides?.groundY ?? 274;
  const groundWidth = overrides?.groundWidth ?? 400;
  const spawnX = overrides?.spawnX ?? 32;
  const exitX = overrides?.exitX ?? 320;
  const gapStart = overrides?.gapStart;
  const gapWidth = overrides?.gapWidth;

  const entities: LevelEntity[] = [];
  let nextId = 1;

  if (gapStart !== undefined && gapWidth !== undefined) {
    // Left platform
    entities.push({
      id: nextId++,
      kind: 'platform',
      rect: { x: 0, y: groundY, width: gapStart, height: 16 },
      props: {},
    });
    // Right platform
    const rightStart = gapStart + gapWidth;
    entities.push({
      id: nextId++,
      kind: 'platform',
      rect: { x: rightStart, y: groundY, width: groundWidth - rightStart, height: 16 },
      props: {},
    });
  } else {
    // Single continuous ground
    entities.push({
      id: nextId++,
      kind: 'platform',
      rect: { x: 0, y: groundY, width: groundWidth, height: 16 },
      props: {},
    });
  }

  // Spawn entity
  entities.push({
    id: nextId++,
    kind: 'spawn',
    rect: { x: spawnX, y: groundY - PLAYER_HEIGHT, width: DEFAULT_PLAYER_WIDTH, height: PLAYER_HEIGHT },
    props: {},
  });

  // Exit entity — bottom edge at groundY
  entities.push({
    id: nextId++,
    kind: 'exit',
    rect: { x: exitX, y: groundY - 24, width: 16, height: 24 },
    props: { isTrap: false, locked: false },
  });

  return {
    version: 1,
    id: 'flat-test',
    name: 'Flat Test',
    width: 400,
    height: 300,
    tileSize: 16,
    spawn: { x: spawnX, y: groundY - PLAYER_HEIGHT },
    tiles: { data: [], cols: 25, rows: 18, tileSize: 16 },
    entities,
    nextEntityId: nextId,
  };
}

/**
 * Create a level where the exit is on a floating platform that is too high
 * to reach (verticalDistance > apexHeight).
 */
function makeUnreachableHighLevel(): LevelData {
  const entities: LevelEntity[] = [];
  let nextId = 1;

  // Ground
  entities.push({
    id: nextId++,
    kind: 'platform',
    rect: { x: 0, y: 274, width: 200, height: 16 },
    props: {},
  });

  // High floating platform — too high to reach from ground
  entities.push({
    id: nextId++,
    kind: 'platform',
    rect: { x: 250, y: 180, width: 64, height: 16 },
    props: {},
  });

  // Spawn
  entities.push({
    id: nextId++,
    kind: 'spawn',
    rect: { x: 32, y: 250, width: DEFAULT_PLAYER_WIDTH, height: PLAYER_HEIGHT },
    props: {},
  });

  // Exit on the high platform
  entities.push({
    id: nextId++,
    kind: 'exit',
    rect: { x: 260, y: 156, width: 16, height: 24 },
    props: { isTrap: false, locked: false },
  });

  return {
    version: 1,
    id: 'unreachable-high',
    name: 'Unreachable High Exit',
    width: 400,
    height: 300,
    tileSize: 16,
    spawn: { x: 32, y: 250 },
    tiles: { data: [], cols: 25, rows: 18, tileSize: 16 },
    entities,
    nextEntityId: nextId,
  };
}

/**
 * Create a level where the spawn point is inside a solid block (no surface).
 */
function makeSpawnInWallLevel(): LevelData {
  const entities: LevelEntity[] = [];
  let nextId = 1;

  // Giant solid block covering the spawn area
  entities.push({
    id: nextId++,
    kind: 'platform',
    rect: { x: 0, y: 250, width: 400, height: 50 },
    props: {},
  });

  // Spawn is inside the solid block
  entities.push({
    id: nextId++,
    kind: 'spawn',
    rect: { x: 32, y: 260, width: DEFAULT_PLAYER_WIDTH, height: PLAYER_HEIGHT },
    props: {},
  });

  // Exit
  entities.push({
    id: nextId++,
    kind: 'exit',
    rect: { x: 350, y: 200, width: 16, height: 24 },
    props: { isTrap: false, locked: false },
  });

  return {
    version: 1,
    id: 'spawn-in-wall',
    name: 'Spawn in Wall',
    width: 400,
    height: 300,
    tileSize: 16,
    spawn: { x: 32, y: 260 },
    tiles: { data: [], cols: 25, rows: 18, tileSize: 16 },
    entities,
    nextEntityId: nextId,
  };
}

/**
 * Create a level with a floating exit (no surface beneath it).
 */
function makeFloatingExitLevel(): LevelData {
  const entities: LevelEntity[] = [];
  let nextId = 1;

  // Ground
  entities.push({
    id: nextId++,
    kind: 'platform',
    rect: { x: 0, y: 274, width: 200, height: 16 },
    props: {},
  });

  // Spawn
  entities.push({
    id: nextId++,
    kind: 'spawn',
    rect: { x: 32, y: 250, width: DEFAULT_PLAYER_WIDTH, height: PLAYER_HEIGHT },
    props: {},
  });

  // Exit floating in air (no surface beneath)
  entities.push({
    id: nextId++,
    kind: 'exit',
    rect: { x: 350, y: 100, width: 16, height: 24 },
    props: { isTrap: false, locked: false },
  });

  return {
    version: 1,
    id: 'floating-exit',
    name: 'Floating Exit',
    width: 400,
    height: 300,
    tileSize: 16,
    spawn: { x: 32, y: 250 },
    tiles: { data: [], cols: 25, rows: 18, tileSize: 16 },
    entities,
    nextEntityId: nextId,
  };
}

/**
 * Create a level with a moving platform.
 */
function makeMovingPlatformLevel(): LevelData {
  const entities: LevelEntity[] = [];
  let nextId = 1;

  // Ground
  entities.push({
    id: nextId++,
    kind: 'platform',
    rect: { x: 0, y: 274, width: 100, height: 16 },
    props: {},
  });

  // Moving platform
  entities.push({
    id: nextId++,
    kind: 'movingPlatform',
    rect: { x: 150, y: 274, width: 32, height: 8 },
    props: {
      speed: 50,
      path: [{ x: 150, y: 274 }, { x: 250, y: 274 }],
      loopMode: 'pingpong',
    },
  });

  // Spawn
  entities.push({
    id: nextId++,
    kind: 'spawn',
    rect: { x: 32, y: 250, width: DEFAULT_PLAYER_WIDTH, height: PLAYER_HEIGHT },
    props: {},
  });

  // Exit on the far side
  entities.push({
    id: nextId++,
    kind: 'exit',
    rect: { x: 320, y: 250, width: 16, height: 24 },
    props: { isTrap: false, locked: false },
  });

  // Far ground
  entities.push({
    id: nextId++,
    kind: 'platform',
    rect: { x: 300, y: 274, width: 100, height: 16 },
    props: {},
  });

  return {
    version: 1,
    id: 'moving-platform',
    name: 'Moving Platform',
    width: 400,
    height: 300,
    tileSize: 16,
    spawn: { x: 32, y: 250 },
    tiles: { data: [], cols: 25, rows: 18, tileSize: 16 },
    entities,
    nextEntityId: nextId,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildReachGraph', () => {
  it('extracts surfaces from flat level', () => {
    const level = makeFlatLevel();
    const compiled = compileLevel(level);
    const graph = buildReachGraph(compiled);
    expect(graph.surfaces.length).toBeGreaterThanOrEqual(1);
  });

  it('surfaces have entity-N ids matching source solids', () => {
    const level = makeFlatLevel();
    const compiled = compileLevel(level);
    const graph = buildReachGraph(compiled);
    for (const surface of graph.surfaces) {
      // All surfaces from entities should have 'entity-N' ids
      if (surface.entityId !== undefined) {
        expect(surface.id).toBe(`entity-${surface.entityId}`);
      }
      // Every surface must have an id
      expect(surface.id.length).toBeGreaterThan(0);
    }
  });

  it('surfaces are sorted by id (deterministic visit order)', () => {
    const level = makeFlatLevel();
    const graphA = buildReachGraph(compileLevel(level));
    const graphB = buildReachGraph(compileLevel(level));
    const idsA = graphA.surfaces.map((s) => s.id);
    const idsB = graphB.surfaces.map((s) => s.id);
    expect(idsA).toEqual(idsB);
    // Verify sorted
    for (let i = 1; i < idsA.length; i++) {
      expect(idsA[i - 1] < idsA[i] || idsA[i - 1] === idsA[i]).toBe(true);
    }
  });

  it('surfaces include passthrough flag', () => {
    const level = makeFlatLevel();
    const compiled = compileLevel(level);
    const graph = buildReachGraph(compiled);
    // All ground surfaces in flat level are non-passthrough
    for (const surface of graph.surfaces) {
      expect(surface.passthrough).toBeDefined();
    }
  });

  it('does not throw with empty compiled level', () => {
    const empty: any = { staticSolids: [], movingPlatforms: [] };
    expect(() => buildReachGraph(empty)).not.toThrow();
  });
});

describe('analyzeReachability', () => {
  // -----------------------------------------------------------------------
  // Simple flat level → reachable
  // -----------------------------------------------------------------------
  it('flat level with continuous ground is reachable', () => {
    const level = makeFlatLevel();
    const result = analyzeReachability(level);
    expect(result.version).toBe(1);
    expect(result.reachable).toBe(true);
    expect(result.spawnSurface).not.toBeNull();
    expect(result.exitSurfaces.length).toBeGreaterThan(0);
    expect(result.reachableSurfaces.length).toBeGreaterThan(0);
    expect(result.confidence).toBe('sound-over-approximation');
  });

  // -----------------------------------------------------------------------
  // Gap within jump distance → reachable
  // -----------------------------------------------------------------------
  it('level with jumpable gap is reachable', () => {
    // Gap of 32 between platforms (well within 112 max distance)
    const level = makeFlatLevel({ gapStart: 100, gapWidth: 32 });
    const result = analyzeReachability(level);
    expect(result.reachable).toBe(true);
    expect(result.confidence).toBe('sound-over-approximation');
  });

  // -----------------------------------------------------------------------
  // Unreachable exit
  // -----------------------------------------------------------------------
  it('exit too high to reach is not reachable', () => {
    const level = makeUnreachableHighLevel();
    const result = analyzeReachability(level);
    expect(result.reachable).toBe(false);
    expect(result.spawnSurface).not.toBeNull();
    // Should have exit surfaces but unreachable
  });

  // -----------------------------------------------------------------------
  // Spawn in wall → spawnSurface: null
  // -----------------------------------------------------------------------
  it('spawn inside solid block returns null spawnSurface', () => {
    const level = makeSpawnInWallLevel();
    const result = analyzeReachability(level);
    expect(result.spawnSurface).toBeNull();
    expect(result.reachable).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Floating exit → exitSurfaces empty
  // -----------------------------------------------------------------------
  it('floating exit with no surface beneath returns empty exitSurfaces', () => {
    const level = makeFloatingExitLevel();
    const result = analyzeReachability(level);
    expect(result.exitSurfaces.length).toBe(0);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Moving platform → unsupported
  // -----------------------------------------------------------------------
  it('level with moving platform returns unsupported confidence', () => {
    const level = makeMovingPlatformLevel();
    const result = analyzeReachability(level);
    expect(result.confidence).toBe('unsupported');
    expect(result.reachable).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    // Graph is still built for diagnostics
    expect(result.graph.surfaces.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Softlock detection
  // -----------------------------------------------------------------------
  it('softlock detection runs without error and returns valid structure', () => {
    // Build a level where all surfaces are mutually reachable
    const entities: LevelEntity[] = [];
    let nextId = 1;
    const groundY = 274;

    // Ground A (spawn platform)
    entities.push({
      id: nextId++, kind: 'platform',
      rect: { x: 0, y: groundY, width: 80, height: 16 }, props: {},
    });
    // Ground B (exit platform, within jump range from A)
    entities.push({
      id: nextId++, kind: 'platform',
      rect: { x: 112, y: groundY, width: 128, height: 16 }, props: {},
    });

    // Spawn
    entities.push({
      id: nextId++, kind: 'spawn',
      rect: { x: 16, y: groundY - PLAYER_HEIGHT, width: DEFAULT_PLAYER_WIDTH, height: PLAYER_HEIGHT }, props: {},
    });

    // Exit on ground B
    entities.push({
      id: nextId++, kind: 'exit',
      rect: { x: 150, y: groundY - 24, width: 16, height: 24 },
      props: { isTrap: false, locked: false },
    });

    const level: LevelData = {
      version: 1, id: 'softlock-test', name: 'Softlock Test',
      width: 400, height: 300, tileSize: 16,
      spawn: { x: 16, y: groundY - PLAYER_HEIGHT },
      tiles: { data: [], cols: 25, rows: 18, tileSize: 16 },
      entities, nextEntityId: nextId,
    };

    // Without softlock detection
    const noSoftlock = analyzeReachability(level, { verifySoftlocks: false });
    expect(noSoftlock.softlockSurfaces).toEqual([]);

    // With softlock detection — both surfaces reachable from each other
    // so no true softlocks exist. Verify the mechanism runs cleanly.
    const withSoftlock = analyzeReachability(level, { verifySoftlocks: true });
    expect(Array.isArray(withSoftlock.softlockSurfaces)).toBe(true);
    // All reachable surfaces should also be backward-reachable from exit
    // in a fully connected graph, so softlockSurfaces is empty
    expect(withSoftlock.softlockSurfaces.length).toBe(0);
    // Verify softlock surfaces are always a subset of reachable surfaces
    const softlockIds = new Set(withSoftlock.softlockSurfaces.map((s) => s.id));
    const reachableIds = new Set(withSoftlock.reachableSurfaces.map((s) => s.id));
    for (const id of softlockIds) {
      expect(reachableIds.has(id)).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // BFS visit order deterministic
  // -----------------------------------------------------------------------
  it('same level input produces identical reachability results', () => {
    const level = makeFlatLevel({ gapStart: 100, gapWidth: 32 });
    const a = analyzeReachability(level);
    const b = analyzeReachability(level);
    expect(a.reachable).toBe(b.reachable);
    expect(a.spawnSurface?.id).toBe(b.spawnSurface?.id);
    expect(a.exitSurfaces.map((s) => s.id)).toEqual(b.exitSurfaces.map((s) => s.id));
    expect(a.reachableSurfaces.map((s) => s.id)).toEqual(b.reachableSurfaces.map((s) => s.id));
    expect(a.diagnostics).toEqual(b.diagnostics);
  });

  // -----------------------------------------------------------------------
  // Diagnostic messages
  // -----------------------------------------------------------------------
  it('adds diagnostic when spawn surface is not found', () => {
    const level = makeSpawnInWallLevel();
    const result = analyzeReachability(level);
    expect(result.diagnostics.some((d) => d.toLowerCase().includes('spawn'))).toBe(true);
  });

  it('adds diagnostic when exit surfaces are not found', () => {
    const level = makeFloatingExitLevel();
    const result = analyzeReachability(level);
    expect(result.diagnostics.some((d) => d.toLowerCase().includes('exit'))).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Non-finite inputs never throw
  // -----------------------------------------------------------------------
  it('null level never throws', () => {
    expect(() => analyzeReachability(null as any)).not.toThrow();
  });

  it('undefined level never throws', () => {
    expect(() => analyzeReachability(undefined as any)).not.toThrow();
  });

  it('level with NaN spawn never throws', () => {
    const level = makeFlatLevel();
    const bad = { ...level, spawn: { x: NaN, y: NaN } };
    expect(() => analyzeReachability(bad)).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // buildReachGraph: moving platforms don't create surfaces
  // -----------------------------------------------------------------------
  it('moving platforms do not create surfaces in static graph', () => {
    const level = makeMovingPlatformLevel();
    const compiled = compileLevel(level);
    const graph = buildReachGraph(compiled);
    // Moving platform entity-2 should NOT be in the static surfaces
    const mpSurfaces = graph.surfaces.filter((s) => s.id === 'entity-2');
    expect(mpSurfaces.length).toBe(0);
    // But static ground surfaces should be there
    const groundSurfaces = graph.surfaces.filter((s) => s.id.startsWith('entity-'));
    expect(groundSurfaces.length).toBeGreaterThan(0);
  });
});
