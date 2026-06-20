/**
 * Save storage factories and JSON load/write helpers.
 *
 * Follows the canonical defensive adapter pattern (`src/primitives/motion.ts`):
 *
 *   - **Lazy host resolution** — `window.localStorage` is resolved INSIDE each
 *     method, never at factory creation. The module is safe to import in Node,
 *     SSR, and test environments where `window` is undefined.
 *   - **Swallow all errors** — any `localStorage` failure (QuotaExceeded,
 *     private mode, `SecurityError` on `file://`, etc.) is caught and the call
 *     silently degrades (`load()` → `null`, `save()`/`clear()` → no-op).
 *   - **Never-throw public API** — no method or helper throws.
 *
 * The load/write helpers (`loadSave` / `writeSave`) additionally swallow
 * `JSON.parse` / `JSON.stringify` failures, so corrupt save data and circular
 * references never crash the game loop.
 *
 * **Zero cross-module imports** beyond `./constants` and `./types`.
 *
 * @module
 */

import { DEFAULT_SAVE_KEY } from './constants';
import type { SaveStorage } from './types';

/**
 * Create a localStorage-backed save storage. Lazily resolves `window.localStorage`
 * on the first `load()`/`save()`/`clear()` call — NOT at module load. In Node /
 * SSR / test (no `window`), all methods are no-ops (`load()` returns `null`,
 * `save()`/`clear()` do nothing). Swallows all errors (quota exceeded, private
 * mode, JSON parse errors). Never throws.
 *
 * @param key - localStorage key. Defaults to {@link DEFAULT_SAVE_KEY} when
 *   omitted or empty.
 * @returns A defensive {@link SaveStorage} backed by `window.localStorage`.
 *
 * @example
 * ```ts
 * const storage = createLocalStorageSaveStorage();
 * writeSave(storage, { level: 3, coins: 120 });
 * const state = loadSave(storage, { level: 1, coins: 0 });
 * ```
 */
export function createLocalStorageSaveStorage(key?: string): SaveStorage {
  const storageKey: string =
    typeof key === 'string' && key.length > 0 ? key : DEFAULT_SAVE_KEY;

  return {
    load(): string | null {
      try {
        if (typeof window === 'undefined') return null;
        return window.localStorage.getItem(storageKey);
      } catch {
        return null;
      }
    },

    save(json: string): void {
      try {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(storageKey, json);
      } catch {
        // Quota exceeded, private mode, file:// SecurityError — swallow.
      }
    },

    clear(): void {
      try {
        if (typeof window === 'undefined') return;
        window.localStorage.removeItem(storageKey);
      } catch {
        // Swallow.
      }
    },
  };
}

/**
 * Create an in-memory save storage (closure-backed). Used for tests and SSR.
 * No persistence across page reloads. Never throws.
 *
 * @returns A {@link SaveStorage} backed by a closure variable.
 */
export function createMemorySaveStorage(): SaveStorage {
  let data: string | null = null;
  return {
    load: () => data,
    save: (json: string) => {
      data = json;
    },
    clear: () => {
      data = null;
    },
  };
}

/**
 * Load and parse save data from storage. Returns `defaultValue` on any error
 * (missing save, corrupt JSON, storage unavailable). Never throws.
 *
 * @param storage      - The storage backend to read from.
 * @param defaultValue - Fallback returned if no save exists or parsing fails.
 * @returns The parsed save data, or `defaultValue`.
 *
 * @example
 * ```ts
 * const state = loadSave(storage, { level: 1, coins: 0 });
 * ```
 */
export function loadSave<T>(storage: SaveStorage, defaultValue: T): T {
  let raw: string | null;
  try {
    raw = storage.load();
  } catch {
    return defaultValue;
  }
  if (raw === null) return defaultValue;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Serialize and write save data to storage. Silently fails on error (quota,
 * `JSON.stringify` failure such as a circular reference, backend write error).
 * Never throws.
 *
 * @param storage - The storage backend to write to.
 * @param value   - The data to save (JSON-serialized via `JSON.stringify`).
 *
 * @example
 * ```ts
 * writeSave(storage, { level: 3, coins: 120 });
 * ```
 */
export function writeSave<T>(storage: SaveStorage, value: T): void {
  try {
    const json = JSON.stringify(value);
    storage.save(json);
  } catch {
    // Stringify failure (circular reference) or backend throw — swallow.
  }
}
