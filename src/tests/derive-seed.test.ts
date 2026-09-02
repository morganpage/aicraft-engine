import { describe, it, expect } from 'vitest';
import { deriveSeed } from '../rng/derive-seed';
import { deriveVisualSeed } from '../rng/visual-seed';
import { createRngState, advanceRng } from '../rng/state';

const ROOT_CORPUS: readonly number[] = [0, 1, 42, 12345, 0xffffffff, 0xdeadbeef, 20260902];

describe('deriveSeed', () => {
  it('is deterministic for identical arguments', () => {
    for (const root of ROOT_CORPUS) {
      expect(deriveSeed(root, 'battle', 3)).toBe(deriveSeed(root, 'battle', 3));
      expect(deriveSeed(root)).toBe(deriveSeed(root));
    }
  });
  it('returns an unsigned 32-bit integer', () => {
    for (const root of ROOT_CORPUS) {
      const seed = deriveSeed(root, 'encounter', 17, 'grass');
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });
  it('is order-sensitive: swapped parts derive different seeds', () => {
    for (const root of ROOT_CORPUS) {
      expect(deriveSeed(root, 'a', 'b')).not.toBe(deriveSeed(root, 'b', 'a'));
      expect(deriveSeed(root, 'x', 1)).not.toBe(deriveSeed(root, 1, 'x'));
    }
  });
  it('distinguishes a numeric part from its string image', () => {
    for (const root of ROOT_CORPUS) {
      expect(deriveSeed(root, 12345)).not.toBe(deriveSeed(root, '12345'));
    }
  });
  it('changes the address when any part is added or changed', () => {
    const base = deriveSeed(42, 'world');
    expect(deriveSeed(42, 'world', 0)).not.toBe(base);
    expect(deriveSeed(42, 'world', 1)).not.toBe(base);
    expect(deriveSeed(42, 'world', 0)).not.toBe(deriveSeed(42, 'world', 1));
  });
  it('varies with the root seed', () => {
    const addresses = new Set<number>();
    for (const root of ROOT_CORPUS) addresses.add(deriveSeed(root, 'same', 'parts'));
    expect(addresses.size).toBe(ROOT_CORPUS.length);
  });
  it('never aliases the visual seed derived from the same root and parts', () => {
    // Simulation streams and visual streams must be disjoint by construction;
    // a decorative animation seed can never coincide with a battle roll seed.
    for (const root of ROOT_CORPUS) {
      expect(deriveSeed(root, 'creature', 2)).not.toBe(deriveVisualSeed(root, 'creature', 2));
      expect(deriveSeed(root)).not.toBe(deriveVisualSeed(root));
    }
  });
  it('produces statistically distinct streams across derived addresses', () => {
    const firstDraws = new Set<number>();
    for (let i = 0; i < 64; i++) {
      const stream = createRngState(deriveSeed(777, 'species', i));
      firstDraws.add(advanceRng(stream).value);
    }
    expect(firstDraws.size).toBeGreaterThan(60);
  });
  it('accepts an empty part list as a stable root-derived address', () => {
    const seed = deriveSeed(2026);
    expect(seed).toBe(deriveSeed(2026));
    expect(Number.isInteger(seed)).toBe(true);
  });
});
