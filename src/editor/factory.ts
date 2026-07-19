/**
 * Editor state factory (Pillar 4 — Level Editor Core).
 *
 * A single entry point, {@link createEditorState}, constructs the
 * initial {@link EditorState} for a given {@link LevelData}. It seeds
 * empty history, empty selection, an initial validation cache, and
 * sensible defaults for `maxHistoryDepth`.
 *
 * Pure: the input level is deep JSON-cloned so the editor's authoritative
 * copy never shares references with the caller's.
 *
 * @module
 */

import type { LevelData } from '../level/types';
import { validateLevel } from '../level/validate';
import { DEFAULT_MAX_HISTORY_DEPTH } from './constants';
import type { EditorState } from './types';

/**
 * Construct an initial {@link EditorState} for a level.
 *
 * The returned state has:
 *  - `level` set to a deep JSON-clone of `level` (so the editor owns
 *    its authoritative copy).
 *  - Empty undo and redo stacks.
 *  - Empty selection.
 *  - `nextTransactionId` starting at `1`.
 *  - No active transaction.
 *  - `playtestSnapshot` set to `null`.
 *  - `validation` populated by running `validateLevel(level)` once.
 *  - `maxHistoryDepth` from `options.maxHistoryDepth ?? DEFAULT_MAX_HISTORY_DEPTH`.
 *
 * **Never throws.** A malformed level produces a valid `EditorState`
 * whose `validation` field reports the errors.
 *
 * @example
 * ```ts
 * const state = createEditorState(myLevel);
 * // Apply ops, undo/redo, etc.
 * ```
 *
 * @param level   - Level to edit (never mutated).
 * @param options - Optional configuration.
 * @returns A fresh {@link EditorState} ready for editing.
 */
export function createEditorState(
  level: LevelData,
  options?: { readonly maxHistoryDepth?: number },
): EditorState {
  const cloned = JSON.parse(JSON.stringify(level)) as LevelData;
  const validation = validateLevel(cloned);
  const maxHistoryDepth =
    options?.maxHistoryDepth !== undefined &&
    Number.isFinite(options.maxHistoryDepth) &&
    options.maxHistoryDepth > 0
      ? Math.floor(options.maxHistoryDepth)
      : DEFAULT_MAX_HISTORY_DEPTH;
  return {
    level: cloned,
    undoStack: [],
    redoStack: [],
    maxHistoryDepth,
    selection: { ids: new Set() },
    nextTransactionId: 1,
    pendingTransaction: null,
    transactionStartSnapshot: null,
    playtestSnapshot: null,
    validation,
  };
}
