/**
 * Pure-helper tests for the LDtk editor's animated-mob overlay.
 *
 * The overlay runtime (`createMobOverlay`) touches the DOM (Image decode) and
 * the canvas, so it is not driven here; instead we exercise the pure functions
 * it is built from — waypoint derivation from the author's `patrol` field and
 * the encounter-order character assignment — mirroring how
 * `ldtk-editor-ladders.test.ts` tests `play.ts`'s pure ladder helpers.
 */

import { describe, expect, it } from 'vitest';
import {
  mobPatrolWaypoints,
  assignMobCharacter,
  nextPatrolTarget,
} from '../sections/ldtk-editor/mob-sprites';
import type { LdtkEntityInstance } from '../../src/ldtk';

/** The grid size used by the 1-bit platformer sample. */
const GRID = 16;

/** Build a minimal Mob entity instance for the waypoints tests. */
function mob(overrides: Partial<LdtkEntityInstance> = {}): LdtkEntityInstance {
  return {
    __identifier: 'Mob',
    defUid: 52,
    iid: 'mob-iid',
    __tags: [],
    px: [336, 32],
    width: 16,
    height: 16,
    __grid: [21, 2],
    __pivot: [0, 0],
    __tile: null,
    fieldInstances: [],
    ...overrides,
  };
}

/** A `patrol` field instance carrying an `Array<Point>` of grid cells. */
function patrolField(points: ReadonlyArray<{ cx: number; cy: number }>) {
  return {
    __identifier: 'patrol',
    __type: 'Array<Point>',
    __value: points,
    defUid: 53,
  };
}

describe('mobPatrolWaypoints', () => {
  it('seeds the spawn position and converts patrol grid cells to pixels', () => {
    const entity = mob({
      px: [336, 32],
      fieldInstances: [patrolField([{ cx: 27, cy: 2 }])],
    });
    expect(mobPatrolWaypoints(entity, GRID)).toEqual([
      { x: 336, y: 32 },
      { x: 432, y: 32 },
    ]);
  });

  it('appends multiple waypoints in order', () => {
    const entity = mob({
      px: [256, 80],
      fieldInstances: [patrolField([
        { cx: 19, cy: 5 },
        { cx: 16, cy: 5 },
      ])],
    });
    expect(mobPatrolWaypoints(entity, GRID)).toEqual([
      { x: 256, y: 80 },
      { x: 304, y: 80 },
      { x: 256, y: 80 },
    ]);
  });

  it('returns an empty path when there are no patrol waypoints', () => {
    // An empty patrol yields no path: the mob has nowhere to go, so the overlay
    // leaves it animating in place.
    const entity = mob({ fieldInstances: [patrolField([])] });
    expect(mobPatrolWaypoints(entity, GRID)).toEqual([]);
  });

  it('returns an empty path when the patrol field is null', () => {
    // LDtk marks `patrol` as `canBeNull: true`; a Mob may carry `__value: null`.
    const entity = mob({
      fieldInstances: [{ __identifier: 'patrol', __type: 'Array<Point>', __value: null }],
    });
    expect(mobPatrolWaypoints(entity, GRID)).toEqual([]);
  });

  it('returns an empty path when there is no patrol field at all', () => {
    const entity = mob({ fieldInstances: [] });
    expect(mobPatrolWaypoints(entity, GRID)).toEqual([]);
  });

  it('ignores malformed point entries but keeps valid ones', () => {
    const entity = mob({
      fieldInstances: [patrolField([
        { cx: 27, cy: 2 },
        // @ts-expect-error — exercising a defensively-handled bad entry
        { cx: 'oops' },
        // @ts-expect-error — a null entry that LDtk would not emit but we guard
        null,
        { cx: 30, cy: 2 },
      ])],
    });
    expect(mobPatrolWaypoints(entity, GRID)).toEqual([
      { x: 336, y: 32 },
      { x: 432, y: 32 },
      { x: 480, y: 32 },
    ]);
  });

  it('returns an empty array for a non-Mob entity', () => {
    const entity = mob({
      __identifier: 'Spawn',
      fieldInstances: [patrolField([{ cx: 27, cy: 2 }])],
    });
    expect(mobPatrolWaypoints(entity, GRID)).toEqual([]);
  });

  it('matches "mob" case-insensitively', () => {
    const entity = mob({
      __identifier: 'mob',
      fieldInstances: [patrolField([{ cx: 27, cy: 2 }])],
    });
    expect(mobPatrolWaypoints(entity, GRID)).toHaveLength(2);
  });
});

describe('assignMobCharacter', () => {
  it('assigns the first mob to slime and the second to walker', () => {
    expect(assignMobCharacter(0)).toBe('slime');
    expect(assignMobCharacter(1)).toBe('walker');
  });

  it('cycles for any further mobs', () => {
    expect(assignMobCharacter(2)).toBe('slime');
    expect(assignMobCharacter(3)).toBe('walker');
  });
});

describe('nextPatrolTarget', () => {
  const waypoints = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it('holds its target while the position is still far away', () => {
    const result = nextPatrolTarget(
      { x: 10, y: 0 },
      waypoints[1]!,
      1,
      1,
      waypoints,
    );
    expect(result).toEqual({ index: 1, direction: 1 });
  });

  it('advances to the next waypoint on reaching the target', () => {
    const result = nextPatrolTarget(
      { x: 100, y: 0 },
      waypoints[1]!,
      1,
      1,
      waypoints,
    );
    expect(result).toEqual({ index: 2, direction: 1 });
  });

  it('reverses direction at the end of the path (ping-pong)', () => {
    const result = nextPatrolTarget(
      { x: 100, y: 100 },
      waypoints[2]!,
      2,
      1,
      waypoints,
    );
    expect(result).toEqual({ index: 1, direction: -1 });
  });

  it('reverses direction at the start of the path', () => {
    const result = nextPatrolTarget(
      { x: 0, y: 0 },
      waypoints[0]!,
      0,
      -1,
      waypoints,
    );
    expect(result).toEqual({ index: 1, direction: 1 });
  });
});
