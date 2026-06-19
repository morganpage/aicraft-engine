import { describe, it, expect } from 'vitest';
import { grantSkin, equipSkin, unequipSkin } from '../cosmetics/ownership';
import type { CosmeticSave } from '../cosmetics/types';

function emptySave(): CosmeticSave {
  return { owned: [], equipped: {} };
}

describe('grantSkin', () => {
  it('returns a new object (not the input reference)', () => {
    const save = emptySave();
    expect(grantSkin(save, 'a')).not.toBe(save);
  });

  it('does not mutate the input (deep equality with snapshot)', () => {
    const save: CosmeticSave = { owned: ['b'], equipped: { body: 'b' } };
    const snapshot = JSON.parse(JSON.stringify(save));
    grantSkin(save, 'a');
    expect(save).toEqual(snapshot);
  });

  it('adds the granted id', () => {
    const next = grantSkin(emptySave(), 'a');
    expect(next.owned).toContain('a');
  });

  it('keeps owned in canonical alphabetical order regardless of grant order', () => {
    let save = emptySave();
    save = grantSkin(save, 'c');
    save = grantSkin(save, 'a');
    save = grantSkin(save, 'b');
    expect(save.owned).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op (equal values) on a duplicate id', () => {
    const save: CosmeticSave = { owned: ['a', 'b'], equipped: {} };
    const next = grantSkin(save, 'a');
    expect(next.owned).toEqual(['a', 'b']);
  });

  it('is a no-op on an empty-string id', () => {
    const save: CosmeticSave = { owned: ['a'], equipped: {} };
    expect(grantSkin(save, '').owned).toEqual(['a']);
  });

  it('JSON-clone verified: mutating the returned save does not affect the input', () => {
    const save = emptySave();
    const next = grantSkin(save, 'b');
    next.owned.push('HACK');
    expect(save.owned).toEqual([]);
  });
});

describe('equipSkin', () => {
  it('returns a new object (not the input reference) for an owned skin', () => {
    const save: CosmeticSave = { owned: ['x'], equipped: {} };
    expect(equipSkin(save, 'body', 'x')).not.toBe(save);
  });

  it('sets equipped[slot] for an owned skin', () => {
    const save: CosmeticSave = { owned: ['x'], equipped: {} };
    expect(equipSkin(save, 'body', 'x').equipped.body).toBe('x');
    expect(equipSkin(save, 'head', 'x').equipped.head).toBe('x');
    expect(equipSkin(save, 'trail', 'x').equipped.trail).toBe('x');
  });

  it('is a no-op (no equip, no throw) for an unowned skin', () => {
    const save: CosmeticSave = { owned: ['x'], equipped: {} };
    const next = equipSkin(save, 'body', 'unowned');
    expect(next.equipped.body).toBeUndefined();
    expect(next.owned).toEqual(['x']);
  });

  it('is a no-op for an empty-string skin id', () => {
    const save: CosmeticSave = { owned: ['x'], equipped: {} };
    expect(equipSkin(save, 'body', '').equipped.body).toBeUndefined();
  });

  it('does not consult the manifest — only ownership (granted-but-unlisted skins equip)', () => {
    const save: CosmeticSave = { owned: ['generated-1'], equipped: {} };
    expect(equipSkin(save, 'body', 'generated-1').equipped.body).toBe(
      'generated-1',
    );
  });

  it('is pure (does not mutate the input)', () => {
    const save: CosmeticSave = { owned: ['x'], equipped: {} };
    const snapshot = JSON.parse(JSON.stringify(save));
    equipSkin(save, 'body', 'x');
    expect(save).toEqual(snapshot);
  });

  it('JSON-clone verified: mutating the returned save does not affect the input', () => {
    const save: CosmeticSave = { owned: ['x'], equipped: {} };
    const next = equipSkin(save, 'body', 'x');
    next.equipped.body = 'HACK';
    expect(save.equipped.body).toBeUndefined();
  });
});

describe('unequipSkin', () => {
  it('returns a new object (not the input reference) when a slot was filled', () => {
    const save: CosmeticSave = { owned: ['x'], equipped: { body: 'x' } };
    expect(unequipSkin(save, 'body')).not.toBe(save);
  });

  it('removes the equipped slot', () => {
    const save: CosmeticSave = {
      owned: ['x', 'y'],
      equipped: { body: 'x', head: 'y' },
    };
    const next = unequipSkin(save, 'body');
    expect(next.equipped.body).toBeUndefined();
    expect(next.equipped.head).toBe('y');
  });

  it('is a no-op (equal values) on an already-empty slot', () => {
    const save: CosmeticSave = { owned: ['x'], equipped: {} };
    const next = unequipSkin(save, 'body');
    expect(next.equipped.body).toBeUndefined();
  });

  it('is pure (does not mutate the input)', () => {
    const save: CosmeticSave = { owned: ['x'], equipped: { body: 'x' } };
    const snapshot = JSON.parse(JSON.stringify(save));
    unequipSkin(save, 'body');
    expect(save).toEqual(snapshot);
  });
});

describe('ownership ops — defensive (never throw)', () => {
  it('never throws on a malformed save with missing owned/equipped fields', () => {
    const malformed = {
      owned: undefined,
      equipped: undefined,
    } as unknown as CosmeticSave;
    expect(() => grantSkin(malformed, 'a')).not.toThrow();
    expect(() => equipSkin(malformed, 'body', 'a')).not.toThrow();
    expect(() => unequipSkin(malformed, 'body')).not.toThrow();
  });

  it('never throws on a null save', () => {
    expect(() => grantSkin(null as unknown as CosmeticSave, 'a')).not.toThrow();
    expect(() =>
      equipSkin(null as unknown as CosmeticSave, 'body', 'a'),
    ).not.toThrow();
    expect(() => unequipSkin(null as unknown as CosmeticSave, 'body')).not.toThrow();
  });

  it('produces a well-formed save from a malformed input', () => {
    const malformed = {
      owned: undefined,
      equipped: undefined,
    } as unknown as CosmeticSave;
    const next = grantSkin(malformed, 'a');
    expect(Array.isArray(next.owned)).toBe(true);
    expect(next.owned).toContain('a');
    expect(next.equipped).toEqual({});
  });
});
