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
import type { ValidationResult } from '../level/types';

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
    case 'enemy':
      return {
        id,
        kind,
        rect,
        props: props as unknown as Extract<LevelEntity, { kind: 'enemy' }>['props'],
      };
    case 'collectible':
      return {
        id,
        kind,
        rect,
        props: props as unknown as Extract<LevelEntity, { kind: 'collectible' }>['props'],
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
 * Translate a `{x, y}` point by `(dx, dy)` and return a new point.
 * Used to keep movingPlatform path waypoints in lockstep with body moves.
 */
function translatePoint(
  p: { readonly x: number; readonly y: number },
  dx: number,
  dy: number,
): { x: number; y: number } {
  return { x: p.x + dx, y: p.y + dy };
}

/**
 * Coerce a raw `path` array (as stored on `MovingPlatformProps`) into the
 * mutable `{x,y}[]` shape used by the reducer. Returns `null` if `props`
 * is not a movingPlatform props bag or `path` is not an array. Used by
 * `moveEntities` / `setEntityRect` to keep body + path coherent without
 * requiring the playground to issue a separate `updateEntityProps` op.
 */
function coerceMovingPath(
  props: Record<string, unknown>,
): { x: number; y: number }[] | null {
  if (!props || !Array.isArray((props as { path?: unknown }).path)) return null;
  const raw = (props as { path: unknown[] }).path;
  const out: { x: number; y: number }[] = [];
  for (const p of raw) {
    if (p === null || typeof p !== 'object') {
      out.push({ x: 0, y: 0 });
      continue;
    }
    const r = p as { x?: unknown; y?: unknown };
    const x = typeof r.x === 'number' && Number.isFinite(r.x) ? r.x : 0;
    const y = typeof r.y === 'number' && Number.isFinite(r.y) ? r.y : 0;
    out.push({ x, y });
  }
  return out;
}

/**
 * Coerce a raw `patrolPath` array (as stored on `EnemyProps.params`) into
 * the mutable `{x,y}[]` shape used by the reducer. Returns `null` if the
 * supplied `params` bag has no array `patrolPath`. Mirrors
 * {@link coerceMovingPath} for the enemy archetype contract — a built-in
 * Spinny ships with `params.patrolPath` and the runtime spinny behavior
 * targets those waypoints from its body rect, so moving the body must
 * translate every waypoint by the same rect delta or the enemy snaps back
 * to its old patrol box on play.
 */
function coerceEnemyPatrolPath(
  params: Record<string, unknown>,
): { x: number; y: number }[] | null {
  if (!params || !Array.isArray((params as { patrolPath?: unknown }).patrolPath)) return null;
  const raw = (params as { patrolPath: unknown[] }).patrolPath;
  const out: { x: number; y: number }[] = [];
  for (const p of raw) {
    if (p === null || typeof p !== 'object') {
      out.push({ x: 0, y: 0 });
      continue;
    }
    const r = p as { x?: unknown; y?: unknown };
    const x = typeof r.x === 'number' && Number.isFinite(r.x) ? r.x : 0;
    const y = typeof r.y === 'number' && Number.isFinite(r.y) ? r.y : 0;
    out.push({ x, y });
  }
  return out;
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
      // Use an explicit holder object so TS does not narrow through
      // closure assignments (the .map callback writes these; TS's flow
      // analysis cannot follow that the callback runs synchronously).
      const acc: {
        spawnDelta: { dx: number; dy: number } | null;
      } = { spawnDelta: null };
      const next = level.entities.map((e): LevelEntity => {
        if (!idSet.has(e.id)) return e;
        changed = true;
        const translatedRect = translateRect(e.rect, op.dx, op.dy);
        // For movingPlatform entities, translate the path along with the
        // body so the runtime (which compiles path[0] as the home
        // position) stays coherent with the body the user dragged. Without
        // this, the platform snaps back to its old path[0] on play.
        if (e.kind === 'movingPlatform') {
          const path = coerceMovingPath(e.props as unknown as Record<string, unknown>);
          const newPath =
            path !== null
              ? path.map((p) => translatePoint(p, op.dx, op.dy))
              : (e.props as unknown as { path?: unknown }).path;
          const updated = {
            ...e,
            rect: translatedRect,
            props: { ...(e.props as unknown as object), path: newPath },
          } as unknown as LevelEntity;
          return updated;
        }
        // For enemy entities with a valid `params.patrolPath`, translate
        // every waypoint by the same rect delta so the runtime spinny
        // behavior (which targets patrolPath waypoints from its body
        // rect) does not drag the enemy back to its old patrol box on
        // play. Turrets / enemies without a valid patrolPath fall through
        // to the plain rect-only move; malformed params never throw.
        if (e.kind === 'enemy') {
          const paramsBag = (e.props as unknown as { params?: Record<string, unknown> }).params ?? {};
          const patrol = coerceEnemyPatrolPath(paramsBag);
          if (patrol !== null) {
            const newPatrol = patrol.map((p) => translatePoint(p, op.dx, op.dy));
            return {
              ...e,
              rect: translatedRect,
              props: {
                ...(e.props as unknown as object),
                params: { ...paramsBag, patrolPath: newPatrol },
              },
            } as unknown as LevelEntity;
          }
        }
        // For spawn entities, record the delta so we can propagate it to
        // level.spawn below. (Spawn rect changes must update level.spawn
        // or compileLevel() reads a stale spawn and the player spawns at
        // the wrong place.)
        if (e.kind === 'spawn') {
          acc.spawnDelta = { dx: op.dx, dy: op.dy };
        }
        return { ...e, rect: translatedRect };
      });
      if (!changed) return false;
      level.entities = next;
      if (acc.spawnDelta !== null) {
        level.spawn = {
          x: level.spawn.x + acc.spawnDelta.dx,
          y: level.spawn.y + acc.spawnDelta.dy,
        };
      }
      return true;
    }
    case 'setEntityRect': {
      let changed = false;
      // Same closure-narrowing workaround as moveEntities: use an explicit
      // holder object so TS does not narrow these back to `never` after
      // the .map callback runs.
      const acc: {
        spawnFromEntity: { x: number; y: number } | null;
        movingPlatformUpdate:
          | { entityId: EntityId; oldRect: LevelRect; newRect: LevelRect }
          | null;
        enemyUpdate:
          | { entityId: EntityId; oldRect: LevelRect; newRect: LevelRect }
          | null;
      } = { spawnFromEntity: null, movingPlatformUpdate: null, enemyUpdate: null };
      const next = level.entities.map((e): LevelEntity => {
        if (e.id !== op.id) return e;
        changed = true;
        if (e.kind === 'spawn') {
          // Record the new top-left so we can propagate to level.spawn.
          acc.spawnFromEntity = { x: op.rect.x, y: op.rect.y };
        }
        if (e.kind === 'movingPlatform') {
          // Record old + new top-left so path[0] can be translated to
          // match the body. Subsequent waypoints preserve their relative
          // offset from path[0].
          acc.movingPlatformUpdate = {
            entityId: e.id,
            oldRect: e.rect,
            newRect: op.rect,
          };
        }
        if (e.kind === 'enemy') {
          // Record old + new top-left so every valid patrolPath waypoint
          // can be translated by the rect delta (analogous to movingPlatform
          // path translation). Turrets / enemies without a valid patrolPath
          // fall through to the plain rect-only update.
          acc.enemyUpdate = {
            entityId: e.id,
            oldRect: e.rect,
            newRect: op.rect,
          };
        }
        return { ...e, rect: op.rect };
      });
      if (!changed) return false;
      level.entities = next;
      if (acc.spawnFromEntity !== null) {
        level.spawn = { x: acc.spawnFromEntity.x, y: acc.spawnFromEntity.y };
      }
      if (acc.movingPlatformUpdate !== null) {
        // Translate path[0] to the new body top-left, and translate the
        // rest of the path by the same delta so the relative shape is
        // preserved.
        const update = acc.movingPlatformUpdate;
        const dx = update.newRect.x - update.oldRect.x;
        const dy = update.newRect.y - update.oldRect.y;
        const targetId = update.entityId;
        const newRect = update.newRect;
        level.entities = level.entities.map((e): LevelEntity => {
          if (e.id !== targetId) return e;
          if (e.kind !== 'movingPlatform') return e;
          const props = e.props as unknown as Record<string, unknown>;
          const path = coerceMovingPath(props);
          if (path === null || path.length === 0) return e;
          const newPath = path.map((p, i) =>
            i === 0 ? { x: newRect.x, y: newRect.y } : translatePoint(p, dx, dy),
          );
          return {
            ...e,
            props: { ...props, path: newPath },
          } as unknown as LevelEntity;
        });
      }
      if (acc.enemyUpdate !== null) {
        // Translate every valid patrolPath waypoint by the rect delta so
        // the patrol shape is preserved. Malformed / absent patrolPath is
        // left untouched (no throw, no coercion).
        const update = acc.enemyUpdate;
        const dx = update.newRect.x - update.oldRect.x;
        const dy = update.newRect.y - update.oldRect.y;
        const targetId = update.entityId;
        level.entities = level.entities.map((e): LevelEntity => {
          if (e.id !== targetId) return e;
          if (e.kind !== 'enemy') return e;
          const propsBag = (e.props as unknown as { params?: Record<string, unknown> }).params ?? {};
          const patrol = coerceEnemyPatrolPath(propsBag);
          if (patrol === null || patrol.length === 0) return e;
          const newPatrol = patrol.map((p) => translatePoint(p, dx, dy));
          return {
            ...e,
            props: {
              ...(e.props as unknown as object),
              params: { ...propsBag, patrolPath: newPatrol },
            },
          } as unknown as LevelEntity;
        });
      }
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
    case 'replaceLevel': {
      // Validate the replacement level before replacing.
      const validation: ValidationResult = validateLevel(op.level);
      if (!validation.valid) return false;
      // Defensively clone the replacement so mutations don't leak.
      const replacement = JSON.parse(JSON.stringify(op.level)) as WritableLevel;
      // Replace all top-level fields.
      level.version = replacement.version;
      level.id = replacement.id;
      level.name = replacement.name;
      level.width = replacement.width;
      level.height = replacement.height;
      level.tileSize = replacement.tileSize;
      level.spawn = replacement.spawn;
      level.tiles = replacement.tiles;
      level.entities = replacement.entities;
      level.nextEntityId = replacement.nextEntityId;
      // Manage optional fields: set if present on replacement, clear otherwise.
      if (replacement.bottomLava !== undefined) {
        level.bottomLava = replacement.bottomLava;
      } else {
        level.bottomLava = undefined;
      }
      if (replacement.hints !== undefined) {
        level.hints = replacement.hints;
      } else {
        level.hints = undefined;
      }
      if (replacement.flags !== undefined) {
        level.flags = replacement.flags;
      } else {
        level.flags = undefined;
      }
      return true;
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
    case 'replaceLevel':
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
