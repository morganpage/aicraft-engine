import { describe, it, expect } from 'vitest';
import { rgbToOklch, oklchToRgb, hexToOklch, oklchToHex } from '../palette/oklch';
import { parseHex } from '../primitives/color';

describe('rgbToOklch', () => {
  it('maps white to L ≈ 1.0 with near-zero chroma', () => {
    const { l, c } = rgbToOklch({ r: 255, g: 255, b: 255 });
    expect(l).toBeCloseTo(1.0, 3);
    expect(c).toBeLessThan(0.001);
  });

  it('maps black to L ≈ 0 with near-zero chroma', () => {
    const { l, c } = rgbToOklch({ r: 0, g: 0, b: 0 });
    expect(l).toBeLessThan(0.001);
    expect(c).toBeLessThan(0.001);
  });

  it('maps grey to near-zero chroma (achromatic)', () => {
    const { c } = rgbToOklch({ r: 128, g: 128, b: 128 });
    expect(c).toBeLessThan(0.001);
  });

  it('produces hue in [0, 360) for a saturated red', () => {
    const { h } = rgbToOklch({ r: 230, g: 57, b: 70 });
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });

  it('round-trips sRGB within tight tolerance (Δ < 0.01 per channel)', () => {
    const samples = [
      { r: 200, g: 50, b: 150 },
      { r: 10, g: 120, b: 230 },
      { r: 240, g: 200, b: 100 },
      { r: 60, g: 60, b: 60 },
      { r: 128, g: 200, b: 32 },
    ];
    for (const rgb of samples) {
      const back = oklchToRgb(rgbToOklch(rgb));
      expect(Math.abs(back.r - rgb.r)).toBeLessThan(0.01);
      expect(Math.abs(back.g - rgb.g)).toBeLessThan(0.01);
      expect(Math.abs(back.b - rgb.b)).toBeLessThan(0.01);
    }
  });
});

describe('oklchToRgb', () => {
  it('clamps out-of-gamut channels into [0, 255]', () => {
    const back = oklchToRgb({ l: 0.5, c: 0.35, h: 140 });
    expect(back.r).toBeGreaterThanOrEqual(0);
    expect(back.r).toBeLessThanOrEqual(255);
    expect(back.g).toBeGreaterThanOrEqual(0);
    expect(back.g).toBeLessThanOrEqual(255);
    expect(back.b).toBeGreaterThanOrEqual(0);
    expect(back.b).toBeLessThanOrEqual(255);
  });
});

describe('hex round-trip', () => {
  it('hexToOklch/oklchToHex round-trips within ±1 per 8-bit channel', () => {
    const samples = [
      '#e63946',
      '#f4a261',
      '#1d1128',
      '#808080',
      '#00ff88',
      '#102030',
      '#fe5701',
      '#ffffff',
      '#000000',
    ];
    for (const hex of samples) {
      const back = oklchToHex(hexToOklch(hex));
      const a = parseHex(hex);
      const b = parseHex(back);
      expect(Math.abs(a.r - b.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.g - b.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.b - b.b)).toBeLessThanOrEqual(1);
    }
  });

  it('output is always valid 6-digit #rrggbb', () => {
    const out = oklchToHex({ l: 0.62, c: 0.2, h: 250 });
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
  });
});
