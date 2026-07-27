import { describe, it, expect } from 'vitest';
import { collect, hasCollected } from '../collectibles/collectibles';
import type { CollectibleSave } from '../collectibles/types';

function emptySave(): CollectibleSave {
  return { collected: [] };
}

describe('collect', () => {
  it('returns a new object (not the input reference)', () => {
    const save = emptySave();
    expect(collect(save, '1')).not.toBe(save);
  });

  it('does not mutate the input (deep equality with snapshot)', () => {
    const save: CollectibleSave = { collected: ['2'] };
    const snapshot = JSON.parse(JSON.stringify(save));
    collect(save, '1');
    expect(save).toEqual(snapshot);
  });

  it('appends the collected id', () => {
    const next = collect(emptySave(), '1');
    expect(next.collected).toContain('1');
  });

  it('keeps collected in canonical alphabetical order regardless of grant order', () => {
    let save = emptySave();
    save = collect(save, '3');
    save = collect(save, '1');
    save = collect(save, '2');
    expect(save.collected).toEqual(['1', '2', '3']);
  });

  it('keeps collected sorted canonically even with mixed-length string ids', () => {
    // String sort: '10' < '2' lexicographically. This mirrors CosmeticSave.owned.
    let save = emptySave();
    save = collect(save, '2');
    save = collect(save, '10');
    save = collect(save, '1');
    expect(save.collected).toEqual(['1', '10', '2']);
  });

  it('is a no-op (equal values) on an already-collected id', () => {
    const save: CollectibleSave = { collected: ['1', '2'] };
    const next = collect(save, '1');
    expect(next.collected).toEqual(['1', '2']);
  });

  it('is a no-op on an empty-string id', () => {
    const save: CollectibleSave = { collected: ['1'] };
    expect(collect(save, '').collected).toEqual(['1']);
  });

  it('is a no-op on a non-string id (defensive)', () => {
    const save: CollectibleSave = { collected: ['1'] };
    expect(collect(save, 42 as unknown as string).collected).toEqual(['1']);
    expect(collect(save, undefined as unknown as string).collected).toEqual(['1']);
    expect(collect(save, null as unknown as string).collected).toEqual(['1']);
  });

  it('JSON-clone verified: mutating the returned save does not affect the input', () => {
    const save = emptySave();
    const next = collect(save, '2');
    next.collected.push('HACK');
    expect(save.collected).toEqual([]);
  });
});

describe('hasCollected', () => {
  it('returns true iff the id is in collected', () => {
    const save: CollectibleSave = { collected: ['1', '2', '3'] };
    expect(hasCollected(save, '1')).toBe(true);
    expect(hasCollected(save, '2')).toBe(true);
    expect(hasCollected(save, '3')).toBe(true);
    expect(hasCollected(save, '4')).toBe(false);
  });

  it('returns false for an empty-string id', () => {
    const save: CollectibleSave = { collected: ['1'] };
    expect(hasCollected(save, '')).toBe(false);
  });

  it('returns false for a non-string id (defensive)', () => {
    const save: CollectibleSave = { collected: ['1'] };
    expect(hasCollected(save, 1 as unknown as string)).toBe(false);
    expect(hasCollected(save, undefined as unknown as string)).toBe(false);
    expect(hasCollected(save, null as unknown as string)).toBe(false);
  });

  it('returns false for an empty save', () => {
    expect(hasCollected(emptySave(), '1')).toBe(false);
  });
});

describe('collect / hasCollected — defensive (never throw)', () => {
  it('never throws on a malformed save with missing collected field', () => {
    const malformed = { collected: undefined } as unknown as CollectibleSave;
    expect(() => collect(malformed, 'a')).not.toThrow();
    expect(() => hasCollected(malformed, 'a')).not.toThrow();
  });

  it('never throws on a malformed save with non-array collected field', () => {
    const malformed = { collected: 'not-an-array' } as unknown as CollectibleSave;
    expect(() => collect(malformed, 'a')).not.toThrow();
    expect(() => hasCollected(malformed, 'a')).not.toThrow();
  });

  it('never throws on a null save', () => {
    expect(() => collect(null as unknown as CollectibleSave, 'a')).not.toThrow();
    expect(() => hasCollected(null as unknown as CollectibleSave, 'a')).not.toThrow();
  });

  it('never throws on a non-object save', () => {
    expect(() => collect('hello' as unknown as CollectibleSave, 'a')).not.toThrow();
    expect(() => hasCollected(42 as unknown as CollectibleSave, 'a')).not.toThrow();
  });

  it('produces a well-formed save from a malformed input', () => {
    const malformed = { collected: undefined } as unknown as CollectibleSave;
    const next = collect(malformed, 'a');
    expect(Array.isArray(next.collected)).toBe(true);
    expect(next.collected).toContain('a');
  });
});

describe('CollectibleSave — JSON round-trip', () => {
  it('survives a JSON round-trip with no data loss', () => {
    const save: CollectibleSave = { collected: ['10', '1', '2', '21'] };
    const round = JSON.parse(JSON.stringify(save)) as CollectibleSave;
    expect(round).toEqual(save);
  });

  it('uses no Set / Map (plain JSON shape only)', () => {
    const save: CollectibleSave = { collected: ['1', '2', '3'] };
    const json = JSON.stringify(save);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed.collected)).toBe(true);
    expect(parsed.collected instanceof Set).toBe(false);
  });

  it('canonical sorted order is stable across round-trips', () => {
    let save = emptySave();
    save = collect(save, '3');
    save = collect(save, '1');
    save = collect(save, '2');
    const round = JSON.parse(JSON.stringify(save)) as CollectibleSave;
    expect(round.collected).toEqual(['1', '2', '3']);
  });
});
