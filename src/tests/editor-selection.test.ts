import { describe, it, expect } from 'vitest';
import {
  select,
  selectMany,
  selectInRect,
  clearSelection,
  selectAll,
  isInSelection,
  applyOp,
  createEditorState,
} from '../editor';
import type { EditorState } from '../editor/types';
import type { LevelData } from '../level/types';

function baseLevel(): LevelData {
  return {
    version: 1,
    id: 'test-level',
    name: 'Test',
    width: 160,
    height: 160,
    tileSize: 16,
    spawn: { x: 16, y: 16 },
    tiles: { data: new Array(100).fill(0), cols: 10, rows: 10, tileSize: 16 },
    entities: [
      {
        id: 1,
        kind: 'spawn',
        rect: { x: 16, y: 16, width: 16, height: 16 },
        props: {},
      },
      {
        id: 2,
        kind: 'exit',
        rect: { x: 128, y: 128, width: 16, height: 16 },
        props: { isTrap: false, locked: false },
      },
    ],
    nextEntityId: 3,
  };
}

function ids(state: EditorState): number[] {
  return [...state.selection.ids].sort((a, b) => a - b);
}

describe('select — replace mode', () => {
  it('replaces the existing selection', () => {
    const state = createEditorState(baseLevel());
    const next = select(state, 1, 'replace');
    expect(ids(next)).toEqual([1]);
    const next2 = select(next, 2, 'replace');
    expect(ids(next2)).toEqual([2]);
  });
});

describe('select — add mode', () => {
  it('unions the new id with the existing selection', () => {
    const state = createEditorState(baseLevel());
    const a = select(state, 1, 'replace');
    const b = select(a, 2, 'add');
    expect(ids(b)).toEqual([1, 2]);
  });

  it('is idempotent (adding an already-selected id is a no-op set)', () => {
    const state = createEditorState(baseLevel());
    const a = select(state, 1, 'replace');
    const b = select(a, 1, 'add');
    expect(ids(b)).toEqual([1]);
  });
});

describe('select — subtract mode', () => {
  it('removes the id from the selection', () => {
    const state = createEditorState(baseLevel());
    const a = selectMany(state, [1, 2], 'replace');
    const b = select(a, 1, 'subtract');
    expect(ids(b)).toEqual([2]);
  });

  it('is a no-op if the id was not selected', () => {
    const state = createEditorState(baseLevel());
    const a = select(state, 1, 'replace');
    const b = select(a, 999, 'subtract');
    expect(ids(b)).toEqual([1]);
  });
});

describe('select — toggle mode', () => {
  it('flips selection membership (symmetric difference)', () => {
    const state = createEditorState(baseLevel());
    const a = select(state, 1, 'replace');
    const toggledOn = select(a, 2, 'toggle');
    expect(ids(toggledOn)).toEqual([1, 2]);
    const toggledOff = select(toggledOn, 1, 'toggle');
    expect(ids(toggledOff)).toEqual([2]);
  });
});

describe('selectMany', () => {
  it('applies the mode to a batch of ids', () => {
    const state = createEditorState(baseLevel());
    const a = selectMany(state, [1, 2], 'replace');
    expect(ids(a)).toEqual([1, 2]);
    const b = selectMany(a, [3, 4], 'add');
    expect(ids(b)).toEqual([1, 2, 3, 4]);
  });
});

describe('selectInRect', () => {
  it('selects entities whose rect overlaps the query rect', () => {
    const state = createEditorState(baseLevel());
    // Query a rect that overlaps spawn (16,16) but not exit (128,128)
    const next = selectInRect(
      state,
      { x: 0, y: 0, width: 100, height: 100 },
      'replace',
    );
    expect(ids(next)).toEqual([1]);
  });

  it('in add mode unions with existing selection', () => {
    const state = createEditorState(baseLevel());
    const a = select(state, 1, 'replace');
    const b = selectInRect(
      a,
      { x: 100, y: 100, width: 60, height: 60 },
      'add',
    );
    expect(ids(b)).toEqual([1, 2]);
  });

  it('touches-edges overlap is inclusive', () => {
    const state = createEditorState(baseLevel());
    // A rect that ends exactly where spawn begins (16,16)
    const next = selectInRect(
      state,
      { x: 0, y: 0, width: 16, height: 16 },
      'replace',
    );
    expect(ids(next)).toEqual([1]);
  });
});

describe('clearSelection', () => {
  it('empties the selection', () => {
    const state = createEditorState(baseLevel());
    const a = selectMany(state, [1, 2], 'replace');
    const cleared = clearSelection(a);
    expect(ids(cleared)).toEqual([]);
  });

  it('is a no-op when selection is already empty', () => {
    const state = createEditorState(baseLevel());
    expect(clearSelection(state)).toBe(state);
  });
});

describe('selectAll', () => {
  it('selects every entity id', () => {
    const state = createEditorState(baseLevel());
    const all = selectAll(state);
    expect(ids(all)).toEqual([1, 2]);
  });
});

describe('isInSelection', () => {
  it('returns true iff the id is in the selection', () => {
    const state = createEditorState(baseLevel());
    const selected = select(state, 1, 'replace');
    expect(isInSelection(selected, 1)).toBe(true);
    expect(isInSelection(selected, 2)).toBe(false);
  });
});

describe('selection is NOT recorded in history', () => {
  it('select does not push to undoStack', () => {
    const state = createEditorState(baseLevel());
    const before = state.undoStack.length;
    const next = select(state, 1, 'replace');
    expect(next.undoStack.length).toBe(before);
  });

  it('clearSelection does not push to undoStack', () => {
    const state = createEditorState(baseLevel());
    const selected = select(state, 1, 'replace');
    const before = selected.undoStack.length;
    const cleared = clearSelection(selected);
    expect(cleared.undoStack.length).toBe(before);
  });

  it('select survives an unrelated applyOp round-trip', () => {
    const state = createEditorState(baseLevel());
    const selected = select(state, 1, 'replace');
    const next = applyOp(selected, {
      type: 'moveEntities',
      ids: [2],
      dx: 4,
      dy: 0,
    });
    // Selection is preserved across the op
    expect([...next.selection.ids]).toEqual([1]);
  });
});

describe('selection purity', () => {
  it('select returns a new state object (not the input reference)', () => {
    const state = createEditorState(baseLevel());
    expect(select(state, 1, 'replace')).not.toBe(state);
  });

  it('select returns a new Set instance', () => {
    const state = createEditorState(baseLevel());
    const a = select(state, 1, 'replace');
    const b = select(a, 2, 'add');
    expect(b.selection.ids).not.toBe(a.selection.ids);
  });

  it('the input state.selection Set is never mutated', () => {
    const state = createEditorState(baseLevel());
    const a = select(state, 1, 'replace');
    const snapshotIds = new Set(a.selection.ids);
    select(a, 2, 'add');
    expect(a.selection.ids).toEqual(snapshotIds);
  });
});
