import { describe, it, expect } from 'vitest';
import { generatePalette } from '../palette/generate';
import type { Palette } from '../palette/types';
import { meetsWcagAa } from '../primitives/color';

const HEX = /^#[0-9a-f]{6}$/;

function allValidHex(p: Palette): boolean {
  return [p.outline, p.base, p.accent, p.feature, p.background].every((s) =>
    HEX.test(s),
  );
}

describe('generatePalette', () => {
  it('is seed-stable: the same seed yields a bit-identical palette', () => {
    const a = generatePalette(42);
    const b = generatePalette(42);
    expect(a).toEqual(b);
  });

  it('produces valid 6-digit #rrggbb for every slot', () => {
    const p = generatePalette(7);
    expect(allValidHex(p)).toBe(true);
  });

  it('produces visually distinct palettes across distinct seeds', () => {
    const seen = new Set<string>();
    for (let s = 1; s <= 8; s++) {
      seen.add(JSON.stringify(generatePalette(s)));
    }
    expect(seen.size).toBe(8);
  });

  it('different seeds yield different palettes', () => {
    expect(generatePalette(1)).not.toEqual(generatePalette(2));
  });

  it('yields a contrast-safe palette (checked pairs meet WCAG AA)', () => {
    const p = generatePalette(99);
    expect(meetsWcagAa(p.outline, p.base)).toBe(true);
    expect(meetsWcagAa(p.feature, p.base)).toBe(true);
    expect(meetsWcagAa(p.outline, p.background)).toBe(true);
  });

  it('respects an explicit strategy option', () => {
    const tri = generatePalette(5, { strategy: 'triadic' });
    const ana = generatePalette(5, { strategy: 'analogous' });
    expect(tri).not.toEqual(ana);
    expect(allValidHex(tri) && allValidHex(ana)).toBe(true);
  });

  it('honours custom base lightness/chroma', () => {
    const p = generatePalette(5, { baseLightness: 0.4, baseChroma: 0.08 });
    expect(allValidHex(p)).toBe(true);
  });

  // Cross-engine determinism anchor. Frozen from the reference implementation;
  // any drift in Math.pow/atan2/cos across JS engines is absorbed by 8-bit hex
  // rounding, so this exact object must reproduce on every engine.
  it('seed 42 produces the frozen golden-value palette', () => {
    const expected: Palette = {
      outline: '#000101',
      base: '#00b5e3',
      accent: '#b378a4',
      feature: '#513900',
      background: '#eef7f9',
    };
    expect(generatePalette(42)).toEqual(expected);
  });
});
