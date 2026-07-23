/**
 * DOM-free pure session logic for the playground section.
 *
 * The playground section (`sections/playground.ts`) is DOM-coupled: it
 * queries the canvas, attaches listeners, drives the game loop. Those
 * concerns can't be unit-tested under a Node environment without a
 * brittle jsdom fake. This module holds the **pure state transitions**
 * the playground performs on mode change, level compile, etc., so they
 * can be exercised in a Vitest suite without touching a single DOM API.
 *
 * `sections/playground.ts` imports and calls these helpers — they are the
 * authoritative implementation of the edit↔play boundary, not a
 * parallel reimplementation. That keeps tests meaningful: a regression
 * in this module is a regression in the playground.
 *
 * All exports are pure: inputs are never mutated, fresh records returned,
 * never throws on any input. Deterministic-core layer.
 *
 * @module
 */

import {
  enterPlaytest,
  exitPlaytest,
  select,
  type EditorState,
} from '../../src/editor';
import type { LevelData } from '../../src/level/types';
import {
  compileLevel,
  type CompiledLevel,
} from '../../src/platformer';
import type { PlatformerConfig } from '../../src/platformer';
import type { EditorOperation } from '../../src/editor/types';
import { allocateEntityId } from '../../src/level/entity-id';
import { applyOp } from '../../src/editor/operations';

/**
 * Tuning bundle handed to {@link createPlaygroundSession}. The runtime
 * kernel config + player body dimensions; these come from the playground's
 * constant block (which see for the per-field rationale).
 */
export interface PlaygroundSessionConfig {
  /** Per-instance kernel tuning (e.g. PLAYGROUND_PLATFORMER_CONFIG). */
  readonly platformerConfig: Readonly<PlatformerConfig>;
  /** Player collision-box width in world units. */
  readonly playerWidth: number;
  /** Player collision-box height in world units. */
  readonly playerHeight: number;
}

/**
 * Initial-state snapshot produced by {@link startSession}: the compiled
 * level plus a runtime player state marked grounded so the first frame
 * reads as "standing on the floor" without a 1-tick settle.
 */
export interface InitialPlayState {
  /** The editor's retained playtest snapshot — passed back to `stopSession`. */
  readonly snapshot: LevelData;
  /** Compiled kernel inputs (static solids + moving platforms + initial state). */
  readonly compiled: CompiledLevel;
  /** Live player state, marked grounded at spawn. */
  readonly runtimeState: CompiledLevel['initialState'];
  /** Initial moving-platform descriptors (one per movingPlatform entity). */
  readonly movingPlatforms: CompiledLevel['movingPlatforms'];
}

/**
 * Start a play session: deep-clone the editor's level (sandbox boundary
 * — runtime mutations cannot leak into the editor), compile the kernel
 * inputs from the clone, and produce the live runtime state marked
 * grounded at the spawn point.
 *
 * Pure: the input `editorState` is never mutated; the returned
 * `snapshot` is an independent deep clone safe to retain for
 * {@link stopSession}.
 *
 * @example
 * ```ts
 * const session = startSession(editorState, { platformerConfig, playerWidth, playerHeight });
 * // run kernel against session.runtimeState / session.compiled.staticSolids / session.movingPlatforms
 * const restored = stopSession(editorState, session.snapshot);
 * ```
 *
 * @param editorState - Current editor state (never mutated).
 * @param config     - Tuning bundle from the playground.
 * @returns A snapshot + compiled kernel inputs + initial runtime state.
 */
export function startSession(
  editorState: EditorState,
  config: PlaygroundSessionConfig,
): InitialPlayState {
  const { snapshot, runtimeLevel } = enterPlaytest(editorState);
  const compiled = compileLevel(runtimeLevel, {
    config: config.platformerConfig,
    playerWidth: config.playerWidth,
    playerHeight: config.playerHeight,
  });
  const initialState = compiled.initialState;
  const runtimeState = {
    ...initialState,
    core: { ...initialState.core, onGround: true },
  };
  return {
    snapshot,
    compiled,
    runtimeState,
    movingPlatforms: compiled.movingPlatforms,
  };
}

/**
 * Stop a play session: restore the editor's level from the snapshot
 * taken at {@link startSession}. Undo/redo history is preserved.
 *
 * Pure: the input `editorState` is never mutated.
 *
 * @param editorState - Current editor state (never mutated).
 * @param snapshot    - The `snapshot` returned by {@link startSession}.
 * @returns A fresh editor state with the snapshot restored.
 */
export function stopSession(
  editorState: EditorState,
  snapshot: LevelData,
): EditorState {
  return exitPlaytest(editorState, snapshot);
}

/**
 * Reset the runtime player + moving-platforms back to their initial
 * compiled state. Pure: returns a fresh record; never mutates input.
 *
 * Used by the playground's R-key reset and fall-off-world respawn.
 *
 * @param compiled - The compiled level (from {@link InitialPlayState}.compiled).
 * @returns Fresh `{ runtimeState, movingPlatforms }` records.
 */
/**
 * Apply an `addEntity` operation and immediately select the newly allocated
 * entity. **Pure.**
 *
 * Uses `allocateEntityId` to predict the exact ID the `applyOp` reducer
 * will assign, applies the op, then selects that ID with mode `'replace'`.
 * This gives the caller the interactive widget (path editor, resize handles)
 * for the entity that was just placed, without altering core `applyOp`
 * selection semantics.
 *
 * The function does not switch `editMode` — the caller decides whether to
 * remain in place mode (for sticky placement) or switch to select mode
 * (for path-bearing entities where the widget should be immediately visible).
 *
 * @example
 * ```ts
 * let state = createEditorState(level);
 * state = addEntityAndSelect(state, {
 *   type: 'addEntity',
 *   kind: 'movingPlatform',
 *   rect: { x: 100, y: 160, width: 48, height: 16 },
 *   props: { speed: 60, path: [...], loopMode: 'loop' },
 * });
 * // state.selection.ids contains exactly the new entity's id.
 * ```
 *
 * @param state - Current editor state (never mutated).
 * @param op    - An `addEntity` operation to apply.
 * @returns A fresh editor state with the entity added and selected.
 */
export function addEntityAndSelect(
  state: EditorState,
  op: EditorOperation,
): EditorState {
  const { id } = allocateEntityId(state.level);
  const next = applyOp(state, op);
  return select(next, id, 'replace');
}

export function resetToInitialState(compiled: CompiledLevel): {
  readonly runtimeState: InitialPlayState['runtimeState'];
  readonly movingPlatforms: CompiledLevel['movingPlatforms'];
} {
  const initial = compiled.initialState;
  return {
    runtimeState: {
      ...initial,
      core: { ...initial.core, onGround: true },
    },
    movingPlatforms: compiled.movingPlatforms,
  };
}
