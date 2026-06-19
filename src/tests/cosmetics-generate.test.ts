import { describe, it, expect } from 'vitest';
import { generateSkinVariants } from '../cosmetics/generate';
import type { SkinPreset } from '../cosmetics/types';

const HEX = /^#[0-9a-fA-F]{6}$/;

function baseSkin(id = 'devil', scale = 1): SkinPreset {
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    rarity: 'rare',
    scale,
    palette: {
      outline: '#1d1128',
      base: '#ff4a4a',
      accent: '#ffb300',
      feature: '#00ffff',
      background: '#f0e6d3',
    },
  };
}

function isValidPalette(p: SkinPreset['palette']): boolean {
  return [p.outline, p.base, p.accent, p.feature, p.background].every((s) =>
    HEX.test(s),
  );
}

describe('generateSkinVariants — determinism', () => {
  it('is seed-stable: same (seed, base, count) yields bit-identical variants', () => {
    const a = generateSkinVariants(42, baseSkin(), 5);
    const b = generateSkinVariants(42, baseSkin(), 5);
    expect(a).toEqual(b);
  });

  it('produces exactly `count` variants', () => {
    expect(generateSkinVariants(7, baseSkin(), 3).length).toBe(3);
    expect(generateSkinVariants(7, baseSkin(), 8).length).toBe(8);
  });

  it('returns an empty array for count <= 0', () => {
    expect(generateSkinVariants(7, baseSkin(), 0)).toEqual([]);
    expect(generateSkinVariants(7, baseSkin(), -3)).toEqual([]);
  });

  it('produces a valid 5-slot #rrggbb palette for every variant', () => {
    const variants = generateSkinVariants(99, baseSkin(), 6);
    expect(variants.every((v) => isValidPalette(v.palette))).toBe(true);
  });

  it('produces unique signatures across the batch (no duplicate palette+scale)', () => {
    const variants = generateSkinVariants(123, baseSkin(), 10);
    const sigs = variants.map(
      (v) =>
        `${v.palette.outline}|${v.palette.base}|${v.palette.accent}|${v.palette.feature}|${v.palette.background}|${v.scale}`,
    );
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it('produces unique variant ids across the batch', () => {
    const variants = generateSkinVariants(123, baseSkin(), 10);
    const ids = variants.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('variant ids follow the content-hash format', () => {
    const variants = generateSkinVariants(42, baseSkin(), 3);
    for (let i = 0; i < variants.length; i++) {
      // ${baseId}-var-${i}-${seed}-${hash}
      expect(variants[i].id).toMatch(/^devil-var-\d+-42-[a-z0-9]+$/);
    }
  });

  it('inherits rarity and a derived name from the base skin', () => {
    const variants = generateSkinVariants(5, baseSkin('imp'), 2);
    expect(variants[0].rarity).toBe('rare');
    expect(variants[0].name).toBe('Imp Variant 1');
    expect(variants[1].name).toBe('Imp Variant 2');
  });
});

describe('generateSkinVariants — cross-base-skin variant-id collision fix', () => {
  it('two different base skins with the same seed produce DISTINCT variant ids', () => {
    const skinA = baseSkin('devil', 1);
    const skinB: SkinPreset = {
      id: 'devil',
      name: 'Devil',
      rarity: 'rare',
      scale: 1,
      palette: {
        outline: '#000000',
        base: '#00ff00',
        accent: '#ff00ff',
        feature: '#ffff00',
        background: '#cccccc',
      },
    };
    const a = generateSkinVariants(42, skinA, 3);
    const b = generateSkinVariants(42, skinB, 3);
    // Same base id + same seed — only the content hash differentiates the ids.
    for (let i = 0; i < a.length; i++) {
      expect(a[i].id).not.toBe(b[i].id);
    }
  });
});

describe('generateSkinVariants — RNG discipline', () => {
  // No source-grep for `Math.random`/`Date.now` here: it would require
  // `@types/node` (a forbidden new devDep) and would couple the test to
  // implementation internals. The seed-stability test above is a strictly
  // stronger proof — any nondeterminism (`Math.random`, `Date.now`, global
  // mutable state) would make the two independent calls differ. Determinism
  // of the delegated `generatePalette` is independently covered by
  // `src/tests/generate.test.ts`.
  it('seed-stability is the functional determinism proof (no Math.random / Date.now)', () => {
    const a = generateSkinVariants(42, baseSkin(), 5);
    const b = generateSkinVariants(42, baseSkin(), 5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('generateSkinVariants — frozen golden value (cross-engine determinism anchor)', () => {
  // Frozen from the reference implementation for seed=42, base='devil' (scale 1),
  // count=5. Any drift in mulberry32, generatePalette, or FNV-1a across JS
  // engines is absorbed by 8-bit hex rounding, so this exact output must
  // reproduce on every engine. If this test fails, a deterministic primitive
  // changed and every downstream consumer's replay/sync is affected.
  it('seed 42 / devil / count 5 reproduces the frozen variant ids', () => {
    const variants = generateSkinVariants(42, baseSkin('devil', 1), 5);
    const ids = variants.map((v) => v.id);
    expect(ids).toEqual([
      'devil-var-0-42-1b7jlg3',
      'devil-var-1-42-1b7jlg3',
      'devil-var-2-42-1b7jlg3',
      'devil-var-3-42-1b7jlg3',
      'devil-var-4-42-1b7jlg3',
    ]);
  });

  it('seed 42 / devil / count 5 reproduces the frozen first variant (palette + scale)', () => {
    const [first] = generateSkinVariants(42, baseSkin('devil', 1), 5);
    expect(first).toEqual({
      id: 'devil-var-0-42-1b7jlg3',
      name: 'Devil Variant 1',
      rarity: 'rare',
      palette: {
        outline: '#000101',
        base: '#00b5e3',
        accent: '#b378a4',
        feature: '#513900',
        background: '#eef7f9',
      },
      scale: 1.0404415007680654,
    });
  });
});
