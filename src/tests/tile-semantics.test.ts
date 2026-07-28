/**
 * Tests for tile-semantics module — canonical generated-tile classification.
 *
 * The contract is defined in `src/level/tile-semantics.ts` and mirrors
 * `docs/design/level-generation-quality-implementation-plan.md` §5.1.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import { createTileTypeMap } from '../level';

describe('createTileTypeMap', () => {
  it('classifies solid values as "solid"', () => {
    const map = createTileTypeMap({ solid: [1], passthrough: [2] });
    expect(map(1)).toBe('solid');
  });

  it('classifies passthrough values as "passthrough"', () => {
    const map = createTileTypeMap({ solid: [1], passthrough: [2] });
    expect(map(2)).toBe('passthrough');
  });

  it('classifies other integers (not in solid or passthrough) as "empty"', () => {
    const map = createTileTypeMap({ solid: [1], passthrough: [2] });
    expect(map(0)).toBe('empty');
    expect(map(3)).toBe('empty');
    expect(map(42)).toBe('empty');
    expect(map(-1)).toBe('empty');
  });

  it('classifies non-integer values as "empty"', () => {
    const map = createTileTypeMap({ solid: [1], passthrough: [2] });
    expect(map(1.5)).toBe('empty');
    expect(map(NaN)).toBe('empty');
  });

  it('classifies non-finite values as "empty"', () => {
    const map = createTileTypeMap({ solid: [1], passthrough: [2] });
    expect(map(Infinity)).toBe('empty');
    expect(map(-Infinity)).toBe('empty');
  });

  it('classifies non-number values as "empty"', () => {
    const map = createTileTypeMap({ solid: [1], passthrough: [2] });
    // These should not happen in practice but the function must not throw.
    expect(map(undefined as unknown as number)).toBe('empty');
    expect(map(null as unknown as number)).toBe('empty');
    expect(map('1' as unknown as number)).toBe('empty');
    expect(map({} as unknown as number)).toBe('empty');
  });

  it('handles empty semantics (no solid or passthrough values)', () => {
    const map = createTileTypeMap({ solid: [], passthrough: [] });
    expect(map(0)).toBe('empty');
    expect(map(1)).toBe('empty');
    expect(map(42)).toBe('empty');
  });

  it('handles missing/undefined semantics gracefully', () => {
    const map = createTileTypeMap(undefined as unknown as { solid: number[]; passthrough: number[] });
    expect(map(0)).toBe('empty');
    expect(map(1)).toBe('empty');
    expect(map(42)).toBe('empty');
  });

  it('handles null semantics gracefully', () => {
    const map = createTileTypeMap(null as unknown as { solid: number[]; passthrough: number[] });
    expect(map(0)).toBe('empty');
    expect(map(1)).toBe('empty');
  });

  it('handles semantics with non-array solid/passthrough fields gracefully', () => {
    const map = createTileTypeMap({ solid: 'bad' as unknown as number[], passthrough: null as unknown as number[] });
    expect(map(0)).toBe('empty');
    expect(map(1)).toBe('empty');
  });

  it('filters non-integer values from solid/passthrough sets', () => {
    const map = createTileTypeMap({ solid: [1, 2, 3.5, NaN, Infinity], passthrough: [4, '5' as unknown as number] });
    // 3.5, NaN, Infinity are not valid integers, so they won't be in the solid set
    expect(map(1)).toBe('solid');
    expect(map(2)).toBe('solid');
    expect(map(3.5)).toBe('empty'); // non-integer, classified as 'empty' by the classifier
    expect(map(3)).toBe('empty'); // 3 is not in the solid array at all
    expect(map(4)).toBe('passthrough');
    expect(map(5)).toBe('empty'); // '5' is string, filtered out; 5 as number isn't in passthrough
  });

  it('solid takes priority when a value appears in both lists', () => {
    // The contract says solid and passthrough are non-overlapping, but if they
    // overlap, solid wins (since solidSet is checked first).
    const map = createTileTypeMap({ solid: [1, 2], passthrough: [2, 3] });
    expect(map(1)).toBe('solid');
    expect(map(2)).toBe('solid'); // solid wins
    expect(map(3)).toBe('passthrough');
  });

  it('produces a pure function (multiple calls with same value return same result)', () => {
    const map = createTileTypeMap({ solid: [5, 10], passthrough: [7] });
    expect(map(5)).toBe('solid');
    expect(map(5)).toBe('solid');
    expect(map(7)).toBe('passthrough');
    expect(map(7)).toBe('passthrough');
    expect(map(0)).toBe('empty');
    expect(map(0)).toBe('empty');
  });

  it('never throws on any input', () => {
    // The function should never throw, even for absurd values.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const map = createTileTypeMap({ solid: [1], passthrough: [2] });
    const testValues: unknown[] = [
      undefined,
      null,
      NaN,
      Infinity,
      -Infinity,
      0,
      1,
      999,
      -1,
      1.5,
      'hello',
      {},
      [],
      Symbol('test'),
      true,
      false,
    ];
    for (const v of testValues) {
      expect(() => map(v as number)).not.toThrow();
    }
  });
});
