import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryIAPAdapter } from '../iap/adapters/memory';
import { createLocalStorageIAPAdapter } from '../iap/adapters/local-storage';
import {
  DEFAULT_IAP_CATALOG,
  DEFAULT_IAP_STORAGE_KEY,
  TX_STATE_APPROVED,
  TX_STATE_FAILED,
} from '../iap/constants';
import type { IAPProduct } from '../iap/types';

/** Build a small catalog fixture with predictable SKUs. */
function fixtureCatalog(): IAPProduct[] {
  return [
    {
      id: 'com.test.skin_a',
      type: 'non_consumable',
      name: 'Skin A',
      description: 'Test skin A.',
      price: { formatted: '$0.99', micros: 990000, currency: 'USD' },
    },
    {
      id: 'com.test.skin_b',
      type: 'non_consumable',
      name: 'Skin B',
      description: 'Test skin B.',
      price: { formatted: '$1.99', micros: 1990000, currency: 'USD' },
    },
  ];
}

/** Minimal in-process localStorage mock keyed by a single storage slot. */
function createMockLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => store.clear()),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    get length() {
      return store.size;
    },
    __store: store,
  };
}

describe('createMemoryIAPAdapter — surface', () => {
  it('returns an object with all IAPBridge methods', () => {
    const bridge = createMemoryIAPAdapter();
    expect(typeof bridge.initialize).toBe('function');
    expect(typeof bridge.isInitialized).toBe('function');
    expect(typeof bridge.getCatalog).toBe('function');
    expect(typeof bridge.getEntitlements).toBe('function');
    expect(typeof bridge.purchase).toBe('function');
    expect(typeof bridge.restore).toBe('function');
    expect(typeof bridge.onTransaction).toBe('function');
  });

  it('isInitialized() is false before initialize()', () => {
    const bridge = createMemoryIAPAdapter();
    expect(bridge.isInitialized()).toBe(false);
  });

  it('initialize() resolves and flips isInitialized() to true', async () => {
    const bridge = createMemoryIAPAdapter();
    await bridge.initialize();
    expect(bridge.isInitialized()).toBe(true);
  });
});

describe('createMemoryIAPAdapter — getCatalog', () => {
  it('returns the default catalog when no config provided', () => {
    const bridge = createMemoryIAPAdapter();
    expect(bridge.getCatalog()).toEqual(DEFAULT_IAP_CATALOG);
  });

  it('returns the configured catalog when provided', () => {
    const catalog = fixtureCatalog();
    const bridge = createMemoryIAPAdapter({ catalog });
    expect(bridge.getCatalog()).toEqual(catalog);
  });
});

describe('createMemoryIAPAdapter — purchase', () => {
  it('resolves to an approved transaction for a known SKU', async () => {
    const catalog = fixtureCatalog();
    const bridge = createMemoryIAPAdapter({ catalog });
    const tx = await bridge.purchase('com.test.skin_a');
    expect(tx.state).toBe(TX_STATE_APPROVED);
    expect(tx.sku).toBe('com.test.skin_a');
    expect(typeof tx.id).toBe('string');
    expect(tx.id.length).toBeGreaterThan(0);
  });

  it('includes a receipt on an approved transaction', async () => {
    const bridge = createMemoryIAPAdapter({ catalog: fixtureCatalog() });
    const tx = await bridge.purchase('com.test.skin_a');
    expect(typeof tx.receipt).toBe('string');
  });

  it('resolves to a failed transaction (NOT a rejection) for an unknown SKU', async () => {
    const bridge = createMemoryIAPAdapter({ catalog: fixtureCatalog() });
    const tx = await bridge.purchase('com.unknown.sku');
    expect(tx.state).toBe(TX_STATE_FAILED);
    expect(tx.sku).toBe('com.unknown.sku');
    expect(typeof tx.error).toBe('string');
  });

  it('resolves to a failed transaction for an empty SKU', async () => {
    const bridge = createMemoryIAPAdapter({ catalog: fixtureCatalog() });
    const tx = await bridge.purchase('');
    expect(tx.state).toBe(TX_STATE_FAILED);
  });

  it('never rejects on any input — non-string SKU returns failed tx', async () => {
    const bridge = createMemoryIAPAdapter({ catalog: fixtureCatalog() });
    await expect(
      bridge.purchase(undefined as unknown as string),
    ).resolves.toBeTruthy();
  });

  it('produces a unique transaction id per call (counter-based)', async () => {
    const bridge = createMemoryIAPAdapter({ catalog: fixtureCatalog() });
    const a = await bridge.purchase('com.test.skin_a');
    const b = await bridge.purchase('com.test.skin_b');
    expect(a.id).not.toBe(b.id);
  });
});

describe('createMemoryIAPAdapter — getEntitlements', () => {
  it('returns an empty array before any purchase', async () => {
    const bridge = createMemoryIAPAdapter({ catalog: fixtureCatalog() });
    expect(await bridge.getEntitlements()).toEqual([]);
  });

  it('returns the list of purchased SKUs after purchases', async () => {
    const bridge = createMemoryIAPAdapter({ catalog: fixtureCatalog() });
    await bridge.purchase('com.test.skin_a');
    await bridge.purchase('com.test.skin_b');
    expect(await bridge.getEntitlements()).toEqual(
      expect.arrayContaining(['com.test.skin_a', 'com.test.skin_b']),
    );
  });

  it('does not include SKUs from failed purchases', async () => {
    const bridge = createMemoryIAPAdapter({ catalog: fixtureCatalog() });
    await bridge.purchase('com.unknown.sku');
    expect(await bridge.getEntitlements()).toEqual([]);
  });

  it('is idempotent — purchasing the same SKU twice yields one entitlement', async () => {
    const bridge = createMemoryIAPAdapter({ catalog: fixtureCatalog() });
    await bridge.purchase('com.test.skin_a');
    await bridge.purchase('com.test.skin_a');
    expect(await bridge.getEntitlements()).toEqual(['com.test.skin_a']);
  });
});

describe('createMemoryIAPAdapter — restore', () => {
  it('returns an empty list before any purchase', async () => {
    const bridge = createMemoryIAPAdapter({ catalog: fixtureCatalog() });
    expect(await bridge.restore()).toEqual([]);
  });

  it('returns approved transactions for previously purchased SKUs', async () => {
    const bridge = createMemoryIAPAdapter({ catalog: fixtureCatalog() });
    await bridge.purchase('com.test.skin_a');
    const restored = await bridge.restore();
    expect(restored).toHaveLength(1);
    expect(restored[0].sku).toBe('com.test.skin_a');
    expect(restored[0].state).toBe(TX_STATE_APPROVED);
  });
});

describe('createMemoryIAPAdapter — onTransaction', () => {
  it('fires the callback with the transaction on purchase', async () => {
    const bridge = createMemoryIAPAdapter({ catalog: fixtureCatalog() });
    const cb = vi.fn();
    bridge.onTransaction(cb);
    await bridge.purchase('com.test.skin_a');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].sku).toBe('com.test.skin_a');
    expect(cb.mock.calls[0][0].state).toBe(TX_STATE_APPROVED);
  });

  it('fires the callback for failed purchases too', async () => {
    const bridge = createMemoryIAPAdapter({ catalog: fixtureCatalog() });
    const cb = vi.fn();
    bridge.onTransaction(cb);
    await bridge.purchase('com.unknown.sku');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].state).toBe(TX_STATE_FAILED);
  });

  it('returns an unsubscribe function that stops future callbacks', async () => {
    const bridge = createMemoryIAPAdapter({ catalog: fixtureCatalog() });
    const cb = vi.fn();
    const unsubscribe = bridge.onTransaction(cb);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    await bridge.purchase('com.test.skin_a');
    expect(cb).not.toHaveBeenCalled();
  });

  it('supports multiple concurrent subscriptions', async () => {
    const bridge = createMemoryIAPAdapter({ catalog: fixtureCatalog() });
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    bridge.onTransaction(cb1);
    bridge.onTransaction(cb2);
    await bridge.purchase('com.test.skin_a');
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('swallows exceptions thrown by a subscriber (never rethrows)', async () => {
    const bridge = createMemoryIAPAdapter({ catalog: fixtureCatalog() });
    bridge.onTransaction(() => {
      throw new Error('subscriber exploded');
    });
    await expect(bridge.purchase('com.test.skin_a')).resolves.toBeTruthy();
  });
});

describe('createLocalStorageIAPAdapter — defensive in Node (no window)', () => {
  it('returns an IAPBridge object without throwing', () => {
    expect(() => createLocalStorageIAPAdapter()).not.toThrow();
    const bridge = createLocalStorageIAPAdapter();
    expect(typeof bridge.purchase).toBe('function');
  });

  it('purchase resolves (does not reject) when no window/localStorage', async () => {
    const bridge = createLocalStorageIAPAdapter({ catalog: fixtureCatalog() });
    const tx = await bridge.purchase('com.test.skin_a');
    expect(tx.state).toBe(TX_STATE_APPROVED);
  });

  it('getEntitlements returns purchased SKUs in-memory when no localStorage', async () => {
    const bridge = createLocalStorageIAPAdapter({ catalog: fixtureCatalog() });
    await bridge.purchase('com.test.skin_a');
    expect(await bridge.getEntitlements()).toEqual(['com.test.skin_a']);
  });
});

describe('createLocalStorageIAPAdapter — persistence with mock localStorage', () => {
  let mockLs: ReturnType<typeof createMockLocalStorage>;

  beforeEach(() => {
    mockLs = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockLs });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does NOT access window.localStorage at adapter creation (lazy)', () => {
    // Clear spy counts that may have been touched by stubGlobal setup.
    mockLs.getItem.mockClear();
    mockLs.setItem.mockClear();
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    createLocalStorageIAPAdapter({ catalog: fixtureCatalog() });
    expect(mockLs.getItem).not.toHaveBeenCalled();
    expect(mockLs.setItem).not.toHaveBeenCalled();
  });

  it('persists purchases to localStorage under the default key', async () => {
    const bridge = createLocalStorageIAPAdapter({ catalog: fixtureCatalog() });
    await bridge.purchase('com.test.skin_a');
    expect(mockLs.setItem).toHaveBeenCalledWith(
      DEFAULT_IAP_STORAGE_KEY,
      expect.any(String),
    );
    const raw = mockLs.__store.get(DEFAULT_IAP_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed).toContain('com.test.skin_a');
  });

  it('restores purchases from localStorage into a new adapter instance', async () => {
    const bridge1 = createLocalStorageIAPAdapter({ catalog: fixtureCatalog() });
    await bridge1.purchase('com.test.skin_a');

    const bridge2 = createLocalStorageIAPAdapter({ catalog: fixtureCatalog() });
    expect(await bridge2.getEntitlements()).toEqual(['com.test.skin_a']);
  });

  it('honours a custom storage key', async () => {
    const bridge = createLocalStorageIAPAdapter({
      catalog: fixtureCatalog(),
      storageKey: 'custom-key',
    });
    await bridge.purchase('com.test.skin_a');
    expect(mockLs.setItem).toHaveBeenCalledWith(
      'custom-key',
      expect.any(String),
    );
  });

  it('swallows localStorage.getItem errors (falls back to empty)', async () => {
    mockLs.getItem.mockImplementation(() => {
      throw new Error('getItem exploded');
    });
    const bridge = createLocalStorageIAPAdapter({ catalog: fixtureCatalog() });
    await expect(bridge.getEntitlements()).resolves.toEqual([]);
  });

  it('swallows localStorage.setItem errors (falls back silently)', async () => {
    mockLs.setItem.mockImplementation(() => {
      throw new Error('setItem exploded');
    });
    const bridge = createLocalStorageIAPAdapter({ catalog: fixtureCatalog() });
    await expect(bridge.purchase('com.test.skin_a')).resolves.toBeTruthy();
  });

  it('restore() returns transactions loaded from localStorage', async () => {
    const bridge1 = createLocalStorageIAPAdapter({ catalog: fixtureCatalog() });
    await bridge1.purchase('com.test.skin_a');

    const bridge2 = createLocalStorageIAPAdapter({ catalog: fixtureCatalog() });
    const restored = await bridge2.restore();
    expect(restored).toHaveLength(1);
    expect(restored[0].sku).toBe('com.test.skin_a');
    expect(restored[0].state).toBe(TX_STATE_APPROVED);
  });
});

describe('createLocalStorageIAPAdapter — onTransaction', () => {
  let mockLs: ReturnType<typeof createMockLocalStorage>;

  beforeEach(() => {
    mockLs = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockLs });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires the callback on purchase', async () => {
    const bridge = createLocalStorageIAPAdapter({ catalog: fixtureCatalog() });
    const cb = vi.fn();
    bridge.onTransaction(cb);
    await bridge.purchase('com.test.skin_a');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].state).toBe(TX_STATE_APPROVED);
  });

  it('unsubscribe stops future callbacks', async () => {
    const bridge = createLocalStorageIAPAdapter({ catalog: fixtureCatalog() });
    const cb = vi.fn();
    const off = bridge.onTransaction(cb);
    off();
    await bridge.purchase('com.test.skin_a');
    expect(cb).not.toHaveBeenCalled();
  });
});
