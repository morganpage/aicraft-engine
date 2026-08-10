/**
 * IAP Bridge module (Pillar 3) — in-app purchase abstractions.
 *
 * Provides types, pure entitlement ops + queue primitives, and defensive
 * adapters for memory (tests) and localStorage (dev). Platform-specific
 * adapters (Poki, direct-IAP platforms) ship in Pillar 5.
 *
 * Determinism summary:
 *   - Pure ops (`grantEntitlement`, `revokeEntitlement`, `flushIAPEvents`,
 *     `drainQueue`, `pushTransaction`) live in the deterministic core: no
 *     `Math.random`, no `Date.now()`, no DOM reads.
 *   - Adapters are host-touching (lazy `window.localStorage` resolution,
 *     swallow errors, never reject).
 *   - `entitlements` is a plain sorted `string[]` (never `Set`/`Map`) for
 *     canonical serialisation.
 *
 * **Zero cross-pillar imports.** `flushIAPEvents` returns `GrantDescriptor[]`
 * for the consumer to compose with `grantSkin` (or equivalent) at their own
 * boundary; this module never imports from `src/cosmetics/` or `src/palette/`.
 *
 * @module
 */

export type {
  ProductType,
  IAPPrice,
  IAPProduct,
  TransactionState,
  IAPTransaction,
  IAPEvent,
  EntitlementSave,
  GrantDescriptor,
  SkuResolver,
  IAPBridge,
} from './types';

export {
  DEFAULT_IAP_STORAGE_KEY,
  PRODUCT_TYPE_NON_CONSUMABLE,
  TX_STATE_APPROVED,
  TX_STATE_FAILED,
  TX_STATE_PENDING,
  TX_STATE_FINISHED,
  DEFAULT_IAP_PRICE,
  DEFAULT_IAP_PRODUCT,
  DEFAULT_IAP_CATALOG,
  DEFAULT_ENTITLEMENT_SAVE,
} from './constants';

export {
  grantEntitlement,
  revokeEntitlement,
  flushIAPEvents,
  drainQueue,
  pushTransaction,
} from './entitlements';

export { createMemoryIAPAdapter, type MemoryIAPAdapterConfig } from './adapters/memory';
export {
  createLocalStorageIAPAdapter,
  type LocalStorageIAPAdapterConfig,
} from './adapters/local-storage';
