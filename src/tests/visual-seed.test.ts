import { describe, expect, it } from 'vitest';
import {
  deriveVisualSeed,
  finalizeSeed,
  mixChannel,
  mixNumber,
  visualChannel,
  type VisualSeedPart,
} from '../rng/visual-seed';

function folded(root: number, parts: readonly VisualSeedPart[]): number {
  let seed = root;
  for (const part of parts) {
    seed = typeof part === 'string'
      ? mixChannel(seed, visualChannel(part))
      : mixNumber(seed, part);
  }
  return finalizeSeed(seed);
}

describe('visual seed addressing', () => {
  it('is stable, unsigned, and sensitive to each address component', () => {
    const seed = deriveVisualSeed(42, 'tile', 'stone', 3, 7, 1);
    expect(seed).toBe(deriveVisualSeed(42, 'tile', 'stone', 3, 7, 1));
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
    expect(seed).not.toBe(deriveVisualSeed(43, 'tile', 'stone', 3, 7, 1));
    expect(seed).not.toBe(deriveVisualSeed(42, 'tile', 'stone', 4, 7, 1));
  });

  it('type-tags string-derived and numeric components', () => {
    expect(deriveVisualSeed(9, '1')).not.toBe(deriveVisualSeed(9, 1));
    const foo = visualChannel('foo');
    expect(deriveVisualSeed(9, 'foo')).not.toBe(deriveVisualSeed(9, foo));
    for (const value of [-2, -1, 0, 1, 2, 0x7fffffff]) {
      expect(mixChannel(123, value)).not.toBe(mixNumber(123, value));
    }
  });

  it('matches the explicit fold across mixed arities', () => {
    const matrix: readonly (readonly VisualSeedPart[])[] = [
      ['tile', 1, 2],
      ['tile', 'stone', 1, 2],
      ['entity', 4, 'metal', 2, 8],
      ['effect', 7, 'spark', 120, 2, 9],
      ['layer', 'far', 0, 1, 2, 3, 4],
      ['tile', 'stone', 1, 2, 3, 4, 5, 6],
    ];
    for (const parts of matrix) {
      expect(deriveVisualSeed(98724, ...parts)).toBe(folded(98724, parts));
    }
  });

  it('normalizes non-finite numbers deterministically', () => {
    expect(deriveVisualSeed(1, Number.NaN)).toBe(deriveVisualSeed(1, 0));
    expect(deriveVisualSeed(1, Infinity)).toBe(deriveVisualSeed(1, 0));
    expect(deriveVisualSeed(1, -Infinity)).toBe(deriveVisualSeed(1, 0));
  });

  it('supports hoisting a partial address without changing results', () => {
    const channel = visualChannel('tile');
    const material = visualChannel('cave');
    const prefix = mixChannel(mixChannel(42, channel), material);
    const hoisted = finalizeSeed(mixNumber(mixNumber(prefix, 10), 4));

    let inline = mixChannel(42, channel);
    inline = mixChannel(inline, material);
    inline = mixNumber(inline, 10);
    inline = mixNumber(inline, 4);
    expect(hoisted).toBe(finalizeSeed(inline));
  });

  it('is independent of unrelated draw order', () => {
    const target = deriveVisualSeed(42, 'tile', 8, 3);
    const before = [
      deriveVisualSeed(42, 'tile', 1, 1),
      target,
      deriveVisualSeed(42, 'tile', 9, 5),
    ];
    const after = [
      deriveVisualSeed(42, 'tile', 9, 5),
      deriveVisualSeed(42, 'tile', 1, 1),
      target,
    ];
    expect(before[1]).toBe(after[2]);
    expect(visualChannel('terrain')).toBe(visualChannel('terrain'));
  });
});
