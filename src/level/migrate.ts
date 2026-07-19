/**
 * Defensive forward-ladder migration for level data.
 *
 * Mirrors the cosmetics-module migration discipline (`src/cosmetics/migrate.ts`):
 * never throws on any input — malformed JSON, non-objects, wrong versions,
 * and individually-broken migration steps all collapse gracefully to a
 * diagnostic. The forward-ladder purity contract (never throw on untrusted
 * input) holds end-to-end.
 *
 * Unlike `migrateManifest`, this function does NOT know the target schema —
 * the caller supplies the migration ladder (a map of "from version" → step
 * function) and the desired `targetVersion`. The library is the runner; the
 * caller owns the steps.
 *
 * @module
 */

import type { LevelMigration } from './types';

/** Result of {@link migrateLevel}. */
export interface LevelMigrationResult {
  /** Migrated level record, or `null` if migration failed. */
  readonly level: Record<string, unknown> | null;
  /** Parsed `raw.version`, or `null` if it was missing or not a valid integer ≥ 1. */
  readonly fromVersion: number | null;
  /** Version the ladder reached (equals `targetVersion` on success). */
  readonly toVersion: number;
  /** Diagnostic strings — empty on success. */
  readonly errors: readonly string[];
}

/** Truthy narrow for a plain non-null object record (not an array). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Read `raw.version` defensively. Returns the integer version if `raw` is a
 * plain object with a `version` field that is a finite integer ≥ 1; else
 * returns `null`.
 */
function readVersion(raw: unknown): number | null {
  if (!isPlainObject(raw)) return null;
  const v = raw.version;
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < 1) {
    return null;
  }
  return v;
}

/**
 * Migrate raw level data forward to `targetVersion` via a caller-supplied
 * migration ladder. **Never throws.**
 *
 * Algorithm:
 *  1. Read `raw.version`. If `raw` is not a plain object or `version` is not
 *     a finite integer ≥ 1, return `level: null` with an error string.
 *  2. If `raw.version > targetVersion`, return the raw unchanged with
 *     `fromVersion === toVersion === raw.version` (no downgrade attempted).
 *  3. If `raw.version === targetVersion`, return the raw unchanged.
 *  4. Otherwise, run `migrations[raw.version]`, `migrations[raw.version + 1]`,
 *     ... `migrations[targetVersion - 1]` in order, threading each step's
 *     output into the next step's input. Each step is wrapped in `try/catch`.
 *     If a step is missing, throws, or returns a non-object, abort and return
 *     `level: null` with an error string.
 *
 * @example
 * ```ts
 * const { level, errors } = migrateLevel(rawJson, {
 *   1: (raw) => ({ ...raw, version: 2, renamedField: raw.oldField }),
 * }, 2);
 * if (level === null) console.error(errors);
 * ```
 *
 * @param raw           - Arbitrary persisted data (typically a `JSON.parse` result).
 * @param migrations    - Map of "from version" → migration function. The library
 *                        does not validate the shape of returned records.
 * @param targetVersion - Desired final schema version.
 * @returns Migration outcome. Never throws.
 */
export function migrateLevel(
  raw: unknown,
  migrations: Readonly<Record<number, LevelMigration>>,
  targetVersion: number,
): LevelMigrationResult {
  const fromVersion = readVersion(raw);
  if (fromVersion === null) {
    return {
      level: null,
      fromVersion: null,
      toVersion: targetVersion,
      errors: ['migrateLevel: raw.version is missing or not a finite integer >= 1'],
    };
  }

  if (fromVersion > targetVersion) {
    return {
      level: raw as Record<string, unknown>,
      fromVersion,
      toVersion: fromVersion,
      errors: [],
    };
  }

  let current: Record<string, unknown> = raw as Record<string, unknown>;
  const errors: string[] = [];

  for (let v = fromVersion; v < targetVersion; v++) {
    const step = migrations[v];
    if (typeof step !== 'function') {
      errors.push(`migrateLevel: missing migration step from version ${v} to ${v + 1}`);
      return { level: null, fromVersion, toVersion: targetVersion, errors };
    }
    let next: Record<string, unknown>;
    try {
      next = step(current);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`migrateLevel: migration step ${v} threw: ${msg}`);
      return { level: null, fromVersion, toVersion: targetVersion, errors };
    }
    if (!isPlainObject(next)) {
      errors.push(`migrateLevel: migration step ${v} returned a non-object`);
      return { level: null, fromVersion, toVersion: targetVersion, errors };
    }
    current = next;
  }

  return { level: current, fromVersion, toVersion: targetVersion, errors };
}
