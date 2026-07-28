/**
 * Win condition combinators for platformer-level verification.
 *
 * A {@link WinCondition} is a pure predicate that receives the current
 * simulation state and returns `true` when the player has met the win
 * criteria. The third parameter (`save`) is required by the signature so
 * collectible-aware conditions are type-safe (per §5.6 of the
 * implementation plan).
 *
 * **Determinism:** All predicates are pure — same `(state, entities, save)`
 * → same output, forever. No `Math.random`, no `Date.now()`, no DOM reads.
 * Never throw (degrade gracefully to `false` on malformed input).
 *
 * @module
 */

import { aabbOverlap } from '../collision/aabb';
import type { PlatformerState } from '../platformer/types';
import type { CollectibleSave } from '../collectibles/types';
import type { LevelEntity } from '../level/types';

// ---------------------------------------------------------------------------
// WinCondition type
// ---------------------------------------------------------------------------

/**
 * A predicate that determines whether a platformer simulation run has been
 * won.
 *
 * Receives the current `PlatformerState`, the level's entities (read-only),
 * and the collectible save. Must be pure: same inputs → same result, forever.
 * Never throws — malformed inputs return `false` gracefully.
 *
 * Two-argument predicates such as `reachedExit` remain assignable because
 * they may ignore the third argument. Predicates requiring collection state
 * are now type-safe.
 *
 * @param state    - Current platformer state (player position, velocity, etc.).
 * @param entities - The level's entity list (read-only).
 * @param save     - The collectible save (read-only). May be empty/null for
 *                   levels without collectibles.
 * @returns `true` iff the win condition is met.
 */
export type WinCondition = (
  state: PlatformerState,
  entities: readonly LevelEntity[],
  save: Readonly<CollectibleSave>,
) => boolean;

// ---------------------------------------------------------------------------
// Individual win conditions
// ---------------------------------------------------------------------------

/**
 * Win condition: the player's AABB overlaps a non-trap, non-locked exit
 * entity.
 *
 * Trap exits (e.g. decoy doors) and locked exits (requiring a key) are
 * intentionally excluded — they do not constitute a win.
 *
 * **Pure:** never mutates inputs, never throws. Malformed entities are
 * skipped silently.
 *
 * @example
 * ```ts
 * // Use as the default win condition:
 * const won = reachedExit(state, entities, save);
 * ```
 */
export const reachedExit: WinCondition = (
  state: PlatformerState,
  entities: readonly LevelEntity[],
  _save: Readonly<CollectibleSave>,
): boolean => {
  if (!state || !state.core || !Array.isArray(entities)) return false;
  const player = state.core;
  try {
    for (const entity of entities) {
      if (!entity || typeof entity !== 'object') continue;
      if (entity.kind !== 'exit') continue;
      const exitProps = entity.props as { readonly isTrap?: boolean; readonly locked?: boolean };
      if (exitProps?.isTrap || exitProps?.locked) continue;
      if (aabbOverlap(
        { x: player.x, y: player.y, width: player.width, height: player.height },
        entity.rect,
      )) {
        return true;
      }
    }
  } catch {
    // Defensive: never throw
  }
  return false;
};

/**
 * Win condition: every collectible entity in the level has been collected.
 *
 * Checks each entity with `kind === 'collectible'` and verifies its id
 * appears in `save.collected`. Levels with zero collectibles always pass.
 *
 * **Pure:** never mutates inputs, never throws.
 *
 * @example
 * ```ts
 * // Use for "collectathon" levels:
 * const won = collectedAll(state, entities, save);
 * ```
 */
export const collectedAll: WinCondition = (
  _state: PlatformerState,
  entities: readonly LevelEntity[],
  save: Readonly<CollectibleSave>,
): boolean => {
  if (!Array.isArray(entities)) return false;
  const collected = new Set<string>(
    save && Array.isArray(save.collected) ? save.collected : [],
  );

  try {
    for (const entity of entities) {
      if (!entity || typeof entity !== 'object') continue;
      if (entity.kind === 'collectible') {
        if (!collected.has(String(entity.id))) return false;
      }
    }
  } catch {
    return false;
  }
  return true;
};

/**
 * Win condition: the player overlaps a non-trap exit AND a key-type
 * collectible has been collected.
 *
 * A "key" is any collectible entity whose `props.kind === 'key'`. At least
 * one such entity must be in `save.collected`.
 *
 * **Pure:** never mutates inputs, never throws.
 *
 * @example
 * ```ts
 * // Use for key-door levels:
 * const won = reachedExitWithKey(state, entities, save);
 * ```
 */
export const reachedExitWithKey: WinCondition = (
  state: PlatformerState,
  entities: readonly LevelEntity[],
  save: Readonly<CollectibleSave>,
): boolean => {
  if (!Array.isArray(entities)) return false;
  const collected = new Set<string>(
    save && Array.isArray(save.collected) ? save.collected : [],
  );

  // Check that a key collectible has been collected
  let hasKey = false;
  try {
    for (const entity of entities) {
      if (!entity || typeof entity !== 'object') continue;
      if (
        entity.kind === 'collectible' &&
        entity.props &&
        (entity.props as { readonly kind?: string }).kind === 'key'
      ) {
        if (collected.has(String(entity.id))) {
          hasKey = true;
          break;
        }
      }
    }
  } catch {
    return false;
  }

  if (!hasKey) return false;

  // Also check exit overlap
  return reachedExit(state, entities, save);
};

// ---------------------------------------------------------------------------
// Default
// ---------------------------------------------------------------------------

/**
 * The default win condition: the player reaches any non-trap, non-locked
 * exit entity.
 *
 * This is a reference to {@link reachedExit} — the two are interchangeable.
 */
export const DEFAULT_WIN_CONDITION: WinCondition = reachedExit;
