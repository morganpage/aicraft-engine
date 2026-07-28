/**
 * Tests for the motif catalog.
 *
 * Tests cover:
 * - MOTIF_CATALOG has all 11 initial motifs
 * - Each motif has required fields (id, compatibleBeats, requiredMechanics,
 *   intensityRange, minSafetyMargin)
 * - findMotif works
 * - findCompatibleMotifs works
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import { MOTIF_CATALOG, findMotif, findCompatibleMotifs } from '../levelgen';

describe('MOTIF_CATALOG', () => {
  it('has exactly 11 initial motifs', () => {
    expect(MOTIF_CATALOG).toHaveLength(11);
  });

  it('contains all expected motif ids', () => {
    const ids = MOTIF_CATALOG.map((m) => m.id).sort();
    expect(ids).toEqual([
      'drop-with-recovery',
      'hazard-corridor',
      'key-detour',
      'moving-platform-transfer',
      'optional-risky-collectible',
      'pre-exit-climax',
      'safe-intro-jump',
      'short-gap-series',
      'stair-ascent',
      'stair-descent',
      'wide-landing-after-hard-jump',
    ]);
  });

  it('every motif has a non-empty id', () => {
    for (const motif of MOTIF_CATALOG) {
      expect(typeof motif.id).toBe('string');
      expect(motif.id.length).toBeGreaterThan(0);
    }
  });

  it('every motif has a compatibleBeats array', () => {
    for (const motif of MOTIF_CATALOG) {
      expect(Array.isArray(motif.compatibleBeats)).toBe(true);
      expect(motif.compatibleBeats.length).toBeGreaterThan(0);
    }
  });

  it('every motif has a requiredMechanics array', () => {
    for (const motif of MOTIF_CATALOG) {
      expect(Array.isArray(motif.requiredMechanics)).toBe(true);
    }
  });

  it('every motif has an intensityRange with min ≤ max', () => {
    for (const motif of MOTIF_CATALOG) {
      expect(motif.intensityRange).toHaveLength(2);
      expect(motif.intensityRange[0]).toBeLessThanOrEqual(motif.intensityRange[1]);
      expect(motif.intensityRange[0]).toBeGreaterThanOrEqual(0);
      expect(motif.intensityRange[1]).toBeLessThanOrEqual(1);
    }
  });

  it('every motif has a finite minSafetyMargin', () => {
    for (const motif of MOTIF_CATALOG) {
      expect(typeof motif.minSafetyMargin).toBe('number');
      expect(Number.isFinite(motif.minSafetyMargin)).toBe(true);
      expect(motif.minSafetyMargin).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('findMotif', () => {
  it('returns the correct motif by id', () => {
    const motif = findMotif('safe-intro-jump');
    expect(motif).toBeDefined();
    expect(motif!.id).toBe('safe-intro-jump');
    expect(motif!.compatibleBeats).toContain('introduce');
  });

  it('returns undefined for unknown id', () => {
    expect(findMotif('nonexistent-motif')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(findMotif('')).toBeUndefined();
  });
});

describe('findCompatibleMotifs', () => {
  it('returns motifs compatible with a beat', () => {
    const motifs = findCompatibleMotifs('introduce', 0.1);
    expect(motifs.length).toBeGreaterThan(0);
    for (const m of motifs) {
      expect(m.compatibleBeats).toContain('introduce');
      expect(m.intensityRange[0]).toBeLessThanOrEqual(0.1);
      expect(m.intensityRange[1]).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('returns motifs compatible with climax beat at high intensity', () => {
    const motifs = findCompatibleMotifs('climax', 0.8);
    expect(motifs.length).toBeGreaterThan(0);
    for (const m of motifs) {
      expect(m.compatibleBeats).toContain('climax');
    }
  });

  it('returns empty array for unmatched intensity', () => {
    const motifs = findCompatibleMotifs('introduce', 0.9);
    // 'introduce' beats have intensity range [0.0, 0.35]
    expect(motifs.length).toBe(0);
  });

  it('returns empty array for unknown beat', () => {
    const motifs = findCompatibleMotifs('nonexistent' as any, 0.5);
    expect(motifs.length).toBe(0);
  });

  it('is pure (same input → same output)', () => {
    const a = findCompatibleMotifs('jump', 0.4);
    const b = findCompatibleMotifs('jump', 0.4);
    expect(a).toEqual(b);
  });
});
