/**
 * Type definitions for the IAP bridge module (Pillar 3).
 *
 * Mirrors the cosmetics module's discipline: every field is a primitive or
 * plain object so the whole shape survives a JSON round-trip and reproduces
 * identically across engines. No timestamps, no functions, no `Set`/`Map`.
 *
 * **Zero cross-pillar imports.** `EntitlementSave` is a pure overlay that
 * contains NO cosmetic fields (`owned`/`equipped`). The consumer nests it as
 * a sibling sub-object alongside `CosmeticSave` in their `SaveData` and
 * composes them at the tick boundary via the `GrantDescriptor[]` returned
 * from `flushIAPEvents`. This keeps Pillar 3 independently tree-shakeable
 * from Pillar 2.
 *
 * @module
 */

/**
 * Product type. v1 is non-consumable only; consumables and subscriptions
 * are deferred to v2 (would require server-side receipt validation, which
 * contradicts the zero-dep invariant).
 */
export type ProductType = 'non_consumable';

/**
 * Price representation. Both a localized display string and raw micro-units
 * are stored so the UI can show `"1,99 €"` while the logic layer sorts and
 * compares by raw `micros`. The `micros` convention matches Apple StoreKit 2
 * and Google Play Billing's native formats — no adapter-side conversion.
 */
export interface IAPPrice {
  /** Localized display string (e.g. `'$1.99'`, `'1,99 €'`). For UI labels. */
  readonly formatted: string;
  /** Raw price in micro-units (e.g. `1990000`). For sorting, comparison, analytics. */
  readonly micros: number;
  /** ISO 4217 currency code (e.g. `'USD'`). For display, not logic. */
  readonly currency: string;
}

/**
 * A product in the store catalog. Immutable — loaded once via
 * `IAPBridge.getCatalog()`, read many times by UI code.
 */
export interface IAPProduct {
  /** Store-unique product identifier (e.g. `'com.game.neon_devil'`). */
  readonly id: string;
  /** Product type. Always `'non_consumable'` in v1. */
  readonly type: ProductType;
  /** User-facing display name. */
  readonly name: string;
  /** User-facing description. */
  readonly description: string;
  /** Localised price record. */
  readonly price: IAPPrice;
}

/**
 * Transaction lifecycle state. Mirrors StoreKit 2 / Play Billing: a purchase
 * moves `pending → approved → finished` on success, or `→ failed` on error.
 */
export type TransactionState = 'pending' | 'approved' | 'finished' | 'failed';

/**
 * A platform transaction record. The adapter produces these; the consumer
 * feeds them to `pushTransaction` to convert into a normalised {@link IAPEvent}.
 */
export interface IAPTransaction {
  /** Adapter-assigned transaction id (opaque to the library). */
  readonly id: string;
  /** The SKU this transaction applies to. */
  readonly sku: string;
  /** Current lifecycle state. */
  readonly state: TransactionState;
  /** Opaque receipt string from the platform. The library never parses this. */
  readonly receipt?: string;
  /** Human-readable error message when `state === 'failed'`. */
  readonly error?: string;
}

/**
 * Normalised event produced by draining the IAP event queue. Plain data — no
 * functions, no host references — so it can safely enter the deterministic
 * sim core.
 */
export interface IAPEvent {
  /**
   * `'purchase'` for successful purchases, `'restore'` for items re-granted
   * by `bridge.restore()`, `'revoke'` for refund / revocation detection.
   */
  readonly type: 'purchase' | 'restore' | 'revoke';
  /** The SKU this event applies to. */
  readonly sku: string;
  /** Originating transaction id (for traceability; opaque to the library). */
  readonly txId: string;
}

/**
 * Player entitlement state — a pure overlay for IAP purchase records.
 *
 * `entitlements` is a plain, alphabetically-sorted `string[]` (never a
 * `Set`/`Map`) for deterministic serialisation. `receipts` maps SKU → opaque
 * receipt string for future re-validation by the consumer.
 *
 * **This type contains NO cosmetic state.** The consumer nests
 * `EntitlementSave` and `CosmeticSave` as sibling sub-objects in their
 * `SaveData` and composes them at the tick boundary.
 *
 * Fields are intentionally NOT `readonly`: the pure entitlement ops clone the
 * save via JSON round-trip then mutate the clone in place (mirrors
 * `src/cosmetics/ownership.ts`). Purity is enforced by the clone-then-return
 * discipline, not by field modifiers.
 */
export interface EntitlementSave {
  /** Sorted, deduped SKUs the player has purchased. */
  entitlements: string[];
  /** SKU → receipt string for re-validation. */
  receipts: Record<string, string>;
}

/**
 * Describes one entitlement grant. The `target` field is an open union
 * (`'skin'` today; `'bundle'`, `'currency'`, etc. later) so the library can
 * grow without breaking consumers.
 */
export interface GrantDescriptor {
  /** What the SKU grants. v1: `'skin'` only. */
  readonly target: 'skin';
  /** Target identifier (e.g. the skin ID the consumer passes to `grantSkin`). */
  readonly targetId: string;
}

/**
 * Maps a purchased SKU to the entitlement(s) it grants.
 *
 * Consumer-provided — the library never embeds SKU metadata in content data
 * (would couple content authoring to store configuration). The resolver is
 * free to return multiple descriptors for bundle SKUs, or an empty array for
 * unknown SKUs (a valid no-op).
 */
export type SkuResolver = (sku: string) => readonly GrantDescriptor[];

/**
 * Host-touching adapter interface. Mirrors Spitekeep's `SaveStorage` shape.
 *
 * Public APIs of adapters **never throw** and **never reject** — they degrade
 * gracefully. This makes them safe to call from code that must not crash the
 * sim. Implementations: `createMemoryIAPAdapter` (tests),
 * `createLocalStorageIAPAdapter` (dev). Poki/Jest adapters ship in Pillar 5.
 */
export interface IAPBridge {
  /** Initialise the adapter (lazy host probe, network warm-up, etc.). */
  initialize(): Promise<void>;
  /** `true` after the first successful `initialize()` call. */
  isInitialized(): boolean;
  /** Return the product catalog. Sync — loaded once, read many. */
  getCatalog(): readonly IAPProduct[];
  /** Return the SKUs purchased through this adapter instance. */
  getEntitlements(): Promise<readonly string[]>;
  /** Trigger a purchase. Resolves to a transaction (never rejects). */
  purchase(sku: string): Promise<IAPTransaction>;
  /** Restore previous purchases. Resolves to a transaction list (never rejects). */
  restore(): Promise<readonly IAPTransaction[]>;
  /**
   * Subscribe to transaction events. The callback fires asynchronously after
   * every purchase attempt (success or failure). Returns an unsubscribe
   * function.
   */
  onTransaction(callback: (tx: IAPTransaction) => void): () => void;
}
