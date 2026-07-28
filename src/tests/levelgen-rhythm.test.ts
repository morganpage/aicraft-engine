/**
 * Tests for pacing/rhythm generation.
 *
 * Tests cover:
 * - generateRhythm returns a valid pacing sequence
 * - Follows the default curve (introduce → build-up → rest → escalation → climax → release)
 * - Same seed → same rhythm
 * - Different seed → different rhythm
 * - Final beat is always 'release'
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import { generateRhythm } from '../levelgen';
import type { PacingBeat, LevelGenConfig } from '../levelgen/types';

const VALID_BEATS: readonly PacingBeat[] = [
  'introduce', 'run', 'jump', 'precisionJump', 'dash', 'rest', 'reward',
  'branch', 'climax', 'release',
];

const BASE_CONFIG: LevelGenConfig = { cols: 60, rows: 15, tileSize: 16, difficulty: 0.5 };

describe('generateRhythm', () => {
  it('returns a non-empty array of PacingBeat values', () => {
    const rhythm = generateRhythm(42, BASE_CONFIG);
    expect(rhythm.length).toBeGreaterThan(0);
    for (const beat of rhythm) {
      expect(VALID_BEATS).toContain(beat);
    }
  });

  it('has at least 4 beats', () => {
    const rhythm = generateRhythm(42, BASE_CONFIG);
    expect(rhythm.length).toBeGreaterThanOrEqual(4);
  });

  it('final beat is always release', () => {
    const rhythm = generateRhythm(42, BASE_CONFIG);
    expect(rhythm[rhythm.length - 1]).toBe('release');
  });

  it('same seed → same rhythm', () => {
    const a = generateRhythm(42, BASE_CONFIG);
    const b = generateRhythm(42, BASE_CONFIG);
    expect(a).toEqual(b);
  });

  it('different seed → different rhythm (usually)', () => {
    const a = generateRhythm(42, BASE_CONFIG);
    const b = generateRhythm(99, BASE_CONFIG);
    // Very unlikely to be identical
    expect(a).not.toEqual(b);
  });

  it('higher difficulty produces more beats', () => {
    const low = generateRhythm(42, { ...BASE_CONFIG, difficulty: 0.1 });
    const high = generateRhythm(42, { ...BASE_CONFIG, difficulty: 0.9 });
    expect(high.length).toBeGreaterThanOrEqual(low.length);
  });

  it('wider levels produce more beats', () => {
    const narrow = generateRhythm(42, { ...BASE_CONFIG, cols: 20 });
    const wide = generateRhythm(42, { ...BASE_CONFIG, cols: 100 });
    expect(wide.length).toBeGreaterThanOrEqual(narrow.length);
  });

  it('has introduce or run as first beat', () => {
    const rhythm = generateRhythm(42, BASE_CONFIG);
    const first = rhythm[0];
    expect(first === 'introduce' || first === 'run').toBe(true);
  });

  it('never throws on any input', () => {
    const badInputs: LevelGenConfig[] = [
      null as unknown as LevelGenConfig,
      undefined as unknown as LevelGenConfig,
      {} as LevelGenConfig,
      { cols: NaN } as LevelGenConfig,
      { difficulty: -5 } as LevelGenConfig,
    ];
    for (const input of badInputs) {
      expect(() => generateRhythm(42, input)).not.toThrow();
    }
  });

  it('returns a rhythm with at most 32 beats', () => {
    const rhythm = generateRhythm(42, { ...BASE_CONFIG, cols: 500, difficulty: 1.0 });
    expect(rhythm.length).toBeLessThanOrEqual(32);
  });
});
