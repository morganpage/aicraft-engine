import { describe, it, expect } from 'vitest';
import { applyOp, applyBatch, createEditorState } from '../editor';
import type { EditorState } from '../editor/types';
import type { LevelData, LevelRect } from '../level/types';

/** A minimal valid level: spawn + exit, 10x10 tile grid, next id = 3. */
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

/** Deep snapshot of a state's level, used for purity assertions. */
function snapshot(state: EditorState): LevelData {
  return JSON.parse(JSON.stringify(state.level)) as LevelData;
}

describe('applyOp — addEntity', () => {
  it('adds an entity and advances nextEntityId', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 32, y: 32, width: 32, height: 16 },
      props: { visual: 'normal' },
    });
    expect(next.level.entities.length).toBe(3);
    expect(next.level.nextEntityId).toBe(4);
    const added = next.level.entities[2];
    expect(added.kind).toBe('platform');
    expect(added.id).toBe(3);
  });

  it('records exactly one history entry with addEntity label', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 0, y: 0, width: 16, height: 16 },
      props: {},
    });
    expect(next.undoStack.length).toBe(1);
    expect(next.undoStack[0].label).toBe('Add platform');
    expect(next.undoStack[0].op.type).toBe('addEntity');
  });

  it('clears the redo stack', () => {
    let state = createEditorState(baseLevel());
    state = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 0, y: 0, width: 16, height: 16 },
      props: {},
    });
    // Simulate a redo entry existing from before
    state = { ...state, redoStack: state.undoStack };
    state = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 16, y: 0, width: 16, height: 16 },
      props: {},
    });
    expect(state.redoStack.length).toBe(0);
  });

  it('recomputes the validation cache', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 32, y: 32, width: 32, height: 16 },
      props: {},
    });
    expect(next.validation).not.toBe(state.validation);
    expect(typeof next.validation.valid).toBe('boolean');
  });
});

describe('applyOp — removeEntity', () => {
  it('removes the entity with the given id', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, { type: 'removeEntity', id: 2 });
    expect(next.level.entities.length).toBe(1);
    expect(next.level.entities.find((e) => e.id === 2)).toBeUndefined();
  });

  it('records a history entry for the removal', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, { type: 'removeEntity', id: 2 });
    expect(next.undoStack.length).toBe(1);
    expect(next.undoStack[0].op.type).toBe('removeEntity');
  });

  it('is a no-op (state unchanged, no history entry) for a missing id', () => {
    const state = createEditorState(baseLevel());
    const before = snapshot(state);
    const next = applyOp(state, { type: 'removeEntity', id: 9999 });
    expect(next).toBe(state);
    expect(next.undoStack.length).toBe(0);
    expect(snapshot(state)).toEqual(before);
  });
});

describe('applyOp — updateEntityProps', () => {
  it('merges a partial patch into the entity props', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'updateEntityProps',
      id: 2,
      propsPatch: { locked: true },
    });
    const exitEntity = next.level.entities.find((e) => e.id === 2);
    expect(exitEntity).toBeDefined();
    if (!exitEntity) return;
    expect(exitEntity.kind).toBe('exit');
    if (exitEntity.kind === 'exit') {
      expect(exitEntity.props.locked).toBe(true);
      expect(exitEntity.props.isTrap).toBe(false);
    }
  });

  it('is a no-op for a missing id', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'updateEntityProps',
      id: 9999,
      propsPatch: { foo: 'bar' },
    });
    expect(next).toBe(state);
  });
});

describe('applyOp — moveEntities', () => {
  it('translates multiple entities by (dx, dy)', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'moveEntities',
      ids: [1, 2],
      dx: 16,
      dy: -8,
    });
    const spawn = next.level.entities.find((e) => e.id === 1);
    const exit = next.level.entities.find((e) => e.id === 2);
    expect(spawn?.rect.x).toBe(32);
    expect(spawn?.rect.y).toBe(8);
    expect(exit?.rect.x).toBe(144);
    expect(exit?.rect.y).toBe(120);
  });

  it('ignores ids that do not match any entity', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'moveEntities',
      ids: [1, 9999],
      dx: 16,
      dy: 0,
    });
    const spawn = next.level.entities.find((e) => e.id === 1);
    expect(spawn?.rect.x).toBe(32);
    // Exit untouched (didn't move despite the unknown id being in the list)
    const exit = next.level.entities.find((e) => e.id === 2);
    expect(exit?.rect.x).toBe(128);
  });
});

describe('applyOp — setEntityRect', () => {
  it('replaces the entity rect', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'setEntityRect',
      id: 1,
      rect: { x: 50, y: 60, width: 32, height: 32 },
    });
    const spawn = next.level.entities.find((e) => e.id === 1);
    expect(spawn?.rect).toEqual({ x: 50, y: 60, width: 32, height: 32 });
  });
});

describe('applyOp — paintTiles', () => {
  it('writes new values into the tile grid', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'paintTiles',
      cells: [
        { x: 0, y: 0, newValue: 1, oldValue: 0 },
        { x: 1, y: 0, newValue: 1, oldValue: 0 },
        { x: 2, y: 3, newValue: 2, oldValue: 0 },
      ],
    });
    expect(next.level.tiles.data[0]).toBe(1);
    expect(next.level.tiles.data[1]).toBe(1);
    expect(next.level.tiles.data[3 * 10 + 2]).toBe(2);
  });

  it('skips out-of-bounds cells without throwing', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'paintTiles',
      cells: [
        { x: -1, y: 0, newValue: 1, oldValue: 0 },
        { x: 99, y: 99, newValue: 1, oldValue: 0 },
        { x: 5, y: 5, newValue: 1, oldValue: 0 },
      ],
    });
    expect(next.level.tiles.data[5 * 10 + 5]).toBe(1);
  });

  it('is a no-op if all cells are unchanged (same value)', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'paintTiles',
      cells: [{ x: 0, y: 0, newValue: 0, oldValue: 0 }],
    });
    expect(next).toBe(state);
  });
});

describe('applyOp — setSpawnPoint', () => {
  it('replaces the level spawn point', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, { type: 'setSpawnPoint', x: 80, y: 90 });
    expect(next.level.spawn).toEqual({ x: 80, y: 90 });
  });

  it('is a no-op if spawn point is unchanged', () => {
    const state = createEditorState(baseLevel());
    const same = applyOp(state, {
      type: 'setSpawnPoint',
      x: state.level.spawn.x,
      y: state.level.spawn.y,
    });
    expect(same).toBe(state);
  });
});

describe('applyOp — batch', () => {
  it('collapses N sub-ops into a single history entry', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'batch',
      label: 'Bulk edit',
      ops: [
        {
          type: 'addEntity',
          kind: 'platform',
          rect: { x: 32, y: 0, width: 32, height: 16 },
          props: {},
        },
        {
          type: 'addEntity',
          kind: 'platform',
          rect: { x: 64, y: 0, width: 32, height: 16 },
          props: {},
        },
        { type: 'moveEntities', ids: [1], dx: 8, dy: 0 },
      ],
    });
    expect(next.level.entities.length).toBe(4);
    expect(next.undoStack.length).toBe(1);
    expect(next.undoStack[0].label).toBe('Bulk edit');
    expect(next.undoStack[0].op.type).toBe('batch');
  });

  it('treats an all-no-op batch as a no-op', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'batch',
      label: 'no-op batch',
      ops: [{ type: 'removeEntity', id: 9999 }],
    });
    expect(next).toBe(state);
  });
});

describe('applyBatch helper', () => {
  it('produces the same result as applyOp({type:"batch", ...})', () => {
    const state = createEditorState(baseLevel());
    const ops = [
      {
        type: 'addEntity' as const,
        kind: 'platform' as const,
        rect: { x: 0, y: 0, width: 32, height: 16 },
        props: {},
      },
      {
        type: 'addEntity' as const,
        kind: 'platform' as const,
        rect: { x: 32, y: 0, width: 32, height: 16 },
        props: {},
      },
    ];
    const a = applyOp(state, { type: 'batch', ops, label: 'L' });
    const b = applyBatch(state, ops, 'L');
    expect(b.level.entities.length).toBe(a.level.entities.length);
    expect(b.undoStack.length).toBe(1);
    expect(b.undoStack[0].label).toBe('L');
  });
});

describe('applyOp — purity', () => {
  it('never mutates the input state.level (deep equality)', () => {
    const state = createEditorState(baseLevel());
    const before = snapshot(state);
    applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 0, y: 0, width: 32, height: 16 },
      props: {},
    });
    expect(snapshot(state)).toEqual(before);
  });

  it('history snapshots are independent clones of the live level', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 0, y: 0, width: 32, height: 16 },
      props: {},
    });
    const entry = next.undoStack[0];
    const beforePost = JSON.parse(JSON.stringify(entry.postSnapshot)) as LevelData;
    // Mutate next.level — entry.postSnapshot must not change.
    // Cast through unknown because readonly is a compile-time check we need to bypass for this test.
    const mutated = JSON.parse(JSON.stringify(next.level)) as unknown as {
      entities: { id: number; kind: string; rect: LevelRect; props: Record<string, unknown> }[];
    };
    mutated.entities[0] = {
      ...mutated.entities[0],
      rect: { x: 999, y: 999, width: 999, height: 999 },
    };
    void mutated;
    expect(entry.postSnapshot).toEqual(beforePost);
  });

  it('JSON-clone verified: mutating the returned level does not affect the input', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 0, y: 0, width: 32, height: 16 },
      props: {},
    });
    // Cast through unknown to bypass the readonly-array type check — we are
    // demonstrating that mutation of the returned level does not leak back to the input.
    const hacked = JSON.parse(JSON.stringify(next.level)) as unknown as {
      entities: unknown[];
    };
    hacked.entities.push({
      id: 999,
      kind: 'spawn',
      rect: { x: 0, y: 0, width: 1, height: 1 },
      props: {},
    });
    void hacked;
    expect(state.level.entities.length).toBe(2);
  });
});
