/**
 * Undo / redo / transactions for the editor (Pillar 4 — Level Editor Core).
 *
 * History is **snapshot-based**: each {@link HistoryEntry} carries both
 * the pre-op and post-op {@link LevelData}. Undo restores `preSnapshot`;
 * redo restores `postSnapshot`. No inverse-op computation is required.
 *
 * Transactions group multiple ops into a single undo step. The pattern is:
 * ```ts
 * state = beginTransaction(state);
 * state = applyOp(state, op1); // appended to pendingTransaction
 * state = applyOp(state, op2); // appended to pendingTransaction
 * state = commitTransaction(state, 'Drag 3 entities'); // one undo entry
 * ```
 *
 * All exports are pure (input never mutated, fresh state returned).
 * `beginTransaction` and `commitTransaction` throw on misuse (calling
 * `beginTransaction` twice; calling `commitTransaction` without a
 * `beginTransaction`) — this is **programmer error**, not user-facing
 * invalid input, mirroring the `parseHex` precedent in `primitives/`.
 *
 * @module
 */

import type {
  EditorOperation,
  EditorState,
  HistoryEntry,
} from './types';
import { validateLevel } from '../level/validate';

/**
 * Pop the top of the undo stack, restore the pre-snapshot, and push the
 * entry onto the redo stack. **Pure.**
 *
 * If the undo stack is empty, returns the input state unchanged.
 *
 * Selection is defensively cleared if any of its IDs no longer exist
 * in the restored level (e.g. the undone op had added them).
 *
 * The validation cache is recomputed against the restored level so the
 * status panel reflects the post-undo state, not the pre-undo state.
 *
 * @param state - Current editor state (never mutated).
 * @returns A fresh editor state with the top undo entry reverted.
 */
export function undo(state: EditorState): EditorState {
  if (state.undoStack.length === 0) return state;
  const stack = [...state.undoStack];
  const entry = stack.pop() as HistoryEntry;
  const restoredLevel = entry.preSnapshot;
  const survivingIds = new Set(restoredLevel.entities.map((e) => e.id));
  const prunedSelection = new Set(
    [...state.selection.ids].filter((id) => survivingIds.has(id)),
  );
  return {
    ...state,
    level: restoredLevel,
    undoStack: stack,
    redoStack: [...state.redoStack, entry],
    selection: { ids: prunedSelection },
    validation: validateLevel(restoredLevel),
  };
}

/**
 * Pop the top of the redo stack, restore the post-snapshot, and push the
 * entry back onto the undo stack. **Pure.**
 *
 * If the redo stack is empty, returns the input state unchanged.
 *
 * The validation cache is recomputed against the re-applied level so the
 * status panel reflects the post-redo state, not the pre-redo state.
 *
 * @param state - Current editor state (never mutated).
 * @returns A fresh editor state with the top redo entry re-applied.
 */
export function redo(state: EditorState): EditorState {
  if (state.redoStack.length === 0) return state;
  const stack = [...state.redoStack];
  const entry = stack.pop() as HistoryEntry;
  const restoredLevel = entry.postSnapshot;
  return {
    ...state,
    level: restoredLevel,
    undoStack: [...state.undoStack, entry],
    redoStack: stack,
    validation: validateLevel(restoredLevel),
  };
}

/**
 * `true` iff at least one entry exists on the undo stack. Pure reader.
 */
export function canUndo(state: EditorState): boolean {
  return state.undoStack.length > 0;
}

/**
 * `true` iff at least one entry exists on the redo stack. Pure reader.
 */
export function canRedo(state: EditorState): boolean {
  return state.redoStack.length > 0;
}

/**
 * Begin a transaction. **Pure** (returns a new state).
 *
 * Marks the state as in-transaction. Subsequent `applyOp` calls append
 * to `pendingTransaction` instead of pushing to the undo stack.
 * `commitTransaction(state, label)` collapses the pending ops into a
 * single history entry.
 *
 * @throws {Error} If already in a transaction (programmer error).
 *
 * @param state - Current editor state (never mutated).
 * @returns A fresh editor state marked as in-transaction.
 */
export function beginTransaction(state: EditorState): EditorState {
  if (state.pendingTransaction !== null) {
    throw new Error(
      'beginTransaction: already in a transaction (did you forget to call commitTransaction?)',
    );
  }
  return {
    ...state,
    pendingTransaction: [],
    transactionStartSnapshot: state.level,
  };
}

/**
 * Commit the current transaction as a single history entry. **Pure.**
 *
 * Collapses all ops accumulated since `beginTransaction` into one
 * `batch` op, pushes a single {@link HistoryEntry} onto the undo stack
 * with the given `label`, evicts entries past `maxHistoryDepth`, and
 * clears the redo stack. The transaction is closed
 * (`pendingTransaction` set back to `null`).
 *
 * If no ops were accumulated, the transaction is closed without
 * pushing a history entry.
 *
 * @throws {Error} If not currently in a transaction (programmer error).
 *
 * @param state - Current editor state (never mutated).
 * @param label - Human-readable label for the undo stack entry.
 * @returns A fresh editor state with the transaction committed.
 */
export function commitTransaction(state: EditorState, label: string): EditorState {
  if (state.pendingTransaction === null) {
    throw new Error(
      'commitTransaction: not currently in a transaction (did you forget to call beginTransaction?)',
    );
  }
  const pending = state.pendingTransaction;
  if (pending.length === 0) {
    return {
      ...state,
      pendingTransaction: null,
      transactionStartSnapshot: null,
    };
  }
  const batchOp: EditorOperation = { type: 'batch', ops: pending, label };
  const preSnapshot = state.transactionStartSnapshot ?? state.level;
  const entry: HistoryEntry = {
    op: batchOp,
    preSnapshot,
    postSnapshot: state.level,
    label,
    transactionId: state.nextTransactionId,
  };
  const undoStack = [...state.undoStack, entry];
  while (undoStack.length > state.maxHistoryDepth) {
    undoStack.shift();
  }
  return {
    ...state,
    undoStack,
    redoStack: [],
    nextTransactionId: state.nextTransactionId + 1,
    pendingTransaction: null,
    transactionStartSnapshot: null,
  };
}

/**
 * Empty both undo and redo stacks. **Pure.**
 *
 * Useful after loading a new level so the user can't undo back into the
 * previous level's state. The current `level` is preserved; only the
 * history is cleared.
 *
 * @param state - Current editor state (never mutated).
 * @returns A fresh editor state with empty undo and redo stacks.
 */
export function clearHistory(state: EditorState): EditorState {
  if (state.undoStack.length === 0 && state.redoStack.length === 0) return state;
  return { ...state, undoStack: [], redoStack: [] };
}
