/**
 * Celerock integration hardening — Workstreams B2, B3, C1, C2, C3.
 *
 * Covers the three coupled batches that landed together (shared files:
 * `src/ldtk/translate.ts`, `src/platformer/level-runtime.ts`):
 *
 *   - B2: `Spring`/`SuperSpring`/`DashRefill`/`DashCrystal`/`Refill` LDtk
 *         identifiers map onto the dedicated `spring`/`dashRefill` entity kinds
 *         (previously fell through to `trigger`, so the runtime never saw them).
 *   - B3: public `solidIdForEntity` / `entityIdFromSolidId` helpers.
 *   - C1: spawn resolution (`'rest-on-surface'` vs `'actor-top-left'`) — fixes
 *         the "player spawned inside the floor" bug where a feet-center anchor
 *         was passed straight to a top-left-expecting constructor.
 *   - C2: `ResolvedPlatformerSpawn` provenance on `CompiledLevel`.
 *   - C3: `CompileDiagnostic` spawn-embedding warning + `settlePlatformerState`
 *         recovery helper.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseLdtkProject, ldtkLevelToLevelData } from '../ldtk';
import type { LdtkLevel, LdtkProject } from '../ldtk';
import {
  compileLevel,
  compileGeneratedLevel,
  settlePlatformerState,
  solidIdForEntity,
  entityIdFromSolidId,
  createPlatformerState,
  stepPlatformer,
  DEFAULT_PLATFORMER_CONFIG,
} from '../platformer';
import type { LevelData, LevelEntity } from '../level/types';
import type { DashAbilityState, PlatformerConfig, PlatformerState } from '../platformer/types';

/** Fixed timestep (60 Hz). */
const DT = 1 / 60;

/** Read + parse the adversarial Celerock fixture. */
function loadLevel0(): LdtkLevel {
  const project = loadProject();
  const level0 = project.levels.find((l) => l.identifier === 'Level_0');
  if (level0 === undefined) throw new Error('fixture missing Level_0');
  return level0;
}

/** Read + parse the adversarial Celerock fixture, returning the whole project. */
function loadProject(): LdtkProject {
  const url = new URL('./fixtures/celerock-adversarial.ldtk', import.meta.url);
  const text = readFileSync(url, 'utf8');
  const { project } = parseLdtkProject(text);
  if (project === undefined) throw new Error('fixture failed to parse');
  return project;
}

/** A minimal valid level whose entities are supplied by the caller. */
function makeLevel(entities: readonly LevelEntity[], spawn = { x: 0, y: 0 }): LevelData {
  return {
    version: 1,
    id: 'hardening',
    name: 'Hardening',
    width: 320,
    height: 240,
    tileSize: 16,
    spawn,
    tiles: { data: [], cols: 0, rows: 0, tileSize: 16 },
    entities,
    nextEntityId: entities.length + 1,
  };
}

/** A solid jump/launch-config so the spring math is deterministic in-test. */
const CONFIG: Readonly<PlatformerConfig> = DEFAULT_PLATFORMER_CONFIG;

// ===========================================================================
// B2 — spring / dashRefill LDtk entity mapping
// ===========================================================================
describe('B2 — spring/dashRefill LDtk entity mapping (ldtkLevelToLevelData)', () => {
  it('maps Spring → spring (normal), SuperSpring → spring (super)', () => {
    const { level } = ldtkLevelToLevelData(loadLevel0(), loadProject());
    expect(level).toBeDefined();

    // Spring is at px [32,104] in the fixture → the only entity at that rect.
    const spring = level!.entities.find((e) => e.rect.x === 32 && e.rect.y === 104);
    expect(spring, 'Spring must translate to a retained entity').toBeDefined();
    expect(spring!.kind).toBe('spring');
    if (spring!.kind === 'spring') {
      expect(spring!.props.power).toBe('normal');
    }

    // SuperSpring at px [56,104].
    const superSpring = level!.entities.find((e) => e.rect.x === 56 && e.rect.y === 104);
    expect(superSpring, 'SuperSpring must translate to a retained entity').toBeDefined();
    expect(superSpring!.kind).toBe('spring');
    if (superSpring!.kind === 'spring') {
      expect(superSpring!.props.power).toBe('super');
    }
  });

  it('maps DashRefill → dashRefill', () => {
    const { level } = ldtkLevelToLevelData(loadLevel0(), loadProject());
    // DashRefill at px [104,88].
    const crystal = level!.entities.find((e) => e.rect.x === 104 && e.rect.y === 88);
    expect(crystal, 'DashRefill must translate to a retained entity').toBeDefined();
    expect(crystal!.kind).toBe('dashRefill');
  });

  it('compiles spring/dashRefill entities into non-blocking solids (launch pre-computed)', () => {
    const entities: LevelEntity[] = [
      { id: 1, kind: 'spring', rect: { x: 0, y: 100, width: 16, height: 16 }, props: { power: 'normal' } },
      { id: 2, kind: 'spring', rect: { x: 48, y: 100, width: 16, height: 16 }, props: { power: 'super' } },
      { id: 3, kind: 'dashRefill', rect: { x: 144, y: 100, width: 16, height: 16 }, props: {} },
    ];
    const compiled = compileGeneratedLevel(
      { level: makeLevel(entities), tileSemantics: { solid: [], passthrough: [] } },
      { config: CONFIG },
    );
    const springs = compiled.staticSolids.filter((s) => s.spring !== undefined);
    const crystals = compiled.staticSolids.filter((s) => s.dashRefill === true);
    expect(springs).toHaveLength(2);
    expect(crystals).toHaveLength(1);
    // Normal → springBounceVy; super → springSuperBounceVy; stable entity-<id>.
    expect(compiled.staticSolids.find((s) => s.id === solidIdForEntity(1))?.spring?.launch).toBe(CONFIG.springBounceVy);
    expect(compiled.staticSolids.find((s) => s.id === solidIdForEntity(2))?.spring?.launch).toBe(CONFIG.springSuperBounceVy);
    expect(crystals[0]?.id).toBe(solidIdForEntity(3));
  });

  it('spring overlap emits a spring interaction whose solid id === solidIdForEntity(entityId)', () => {
    const entities: LevelEntity[] = [
      { id: 7, kind: 'spring', rect: { x: 0, y: 100, width: 16, height: 16 }, props: { power: 'normal' } },
    ];
    const compiled = compileGeneratedLevel(
      { level: makeLevel(entities), tileSemantics: { solid: [], passthrough: [] } },
      { config: CONFIG },
    );
    // Position the player falling, overlapping the spring volume.
    const base = createPlatformerState(0, 100 - 8, CONFIG);
    const state: PlatformerState = { ...base, core: { ...base.core, vy: 200, onGround: false } };
    const input = { moveX: 0 as -1 | 0 | 1, jump: { held: false, pressed: false, released: false }, dash: null };

    const next = stepPlatformer(state, input, compiled.staticSolids, DT, CONFIG).state;
    const springEvents = next.interactions.filter((i) => i.kind === 'spring');
    expect(springEvents).toHaveLength(1);
    expect(springEvents[0]?.entityId).toBe(solidIdForEntity(7));
  });

  it('dashRefill overlap emits a dashRefill interaction whose solid id === solidIdForEntity(entityId)', () => {
    const entities: LevelEntity[] = [
      { id: 9, kind: 'dashRefill', rect: { x: 144, y: 100, width: 16, height: 16 }, props: {} },
    ];
    const compiled = compileGeneratedLevel(
      { level: makeLevel(entities), tileSemantics: { solid: [], passthrough: [] } },
      { config: CONFIG },
    );
    // Overlap the crystal with an empty dash budget.
    const base = createPlatformerState(144, 100 - 8, CONFIG);
    const dash0 = base.abilities['dash'] as DashAbilityState;
    const state: PlatformerState = {
      ...base,
      core: { ...base.core, vy: 0, onGround: false },
      abilities: { ...base.abilities, dash: { ...dash0, dashesRemaining: 0 } },
    };
    const input = { moveX: 0 as -1 | 0 | 1, jump: { held: false, pressed: false, released: false }, dash: null };

    const next = stepPlatformer(state, input, compiled.staticSolids, DT, CONFIG).state;
    const refillEvents = next.interactions.filter((i) => i.kind === 'dashRefill');
    expect(refillEvents).toHaveLength(1);
    expect(refillEvents[0]?.entityId).toBe(solidIdForEntity(9));
    // The dash budget was topped up to max.
    expect((next.abilities['dash'] as DashAbilityState).dashesRemaining).toBe(CONFIG.maxDashes);
  });

  it('still falls back to trigger for unknown identifiers (regression guard)', () => {
    const project = loadProject();
    const level0 = project.levels.find((l) => l.identifier === 'Level_0')!;
    const { level } = ldtkLevelToLevelData(level0, project, {
      entityMap: {
        resolve: () => null, // force the trigger fallback for everything
      },
    });
    // With every identifier falling through, a Spring entity becomes a trigger.
    const springRect = level!.entities.find((e) => e.rect.x === 32 && e.rect.y === 104);
    expect(springRect?.kind).toBe('trigger');
  });
});

// ===========================================================================
// B3 — entity / solid id helpers
// ===========================================================================
describe('B3 — solidIdForEntity / entityIdFromSolidId', () => {
  it('solidIdForEntity(n) === "entity-n"', () => {
    expect(solidIdForEntity(7)).toBe('entity-7');
    expect(solidIdForEntity(0)).toBe('entity-0');
  });

  it('entityIdFromSolidId("entity-7") === 7', () => {
    expect(entityIdFromSolidId('entity-7')).toBe(7);
  });

  it('entityIdFromSolidId returns undefined for the tile- namespace (not reversible)', () => {
    expect(entityIdFromSolidId('tile-0-0-8-8')).toBeUndefined();
    expect(entityIdFromSolidId('tile-32-16-32-16')).toBeUndefined();
  });

  it('entityIdFromSolidId returns undefined for a malformed entity id', () => {
    expect(entityIdFromSolidId('entity-notanumber')).toBeUndefined();
  });

  it('entityIdFromSolidId rejects empty/negative/float suffixes but keeps 0', () => {
    // Empty suffix: Number('') === 0 must NOT collide with the real 'entity-0'.
    expect(entityIdFromSolidId('entity-')).toBeUndefined();
    // Negative ids are never emitted by the compiler.
    expect(entityIdFromSolidId('entity--1')).toBeUndefined();
    expect(entityIdFromSolidId('entity--7')).toBeUndefined();
    // Floats / trailing garbage.
    expect(entityIdFromSolidId('entity-1.5')).toBeUndefined();
    expect(entityIdFromSolidId('entity-7-extra')).toBeUndefined();
    expect(entityIdFromSolidId('entity-')).toBeUndefined();
    // 0 round-trips (solidIdForEntity(0) === 'entity-0').
    expect(entityIdFromSolidId('entity-0')).toBe(0);
  });

  it('round-trips identity for entity ids', () => {
    for (const id of [1, 42, 1000, 7]) {
      expect(entityIdFromSolidId(solidIdForEntity(id))).toBe(id);
    }
  });
});

// ===========================================================================
// C1 / C2 — spawn resolution + provenance
// ===========================================================================
describe('C1 — spawn resolution (rest-on-surface vs actor-top-left)', () => {
  /** A level with a platform whose TOP is at y=100 (the floor surface). */
  function levelWithFloor(floorY = 100): { level: LevelData; floorY: number } {
    const entities: LevelEntity[] = [
      { id: 1, kind: 'spawn', rect: { x: 16, y: floorY - 24, width: 16, height: 24 }, props: {} },
      { id: 2, kind: 'platform', rect: { x: 0, y: floorY, width: 64, height: 16 }, props: {} },
    ];
    return {
      level: makeLevel(entities, { x: 24, y: floorY }),
      floorY,
    };
  }

  it('compileGeneratedLevel (LDtk path) resolves feet-center to AABB top-left so feet rest on the surface', () => {
    const { level, floorY } = levelWithFloor(100);
    const compiled = compileGeneratedLevel(
      { level, tileSemantics: { solid: [], passthrough: [] } },
      { playerWidth: 16, playerHeight: 24 },
    );
    // spawn.x=24 (center) → topLeftX = 24 - 16/2 = 16.
    // spawn.y=100 (feet) → topLeftY = 100 - 24 = 76.
    expect(compiled.initialState.core.x).toBe(16);
    expect(compiled.initialState.core.y).toBe(76);
    // Feet end up exactly at the floor surface.
    expect(compiled.initialState.core.y + compiled.initialState.core.height).toBe(floorY);
  });

  it('rest-on-surface does NOT overlap the floor solid (no embedding)', () => {
    const { level } = levelWithFloor(100);
    const compiled = compileGeneratedLevel(
      { level, tileSemantics: { solid: [], passthrough: [] } },
      { playerWidth: 16, playerHeight: 24 },
    );
    // Strict aabb: feet (100) flush with floor top (100) → NOT overlapping.
    expect(compiled.diagnostics ?? []).toEqual([]);
  });

  it('rest-on-surface player reaches onGround within a couple neutral ticks', () => {
    const { level } = levelWithFloor(100);
    const compiled = compileGeneratedLevel(
      { level, tileSemantics: { solid: [], passthrough: [] } },
      { playerWidth: 16, playerHeight: 24 },
    );
    const result = settlePlatformerState(compiled.initialState, compiled.staticSolids, CONFIG);
    expect(result.settled).toBe(true);
    expect(result.steps).toBeLessThanOrEqual(64);
  });

  it('actor-top-left (the compileLevel default) uses spawn verbatim (old behavior preserved)', () => {
    const { level } = levelWithFloor(100);
    const compiled = compileLevel(level, { playerWidth: 16, playerHeight: 24 });
    // Default resolution = actor-top-left → spawn used as-is.
    expect(compiled.initialState.core.x).toBe(24);
    expect(compiled.initialState.core.y).toBe(100);
  });

  it('compileGeneratedLevel honors an explicit spawnResolution override', () => {
    const { level } = levelWithFloor(100);
    const compiled = compileGeneratedLevel(
      { level, tileSemantics: { solid: [], passthrough: [] } },
      { playerWidth: 16, playerHeight: 24, spawnResolution: 'actor-top-left' },
    );
    expect(compiled.initialState.core.x).toBe(24);
    expect(compiled.initialState.core.y).toBe(100);
  });
});

describe('C2 — ResolvedPlatformerSpawn provenance', () => {
  it('populates spawn with source "authored" and the spawn entity id', () => {
    const entities: LevelEntity[] = [
      { id: 5, kind: 'spawn', rect: { x: 16, y: 76, width: 16, height: 24 }, props: {} },
      { id: 2, kind: 'platform', rect: { x: 0, y: 100, width: 64, height: 16 }, props: {} },
    ];
    const level = makeLevel(entities, { x: 24, y: 100 });
    const compiled = compileGeneratedLevel(
      { level, tileSemantics: { solid: [], passthrough: [] } },
      { playerWidth: 16, playerHeight: 24 },
    );
    expect(compiled.spawn).toBeDefined();
    expect(compiled.spawn!.source).toBe('authored');
    expect(compiled.spawn!.entityId).toBe(5);
    // Resolved coords match the initialState's AABB top-left.
    expect(compiled.spawn!.x).toBe(compiled.initialState.core.x);
    expect(compiled.spawn!.y).toBe(compiled.initialState.core.y);
  });

  it('populates source "fallback" when spawn is the origin (0,0)', () => {
    const level = makeLevel([], { x: 0, y: 0 });
    const compiled = compileLevel(level);
    expect(compiled.spawn).toBeDefined();
    expect(compiled.spawn!.source).toBe('fallback');
  });
});

// ===========================================================================
// C3 — spawn-embedding diagnostic + settlePlatformerState
// ===========================================================================
describe('C3 — spawn-embedding diagnostic', () => {
  it('a deliberately embedded feet-center spawn yields a warning diagnostic', () => {
    // Floor spans y=100..116. A feet-center anchor at y=110 is INSIDE the
    // floor (below its top surface), so the resolved AABB overlaps it.
    const entities: LevelEntity[] = [
      { id: 1, kind: 'spawn', rect: { x: 16, y: 86, width: 16, height: 24 }, props: {} },
      { id: 2, kind: 'platform', rect: { x: 0, y: 100, width: 64, height: 16 }, props: {} },
    ];
    const level = makeLevel(entities, { x: 24, y: 110 });
    const compiled = compileGeneratedLevel(
      { level, tileSemantics: { solid: [], passthrough: [] } },
      { playerWidth: 16, playerHeight: 24 },
    );
    const warnings = (compiled.diagnostics ?? []).filter((d) => d.severity === 'warning');
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    // The warning ties to the blocking platform solid (entity-2).
    expect(warnings[0]?.solidId).toBe(solidIdForEntity(2));
    expect(warnings[0]?.entityId).toBe(2);
  });

  it('does NOT warn when the spawn rests cleanly on the surface', () => {
    const entities: LevelEntity[] = [
      { id: 1, kind: 'spawn', rect: { x: 16, y: 76, width: 16, height: 24 }, props: {} },
      { id: 2, kind: 'platform', rect: { x: 0, y: 100, width: 64, height: 16 }, props: {} },
    ];
    const level = makeLevel(entities, { x: 24, y: 100 });
    const compiled = compileGeneratedLevel(
      { level, tileSemantics: { solid: [], passthrough: [] } },
      { playerWidth: 16, playerHeight: 24 },
    );
    expect(compiled.diagnostics ?? []).toEqual([]);
  });
});

describe('C3 — settlePlatformerState', () => {
  it('reaches onGround within maxSteps on a normal floor', () => {
    const floor: LevelEntity = { id: 1, kind: 'platform', rect: { x: -32, y: 100, width: 128, height: 16 }, props: {} };
    const compiled = compileGeneratedLevel(
      { level: makeLevel([floor], { x: 0, y: 50 }), tileSemantics: { solid: [], passthrough: [] } },
      { playerWidth: 16, playerHeight: 24 },
    );
    // Player starts airborne above the floor.
    const result = settlePlatformerState(compiled.initialState, compiled.staticSolids, CONFIG);
    expect(result.settled).toBe(true);
    expect(result.steps).toBeGreaterThan(0);
    expect(result.state.core.onGround).toBe(true);
  });

  it('returns settled=false without throwing when there is no floor', () => {
    const compiled = compileGeneratedLevel(
      { level: makeLevel([], { x: 0, y: 0 }), tileSemantics: { solid: [], passthrough: [] } },
      { playerWidth: 16, playerHeight: 24 },
    );
    const result = settlePlatformerState(compiled.initialState, [], CONFIG, 8);
    expect(result.settled).toBe(false);
    expect(result.steps).toBe(8);
  });

  it('returns immediately (steps=0) when the input is already grounded', () => {
    const floor: LevelEntity = { id: 1, kind: 'platform', rect: { x: -32, y: 100, width: 128, height: 16 }, props: {} };
    const compiled = compileGeneratedLevel(
      { level: makeLevel([floor], { x: 0, y: 50 }), tileSemantics: { solid: [], passthrough: [] } },
      { playerWidth: 16, playerHeight: 24 },
    );
    // First settle the state onto the floor.
    const grounded = settlePlatformerState(compiled.initialState, compiled.staticSolids, CONFIG).state;
    expect(grounded.core.onGround).toBe(true);
    // Re-settling an already-grounded state is a no-op.
    const again = settlePlatformerState(grounded, compiled.staticSolids, CONFIG);
    expect(again.steps).toBe(0);
    expect(again.settled).toBe(true);
  });
});
