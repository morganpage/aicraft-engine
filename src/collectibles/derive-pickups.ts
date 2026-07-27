/**
 * Derive pickup events for this tick from deterministic AABB collision.
 *
 * This is the determinism seam that lets the platformer **kernel stay
 * unaware** of collectibles (per `docs/design/collectibles-decision.md` and
 * `docs/research/collectibles.md`).
 *
 * Calling pattern (consumer-side, inside the game loop, AFTER each
 * platformer tick — NOT inside the kernel):
 *
 * ```ts
 * const { collected, remaining } = derivePickups(playerRect, collectibles, save);
 * for (const id of collected) {
 *   save = collect(save, String(id));   // EntityId (number) → save id (string)
 * }
 * const renderList = remaining;   // skip already-collected (no double-render)
 * ```
 *
 * Pure:
 *   - Same `(playerRect, collectibles, save)` → identical output, byte-for-byte.
 *   - `save` / `collectibles` are never mutated.
 *   - The save is read defensively — a malformed `collected` (non-array) is
 *     treated as empty; a null/undefined save does not throw.
 *
 * Already-collected semantics: an entity whose id is in `save.collected` is
 * excluded from BOTH `collected` (no re-fire) and `remaining` (consumer has
 * already picked it up — should not render or re-collide with it). This keeps
 * the consumer loop trivial: render `remaining`, drive save ops with
 * `collected`.
 *
 * Strict AABB overlap (via `src/collision/aabb.ts`) — edge-touching rects do
 * NOT count as picked up; 1px overlap does. Mirrors the kernel collision
 * semantics so pickups stay consistent with the rest of the physics layer.
 *
 * Determinism: pickups are re-derived from collision with the same inputs →
 * the same pickups fire on replay. Zero replay impact (replay re-derives
 * pickup events from the deterministic collision surface).
 *
 * @module
 */

import { aabbOverlap } from '../collision/aabb';
import type { EntityId, LevelRect } from '../level/types';
import type { CollectibleEntity, CollectibleSave } from './types';

/**
 * Pickup-derivation result.
 *
 * `collected` is the newly-picked-up entity ids THIS tick (in input order; the
 * consumer applies `String(id)` to bridge into the `CollectibleSave`).
 * `remaining` is the collectibles not yet picked up and not overlapping THIS
 * tick — the consumer renders THIS list (already-collected entities are
 * excluded so they don't re-render or re-collide).
 */
export interface PickupDerivation {
  readonly collected: readonly EntityId[];
  readonly remaining: readonly CollectibleEntity[];
}

/**
 * Defensively extract `collected` from a potentially-malformed save.
 *
 * Treats `null`/`undefined`/non-object/non-array `collected` as an empty set
 * rather than throwing. The save-shape contract is enforced by `collect.ts`
 *; this reader is the last line of defence inside the deterministic core.
 */
function readCollectedSet(save: unknown): Set<string> {
  if (save === null || typeof save !== 'object') return new Set();
  const coll = (save as { readonly collected?: unknown }).collected;
  if (!Array.isArray(coll)) return new Set();
  const set = new Set<string>();
  for (const item of coll) {
    if (typeof item === 'string' && item.length > 0) set.add(item);
  }
  return set;
}

/**
 * A rect-shaped input — accepts `LevelRect` and any structurally-compatible
 * shape so the consumer can pass the player's `LevelRect` (or a screen-space
 * rect from the platformer runtime).
 */
export type PlayerRect =
  | LevelRect
  | { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/**
 * Pure pickup derivation. See module JSDoc for the consumer pattern and the
 * determinism / replay contract.
 *
 * Defensive against malformed inputs:
 *   - `null` / non-object save → empty collected-set; no throw.
 *   - `null` / non-array collectibles → empty result; no throw.
 *   - Null entries inside `collectibles` are skipped (not thrown).
 *   - An entity missing a rect is skipped (no throw).
 *
 * @param playerRect   - Player's current rect (axis-aligned, world-space pixels).
 * @param collectibles - The level's collectible entities (a narrow of `LevelEntity`).
 * @param save         - Player's collectible save (may be malformed — defended).
 * @returns `PickupDerivation` — `{ collected, remaining }`.
 */
export function derivePickups(
  playerRect: PlayerRect,
  collectibles: readonly CollectibleEntity[] | null | undefined,
  save: CollectibleSave | null | undefined,
): PickupDerivation {
  const collectedIds: EntityId[] = [];
  const remaining: CollectibleEntity[] = [];
  const collectedSet = readCollectedSet(save);

  // Defensive: a missing or non-array collectibles list is no-pickups and no-remainder.
  if (!Array.isArray(collectibles)) {
    return { collected: Object.freeze(collectedIds), remaining: Object.freeze(remaining) };
  }

  for (const c of collectibles) {
    // Defensive: skip null / non-object entries — never throw.
    if (c === null || typeof c !== 'object') continue;
    const entity = c as CollectibleEntity;
    const id = entity.id;
    const idStr = String(id);

    // Already-collected ⇒ excluded from both lists (consumer has it; should
    // not re-render or re-collide). This matches the test contract.
    if (collectedSet.has(idStr)) continue;

    // Defensive: an entity missing rect is treated as a no-collision surface.
    const rect = entity.rect;
    if (!rect || typeof rect !== 'object') continue;

    if (aabbOverlap(playerRect, rect)) {
      collectedIds.push(id);
    } else {
      remaining.push(entity);
    }
  }

  return { collected: Object.freeze(collectedIds), remaining: Object.freeze(remaining) };
}
