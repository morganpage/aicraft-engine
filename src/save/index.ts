/**
 * Save module — defensive save-data storage backends and JSON load/write helpers.
 *
 * Provides:
 *   - {@link SaveStorage} — storage backend interface.
 *   - {@link createLocalStorageSaveStorage} — defensive browser localStorage backend.
 *   - {@link createMemorySaveStorage} — in-memory backend (tests / SSR).
 *   - {@link loadSave} / {@link writeSave} — JSON-safe load/write helpers.
 *   - {@link DEFAULT_SAVE_KEY} — default localStorage key.
 *
 * Defensive contract (mirrors `src/primitives/motion.ts`):
 *   - Lazy `window.localStorage` resolution (never at module load).
 *   - Swallow all errors (quota, private mode, parse/stringify failures).
 *   - Never-throw public API; degrades to no-op / `null` in Node.
 *
 * **Zero cross-module imports.**
 *
 * @module
 */

export type { SaveStorage } from './types';
export { DEFAULT_SAVE_KEY } from './constants';
export {
  createLocalStorageSaveStorage,
  createMemorySaveStorage,
  loadSave,
  writeSave,
} from './storage';
