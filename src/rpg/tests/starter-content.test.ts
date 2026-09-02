import { describe, it, expect } from 'vitest';
import { compileRpgContent } from '../content';
import { createStarterContentBundle } from '../starter';
import { deriveCreatureStats } from '../creatures';
import { RPG_LEVEL_CAP } from '../constants';

/**
 * Milestone 2 exit gate: six generated species and all starter content
 * compile with zero error diagnostics — across a seed corpus, not one seed.
 */
const SEEDS: readonly number[] = [1, 7, 42, 99, 2026, 65535];

describe('starter content bundle', () => {
  it('compiles with zero error diagnostics for every tested seed', () => {
    for (const seed of SEEDS) {
      const result = compileRpgContent(createStarterContentBundle(seed));
      const errors = result.ok ? result.diagnostics.filter((d) => d.severity === 'error') : result.diagnostics;
      expect(errors).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it('is deterministic per seed and varies across seeds', () => {
    const a = JSON.stringify(createStarterContentBundle(42));
    const b = JSON.stringify(createStarterContentBundle(42));
    expect(a).toBe(b);
    const fingerprintOf = (seed: number): string | undefined => {
      const result = compileRpgContent(createStarterContentBundle(seed));
      return result.ok ? result.content.fingerprint : undefined;
    };
    const fingerprints = new Set(SEEDS.map((seed) => fingerprintOf(seed)));
    expect(fingerprints.size).toBe(SEEDS.length);
  });

  it('matches the locked content budget exactly', () => {
    const bundle = createStarterContentBundle(42);
    expect(bundle.types.length).toBe(4);
    expect(bundle.moves.length).toBe(8);
    expect(bundle.species.length).toBe(6);
    expect(bundle.items.length).toBe(2);
    expect(bundle.encounters.length).toBe(1);
    expect(bundle.dialogues.length).toBe(1);
    expect(bundle.maps.length).toBe(2);
    const basic = bundle.moves.filter((move) => move.power === 6);
    const strong = bundle.moves.filter((move) => move.power === 10);
    expect(basic.length).toBe(4);
    expect(strong.length).toBe(4);
    for (const move of basic) expect(move.accuracyBasisPoints).toBe(10000);
    for (const move of strong) expect(move.accuracyBasisPoints).toBe(9000);
  });

  it('keeps wild encounter levels within the 3–5 starter range', () => {
    const bundle = createStarterContentBundle(42);
    for (const entry of bundle.encounters[0].entries) {
      expect(entry.minLevel).toBe(3);
      expect(entry.maxLevel).toBe(5);
      expect(entry.weight).toBeGreaterThan(0);
    }
  });

  it('keeps starter battles mathematically sane under the envelope', () => {
    const bundle = createStarterContentBundle(42);
    const compiled = compileRpgContent(bundle);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    for (const def of Object.values(compiled.content.species)) {
      const wild = deriveCreatureStats(def.baseStats, 5);
      const starter = deriveCreatureStats(
        Object.values(compiled.content.species)[0].baseStats,
        4,
      );
      expect(wild.hp).toBeLessThanOrEqual(16 + 3 * RPG_LEVEL_CAP);
      expect(starter.attack).toBeGreaterThan(0);
      expect(wild.speed).toBeGreaterThan(0);
    }
  });
});
