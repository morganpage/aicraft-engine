/**
 * Tunables and canonical defaults for the IAP bridge module.
 *
 * No magic strings or numbers live outside this file. Consumers and the
 * adapter implementations both import from here.
 *
 * @module
 */

import type { EntitlementSave, IAPPrice, IAPProduct, ProductType, TransactionState } from './types';

/** localStorage key for the mock IAP entitlements store. */
export const DEFAULT_IAP_STORAGE_KEY = 'aicraft-iap-entitlements';

/**
 * Product type constant for non-consumable purchases. v1 ships
 * `'non_consumable'` only; this constant is the canonical reference used by
 * the adapter implementations and any consumer authoring a catalog.
 */
export const PRODUCT_TYPE_NON_CONSUMABLE: ProductType = 'non_consumable';

/** Transaction state: approved (the purchase succeeded). Used by adapters. */
export const TX_STATE_APPROVED: TransactionState = 'approved';

/** Transaction state: failed (the purchase was declined or errored). Used by adapters. */
export const TX_STATE_FAILED: TransactionState = 'failed';

/** Transaction state: pending (the platform is still resolving the purchase). Used by adapters. */
export const TX_STATE_PENDING: TransactionState = 'pending';

/** Transaction state: finished (the purchase is fully consumed). Used by adapters. */
export const TX_STATE_FINISHED: TransactionState = 'finished';

/** Canonical fallback price record used by {@link DEFAULT_IAP_PRODUCT}. */
export const DEFAULT_IAP_PRICE: IAPPrice = {
  formatted: '$0.99',
  micros: 990000,
  currency: 'USD',
};

/**
 * Default product used when no catalog is configured. Lets the no-arg
 * `createMemoryIAPAdapter()` and `createLocalStorageIAPAdapter()` work
 * out-of-the-box for quick smoke tests; consumers override with their own
 * catalog.
 */
export const DEFAULT_IAP_PRODUCT: IAPProduct = {
  id: 'com.aicraft.default',
  type: PRODUCT_TYPE_NON_CONSUMABLE,
  name: 'Default',
  description: 'Default non-consumable product.',
  price: DEFAULT_IAP_PRICE,
};

/** Default catalog: the single {@link DEFAULT_IAP_PRODUCT}. */
export const DEFAULT_IAP_CATALOG: readonly IAPProduct[] = [DEFAULT_IAP_PRODUCT];

/** Empty entitlement save state. Nothing purchased, no receipts. */
export const DEFAULT_ENTITLEMENT_SAVE: EntitlementSave = {
  entitlements: [],
  receipts: {},
};
