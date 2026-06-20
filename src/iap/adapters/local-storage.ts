/**
 * localStorage-backed IAP adapter (Pillar 3, host-touching layer).
 *
 * Mock store for local development that persists across page reloads.
 * Follows the canonical defensive adapter pattern (`src/primitives/motion.ts`):
 *
 *   - **Lazy host resolution** — `window.localStorage` is resolved INSIDE the
 *     adapter's methods, never at module load. This makes the module safe to
 *     import in Node / SSR / test environments where `window` is undefined.
 *   - **Swallow all errors** — any `localStorage` failure (QuotaExceeded,
 *     disabled cookies, SecurityError on `file://`, etc.) is caught and the
 *     adapter silently falls back to an in-process `Set`.
 *   - **Never-throw / never-reject public API** — invalid inputs resolve to
 *     a `'failed'` transaction.
 *
 * The lazy probe result is cached per adapter instance after the first
 * successful or failed resolution (matches `motion.ts`'s cache-once
 * discipline). Subsequent calls reuse the cached `Storage | null` instead of
 * re-probing.
 *
 * **Zero cross-pillar imports.**
 *
 * @module
 */

import {
  DEFAULT_IAP_CATALOG,
  DEFAULT_IAP_STORAGE_KEY,
  TX_STATE_APPROVED,
  TX_STATE_FAILED,
} from '../constants';
import type { IAPBridge, IAPProduct, IAPTransaction } from '../types';

/** Configuration for {@link createLocalStorageIAPAdapter}. */
export interface LocalStorageIAPAdapterConfig {
  /** localStorage key for the persisted SKU list. Defaults to {@link DEFAULT_IAP_STORAGE_KEY}. */
  readonly storageKey?: string;
  /** Catalog of products available for purchase. Defaults to {@link DEFAULT_IAP_CATALOG}. */
  readonly catalog?: readonly IAPProduct[];
}

/**
 * Create a localStorage-backed IAP adapter for local development.
 *
 * Persists purchased SKUs to `window.localStorage` under the configured key
 * (or {@link DEFAULT_IAP_STORAGE_KEY}). When `window.localStorage` is
 * unavailable (Node, SSR, test env, disabled cookies), silently degrades to
 * an in-memory `Set` so the adapter remains usable for smoke testing.
 *
 * Same behavioural contract as {@link createMemoryIAPAdapter}: never rejects,
 * invalid SKUs resolve to `'failed'` transactions, `onTransaction` fires on
 * every purchase attempt.
 *
 * @param config - Optional storage key + catalog override.
 * @returns A defensive {@link IAPBridge} backed by localStorage (or in-memory).
 *
 * @example
 * ```ts
 * const bridge = createLocalStorageIAPAdapter({
 *   storageKey: 'my-game-iap',
 *   catalog: [{ id: 'com.game.skin_a', type: 'non_consumable', ... }],
 * });
 * await bridge.initialize();
 * await bridge.purchase('com.game.skin_a'); // persisted across reloads
 * ```
 */
export function createLocalStorageIAPAdapter(
  config?: LocalStorageIAPAdapterConfig,
): IAPBridge {
  const storageKey: string =
    typeof config?.storageKey === 'string' && config.storageKey.length > 0
      ? config.storageKey
      : DEFAULT_IAP_STORAGE_KEY;

  const catalog: readonly IAPProduct[] = Array.isArray(config?.catalog)
    ? (config as LocalStorageIAPAdapterConfig).catalog!.slice()
    : DEFAULT_IAP_CATALOG.slice();

  const inMemoryFallback = new Set<string>();
  const subscribers = new Set<(tx: IAPTransaction) => void>();
  let initialized = false;
  let txCounter = 0;

  // Lazily-resolved-and-cached storage handle. `null` once probed (whether
  // localStorage was found or not) so we don't re-probe on every call.
  let cachedStorage: Storage | null | undefined = undefined;

  function resolveStorage(): Storage | null {
    if (cachedStorage !== undefined) return cachedStorage;
    try {
      const w = (globalThis as { window?: unknown }).window;
      if (typeof w !== 'object' || w === null) {
        cachedStorage = null;
        return null;
      }
      const ls = (w as { localStorage?: unknown }).localStorage;
      if (typeof ls !== 'object' || ls === null) {
        cachedStorage = null;
        return null;
      }
      cachedStorage = ls as Storage;
      return cachedStorage;
    } catch {
      cachedStorage = null;
      return null;
    }
  }

  function loadEntitlements(): Set<string> {
    const ls = resolveStorage();
    if (!ls) return inMemoryFallback;
    try {
      const raw = ls.getItem(storageKey);
      if (!raw) return inMemoryFallback;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return inMemoryFallback;
      const valid = parsed.filter((s): s is string => typeof s === 'string');
      return new Set(valid);
    } catch {
      return inMemoryFallback;
    }
  }

  function persistEntitlements(ents: Set<string>): void {
    const ls = resolveStorage();
    const sorted = Array.from(ents).sort();
    if (!ls) {
      inMemoryFallback.clear();
      for (const s of sorted) inMemoryFallback.add(s);
      return;
    }
    try {
      ls.setItem(storageKey, JSON.stringify(sorted));
    } catch {
      // Fall back to in-memory so the purchase isn't lost within this session.
      inMemoryFallback.clear();
      for (const s of sorted) inMemoryFallback.add(s);
    }
  }

  function makeTxId(): string {
    return `ls-tx-${txCounter++}`;
  }

  function knownSku(sku: unknown): IAPProduct | undefined {
    if (typeof sku !== 'string' || sku.length === 0) return undefined;
    return catalog.find((p) => p.id === sku);
  }

  function notify(tx: IAPTransaction): void {
    for (const cb of subscribers) {
      try {
        cb(tx);
      } catch {
        // Subscriber exceptions must never propagate out of the adapter.
      }
    }
  }

  function buildApprovedTx(sku: string): IAPTransaction {
    return {
      id: makeTxId(),
      sku,
      state: TX_STATE_APPROVED,
      receipt: `ls-receipt-${sku}`,
    };
  }

  function buildFailedTx(sku: string, reason: string): IAPTransaction {
    const safeSku = typeof sku === 'string' ? sku : '';
    return {
      id: makeTxId(),
      sku: safeSku,
      state: TX_STATE_FAILED,
      error: reason,
    };
  }

  return {
    async initialize(): Promise<void> {
      // Probing storage here caches the result for later ops.
      resolveStorage();
      initialized = true;
    },

    isInitialized(): boolean {
      return initialized;
    },

    getCatalog(): readonly IAPProduct[] {
      return catalog;
    },

    async getEntitlements(): Promise<readonly string[]> {
      try {
        return Array.from(loadEntitlements()).sort();
      } catch {
        return [];
      }
    },

    async purchase(sku: string): Promise<IAPTransaction> {
      try {
        const product = knownSku(sku);
        if (!product) {
          const tx = buildFailedTx(sku, `Unknown SKU: ${String(sku)}`);
          notify(tx);
          return tx;
        }
        const ents = loadEntitlements();
        ents.add(product.id);
        persistEntitlements(ents);
        const tx = buildApprovedTx(product.id);
        notify(tx);
        return tx;
      } catch {
        const tx = buildFailedTx(sku, 'Adapter error');
        notify(tx);
        return tx;
      }
    },

    async restore(): Promise<readonly IAPTransaction[]> {
      try {
        return Array.from(loadEntitlements())
          .sort()
          .map((sku) => buildApprovedTx(sku));
      } catch {
        return [];
      }
    },

    onTransaction(callback: (tx: IAPTransaction) => void): () => void {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
  };
}
