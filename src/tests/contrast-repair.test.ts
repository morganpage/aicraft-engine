import { describe, it, expect } from 'vitest';
import { repairContrast } from '../palette/contrast-repair';
import type { Palette } from '../palette/types';
import { contrastRatio, meetsWcagAa } from '../primitives/color';

const ALL_GREY: Palette = {
  outline: '#808080',
  base: '#808080',
  accent: '#808080',
  feature: '#808080',
  background: '#808080',
};

describe('repairContrast', () => {
  it('repairs the outline/base pair to meet WCAG AA (4.5:1)', () => {
    const bad: Palette = {
      outline: '#707070',
      base: '#a0a0a0',
      accent: '#cccccc',
      feature: '#ffffff',
      background: '#ffffff',
    };
    const fixed = repairContrast(bad);
    expect(meetsWcagAa(fixed.outline, fixed.base)).toBe(true);
  });

  it('repairs the feature/base pair to meet WCAG AA', () => {
    const bad: Palette = {
      outline: '#000000',
      base: '#404040',
      accent: '#505050',
      feature: '#505050',
      background: '#000000',
    };
    const fixed = repairContrast(bad);
    expect(meetsWcagAa(fixed.feature, fixed.base)).toBe(true);
  });

  it('repairs the outline/background pair to meet WCAG AA', () => {
    const bad: Palette = {
      outline: '#909090',
      base: '#f0f0f0',
      accent: '#cccccc',
      feature: '#ffffff',
      background: '#808080',
    };
    const fixed = repairContrast(bad);
    expect(meetsWcagAa(fixed.outline, fixed.background)).toBe(true);
  });

  it('terminates on an all-mid-grey palette (no infinite loop)', () => {
    const fixed = repairContrast(ALL_GREY);
    expect(Object.keys(fixed).sort()).toEqual(
      ['accent', 'background', 'base', 'feature', 'outline'],
    );
  });

  it('uses a fixed iteration count: completion is bounded and deterministic', () => {
    const a = repairContrast(ALL_GREY);
    const b = repairContrast(ALL_GREY);
    expect(a).toEqual(b);
  });

  it('does not mutate the input palette', () => {
    const bad: Palette = {
      outline: '#707070',
      base: '#a0a0a0',
      accent: '#cccccc',
      feature: '#ffffff',
      background: '#ffffff',
    };
    const snap = JSON.parse(JSON.stringify(bad)) as Palette;
    repairContrast(bad);
    expect(bad).toEqual(snap);
  });

  it('best-effort fallback: an unfixable pair does not throw', () => {
    // outline is lighter than an already-light base; lightening cannot reach 4.5:1.
    const unfixable: Palette = {
      outline: '#c0c0c0',
      base: '#a0a0a0',
      accent: '#c0c0c0',
      feature: '#c0c0c0',
      background: '#c0c0c0',
    };
    const fixed = repairContrast(unfixable);
    expect(fixed.outline).toMatch(/^#[0-9a-f]{6}$/);
    expect(fixed.base).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('already-compliant pairs leave the foreground slot untouched', () => {
    // Black outline contrasts both the vivid red base and the light background,
    // so neither outline pair needs repair and the outline is preserved.
    const good: Palette = {
      outline: '#000000',
      base: '#e63946',
      accent: '#f4a261',
      feature: '#ffffff',
      background: '#f0f0f0',
    };
    const fixed = repairContrast(good);
    expect(fixed.outline).toBe(good.outline);
  });

  it('honours a custom target ratio option', () => {
    // Base is light enough that darkening the outline can reach 7:1
    // (black vs this base is ~9.6:1, so the search has headroom).
    const bad: Palette = {
      outline: '#707070',
      base: '#c0c0c0',
      accent: '#cccccc',
      feature: '#ffffff',
      background: '#ffffff',
    };
    const fixed = repairContrast(bad, { targetRatio: 7.0 });
    expect(contrastRatio(fixed.outline, fixed.base)).toBeGreaterThanOrEqual(6.9);
  });
});
