/**
 * Playtest sandbox boundary for the editor (Pillar 4 — Level Editor Core).
 *
 * Provides the snapshot/restore pair for "enter playtest mode" and
 * "exit playtest mode". The library does NOT run the simulation —
 * that's the consumer's job. It just provides a deep-clone boundary so
 * the consumer's simulation mutations never leak into the editor's
 * authoritative level state.
 *
 * Both exports are pure: inputs are never mutated, and any returned
 * {@link LevelData} is a deep JSON-clone with no shared references.
 *
 * @module
 */

import type { LevelData } from '../level/types';
import type { EditorState } from './types';

/**
 * Enter playtest mode. **Pure.**
 *
 * Deep JSON-clones `state.level` twice: once as the `snapshot` (for the
 * caller to retain and pass back to {@link exitPlaytest}) and once as
 * the `runtimeLevel` (for the caller's simulation to mutate freely).
 *
 * The editor's authoritative level is not modified — the caller must
 * NOT pass `runtimeLevel` back to any editor op. After the playtest,
 * the caller passes `snapshot` to {@link exitPlaytest} to restore the
 * editor.
 *
 * The returned `snapshot` and `runtimeLevel` are independent clones
 * (mutating one does not affect the other).
 *
 * @example
 * ```ts
 * const { snapshot, runtimeLevel } = enterPlaytest(state);
 * // Consumer runs their simulation against runtimeLevel:
 * for (let i = 0; i < 1000; i++) stepPlatformer(runtimeLevel, input);
 * // runtimeLevel is now mutated; state.level is still the pre-playtest version
 * const restored = exitPlaytest(state, snapshot);
 * // restored.level === pre-playtest level (deep equal)
 * ```
 *
 * @param state - Current editor state (never mutated).
 * @returns `{ snapshot, runtimeLevel }` — two independent deep clones.
 */
export function enterPlaytest(state: EditorState): {
  readonly snapshot: LevelData;
  readonly runtimeLevel: LevelData;
} {
  const snapshot = JSON.parse(JSON.stringify(state.level)) as LevelData;
  const runtimeLevel = JSON.parse(JSON.stringify(state.level)) as LevelData;
  return { snapshot, runtimeLevel };
}

/**
 * Exit playtest mode by restoring the editor's level to the retained
 * snapshot. **Pure.**
 *
 * Returns a fresh `EditorState` with `level` set to a deep JSON-clone
 * of `snapshot`. The undo/redo history is preserved (the editor can
 * still undo previous edits). Any runtime mutations the consumer made
 * to their `runtimeLevel` copy are discarded.
 *
 * @param state    - Current editor state (never mutated).
 * @param snapshot - The `snapshot` returned by {@link enterPlaytest}.
 * @returns A fresh editor state with the snapshot restored as `level`.
 */
export function exitPlaytest(
  state: EditorState,
  snapshot: LevelData,
): EditorState {
  const restored = JSON.parse(JSON.stringify(snapshot)) as LevelData;
  return { ...state, level: restored, playtestSnapshot: null };
}
