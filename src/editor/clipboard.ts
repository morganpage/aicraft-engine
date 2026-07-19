/**
 * In-app clipboard operations for the editor (Pillar 4 — Level Editor Core).
 *
 * **In-memory only** — never serialized to disk in v1, never synced to
 * the system clipboard. The reference editor holds a single
 * {@link ClipboardEntry} in component state.
 *
 * Both exports are pure: the input state is never mutated, and any
 * returned entities are deep JSON-clones so the caller can mutate them
 * freely without leaking back into the live level.
 *
 * @module
 */

import type { LevelEntity } from '../level/types';
import type { ClipboardEntry, EditorState, EditorOperation } from './types';
import { applyOp } from './operations';

/**
 * Compute the bounding box of a non-empty set of entities.
 *
 * Returns `null` if `entities` is empty (no bounding box exists).
 */
function boundingBox(entities: readonly LevelEntity[]): {
  readonly minX: number;
  readonly minY: number;
} | null {
  if (entities.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const e of entities) {
    if (e.rect.x < minX) minX = e.rect.x;
    if (e.rect.y < minY) minY = e.rect.y;
  }
  return { minX, minY };
}

/**
 * Copy the currently-selected entities to a {@link ClipboardEntry}.
 * **Pure.**
 *
 * Returns a deep JSON-clone of the selected entities (stable IDs
 * preserved). Returns `null` if the selection is empty.
 *
 * @param state - Current editor state (never mutated).
 * @returns A clipboard entry, or `null` if the selection is empty.
 */
export function copySelection(state: EditorState): ClipboardEntry | null {
  if (state.selection.ids.size === 0) return null;
  const selected = state.level.entities.filter((e) =>
    state.selection.ids.has(e.id),
  );
  if (selected.length === 0) return null;
  const cloned = JSON.parse(JSON.stringify(selected)) as LevelEntity[];
  return { entities: cloned };
}

/**
 * Paste a clipboard entry at a world-space position. **Pure.**
 *
 * The entities are offset so that their bounding-box top-left aligns
 * with `at`. Each pasted entity is allocated a fresh stable ID via
 * `allocateEntityId` (sequentially against the working level). The
 * paste is recorded as a single `batch` {@link EditorOperation} on the
 * undo stack.
 *
 * **Never throws.** If `clipboard.entities` is empty, the input state
 * is returned unchanged.
 *
 * @param state     - Current editor state (never mutated).
 * @param clipboard - Clipboard entry to paste.
 * @param at        - World-space position for the pasted bounding-box top-left.
 * @returns A fresh editor state with the pasted entities added.
 */
export function pasteClipboard(
  state: EditorState,
  clipboard: ClipboardEntry,
  at: { readonly x: number; readonly y: number },
): EditorState {
  if (clipboard.entities.length === 0) return state;
  const box = boundingBox(clipboard.entities);
  if (box === null) return state;
  const dx = at.x - box.minX;
  const dy = at.y - box.minY;

  // Build addEntity ops for each clipboard entity, translated by the
  // (at - boundingBoxTopLeft) offset. Each addEntity will allocate a
  // fresh stable ID via allocateEntityId when applyOp processes it;
  // the working level's nextEntityId advances after each allocation,
  // so the entities receive sequential, non-colliding IDs.
  const ops: EditorOperation[] = clipboard.entities.map((entity) => ({
    type: 'addEntity' as const,
    kind: entity.kind,
    rect: {
      x: entity.rect.x + dx,
      y: entity.rect.y + dy,
      width: entity.rect.width,
      height: entity.rect.height,
    },
    props: entity.props as Record<string, unknown>,
  }));

  return applyOp(state, {
    type: 'batch',
    ops,
    label: `Paste ${ops.length} ${ops.length === 1 ? 'entity' : 'entities'}`,
  });
}
