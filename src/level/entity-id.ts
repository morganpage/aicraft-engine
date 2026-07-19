/**
 * Pure entity ID allocation.
 *
 * Entity IDs are stable across reorder / delete / undo because they come from
 * a monotonic counter — never from array indices or `Math.random`. This
 * module owns the read side of that counter (the write side is the caller's
 * responsibility: spawn an entity with the allocated `id`, then persist
 * `nextEntityId` back into the level).
 *
 * @module
 */

import { DEFAULT_ENTITY_ID_START } from './constants';
import type { EntityId, LevelData } from './types';

/**
 * Allocate the next stable entity ID. Pure: returns the current counter as
 * `id` and `counter + 1` as the new `nextEntityId`. Never mutates `level`.
 *
 * Never throws. If `level.nextEntityId` is missing or not a finite number,
 * falls back to {@link DEFAULT_ENTITY_ID_START}.
 *
 * @example
 * ```ts
 * const { id, nextEntityId } = allocateEntityId(level);
 * const entity = { id, kind: 'platform', rect, props: {} };
 * const nextLevel = { ...level, entities: [...level.entities, entity], nextEntityId };
 * ```
 *
 * @param level - Level to read the counter from.
 * @returns The allocated `id` and the new `nextEntityId` (counter + 1).
 */
export function allocateEntityId(level: LevelData): {
  readonly id: EntityId;
  readonly nextEntityId: EntityId;
} {
  const raw =
    level && typeof level.nextEntityId === 'number' && Number.isFinite(level.nextEntityId)
      ? level.nextEntityId
      : DEFAULT_ENTITY_ID_START;
  const current = Math.floor(raw);
  return { id: current, nextEntityId: current + 1 };
}
