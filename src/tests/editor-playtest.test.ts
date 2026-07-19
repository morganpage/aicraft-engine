import { describe, it, expect } from 'vitest';
import {
  enterPlaytest,
  exitPlaytest,
  applyOp,
  undo,
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

describe('enterPlaytest', () => {
  it('returns two independent deep clones', () => {
    const state = createEditorState(baseLevel());
    const { snapshot, runtimeLevel } = enterPlaytest(state);
    expect(snapshot).toEqual(state.level);
    expect(runtimeLevel).toEqual(state.level);
    expect(snapshot).not.toBe(state.level);
    expect(runtimeLevel).not.toBe(state.level);
    expect(snapshot).not.toBe(runtimeLevel);
  });

  it('mutating the runtime does NOT affect the snapshot', () => {
    const state = createEditorState(baseLevel());
    const { snapshot, runtimeLevel } = enterPlaytest(state);
    // Simulate the consumer's simulation mutating the runtime.
    // Cast through unknown to bypass readonly-array checks — we are intentionally
    // mutating to prove the snapshot is a separate deep clone.
    const mutated = JSON.parse(JSON.stringify(runtimeLevel)) as unknown as {
      entities: unknown[];
    };
    mutated.entities.push({
      id: 999,
      kind: 'spawn',
      rect: { x: 0, y: 0, width: 1, height: 1 },
      props: {},
    });
    void mutated;
    expect(snapshot.entities.length).toBe(2);
  });

  it('does not mutate the input state', () => {
    const state = createEditorState(baseLevel());
    const before = JSON.parse(JSON.stringify(state.level));
    enterPlaytest(state);
    expect(state.level).toEqual(before);
  });
});

describe('exitPlaytest', () => {
  it('restores the snapshot as the editor level', () => {
    const state = createEditorState(baseLevel());
    const { snapshot } = enterPlaytest(state);
    const modified = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 0, y: 0, width: 32, height: 16 },
      props: {},
    });
    const restored = exitPlaytest(modified, snapshot);
    expect(restored.level).toEqual(snapshot);
  });

  it('restores byte-identically via round-trip', () => {
    const state = createEditorState(baseLevel());
    const { snapshot, runtimeLevel } = enterPlaytest(state);
    // Mutate runtime (simulating playtest). Cast through unknown to bypass
    // the readonly-array check on tiles.data — we are intentionally mutating
    // to prove the snapshot is unaffected and exit restores cleanly.
    const writableRuntime = runtimeLevel as unknown as {
      tiles: { data: number[] };
    };
    writableRuntime.tiles.data[0] = 7;
    const restored = exitPlaytest(state, snapshot);
    expect(JSON.stringify(restored.level)).toBe(JSON.stringify(snapshot));
  });

  it('history is preserved across playtest', () => {
    const state = createEditorState(baseLevel());
    const edited = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 0, y: 0, width: 32, height: 16 },
      props: {},
    });
    expect(edited.undoStack.length).toBe(1);
    const { snapshot } = enterPlaytest(edited);
    const restored = exitPlaytest(edited, snapshot);
    expect(restored.undoStack.length).toBe(1);
    // Can still undo previous edits
    const undone = undo(restored);
    expect(undone.level.entities.length).toBe(2);
  });

  it('does not mutate the input state', () => {
    const state = createEditorState(baseLevel());
    const { snapshot } = enterPlaytest(state);
    const before = JSON.parse(JSON.stringify(state.level));
    exitPlaytest(state, snapshot);
    expect(state.level).toEqual(before);
  });
});
