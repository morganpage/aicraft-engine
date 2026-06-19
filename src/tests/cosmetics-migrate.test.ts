import { describe, it, expect } from 'vitest';
import { migrateManifest } from '../cosmetics/migrate';
import {
  DEFAULT_MANIFEST,
  MANIFEST_VERSION,
  SCALE_MAX,
  SCALE_MIN,
} from '../cosmetics/constants';
import type { SkinPreset } from '../cosmetics/types';

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A complete, valid v1 skin for embedding in raw manifest payloads. */
function rawSkin(id: string, scale = 1): Record<string, unknown> {
  return {
    id,
    name: id.toUpperCase(),
    rarity: 'rare',
    scale,
    palette: {
      outline: '#000000',
      base: '#ff0000',
      accent: '#00ff00',
      feature: '#0000ff',
      background: '#ffffff',
    },
  };
}

function isValidSkin(s: SkinPreset): boolean {
  return (
    typeof s.id === 'string' &&
    s.id.length > 0 &&
    typeof s.name === 'string' &&
    (s.rarity === 'common' ||
      s.rarity === 'rare' ||
      s.rarity === 'epic' ||
      s.rarity === 'legendary') &&
    typeof s.scale === 'number' &&
    Number.isFinite(s.scale) &&
    HEX.test(s.palette.outline) &&
    HEX.test(s.palette.base) &&
    HEX.test(s.palette.accent) &&
    HEX.test(s.palette.feature) &&
    HEX.test(s.palette.background)
  );
}

describe('migrateManifest — defensive (never throws, always valid)', () => {
  it('returns a valid manifest for a malformed string input', () => {
    const m = migrateManifest('{not json');
    expect(m.version).toBe(MANIFEST_VERSION);
    expect(m.skins.length).toBeGreaterThan(0);
    expect(m.skins.every(isValidSkin)).toBe(true);
  });

  it('returns the default manifest for null', () => {
    expect(migrateManifest(null)).toEqual(DEFAULT_MANIFEST);
  });

  it('returns the default manifest for a number primitive', () => {
    expect(migrateManifest(42)).toEqual(DEFAULT_MANIFEST);
  });

  it('returns the default manifest for a boolean', () => {
    expect(migrateManifest(true)).toEqual(DEFAULT_MANIFEST);
  });

  it('returns the default manifest for an array (wrong shape)', () => {
    expect(migrateManifest([1, 2, 3])).toEqual(DEFAULT_MANIFEST);
  });

  it('returns the default manifest when version is missing', () => {
    expect(migrateManifest({ skins: [] })).toEqual(DEFAULT_MANIFEST);
  });

  it('returns the default manifest when version is the wrong type', () => {
    expect(migrateManifest({ version: '1', skins: [] })).toEqual(DEFAULT_MANIFEST);
  });

  it('returns the default manifest for an older incompatible version', () => {
    expect(migrateManifest({ version: 0, skins: [] })).toEqual(DEFAULT_MANIFEST);
  });

  it('returns the default manifest for an unknown newer version (default target)', () => {
    expect(migrateManifest({ version: 2, skins: [] })).toEqual(DEFAULT_MANIFEST);
  });

  it('silently ignores unknown top-level fields', () => {
    const m = migrateManifest({ version: 1, skins: [], extra: 'x', unknown: 7 });
    expect(m).toEqual(DEFAULT_MANIFEST);
  });

  it('returns the default manifest when skins is an empty array', () => {
    expect(migrateManifest({ version: 1, skins: [] })).toEqual(DEFAULT_MANIFEST);
  });

  it('returns the default manifest when skins is not an array', () => {
    expect(migrateManifest({ version: 1, skins: 'nope' })).toEqual(DEFAULT_MANIFEST);
    expect(migrateManifest({ version: 1, skins: { 0: rawSkin('a') } })).toEqual(
      DEFAULT_MANIFEST,
    );
  });

  it('dedupes skins by id (last entry wins)', () => {
    const m = migrateManifest({
      version: 1,
      skins: [
        rawSkin('a', 1),
        { ...rawSkin('a', 2), name: 'A-second' },
      ],
    });
    expect(m.skins.length).toBe(1);
    expect(m.skins[0].name).toBe('A-second');
    expect(m.skins[0].scale).toBe(2);
  });

  it('drops non-object skin entries but keeps valid ones', () => {
    const m = migrateManifest({
      version: 1,
      skins: [null, 7, 'nope', rawSkin('keep')],
    });
    expect(m.skins.length).toBe(1);
    expect(m.skins[0].id).toBe('keep');
  });

  it('falls back to the default manifest when every skin entry is invalid', () => {
    expect(
      migrateManifest({ version: 1, skins: [null, 7, 'nope', undefined] }),
    ).toEqual(DEFAULT_MANIFEST);
  });

  it('falls back to the default palette slot on an invalid hex value', () => {
    const m = migrateManifest({
      version: 1,
      skins: [
        {
          id: 'a',
          name: 'A',
          rarity: 'common',
          scale: 1,
          palette: { outline: 'not-a-hex', base: '#00ff00' },
        },
      ],
    });
    const p = m.skins[0].palette;
    const dp = DEFAULT_MANIFEST.skins[0].palette;
    expect(p.outline).toBe(dp.outline);
    expect(p.base).toBe('#00ff00');
    expect(p.accent).toBe(dp.accent);
    expect(p.feature).toBe(dp.feature);
    expect(p.background).toBe(dp.background);
  });

  it('returns the default manifest for a completely empty object', () => {
    expect(migrateManifest({})).toEqual(DEFAULT_MANIFEST);
  });

  it('passes a valid manifest through (structural equality)', () => {
    const m = migrateManifest({ version: 1, skins: [rawSkin('devil-neon', 1.1)] });
    expect(m.version).toBe(1);
    expect(m.skins.length).toBe(1);
    expect(m.skins[0].id).toBe('devil-neon');
    expect(m.skins[0].rarity).toBe('rare');
    expect(m.skins[0].scale).toBeCloseTo(1.1);
    expect(m.skins[0].palette.base).toBe('#ff0000');
  });

  it('clamps an above-range scale to SCALE_MAX', () => {
    const m = migrateManifest({ version: 1, skins: [rawSkin('big', 100)] });
    expect(m.skins[0].scale).toBe(SCALE_MAX);
  });

  it('clamps a below-range scale to SCALE_MIN', () => {
    const m = migrateManifest({ version: 1, skins: [rawSkin('tiny', -5)] });
    expect(m.skins[0].scale).toBe(SCALE_MIN);
  });

  it('coerces a non-numeric scale to the default scale', () => {
    const m = migrateManifest({
      version: 1,
      skins: [{ id: 'x', name: 'X', rarity: 'common', scale: 'huge', palette: {} }],
    });
    expect(m.skins[0].scale).toBe(DEFAULT_MANIFEST.skins[0].scale);
  });

  it('defaults targetVersion to MANIFEST_VERSION', () => {
    const m = migrateManifest({ version: MANIFEST_VERSION, skins: [rawSkin('a')] });
    expect(m.version).toBe(MANIFEST_VERSION);
    expect(m.skins[0].id).toBe('a');
  });

  it('accepts input whose version matches an explicit targetVersion', () => {
    const m = migrateManifest({ version: 1, skins: [rawSkin('a')] }, 1);
    expect(m.skins[0].id).toBe('a');
  });

  it('accepts a higher explicit targetVersion with matching input version', () => {
    const m = migrateManifest({ version: 2, skins: [rawSkin('a')] }, 2);
    expect(m.version).toBe(2);
    expect(m.skins[0].id).toBe('a');
  });

  it('rejects input whose version does not match the explicit targetVersion', () => {
    expect(migrateManifest({ version: 2, skins: [rawSkin('a')] }, 1)).toEqual(
      DEFAULT_MANIFEST,
    );
  });

  it('exposes skins as a readonly array (compile-enforced; runtime structural check)', () => {
    const m = migrateManifest({ version: 1, skins: [rawSkin('a')] });
    expect(Array.isArray(m.skins)).toBe(true);
    // Type-level check: readonly SkinPreset[] is assignable here. The build gate
    // (tsc) enforces that CosmeticManifest.skins is declared readonly.
    const _typecheck: readonly SkinPreset[] = m.skins;
    expect(_typecheck).toBe(m.skins);
  });
});
