import { describe, it, expect } from 'vitest';
import { resolvePalette } from '../palette/resolve';
import type { Palette } from '../palette/types';

const BASE: Palette = {
  outline: '#1d1128',
  base: '#e63946',
  accent: '#f4a261',
  feature: '#ffffff',
  background: '#1a1025',
};

describe('resolvePalette', () => {
  it('returns the base palette when overrides is undefined', () => {
    expect(resolvePalette(BASE)).toEqual(BASE);
  });

  it('returns the base palette when overrides is empty', () => {
    expect(resolvePalette(BASE, {})).toEqual(BASE);
  });

  it('missing override slots fall back to base values', () => {
    const r = resolvePalette(BASE, { base: '#00ff88' });
    expect(r.base).toBe('#00ff88');
    expect(r.outline).toBe(BASE.outline);
    expect(r.accent).toBe(BASE.accent);
    expect(r.feature).toBe(BASE.feature);
    expect(r.background).toBe(BASE.background);
  });

  it('a full override replaces every slot', () => {
    const ov: Palette = {
      outline: '#000000',
      base: '#111111',
      accent: '#222222',
      feature: '#333333',
      background: '#444444',
    };
    expect(resolvePalette(BASE, ov)).toEqual(ov);
  });

  it('does not mutate the input base palette', () => {
    const snap = JSON.parse(JSON.stringify(BASE)) as Palette;
    resolvePalette(BASE, { base: '#00ff88', accent: '#ff00ff' });
    expect(BASE).toEqual(snap);
  });

  it('returns a fresh object (not the base reference)', () => {
    const r = resolvePalette(BASE);
    expect(r).not.toBe(BASE);
    expect(r).toEqual(BASE);
  });
});
