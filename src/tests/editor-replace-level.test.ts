/**
 * Tests for the `replaceLevel` editor operation (Phase 1 §5.2).
 *
 * Covers:
 *  - Full replacement of all top-level fields
 *  - Validation of the replacement level (invalid levels are no-ops)
 *  - Defensive cloning (no shared references)
 *  - History entry with the supplied label
 *  - Undo/redo round-trip
 *  - Deep-equals invariant: applyOp(createEditorState(base), generated.editorOp).level
 *    deep-equals generated.level, independently of base
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import { applyOp, createEditorState, undo, redo } from '../editor';
import type { LevelData } from '../level/types';
import { validateLevel } from '../level';

/** A simple valid base level (60×40, 16px tiles, spawn + exit). */
function baseLevel(): LevelData {
  return {
    version: 1,
    id: 'base-level',
    name: 'Base Level',
    width: 960,
    height: 640,
    tileSize: 16,
    spawn: { x: 32, y: 32 },
    tiles: { data: new Array(60 * 40).fill(0), cols: 60, rows: 40, tileSize: 16 },
    entities: [
      { id: 1, kind: 'spawn', rect: { x: 32, y: 32, width: 16, height: 16 }, props: {} },
      { id: 2, kind: 'exit', rect: { x: 900, y: 32, width: 16, height: 16 }, props: { isTrap: false, locked: false } },
    ],
    nextEntityId: 3,
  };
}

/** A replacement level with different dimensions, tiles, and entities. */
function replacementLevel(): LevelData {
  const cols = 20;
  const rows = 15;
  const tilesData: number[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      tilesData.push(y === rows - 1 ? 1 : 0);
    }
  }
  return {
    version: 1,
    id: 'replacement-level',
    name: 'Replacement Level',
    width: 320,
    height: 240,
    tileSize: 16,
    spawn: { x: 16, y: 208 },
    tiles: { data: tilesData, cols, rows, tileSize: 16 },
    entities: [
      { id: 10, kind: 'spawn', rect: { x: 16, y: 208, width: 16, height: 16 }, props: {} },
      { id: 11, kind: 'exit', rect: { x: 288, y: 208, width: 16, height: 16 }, props: { isTrap: false, locked: false } },
      { id: 12, kind: 'platform', rect: { x: 128, y: 128, width: 64, height: 16 }, props: {} },
    ],
    nextEntityId: 20,
    bottomLava: { surfaceY: 240 },
    hints: ['Watch out!', 'Jump carefully.'],
    flags: { lookahead: true },
  };
}

/** Snapshots a level for comparison. */
function cloneLevel(level: LevelData): LevelData {
  return JSON.parse(JSON.stringify(level)) as LevelData;
}

describe('applyOp — replaceLevel', () => {
  it('replaces all top-level fields with the new level', () => {
    const state = createEditorState(baseLevel());
    const replacement = replacementLevel();
    const next = applyOp(state, {
      type: 'replaceLevel',
      level: replacement,
      label: 'Replace with generated level',
    });

    // Must be a different object (defensive clone)
    expect(next.level).not.toBe(state.level);
    expect(next.level).not.toBe(replacement);

    // Top-level fields
    expect(next.level.version).toBe(replacement.version);
    expect(next.level.id).toBe(replacement.id);
    expect(next.level.name).toBe(replacement.name);
    expect(next.level.width).toBe(replacement.width);
    expect(next.level.height).toBe(replacement.height);
    expect(next.level.tileSize).toBe(replacement.tileSize);
    expect(next.level.spawn).toEqual(replacement.spawn);
    expect(next.level.nextEntityId).toBe(replacement.nextEntityId);

    // Optional fields
    expect(next.level.bottomLava).toEqual(replacement.bottomLava);
    expect(next.level.hints).toEqual(replacement.hints);
    expect(next.level.flags).toEqual(replacement.flags);

    // Entities (deep equality)
    expect(next.level.entities.length).toBe(replacement.entities.length);
    expect(next.level.entities).toEqual(replacement.entities);

    // Tiles
    expect(next.level.tiles.cols).toBe(replacement.tiles.cols);
    expect(next.level.tiles.rows).toBe(replacement.tiles.rows);
    expect(next.level.tiles.data).toEqual(replacement.tiles.data);
  });

  it('deep-equals invariant: applyOp(createEditorState(base), op).level deep-equals replacement level', () => {
    const replacement = replacementLevel();
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'replaceLevel',
      level: replacement,
      label: 'replace',
    });
    expect(next.level).toEqual(replacement);
  });

  it('records a history entry with the supplied label', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'replaceLevel',
      level: replacementLevel(),
      label: 'Replace with generated level',
    });
    expect(next.undoStack.length).toBe(1);
    expect(next.undoStack[0].label).toBe('Replace with generated level');
    expect(next.undoStack[0].op.type).toBe('replaceLevel');
  });

  it('pre-snapshot captures the original level', () => {
    const original = baseLevel();
    const state = createEditorState(original);
    const next = applyOp(state, {
      type: 'replaceLevel',
      level: replacementLevel(),
      label: 'replace',
    });
    expect(next.undoStack[0].preSnapshot).toEqual(original);
  });

  it('post-snapshot captures the replacement level', () => {
    const replacement = replacementLevel();
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'replaceLevel',
      level: replacement,
      label: 'replace',
    });
    expect(next.undoStack[0].postSnapshot).toEqual(replacement);
  });

  it('undo restores the original level', () => {
    const original = baseLevel();
    const state = createEditorState(original);
    const afterReplace = applyOp(state, {
      type: 'replaceLevel',
      level: replacementLevel(),
      label: 'replace',
    });
    const afterUndo = undo(afterReplace);
    expect(afterUndo.level).toEqual(original);
  });

  it('redo restores the replacement level', () => {
    const replacement = replacementLevel();
    const state = createEditorState(baseLevel());
    const afterReplace = applyOp(state, { type: 'replaceLevel', level: replacement, label: 'replace' });
    const afterUndo = undo(afterReplace);
    const afterRedo = redo(afterUndo);
    expect(afterRedo.level).toEqual(replacement);
  });

  it('undo then redo is idempotent (level deep-equals replacement)', () => {
    const replacement = replacementLevel();
    const state = createEditorState(baseLevel());
    const afterReplace = applyOp(state, { type: 'replaceLevel', level: replacement, label: 'replace' });
    const afterUndo = undo(afterReplace);
    const afterRedo = redo(afterUndo);
    // Same as applyOp directly
    expect(afterRedo.level).toEqual(afterReplace.level);
  });

  it('clears the redo stack (as all non-no-op ops do)', () => {
    let state = createEditorState(baseLevel());
    // Add a redo entry by performing an op then undoing
    state = applyOp(state, { type: 'addEntity', kind: 'platform', rect: { x: 0, y: 0, width: 16, height: 16 }, props: {} });
    state = undo(state);
    expect(state.redoStack.length).toBe(1);
    // Now replaceLevel should clear the redo stack
    state = applyOp(state, {
      type: 'replaceLevel',
      level: replacementLevel(),
      label: 'replace',
    });
    expect(state.redoStack.length).toBe(0);
  });

  it('recomputes the validation cache', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'replaceLevel',
      level: replacementLevel(),
      label: 'replace',
    });
    expect(next.validation).not.toBe(state.validation);
    expect(next.validation.valid).toBe(true);
  });

  it('is a no-op (state unchanged) when the replacement level is invalid', () => {
    const state = createEditorState(baseLevel());
    const invalidLevel = {
      version: 1,
      id: 'bad',
      name: 'Bad',
      width: 100,
      height: 100,
      tileSize: 16,
      spawn: { x: 10, y: 10 },
      tiles: { data: [], cols: 10, rows: 10, tileSize: 16 },
      entities: [],
      nextEntityId: 1,
    } as LevelData;
    // Validate it: should be invalid (missing spawn and exit)
    expect(validateLevel(invalidLevel).valid).toBe(false);

    const next = applyOp(state, {
      type: 'replaceLevel',
      level: invalidLevel,
      label: 'replace',
    });
    // Must be the same state object (no change)
    expect(next).toBe(state);
  });

  it('defensively clones the level (no shared references)', () => {
    const replacement = replacementLevel();
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'replaceLevel',
      level: replacement,
      label: 'replace',
    });
    // Mutate the original replacement object
    const hacked = replacement as unknown as Record<string, unknown>;
    hacked.id = 'hacked';
    expect(next.level.id).toBe('replacement-level');
  });

  it('preserves the purity contract (input state not mutated)', () => {
    const original = baseLevel();
    const state = createEditorState(original);
    const before = cloneLevel(state.level);
    applyOp(state, {
      type: 'replaceLevel',
      level: replacementLevel(),
      label: 'replace',
    });
    // Input level unchanged
    expect(state.level).toEqual(before);
  });

  it('optional fields on replacement are absent when not present on replacement level', () => {
    // A replacement without optional fields should leave them absent/undefined
    const minimal = baseLevel();
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'replaceLevel',
      level: minimal,
      label: 'replace',
    });
    expect(next.level.bottomLava).toBeUndefined();
    expect(next.level.hints).toBeUndefined();
    expect(next.level.flags).toBeUndefined();
  });

  it('handles replacement level with no entities (invalid but defensive)', () => {
    // Even though replaceLevel validates, we verify it doesn't crash
    const state = createEditorState(baseLevel());
    const noEntityLevel = { ...baseLevel(), entities: [] };
    // This level is invalid (no spawn, no exit)
    const next = applyOp(state, {
      type: 'replaceLevel',
      level: noEntityLevel,
      label: 'replace',
    });
    // Should be no-op because validation fails
    expect(next).toBe(state);
  });

  it('invariant holds independently of base level', () => {
    // Test with two different base levels
    const replacement = replacementLevel();

    const base1 = baseLevel();
    const state1 = createEditorState(base1);
    const result1 = applyOp(state1, { type: 'replaceLevel', level: replacement, label: 'replace' });
    expect(result1.level).toEqual(replacement);

    // Different base
    const base2: LevelData = {
      ...baseLevel(),
      id: 'completely-different-base',
      name: 'Different',
      width: 800,
      height: 600,
      spawn: { x: 100, y: 100 },
      tiles: { data: new Array(50 * 37).fill(5), cols: 50, rows: 37, tileSize: 16 },
      entities: [
        { id: 1, kind: 'spawn', rect: { x: 100, y: 100, width: 16, height: 16 }, props: {} },
        { id: 2, kind: 'exit', rect: { x: 700, y: 100, width: 16, height: 16 }, props: { isTrap: false, locked: false } },
        { id: 3, kind: 'platform', rect: { x: 200, y: 300, width: 100, height: 16 }, props: {} },
      ],
      nextEntityId: 4,
    };
    const state2 = createEditorState(base2);
    const result2 = applyOp(state2, { type: 'replaceLevel', level: replacement, label: 'replace' });
    expect(result2.level).toEqual(replacement);
  });
});
