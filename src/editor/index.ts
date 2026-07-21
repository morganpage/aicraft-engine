/**
 * Editor module (Pillar 4 — Level Editor Core).
 *
 * Headless, deterministic, zero-dependency state management for a level
 * editor. Operates exclusively on {@link LevelData} from `src/level/` —
 * no DOM, no rendering, no mouse handling. Exposes serializable
 * operations (no function closures) so history can later be transmitted
 * over a network for multi-player collaboration, plus snapshot-based
 * undo/redo so restore is cheap.
 *
 * Determinism summary:
 *  - No `Math.random` or `Date.now` anywhere.
 *  - No DOM reads.
 *  - All exports are pure functions over plain data.
 *  - Operations are serializable discriminated unions (data only).
 *  - `applyOp`, `applyBatch`, `undo`, `redo`, `clearHistory`,
 *    `select*`, `copySelection`, `pasteClipboard`, `enterPlaytest`,
 *    `exitPlaytest`, `instantiateCatalogEntry` never throw on any
 *    input. `beginTransaction` and `commitTransaction` throw only on
 *    programmer error (misuse of the transaction pair).
 *
 * @module
 */

export type {
  EditorOperation,
  HistoryEntry,
  SelectionMode,
  SelectionState,
  SnapGuide,
  EditorState,
  ClipboardEntry,
  CatalogEntry,
  EntityCatalog,
} from './types';

export {
  DEFAULT_MAX_HISTORY_DEPTH,
  DEFAULT_GRID_SIZE,
  DEFAULT_SNAP_THRESHOLD,
} from './constants';

export { applyOp, applyBatch } from './operations';

export {
  undo,
  redo,
  beginTransaction,
  commitTransaction,
  canUndo,
  canRedo,
  clearHistory,
} from './history';

export {
  select,
  selectMany,
  selectInRect,
  clearSelection,
  selectAll,
  isInSelection,
  entityAtPoint,
} from './selection';

export { snapToGrid, snapRectToGrid, snapToEdges } from './snapping';

export { copySelection, pasteClipboard } from './clipboard';

export { enterPlaytest, exitPlaytest } from './playtest';

export {
  DEFAULT_CATALOG,
  createCatalogEntry,
  findCatalogEntry,
  instantiateCatalogEntry,
} from './catalog';

export { createEditorState } from './factory';
