import { describe, it, expect } from 'vitest';
import {
  copySelection,
  pasteClipboard,
  select,
  applyOp,
  createEditorState,
} from '../editor';
import type { LevelData } from '../level/types';

function baseLevel(): LevelData {
  return {
    version: 1,
    id: 'test-level',
    name: 'Test',
    width: 320,
    height: 320,
    tileSize: 16,
    spawn: { x: 16, y: 16 },
    tiles: { data: new Array(400).fill(0), cols: 20, rows: 20, tileSize: 16 },
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

describe('copySelection', () => {
  it('returns a ClipboardEntry with the selected entities', () => {
    const state = createEditorState(baseLevel());
    const selected = select(state, 1, 'replace');
    const entry = copySelection(selected);
    expect(entry).not.toBeNull();
    if (!entry) return;
    expect(entry.entities.length).toBe(1);
    expect(entry.entities[0].id).toBe(1);
  });

  it('returns null when selection is empty', () => {
    const state = createEditorState(baseLevel());
    expect(copySelection(state)).toBeNull();
  });

  it('returns deep clones — mutating the entry does not affect the level', () => {
    const state = createEditorState(baseLevel());
    const selected = select(state, 1, 'replace');
    const entry = copySelection(selected);
    if (!entry) throw new Error('expected entry');
    const hacked = entry.entities[0] as {
      rect: { x: number; y: number; width: number; height: number };
    };
    hacked.rect = { x: 999, y: 999, width: 999, height: 999 };
    expect(state.level.entities[0].rect).toEqual({
      x: 16,
      y: 16,
      width: 16,
      height: 16,
    });
  });
});

describe('pasteClipboard', () => {
  it('pastes entities at the given offset, allocating new stable IDs', () => {
    const state = createEditorState(baseLevel());
    const selected = select(state, 1, 'replace');
    const entry = copySelection(selected);
    if (!entry) throw new Error('expected entry');
    const pasted = pasteClipboard(state, entry, { x: 200, y: 200 });
    expect(pasted.level.entities.length).toBe(3);
    const newEntity = pasted.level.entities[2];
    expect(newEntity.id).toBeGreaterThanOrEqual(3);
    expect(newEntity.rect.x).toBe(200);
    expect(newEntity.rect.y).toBe(200);
    expect(newEntity.kind).toBe('spawn');
  });

  it('pushes exactly one history entry (a batch) to the undo stack', () => {
    const state = createEditorState(baseLevel());
    const selected = select(state, 1, 'replace');
    const entry = copySelection(selected);
    if (!entry) throw new Error('expected entry');
    const pasted = pasteClipboard(state, entry, { x: 200, y: 200 });
    expect(pasted.undoStack.length).toBe(1);
    expect(pasted.undoStack[0].op.type).toBe('batch');
  });

  it('is a no-op when clipboard is empty', () => {
    const state = createEditorState(baseLevel());
    const pasted = pasteClipboard(state, { entities: [] }, { x: 0, y: 0 });
    expect(pasted).toBe(state);
  });

  it('preserves multi-entity relative offsets', () => {
    let state = createEditorState(baseLevel());
    state = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 0, y: 16, width: 32, height: 16 },
      props: {},
    });
    state = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 32, y: 16, width: 32, height: 16 },
      props: {},
    });
    const platformIds = state.level.entities
      .filter((e) => e.kind === 'platform')
      .map((e) => e.id);
    state = {
      ...state,
      selection: { ids: new Set(platformIds) },
    };
    const entry = copySelection(state);
    if (!entry) throw new Error('expected entry');
    const pasted = pasteClipboard(state, entry, { x: 100, y: 100 });
    const newPlatforms = pasted.level.entities.filter(
      (e) => e.kind === 'platform' && !platformIds.includes(e.id),
    );
    expect(newPlatforms.length).toBe(2);
    // Bounding box top-left was (0, 16); pasted at (100, 100)
    // First platform rect: x=0,y=16 -> 100, 100
    // Second platform rect: x=32,y=16 -> 132, 100
    const sorted = newPlatforms
      .slice()
      .sort((a, b) => a.rect.x - b.rect.x);
    expect(sorted[0].rect.x).toBe(100);
    expect(sorted[0].rect.y).toBe(100);
    expect(sorted[1].rect.x).toBe(132);
    expect(sorted[1].rect.y).toBe(100);
  });

  it('does not mutate the input state', () => {
    const state = createEditorState(baseLevel());
    const selected = select(state, 1, 'replace');
    const entry = copySelection(selected);
    if (!entry) throw new Error('expected entry');
    const beforeLevel = JSON.parse(JSON.stringify(state.level));
    const beforeUndo = state.undoStack.length;
    pasteClipboard(state, entry, { x: 200, y: 200 });
    expect(state.level).toEqual(beforeLevel);
    expect(state.undoStack.length).toBe(beforeUndo);
  });
});
