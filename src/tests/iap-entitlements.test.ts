import { describe, it, expect } from 'vitest';
import {
  grantEntitlement,
  revokeEntitlement,
  flushIAPEvents,
  drainQueue,
  pushTransaction,
} from '../iap/entitlements';
import type {
  EntitlementSave,
  IAPEvent,
  IAPTransaction,
  SkuResolver,
} from '../iap/types';

function emptySave(): EntitlementSave {
  return { entitlements: [], receipts: {} };
}

const noopResolver: SkuResolver = () => [];

describe('grantEntitlement', () => {
  it('returns a new object (not the input reference) for a valid sku', () => {
    const save = emptySave();
    expect(grantEntitlement(save, 'a')).not.toBe(save);
  });

  it('does not mutate the input (deep equality with snapshot)', () => {
    const save: EntitlementSave = {
      entitlements: ['b'],
      receipts: { b: 'r-b' },
    };
    const snapshot = JSON.parse(JSON.stringify(save));
    grantEntitlement(save, 'a');
    expect(save).toEqual(snapshot);
  });

  it('adds the granted sku', () => {
    const next = grantEntitlement(emptySave(), 'a');
    expect(next.entitlements).toContain('a');
  });

  it('keeps entitlements in canonical alphabetical order regardless of grant order', () => {
    let save = emptySave();
    save = grantEntitlement(save, 'c');
    save = grantEntitlement(save, 'a');
    save = grantEntitlement(save, 'b');
    expect(save.entitlements).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op (equal values) on a duplicate sku', () => {
    const save: EntitlementSave = {
      entitlements: ['a', 'b'],
      receipts: {},
    };
    const next = grantEntitlement(save, 'a');
    expect(next.entitlements).toEqual(['a', 'b']);
  });

  it('is a no-op (returns fresh clone) on an empty-string sku', () => {
    const save: EntitlementSave = { entitlements: ['a'], receipts: {} };
    const next = grantEntitlement(save, '');
    expect(next.entitlements).toEqual(['a']);
  });

  it('is a no-op on a non-string sku', () => {
    const save: EntitlementSave = { entitlements: ['a'], receipts: {} };
    expect(
      grantEntitlement(save, undefined as unknown as string).entitlements,
    ).toEqual(['a']);
  });

  it('stores the receipt when provided', () => {
    const next = grantEntitlement(emptySave(), 'a', 'receipt-a');
    expect(next.receipts.a).toBe('receipt-a');
  });

  it('does not overwrite an existing receipt when called without one', () => {
    const save: EntitlementSave = {
      entitlements: ['a'],
      receipts: { a: 'old' },
    };
    const next = grantEntitlement(save, 'a');
    expect(next.receipts.a).toBe('old');
  });

  it('does not store an empty-string receipt', () => {
    const next = grantEntitlement(emptySave(), 'a', '');
    expect(next.receipts.a).toBeUndefined();
  });

  it('JSON-clone verified: mutating the returned save does not affect the input', () => {
    const save = emptySave();
    const next = grantEntitlement(save, 'b');
    next.entitlements.push('HACK');
    next.receipts.HACK = 'x';
    expect(save.entitlements).toEqual([]);
    expect(save.receipts).toEqual({});
  });
});

describe('grantEntitlement — defensive (never throws)', () => {
  it('never throws on a malformed save with missing fields', () => {
    const malformed = {
      entitlements: undefined,
      receipts: undefined,
    } as unknown as EntitlementSave;
    expect(() => grantEntitlement(malformed, 'a')).not.toThrow();
  });

  it('never throws on a null save', () => {
    expect(() =>
      grantEntitlement(null as unknown as EntitlementSave, 'a'),
    ).not.toThrow();
  });

  it('produces a well-formed save from a malformed input', () => {
    const malformed = {
      entitlements: undefined,
      receipts: undefined,
    } as unknown as EntitlementSave;
    const next = grantEntitlement(malformed, 'a');
    expect(Array.isArray(next.entitlements)).toBe(true);
    expect(next.entitlements).toContain('a');
    expect(next.receipts).toEqual({});
  });
});

describe('revokeEntitlement', () => {
  it('returns a new object (not the input reference) when removing a sku', () => {
    const save: EntitlementSave = {
      entitlements: ['a'],
      receipts: { a: 'r-a' },
    };
    expect(revokeEntitlement(save, 'a')).not.toBe(save);
  });

  it('removes the sku from entitlements', () => {
    const save: EntitlementSave = {
      entitlements: ['a', 'b', 'c'],
      receipts: {},
    };
    expect(revokeEntitlement(save, 'b').entitlements).toEqual(['a', 'c']);
  });

  it('removes the associated receipt', () => {
    const save: EntitlementSave = {
      entitlements: ['a', 'b'],
      receipts: { a: 'r-a', b: 'r-b' },
    };
    const next = revokeEntitlement(save, 'a');
    expect(next.receipts.a).toBeUndefined();
    expect(next.receipts.b).toBe('r-b');
  });

  it('is a no-op (equal values) for a sku that is not present', () => {
    const save: EntitlementSave = {
      entitlements: ['a'],
      receipts: { a: 'r-a' },
    };
    const next = revokeEntitlement(save, 'z');
    expect(next.entitlements).toEqual(['a']);
    expect(next.receipts).toEqual({ a: 'r-a' });
  });

  it('is a no-op on an empty-string sku', () => {
    const save: EntitlementSave = {
      entitlements: ['a'],
      receipts: { a: 'r-a' },
    };
    expect(revokeEntitlement(save, '').entitlements).toEqual(['a']);
  });

  it('is pure (does not mutate the input)', () => {
    const save: EntitlementSave = {
      entitlements: ['a', 'b'],
      receipts: { a: 'r-a', b: 'r-b' },
    };
    const snapshot = JSON.parse(JSON.stringify(save));
    revokeEntitlement(save, 'a');
    expect(save).toEqual(snapshot);
  });

  it('never throws on a malformed save', () => {
    const malformed = {} as EntitlementSave;
    expect(() => revokeEntitlement(malformed, 'a')).not.toThrow();
  });
});

describe('flushIAPEvents', () => {
  it('returns an object with save and grants fields', () => {
    const result = flushIAPEvents(emptySave(), [], noopResolver);
    expect(result).toHaveProperty('save');
    expect(result).toHaveProperty('grants');
    expect(Array.isArray(result.grants)).toBe(true);
  });

  it('is a no-op (value-equal save, empty grants) on empty events', () => {
    const save: EntitlementSave = {
      entitlements: ['a'],
      receipts: { a: 'r-a' },
    };
    const result = flushIAPEvents(save, [], noopResolver);
    expect(result.save.entitlements).toEqual(['a']);
    expect(result.save.receipts).toEqual({ a: 'r-a' });
    expect(result.grants).toEqual([]);
  });

  it('grants an entitlement on a `purchase` event', () => {
    const events: IAPEvent[] = [
      { type: 'purchase', sku: 'com.game.skin_a', txId: 'tx-1' },
    ];
    const result = flushIAPEvents(emptySave(), events, noopResolver);
    expect(result.save.entitlements).toContain('com.game.skin_a');
  });

  it('grants an entitlement on a `restore` event', () => {
    const events: IAPEvent[] = [
      { type: 'restore', sku: 'com.game.skin_a', txId: 'tx-1' },
    ];
    const result = flushIAPEvents(emptySave(), events, noopResolver);
    expect(result.save.entitlements).toContain('com.game.skin_a');
  });

  it('revokes an entitlement on a `revoke` event', () => {
    const save: EntitlementSave = {
      entitlements: ['com.game.skin_a'],
      receipts: { 'com.game.skin_a': 'r' },
    };
    const events: IAPEvent[] = [
      { type: 'revoke', sku: 'com.game.skin_a', txId: 'tx-1' },
    ];
    const result = flushIAPEvents(save, events, noopResolver);
    expect(result.save.entitlements).not.toContain('com.game.skin_a');
    expect(result.save.receipts['com.game.skin_a']).toBeUndefined();
  });

  it('collects grant descriptors from the resolver for purchase events', () => {
    const resolver: SkuResolver = (sku) =>
      sku === 'com.game.bundle'
        ? [
            { target: 'skin', targetId: 'skin-a' },
            { target: 'skin', targetId: 'skin-b' },
          ]
        : [];
    const events: IAPEvent[] = [
      { type: 'purchase', sku: 'com.game.bundle', txId: 'tx-1' },
    ];
    const result = flushIAPEvents(emptySave(), events, resolver);
    expect(result.grants).toEqual([
      { target: 'skin', targetId: 'skin-a' },
      { target: 'skin', targetId: 'skin-b' },
    ]);
  });

  it('collects grant descriptors from the resolver for restore events', () => {
    const resolver: SkuResolver = (sku) =>
      sku === 'com.game.skin_a' ? [{ target: 'skin', targetId: 'skin-a' }] : [];
    const events: IAPEvent[] = [
      { type: 'restore', sku: 'com.game.skin_a', txId: 'tx-1' },
    ];
    const result = flushIAPEvents(emptySave(), events, resolver);
    expect(result.grants).toEqual([{ target: 'skin', targetId: 'skin-a' }]);
  });

  it('does NOT collect grant descriptors for revoke events', () => {
    const resolver: SkuResolver = () => [{ target: 'skin', targetId: 'x' }];
    const save: EntitlementSave = { entitlements: ['sku'], receipts: {} };
    const events: IAPEvent[] = [
      { type: 'revoke', sku: 'sku', txId: 'tx-1' },
    ];
    const result = flushIAPEvents(save, events, resolver);
    expect(result.grants).toEqual([]);
  });

  it('returns an empty grants array for unknown SKUs (resolver returns [])', () => {
    const events: IAPEvent[] = [
      { type: 'purchase', sku: 'unknown', txId: 'tx-1' },
    ];
    const result = flushIAPEvents(emptySave(), events, noopResolver);
    expect(result.grants).toEqual([]);
    expect(result.save.entitlements).toContain('unknown');
  });

  it('processes events in array order (deterministic)', () => {
    const resolver: SkuResolver = (sku) =>
      sku === 'a' ? [{ target: 'skin', targetId: 'A' }] : [];
    const events: IAPEvent[] = [
      { type: 'purchase', sku: 'a', txId: 'tx-1' },
      { type: 'purchase', sku: 'b', txId: 'tx-2' },
      { type: 'revoke', sku: 'a', txId: 'tx-3' },
    ];
    const result = flushIAPEvents(emptySave(), events, resolver);
    expect(result.save.entitlements).toEqual(['b']);
    expect(result.grants).toEqual([{ target: 'skin', targetId: 'A' }]);
  });

  it('is pure (does not mutate the input save or events)', () => {
    const save: EntitlementSave = { entitlements: ['a'], receipts: {} };
    const events: IAPEvent[] = [
      { type: 'purchase', sku: 'b', txId: 'tx-1' },
    ];
    const saveSnapshot = JSON.parse(JSON.stringify(save));
    const eventsSnapshot = JSON.parse(JSON.stringify(events));
    flushIAPEvents(save, events, noopResolver);
    expect(save).toEqual(saveSnapshot);
    expect(events).toEqual(eventsSnapshot);
  });

  it('never throws on malformed events', () => {
    const malformedEvents = [
      null,
      undefined,
      { type: 'purchase' },
      { type: 'unknown', sku: 'x', txId: 't' },
      { type: 'purchase', sku: 42, txId: 't' },
      { type: 'purchase', sku: '', txId: 't' },
    ] as unknown as IAPEvent[];
    expect(() =>
      flushIAPEvents(emptySave(), malformedEvents, noopResolver),
    ).not.toThrow();
  });
});

describe('drainQueue', () => {
  it('returns { drained, next }', () => {
    const result = drainQueue([]);
    expect(result).toHaveProperty('drained');
    expect(result).toHaveProperty('next');
  });

  it('returns all input events as `drained`', () => {
    const events: IAPEvent[] = [
      { type: 'purchase', sku: 'a', txId: 't1' },
      { type: 'restore', sku: 'b', txId: 't2' },
    ];
    const result = drainQueue(events);
    expect(result.drained).toEqual(events);
  });

  it('returns an empty array as `next`', () => {
    const events: IAPEvent[] = [
      { type: 'purchase', sku: 'a', txId: 't1' },
    ];
    const result = drainQueue(events);
    expect(result.next).toEqual([]);
  });

  it('returns an empty drained array for empty input', () => {
    const result = drainQueue([]);
    expect(result.drained).toEqual([]);
    expect(result.next).toEqual([]);
  });

  it('is pure: `drained` is a fresh array, not the input reference', () => {
    const events: IAPEvent[] = [
      { type: 'purchase', sku: 'a', txId: 't1' },
    ];
    const result = drainQueue(events);
    expect(result.drained).not.toBe(events);
  });

  it('is pure: mutating `drained` does not affect the input', () => {
    const events: IAPEvent[] = [
      { type: 'purchase', sku: 'a', txId: 't1' },
    ];
    const result = drainQueue(events);
    (result.drained as IAPEvent[]).push({
      type: 'purchase',
      sku: 'HACK',
      txId: 'HACK',
    });
    expect(events.length).toBe(1);
  });
});

describe('pushTransaction', () => {
  const approvedTx: IAPTransaction = {
    id: 'tx-1',
    sku: 'com.game.skin_a',
    state: 'approved',
    receipt: 'r-1',
  };

  it('returns a new array reference (not the input)', () => {
    const events: IAPEvent[] = [];
    const next = pushTransaction(events, approvedTx);
    expect(next).not.toBe(events);
  });

  it('appends a `purchase` event for an approved transaction', () => {
    const events: IAPEvent[] = [];
    const next = pushTransaction(events, approvedTx);
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({
      type: 'purchase',
      sku: 'com.game.skin_a',
      txId: 'tx-1',
    });
  });

  it('preserves existing events in order', () => {
    const events: IAPEvent[] = [
      { type: 'purchase', sku: 'prior', txId: 'tx-0' },
    ];
    const next = pushTransaction(events, approvedTx);
    expect(next).toHaveLength(2);
    expect(next[0].txId).toBe('tx-0');
    expect(next[1].txId).toBe('tx-1');
  });

  it('returns the input array unchanged for a `failed` transaction', () => {
    const events: IAPEvent[] = [];
    const failedTx: IAPTransaction = {
      id: 'tx-2',
      sku: 'com.game.skin_a',
      state: 'failed',
      error: 'declined',
    };
    const next = pushTransaction(events, failedTx);
    expect(next).toEqual([]);
  });

  it('returns the input array unchanged for a `pending` transaction', () => {
    const events: IAPEvent[] = [];
    const pendingTx: IAPTransaction = {
      id: 'tx-3',
      sku: 'com.game.skin_a',
      state: 'pending',
    };
    const next = pushTransaction(events, pendingTx);
    expect(next).toEqual([]);
  });

  it('returns the input array unchanged for a `finished` transaction', () => {
    const events: IAPEvent[] = [];
    const finishedTx: IAPTransaction = {
      id: 'tx-4',
      sku: 'com.game.skin_a',
      state: 'finished',
    };
    const next = pushTransaction(events, finishedTx);
    expect(next).toEqual([]);
  });

  it('is pure (does not mutate the input)', () => {
    const events: IAPEvent[] = [];
    const snapshot = JSON.parse(JSON.stringify(events));
    pushTransaction(events, approvedTx);
    expect(events).toEqual(snapshot);
  });
});

describe('determinism (same inputs → same outputs)', () => {
  it('grantEntitlement: same save + sku → value-equal results across calls', () => {
    const save = emptySave();
    const a = grantEntitlement(save, 'z');
    const b = grantEntitlement(save, 'z');
    expect(a).toEqual(b);
  });

  it('flushIAPEvents: same save + events + resolver → value-equal results', () => {
    const save = emptySave();
    const events: IAPEvent[] = [
      { type: 'purchase', sku: 'a', txId: 't1' },
      { type: 'revoke', sku: 'a', txId: 't2' },
    ];
    const resolver: SkuResolver = (sku) =>
      sku === 'a' ? [{ target: 'skin', targetId: 'A' }] : [];
    const a = flushIAPEvents(save, events, resolver);
    const b = flushIAPEvents(save, events, resolver);
    expect(a).toEqual(b);
  });
});
