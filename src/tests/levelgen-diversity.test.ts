/**
 * Tests for the level generation diversity/novelty tracking module.
 *
 * Coverage:
 * - computeLevelFingerprint returns a valid LevelFingerprint
 * - Same level + seed → same fingerprint (determinism)
 * - Different level → different fingerprint
 * - createNoveltyArchive returns empty archive with default maxSize
 * - addToArchive appends fingerprint and returns new archive
 * - addToArchive respects maxSize (FIFO eviction)
 * - noveltyScore returns 0 for identical fingerprint added to archive
 * - noveltyScore returns higher value for different fingerprint
 * - noveltyScore is 1 for empty archive
 * - Non-finite inputs → never throws
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import {
  computeLevelFingerprint,
  createNoveltyArchive,
  addToArchive,
  noveltyScore,
} from '../levelgen/diversity';
import type { LevelFingerprint } from '../levelgen/diversity';
import type { LevelData } from '../level/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal LevelData for fingerprint testing.
 */
function makeLevel(overrides?: Partial<LevelData>): LevelData {
  return {
    version: 1,
    id: 'test-level',
    name: 'Test Level',
    width: 960,
    height: 540,
    tileSize: 16,
    spawn: { x: 32, y: 32 },
    tiles: {
      data: new Array(60 * 34).fill(0),
      cols: 60,
      rows: 34,
      tileSize: 16,
    },
    entities: [
      { id: 1, kind: 'spawn', rect: { x: 32, y: 32, width: 16, height: 24 }, props: {} },
      { id: 2, kind: 'exit', rect: { x: 800, y: 400, width: 32, height: 48 }, props: { isTrap: false, locked: false } },
      { id: 3, kind: 'platform', rect: { x: 0, y: 500, width: 200, height: 16 }, props: {} },
      { id: 4, kind: 'collectible', rect: { x: 400, y: 300, width: 16, height: 16 }, props: { kind: 'coin' as const, value: 1 } },
    ],
    nextEntityId: 5,
    ...overrides,
  };
}

/**
 * Create a level with different layout (hazards, more platforms).
 */
function makeDifferentLevel(): LevelData {
  const tiles = new Array(60 * 34).fill(0);
  // Add some solid tiles in the bottom row
  for (let x = 0; x < 60; x++) {
    tiles[33 * 60 + x] = 1;
  }
  return {
    version: 1,
    id: 'different-level',
    name: 'Different Level',
    width: 960,
    height: 540,
    tileSize: 16,
    spawn: { x: 64, y: 64 },
    tiles: {
      data: tiles,
      cols: 60,
      rows: 34,
      tileSize: 16,
    },
    entities: [
      { id: 1, kind: 'spawn', rect: { x: 64, y: 64, width: 16, height: 24 }, props: {} },
      { id: 2, kind: 'exit', rect: { x: 700, y: 350, width: 32, height: 48 }, props: { isTrap: false, locked: false } },
      { id: 3, kind: 'platform', rect: { x: 100, y: 200, width: 150, height: 16 }, props: {} },
      { id: 4, kind: 'platform', rect: { x: 300, y: 150, width: 150, height: 16 }, props: {} },
      { id: 5, kind: 'hazard', rect: { x: 500, y: 400, width: 32, height: 32 }, props: {} },
      { id: 6, kind: 'trap', rect: { x: 600, y: 300, width: 32, height: 16 }, props: { type: 'spikes', params: {} } },
      { id: 7, kind: 'enemy', rect: { x: 400, y: 100, width: 24, height: 24 }, props: { archetype: 'spinny', params: {} } },
      { id: 8, kind: 'collectible', rect: { x: 200, y: 100, width: 16, height: 16 }, props: { kind: 'gem' as const, value: 5 } },
      { id: 9, kind: 'collectible', rect: { x: 500, y: 80, width: 16, height: 16 }, props: { kind: 'key' as const, value: 0 } },
    ],
    nextEntityId: 10,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeLevelFingerprint', () => {
  it('returns a valid LevelFingerprint with version 1', () => {
    const level = makeLevel();
    const fp = computeLevelFingerprint(level, 42);

    expect(fp).toBeDefined();
    expect(fp.version).toBe(1);
    expect(typeof fp.seed).toBe('number');
    expect(typeof fp.hash).toBe('number');
    expect(typeof fp.entityCount).toBe('number');
    expect(typeof fp.tileCount).toBe('number');
    expect(typeof fp.motifHistogram).toBe('object');
    expect(Array.isArray(fp.heightProfile)).toBe(true);
  });

  it('produces same output for same level + seed (determinism)', () => {
    const level = makeLevel();
    const a = computeLevelFingerprint(level, 42);
    const b = computeLevelFingerprint(level, 42);

    expect(a).toEqual(b);
  });

  it('produces different hash for different level', () => {
    const levelA = makeLevel();
    const levelB = makeDifferentLevel();
    const fpA = computeLevelFingerprint(levelA, 42);
    const fpB = computeLevelFingerprint(levelB, 42);

    expect(fpA.hash).not.toBe(fpB.hash);
  });

  it('produces different fingerprint for different seed', () => {
    const level = makeLevel();
    const fpA = computeLevelFingerprint(level, 1);
    const fpB = computeLevelFingerprint(level, 2);

    // Seed is part of the fingerprint, so they should differ
    expect(fpA.seed).not.toBe(fpB.seed);
    // Hash is from level data (not seed), so it's the same
    expect(fpA.hash).toBe(fpB.hash);
    // Full fingerprints differ due to seed
    expect(fpA).not.toEqual(fpB);
  });

  it('counts entity kinds correctly in motifHistogram', () => {
    const level = makeLevel();
    const fp = computeLevelFingerprint(level, 42);

    expect(fp.motifHistogram['spawn']).toBe(1);
    expect(fp.motifHistogram['exit']).toBe(1);
    expect(fp.motifHistogram['platform']).toBe(1);
    expect(fp.motifHistogram['collectible']).toBe(1);
  });

  it('counts non-empty tiles in tileCount', () => {
    const level = makeLevel();
    // Add some solid tiles
    const tiles = [...level.tiles.data];
    tiles[0] = 1;
    tiles[1] = 1;
    tiles[2] = 1;
    const levelWithTiles: LevelData = {
      ...level,
      tiles: { ...level.tiles, data: tiles },
    };
    const fp = computeLevelFingerprint(levelWithTiles, 42);

    expect(fp.tileCount).toBe(3);
  });

  it('counts entities in entityCount', () => {
    const level = makeLevel();
    const fp = computeLevelFingerprint(level, 42);

    expect(fp.entityCount).toBe(4);
  });

  it('returns a heightProfile array of reasonable length', () => {
    const level = makeLevel(); // 60 cols
    const fp = computeLevelFingerprint(level, 42);

    // 60 cols / 10 interval = 6 samples + possibly 1 more for remainder
    expect(fp.heightProfile.length).toBeGreaterThanOrEqual(5);
    expect(fp.heightProfile.length).toBeLessThanOrEqual(61);
  });

  it('never throws on null or undefined level', () => {
    // @ts-expect-error — testing invalid input
    expect(() => computeLevelFingerprint(null, 42)).not.toThrow();
    // @ts-expect-error — testing invalid input
    expect(() => computeLevelFingerprint(undefined, 42)).not.toThrow();
  });

  it('never throws on non-finite seed', () => {
    const level = makeLevel();
    expect(() => computeLevelFingerprint(level, NaN)).not.toThrow();
    expect(() => computeLevelFingerprint(level, Infinity)).not.toThrow();
    expect(() => computeLevelFingerprint(level, -Infinity)).not.toThrow();
  });

  it('handles level with no entities gracefully', () => {
    const level = makeLevel({ entities: [] });
    const fp = computeLevelFingerprint(level, 42);

    expect(fp.entityCount).toBe(0);
    expect(Object.keys(fp.motifHistogram).length).toBe(0);
    expect(Number.isFinite(fp.hash)).toBe(true);
  });

  it('handles level with no tiles gracefully', () => {
    const level = makeLevel({
      tiles: { data: [], cols: 0, rows: 0, tileSize: 16 },
    });
    const fp = computeLevelFingerprint(level, 42);

    expect(fp.tileCount).toBe(0);
    expect(fp.heightProfile.length).toBe(0);
    expect(Number.isFinite(fp.hash)).toBe(true);
  });
});

describe('createNoveltyArchive', () => {
  it('returns an empty novelty archive with default maxSize', () => {
    const archive = createNoveltyArchive();

    expect(archive).toBeDefined();
    expect(archive.version).toBe(1);
    expect(archive.fingerprints).toEqual([]);
    expect(archive.maxSize).toBeGreaterThan(0);
  });

  it('returns an archive with the specified maxSize', () => {
    const archive = createNoveltyArchive(10);

    expect(archive.maxSize).toBe(10);
  });

  it('returns a frozen/immutable archive', () => {
    const archive = createNoveltyArchive();

    expect(Object.isFrozen(archive)).toBe(true);
    expect(Object.isFrozen(archive.fingerprints)).toBe(true);
  });
});

describe('addToArchive', () => {
  it('appends a fingerprint to the archive and returns a new archive', () => {
    const archive = createNoveltyArchive(10);
    const level = makeLevel();
    const fp = computeLevelFingerprint(level, 42);

    const next = addToArchive(archive, fp);

    // Original unchanged
    expect(archive.fingerprints.length).toBe(0);

    // New archive has the fingerprint
    expect(next.fingerprints.length).toBe(1);
    expect(next.fingerprints[0]).toBe(fp);
  });

  it('does not mutate the input archive', () => {
    const archive = createNoveltyArchive(10);
    const fp = computeLevelFingerprint(makeLevel(), 42);
    const originalFingerprints = archive.fingerprints;

    addToArchive(archive, fp);

    expect(archive.fingerprints).toBe(originalFingerprints);
    expect(archive.fingerprints.length).toBe(0);
  });

  it('FIFO evicts oldest fingerprint when at maxSize', () => {
    const archive = createNoveltyArchive(3);

    // Add 3 fingerprints
    const fp1: LevelFingerprint = {
      version: 1, seed: 1, hash: 100, motifHistogram: { spawn: 1 }, heightProfile: [1], entityCount: 1, tileCount: 0,
    };
    const fp2: LevelFingerprint = {
      version: 1, seed: 2, hash: 200, motifHistogram: { spawn: 1 }, heightProfile: [2], entityCount: 1, tileCount: 0,
    };
    const fp3: LevelFingerprint = {
      version: 1, seed: 3, hash: 300, motifHistogram: { spawn: 1 }, heightProfile: [3], entityCount: 1, tileCount: 0,
    };
    const fp4: LevelFingerprint = {
      version: 1, seed: 4, hash: 400, motifHistogram: { spawn: 1 }, heightProfile: [4], entityCount: 1, tileCount: 0,
    };

    const a1 = addToArchive(archive, fp1);
    const a2 = addToArchive(a1, fp2);
    const a3 = addToArchive(a2, fp3);

    expect(a3.fingerprints.length).toBe(3);

    // Add 4th — should evict fp1 (oldest)
    const a4 = addToArchive(a3, fp4);

    expect(a4.fingerprints.length).toBe(3);
    expect(a4.fingerprints[0]).toBe(fp2); // fp1 evicted
    expect(a4.fingerprints[1]).toBe(fp3);
    expect(a4.fingerprints[2]).toBe(fp4);
  });

  it('preserves archive when adding to an empty archive', () => {
    const archive = createNoveltyArchive(5);
    const fp = computeLevelFingerprint(makeLevel(), 99);

    const next = addToArchive(archive, fp);

    expect(next.maxSize).toBe(5);
    expect(next.fingerprints.length).toBe(1);
  });
});

describe('noveltyScore', () => {
  it('returns 1 for an empty archive (fully novel)', () => {
    const level = makeLevel();
    const fp = computeLevelFingerprint(level, 42);
    const archive = createNoveltyArchive();

    const score = noveltyScore(fp, archive);

    expect(score).toBe(1);
  });

  it('returns a low score for a fingerprint identical to one in archive', () => {
    const level = makeLevel();
    const seed = 42;
    const fp = computeLevelFingerprint(level, seed);
    const archive = createNoveltyArchive();
    const seededArchive = addToArchive(archive, fp);

    const score = noveltyScore(fp, seededArchive);

    // Should be close to 0 (very similar, since it's identical)
    expect(score).toBeLessThan(0.01);
  });

  it('returns a higher score for a fingerprint different from archive entries', () => {
    const seed = 42;
    const levelA = makeLevel();
    const levelB = makeDifferentLevel();

    const fpA = computeLevelFingerprint(levelA, seed);
    const fpB = computeLevelFingerprint(levelB, seed);

    const archive = createNoveltyArchive();
    const seededArchive = addToArchive(archive, fpA);

    const score = noveltyScore(fpB, seededArchive);

    // Different levels should have non-zero novelty
    expect(score).toBeGreaterThan(0);
  });

  it('returns a score in [0, 1]', () => {
    const seed = 42;
    const levelA = makeLevel();
    const levelB = makeDifferentLevel();

    const fpA = computeLevelFingerprint(levelA, seed);
    const fpB = computeLevelFingerprint(levelB, seed);

    const archive = createNoveltyArchive();
    const seededArchive = addToArchive(archive, fpA);

    const score = noveltyScore(fpB, seededArchive);

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('compares against all entries and returns the distance to the closest', () => {
    // Create archive with two fingerprints
    const fp1: LevelFingerprint = {
      version: 1, seed: 1, hash: 100, motifHistogram: { spawn: 1 }, heightProfile: [10], entityCount: 1, tileCount: 0,
    };
    const fp2: LevelFingerprint = {
      version: 1, seed: 2, hash: 200, motifHistogram: { spawn: 1, exit: 1 }, heightProfile: [5], entityCount: 2, tileCount: 0,
    };

    // Test fingerprint more similar to fp1 than fp2
    const testFp: LevelFingerprint = {
      version: 1, seed: 3, hash: 300, motifHistogram: { spawn: 1 }, heightProfile: [10], entityCount: 1, tileCount: 0,
    };

    const archive = createNoveltyArchive();
    const a1 = addToArchive(archive, fp1);
    const a2 = addToArchive(a1, fp2);

    const score = noveltyScore(testFp, a2);

    // Should be small (close to fp1 which is nearly identical)
    expect(score).toBeLessThan(0.1);
  });

  it('never throws on null or undefined inputs', () => {
    const archive = createNoveltyArchive();
    const fp = computeLevelFingerprint(makeLevel(), 42);

    // @ts-expect-error — testing invalid input
    expect(() => noveltyScore(null, archive)).not.toThrow();
    // @ts-expect-error — testing invalid input
    expect(() => noveltyScore(fp, null)).not.toThrow();
    // @ts-expect-error — testing invalid input
    expect(() => noveltyScore(undefined, undefined)).not.toThrow();
  });
});
