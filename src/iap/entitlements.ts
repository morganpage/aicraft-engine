/**
 * Pure progression ops + queue primitives for the IAP bridge (Pillar 3,
 * deterministic core).
 *
 * Mirrors `src/cosmetics/ownership.ts` and the pure-progression-ops
 * discipline in `docs/architecture.md`:
 *
 *   - **Immutable in** → the input {@link EntitlementSave} (and the input
 *     event array) is never mutated.
 *   - **JSON-clone out / fresh arrays out** → a fresh, deep-cloned state is
 *     returned every call. Queue ops return shallow copies / spread results.
 *   - **Never throws** → invalid skus, malformed events, and corrupt saves
 *     all degrade to a sensible no-op.
 *
 * Call the entitlement ops ONLY on purchase / restore / revoke events. They
 * perform a `JSON.parse(JSON.stringify())` deep clone per call — negligible
 * for event-driven calls, wasteful inside a per-frame loop.
 *
 * `entitlements` is kept as a plain, alphabetically-sorted `string[]` after
 * every grant — never a `Set`/`Map` — so serialisation order is canonical
 * regardless of grant order.
 *
 * **Zero cross-pillar imports.** `flushIAPEvents` returns
 * `GrantDescriptor[]` for the consumer to compose with `grantSkin` (or
 * equivalent) at their own boundary; this module never imports from
 * `src/cosmetics/`.
 *
 * @module
 */

import type {
  EntitlementSave,
  GrantDescriptor,
  IAPEvent,
  IAPTransaction,
  SkuResolver,
} from './types';

/**
 * Deep-clone an {@link EntitlementSave} via JSON round-trip, then normalise
 * any missing/wrong-typed fields. Returns a fresh object every call.
 *
 * JSON round-trip is guaranteed safe here: `EntitlementSave` holds only plain
 * arrays/objects/primitives — no `Set`, `Map`, functions, or circular refs.
 * The post-clone normalisation makes the ops defensive against corrupt saves
 * where `entitlements`/`receipts` are missing or wrong-typed at runtime.
 */
function cloneSave(save: EntitlementSave): EntitlementSave {
  const src = save !== null && typeof save === 'object' ? save : {};
  const next = JSON.parse(JSON.stringify(src)) as EntitlementSave;
  if (!Array.isArray(next.entitlements)) next.entitlements = [];
  if (next.receipts === null || typeof next.receipts !== 'object') {
    next.receipts = {};
  }
  return next;
}

/** Type-narrowing guard for a non-empty string. */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Grant a purchased SKU to the player's entitlement save.
 *
 * Adds the SKU to `entitlements` (sorted, deduped) and stores `receipt` in
 * `receipts` when one is provided. This op manages only entitlement records —
 * it does NOT mutate cosmetic state. The consumer bridges to cosmetics by
 * iterating the `GrantDescriptor[]` returned from {@link flushIAPEvents}.
 *
 * Immutable in → JSON-clone out → never throws. Invalid / empty SKU is a
 * silent no-op (the returned save is value-equal to a fresh clone of the
 * input).
 *
 * @param save    - Current entitlement save (never mutated).
 * @param sku     - Purchased SKU string.
 * @param receipt - Optional opaque receipt string for re-validation.
 * @returns A fresh {@link EntitlementSave} with the SKU added (or value-equal
 *          to a fresh clone if the SKU is invalid / already present).
 *
 * @example
 * ```ts
 * const next = grantEntitlement(save, 'com.game.neon_devil', 'receipt-base64');
 * ```
 */
export function grantEntitlement(
  save: EntitlementSave,
  sku: string,
  receipt?: string,
): EntitlementSave {
  if (!isNonEmptyString(sku)) return cloneSave(save);
  const next = cloneSave(save);
  if (!next.entitlements.includes(sku)) {
    next.entitlements.push(sku);
    next.entitlements.sort();
  }
  if (isNonEmptyString(receipt)) {
    next.receipts[sku] = receipt;
  }
  return next;
}

/**
 * Revoke a SKU (e.g. a refund was detected on `bridge.restore()`).
 *
 * Removes the SKU from `entitlements` and drops any associated receipt. Does
 * NOT automatically unequip skins — the consumer decides whether to call
 * `unequipSkin` (or keep the cosmetic visible for goodwill).
 *
 * Immutable in → JSON-clone out → never throws. Invalid / missing SKU is a
 * silent no-op.
 *
 * @param save - Current entitlement save (never mutated).
 * @param sku  - SKU string to revoke.
 * @returns A fresh {@link EntitlementSave} with the SKU removed (or
 *          value-equal to a fresh clone if the SKU is invalid / absent).
 */
export function revokeEntitlement(
  save: EntitlementSave,
  sku: string,
): EntitlementSave {
  if (!isNonEmptyString(sku)) return cloneSave(save);
  const next = cloneSave(save);
  next.entitlements = next.entitlements.filter((s) => s !== sku);
  delete next.receipts[sku];
  return next;
}

/**
 * Flush a batch of IAP events into the save.
 *
 * Iterates `events` in array order (deterministic), calling
 * {@link grantEntitlement} for `'purchase'` / `'restore'` events and
 * {@link revokeEntitlement} for `'revoke'` events. For each granted SKU, the
 * `resolver` is invoked to compute {@link GrantDescriptor} entries, which
 * are accumulated into the returned `grants` array — the consumer iterates
 * `grants` to bridge into cosmetics (e.g. `grantSkin`) at their own
 * composition boundary. No cross-pillar import is performed here.
 *
 * This is the deterministic seam between the async adapter and the sim core.
 * Empty events is a no-op (the returned `save` is value-equal to a fresh
 * clone of the input; `grants` is `[]`).
 *
 * Never throws. Malformed events (non-objects, missing fields, unknown
 * `type`, non-string SKUs) are silently skipped.
 *
 * @param save     - Current entitlement save (never mutated).
 * @param events   - Events drained from the queue.
 * @param resolver - SKU → grant descriptors mapping.
 * @returns Updated save and the grant descriptors for the consumer to apply.
 *
 * @example
 * ```ts
 * const { save: nextEntitlements, grants } = flushIAPEvents(save, drained, resolver);
 * for (const g of grants) {
 *   if (g.target === 'skin') cosmetics = grantSkin(cosmetics, g.targetId);
 * }
 * ```
 */
export function flushIAPEvents(
  save: EntitlementSave,
  events: readonly IAPEvent[],
  resolver: SkuResolver,
): { save: EntitlementSave; grants: readonly GrantDescriptor[] } {
  let next = cloneSave(save);
  const grants: GrantDescriptor[] = [];
  if (!Array.isArray(events)) return { save: next, grants };
  for (const raw of events) {
    if (raw === null || typeof raw !== 'object') continue;
    const type = (raw as { type?: unknown }).type;
    const sku = (raw as { sku?: unknown }).sku;
    if (!isNonEmptyString(sku)) continue;
    if (type === 'purchase' || type === 'restore') {
      next = grantEntitlement(next, sku);
      try {
        const descriptors = resolver(sku);
        if (Array.isArray(descriptors)) {
          for (const d of descriptors) {
            if (d && typeof d === 'object') grants.push(d);
          }
        }
      } catch {
        // Resolver exceptions must never poison the deterministic core.
      }
    } else if (type === 'revoke') {
      next = revokeEntitlement(next, sku);
    }
    // Unknown event types are silently skipped (forward-compat).
  }
  return { save: next, grants };
}

/**
 * Drain all events from the queue, returning them and a fresh empty queue.
 *
 * The returned `drained` array is a shallow copy of the input (so subsequent
 * mutation of `drained` does not affect the input array). The `next` queue is
 * always a brand-new empty array. The original input is never mutated.
 *
 * @param events - Current event array (the "queue").
 * @returns The drained events and a new empty array (the next queue).
 *
 * @example
 * ```ts
 * const { drained, next } = drainQueue(events);
 * events = next;
 * const { save, grants } = flushIAPEvents(save, drained, resolver);
 * ```
 */
export function drainQueue(events: readonly IAPEvent[]): {
  drained: readonly IAPEvent[];
  next: readonly IAPEvent[];
} {
  if (!Array.isArray(events)) return { drained: [], next: [] };
  return { drained: events.slice(), next: [] };
}

/**
 * Push a transaction into the event queue.
 *
 * Called from the adapter's async `onTransaction` callback (host-touching
 * context). Converts an {@link IAPTransaction} into a normalised
 * {@link IAPEvent} and returns a new array with the event appended.
 *
 * Conversion rules:
 *   - `'approved'` → appends a `'purchase'` event.
 *   - `'pending'` / `'finished'` / `'failed'` → returns the input array
 *     unchanged (no event appended). Failed transactions still fire the
 *     adapter's `onTransaction` callback (so the UI can update), but they
 *     must not produce entitlement mutations downstream.
 *
 * For `'restore'` or `'revoke'` events (which don't have a direct
 * transaction-state mapping), the consumer constructs the {@link IAPEvent}
 * literal directly. This op covers the common case — adapter-driven
 * purchases — deterministically.
 *
 * Pure: the input array is never mutated.
 *
 * @param events - Current event array.
 * @param tx     - The transaction from the adapter callback.
 * @returns New array with the event appended, or the input array unchanged
 *          for non-`'approved'` transactions.
 */
export function pushTransaction(
  events: readonly IAPEvent[],
  tx: IAPTransaction,
): readonly IAPEvent[] {
  if (!Array.isArray(events)) return [];
  if (!tx || typeof tx !== 'object') return events.slice();
  if (tx.state !== 'approved') return events.slice();
  if (!isNonEmptyString(tx.sku)) return events.slice();
  const event: IAPEvent = {
    type: 'purchase',
    sku: tx.sku,
    txId: typeof tx.id === 'string' ? tx.id : '',
  };
  return [...events, event];
}
