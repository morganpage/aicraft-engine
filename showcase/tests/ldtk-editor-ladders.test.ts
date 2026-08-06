/**
 * Ladder climb behaviour in the LDtk editor's play mode.
 *
 * Climb is an engine ability (gated by `climbEnabled`): while the player's body
 * overlaps a `ladder`-flagged solid, the climb ability sets vertical velocity
 * (stick when idle, ±climbSpeed when Up/Down held), suppresses gravity, and the
 * kernel resets the jump state so climb and jump coexist without the desync the
 * old post-hoc override suffered. These tests drive the ability through the real
 * `stepPlatformer` with ladder-tagged solids and a `climb` input axis.
 */

import { describe, expect, it } from 'vitest';
import {
  createPlatformerState,
  stepPlatformer,
  PRECISION_PLATFORMER,
} from '../../src/platformer';
import type { PlatformerConfig } from '../../src/platformer';
import type { Solid } from '../../src/collision';
import { makeLadderMask, isOnLadder, PLAYER_WIDTH, CLIMB_SPEED } from '../sections/ldtk-editor/play';
import type { LdtkLevel } from '../../src/ldtk';

/** Tile size used throughout the bundled LDtk sample. */
const TILE = 16;
/** Fixed timestep the showcase loop runs at (~60 fps). */
const DT = 1 / 60;

/** Play config with the climb ability enabled (mirrors `play.ts`). */
const CLIMB_CONFIG: Readonly<PlatformerConfig> = {
  ...PRECISION_PLATFORMER,
  climbEnabled: true,
  climbSpeed: CLIMB_SPEED,
};

/** An idle (never pressed) jump edge. */
const IDLE = { pressed: false, released: false, held: false };

/**
 * A 1-cell-wide ladder shaft: one column of ladder solids with solid walls on
 * both sides, over `rows` rows. Column 1 is the ladder (a `ladder: true`
 * solid); columns 0 and 2 are walls.
 */
function shaftSolids(rows: number): Solid[] {
  const solids: Solid[] = [
    { id: 'wall-l', x: 0, y: 0, width: TILE, height: rows * TILE },
    { id: 'wall-r', x: 2 * TILE, y: 0, width: TILE, height: rows * TILE },
  ];
  for (let r = 0; r < rows; r++) {
    solids.push({ id: `ladder-${r}`, x: TILE, y: r * TILE, width: TILE, height: TILE, ladder: true });
  }
  return solids;
}

/**
 * Player placed inside the shaft (column 1), vertically at row `row`. The body
 * is PLAYER_WIDTH wide and 2 tiles tall, centred in the shaft cell.
 */
function playerInShaft(row: number, config: Readonly<PlatformerConfig>) {
  const cellX = TILE;
  const height = TILE * 2;
  const x = cellX + (TILE - PLAYER_WIDTH) / 2;
  const y = row * TILE;
  return createPlatformerState(x, y, config, PLAYER_WIDTH, height);
}

describe('LDtk play-mode ladders (engine climb ability)', () => {
  const rows = 8;
  const solids = shaftSolids(rows);

  it('sticks in place when idle on a ladder (gravity cancelled, no fall)', () => {
    let state = playerInShaft(4, CLIMB_CONFIG);
    const startY = state.core.y;

    // Idle for half a second: no climb, no jump. Gravity must not pull the
    // player down the shaft.
    for (let i = 0; i < 30; i++) {
      state = stepPlatformer(
        state,
        { moveX: 0, jump: IDLE, dash: null, climb: 0 },
        solids,
        DT,
        CLIMB_CONFIG,
      ).state;
    }
    expect(state.core.y).toBeCloseTo(startY, 5);
    expect(state.abilities['climb']?.kind).toBe('climb');
    if (state.abilities['climb']?.kind === 'climb') {
      expect(state.abilities['climb'].climbing).toBe(true);
    }
  });

  it('can move horizontally while on a ladder (walk off it)', () => {
    // Regression guard for "can't move off ladders": horizontal input must NOT
    // be frozen while climbing. A ladder with open space beside it (no right
    // wall) lets the player walk right off the shaft.
    const openLadder: Solid[] = [
      { id: 'wall-l', x: 0, y: 0, width: TILE, height: 8 * TILE },
      { id: 'ladder', x: TILE, y: 3 * TILE, width: TILE, height: 4 * TILE, ladder: true },
    ];
    let state = playerInShaft(4, CLIMB_CONFIG);
    const startX = state.core.x;

    for (let i = 0; i < 30; i++) {
      state = stepPlatformer(
        state,
        { moveX: 1, jump: IDLE, dash: null, climb: 0 },
        openLadder,
        DT,
        CLIMB_CONFIG,
      ).state;
    }
    // The player must have moved right off the ladder, not be frozen at startX.
    expect(state.core.x).toBeGreaterThan(startX + 10);
  });

  it('climbs up when holding Up', () => {
    let state = playerInShaft(4, CLIMB_CONFIG);
    const startY = state.core.y;

    // Hold Up (climb -1) for half a second.
    for (let i = 0; i < 30; i++) {
      state = stepPlatformer(
        state,
        { moveX: 0, jump: IDLE, dash: null, climb: -1 },
        solids,
        DT,
        CLIMB_CONFIG,
      ).state;
    }
    // Must have moved UP (negative y) at roughly CLIMB_SPEED * 0.5s = 60px.
    expect(state.core.y).toBeLessThan(startY - 40);
  });

  it('climbs down when holding Down (not blocked by the ladder as a floor)', () => {
    let state = playerInShaft(2, CLIMB_CONFIG);
    const startY = state.core.y;

    // Hold Down (climb +1) for half a second. The historical bug: the ladder
    // translated to a passthrough one-way platform, so descending landed the
    // player on the ladder cell below instead of passing through.
    for (let i = 0; i < 30; i++) {
      state = stepPlatformer(
        state,
        { moveX: 0, jump: IDLE, dash: null, climb: 1 },
        solids,
        DT,
        CLIMB_CONFIG,
      ).state;
    }
    // Must have moved DOWN (positive y) by ~60px.
    expect(state.core.y).toBeGreaterThan(startY + 40);
  });

  it('climbs to the top of the ladder and is not frozen (can move along it)', () => {
    // Transition test: climb up the shaft for a good stretch — the player must
    // rise substantially and not get stuck mid-ladder. A regression guard for
    // "can't move off/along ladders". (A floor above row 0 would block further
    // rise; here we just confirm sustained upward movement works.)
    let state = playerInShaft(6, CLIMB_CONFIG);
    const startY = state.core.y;

    for (let i = 0; i < 60; i++) {
      state = stepPlatformer(
        state,
        { moveX: 0, jump: IDLE, dash: null, climb: -1 },
        solids,
        DT,
        CLIMB_CONFIG,
      ).state;
    }
    // Must have risen well past the start (~CLIMB_SPEED * 1s = 120px), stopping
    // only when the body leaves the ladder cells at the top of the shaft.
    expect(state.core.y).toBeLessThan(startY - 40);
  });

  it('jumping on a ladder does not stick (jump wins over climb)', () => {
    let state = playerInShaft(4, CLIMB_CONFIG);
    const startY = state.core.y;

    // One tick with jump pressed while on the ladder: the climb ability steps
    // aside (jump wins), so the player must NOT be pinned to startY by a climb
    // stick. With no floor, gravity begins a fall (y increases).
    const after = stepPlatformer(
      state,
      { moveX: 0, jump: { pressed: true, released: false, held: true }, dash: null, climb: -1 },
      solids,
      DT,
      CLIMB_CONFIG,
    ).state;
    expect(after.core.y).not.toBe(startY);
  });

  it('resets jump state while climbing so jump works after leaving the ladder', () => {
    // The original bug: climbing desynced the jump ability's internal state.
    // This pins that the jump state is reset to grounded each climb tick and
    // resumes cleanly. Climb a few ticks, then drive a jump from a grounded
    // floor and assert a real launch.
    let state = playerInShaft(4, CLIMB_CONFIG);
    for (let i = 0; i < 5; i++) {
      state = stepPlatformer(
        state,
        { moveX: 0, jump: IDLE, dash: null, climb: -1 },
        solids,
        DT,
        CLIMB_CONFIG,
      ).state;
    }
    // After climbing, the jump slice must be in its grounded phase (the reset).
    const jumpSlice = state.abilities['jump'];
    if (jumpSlice && jumpSlice.kind === 'jump') {
      expect(jumpSlice.jump.phase).toBe('grounded');
    }

    // Place on a floor and jump: must launch (strongly negative vy) after the
    // anticipation delay, proving no stale climb momentum carried over.
    const floorTop = 6 * TILE;
    state = {
      ...state,
      core: { ...state.core, x: 4 * TILE, y: floorTop - state.core.height, vx: 0, vy: 0, onGround: true },
    };
    const floor: Solid[] = [{ id: 'floor', x: 3 * TILE, y: floorTop, width: 10 * TILE, height: TILE }];
    for (let i = 0; i < 3; i++) {
      state = stepPlatformer(
        state,
        { moveX: 0, jump: IDLE, dash: null, climb: 0 },
        floor,
        DT,
        CLIMB_CONFIG,
      ).state;
    }
    // Hold jump long enough to pass anticipation, then assert the rise.
    for (let i = 0; i < 6; i++) {
      state = stepPlatformer(
        state,
        { moveX: 0, jump: { pressed: i === 0, released: false, held: true }, dash: null, climb: 0 },
        floor,
        DT,
        CLIMB_CONFIG,
      ).state;
    }
    expect(state.core.vy).toBeLessThan(-50);
  });

  it('falls normally when off the ladder (climb intent ignored off-ladder)', () => {
    // Empty solids — nothing is a ladder, so the player is always off-ladder.
    const noSolids: Solid[] = [];
    let state = playerInShaft(2, CLIMB_CONFIG); // position irrelevant: no ladders
    const startY = state.core.y;

    for (let i = 0; i < 30; i++) {
      state = stepPlatformer(
        state,
        { moveX: 0, jump: IDLE, dash: null, climb: -1 },
        noSolids,
        DT,
        CLIMB_CONFIG,
      ).state;
    }
    // Off the ladder, gravity applies and the climb intent is ignored — so the
    // player falls (positive y) rather than rising.
    expect(state.core.y).toBeGreaterThan(startY);
  });
});

describe('LDtk play-mode ladder mask + tint helpers', () => {
  it('makeLadderMask flags ladder IntGrid cells', () => {
    const rows = 4, cols = 3;
    const csv: number[] = [];
    for (let y = 0; y < rows; y++) csv.push(1, 2, 1); // solid | ladder | solid
    const level = {
      layerInstances: [
        { __type: 'IntGrid', __cWid: cols, __cHei: rows, __gridSize: TILE, intGridCsv: csv },
      ],
    } as unknown as LdtkLevel;
    const mask = makeLadderMask(level, TILE);
    expect(mask.cells.size).toBe(rows);
    expect(mask.cells.has('1,0')).toBe(true);
    expect(isOnLadder({ x: TILE, y: 0, width: TILE, height: TILE }, mask)).toBe(true);
    expect(isOnLadder({ x: 0, y: 0, width: TILE, height: TILE }, mask)).toBe(false);
  });
});
