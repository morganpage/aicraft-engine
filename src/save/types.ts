/**
 * Save data storage backend abstraction (host-touching layer).
 *
 * @module
 */

/**
 * Storage backend for save data. Implementations:
 * - `createLocalStorageSaveStorage` — browser localStorage (defensive)
 * - `createMemorySaveStorage` — in-memory closure (tests/SSR)
 *
 * All methods MUST be safe to call from the game loop — never throw, degrade
 * gracefully on storage errors (quota exceeded, private mode, SSR, etc.).
 */
export interface SaveStorage {
  /**
   * Load the raw save string.
   *
   * @returns The stored string, or `null` if no save exists or on any error
   *   (backend unavailable, read failure, etc.).
   */
  load(): string | null;

  /**
   * Save a raw string. Silently fails on quota/access errors — never throws.
   *
   * @param json - The raw string to persist (typically `JSON.stringify` output).
   */
  save(json: string): void;

  /** Clear the stored save. Never throws. */
  clear(): void;
}
