import { describe, it, expect } from 'vitest';
import {
  applyOp,
  undo,
  redo,
  canUndo,
  canRedo,
  beginTransaction,
  commitTransaction,
  clearHistory,
  createEditorState,
} from '../editor';
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

const addPlatform = {
  type: 'addEntity' as const,
  kind: 'platform' as const,
  rect: { x: 0, y: 0, width: 32, height: 16 },
  props: {},
};

describe('undo / redo round-trip', () => {
  it('undo restores the pre-snapshot exactly', () => {
    const initial = createEditorState(baseLevel());
    const next = applyOp(initial, addPlatform);
    const undone = undo(next);
    expect(undone.level).toEqual(initial.level);
  });

  it('redo restores the post-snapshot exactly', () => {
    const initial = createEditorState(baseLevel());
    const next = applyOp(initial, addPlatform);
    const undone = undo(next);
    const redone = redo(undone);
    expect(redone.level).toEqual(next.level);
  });

  it('undo on an empty stack is a no-op', () => {
    const state = createEditorState(baseLevel());
    expect(undo(state)).toBe(state);
  });

  it('redo on an empty stack is a no-op', () => {
    const state = createEditorState(baseLevel());
    expect(redo(state)).toBe(state);
  });
});

describe('canUndo / canRedo', () => {
  it('canUndo is false initially, true after one op', () => {
    const initial = createEditorState(baseLevel());
    expect(canUndo(initial)).toBe(false);
    const next = applyOp(initial, addPlatform);
    expect(canUndo(next)).toBe(true);
  });

  it('canRedo is false after a fresh op, true after undo', () => {
    const initial = createEditorState(baseLevel());
    const next = applyOp(initial, addPlatform);
    expect(canRedo(next)).toBe(false);
    const undone = undo(next);
    expect(canRedo(undone)).toBe(true);
  });

  it('undo then redo leaves canRedo false', () => {
    const initial = createEditorState(baseLevel());
    const next = applyOp(initial, addPlatform);
    const undone = undo(next);
    const redone = redo(undone);
    expect(canRedo(redone)).toBe(false);
  });
});

describe('redo stack cleared by new op', () => {
  it('after undo, a new op empties the redo stack', () => {
    const initial = createEditorState(baseLevel());
    const next = applyOp(initial, addPlatform);
    const undone = undo(next);
    expect(undone.redoStack.length).toBe(1);
    const branched = applyOp(undone, {
      type: 'addEntity',
      kind: 'trap',
      rect: { x: 0, y: 0, width: 16, height: 16 },
      props: { type: 'spikes', params: {} },
    });
    expect(branched.redoStack.length).toBe(0);
  });
});

describe('transactions', () => {
  it('beginTransaction + N ops + commit produces exactly 1 history entry', () => {
    const initial = createEditorState(baseLevel());
    let state = beginTransaction(initial);
    state = applyOp(state, addPlatform);
    state = applyOp(state, addPlatform);
    state = applyOp(state, {
      type: 'moveEntities',
      ids: [1],
      dx: 8,
      dy: 0,
    });
    expect(state.undoStack.length).toBe(0);
    state = commitTransaction(state, 'Multi-step edit');
    expect(state.undoStack.length).toBe(1);
    expect(state.undoStack[0].label).toBe('Multi-step edit');
    expect(state.undoStack[0].op.type).toBe('batch');
    expect(state.pendingTransaction).toBeNull();
  });

  it('undo on a committed transaction restores the pre-transaction level', () => {
    const initial = createEditorState(baseLevel());
    let state = beginTransaction(initial);
    state = applyOp(state, addPlatform);
    state = applyOp(state, addPlatform);
    state = commitTransaction(state, 'T');
    const undone = undo(state);
    expect(undone.level).toEqual(initial.level);
  });

  it('commitTransaction without beginTransaction throws', () => {
    const initial = createEditorState(baseLevel());
    expect(() => commitTransaction(initial, 'X')).toThrow();
  });

  it('beginTransaction twice throws', () => {
    const initial = createEditorState(baseLevel());
    const inTx = beginTransaction(initial);
    expect(() => beginTransaction(inTx)).toThrow();
  });

  it('commitTransaction with no pending ops is a no-op on history', () => {
    const initial = createEditorState(baseLevel());
    let state = beginTransaction(initial);
    state = commitTransaction(state, 'empty');
    expect(state.undoStack.length).toBe(0);
    expect(state.pendingTransaction).toBeNull();
  });
});

describe('maxHistoryDepth enforcement', () => {
  it('evicts the oldest entry when depth exceeds max', () => {
    const initial = createEditorState(baseLevel(), { maxHistoryDepth: 3 });
    let state = initial;
    for (let i = 0; i < 5; i++) {
      state = applyOp(state, {
        type: 'addEntity',
        kind: 'platform',
        rect: { x: i * 16, y: 0, width: 16, height: 16 },
        props: {},
      });
    }
    expect(state.undoStack.length).toBe(3);
    // Oldest two entries evicted; the remaining three are the most recent
    expect(canUndo(state)).toBe(true);
  });
});

describe('clearHistory', () => {
  it('empties both stacks', () => {
    const initial = createEditorState(baseLevel());
    const next = applyOp(initial, addPlatform);
    const undone = undo(next);
    expect(undone.undoStack.length).toBe(0);
    expect(undone.redoStack.length).toBe(1);
    const cleared = clearHistory(undone);
    expect(cleared.undoStack.length).toBe(0);
    expect(cleared.redoStack.length).toBe(0);
  });

  it('is a no-op when both stacks are already empty', () => {
    const state = createEditorState(baseLevel());
    expect(clearHistory(state)).toBe(state);
  });

  it('preserves the current level', () => {
    const initial = createEditorState(baseLevel());
    const next = applyOp(initial, addPlatform);
    const cleared = clearHistory(next);
    expect(cleared.level).toEqual(next.level);
  });
});

describe('undo clears stale selection', () => {
  it('prunes selection ids that no longer exist after an undo', () => {
    const initial = createEditorState(baseLevel());
    // Add an entity, then select it
    const withEntity = applyOp(initial, addPlatform);
    const newId = withEntity.level.entities[withEntity.level.entities.length - 1].id;
    const selected = {
      ...withEntity,
      selection: { ids: new Set([newId]) },
    };
    const undone = undo(selected);
    expect(undone.selection.ids.has(newId)).toBe(false);
  });
});
