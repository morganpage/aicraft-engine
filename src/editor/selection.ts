/**
 * Selection operations for the editor (Pillar 4 — Level Editor Core).
 *
 * Selection is **pure data** (a `ReadonlySet<EntityId>`) and **ephemeral
 * UI state** — it is never recorded in {@link HistoryEntry} and never
 * serialized. Selecting an entity does not create an undo step.
 *
 * All exports are pure: the input state is never mutated, and a fresh
 * `EditorState` is returned each call (with a new `SelectionState`
 * carrying a new `Set`).
 *
 * Selection mode semantics:
 *  - `'replace'` — new set is exactly the given IDs.
 *  - `'add'` — union of existing and new.
 *  - `'subtract'` — existing minus new.
 *  - `'toggle'` — symmetric difference.
 *
 * @module
 */

import type { LevelRect, EntityId } from '../level/types';
import type { EditorState, SelectionMode } from './types';

/**
 * Two rects overlap iff their intervals overlap on both axes.
 *
 * Edges that exactly touch (e.g. `a.x + a.width === b.x`) are treated
 * as overlapping — matches typical marquee-selection behaviour where
 * dragging against an entity's edge should select it.
 */
function rectsOverlap(a: LevelRect, b: LevelRect): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

/**
 * Apply a selection mode to an existing selection set. Returns a new
 * `Set`. Pure.
 *
 * - `'replace'` → set is exactly `next`.
 * - `'add'` → set is `existing ∪ next`.
 * - `'subtract'` → set is `existing \ next`.
 * - `'toggle'` → set is `existing △ next` (symmetric difference).
 */
function applyMode(
  existing: ReadonlySet<EntityId>,
  next: readonly EntityId[],
  mode: SelectionMode,
): Set<EntityId> {
  switch (mode) {
    case 'replace':
      return new Set(next);
    case 'add': {
      const out = new Set(existing);
      for (const id of next) out.add(id);
      return out;
    }
    case 'subtract': {
      const out = new Set(existing);
      for (const id of next) out.delete(id);
      return out;
    }
    case 'toggle': {
      const out = new Set(existing);
      for (const id of next) {
        if (out.has(id)) out.delete(id);
        else out.add(id);
      }
      return out;
    }
  }
}

/**
 * Select a single entity by id. **Pure.**
 *
 * The id need not exist in the level — selection is a UI affordance
 * (e.g. for a "pending delete" highlight); the caller may clear stale
 * ids at any time.
 *
 * @param state - Current editor state (never mutated).
 * @param id    - Entity id to select.
 * @param mode  - Selection mode (defaults to `'replace'` if undefined,
 *                but TS requires the argument — see {@link selectMany}
 *                for the variadic form).
 * @returns A fresh editor state with the new selection.
 */
export function select(
  state: EditorState,
  id: EntityId,
  mode: SelectionMode,
): EditorState {
  return selectMany(state, [id], mode);
}

/**
 * Select multiple entities by id. **Pure.**
 *
 * @param state - Current editor state (never mutated).
 * @param ids   - Entity ids to select.
 * @param mode  - Selection mode (replace / add / subtract / toggle).
 * @returns A fresh editor state with the new selection.
 */
export function selectMany(
  state: EditorState,
  ids: readonly EntityId[],
  mode: SelectionMode,
): EditorState {
  const next = applyMode(state.selection.ids, ids, mode);
  return { ...state, selection: { ids: next } };
}

/**
 * Select all entities whose rect overlaps `rect`. **Pure.**
 *
 * Used by marquee selection: the host computes the drag rectangle in
 * world space and passes it here.
 *
 * @param state - Current editor state (never mutated).
 * @param rect  - World-space rectangle to query.
 * @param mode  - Selection mode (replace / add / subtract / toggle).
 * @returns A fresh editor state with the overlapping entities selected.
 */
export function selectInRect(
  state: EditorState,
  rect: LevelRect,
  mode: SelectionMode,
): EditorState {
  const hits: EntityId[] = [];
  for (const entity of state.level.entities) {
    if (rectsOverlap(rect, entity.rect)) hits.push(entity.id);
  }
  return selectMany(state, hits, mode);
}

/**
 * Clear the selection (empty set). **Pure.**
 *
 * @param state - Current editor state (never mutated).
 * @returns A fresh editor state with an empty selection.
 */
export function clearSelection(state: EditorState): EditorState {
  if (state.selection.ids.size === 0) return state;
  return { ...state, selection: { ids: new Set() } };
}

/**
 * Select every entity in the level. **Pure.**
 *
 * @param state - Current editor state (never mutated).
 * @returns A fresh editor state with all entity ids selected.
 */
export function selectAll(state: EditorState): EditorState {
  const all = state.level.entities.map((e) => e.id);
  return { ...state, selection: { ids: new Set(all) } };
}

/**
 * `true` iff `id` is in the current selection. Pure reader.
 *
 * @param state - Current editor state.
 * @param id    - Entity id to test.
 */
export function isInSelection(state: EditorState, id: EntityId): boolean {
  return state.selection.ids.has(id);
}

/**
 * Hit-test a single point against the level's entities. Returns the
 * topmost-most entity whose rect contains the point, or `null` if none.
 *
 * "Topmost" = the last entity in `level.entities` array order (i.e. the
 * one drawn last, visually on top). This matches typical editor hit-test
 * expectations: clicking on overlapping entities selects the visible one.
 *
 * Pure reader — never mutates input. Never throws.
 *
 * @example
 * ```ts
 * canvas.addEventListener('mousedown', (e) => {
 *   const rect = canvas.getBoundingClientRect();
 *   const x = e.clientX - rect.left;
 *   const y = e.clientY - rect.top;
 *   const hit = entityAtPoint(editorState.level, { x, y });
 *   if (hit) {
 *     editorState = select(editorState, hit.id, 'replace');
 *   }
 * });
 * ```
 *
 * @param level - Level to hit-test against.
 * @param point - World-space point to test.
 * @returns The topmost entity at that point, or `null`.
 */
export function entityAtPoint(
  level: { readonly entities: readonly { readonly id: EntityId; readonly rect: LevelRect }[] },
  point: { readonly x: number; readonly y: number },
): { readonly id: EntityId; readonly rect: LevelRect } | null {
  for (let i = level.entities.length - 1; i >= 0; i--) {
    const e = level.entities[i];
    const r = e.rect;
    if (
      point.x >= r.x &&
      point.x < r.x + r.width &&
      point.y >= r.y &&
      point.y < r.y + r.height
    ) {
      return e;
    }
  }
  return null;
}
