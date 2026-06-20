# API Proposal: IAP Bridge

> Target pillar: 3 (IAP Bridge). Module: `src/iap/`.
> Builds on research: `docs/research/iap-bridge.md`.
> Status: REVISED (post-architect NEEDS REVISION).

## Consumer Need

Spitekeep and future Clone-to-Jest siblings need a monetisation surface that works identically across ad-monetised platforms (Poki) and IAP-only platforms (Jest), without dragging in platform SDKs as runtime dependencies. The library must:

1. **Bridge async purchase results into the deterministic sim core** without leaking `Math.random`, `Date.now()`, or host API calls into the game loop.
2. **Provide pure entitlement ops** — immutable in, JSON-clone out, never throw. These manage only `entitlements` and `receipts`; cosmetic mutation is the consumer's responsibility at the composition boundary.
3. **Ship defensive adapters** for memory (tests) and localStorage (dev), with a clear interface for Poki/Jest adapters added later in Pillar 5.
4. **Return grant descriptors** from `flushIAPEvents` so the consumer can bridge into cosmetics (`grantSkin`, etc.) at their own composition boundary. No cross-pillar import from `src/iap/` to `src/cosmetics/`.

Currently Spitekeep has no IAP code. Every skin is hardcoded. This proposal establishes the library-level bridge so that skin purchases can be driven by platform-native billing or ad proxies with zero code changes at the game level.

---

## Approach A: Composable Primitives (Event Queue + Pure Ops + Adapter)

**Source pattern:** Pattern 1 (Event-Driven Unified Store) + Pattern 5 (Pure Entitlement Progression Ops) from the research note. Follows the library's existing "small composable functions" convention — every piece is independently useful and tree-shakeable.

### Core idea

Ship three independent layers that the consumer composes:

1. **Types** (`src/iap/types.ts`) — `IAPProduct`, `IAPTransaction`, `IAPEvent`, `EntitlementSave`, `SkuResolver`, `GrantDescriptor`.
2. **Pure ops** (`src/iap/entitlements.ts`) — `grantEntitlement`, `revokeEntitlement`, `flushIAPEvents`. These take `EntitlementSave` and return a new `EntitlementSave`. `flushIAPEvents` also accepts a `SkuResolver` to compute `GrantDescriptor[]` (returned alongside the save — no cosmetic mutation).
3. **Adapter interface + event queue** (`src/iap/bridge.ts`) — `IAPBridge` interface (host-touching), event queue as plain `IAPEvent[]`, `drainQueue()` and `pushTransaction()` pure ops.

The consumer wires them:

```ts
// Consumer's game loop (deterministic core)
let events: IAPEvent[] = [];

// Consumer's UI layer (host-touching)
bridge.onTransaction((tx) => { events = pushTransaction(events, tx); });

// Consumer's tick function (deterministic core)
function tick(entitlementSave: EntitlementSave, cosmetics: CosmeticSave): {
  entitlements: EntitlementSave;
  cosmetics: CosmeticSave;
} {
  const { drained, next } = drainQueue(events);
  events = next;
  const { save: nextEntitlements, grants } = flushIAPEvents(entitlementSave, drained, resolver);
  let nextCosmetics = cosmetics;
  for (const g of grants) {
    if (g.target === 'skin') nextCosmetics = grantSkin(nextCosmetics, g.targetId);
  }
  return { entitlements: nextEntitlements, cosmetics: nextCosmetics };
}
```

### Signature sketches

```ts
// ─── src/iap/types.ts ───────────────────────────────────────────────

/** Product type. v1 is non-consumable only; consumables deferred to v2. */
export type ProductType = 'non_consumable';

/** Price representation: both formatted string and raw micros for display + comparison. */
export interface IAPPrice {
  /** Localized display string (e.g. `'$1.99'`, `'1,99 €'`). For UI labels. */
  readonly formatted: string;
  /** Raw price in micro-units (e.g. 1990000). For sorting, comparison, analytics. */
  readonly micros: number;
  /** ISO 4217 currency code (e.g. `'USD'`). For display, not logic. */
  readonly currency: string;
}

/** A product in the store catalog. Immutable — loaded once, read many. */
export interface IAPProduct {
  readonly id: string;
  readonly type: ProductType;
  readonly name: string;
  readonly description: string;
  readonly price: IAPPrice;
}

/** Transaction lifecycle state. */
export type TransactionState = 'pending' | 'approved' | 'finished' | 'failed';

/** A platform transaction record. */
export interface IAPTransaction {
  readonly id: string;
  readonly sku: string;
  readonly state: TransactionState;
  /** Receipt string from the platform (opaque to the library). */
  readonly receipt?: string;
  /** Human-readable error on failure. */
  readonly error?: string;
}

/** Normalised event produced by the bridge when a transaction resolves. */
export interface IAPEvent {
  /** `'purchase'` for successful purchases, `'restore'` for restore results, `'revoke'` for refund detection. */
  readonly type: 'purchase' | 'restore' | 'revoke';
  readonly sku: string;
  readonly txId: string;
}

/**
 * Player entitlement state — a pure overlay for IAP purchase records.
 *
 * `entitlements` is a sorted, deduped array of SKUs the player has purchased.
 * `receipts` maps SKU → opaque receipt string for re-validation.
 *
 * This type does NOT contain cosmetic state (`owned`, `equipped`).
 * The consumer nests `EntitlementSave` and `CosmeticSave` as sibling
 * sub-objects in their `SaveData` and composes them at the tick boundary.
 */
export interface EntitlementSave {
  /** Sorted, deduped SKUs the player has purchased. */
  readonly entitlements: string[];
  /** SKU → receipt string for re-validation. */
  readonly receipts: Record<string, string>;
}

/**
 * Maps a purchased SKU to the entitlement(s) it grants.
 *
 * Returns an array of grant descriptors. Each descriptor names a target
 * (`'skin'`) and the target ID. The consumer composes this with `grantSkin`
 * to bridge IAP → cosmetics.
 *
 * Returning an empty array for an unknown SKU is a valid no-op.
 */
export type SkuResolver = (sku: string) => readonly GrantDescriptor[];

/** Describes one entitlement grant. */
export interface GrantDescriptor {
  readonly target: 'skin';
  readonly targetId: string;
}


// ─── src/iap/entitlements.ts ────────────────────────────────────────

/**
 * Pure op: grant a purchased SKU to the player's entitlement save.
 *
 * 1. Adds SKU to `entitlements` (sorted, deduped).
 * 2. Stores the receipt in `receipts`.
 *
 * This op manages only entitlement records. It does NOT mutate cosmetic
 * state — the consumer calls `grantSkin` (or equivalent) at their own
 * composition boundary using the `GrantDescriptor[]` from `flushIAPEvents`.
 *
 * Immutable in → JSON-clone out → never throws. Invalid SKU is a no-op.
 *
 * @param save    - Current entitlement save.
 * @param sku     - Purchased SKU string.
 * @param receipt - Optional receipt string for re-validation.
 */
export function grantEntitlement(
  save: EntitlementSave,
  sku: string,
  receipt?: string,
): EntitlementSave;

/**
 * Pure op: revoke a SKU (e.g. refund detected on restore).
 *
 * Removes SKU from `entitlements`, removes associated receipts.
 * Does NOT automatically unequip skins (the consumer decides whether
 * to call `unequipSkin` or keep the cosmetic visible).
 *
 * Immutable in → JSON-clone out → never throws.
 */
export function revokeEntitlement(
  save: EntitlementSave,
  sku: string,
): EntitlementSave;

/**
 * Pure op: flush a batch of IAP events into the save.
 *
 * Iterates events, calls `grantEntitlement` or `revokeEntitlement`
 * as appropriate. Also resolves each granted SKU via `resolver` to
 * compute `GrantDescriptor[]` — returned alongside the updated save
 * so the consumer can bridge into cosmetics (e.g. `grantSkin`).
 *
 * This is the deterministic seam between the async adapter and the
 * sim core. No cross-pillar imports — the consumer composes at the
 * boundary.
 *
 * @param save     - Current entitlement save.
 * @param events   - Events drained from the queue.
 * @param resolver - SKU → grant descriptors mapping.
 * @returns Updated save and the grant descriptors for the consumer to apply.
 */
export function flushIAPEvents(
  save: EntitlementSave,
  events: readonly IAPEvent[],
  resolver: SkuResolver,
): { save: EntitlementSave; grants: readonly GrantDescriptor[] };


// ─── src/iap/bridge.ts ──────────────────────────────────────────────

/**
 * Drain all events from the queue, returning them and a new empty queue.
 *
 * Pure op: the returned arrays are fresh. The original is not mutated.
 *
 * @param events - Current event array (the "queue").
 * @returns The drained events and a new empty array (the next queue).
 */
export function drainQueue(events: readonly IAPEvent[]): {
  drained: readonly IAPEvent[];
  next: readonly IAPEvent[];
};

/**
 * Push a transaction into the event queue.
 *
 * Called from the adapter's async callback (host-touching context).
 * Converts an `IAPTransaction` into a normalised `IAPEvent` and
 * returns a new array with the event appended.
 *
 * @param events - Current event array.
 * @param tx     - The transaction from the adapter.
 * @returns New array with the event appended.
 */
export function pushTransaction(events: readonly IAPEvent[], tx: IAPTransaction): readonly IAPEvent[];

/** Host-touching adapter interface. Mirrors Spitekeep's SaveStorage shape. */
export interface IAPBridge {
  initialize(): Promise<void>;
  isInitialized(): boolean;
  getCatalog(): readonly IAPProduct[];
  purchase(sku: string): Promise<IAPTransaction>;
  restore(): Promise<readonly IAPTransaction[]>;
  onTransaction(callback: (tx: IAPTransaction) => void): () => void;
}

/**
 * Create an in-memory IAP adapter for tests.
 *
 * No host API access. All purchases succeed immediately.
 * Catalog is configurable. Follows the defensive adapter pattern:
 * lazy init, swallow errors, never throw.
 */
export function createMemoryIAPAdapter(
  catalog?: readonly IAPProduct[],
): IAPBridge;

/**
 * Create a localStorage-backed IAP adapter for local development.
 *
 * Persists mock purchases across page reloads. Follows the defensive
 * adapter pattern: lazily resolves `window.localStorage`, swallows
 * errors, falls back to in-memory if localStorage is unavailable.
 */
export function createLocalStorageIAPAdapter(
  storageKey?: string,
  catalog?: readonly IAPProduct[],
): IAPBridge;
```

### Usage example

```ts
import { createMemoryIAPAdapter } from 'aicraft-engine/src/iap/adapters/memory';
import { drainQueue, pushTransaction, flushIAPEvents } from 'aicraft-engine/src/iap';
import { grantSkin } from 'aicraft-engine/src/cosmetics';
import type { SkuResolver, IAPEvent } from 'aicraft-engine/src/iap';

// 1. Define SKU → skin mapping
const resolver: SkuResolver = (sku) => {
  if (sku === 'com.game.neon_devil') return [{ target: 'skin', targetId: 'devil-neon' }];
  if (sku === 'com.game.gold_horns') return [{ target: 'skin', targetId: 'golden-horns' }];
  return [];
};

// 2. Create adapter + event queue (plain array)
const bridge = createMemoryIAPAdapter();
let events: IAPEvent[] = [];

// 3. Wire adapter → queue (host-touching context)
bridge.onTransaction((tx) => { events = pushTransaction(events, tx); });

// 4. Player clicks "Buy"
const tx = await bridge.purchase('com.game.neon_devil');
// tx.state === 'approved' → onTransaction fires → event pushed to queue

// 5. Next tick (deterministic core)
const { drained, next } = drainQueue(events);
events = next;
const { save: nextEntitlements, grants } = flushIAPEvents(entitlementSave, drained, resolver);
let cosmetics = currentCosmetics;
for (const g of grants) {
  if (g.target === 'skin') cosmetics = grantSkin(cosmetics, g.targetId);
}
// nextEntitlements now has SKU in entitlements; cosmetics has the granted skins
```

### Trade-offs

- **Ergonomics:** Consumer must wire adapter → queue → flush → cosmetic composition manually. Four separate pieces to compose. More verbose but each step is explicit and testable in isolation.
- **Determinism:** Excellent. The event queue is plain `IAPEvent[]`. `drainQueue` and `flushIAPEvents` are pure ops. Non-determinism is confined to the adapter's async callbacks, which only push to the queue. The deterministic core never touches the adapter.
- **Runtime cost:** One `JSON.parse(JSON.stringify())` per `grantEntitlement` call (event-driven, not per-frame). Queue drain is O(n) where n = events since last tick (typically 0–1).
- **Consumer complexity:** Moderate. The consumer must understand three layers (adapter, queue, pure ops) and wire them together, plus compose cosmetic grants at the tick boundary. But each layer is simple and independently testable.
- **Tree-shake-ability:** Excellent — genuinely so. `flushIAPEvents` + `grantEntitlement` + `revokeEntitlement` have zero imports from `src/cosmetics/`. The consumer can use the IAP pure ops without pulling in any cosmetic code. Adapters (`createMemoryIAPAdapter`, `createLocalStorageIAPAdapter`) are independently importable. No cross-pillar coupling.
- **Convention fit:** Matches the library's existing pattern of small composable functions. Mirrors how `spawn` + `advance` + `cull` compose in `src/particles/`.

**What this makes easy:** Testing each layer independently. Replacing the event queue with a custom implementation. Using pure ops without any adapter. Consumer controls cosmetic composition — no hidden cross-pillar calls.

**What this makes hard:** The consumer must wire the pieces together and compose cosmetic grants at the tick boundary. A common integration mistake is forgetting to drain the queue, forgetting to call `flushIAPEvents`, or forgetting to iterate `grants` to call `grantSkin`.

---

## Approach B: Unified Bridge (Stateful Orchestrator)

**Source pattern:** Pattern 1 (Event-Driven Unified Store) from the research note. The bridge manages its own event queue internally. Consumer interacts with a single object.

### Core idea

Ship a single `IAPBridge` factory that encapsulates the adapter, event queue, and entitlement resolution. The consumer interacts with one object:

```ts
const bridge = createIAPBridge({
  adapter: createMemoryIAPAdapter(),
  resolver: (sku) => [{ target: 'skin', targetId: 'devil-neon' }],
});

// Host-touching: trigger purchase
await bridge.purchase('com.game.neon_devil');

// Deterministic core: flush on tick
save = bridge.flush(save);
```

The bridge internally maintains the event queue. `bridge.flush(save)` drains pending events and applies them to the save. This is the seam: the adapter pushes events asynchronously, and `flush` processes them synchronously.

### Signature sketches

```ts
// ─── src/iap/types.ts ───────────────────────────────────────────────
// (Same IAPProduct, IAPPrice, IAPTransaction, TransactionState, EntitlementSave,
//  SkuResolver, GrantDescriptor as Approach A — types are shared.)

// ─── src/iap/bridge.ts ──────────────────────────────────────────────

/**
 * Configuration for the unified IAP bridge.
 *
 * @template S - The consumer's full save type. Must contain a `cosmetics`
 *               sub-object with `owned` and `equipped` fields.
 */
export interface IAPBridgeConfig<S> {
  /** The platform adapter. Handles async purchase/restore flows. */
  readonly adapter: IAPBridge;
  /** Maps purchased SKUs to grant descriptors. */
  readonly resolver: SkuResolver;
  /**
   * Optional: extract the entitlement sub-object from the consumer's save.
   * Defaults to `(save) => save as unknown as EntitlementSave`.
   * Use this when your save nests cosmetics under `save.cosmetics`.
   */
  readonly extractSave?: (save: S) => EntitlementSave;
  /**
   * Optional: merge the updated entitlement save back into the consumer's save.
   * Defaults to `(original, updated) => updated as unknown as S`.
   * Use this when your save nests cosmetics under `save.cosmetics`.
   */
  readonly mergeSave?: (original: S, updated: EntitlementSave) => S;
}

/**
 * Unified IAP bridge. Manages adapter lifecycle, event queue, and
 * entitlement resolution behind a single interface.
 *
 * The bridge itself is HOST-TOUCHING (its adapter touches host APIs).
 * `flush()` is a PURE operation on the save — it never touches the host.
 */
export interface IAPBridgeInstance<S> {
  /** Initialize the adapter. Call once at startup. */
  initialize(): Promise<void>;
  /** True after the first successful `initialize()` call. */
  isInitialized(): boolean;
  /** Return the product catalog from the adapter. */
  getCatalog(): readonly IAPProduct[];
  /** Trigger a purchase. Returns the transaction result. */
  purchase(sku: string): Promise<IAPTransaction>;
  /** Restore previous purchases. */
  restore(): Promise<readonly IAPTransaction[]>;
  /**
   * Flush pending IAP events into the save. Pure operation.
   *
   * Call this once per tick in the deterministic core. Processes all
   * events accumulated since the last flush and returns the updated save.
   */
  flush(save: S): S;
  /**
   * Subscribe to transaction events (for UI updates, analytics).
   * Returns an unsubscribe function.
   */
  onTransaction(callback: (tx: IAPTransaction) => void): () => void;
}

/**
 * Create a unified IAP bridge.
 *
 * @param config - Bridge configuration.
 * @returns A bridge instance. The bridge is host-touching; `flush()` is pure.
 */
export function createIAPBridge<S>(config: IAPBridgeConfig<S>): IAPBridgeInstance<S>;
```

### Usage example

```ts
import { createIAPBridge } from 'aicraft-engine/src/iap';
import { createMemoryIAPAdapter } from 'aicraft-engine/src/iap/adapters/memory';
import { grantSkin } from 'aicraft-engine/src/cosmetics';

// 1. Define SKU resolver
const resolver: SkuResolver = (sku) => {
  if (sku === 'com.game.neon_devil') return [{ target: 'skin', targetId: 'devil-neon' }];
  return [];
};

// 2. Create unified bridge
const bridge = createIAPBridge({
  adapter: createMemoryIAPAdapter(),
  resolver,
  extractSave: (save) => save.entitlements,
  mergeSave: (original, updated) => ({ ...original, entitlements: updated }),
});

// 3. Initialize at startup
await bridge.initialize();

// 4. Player clicks "Buy"
await bridge.purchase('com.game.neon_devil');
// Transaction fires onTransaction callback internally

// 5. Next tick (deterministic core)
save = bridge.flush(save);
// save.entitlements now has the SKU, save.cosmetics has the skin
```

### Trade-offs

- **Ergonomics:** Excellent. One object, one API. The consumer calls `bridge.flush(save)` instead of manually wiring queue + drain + flush.
- **Determinism:** Good. The internal queue is hidden but still a plain data structure. `flush()` is a pure op. However, the consumer cannot inspect or customise the queue — the bridge owns it.
- **Runtime cost:** Same as Approach A (one JSON-clone per entitlement grant). Slightly more overhead from the bridge wrapper, but negligible for event-driven calls.
- **Consumer complexity:** Low. One object to create, one `flush()` call per tick. But harder to test in isolation — you can't test the event queue without the adapter.
- **Tree-shake-ability:** Moderate. The bridge pulls in types + pure ops + event queue logic even if the consumer only needs the pure ops. A consumer who wants just `grantEntitlement` + `revokeEntitlement` must also import the bridge.
- **Convention fit:** Slightly divergent. The library prefers small composable functions over stateful orchestrators. However, this pattern is common in billing SDKs (Unity IAP, cordova-plugin-purchase) and may be more familiar to game developers.

**What this makes easy:** Consumer integration (one object, one flush). Less chance of wiring mistakes. Familiar to Unity/cordova developers.

**What this makes hard:** Testing the event queue in isolation. Customising the queue drain strategy. Tree-shaking unused bridge code. Harder to use pure ops without the bridge.

---

## Approach C: Minimal Contract (Types + Pure Ops Only)

**Source pattern:** Pattern 5 (Pure Entitlement Progression Ops) from the research note. The library provides the contract and the pure logic; the consumer implements the adapter and event queue themselves.

### Core idea

Ship only the types and pure ops. The adapter interface is defined as a TypeScript interface but no adapters ship. The event queue is the consumer's responsibility. This is the "library as specification" approach.

### Signature sketches

```ts
// ─── src/iap/types.ts ───────────────────────────────────────────────
// (Same types as Approach A. Types are the contract.)

// ─── src/iap/entitlements.ts ────────────────────────────────────────
// (Same grantEntitlement, revokeEntitlement, flushIAPEvents as Approach A.)

// ─── src/iap/bridge.ts ──────────────────────────────────────────────

/**
 * Host-touching adapter interface. Consumers implement this for their
 * target platform. The library defines the contract but ships no
 * concrete adapters (those are consumer-provided or Pillar 5).
 */
export interface IAPBridge {
  initialize(): Promise<void>;
  isInitialized(): boolean;
  getCatalog(): readonly IAPProduct[];
  purchase(sku: string): Promise<IAPTransaction>;
  restore(): Promise<readonly IAPTransaction[]>;
  onTransaction(callback: (tx: IAPTransaction) => void): () => void;
}

// No createEventQueue, no drainQueue, no createMemoryIAPAdapter,
// no createLocalStorageIAPAdapter.
```

### Usage example

```ts
import { grantEntitlement, flushIAPEvents } from 'aicraft-engine/src/iap';
import type { IAPBridge, IAPTransaction, SkuResolver } from 'aicraft-engine/src/iap';

// Consumer must implement their own adapter
function createMyIAPAdapter(): IAPBridge {
  // ... their own implementation
}

// Consumer must implement their own event queue
const pendingEvents: IAPEvent[] = [];
function pushEvent(tx: IAPTransaction) {
  if (tx.state === 'approved') {
    pendingEvents.push({ type: 'purchase', sku: tx.sku, txId: tx.id });
  }
}

const bridge = createMyIAPAdapter();
bridge.onTransaction(pushEvent);

// Tick
function tick(save: SaveData): SaveData {
  const events = pendingEvents.splice(0); // drain
  return flushIAPEvents(save, events, resolver);
}
```

### Trade-offs

- **Ergonomics:** Poor for quick adoption. The consumer must implement their own adapter and event queue from scratch, even for tests.
- **Determinism:** Excellent. The pure ops are fully deterministic. The consumer controls all host-touching code.
- **Runtime cost:** Identical to Approach A for the pure ops. But the consumer may write a less efficient event queue.
- **Consumer complexity:** High. The consumer must understand the contract, implement adapters, and wire the event queue correctly.
- **Tree-shake-ability:** Excellent. Only the types and pure ops are shipped. Zero dead code.
- **Convention fit:** Violates "batteries included" — the library should provide working adapters for tests and dev. This approach forces consumers to re-implement memory/localStorage adapters that are identical across all games.

**What this makes easy:** Maximum flexibility. Zero shipped code beyond types and pure ops.

**What this makes hard:** Everything. Every consumer must re-implement the same memory adapter for tests, the same localStorage adapter for dev, and the same event queue wiring. This is the definition of "not useful enough."

---

## Comparison Table

| Criterion | A: Composable Primitives | B: Unified Bridge | C: Minimal Contract |
|---|---|---|---|
| **Ergonomics** | Good (3 pieces to wire) | Best (1 object, 1 flush) | Poor (must implement everything) |
| **Determinism safety** | Excellent (queue is explicit) | Good (queue hidden) | Excellent (consumer controls) |
| **Consumer complexity** | Moderate | Low | High |
| **Tree-shake-ability** | Excellent (zero cross-pillar imports; each piece independent) | Moderate (bridge pulls all) | Excellent (only types + pure ops) |
| **Convention fit** | Strong (matches particles pattern) | Moderate (stateful orchestrator) | Weak (not useful enough) |
| **Testability** | Each layer testable in isolation | Bridge testable as unit | Only pure ops testable |
| **Re-implementability** | Low (adapters ship) | Low (adapters ship) | High (everything re-implemented) |
| **Risk** | Medium (wiring mistakes) | Low (one object) | High (every consumer reinvents) |

---

## Recommendation

**Approach A: Composable Primitives.** The library's established pattern is small, composable, independently-useful functions — `spawn` + `advance` + `cull` for particles, `grantSkin` + `equipSkin` + `unequipSkin` for cosmetics. The IAP bridge should follow the same pattern: adapter + event queue + pure ops, each independently testable and tree-shakeable. The consumer who only needs `grantEntitlement` can import it without pulling in any adapter code. The consumer who needs a full bridge gets the event queue for free.

Approach B is tempting for its ergonomics but violates the "small composable functions" convention. It also makes the event queue untestable in isolation, which is the critical deterministic seam. Approach C is too minimal — every consumer would re-implement the same memory adapter, which is the exact problem the library exists to solve.

The wiring cost of Approach A (push events, drain, flush, iterate grants to compose cosmetics) is a reasonable price for composability, testability, and zero cross-pillar coupling.

---

## Open Questions Resolved

### 1. SKU-to-Asset Mapping (`SkuResolver`)

**Resolution: Consumer-provided resolver function (option c).**

The library defines the `SkuResolver` type — a function `(sku: string) => readonly GrantDescriptor[]` — and `flushIAPEvents` accepts it as a parameter. The consumer provides the mapping.

**Why not embed SKU metadata in `SkinPreset` (option a)?**
Skin presets are content data — they describe what a skin looks like, not how it's sold. Embedding `sku: 'com.game.neon_devil'` in the `SkinPreset` couples content authoring to store configuration. If the developer changes their App Store SKU (which happens frequently during A/B testing), they must update every skin preset file. The resolver function keeps this mapping in one place, external to the content.

**Why not a separate `SkuMap` config object (option b)?**
A `SkuMap` is essentially a function with extra ceremony. The resolver function is more flexible — it can contain conditional logic (e.g., "on Poki, SKU `X` grants skins A and B; on Jest, SKU `X` grants only skin A"). A static map cannot express this.

**The resolver approach also solves the multi-grant problem.** One SKU can grant multiple entitlements (e.g., a "bundle" SKU grants 3 skins). The resolver returns an array of `GrantDescriptor`s. A static map would need to handle this as arrays-of-arrays, which is less natural.

### 2. Price Formatting

**Resolution: `IAPPrice` record with `formatted`, `micros`, and `currency` fields.**

```ts
export interface IAPPrice {
  readonly formatted: string;   // "$1.99", "1,99 €"
  readonly micros: number;      // 1990000
  readonly currency: string;    // "USD"
}
```

The UI needs the formatted string for display (no client-side locale formatting — the platform returns the localized string). The raw `micros` value is needed for sorting (most expensive first), comparison (is this cheaper than that?), and analytics. The `currency` code is needed for display context ("USD" label near the price).

Separating these into a record rather than three separate fields on `IAPProduct` keeps the price data grouped and makes it easy to pass to UI components that render price labels. The `micros` convention (micro-units) matches Apple StoreKit 2 and Google Play Billing's native formats, so no conversion is needed on the adapter side.

### 3. Refund/Revocation Sync

**Resolution: Consumer-triggered `restore()` with an optional auto-on-init hook.**

The bridge exposes `restore()` which returns all active transactions. The consumer calls this at startup (or on demand) and compares the result against their `entitlements` array to detect refunds. The library provides `revokeEntitlement` as a pure op to process the diff.

**Why not automatic re-query on bridge init?**
Automatic re-query ties the bridge to a specific startup sequence. Some games initialize the bridge lazily (only when the player opens the shop). Some games initialize it eagerly (to pre-cache the catalog). Making `restore()` automatic would force a network call on import, which breaks the defensive adapter pattern (no side effects on module load).

**The recommended pattern is:**

```ts
// Consumer's startup code
await bridge.initialize();
const restored = await bridge.restore();
const restoredSkus = new Set(restored.filter(tx => tx.state === 'approved').map(tx => tx.sku));

// Detect refunds: SKU in save.entitlements but not in restoredSkus
for (const sku of save.entitlements) {
  if (!restoredSkus.has(sku)) {
    save = revokeEntitlement(save, sku);
    // Optionally: save = unequipSkin(save.cosmetics, slot, skinId);
  }
}
```

This is explicit, testable, and doesn't force network timing. The consumer controls when the network call happens.

---

## Approach A — Detailed Module Layout

```
src/iap/
├── types.ts              # IAPProduct, IAPPrice, IAPTransaction, IAPEvent,
│                         # EntitlementSave, SkuResolver, GrantDescriptor
├── constants.ts          # DEFAULT_STORAGE_KEY, PRODUCT_TYPE, etc.
├── entitlements.ts       # grantEntitlement, revokeEntitlement, flushIAPEvents
├── bridge.ts             # IAPBridge interface, drainQueue, pushTransaction
│                         # (event queue is plain IAPEvent[], no wrapper type)
├── adapters/
│   ├── memory.ts         # createMemoryIAPAdapter
│   └── local-storage.ts  # createLocalStorageIAPAdapter
├── index.ts              # Barrel export
└── (tests live in src/tests/iap-*.test.ts)
```

### `src/iap/constants.ts`

```ts
/** localStorage key for the mock IAP entitlements store. */
export const DEFAULT_IAP_STORAGE_KEY = 'aicraft-iap-entitlements';

/** Product type constant for non-consumable purchases. */
export const PRODUCT_TYPE_NON_CONSUMABLE = 'non_consumable' as const;

/** Transaction state: approved. */
export const TX_STATE_APPROVED = 'approved' as const;

/** Transaction state: failed. */
export const TX_STATE_FAILED = 'failed' as const;

/** Transaction state: pending. */
export const TX_STATE_PENDING = 'pending' as const;

/** Transaction state: finished. */
export const TX_STATE_FINISHED = 'finished' as const;
```

### `src/iap/index.ts`

```ts
/**
 * IAP Bridge module (Pillar 3) — in-app purchase abstractions.
 *
 * Provides types, pure entitlement ops, event queue primitives, and
 * defensive adapters for memory and localStorage. Platform-specific
 * adapters (Poki, Jest) ship in Pillar 5.
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
  SkuResolver,
  GrantDescriptor,
  IAPBridge,
} from './types';

export {
  DEFAULT_IAP_STORAGE_KEY,
  PRODUCT_TYPE_NON_CONSUMABLE,
  TX_STATE_APPROVED,
  TX_STATE_FAILED,
  TX_STATE_PENDING,
  TX_STATE_FINISHED,
} from './constants';

export {
  grantEntitlement,
  revokeEntitlement,
  flushIAPEvents,
} from './entitlements';

export {
  drainQueue,
  pushTransaction,
} from './bridge';

export { createMemoryIAPAdapter } from './adapters/memory';
export { createLocalStorageIAPAdapter } from './adapters/local-storage';
```

---

## Determinism Analysis

### Guarantees

1. **Pure ops** (`grantEntitlement`, `revokeEntitlement`, `flushIAPEvents`, `drainQueue`, `pushTransaction`) are fully deterministic: immutable in, JSON-clone out, no `Math.random`, no `Date.now()`, no DOM reads.

2. **Event queue** is a plain `IAPEvent[]` array. `drainQueue` returns the drained events and a fresh empty array. No side effects.

3. **Adapter callbacks** (`onTransaction`) push events to the queue. This is the only side effect, and it's confined to the host-touching layer. The deterministic core never calls the adapter directly.

4. **`EntitlementSave`** uses plain sorted arrays and plain objects — no `Set`/`Map`, no non-deterministic iteration order.

5. **`flushIAPEvents`** iterates events in array order (deterministic) and calls `grantEntitlement`/`revokeEntitlement` sequentially. The order of events is the order they were pushed, which is the order the platform returned them.

### Landmines for @architect

1. **Event ordering:** If the adapter pushes two events for the same SKU (e.g., a purchase and an immediate restore), `flushIAPEvents` processes them in push order. The second event may be a no-op (already granted). This is correct — the pure ops are idempotent for grants.

2. **Receipt storage:** `EntitlementSave.receipts` stores opaque strings. The library never parses or validates receipts. Crypto validation is delegated to the host (Pattern 3 recommendation). The receipts are stored for future re-validation if the consumer chooses to implement it.

3. **`EntitlementSave` is decoupled from `CosmeticSave`.** The consumer nests them as sibling sub-objects in their `SaveData`. `flushIAPEvents` returns `GrantDescriptor[]` alongside the updated save — the consumer iterates grants and calls `grantSkin` (or equivalent) at their own composition boundary. No cross-pillar import exists in `src/iap/`.

4. **No auto-restore on init:** The consumer must explicitly call `bridge.restore()` and process the results. The library does not auto-restore on `bridge.initialize()`. This is intentional — it avoids side effects on module load and lets the consumer control network timing.

5. **`JSON.parse(JSON.stringify())` cost:** Used in `grantEntitlement` for deep cloning. Event-driven only (not per-frame). Document this in JSDoc. The clone is necessary to maintain the immutability contract — the consumer receives a fresh object that is safe to store without aliasing concerns.

---

## What @architect Should Scrutinize

1. **`EntitlementSave` vs `CosmeticSave` relationship.** RESOLVED: `EntitlementSave` is a pure overlay (`{ entitlements, receipts }`). The consumer nests it alongside `CosmeticSave` as a sibling sub-object in their `SaveData`. No cross-pillar coupling.

2. **`flushIAPEvents` and cosmetic mutation.** RESOLVED: `flushIAPEvents` returns `{ save, grants }`. The consumer iterates `grants` and calls `grantSkin` (or equivalent) at their own composition boundary. `src/iap/` has zero imports from `src/cosmetics/`.

3. **Event queue as a plain array vs wrapper type.** RESOLVED: Plain `IAPEvent[]`. No `IAPEventQueue` wrapper. `drainQueue` returns `{ drained, next }`. Simpler, fewer types, same guarantees.

4. **Adapter `onTransaction` push semantics.** With the plain-array queue, `pushTransaction(events, tx)` returns a new array. The consumer reassigns: `events = pushTransaction(events, tx)`. This requires `events` to be `let`-bound. This is the same trade-off as before but now the type is simpler (`IAPEvent[]` vs `IAPEventQueue`). The alternative is a mutable push (`.push()` in place) which breaks the pure-op contract. The proposal keeps the immutable approach for consistency with the library's convention.

5. **Poki adapter scope.** The proposal defers Poki/Jest adapters to Pillar 5. Should `createMemoryIAPAdapter` be generic enough that a Poki adapter can be built as a thin wrapper (e.g., `createPokiIAPAdapter(sdk)` returns an `IAPBridge` that maps `purchase` to `sdk.rewardedBreak()`)? The interface is already sufficient for this. But should the proposal sketch the Poki adapter to prove the interface works?

---

## Implementation Notes for @coder

The architect flagged three things to verify during implementation:

1. **`createLocalStorageIAPAdapter` must lazily resolve `window.localStorage`.** The adapter must NOT access `window.localStorage` at module load time. Resolution must happen inside `initialize()` or on first use, matching the defensive adapter pattern in `src/primitives/motion.ts` (line 23). If `window` is undefined (Node/test) or `localStorage` is unavailable, swallow the error and fall back to in-memory storage.

2. **`constants.ts` transaction-state constants must be used, not dead exports.** The adapter implementations (`memory.ts`, `local-storage.ts`) must reference `TX_STATE_APPROVED`, `TX_STATE_FAILED`, `TX_STATE_PENDING`, `TX_STATE_FINISHED` from `constants.ts` — not inline string literals. If the adapters don't use these constants, they become dead exports and the constants file serves no purpose.

3. **`SkuResolver` and `GrantDescriptor` stay in `src/iap/types.ts` even after decoupling.** These types are required by `flushIAPEvents` (which needs the resolver to compute grant descriptors). They are NOT cosmetic types — they are IAP types that describe what the IAP system grants. The consumer imports `grantSkin` from `src/cosmetics/` separately when iterating the returned `GrantDescriptor[]`.
