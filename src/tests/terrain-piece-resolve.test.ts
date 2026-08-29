/**
 * TE.1b prototype tests — bonded/free resolution.
 *
 * The first test is the Phase T spec's own acceptance case, verbatim:
 * "an isolated 1×3 strip resolves free → left-end/middle/right-end; bonded
 * against neighbouring floor → middle/middle/middle."
 */

import { describe, it, expect } from 'vitest';
import type { TileGrid } from '../level/types';
import { prepareTerrainArtRuleGrid } from '../terrain-art/rule-grid';
import {
  resolveTerrainPiece,
  resolveTerrainPieceFromPrepared,
  type TerrainPiece,
} from '../terrain-art/piece';
import { STRIP_RULE_SET, STONE_KINDS, ruleNamesOf } from './terrain-piece-fixtures';

const TILE = 16;

const grid = (data: readonly number[], cols: number, rows: number): TileGrid =>
  Object.freeze({ data: Object.freeze(data), cols, rows, tileSize: TILE });

/** A 1×3 solid strip, on its own. */
const STRIP = grid([1, 1, 1], 3, 1);

/**
 * A 1×9 field: solid floor, the middle 3 cells being the piece.
 * `[floor floor floor | piece piece piece | floor floor floor]`
 */
const CONTINUOUS_FIELD = grid([1, 1, 1, 1, 1, 1, 1, 1, 1], 9, 1);

const piece = (bondPolicy: 'bonded' | 'free', originCol = 0): TerrainPiece => ({
  id: 'test-piece',
  cells: STRIP,
  originCol,
  originRow: 0,
  bondPolicy,
});

describe('resolveTerrainPiece — the spec acceptance case', () => {
  it('free: an isolated 1×3 strip caps both ends', () => {
    const resolved = resolveTerrainPiece(piece('free'), STONE_KINDS, STRIP_RULE_SET);
    expect(ruleNamesOf(resolved)).toEqual(['left-end', 'middle', 'right-end']);
  });

  it('bonded: the same strip against neighbouring floor has no seam', () => {
    const resolved = resolveTerrainPiece(
      piece('bonded', 3), STONE_KINDS, STRIP_RULE_SET, CONTINUOUS_FIELD,
    );
    expect(ruleNamesOf(resolved)).toEqual(['middle', 'middle', 'middle']);
  });

  it('proves the claim: neither path modified prepareTerrainArtRuleGrid', () => {
    // Free resolution is byte-identical to calling the stock preparer on the
    // piece grid — the prototype adds no resolution logic of its own.
    const viaPiece = resolveTerrainPiece(piece('free'), STONE_KINDS, STRIP_RULE_SET);
    const viaStock = prepareTerrainArtRuleGrid(STRIP, STONE_KINDS, STRIP_RULE_SET);
    expect(viaPiece.tiles).toEqual(viaStock.tiles);
  });
});

describe('resolveTerrainPiece — coordinates', () => {
  it('re-bases a bonded window to piece-local col/row', () => {
    const resolved = resolveTerrainPiece(
      piece('bonded', 3), STONE_KINDS, STRIP_RULE_SET, CONTINUOUS_FIELD,
    );
    // Origin col is 3, but the piece must report 0,1,2 — the bake draws at
    // `col * tileSize` and would otherwise leave 48px of blank space.
    expect(resolved.tiles.map((t) => t.col)).toEqual([0, 1, 2]);
    expect(resolved.cols).toBe(3);
    expect(resolved.tileSize).toBe(TILE);
  });

  it('caps a bonded piece at the field edge — a pit with no floor beside it', () => {
    // Origin 0: nothing to the west, floor to the east.
    const resolved = resolveTerrainPiece(
      piece('bonded', 0), STONE_KINDS, STRIP_RULE_SET, CONTINUOUS_FIELD,
    );
    expect(ruleNamesOf(resolved)).toEqual(['left-end', 'middle', 'middle']);
  });
});

describe('resolveTerrainPiece — ownership', () => {
  it('draws nothing for cells the piece does not own', () => {
    // An L-shaped 3×2 piece: top row solid, bottom row only its left cell.
    const lShaped: TerrainPiece = {
      id: 'l-shaped',
      cells: grid([1, 1, 1, 1, 0, 0], 3, 2),
      originCol: 3,
      originRow: 0,
      bondPolicy: 'bonded',
    };
    const field = grid([
      1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1, 1,
    ], 9, 2);
    const names = ruleNamesOf(resolveTerrainPiece(lShaped, STONE_KINDS, STRIP_RULE_SET, field));
    // Unowned cells resolve to 'none' even though the field is solid there —
    // otherwise the piece drags its neighbours' tiles along when it moves.
    expect(names.slice(3)).toEqual(['middle', 'none', 'none']);
  });
});

describe('resolveTerrainPiece — degradation', () => {
  it('falls back to free when a bonded piece has no field', () => {
    const resolved = resolveTerrainPiece(piece('bonded'), STONE_KINDS, STRIP_RULE_SET);
    expect(ruleNamesOf(resolved)).toEqual(['left-end', 'middle', 'right-end']);
  });

  it('falls back to free when the field is unusable', () => {
    const resolved = resolveTerrainPiece(
      piece('bonded'), STONE_KINDS, STRIP_RULE_SET, grid([], 0, 0),
    );
    expect(ruleNamesOf(resolved)).toEqual(['left-end', 'middle', 'right-end']);
  });

  it('never throws on malformed pieces', () => {
    for (const bad of [null, undefined, {}, { cells: null }, { cells: grid([], 0, 0) }]) {
      expect(resolveTerrainPiece(bad as never, STONE_KINDS, STRIP_RULE_SET).cols).toBe(0);
    }
  });

  it('is deterministic — same input, identical output', () => {
    const a = resolveTerrainPiece(piece('bonded', 3), STONE_KINDS, STRIP_RULE_SET, CONTINUOUS_FIELD);
    const b = resolveTerrainPiece(piece('bonded', 3), STONE_KINDS, STRIP_RULE_SET, CONTINUOUS_FIELD);
    expect(a.tiles).toEqual(b.tiles);
  });
});

describe('resolveTerrainPieceFromPrepared — the production shape', () => {
  it('matches resolveTerrainPiece while preparing the field once', () => {
    const preparedField = prepareTerrainArtRuleGrid(CONTINUOUS_FIELD, STONE_KINDS, STRIP_RULE_SET);
    const shared = resolveTerrainPieceFromPrepared(piece('bonded', 3), preparedField);
    const perPiece = resolveTerrainPiece(piece('bonded', 3), STONE_KINDS, STRIP_RULE_SET, CONTINUOUS_FIELD);
    expect(shared.tiles).toEqual(perPiece.tiles);
  });

  it('serves the splitHorizontal pair from one prepared field', () => {
    // The real DEVIL case: one field, two free halves that must cap their
    // newly-exposed inner ends.
    const left: TerrainPiece = { id: 'left', cells: grid([1, 1], 2, 1), originCol: 0, originRow: 0, bondPolicy: 'free' };
    const right: TerrainPiece = { id: 'right', cells: grid([1, 1], 2, 1), originCol: 2, originRow: 0, bondPolicy: 'free' };
    expect(ruleNamesOf(resolveTerrainPiece(left, STONE_KINDS, STRIP_RULE_SET))).toEqual(['left-end', 'right-end']);
    expect(ruleNamesOf(resolveTerrainPiece(right, STONE_KINDS, STRIP_RULE_SET))).toEqual(['left-end', 'right-end']);
  });
});
