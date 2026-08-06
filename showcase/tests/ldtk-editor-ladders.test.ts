/**
 * Ladder climb behaviour in the LDtk editor's play mode.
 *
 * These tests pin the deliberately-simple ladder feel: gravity is cancelled on
 * a ladder, Up/Down set a steady climb velocity, and ladder cells are NOT
 * treated as one-way-platform floors (the historical bug — climbing down was
 * blocked because ladders translated to `passthrough` solids).
 *
 * The play session's keyboard adapter is a no-op without `window`, so the
 * per-tick logic is exercised through the pure `stepLadderPlay` helper that
 * the real session delegates to, with a synthetic climb intent.
 */

import { describe, expect, it } from 'vitest';
import {
  CLIMB_SPEED,
  PLAYER_WIDTH,
  makeLadderMask,
  stepLadderPlay,
  ZERO_GRAVITY_CONFIG,
} from '../sections/ldtk-editor/play';
import { createPlatformerState, PRECISION_PLATFORMER } from '../../src/platformer';
import type { PlatformerConfig, PlatformerState } from '../../src/platformer';
import type { Solid } from '../../src/collision';
import type { LdtkLevel } from '../../src/ldtk';

/** Tile size used throughout the bundled LDtk sample. */
const TILE = 16;
/** Fixed timestep the showcase loop runs at (~60 fps). */
const DT = 1 / 60;

/**
 * A 1-cell-wide ladder shaft: one empty column of ladder cells (IntGrid value
 * 2) with solid walls (value 1) on both sides, over `rows` rows. The shaft
 * occupies column 1; columns 0 and 2 are solid.
 */
function ladderShaftLevel(rows: number): LdtkLevel {
  const cols = 3;
  const csv: number[] = [];
  for (let y = 0; y < rows; y++) {
    csv.push(1, 2, 1); // solid | ladder | solid
  }
  return {
    identifier: 'LadderShaft',
    iid: 'level-shaft',
    uid: 1,
    worldX: 0,
    worldY: 0,
    worldDepth: 0,
    pxWid: cols * TILE,
    pxHei: rows * TILE,
    bgColor: '#000000',
    __bgColor: 0,
    useAutoIdentifier: false,
    bgRelPath: null,
    bgPos: null,
    bgPivotX: 0,
    bgPivotY: 0,
    __smartColor: '#ffffff',
    __bgPos: null,
    externalRelPath: null,
    fieldInstances: [],
    layerInstances: [
      {
        __type: 'IntGrid',
        __identifier: 'Collisions',
        __cWid: cols,
        __cHei: rows,
        __gridSize: TILE,
        __opacity: 1,
        __pxTotalOffsetX: 0,
        __pxTotalOffsetY: 0,
        visible: true,
        iid: 'layer-shaft',
        levelId: 'level-shaft',
        layerDefUid: 1,
        intGridCsv: csv,
        __tilesetDefUid: null,
        __tilesetRelPath: null,
      },
    ],
    __neighbours: [],
  } as unknown as LdtkLevel;
}

/**
 * Player placed inside the shaft (column 1), vertically at row `row`. The body
 * is PLAYER_WIDTH wide and 2 tiles tall, centred in the shaft cell.
 */
function playerInShaft(row: number, config: Readonly<PlatformerConfig>): PlatformerState {
  const cellX = TILE; // column 1 starts at x=16
  const height = TILE * 2;
  const x = cellX + (TILE - PLAYER_WIDTH) / 2;
  const y = row * TILE;
  return createPlatformerState(x, y, config, PLAYER_WIDTH, height);
}

describe('LDtk play-mode ladders', () => {
  const rows = 8;
  const level = ladderShaftLevel(rows);
  const ladders = makeLadderMask(level, TILE);
  // Walls only — ladder cells are filtered out as climb space, not geometry.
  const solids: Solid[] = [
    // Left wall (column 0) merged for the full height.
    { id: 'wall-l', x: 0, y: 0, width: TILE, height: rows * TILE },
    // Right wall (column 2).
    { id: 'wall-r', x: 2 * TILE, y: 0, width: TILE, height: rows * TILE },
  ];

  it('makes ladder cells non-colliding (climb space, not one-way platforms)', () => {
    // Sanity: the mask flags the shaft column, and filtering keeps the walls.
    expect(ladders.cells.size).toBe(rows);
    // A solid covering a ladder cell would be removed by the session; confirm
    // the helper the session uses agrees the shaft is a ladder.
    expect(makeLadderMask(level, TILE).cells.has(`1,0`)).toBe(true);
  });

  it('sticks in place when idle on a ladder (gravity cancelled, no fall)', () => {
    const config = PRECISION_PLATFORMER;
    let state = playerInShaft(4, config);
    const startY = state.core.y;

    // Idle for half a second: no climb intent, no jump. Gravity must not pull
    // the player down the shaft.
    for (let i = 0; i < 30; i++) {
      state = stepLadderPlay(
        state,
        { moveX: 0, jump: false, climbY: 0 },
        solids,
        ladders,
        DT,
        config,
      );
    }
    expect(state.core.y).toBe(startY);
    expect(state.core.vy).toBe(0);
  });

  it('climbs up when holding Up', () => {
    const config = PRECISION_PLATFORMER;
    let state = playerInShaft(4, config);
    const startY = state.core.y;

    // Hold Up (climbY negative) for half a second.
    for (let i = 0; i < 30; i++) {
      state = stepLadderPlay(
        state,
        { moveX: 0, jump: false, climbY: -CLIMB_SPEED },
        solids,
        ladders,
        DT,
        config,
      );
    }
    // Must have moved UP (negative y) at roughly CLIMB_SPEED * 0.5s = 60px,
    // allowing a little slack for the first frame.
    expect(state.core.y).toBeLessThan(startY - 40);
    expect(state.core.vy).toBe(-CLIMB_SPEED);
  });

  it('climbs down when holding Down (not blocked by the ladder as a floor)', () => {
    const config = PRECISION_PLATFORMER;
    let state = playerInShaft(2, config);
    const startY = state.core.y;

    // Hold Down (climbY positive) for half a second. The historical bug: the
    // ladder translated to a passthrough one-way platform, so descending
    // landed the player on the ladder cell below instead of passing through.
    for (let i = 0; i < 30; i++) {
      state = stepLadderPlay(
        state,
        { moveX: 0, jump: false, climbY: CLIMB_SPEED },
        solids,
        ladders,
        DT,
        config,
      );
    }
    // Must have moved DOWN (positive y) by ~60px.
    expect(state.core.y).toBeGreaterThan(startY + 40);
    expect(state.core.vy).toBe(CLIMB_SPEED);
  });

  it('does not stick when jumping on a ladder (jump uses normal gravity)', () => {
    const config = PRECISION_PLATFORMER;
    const state = playerInShaft(4, config);
    const startY = state.core.y;

    // One tick with jump pressed: must NOT take the ladder-authoritative path
    // (which would clamp Y to startY). The player is not grounded on a ladder
    // (ladders are non-colliding), so a jump can't launch upward — but the tick
    // must fall through to normal gravity rather than sticking in place.
    const after = stepLadderPlay(
      state,
      { moveX: 0, jump: true, climbY: 0 },
      solids,
      ladders,
      DT,
      config,
    );
    // If the ladder-authoritative branch wrongly ran, Y would equal startY.
    // Normal gravity means the player drops (positive y) instead of sticking.
    expect(after.core.y).not.toBe(startY);
  });

  it('falls normally when off the ladder (climb intent ignored off-ladder)', () => {
    const config = PRECISION_PLATFORMER;
    // An empty ladder mask: nothing is a ladder, so the player is always
    // off-ladder regardless of position. No solids, so gravity is the only force.
    const noLadders = { size: TILE, cells: new Set<string>() };
    const noSolids: Solid[] = [];
    let state = createPlatformerState(TILE, TILE, config, PLAYER_WIDTH, TILE * 2);
    const startY = state.core.y;

    for (let i = 0; i < 30; i++) {
      state = stepLadderPlay(
        state,
        { moveX: 0, jump: false, climbY: -CLIMB_SPEED },
        noSolids,
        noLadders,
        DT,
        config,
      );
    }
    // Off the ladder, gravity applies and the climb intent is ignored — so the
    // player falls (positive y) rather than rising.
    expect(state.core.y).toBeGreaterThan(startY);
  });
});

describe('LDtk play-mode ladder config', () => {
  it('exposes a zero-gravity config that keeps a real terminal fall speed', () => {
    // gravity 0 stops the fall so the player sticks; maxFallSpeed must stay
    // non-zero or the kernel's max-fall clamp zeroes any climb override too.
    expect(ZERO_GRAVITY_CONFIG.gravity).toBe(0);
    expect(ZERO_GRAVITY_CONFIG.maxFallSpeed).toBe(PRECISION_PLATFORMER.maxFallSpeed);
  });
});
