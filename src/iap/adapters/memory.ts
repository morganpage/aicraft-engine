/**
 * In-memory IAP adapter (Pillar 3, host-touching layer).
 *
 * Mock store for tests and quick smoke runs. No host API access. All public
 * methods are async and **never reject** — invalid inputs resolve to a
 * `'failed'` transaction, never an exception. Follows the defensive adapter
 * pattern described in `docs/architecture.md` (lazy host resolution, swallow
 * errors, never-throw). Here the "host" is just in-process state, but the
 * same shape is used so consumers can swap in a localStorage or platform
 * adapter without code changes.
 *
 * **Zero cross-pillar imports.**
 *
 * @module
 */

import {
  DEFAULT_IAP_CATALOG,
  TX_STATE_APPROVED,
  TX_STATE_FAILED,
} from '../constants';
import type { IAPBridge, IAPProduct, IAPTransaction } from '../types';

/** Configuration for {@link createMemoryIAPAdapter}. */
export interface MemoryIAPAdapterConfig {
  /** Catalog of products available for purchase. Defaults to {@link DEFAULT_IAP_CATALOG}. */
  readonly catalog?: readonly IAPProduct[];
}

/**
 * Create an in-memory IAP adapter.
 *
 * - `getCatalog()` returns the configured catalog (or {@link DEFAULT_IAP_CATALOG}).
 * - `purchase(sku)` resolves to an `'approved'` transaction for a known SKU,
 *   `'failed'` for an unknown / invalid SKU (never rejects).
 * - `getEntitlements()` returns the SKUs purchased through this instance.
 * - `restore()` returns `'approved'` transactions for every purchased SKU.
 * - `onTransaction(cb)` fires asynchronously on every purchase attempt
 *   (success or failure) and returns an unsubscribe function.
 *
 * Transaction ids are produced by a per-instance monotonic counter so tests
 * are deterministic across runs (no `Math.random` / `Date.now()`).
 *
 * @param config - Optional catalog override.
 * @returns A defensive {@link IAPBridge} backed by in-process state.
 *
 * @example
 * ```ts
 * const bridge = createMemoryIAPAdapter({
 *   catalog: [{ id: 'com.game.skin_a', type: 'non_consumable', ... }],
 * });
 * await bridge.initialize();
 * const tx = await bridge.purchase('com.game.skin_a');
 * ```
 */
export function createMemoryIAPAdapter(
  config?: MemoryIAPAdapterConfig,
): IAPBridge {
  const catalog: readonly IAPProduct[] = Array.isArray(config?.catalog)
    ? (config as MemoryIAPAdapterConfig).catalog!.slice()
    : DEFAULT_IAP_CATALOG.slice();

  const entitlements = new Set<string>();
  const subscribers = new Set<(tx: IAPTransaction) => void>();
  let initialized = false;
  let txCounter = 0;

  function makeTxId(): string {
    return `mem-tx-${txCounter++}`;
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
      receipt: `mem-receipt-${sku}`,
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
      initialized = true;
    },

    isInitialized(): boolean {
      return initialized;
    },

    getCatalog(): readonly IAPProduct[] {
      return catalog;
    },

    async getEntitlements(): Promise<readonly string[]> {
      return Array.from(entitlements).sort();
    },

    async purchase(sku: string): Promise<IAPTransaction> {
      try {
        const product = knownSku(sku);
        if (!product) {
          const tx = buildFailedTx(sku, `Unknown SKU: ${String(sku)}`);
          notify(tx);
          return tx;
        }
        entitlements.add(product.id);
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
        return Array.from(entitlements)
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
