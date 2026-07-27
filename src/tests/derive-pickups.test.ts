import { describe, it, expect } from 'vitest';
import { derivePickups } from '../collectibles/derive-pickups';
import type { CollectibleEntity } from '../collectibles/types';
import type { CollectibleSave } from '../collectibles/types';
import type { EntityId } from '../level/types';

/** Build a collectible entity with sensible defaults. */
function coin(
  id: EntityId,
  rect: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width: 16, height: 16 },
): CollectibleEntity {
  return {
    id,
    kind: 'collectible',
    rect,
    props: { kind: 'coin', value: 1 },
  };
}

const PLAYER_AT_ORIGIN = { x: 0, y: 0, width: 16, height: 16 };

describe('derivePickups — purity', () => {
  it('returns identical output for identical inputs (byte-equal across calls)', () => {
    const collectibles = [coin(1), coin(2)];
    const save: CollectibleSave = { collected: [] };
    const a = derivePickups(PLAYER_AT_ORIGIN, collectibles, save);
    const b = derivePickups(PLAYER_AT_ORIGIN, collectibles, save);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('does not mutate the input save', () => {
    const collectibles = [coin(1, { x: 0, y: 0, width: 16, height: 16 })];
    const save: CollectibleSave = { collected: [] };
    const snapshot = JSON.parse(JSON.stringify(save));
    derivePickups(PLAYER_AT_ORIGIN, collectibles, save);
    expect(save).toEqual(snapshot);
  });

  it('does not mutate the input collectibles array or its entities', () => {
    const collectibles = [coin(1, { x: 0, y: 0, width: 16, height: 16 })];
    const snapshot = JSON.parse(JSON.stringify(collectibles));
    derivePickups(PLAYER_AT_ORIGIN, collectibles, { collected: [] });
    expect(collectibles).toEqual(snapshot);
  });
});

describe('derivePickups — overlap → collected', () => {
  it('collects an entity whose rect overlaps the player rect', () => {
    const c = coin(1, { x: 0, y: 0, width: 16, height: 16 });
    const { collected, remaining } = derivePickups(PLAYER_AT_ORIGIN, [c], { collected: [] });
    expect(collected).toContain(1);
    expect(remaining).toEqual([]);
  });

  it('excludes the collected entity from remaining', () => {
    const c = coin(1, { x: 0, y: 0, width: 16, height: 16 });
    const { remaining } = derivePickups(PLAYER_AT_ORIGIN, [c], { collected: [] });
    expect(remaining).toEqual([]);
  });

  it('does NOT collect on edge-touch (strict AABB overlap)', () => {
    // Player at [0,16]x[0,16]; coin at [16,32]x[0,16]. Edges touch at x=16.
    const c = coin(1, { x: 16, y: 0, width: 16, height: 16 });
    const { collected, remaining } = derivePickups(PLAYER_AT_ORIGIN, [c], { collected: [] });
    expect(collected).toEqual([]);
    expect(remaining).toEqual([c]);
  });

  it('collects on 1px overlap', () => {
    // Player at [0,16]x[0,16]; coin at [15,31]x[0,16]. 1px overlap on x.
    const c = coin(1, { x: 15, y: 0, width: 16, height: 16 });
    const { collected } = derivePickups(PLAYER_AT_ORIGIN, [c], { collected: [] });
    expect(collected).toContain(1);
  });
});

describe('derivePickups — no overlap → unchanged', () => {
  it('returns empty collected when no rects overlap', () => {
    const far: CollectibleEntity = {
      id: 1,
      kind: 'collectible',
      rect: { x: 1000, y: 1000, width: 16, height: 16 },
      props: { kind: 'coin' },
    };
    const { collected, remaining } = derivePickups(PLAYER_AT_ORIGIN, [far], { collected: [] });
    expect(collected).toEqual([]);
    expect(remaining).toEqual([far]);
  });

  it('preserves entity order in remaining when nothing is collected', () => {
    const cs = [
      coin(1, { x: 100, y: 100, width: 16, height: 16 }),
      coin(2, { x: 200, y: 200, width: 16, height: 16 }),
    ];
    const { remaining } = derivePickups(PLAYER_AT_ORIGIN, cs, { collected: [] });
    expect(remaining.map((c) => c.id)).toEqual([1, 2]);
  });
});

describe('derivePickups — already-collected skipped (idempotent)', () => {
  it('does not re-collect an id already in save.collected', () => {
    const c = coin(1, { x: 0, y: 0, width: 16, height: 16 });
    const save: CollectibleSave = { collected: ['1'] };
    const { collected, remaining } = derivePickups(PLAYER_AT_ORIGIN, [c], save);
    expect(collected).toEqual([]);
    // Already-collected entities are excluded from remaining (consumer has
    // already picked them up; they shouldn't render or collide again).
    expect(remaining).toEqual([]);
  });

  it('skips already-collected but still collects new overlaps', () => {
    const already = coin(1, { x: 0, y: 0, width: 16, height: 16 });
    const fresh = coin(2, { x: 0, y: 0, width: 16, height: 16 });
    const save: CollectibleSave = { collected: ['1'] };
    const { collected, remaining } = derivePickups(PLAYER_AT_ORIGIN, [already, fresh], save);
    expect(collected).toEqual([2]);
    expect(remaining).toEqual([]);
  });
});

describe('derivePickups — multiple overlaps in one call', () => {
  it('collects every overlapping entity in one call', () => {
    const cs = [
      coin(1, { x: 0, y: 0, width: 16, height: 16 }),
      coin(2, { x: 8, y: 8, width: 16, height: 16 }),
      coin(3, { x: 100, y: 100, width: 16, height: 16 }),
    ];
    const player = { x: 0, y: 0, width: 32, height: 32 };
    const { collected, remaining } = derivePickups(player, cs, { collected: [] });
    expect(collected).toContain(1);
    expect(collected).toContain(2);
    expect(collected).not.toContain(3);
    expect(remaining.map((c) => c.id)).toEqual([3]);
  });
});

describe('derivePickups — determinism', () => {
  it('produces byte-identical output across 10 repeated calls', () => {
    const cs = [
      coin(1, { x: 0, y: 0, width: 16, height: 16 }),
      coin(2, { x: 100, y: 100, width: 16, height: 16 }),
      coin(3, { x: 0, y: 0, width: 8, height: 8 }),
    ];
    const save: CollectibleSave = { collected: ['3'] };
    const player = { x: 0, y: 0, width: 16, height: 16 };
    const expected = JSON.stringify(derivePickups(player, cs, save));
    for (let i = 0; i < 10; i++) {
      const actual = JSON.stringify(derivePickups(player, cs, save));
      expect(actual).toEqual(expected);
    }
  });
});

describe('derivePickups — defensive (never throw)', () => {
  it('never throws on a malformed save', () => {
    const c = coin(1, { x: 0, y: 0, width: 16, height: 16 });
    expect(() =>
      derivePickups(PLAYER_AT_ORIGIN, [c], null as unknown as CollectibleSave),
    ).not.toThrow();
    expect(() =>
      derivePickups(PLAYER_AT_ORIGIN, [c], { collected: 'nope' } as unknown as CollectibleSave),
    ).not.toThrow();
  });

  it('never throws on a malformed collectibles array', () => {
    expect(() =>
      derivePickups(
        PLAYER_AT_ORIGIN,
        null as unknown as readonly CollectibleEntity[],
        { collected: [] },
      ),
    ).not.toThrow();
    expect(() =>
      derivePickups(
        PLAYER_AT_ORIGIN,
        [null as unknown as CollectibleEntity],
        { collected: [] },
      ),
    ).not.toThrow();
  });
});
