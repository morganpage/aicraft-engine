import { describe, it, expect } from 'vitest';
import {
  applyOp,
  createEditorState,
  undo,
} from '../../src/editor';
import { compileLevel } from '../../src/platformer';
import { PRECISION_PLATFORMER } from '../../src/platformer';
import type { LevelData, LevelEntity } from '../../src/level/types';
import {
  startSession,
  stopSession,
  resetToInitialState,
} from '../sections/playground-session';

/**
 * Integration tests for the playground's play↔edit session boundary.
 *
 * These exercise the actual code path used by `showcase/sections/playground.ts`:
 * the playground imports `startSession` / `stopSession` / `resetToInitialState`
 * for its mode transitions. A regression here is a regression in the
 * running showcase.
 */

function playgroundLevel(overrides: Partial<LevelData> = {}): LevelData {
  return {
    version: 1,
    id: 'playground-test',
    name: 'Playground',
    width: 600,
    height: 400,
    tileSize: 16,
    spawn: { x: 48, y: 336 },
    tiles: {
      data: new Array(37 * 25).fill(0),
      cols: 37,
      rows: 25,
      tileSize: 16,
    },
    entities: [
      { id: 1, kind: 'spawn', rect: { x: 48, y: 336, width: 16, height: 16 }, props: {} },
      {
        id: 2,
        kind: 'exit',
        rect: { x: 552, y: 336, width: 16, height: 16 },
        props: { isTrap: false, locked: false },
      },
      { id: 3, kind: 'platform', rect: { x: 0, y: 368, width: 600, height: 32 }, props: {} },
      {
        id: 4,
        kind: 'movingPlatform',
        rect: { x: 96, y: 160, width: 48, height: 16 },
        props: {
          speed: 90,
          path: [
            { x: 96, y: 160 },
            { x: 456, y: 160 },
          ],
          loopMode: 'pingpong',
        },
      },
    ],
    nextEntityId: 5,
    ...overrides,
  };
}

const SESSION_CONFIG = {
  platformerConfig: PRECISION_PLATFORMER,
  playerWidth: 24,
  playerHeight: 32,
};

describe('startSession — initial Play-mode setup (regression: startup was a no-op)', () => {
  it('compiles the level, initializes runtime state, and grounds the player at spawn', () => {
    const editorState = createEditorState(playgroundLevel());
    const session = startSession(editorState, SESSION_CONFIG);

    // The compiled level has static solids + at least one moving platform.
    expect(session.compiled.staticSolids.length).toBeGreaterThan(0);
    expect(session.compiled.movingPlatforms.length).toBe(1);

    // The player state is at the spawn position and grounded.
    expect(session.runtimeState.core.x).toBe(48);
    expect(session.runtimeState.core.y).toBe(336);
    expect(session.runtimeState.core.onGround).toBe(true);
    expect(session.runtimeState.core.width).toBe(24);
    expect(session.runtimeState.core.height).toBe(32);

    // Moving platforms are present and start at path[0].
    expect(session.movingPlatforms.length).toBe(1);
    expect(session.movingPlatforms[0].x).toBe(96);
    expect(session.movingPlatforms[0].y).toBe(160);
  });

  it('returns a snapshot independent of the editor (mutations cannot leak)', () => {
    const editorState = createEditorState(playgroundLevel());
    const session = startSession(editorState, SESSION_CONFIG);
    // Deep-clone the snapshot, then mutate the editor — the snapshot must
    // remain pristine.
    const before = JSON.parse(JSON.stringify(session.snapshot));
    const edited = applyOp(editorState, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 0, y: 0, width: 32, height: 16 },
      props: {},
    });
    expect(session.snapshot).toEqual(before);
    // Sanity: the editor state DID change.
    expect(edited.level.entities.length).toBe(editorState.level.entities.length + 1);
  });

  it('does not mutate the editor state passed in', () => {
    const editorState = createEditorState(playgroundLevel());
    // Compare level (the field that matters for compile); JSON round-trip
    // would drop the Set in selection.ids, so we compare level directly.
    const beforeLevel = JSON.parse(JSON.stringify(editorState.level));
    const beforeUndo = editorState.undoStack.length;
    const beforeSelection = editorState.selection.ids.size;
    startSession(editorState, SESSION_CONFIG);
    expect(JSON.parse(JSON.stringify(editorState.level))).toEqual(beforeLevel);
    expect(editorState.undoStack.length).toBe(beforeUndo);
    expect(editorState.selection.ids.size).toBe(beforeSelection);
  });
});

describe('stopSession — authored-state preservation', () => {
  it('restores the editor from the snapshot (full undo history preserved)', () => {
    const initial = createEditorState(playgroundLevel());
    // Simulate user edits before play.
    const edited = applyOp(initial, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 32, y: 32, width: 64, height: 16 },
      props: {},
    });
    expect(edited.undoStack.length).toBe(1);

    const session = startSession(edited, SESSION_CONFIG);
    // Even though the runtime state was mutated/stepped, the editor comes back.
    const restored = stopSession(edited, session.snapshot);

    // The level matches the pre-play state, NOT the runtime mutations.
    expect(restored.level).toEqual(edited.level);
    // Undo history is preserved.
    expect(restored.undoStack.length).toBe(1);
    expect(restored.undoStack[0]).toBe(edited.undoStack[0]);
  });

  it('undo works after stop (no transactions lost)', () => {
    const initial = createEditorState(playgroundLevel());
    const edited = applyOp(initial, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 0, y: 0, width: 16, height: 16 },
      props: {},
    });
    const session = startSession(edited, SESSION_CONFIG);
    const restored = stopSession(edited, session.snapshot);
    const undone = undo(restored);
    // The undo takes us back to the original level (pre-add).
    expect(undone.level).toEqual(initial.level);
  });
});

describe('resetToInitialState', () => {
  it('resets the player to spawn and grounds them', () => {
    const editorState = createEditorState(playgroundLevel());
    const session = startSession(editorState, SESSION_CONFIG);
    const reset = resetToInitialState(session.compiled);
    expect(reset.runtimeState.core.x).toBe(48);
    expect(reset.runtimeState.core.y).toBe(336);
    expect(reset.runtimeState.core.onGround).toBe(true);
    expect(reset.movingPlatforms.length).toBe(1);
  });

  it('returns fresh records (does not alias the compiled.initialState)', () => {
    const editorState = createEditorState(playgroundLevel());
    const session = startSession(editorState, SESSION_CONFIG);
    const a = resetToInitialState(session.compiled);
    const b = resetToInitialState(session.compiled);
    // Each call must produce independent records (pure).
    expect(a).not.toBe(b);
    expect(a.runtimeState).not.toBe(b.runtimeState);
    expect(a.runtimeState.core).not.toBe(b.runtimeState.core);
  });
});

describe('edit → play → edit cycle (integration smoke)', () => {
  it('a full edit/play cycle produces identical editor state when nothing changed during play', () => {
    const initial = createEditorState(playgroundLevel());
    const session1 = startSession(initial, SESSION_CONFIG);
    const restored1 = stopSession(initial, session1.snapshot);
    expect(restored1.level).toEqual(initial.level);

    // Same after a second cycle.
    const session2 = startSession(restored1, SESSION_CONFIG);
    const restored2 = stopSession(restored1, session2.snapshot);
    expect(restored2.level).toEqual(initial.level);
  });

  it('respects edits made between sessions (spawn move propagates into compiled runtime)', () => {
    const initial = createEditorState(playgroundLevel());

    // User edits the spawn entity. The reducer now propagates this to level.spawn.
    const moved = applyOp(initial, {
      type: 'moveEntities',
      ids: [1], // the spawn entity
      dx: 64,
      dy: -16,
    });
    expect(moved.level.spawn).toEqual({ x: 112, y: 320 });

    // The next session must compile at the NEW spawn — proves the spawn
    // editing fix flows through startSession → compileLevel.
    const session = startSession(moved, SESSION_CONFIG);
    expect(session.runtimeState.core.x).toBe(112);
    expect(session.runtimeState.core.y).toBe(320);
  });

  it('respects moving-platform edits (path translation propagates into compiled platforms)', () => {
    const initial = createEditorState(playgroundLevel());
    // Move the movingPlatform body by (40, 20). Reducer translates the path too.
    const moved = applyOp(initial, {
      type: 'moveEntities',
      ids: [4], // the movingPlatform entity
      dx: 40,
      dy: 20,
    });
    const mp = moved.level.entities.find((e) => e.id === 4);
    if (!mp || mp.kind !== 'movingPlatform') throw new Error('missing mp');
    expect(mp.rect.x).toBe(136);
    expect(mp.rect.y).toBe(180);
    expect(mp.props.path[0]).toEqual({ x: 136, y: 180 });
    expect(mp.props.path[1]).toEqual({ x: 496, y: 180 });

    // The session compiles from the new path[0].
    const session = startSession(moved, SESSION_CONFIG);
    const compiled = session.movingPlatforms[0];
    expect(compiled.x).toBe(136);
    expect(compiled.y).toBe(180);
  });
});

// Sanity: confirm compileLevel (which startSession composes) treats the
// spawn entity's rect and level.spawn consistently — both must move when
// the spawn moves. This is a backstop test in case the reducer fix is
// reverted; compileLevel must agree with the editor.
describe('compileLevel / editor reducer agreement on spawn', () => {
  it('uses level.spawn for the runtime position (proves spawn move is non-cosmetic)', () => {
    const initial = createEditorState(playgroundLevel());
    const moved = applyOp(initial, {
      type: 'moveEntities',
      ids: [1],
      dx: 100,
      dy: 0,
    });
    const compiled = compileLevel(moved.level, {
      config: PRECISION_PLATFORMER,
      playerWidth: 24,
      playerHeight: 32,
    });
    expect(compiled.initialState.core.x).toBe(148); // 48 + 100
  });
});

// Type-import assertion to satisfy noUnusedLocals (LevelEntity is used as a
// type-only assertion in `satisfies` form above).
const _entityTypeOnly: LevelEntity | null = null;
void _entityTypeOnly;
