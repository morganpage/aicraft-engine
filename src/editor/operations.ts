/**
 * Pure reducer for editor operations (Pillar 4 — Level Editor Core).
 *
 * The single entry point is {@link applyOp}. It applies one
 * {@link EditorOperation} to an {@link EditorState} and returns a fresh
 * `EditorState` with the level replaced, the validation cache recomputed,
 * and (when not inside a transaction) a new {@link HistoryEntry} pushed
 * onto the undo stack.
 *
 * Purity contract (mirrors `src/cosmetics/ownership.ts`):
 *  - **Immutable in** → the input `EditorState` is never mutated.
 *  - **JSON-clone out** → the new `LevelData` is a deep JSON-clone of the
 *    input level (via `JSON.parse(JSON.stringify(level))`), so no shared
 *    references leak into history snapshots.
 *  - **Never throws** → an op referencing a non-existent entity ID, an
 *    out-of-bounds tile cell, or any other invalid target is a silent
 *    no-op (state returned unchanged).
 *
 * Determinism: no `Math.random`, no `Date.now`, no DOM reads. Entity IDs
 * come from the pure `allocateEntityId` counter in `src/level/`.
 *
 * @module
 */

import type {
  LevelData,
  LevelEntity,
  EntityId,
  EntityKind,
  LevelRect,
} from '../level/types';
import { allocateEntityId } from '../level/entity-id';
import { validateLevel } from '../level/validate';
import type {
  EditorOperation,
  EditorState,
  HistoryEntry,
} from './types';

/**
 * Writable view of {@link LevelData}.
 *
 * `LevelData` ships with `readonly` modifiers to signal that consumers
 * should not mutate it. Inside this module, however, we work on a
 * freshly JSON-cloned level that we own end-to-end; the `readonly`
 * modifiers are pure type-level ceremony that get in the way of
 * in-place mutation. We cast through this writable view rather than
 * the public `LevelData` so the compiler allows the writes.
 */
type WritableLevel = {
  version: number;
  id: string;
  name: string;
  width: number;
  height: number;
  tileSize: number;
  spawn: { x: number; y: number };
  tiles: WritableTiles;
  entities: LevelEntity[];
  nextEntityId: EntityId;
  bottomLava?: { surfaceY: number };
  hints?: string[];
  flags?: { lookahead?: boolean; foreground?: boolean; background?: boolean };
};

type WritableTiles = {
  data: number[];
  cols: number;
  rows: number;
  tileSize: number;
};

/**
 * Deep-clone a `LevelData` via JSON round-trip.
 *
 * JSON round-trip is guaranteed safe here: `LevelData` holds only plain
 * arrays/objects/primitives — no `Set`, `Map`, functions, or circular
 * refs. Matches the canonical clone pattern in `cosmetics/ownership.ts`.
 */
function cloneLevel(level: LevelData): LevelData {
  return JSON.parse(JSON.stringify(level)) as LevelData;
}

/**
 * Construct a {@link LevelEntity} of the correct variant for `kind`.
 *
 * The {@link LevelEntity} discriminated union requires the `props`
 * field's static type to match the `kind`. We construct via a switch so
 * the TypeScript compiler verifies kind↔props pairing at compile time.
 * `props` is cast through `unknown` to the variant's specific props
 * type — the runtime shape is the caller's responsibility (validated
 * downstream by `validateLevel`).
 */
function makeEntity(
  kind: EntityKind,
  id: EntityId,
  rect: LevelRect,
  props: Record<string, unknown>,
): LevelEntity {
  switch (kind) {
    case 'spawn':
      return {
        id,
        kind,
        rect,
        props: props as unknown as Record<string, never>,
      };
    case 'exit':
      return {
        id,
        kind,
        rect,
        props: props as unknown as Extract<LevelEntity, { kind: 'exit' }>['props'],
      };
    case 'platform':
      return {
        id,
        kind,
        rect,
        props: props as unknown as Extract<LevelEntity, { kind: 'platform' }>['props'],
      };
    case 'passthrough':
      return {
        id,
        kind,
        rect,
        props: props as unknown as Record<string, never>,
      };
    case 'trap':
      return {
        id,
        kind,
        rect,
        props: props as unknown as Extract<LevelEntity, { kind: 'trap' }>['props'],
      };
    case 'hazard':
      return {
        id,
        kind,
        rect,
        props: props as unknown as Record<string, never>,
      };
    case 'decoration':
      return {
        id,
        kind,
        rect,
        props: props as unknown as Extract<LevelEntity, { kind: 'decoration' }>['props'],
      };
    case 'trigger':
      return {
        id,
        kind,
        rect,
        props: props as unknown as Extract<LevelEntity, { kind: 'trigger' }>['props'],
      };
    case 'movingPlatform':
      return {
        id,
        kind,
        rect,
        props: props as unknown as Extract<LevelEntity, { kind: 'movingPlatform' }>['props'],
      };
  }
}

/**
 * Translate a {@link LevelRect} by `(dx, dy)` and return a new rect.
 */
function translateRect(rect: LevelRect, dx: number, dy: number): LevelRect {
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
}

/**
 * Apply a single mutation to a working {@link WritableLevel} (already cloned).
 *
 * Returns `true` iff the level was actually changed. The caller uses the
 * return value to decide whether to record a history entry (no-op ops
 * don't get one).
 *
 * **Never throws.** Out-of-bounds tile indices, missing entities, etc.
 * are silently skipped.
 */
function applyMutation(level: WritableLevel, op: EditorOperation): boolean {
  switch (op.type) {
    case 'addEntity': {
      const { id, nextEntityId } = allocateEntityId(level);
      const entity = makeEntity(op.kind, id, op.rect, op.props);
      level.entities = [...level.entities, entity];
      level.nextEntityId = nextEntityId;
      return true;
    }
    case 'removeEntity': {
      const before = level.entities.length;
      const next = level.entities.filter((e) => e.id !== op.id);
      if (next.length === before) return false;
      level.entities = next;
      return true;
    }
    case 'updateEntityProps': {
      let changed = false;
      const next = level.entities.map((e): LevelEntity => {
        if (e.id !== op.id) return e;
        changed = true;
        return { ...e, props: { ...e.props, ...op.propsPatch } } as LevelEntity;
      });
      if (!changed) return false;
      level.entities = next;
      return true;
    }
    case 'moveEntities': {
      const idSet = new Set(op.ids);
      let changed = false;
      const next = level.entities.map((e): LevelEntity => {
        if (!idSet.has(e.id)) return e;
        changed = true;
        return { ...e, rect: translateRect(e.rect, op.dx, op.dy) };
      });
      if (!changed) return false;
      level.entities = next;
      return true;
    }
    case 'setEntityRect': {
      let changed = false;
      const next = level.entities.map((e): LevelEntity => {
        if (e.id !== op.id) return e;
        changed = true;
        return { ...e, rect: op.rect };
      });
      if (!changed) return false;
      level.entities = next;
      return true;
    }
    case 'paintTiles': {
      const tiles = level.tiles;
      const cols = tiles.cols;
      const rows = tiles.rows;
      const data = tiles.data.slice();
      let changed = false;
      for (const cell of op.cells) {
        const { x, y, newValue, oldValue } = cell;
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        const idx = y * cols + x;
        if (data[idx] === newValue) continue;
        data[idx] = newValue;
        changed = true;
        // `oldValue` is carried in the op for diagnostics / future
        // sparse-delta optimization; the reducer does not need to read
        // it because the snapshot history records the full pre-state.
        void oldValue;
      }
      if (!changed) return false;
      const nextTiles: WritableTiles = { ...tiles, data };
      level.tiles = nextTiles;
      return true;
    }
    case 'setSpawnPoint': {
      if (level.spawn.x === op.x && level.spawn.y === op.y) return false;
      level.spawn = { x: op.x, y: op.y };
      return true;
    }
    case 'batch': {
      let any = false;
      for (const sub of op.ops) {
        if (applyMutation(level, sub)) any = true;
      }
      return any;
    }
  }
}

/**
 * Build a human-readable label for an op (used when the caller doesn't
 * supply one — e.g. when they call `applyOp` directly rather than via
 * `commitTransaction(state, label)`).
 */
function defaultLabel(op: EditorOperation): string {
  switch (op.type) {
    case 'addEntity':
      return `Add ${op.kind}`;
    case 'removeEntity':
      return 'Remove entity';
    case 'updateEntityProps':
      return 'Update entity';
    case 'moveEntities':
      return `Move ${op.ids.length} ${op.ids.length === 1 ? 'entity' : 'entities'}`;
    case 'setEntityRect':
      return 'Resize entity';
    case 'paintTiles':
      return `Paint ${op.cells.length} ${op.cells.length === 1 ? 'tile' : 'tiles'}`;
    case 'setSpawnPoint':
      return 'Move spawn point';
    case 'batch':
      return op.label;
  }
}

/**
 * Apply a single operation to the editor state. **Pure.**
 *
 * The op is applied to a deep JSON-clone of `state.level`. If the op
 * had any effect (was not a no-op), a new {@link HistoryEntry} is
 * pushed onto the undo stack (unless inside a transaction — see
 * below), the redo stack is cleared, and the validation cache is
 * recomputed via `validateLevel`. The returned `EditorState` is a
 * fresh shallow-copy; the input is never mutated.
 *
 * **Transactions.** If `state.pendingTransaction` is non-null (i.e.
 * `beginTransaction` has been called and `commitTransaction` has
 * not), the op is appended to `pendingTransaction` instead of
 * pushing to the undo stack. The level still updates; only the
 * history-push is deferred until `commitTransaction`.
 *
 * **Never throws.** Out-of-bounds tile indices, references to
 * non-existent entity IDs, and other invalid targets are silent
 * no-ops (input state is returned unchanged, no history entry is
 * created).
 *
 * @example
 * ```ts
 * const next = applyOp(state, {
 *   type: 'addEntity',
 *   kind: 'platform',
 *   rect: { x: 16, y: 32, width: 64, height: 16 },
 *   props: { visual: 'normal' },
 * });
 * // next.level.entities has one more platform than state.level.entities
 * // next.undoStack.length === state.undoStack.length + 1
 * ```
 *
 * @param state - Current editor state (never mutated).
 * @param op    - Operation to apply.
 * @returns A fresh editor state with the op applied, or the input
 *          state unchanged if the op was a no-op.
 */
export function applyOp(state: EditorState, op: EditorOperation): EditorState {
  const preSnapshot = cloneLevel(state.level);
  const workingLevel = cloneLevel(state.level) as WritableLevel;
  const changed = applyMutation(workingLevel, op);

  if (!changed) return state;

  const committedLevel = workingLevel as unknown as LevelData;
  const validation = validateLevel(committedLevel);

  if (state.pendingTransaction !== null) {
    return {
      ...state,
      level: committedLevel,
      pendingTransaction: [...state.pendingTransaction, op],
      validation,
    };
  }

  const label = defaultLabel(op);
  const entry: HistoryEntry = {
    op,
    preSnapshot,
    postSnapshot: cloneLevel(committedLevel),
    label,
    transactionId: state.nextTransactionId,
  };

  const undoStack = [...state.undoStack, entry];
  while (undoStack.length > state.maxHistoryDepth) {
    undoStack.shift();
  }

  return {
    ...state,
    level: committedLevel,
    undoStack,
    redoStack: [],
    nextTransactionId: state.nextTransactionId + 1,
    validation,
  };
}

/**
 * Apply a batch of operations as a single undo step. **Pure.**
 *
 * Equivalent to `applyOp(state, { type: 'batch', ops, label })`. The
 * batch collapses N sub-ops into one {@link HistoryEntry} with the
 * given label.
 *
 * If called inside a transaction, appends a single `batch` op to the
 * pending transaction (the transaction will collapse it into a single
 * history entry on commit).
 *
 * **Never throws.** If every sub-op is a no-op, the input state is
 * returned unchanged.
 *
 * @param state - Current editor state (never mutated).
 * @param ops   - Operations to apply as a batch.
 * @param label - Human-readable label for the undo stack entry.
 * @returns A fresh editor state with the batch applied.
 */
export function applyBatch(
  state: EditorState,
  ops: readonly EditorOperation[],
  label: string,
): EditorState {
  return applyOp(state, { type: 'batch', ops, label });
}
