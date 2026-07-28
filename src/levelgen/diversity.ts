/**
 * Diversity tracking and novelty archive for procedural level generation.
 *
 * Provides fingerprinting for generated levels (deterministic structural
 * summaries), a FIFO novelty archive that tracks recently generated levels,
 * and a novelty score that measures how different a new level is from past
 * entries using Hamming distance on height profiles and Jaccard distance on
 * motif histograms.
 *
 * **Determinism:** All functions are pure — same input → same output, forever.
 * No `Math.random`, no `Date.now()`, no global mutable state. Never throws.
 * Uses `canonicalize` + `fnv1a` for deterministic hashing.
 *
 * @module
 */

import type { LevelData } from '../level/types';
import { canonicalize, fnv1a } from '../level/serialize';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A deterministic structural fingerprint for a generated level.
 *
 * Captures the essential structural features needed to compare levels for
 * diversity: a hash of the full level data, a histogram of entity kinds,
 * a sampled height profile, and entity/tile counts.
 *
 * @example
 * ```ts
 * const fp = computeLevelFingerprint(level, 42);
 * console.log(fp.hash, fp.entityCount, fp.tileCount);
 * ```
 */
export interface LevelFingerprint {
  /** Schema version. Must be `1`. */
  readonly version: 1;
  /** Seed used to generate the level. */
  readonly seed: number;
  /** 32-bit FNV-1a hash of the canonicalized level JSON. */
  readonly hash: number;
  /** Count of each entity kind present in the level. */
  readonly motifHistogram: Readonly<Record<string, number>>;
  /** Sampled platform heights at regular horizontal intervals (tile units). */
  readonly heightProfile: readonly number[];
  /** Total number of entities in the level. */
  readonly entityCount: number;
  /** Total number of non-empty tiles in the level grid. */
  readonly tileCount: number;
}

/**
 * A FIFO novelty archive tracking recently generated levels for diversity
 * scoring.
 *
 * The archive has a fixed {@link maxSize}. Adding a fingerprint when the
 * archive is full evicts the oldest entry (FIFO).
 *
 * @example
 * ```ts
 * let archive = createNoveltyArchive(10);
 * archive = addToArchive(archive, fingerprint);
 * const score = noveltyScore(newFingerprint, archive);
 * ```
 */
export interface NoveltyArchive {
  /** Schema version. Must be `1`. */
  readonly version: 1;
  /** Stored fingerprints, oldest first. */
  readonly fingerprints: readonly LevelFingerprint[];
  /** Maximum number of fingerprints to retain. */
  readonly maxSize: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum size for a novelty archive. */
const DEFAULT_ARCHIVE_MAX_SIZE = 32;

/** Number of height-profile samples to aim for. */
const HEIGHT_SAMPLE_COUNT = 10;

// ---------------------------------------------------------------------------
// Fingerprint helpers
// ---------------------------------------------------------------------------

/**
 * Compute the height profile of a tile grid: for each sample column, find
 * the highest non-empty tile (closest to the top) and return its distance
 * from the bottom (in tile units).
 *
 * Pure: same tiles → same profile, forever. Never throws.
 */
function computeHeightProfile(
  data: readonly number[],
  cols: number,
  rows: number,
): readonly number[] {
  if (!Array.isArray(data) || cols <= 0 || rows <= 0) return [];

  const interval = Math.max(1, Math.floor(cols / HEIGHT_SAMPLE_COUNT));
  const profile: number[] = [];

  for (let x = 0; x < cols; x += interval) {
    let firstNonEmpty = rows; // default: no solid tile found
    for (let y = 0; y < rows; y++) {
      const idx = y * cols + x;
      const tileValue = idx < data.length ? data[idx] : 0;
      if (tileValue !== 0 && tileValue !== undefined && tileValue !== null) {
        firstNonEmpty = y;
        break;
      }
    }
    // Height from bottom (rows - firstNonEmpty). If no solid tile found, 0.
    profile.push(rows - firstNonEmpty);
  }

  return profile;
}

/**
 * Build a histogram of entity kinds from a level entity list.
 *
 * Pure: same entities → same histogram, forever. Never throws.
 */
function buildMotifHistogram(
  entities: readonly unknown[] | undefined | null,
): Readonly<Record<string, number>> {
  const histogram: Record<string, number> = {};

  if (!Array.isArray(entities)) return histogram;

  for (const entity of entities) {
    if (!entity || typeof entity !== 'object') continue;
    const kind = (entity as Record<string, unknown>).kind;
    if (typeof kind === 'string') {
      histogram[kind] = (histogram[kind] ?? 0) + 1;
    }
  }

  return histogram;
}

// ---------------------------------------------------------------------------
// computeLevelFingerprint
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic structural fingerprint for a platformer level.
 *
 * The fingerprint captures:
 * - A 32-bit FNV-1a hash of the canonicalized level JSON.
 * - An entity-kind histogram (motif distribution).
 * - A height profile sampled at regular horizontal intervals.
 * - Total entity and non-empty tile counts.
 *
 * **Determinism:** Same `(level, seed)` → same fingerprint, forever.
 * **Never throws.** Invalid or missing inputs produce a degraded fingerprint
 * rather than throwing.
 *
 * @param level - The level data to fingerprint.
 * @param seed  - The generation seed (included in the fingerprint for
 *                traceability).
 * @returns A {@link LevelFingerprint}. Never throws.
 *
 * @example
 * ```ts
 * const fp = computeLevelFingerprint(levelData, 42);
 * console.log(`Level hash: ${fp.hash}`);
 * console.log(`Entity kinds:`, fp.motifHistogram);
 * ```
 */
export function computeLevelFingerprint(
  level: LevelData,
  seed: number,
): LevelFingerprint {
  // Defensive handling — never throw
  try {
    const lvl = level ?? ({} as LevelData);
    const safeSeed = typeof seed === 'number' && Number.isFinite(seed) ? seed : 0;
    const tiles = lvl.tiles ?? { data: [], cols: 0, rows: 0, tileSize: 16 };
    const entities = lvl.entities ?? [];

    // Hash of canonicalized level JSON
    const canonical = canonicalize(lvl);
    const hash = fnv1a(canonical);

    // Motif histogram from entity kinds
    const motifHistogram = buildMotifHistogram(entities);

    // Height profile
    const heightProfile = computeHeightProfile(
      tiles.data,
      tiles.cols,
      tiles.rows,
    );

    // Entity count
    const entityCount = Array.isArray(entities) ? entities.length : 0;

    // Tile count: non-empty tiles
    const tileCount = Array.isArray(tiles.data)
      ? tiles.data.filter(
          (v: number) => v !== 0 && v !== undefined && v !== null,
        ).length
      : 0;

    return {
      version: 1,
      seed: safeSeed,
      hash,
      motifHistogram,
      heightProfile,
      entityCount,
      tileCount,
    };
  } catch {
    // Graceful degradation
    return {
      version: 1,
      seed: typeof seed === 'number' && Number.isFinite(seed) ? seed : 0,
      hash: 0,
      motifHistogram: {},
      heightProfile: [],
      entityCount: 0,
      tileCount: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// createNoveltyArchive
// ---------------------------------------------------------------------------

/**
 * Create an empty novelty archive with the specified maximum size.
 *
 * The archive is frozen (immutable). Use {@link addToArchive} to return a
 * new archive with a fingerprint appended.
 *
 * @param maxSize - Maximum number of fingerprints to retain (default `32`).
 *                  Must be a positive integer; values `<= 0` clamp to `1`.
 * @returns A frozen {@link NoveltyArchive} with no fingerprints.
 *
 * @example
 * ```ts
 * const archive = createNoveltyArchive(10);
 * console.log(archive.maxSize); // 10
 * console.log(archive.fingerprints.length); // 0
 * ```
 */
export function createNoveltyArchive(maxSize?: number): NoveltyArchive {
  const safeSize =
    typeof maxSize === 'number' && Number.isFinite(maxSize) && maxSize > 0
      ? Math.floor(maxSize)
      : DEFAULT_ARCHIVE_MAX_SIZE;

  return Object.freeze({
    version: 1,
    fingerprints: Object.freeze([]) as readonly LevelFingerprint[],
    maxSize: safeSize,
  });
}

// ---------------------------------------------------------------------------
// addToArchive
// ---------------------------------------------------------------------------

/**
 * Add a fingerprint to the novelty archive, returning a **new** archive.
 *
 * The original archive is never mutated. If the archive is at {@link maxSize},
 * the oldest fingerprint is evicted (FIFO).
 *
 * @param archive     - The current archive (not mutated).
 * @param fingerprint - The fingerprint to add.
 * @returns A new {@link NoveltyArchive} with the fingerprint appended.
 *
 * @example
 * ```ts
 * let archive = createNoveltyArchive(5);
 * archive = addToArchive(archive, fp);
 * console.log(archive.fingerprints.length); // 1
 * ```
 */
export function addToArchive(
  archive: NoveltyArchive,
  fingerprint: LevelFingerprint,
): NoveltyArchive {
  try {
    const prev = archive?.fingerprints ?? [];
    const maxSize =
      archive?.maxSize && archive.maxSize > 0
        ? archive.maxSize
        : DEFAULT_ARCHIVE_MAX_SIZE;

    // FIFO eviction: if at capacity, remove oldest
    const next = prev.length >= maxSize ? prev.slice(1) : prev;

    return Object.freeze({
      version: 1,
      fingerprints: Object.freeze([...next, fingerprint]) as readonly LevelFingerprint[],
      maxSize,
    });
  } catch {
    // Graceful degradation
    return Object.freeze({
      version: 1,
      fingerprints: Object.freeze([]) as readonly LevelFingerprint[],
      maxSize: archive?.maxSize ?? DEFAULT_ARCHIVE_MAX_SIZE,
    });
  }
}

// ---------------------------------------------------------------------------
// Distance helpers
// ---------------------------------------------------------------------------

/**
 * Compute the Hamming distance between two height profiles, normalized to
 * `[0, 1]`.
 *
 * Shorter profiles are padded with `0` to match the longer one.
 */
function hammingDistance(a: readonly number[], b: readonly number[]): number {
  const len = Math.max(a.length, b.length);
  if (len === 0) return 0;

  let diffCount = 0;
  for (let i = 0; i < len; i++) {
    const av = i < a.length ? a[i] : 0;
    const bv = i < b.length ? b[i] : 0;
    // Count position as different if values differ
    if (av !== bv) diffCount++;
  }

  return diffCount / len;
}

/**
 * Compute the Jaccard distance between two motif histograms.
 *
 * Jaccard distance = 1 - |intersection| / |union| where the sets are the
 * keys present in each histogram. Distance in `[0, 1]`.
 */
function jaccardDistance(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): number {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length === 0 && keysB.length === 0) return 0;

  const setA = new Set(keysA);
  const setB = new Set(keysB);

  // Intersection size
  let intersection = 0;
  for (const k of setA) {
    if (setB.has(k)) intersection++;
  }

  // Union size
  const union = new Set([...setA, ...setB]).size;

  // Avoid division by zero
  if (union === 0) return 0;

  return 1 - intersection / union;
}

// ---------------------------------------------------------------------------
// fingerprintDistance
// ---------------------------------------------------------------------------

/**
 * Compute the distance between two fingerprints as a value in `[0, 1]`.
 *
 * Combines:
 * - Hamming distance on height profiles (50% weight).
 * - Jaccard distance on motif histograms (50% weight).
 *
 * A distance of `0` means identical fingerprints; `1` means maximally
 * different.
 */
function fingerprintDistance(
  a: LevelFingerprint,
  b: LevelFingerprint,
): number {
  const hpDist = hammingDistance(a.heightProfile, b.heightProfile);
  const motifDist = jaccardDistance(a.motifHistogram, b.motifHistogram);

  return hpDist * 0.5 + motifDist * 0.5;
}

// ---------------------------------------------------------------------------
// noveltyScore
// ---------------------------------------------------------------------------

/**
 * Compute the novelty score of a fingerprint against an archive.
 *
 * The score is the **distance to the closest (most similar)** entry in the
 * archive:
 * - Score `1` → completely novel (archive is empty or no entry is similar).
 * - Score `0` → identical to an existing entry.
 *
 * The distance is computed as a weighted combination of Hamming distance on
 * height profiles and Jaccard distance on motif histograms.
 *
 * **Determinism:** Same `(fingerprint, archive)` → same score, forever.
 * **Never throws.** Invalid inputs degrade gracefully to a score of `0`.
 *
 * @param fingerprint - The fingerprint to evaluate.
 * @param archive     - The archive of existing fingerprints.
 * @returns A novelty score in `[0, 1]`. Higher = more novel.
 *
 * @example
 * ```ts
 * const score = noveltyScore(newFp, archive);
 * if (score > 0.3) {
 *   console.log('Sufficiently novel level.');
 * }
 * ```
 */
export function noveltyScore(
  fingerprint: LevelFingerprint,
  archive: NoveltyArchive,
): number {
  try {
    const fps = archive?.fingerprints;
    if (!Array.isArray(fps) || fps.length === 0) return 1;

    // Distance to the closest (most similar) entry
    let minDistance = Infinity;
    for (const existing of fps) {
      if (!existing || typeof existing !== 'object') continue;
      const dist = fingerprintDistance(fingerprint, existing);
      if (dist < minDistance) minDistance = dist;
    }

    // Clamp to [0, 1]
    if (!Number.isFinite(minDistance)) return 1;
    return Math.max(0, Math.min(1, minDistance));
  } catch {
    return 1;
  }
}
