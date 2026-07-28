import { describe, it, expect } from 'vitest';
import {
  parseHex,
  toHex,
  shade,
  mixHex,
  complement,
  relativeLuminance,
  contrastRatio,
  meetsWcagAa,
  isHexColor,
  safeHex,
} from '../primitives/color';

describe('hex color guards', () => {
  it('accepts complete six-digit colors with or without #', () => {
    expect(isHexColor('#ff8800')).toBe(true);
    expect(isHexColor('A0b1C2')).toBe(true);
  });

  it('rejects malformed and non-string values without throwing', () => {
    for (const value of ['#fff', '#12zzzz', '1234567', '', null, undefined, 42]) {
      expect(isHexColor(value)).toBe(false);
    }
  });

  it('returns a valid fallback and safely degrades a malformed fallback', () => {
    expect(safeHex('#abcdef', '#000000')).toBe('#abcdef');
    expect(safeHex('bad', '#123456')).toBe('#123456');
    expect(safeHex('bad', 'also bad')).toBe('#000000');
  });
});

describe('parseHex', () => {
  it('parses #rrggbb', () => {
    expect(parseHex('#ff8800')).toEqual({ r: 255, g: 136, b: 0 });
  });
  it('parses rrggbb without #', () => {
    expect(parseHex('ff8800')).toEqual({ r: 255, g: 136, b: 0 });
  });
  it('parses black and white', () => {
    expect(parseHex('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHex('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
  });
  it('throws on short input', () => {
    expect(() => parseHex('#ff')).toThrow();
  });
  it('throws on non-hex input', () => {
    expect(() => parseHex('#gggggg')).toThrow();
  });
});

describe('toHex', () => {
  it('converts RGB to #rrggbb', () => {
    expect(toHex({ r: 255, g: 136, b: 0 })).toBe('#ff8800');
  });
  it('clamps out-of-range values to 0..255', () => {
    expect(toHex({ r: 300, g: -10, b: 128 })).toBe('#ff0080');
  });
  it('rounds floats', () => {
    expect(toHex({ r: 127.6, g: 0, b: 0 })).toBe('#800000');
  });
});

describe('shade', () => {
  it('darkens by a factor < 1', () => {
    expect(shade('#ffffff', 0.5)).toBe('#808080');
  });
  it('lightens by a factor > 1, clamped at 255', () => {
    expect(shade('#808080', 2)).toBe('#ffffff');
  });
  it('no-op at factor 1', () => {
    expect(shade('#fe5701', 1)).toBe('#fe5701');
  });
  it('black at any factor < 1 stays black', () => {
    expect(shade('#000000', 0.5)).toBe('#000000');
  });
  it('round-trips through parseHex', () => {
    const original = '#abcdef';
    const { r, g, b } = parseHex(original);
    expect(toHex({ r, g, b })).toBe(original);
  });
});

describe('mixHex', () => {
  it('returns first color at t=0', () => {
    expect(mixHex('#ff0000', '#00ff00', 0)).toBe('#ff0000');
  });
  it('returns second color at t=1', () => {
    expect(mixHex('#ff0000', '#00ff00', 1)).toBe('#00ff00');
  });
  it('returns midpoint at t=0.5', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('complement', () => {
  it('inverts each channel', () => {
    expect(complement('#000000')).toBe('#ffffff');
    expect(complement('#ffffff')).toBe('#000000');
    expect(complement('#808080')).toBe('#7f7f7f');
  });
});

describe('relativeLuminance', () => {
  it('is 0 for black', () => {
    expect(relativeLuminance('#000000')).toBe(0);
  });
  it('is 1 for white', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });
  it('is between 0 and 1 for mid-gray', () => {
    const l = relativeLuminance('#808080');
    expect(l).toBeGreaterThan(0);
    expect(l).toBeLessThan(1);
  });
});

describe('contrastRatio', () => {
  it('is 1 for same color', () => {
    expect(contrastRatio('#888888', '#888888')).toBeCloseTo(1, 5);
  });
  it('is 21 for black vs white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
  it('is symmetric', () => {
    const a = contrastRatio('#fe5701', '#1d1128');
    const b = contrastRatio('#1d1128', '#fe5701');
    expect(a).toBeCloseTo(b, 5);
  });
});

describe('meetsWcagAa', () => {
  it('true for black on white', () => {
    expect(meetsWcagAa('#000000', '#ffffff')).toBe(true);
  });
  it('true for Spitekeep devil orange on black', () => {
    expect(meetsWcagAa('#fe5701', '#000000')).toBe(true);
  });
  it('false for low-contrast pair', () => {
    expect(meetsWcagAa('#808080', '#909090')).toBe(false);
  });
});
