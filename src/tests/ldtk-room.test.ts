/**
 * Celerock integration hardening — Workstreams C4 (`compileLdtkRoom`) + C5
 * (`createLdtkRoomCache`).
 *
 * Covers the per-room LDtk glue that sits on top of `ldtkLevelToLevelData` +
 * `compileGeneratedLevel`: translate + compile + entity bucketing + spawn
 * resolution, and a lazy identity-stable cache over a whole project. Uses the
 * adversarial fixture (`src/tests/fixtures/celerock-adversarial.ldtk`).
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseLdtkProject } from '../ldtk';
import type { LdtkLevel, LdtkProject } from '../ldtk';
import {
  compileLdtkRoom,
  createLdtkRoomCache,
  settlePlatformerState,
  DEFAULT_PLATFORMER_CONFIG,
} from '../platformer';

/** Read + parse the adversarial Celerock fixture, returning the whole project. */
function loadProject(): LdtkProject {
  const url = new URL('./fixtures/celerock-adversarial.ldtk', import.meta.url);
  const text = readFileSync(url, 'utf8');
  const { project } = parseLdtkProject(text);
  if (project === undefined) throw new Error('fixture failed to parse');
  return project;
}

/** Find a level in the project by identifier. */
function levelById(project: LdtkProject, identifier: string): LdtkLevel {
  const level = project.levels.find((l) => l.identifier === identifier);
  if (level === undefined) throw new Error(`fixture missing ${identifier}`);
  return level;
}

const LEVEL_0_IID = 'ce1e0001-0000-0000-0000-000000000001';
const LEVEL_1_IID = 'ce1e0002-0000-0000-0000-000000000002';
const UNKNOWN_IID = 'deadbeef-0000-0000-0000-000000000000';

// ===========================================================================
// C4 — compileLdtkRoom
// ===========================================================================
describe('C4 — compileLdtkRoom (good room Level_0)', () => {
  it('translates + compiles and resolves an authored spawn', () => {
    const project = loadProject();
    const level0 = levelById(project, 'Level_0');
    const room = compileLdtkRoom(level0, project);

    // Authored: Level_0 has a Player entity.
    expect(room.spawn.source).toBe('authored');
    // The levelData is the translated shape, with the feet-center spawn anchor.
    expect(room.levelData.id).toBe('Level_0');
    // Player entity at px [16,100], 8x12 → feet-center (20, 112).
    expect(room.levelData.spawn).toEqual({ x: 20, y: 112 });
  });

  it('produces non-empty static solids (tile geometry + trigger volumes)', () => {
    const project = loadProject();
    const room = compileLdtkRoom(levelById(project, 'Level_0'), project);
    expect(room.solids.length).toBeGreaterThan(0);
    // solids === compiled.staticSolids by reference (no duplication).
    expect(room.solids).toBe(room.compiled.staticSolids);
    // Moving platforms stay out of solids (consumer advances them).
    expect(room.compiled.movingPlatforms.length).toBe(1);
  });

  it('buckets entities by kind (springs = Spring + SuperSpring; dashRefills = 1)', () => {
    const project = loadProject();
    const room = compileLdtkRoom(levelById(project, 'Level_0'), project);
    // Fixture Level_0: 1 Spike, 1 Gem, Spring+SuperSpring (2), 1 DashRefill,
    // 1 Exit, 0 enemies.
    expect(room.hazards).toHaveLength(1);
    expect(room.collectibles).toHaveLength(1);
    expect(room.springs).toHaveLength(2);
    expect(room.dashRefills).toHaveLength(1);
    expect(room.exits).toHaveLength(1);
    expect(room.enemies).toHaveLength(0);
    // Bucketed entities are a subset of the translated entities.
    for (const e of room.springs) expect(e.kind).toBe('spring');
    for (const e of room.dashRefills) expect(e.kind).toBe('dashRefill');
  });

  it('rest-on-surface: feet (core.y + height) land exactly on the spawn anchor', () => {
    const project = loadProject();
    const room = compileLdtkRoom(levelById(project, 'Level_0'), project);
    const { core } = room.compiled.initialState;
    // The resolved AABB top-left places the feet (core.y + height) flush with
    // the feet-center anchor (levelData.spawn.y = 112). This is the
    // rest-on-surface math invariant, independent of where the floor sits.
    expect(core.y + core.height).toBe(room.levelData.spawn.y);
  });

  it('reaches onGround within a couple neutral ticks (no permanent embed)', () => {
    const project = loadProject();
    const room = compileLdtkRoom(levelById(project, 'Level_0'), project);
    // The adversarial fixture's Player feet anchor sits at the floor row's
    // BOTTOM edge, so the spawn overlaps the floor and emits a C3 *warning*
    // (asserted separately). Settling must still ground the player quickly —
    // the resolver lifts the body onto the floor surface.
    const result = settlePlatformerState(
      room.compiled.initialState,
      room.compiled.staticSolids,
      DEFAULT_PLATFORMER_CONFIG,
    );
    expect(result.settled).toBe(true);
    expect(result.steps).toBeLessThanOrEqual(64);
    expect(result.state.core.onGround).toBe(true);
  });

  it('has no ERROR diagnostics for the good room (warnings allowed)', () => {
    const project = loadProject();
    const room = compileLdtkRoom(levelById(project, 'Level_0'), project);
    const errors = room.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('exposes tileSemantics.ladder but does NOT invent ladder solids', () => {
    const project = loadProject();
    const room = compileLdtkRoom(levelById(project, 'Level_0'), project);
    // The fixture declares IntGrid value 3 = 'ladder'; translate records it.
    expect(room.tileSemantics.ladder).toEqual([3]);
    // The engine's compile pipeline emits NO ladder solids (ladder values
    // classify as 'empty'); ladder climb is driven by tileSemantics + the
    // kernel's climb ability, so ladders is faithfully empty.
    expect(room.ladders).toEqual([]);
  });

  it('is pure: a second call returns a fresh instance (no input mutation)', () => {
    const project = loadProject();
    const level0 = levelById(project, 'Level_0');
    const a = compileLdtkRoom(level0, project);
    const b = compileLdtkRoom(level0, project);
    expect(a).not.toBe(b); // fresh each call (the cache provides identity, not this fn)
    // Identical content, though.
    expect(b.solids.length).toBe(a.solids.length);
    expect(b.spawn).toEqual(a.spawn);
  });
});

describe('C4 — compileLdtkRoom (spawn-less room Level_1)', () => {
  it('marks the synthesized spawn as fallback + warns no spawn entity', () => {
    const project = loadProject();
    const level1 = levelById(project, 'Level_1');
    const room = compileLdtkRoom(level1, project);
    // No Player/Spawn entity in Level_1 → refined source is 'fallback'.
    expect(room.spawn.source).toBe('fallback');
    // The translator emits a "no spawn entity found" warning that is folded
    // into the merged diagnostics.
    const noSpawnWarning = room.diagnostics.find(
      (d) => d.severity === 'warning' && d.message.includes('no spawn entity'),
    );
    expect(noSpawnWarning).toBeDefined();
  });
});

describe('C4 — compileLdtkRoom (hard translate failure never throws)', () => {
  it('returns an empty room with an error diagnostic when translate yields no level', () => {
    // Craft a level with no IntGrid collision layer and no usable dimensions:
    // translate emits "no IntGrid collision layer found" (error) and returns
    // level === undefined. compileLdtkRoom must not throw and must surface the
    // error while keeping every array empty.
    const project = loadProject();
    const hostile: LdtkLevel = {
      ...levelById(project, 'Level_0'),
      layerInstances: null,
      pxWid: 0,
      pxHei: 0,
    };
    const room = compileLdtkRoom(hostile, project);
    expect(room.solids).toEqual([]);
    expect(room.hazards).toEqual([]);
    expect(room.springs).toEqual([]);
    const errors = room.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// C4 — entity art side channel (CompiledLdtkRoom.entityArt)
// ===========================================================================
describe('C4 — compileLdtkRoom entity art side channel', () => {
  /**
   * The LDtk platformer sample: real defs with authored display tiles and
   * render modes (`Mob` renders Cover, `Door` is a real NineSlice), across
   * MULTIPLE rooms — what the per-room alignment is for.
   */
  function loadSampleProject(): LdtkProject {
    const url = new URL('../../assets/ldtk/samples/Typical_2D_platformer_example.ldtk', import.meta.url);
    const text = readFileSync(url, 'utf8');
    const { project } = parseLdtkProject(text);
    if (project === undefined) throw new Error('sample failed to parse');
    return project;
  }

  it('carries authored art onto the room, keyed by the translated entities’ engine ids', () => {
    const project = loadSampleProject();
    const level = project.levels.find((l) => l.identifier === 'Top')!;
    const room = compileLdtkRoom(level, project);

    // Alignment invariant: every art key is one of THIS room's entity ids —
    // the consumer's `room.entityArt.get(entity.id)` can never miss its own
    // room's art or hit another room's.
    const ids = new Set(room.levelData.entities.map((e) => e.id));
    expect(room.entityArt.size).toBeGreaterThan(0);
    for (const key of room.entityArt.keys()) expect(ids.has(key)).toBe(true);

    // The Mob def renders Cover; a trigger-hatched Mob still carries its art.
    const mob = room.levelData.entities.find(
      (e) => e.kind === 'trigger' && e.props.action === 'Mob',
    )!;
    expect(room.entityArt.get(mob.id)?.tileRenderMode).toBe('Cover');
    expect(room.entityArt.get(mob.id)?.tile).toMatchObject({ tilesetUid: 104, x: 96, y: 0 });

    // The Door def is a real NineSlice with parsed borders.
    const door = room.levelData.entities.find((e) => e.kind === 'exit')!;
    const doorArt = room.entityArt.get(door.id);
    expect(doorArt?.tileRenderMode).toBe('NineSlice');
    expect(doorArt?.nineSliceBorders).toEqual([5, 5, 5, 5]);
  });

  it('the art travels WITH the room: two rooms with overlapping entity ids each resolve their own map', () => {
    // Engine ids restart at 1 per room, so id overlap across rooms is the
    // NORMAL case — a slide drawing two rooms resolves each from its own map
    // by construction, where a shared rect-keyed index mis-resolved both.
    const project = loadSampleProject();
    const top = compileLdtkRoom(project.levels.find((l) => l.identifier === 'Top')!, project);
    const bottom = compileLdtkRoom(project.levels.find((l) => l.identifier === 'Bottom')!, project);
    expect(top.entityArt).not.toBe(bottom.entityArt);

    const topMob = top.levelData.entities.find(
      (e) => e.kind === 'trigger' && e.props.action === 'Mob',
    )!;
    const bottomMob = bottom.levelData.entities.find(
      (e) => e.kind === 'trigger' && e.props.action === 'Mob',
    )!;
    for (const [room, entity] of [[top, topMob], [bottom, bottomMob]] as const) {
      const ids = new Set(room.levelData.entities.map((e) => e.id));
      expect(ids.has(entity.id)).toBe(true);
      expect(room.entityArt.get(entity.id)?.tile).toMatchObject({ x: 96, y: 0 });
    }
    // Top has Doors (NineSlice); Bottom has none — its map holds no Door art.
    const topDoor = top.levelData.entities.find((e) => e.kind === 'exit');
    expect(topDoor).toBeDefined();
    expect(bottom.levelData.entities.some((e) => e.kind === 'exit')).toBe(false);
    expect(bottom.entityArt.get(topDoor!.id)?.tileRenderMode).not.toBe('NineSlice');
  });
});

// ===========================================================================
// C5 — createLdtkRoomCache
// ===========================================================================
describe('C5 — createLdtkRoomCache (lazy compile + identity)', () => {
  it('compiles lazily and returns the SAME instance on revisit (===)', () => {
    const cache = createLdtkRoomCache(loadProject());
    const a = cache.get(LEVEL_0_IID);
    const b = cache.get(LEVEL_0_IID);
    expect(a).toBe(b); // reference equality — same immutable instance
    // The default player size is derived from the 8px tile size (4x12).
    expect(a.compiled.initialState.core.width).toBe(4);
    expect(a.compiled.initialState.core.height).toBe(12);
  });

  it('has() reflects project membership (compiled or not)', () => {
    const cache = createLdtkRoomCache(loadProject());
    expect(cache.has(LEVEL_0_IID)).toBe(true);
    expect(cache.has(LEVEL_1_IID)).toBe(true);
    expect(cache.has(UNKNOWN_IID)).toBe(false);
  });

  it('get() throws a descriptive Error for an unknown iid', () => {
    const cache = createLdtkRoomCache(loadProject());
    expect(() => cache.get(UNKNOWN_IID)).toThrowError(/unknown level iid/);
  });

  it('getStartRoom() returns the authored-spawn room (Level_0)', () => {
    const cache = createLdtkRoomCache(loadProject());
    const result = cache.getStartRoom();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.room.ldtkLevel.iid).toBe(LEVEL_0_IID);
      expect(result.room.spawn.source).toBe('authored');
      // getStartRoom populated the cache, so a follow-up get is identical.
      expect(cache.get(LEVEL_0_IID)).toBe(result.room);
    }
  });

  it('honors an explicit startLevelIid override', () => {
    const cache = createLdtkRoomCache(loadProject(), {
      startLevelIid: LEVEL_1_IID,
    });
    const result = cache.getStartRoom();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.room.ldtkLevel.iid).toBe(LEVEL_1_IID);
  });

  it('startLevelIid override surfaces diagnostics when the iid is absent', () => {
    const cache = createLdtkRoomCache(loadProject(), {
      startLevelIid: UNKNOWN_IID,
    });
    const result = cache.getStartRoom();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
      expect(result.diagnostics[0]?.severity).toBe('error');
    }
  });

  it('clear() drops the cache so the next get recomputes a new instance', () => {
    const cache = createLdtkRoomCache(loadProject());
    const before = cache.get(LEVEL_0_IID);
    cache.clear();
    const after = cache.get(LEVEL_0_IID);
    expect(after).not.toBe(before); // recompiled → fresh instance
    // ...but equivalent content.
    expect(after.spawn).toEqual(before.spawn);
    expect(after.solids.length).toBe(before.solids.length);
  });
});

describe('C5 — createLdtkRoomCache (no authored spawn anywhere)', () => {
  /** Rebuild a project with every spawn/Player entity stripped from every level. */
  function projectWithNoSpawns(project: LdtkProject): LdtkProject {
    const strip = (level: LdtkLevel): LdtkLevel => ({
      ...level,
      layerInstances: (level.layerInstances ?? []).map((layer) => ({
        ...layer,
        entityInstances: (layer.entityInstances ?? []).filter((e) => {
          const id = e.__identifier.toLowerCase();
          return id !== 'player' && id !== 'spawn' && id !== 'start';
        }),
      })),
    });
    return {
      ...project,
      levels: project.levels.map(strip),
      worlds: project.worlds.map((w) => ({ ...w, levels: w.levels.map(strip) })),
    };
  }

  it('returns ok:false with an error diagnostic (never fabricates a room)', () => {
    const cache = createLdtkRoomCache(projectWithNoSpawns(loadProject()));
    const result = cache.getStartRoom();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
      expect(result.diagnostics[0]?.severity).toBe('error');
      expect(result.diagnostics[0]?.message).toMatch(/authored spawn/i);
    }
  });
});
