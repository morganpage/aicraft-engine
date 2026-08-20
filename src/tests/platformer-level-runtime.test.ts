import { describe, it, expect } from 'vitest';
import {
  compileLevel,
  advanceMovingPlatform,
  movingPlatformToSolid,
  createMovingPlatformDisplacementProvider,
} from '../platformer/level-runtime';
import type { CompiledMovingPlatform } from '../platformer/level-runtime';
import type { LevelData, LevelEntity, MovingPlatformProps } from '../level/types';
import type { PlatformerConfig } from '../platformer/types';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';

/**
 * Unit tests for the level → platformer-runtime bridge (`compileLevel`,
 * `advanceMovingPlatform`, `movingPlatformToSolid`,
 * `createMovingPlatformDisplacementProvider`).
 *
 * These functions are pure data transforms (deterministic-core layer); they
 * must never mutate input and never throw on any malformed shape.
 */

function makeLevel(overrides: Partial<LevelData> = {}): LevelData {
  return {
    version: 1,
    id: 'test',
    name: 'Test',
    width: 400,
    height: 300,
    tileSize: 16,
    spawn: { x: 32, y: 64 },
    tiles: { data: [], cols: 25, rows: 18, tileSize: 16 },
    entities: [],
    nextEntityId: 1,
    ...overrides,
  };
}

function platform(id: number, x: number, y: number, w = 32, h = 8): LevelEntity {
  return { id, kind: 'platform', rect: { x, y, width: w, height: h }, props: {} };
}

function passthrough(id: number, x: number, y: number, w = 32, h = 8): LevelEntity {
  return { id, kind: 'passthrough', rect: { x, y, width: w, height: h }, props: {} };
}

function movingPlatform(
  id: number,
  x: number,
  y: number,
  path: { x: number; y: number }[],
  speed = 30,
  loopMode: 'loop' | 'pingpong' = 'loop',
): LevelEntity {
  const props: MovingPlatformProps = { speed, path, loopMode };
  return {
    id,
    kind: 'movingPlatform',
    rect: { x, y, width: 32, height: 8 },
    props,
  };
}

function makeMovingPlatformFixture(
  overrides: Partial<CompiledMovingPlatform> = {},
): CompiledMovingPlatform {
  return {
    id: 'entity-1',
    entity: movingPlatform(1, 0, 0, [{ x: 0, y: 0 }, { x: 100, y: 0 }]),
    x: 0,
    y: 0,
    path: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    speed: 100,
    loopMode: 'loop',
    targetIndex: 1,
    direction: 1,
    ...overrides,
  };
}

describe('compileLevel', () => {
  it('never throws for hostile accessors or extreme tile dimensions', () => {
    const hostile = {} as LevelData;
    Object.defineProperty(hostile, 'tiles', {
      get() { throw new Error('hostile tiles'); },
    });
    expect(() => compileLevel(hostile)).not.toThrow();
    expect(compileLevel(hostile).staticSolids).toEqual([]);

    const extreme = makeLevel({
      tiles: { data: [], cols: Number.MAX_SAFE_INTEGER, rows: Number.MAX_SAFE_INTEGER, tileSize: 16 },
    });
    const compiled = compileLevel(extreme, { tileTypeMap: () => 'solid' });
    expect(compiled.staticSolids).toEqual([]);
    expect(compiled.tileQuery(0, 0)).toBe('empty');
  });

  it('degrades hostile entities and tiles independently', () => {
    const hostileEntity = {} as LevelEntity;
    Object.defineProperty(hostileEntity, 'kind', {
      get() { throw new Error('hostile entity'); },
    });
    const level = makeLevel({
      spawn: { x: 77, y: 88 },
      entities: [platform(1, 0, 100), hostileEntity, platform(2, 40, 100)],
    });
    Object.defineProperty(level, 'tiles', {
      get() { throw new Error('hostile tiles'); },
    });
    const compiled = compileLevel(level);
    expect(compiled.staticSolids.map((solid) => solid.id)).toEqual(['entity-1', 'entity-2']);
    expect(compiled.initialState.core.x).toBe(77);
    expect(compiled.initialState.core.y).toBe(88);
    expect(compiled.tileQuery(0, 0)).toBe('empty');
  });

  it('preserves compiled geometry and spawn when config access is hostile', () => {
    const hostileConfig = {} as PlatformerConfig;
    Object.defineProperty(hostileConfig, 'jump', {
      get() { throw new Error('hostile config'); },
    });
    const compiled = compileLevel(
      makeLevel({
        spawn: { x: 44, y: 55 },
        entities: [platform(1, 0, 100)],
      }),
      { config: hostileConfig },
    );
    expect(compiled.staticSolids.map((solid) => solid.id)).toEqual(['entity-1']);
    expect(compiled.initialState.core.x).toBe(44);
    expect(compiled.initialState.core.y).toBe(55);
  });

  it('captures tile types and deterministically flattens solid and passthrough cells', () => {
    const level = makeLevel({
      tiles: {
        data: [1, 1, 0, 2, 2, 0, 1, 1],
        cols: 4,
        rows: 2,
        tileSize: 16,
      },
      entities: [platform(9, 0, 100)],
    });
    const compiled = compileLevel(level, {
      tileTypeMap: (value) => value === 1 ? 'solid' : value === 2 ? 'passthrough' : 'empty',
    });
    expect(compiled.staticSolids).toEqual([
      { id: 'entity-9', x: 0, y: 100, width: 32, height: 8 },
      { id: 'tile-0-0-32-16', x: 0, y: 0, width: 32, height: 16 },
      { id: 'tile-48-0-16-16', x: 48, y: 0, width: 16, height: 16, passthrough: true },
      { id: 'tile-0-16-16-16', x: 0, y: 16, width: 16, height: 16, passthrough: true },
      { id: 'tile-32-16-32-16', x: 32, y: 16, width: 32, height: 16 },
    ]);
    expect(compiled.tileQuery(0, 0)).toBe('solid');
    expect(compiled.tileQuery(3, 0)).toBe('passthrough');
    expect(compiled.tileQuery(-1, 0)).toBe('empty');
  });

  it('isolates throwing and malformed tile-classifier results per cell', () => {
    const compiled = compileLevel(makeLevel({
      tiles: { data: [1, 2, 3, 1], cols: 4, rows: 1, tileSize: 16 },
    }), {
      tileTypeMap: (value) => {
        if (value === 2) throw new Error('hostile classifier');
        if (value === 3) return 'lava' as never;
        return 'solid';
      },
    });
    expect(compiled.tileQuery(0, 0)).toBe('solid');
    expect(compiled.tileQuery(1, 0)).toBe('empty');
    expect(compiled.tileQuery(2, 0)).toBe('empty');
    expect(compiled.tileQuery(3, 0)).toBe('solid');
    expect(compiled.staticSolids).toEqual([
      { id: 'tile-0-0-16-16', x: 0, y: 0, width: 16, height: 16 },
      { id: 'tile-48-0-16-16', x: 48, y: 0, width: 16, height: 16 },
    ]);
  });

  it('vertically merges identical solid runs into one rectangle', () => {
    const compiled = compileLevel(makeLevel({
      tiles: { data: [1, 1, 1, 1, 1, 1], cols: 2, rows: 3, tileSize: 16 },
    }), {
      tileTypeMap: (value) => value === 1 ? 'solid' : 'empty',
    });
    expect(compiled.staticSolids).toEqual([
      { id: 'tile-0-0-32-48', x: 0, y: 0, width: 32, height: 48 },
    ]);
  });

  it('keeps passthrough runs on adjacent rows as separate one-way surfaces', () => {
    const compiled = compileLevel(makeLevel({
      tiles: { data: [2, 2, 2, 2], cols: 2, rows: 2, tileSize: 16 },
    }), {
      tileTypeMap: (value) => value === 2 ? 'passthrough' : 'empty',
    });
    expect(compiled.staticSolids).toEqual([
      {
        id: 'tile-0-0-32-16',
        x: 0,
        y: 0,
        width: 32,
        height: 16,
        passthrough: true,
      },
      {
        id: 'tile-0-16-32-16',
        x: 0,
        y: 16,
        width: 32,
        height: 16,
        passthrough: true,
      },
    ]);
  });

  it('preserves distinct stable identities for overlapping entity and tile solids', () => {
    const level = makeLevel({
      tiles: { data: [1], cols: 1, rows: 1, tileSize: 16 },
      entities: [platform(7, 0, 0, 16, 16)],
    });
    const compiled = compileLevel(level, {
      tileTypeMap: (value) => value === 1 ? 'solid' : 'empty',
    });
    expect(compiled.staticSolids).toEqual([
      { id: 'entity-7', x: 0, y: 0, width: 16, height: 16 },
      { id: 'tile-0-0-16-16', x: 0, y: 0, width: 16, height: 16 },
    ]);
  });

  it('produces byte-identical output on repeated compilation', () => {
    const level = makeLevel({
      tiles: { data: [1, 2, 0, 1], cols: 2, rows: 2, tileSize: 16 },
      entities: [
        platform(4, 16, 48),
        movingPlatform(8, 0, 0, [{ x: 0, y: 0 }, { x: 32, y: 0 }]),
      ],
    });
    const options = {
      tileTypeMap: (value: number) =>
        value === 1 ? 'solid' as const : value === 2 ? 'passthrough' as const : 'empty' as const,
    };
    const first = compileLevel(level, options);
    const second = compileLevel(level, options);
    expect(JSON.stringify(first.staticSolids)).toBe(JSON.stringify(second.staticSolids));
    expect(JSON.stringify(first.movingPlatforms)).toBe(JSON.stringify(second.movingPlatforms));
    expect(JSON.stringify(first.initialState)).toBe(JSON.stringify(second.initialState));
    const queryCoordinates = [
      [-1, -1], [0, 0], [1, 0], [0, 1], [1, 1], [2, 2],
    ] as const;
    expect(queryCoordinates.map(([x, y]) => first.tileQuery(x, y))).toEqual(
      queryCoordinates.map(([x, y]) => second.tileQuery(x, y)),
    );
    expect(first.staticSolids).not.toBe(second.staticSolids);
    expect(first.tileQuery).not.toBe(second.tileQuery);
  });

  it('captures classification once and is detached from later source mutation', () => {
    const data = [1];
    let mapped: 'solid' | 'empty' = 'solid';
    const compiled = compileLevel(makeLevel({
      tiles: { data, cols: 1, rows: 1, tileSize: 16 },
    }), { tileTypeMap: () => mapped });
    data[0] = 0;
    mapped = 'empty';
    expect(compiled.tileQuery(0, 0)).toBe('solid');
    expect(compiled.staticSolids).toHaveLength(1);
  });

  it('extracts platform entities as static solids with stable "entity-" prefixed ids', () => {
    const level = makeLevel({ entities: [platform(1, 0, 100), platform(2, 50, 200, 64, 16)] });
    const compiled = compileLevel(level);
    expect(compiled.staticSolids).toHaveLength(2);
    expect(compiled.staticSolids[0]).toEqual(
      expect.objectContaining({ id: 'entity-1', x: 0, y: 100, width: 32, height: 8 }),
    );
    expect(compiled.staticSolids[0].passthrough).toBeUndefined();
    expect(compiled.staticSolids[1]).toEqual(
      expect.objectContaining({ id: 'entity-2', x: 50, y: 200, width: 64, height: 16 }),
    );
  });

  it('passthrough entities become solids with passthrough: true', () => {
    const level = makeLevel({ entities: [passthrough(7, 10, 20)] });
    const compiled = compileLevel(level);
    expect(compiled.staticSolids).toHaveLength(1);
    expect(compiled.staticSolids[0].passthrough).toBe(true);
    expect(compiled.staticSolids[0].id).toBe('entity-7');
  });

  it('movingPlatform entities are extracted into movingPlatforms, not staticSolids', () => {
    const level = makeLevel({
      entities: [movingPlatform(3, 0, 0, [{ x: 0, y: 0 }, { x: 100, y: 0 }])],
    });
    const compiled = compileLevel(level);
    expect(compiled.staticSolids).toHaveLength(0);
    expect(compiled.movingPlatforms).toHaveLength(1);
    const mp = compiled.movingPlatforms[0];
    expect(mp.id).toBe('entity-3');
    expect(mp.path).toHaveLength(2);
    expect(mp.targetIndex).toBe(1);
    expect(mp.direction).toBe(1);
    expect(mp.speed).toBe(30);
    expect(mp.loopMode).toBe('loop');
  });

  it('movingPlatform starts at the first waypoint of its path', () => {
    const level = makeLevel({
      entities: [movingPlatform(3, 999, 999, [{ x: 10, y: 20 }, { x: 100, y: 20 }])],
    });
    const compiled = compileLevel(level);
    expect(compiled.movingPlatforms[0].x).toBe(10);
    expect(compiled.movingPlatforms[0].y).toBe(20);
  });

  it('hazard, trap, spawn, exit, decoration, trigger entities are NOT solids', () => {
    const level = makeLevel({
      entities: [
        { id: 1, kind: 'spawn', rect: { x: 0, y: 0, width: 16, height: 16 }, props: {} },
        {
          id: 2,
          kind: 'exit',
          rect: { x: 0, y: 0, width: 16, height: 16 },
          props: { isTrap: false, locked: false },
        },
        {
          id: 3,
          kind: 'trap',
          rect: { x: 0, y: 0, width: 16, height: 16 },
          props: { type: 'spikes', params: {} },
        },
        { id: 4, kind: 'hazard', rect: { x: 0, y: 0, width: 16, height: 16 }, props: {} },
        {
          id: 5,
          kind: 'decoration',
          rect: { x: 0, y: 0, width: 16, height: 16 },
          props: { sprite: 'a' },
        },
        {
          id: 6,
          kind: 'trigger',
          rect: { x: 0, y: 0, width: 16, height: 16 },
          props: { action: 'x', fields: {}, params: {} },
        },
      ],
    });
    const compiled = compileLevel(level);
    expect(compiled.staticSolids).toHaveLength(0);
    expect(compiled.movingPlatforms).toHaveLength(0);
  });

  it('initial state is constructed at the spawn point with default player dimensions', () => {
    const level = makeLevel({ spawn: { x: 123, y: 45 } });
    const compiled = compileLevel(level);
    expect(compiled.initialState.core.x).toBe(123);
    expect(compiled.initialState.core.y).toBe(45);
    expect(compiled.initialState.core.width).toBe(16);
    expect(compiled.initialState.core.height).toBe(24);
    expect(compiled.initialState.tick).toBe(0);
    expect(compiled.initialState.core.vx).toBe(0);
    expect(compiled.initialState.core.vy).toBe(0);
  });

  it('initial state respects custom player dimensions', () => {
    const level = makeLevel();
    const compiled = compileLevel(level, { playerWidth: 24, playerHeight: 32 });
    expect(compiled.initialState.core.width).toBe(24);
    expect(compiled.initialState.core.height).toBe(32);
  });

  it('initial state accepts a custom config that propagates into the abilities', () => {
    const level = makeLevel();
    const customConfig: PlatformerConfig = {
      ...DEFAULT_PLATFORMER_CONFIG,
      moveSpeed: 999,
      gravity: 1,
      maxFallSpeed: 1,
      airAccelMultiplier: 1,
      wallSlideEnabled: false,
      dashEnabled: false,
      doubleJumpEnabled: false,
    };
    const compiled = compileLevel(level, { config: customConfig });
    // The state carries no direct config ref, but the dash ability seeds from config.
    expect(compiled.initialState.abilities['dash']).toBeDefined();
  });

  it('moving platform with fewer than 2 valid waypoints gets an empty path', () => {
    const level = makeLevel({ entities: [movingPlatform(1, 10, 20, [{ x: 50, y: 50 }])] });
    const compiled = compileLevel(level);
    expect(compiled.movingPlatforms).toHaveLength(1);
    expect(compiled.movingPlatforms[0].path).toHaveLength(0);
    expect(compiled.movingPlatforms[0].targetIndex).toBe(0);
  });

  it('does not mutate the input level', () => {
    const level = makeLevel({ entities: [platform(1, 0, 0)] });
    const snap = JSON.parse(JSON.stringify(level));
    compileLevel(level);
    expect(level).toEqual(snap);
  });

  it('defensive: malformed level (no entities array) returns empty solids list and a state at spawn', () => {
    const level = makeLevel();
    delete (level as { entities?: unknown }).entities;
    const compiled = compileLevel(level);
    expect(compiled.staticSolids).toHaveLength(0);
    expect(compiled.movingPlatforms).toHaveLength(0);
    expect(compiled.initialState.core.x).toBe(32);
  });
});

describe('advanceMovingPlatform', () => {
  it('moves toward the current target by speed*dt', () => {
    const p = makeMovingPlatformFixture({
      x: 0,
      y: 0,
      path: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      speed: 100,
      targetIndex: 1,
    });
    const next = advanceMovingPlatform(p, 0.5);
    expect(next.x).toBeCloseTo(50, 5);
    expect(next.y).toBeCloseTo(0, 5);
    expect(next.targetIndex).toBe(1);
  });

  it('snaps to the target and advances the index when within 1 px', () => {
    const p = makeMovingPlatformFixture({
      x: 99.5,
      y: 0,
      path: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      speed: 100,
      targetIndex: 1,
    });
    const next = advanceMovingPlatform(p, 1);
    expect(next.x).toBe(100);
    expect(next.y).toBe(0);
    expect(next.targetIndex).toBe(0);
  });

  it('loop mode wraps targetIndex to 0 when reaching the last waypoint', () => {
    const p = makeMovingPlatformFixture({
      x: 99.5,
      y: 0,
      path: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      targetIndex: 1,
      loopMode: 'loop',
    });
    const next = advanceMovingPlatform(p, 1);
    expect(next.targetIndex).toBe(0);
  });

  it('pingpong reverses direction at the end of the path', () => {
    const p = makeMovingPlatformFixture({
      x: 99.5,
      y: 0,
      path: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      targetIndex: 1,
      direction: 1,
      loopMode: 'pingpong',
    });
    const next = advanceMovingPlatform(p, 1);
    expect(next.x).toBe(100);
    expect(next.targetIndex).toBe(0);
    expect(next.direction).toBe(-1);
  });

  it('pingpong reverses at index 0 when reaching the start going backward', () => {
    const p = makeMovingPlatformFixture({
      x: 0.5,
      y: 0,
      path: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      targetIndex: 0,
      direction: -1,
      loopMode: 'pingpong',
    });
    const next = advanceMovingPlatform(p, 1);
    expect(next.x).toBe(0);
    expect(next.targetIndex).toBe(1);
    expect(next.direction).toBe(1);
  });

  it('platform with empty path returns the input unchanged', () => {
    const p = makeMovingPlatformFixture({ path: [], targetIndex: 0 });
    const next = advanceMovingPlatform(p, 1);
    expect(next).toEqual(p);
  });

  it('never throws on NaN dt', () => {
    const p = makeMovingPlatformFixture();
    expect(() => advanceMovingPlatform(p, NaN)).not.toThrow();
  });

  it('pure: input platform is not mutated', () => {
    const p = makeMovingPlatformFixture();
    const snap = JSON.parse(JSON.stringify(p)) as CompiledMovingPlatform;
    advanceMovingPlatform(p, 1);
    expect(p).toEqual(snap);
  });
});

describe('movingPlatformToSolid', () => {
  it('returns a Solid with the platform id, current position, and entity rect dimensions', () => {
    const entity = movingPlatform(5, 999, 999, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    const p: CompiledMovingPlatform = {
      id: 'entity-5',
      entity,
      x: 75,
      y: 12,
      path: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      speed: 30,
      loopMode: 'loop',
      targetIndex: 1,
      direction: 1,
    };
    const solid = movingPlatformToSolid(p);
    expect(solid.id).toBe('entity-5');
    expect(solid.x).toBe(75);
    expect(solid.y).toBe(12);
    expect(solid.width).toBe(32);
    expect(solid.height).toBe(8);
    expect(solid.passthrough).toBeUndefined();
  });
});

describe('createMovingPlatformDisplacementProvider', () => {
  it('returns dx/dy = current - previous for the matching id', () => {
    const prev: CompiledMovingPlatform[] = [makeMovingPlatformFixture({ id: 'p1', x: 10, y: 5 })];
    const cur: CompiledMovingPlatform[] = [makeMovingPlatformFixture({ id: 'p1', x: 14, y: 1 })];
    const provider = createMovingPlatformDisplacementProvider(cur, prev);
    expect(provider('p1')).toEqual({ dx: 4, dy: -4 });
  });

  it('returns null when id has no matching previous (unknown id)', () => {
    const cur: CompiledMovingPlatform[] = [makeMovingPlatformFixture({ id: 'p1' })];
    const provider = createMovingPlatformDisplacementProvider(cur, []);
    expect(provider('p1')).toBeNull();
  });

  it('returns null when id is not in current', () => {
    const provider = createMovingPlatformDisplacementProvider([], []);
    expect(provider('unknown')).toBeNull();
  });

  it('returns null when displacement is zero (no movement this tick)', () => {
    const prev: CompiledMovingPlatform[] = [makeMovingPlatformFixture({ id: 'p1', x: 10, y: 5 })];
    const cur: CompiledMovingPlatform[] = [makeMovingPlatformFixture({ id: 'p1', x: 10, y: 5 })];
    const provider = createMovingPlatformDisplacementProvider(cur, prev);
    expect(provider('p1')).toBeNull();
  });
});
