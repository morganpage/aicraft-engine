# Decision: IAP Bridge (`src/iap/`)

**Status:** APPROVED — proceeds to TDD implementation.
**Inputs:** `docs/research/iap-bridge.md` · `docs/design/iap-bridge-proposal.md` · architect critique (NEEDS REVISION MAJOR → revised → self-verified, loop 1/2 waived — revisions were prescriptive type changes, not subjective design).

## Decision

Adopt **Approach A (Composable Primitives)** — separate pure entitlement ops + event queue (plain array) + adapter interface + defensive adapter factories. The consumer wires them. This matches the library's established particles pattern (`spawn` + `advance` + `cull` composed by the consumer).

**Critical architectural constraint (from architect):** `src/iap/` has **zero imports from `src/cosmetics/`**. This respects the ratified cosmetics decision (`docs/design/algorithmic-skin-variation-decision.md` line 10: "consumer composes at the boundary — no IAP coupling"). Pillar 3 is independently tree-shakeable from Pillar 2.

- **Types** (`src/iap/types.ts`): `EntitlementSave` (pure overlay: `{ entitlements: string[]; receipts: Record<string, string> }` — NO `owned`/`equipped` cosmetics fields), `IAPEvent` (`{ type: 'purchase' | 'restore' | 'revoke'; sku; receipt? }`), `IAPTransaction`, `IAPProduct`, `IAPPrice` (`{ formatted; micros; currency }`), `IAPBridge` (adapter interface), `GrantDescriptor` (`{ target: 'skin'; targetId: string }` — open union for future target types), `SkuResolver` (`(sku: string) => readonly GrantDescriptor[]`), `ProductType` (`'non_consumable'` — open union), `TransactionState`.
- **Pure ops** (`src/iap/entitlements.ts`): `grantEntitlement(save, sku, receipt?) → EntitlementSave` (manages only entitlements + receipts, NO `grantSkin` call), `revokeEntitlement(save, sku) → EntitlementSave`, `flushIAPEvents(save, events, resolver) → { save: EntitlementSave; grants: readonly GrantDescriptor[] }` (the consumer iterates `grants` and calls `grantSkin` themselves), `drainQueue(events) → { drained; next }`, `pushTransaction(events, tx) → readonly IAPEvent[]`.
- **Event queue**: plain `IAPEvent[]` — NO wrapper type. Matches the library's collection convention (`Particle[]`, `Emitter[]`, `string[]`).
- **Adapter interface** (`src/iap/bridge.ts` or `types.ts`): `IAPBridge` with `getCatalog()`, `getEntitlements()`, `purchase(sku)`, `restore()`, `onTransaction(cb)`. All async (return Promises); callbacks fire asynchronously.
- **Adapters shipped in v1**: `createMemoryIAPAdapter()` (tests — in-memory mock store), `createLocalStorageIAPAdapter()` (dev — lazily resolves `window.localStorage`, matching `src/primitives/motion.ts`). Poki/Jest adapters deferred to Pillar 5.
- **Scope**: non-consumable cosmetics only (no consumables, no subscriptions). Receipt validation delegated to the host/consumer (zero-dep invariant — no crypto bundled). Restore is consumer-triggered (`bridge.restore()` at startup), not automatic.

## Key inputs that drove the decision

1. **Research** (`docs/research/iap-bridge.md`): surveyed StoreKit 2, Play Billing, Poki SDK, Cordova/Capacitor IAP, Unity IAP, react-native-iap. Identified the deterministic async event queue as the critical seam, the ad-to-unlock proxy for Poki dual-publish, and localStorage mock billing for dev.
2. **Architect critique**: caught a critical cross-pillar coupling (`EntitlementSave` embedding `CosmeticSave` fields + `grantEntitlement` calling `grantSkin` internally) that contradicted the ratified cosmetics decision. The fix: `EntitlementSave` is a pure overlay, `flushIAPEvents` returns grant descriptors for the consumer to compose. This makes Pillar 3 genuinely independently tree-shakeable.
3. **Cosmetics decision precedent** (`docs/design/algorithmic-skin-variation-decision.md` line 10): explicitly prescribed "consumer composes at the boundary" for the IAP→cosmetics seam. This proposal honors that.

## What was rejected

- **Approach B (Unified Bridge)** — a stateful `createIAPBridge()` singleton that encapsulates queue + adapter + flush. Goes against the library's functional convention (zero classes/stateful singletons in shipped code). The composable approach (A) is more testable and tree-shakeable.
- **Approach C (Minimal Contract)** — types + pure ops only, no adapters shipped. Too little — the memory/localStorage adapters are cheap to ship and essential for testability/dev.
- **`EntitlementSave` embedding `CosmeticSave` fields** — creates a cross-pillar type dependency that makes Pillar 3 non-tree-shakeable from Pillar 2. Rejected per the cosmetics decision and the architect.
- **`grantEntitlement` calling `grantSkin` internally** — cross-pillar runtime dependency. Rejected; consumer composes via the `grants` return from `flushIAPEvents`.
- **`IAPEventQueue` wrapper type** — unnecessary ceremony. Plain `IAPEvent[]` matches the library's collection convention.
- **Consumables/subscriptions in v1** — client-side validation is spoofable; defer to v2 with server-side validation.
- **Receipt validation in the library** — would require crypto deps. Delegated to the host/consumer.
- **Automatic restore on init** — forces a network call on import. Consumer-triggered instead.
- **Poki/Jest adapters in v1** — deferred to Pillar 5 (on-demand when a game targets those platforms).

## Implementation-time verifications (from architect)

- `createLocalStorageIAPAdapter` must lazily resolve `window.localStorage` (not at module load), matching `src/primitives/motion.ts` line 23.
- `constants.ts` transaction-state constants must be actually used by the adapter implementations (not dead exports).
- `SkuResolver` and `GrantDescriptor` stay in `src/iap/types.ts` post-decoupling.

## Cross-references

- `docs/research/iap-bridge.md` — prior-art survey.
- `docs/design/iap-bridge-proposal.md` — API proposal (Approach A, revised).
- `docs/design/algorithmic-skin-variation-decision.md` line 10 — the cosmetics decision that prescribed the consumer-composition boundary.
