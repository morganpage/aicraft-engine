# API Proposal: Headless Level-Editor Core

> Target pillar: Pillar 4 (Level Loading). Module: `src/editor/`.
> Builds on research: `docs/research/editor-core.md`.
> Status: DRAFT.

## Problem Statement

The editor core provides the headless state management, undo/redo, selection, snapping, playtest boundary, and validation diagnostic plumbing required to power both the internal developer level builder (Spitekeep/IMP's `src/dev/editor/`) and polished, player-facing UGC editors in future Clone-to-Jest siblings. It operates exclusively on `LevelData` from `src/level/` — no DOM, no rendering, no mouse handling. The core exposes serializable operations (no function closures) so that history can later be transmitted over a network for multi-player collaboration. It must compose cleanly with the existing `validateLevel` and `allocateEntityId` pure functions. One paragraph summary: the editor core is a deterministic, zero-dependency, never-throw reducer layer that sits between the host application's UI event loop and the level schema, providing the complete editing lifecycle — place, move, delete, undo, redo, transaction-grouped drags, multi-select transforms, grid snapping, playtest snapshot/restore, and validation diagnostics — as pure data transformations.

---

## Approach A: Operation Reducer + Linear Operation History

**Source pattern:** Serializable Data-Only Operations (VS Code / Qt QUndoCommand) from `docs/research/editor-core.md` §Pattern 1, combined with the pure-progression-ops discipline from `src/cosmetics/ownership.ts`.

**Core idea:** Every edit to the level is a serializable `EditorOp` discriminated union. A pure `reduceLevel(state, op) → state` function applies one operation and returns a fresh `LevelData`. A `HistoryStack` stores sequences of operations (not snapshots) and supports undo by replaying inverse operations, redo by replaying forward operations. Transactions group multiple ops into one undo step.

**Signature sketch:**

```ts
// src/editor/types.ts

import type { LevelData, EntityId, EntityKind, LevelRect } from '../level/types';

// ── Operations ──────────────────────────────────────────────────────

export interface AddEntityOp {
  readonly type: 'addEntity';
  readonly kind: EntityKind;
  readonly rect: LevelRect;
  readonly props: Record<string, unknown>;
}

export interface RemoveEntityOp {
  readonly type: 'removeEntity';
  readonly id: EntityId;
}

export interface UpdateEntityPropsOp {
  readonly type: 'updateEntityProps';
  readonly id: EntityId;
  readonly props: Record<string, unknown>;
}

export interface MoveEntitiesOp {
  readonly type: 'moveEntities';
  readonly ids: readonly EntityId[];
  readonly dx: number;
  readonly dy: number;
}

export interface PaintTilesOp {
  readonly type: 'paintTiles';
  readonly edits: readonly {
    readonly x: number;
    readonly y: number;
    readonly oldValue: number;
    readonly newValue: number;
  }[];
}

export interface ClearTilesOp {
  readonly type: 'clearTiles';
  readonly edits: readonly {
    readonly x: number;
    readonly y: number;
    readonly oldValue: number;
  }[];
}

export interface SetSpawnPointOp {
  readonly type: 'setSpawnPoint';
  readonly x: number;
  readonly y: number;
}

export interface UpdateLevelPropsOp {
  readonly type: 'updateLevelProps';
  readonly name?: string;
  readonly bottomLava?: { readonly surfaceY: number } | null;
  readonly hints?: readonly string[] | null;
}

export type EditorOp =
  | AddEntityOp
  | RemoveEntityOp
  | UpdateEntityPropsOp
  | MoveEntitiesOp
  | PaintTilesOp
  | ClearTilesOp
  | SetSpawnPointOp
  | UpdateLevelPropsOp;

// ── Transaction ─────────────────────────────────────────────────────

export interface Transaction {
  readonly id: string;
  readonly ops: readonly EditorOp[];
}

// ── History ─────────────────────────────────────────────────────────

export interface HistoryState {
  readonly past: readonly Transaction[];
  readonly future: readonly Transaction[];
  readonly maxDepth: number;
}

// ── Selection ───────────────────────────────────────────────────────

export type Selection =
  | { readonly kind: 'none' }
  | { readonly kind: 'entity'; readonly ids: readonly EntityId[] }
  | { readonly kind: 'spawn' };

// ── Editor State (the full headless document) ───────────────────────

export interface EditorState {
  readonly level: LevelData;
  readonly history: HistoryState;
  readonly selection: Selection;
  readonly snapToGrid: boolean;
  readonly gridSize: number;
}

// ── Reducer ─────────────────────────────────────────────────────────

export function reduceLevel(level: LevelData, op: EditorOp): LevelData;
// Pure: returns fresh LevelData. Never throws.

// ── History ops ─────────────────────────────────────────────────────

export function commitTransaction(
  state: EditorState,
  tx: Transaction,
): EditorState;

export function undo(state: EditorState): EditorState;
export function redo(state: EditorState): EditorState;
export function canUndo(state: EditorState): boolean;
export function canRedo(state: EditorState): boolean;

// ── Selection ops ───────────────────────────────────────────────────

export function selectSingle(state: EditorState, id: EntityId): EditorState;
export function selectAdditive(state: EditorState, id: EntityId): EditorState;
export function clearSelection(state: EditorState): EditorState;
export function queryMarquee(
  level: LevelData,
  rect: LevelRect,
): readonly EntityId[];

// ── Snapping ────────────────────────────────────────────────────────

export function snapToGrid(
  x: number,
  y: number,
  gridSize: number,
): { x: number; y: number };

// ── Playtest ────────────────────────────────────────────────────────

export function enterPlaytest(level: LevelData): LevelData;
// Returns JSON.deepClone. Pure.

// ── Validation ──────────────────────────────────────────────────────

export function validateEditorLevel(
  level: LevelData,
): import('../level/types').ValidationResult;
// Re-exports validateLevel from src/level/validate.ts
```

**Usage example:**

```ts
import {
  createEditorState,
  reduceLevel,
  commitTransaction,
  undo,
  redo,
  selectSingle,
  snapToGrid,
  enterPlaytest,
} from './lib/aicraft-engine/src/editor';

// 1. Create initial state
const initial = createEditorState(myLevel, { maxDepth: 50, gridSize: 8 });

// 2. Place an entity
const placed = commitTransaction(initial, {
  id: 'tx-1',
  ops: [
    {
      type: 'addEntity',
      kind: 'platform',
      rect: snapToGrid(100, 200, 8),
      props: { visual: 'normal' },
    },
  ],
});
// placed.level.entities now has one new platform

// 3. Drag the entity (transaction groups many move ops)
const dragTx = commitTransaction(placed, {
  id: 'tx-drag',
  ops: [
    { type: 'moveEntities', ids: [placed.level.nextEntityId - 1], dx: 16, dy: 0 },
  ],
});

// 4. Undo the drag — entity snaps back
const afterUndo = undo(dragTx);
// afterUndo.level.entities[0].rect.x === 100 (original position)

// 5. Redo the drag
const afterRedo = redo(afterUndo);
// afterRedo.level.entities[0].rect.x === 116 (moved 16px right)

// 6. Select the entity
const selected = selectSingle(afterRedo, afterRedo.level.nextEntityId - 1);

// 7. Enter playtest — editor state frozen, clone returned
const playtestLevel = enterPlaytest(selected.level);
// playtestLevel is a deep clone; safe to mutate in simulation
// selected.level remains untouched
```

**Trade-offs:**

| Dimension | Rating | Justification |
|---|---|---|
| Ergonomics (simple) | Medium | Consumer must construct op objects manually; more boilerplate than imperative methods |
| Ergonomics (complex) | High | Serializable ops compose naturally — transactions, multi-select, batch tile paint are all just arrays of ops |
| Determinism | High | Pure reducer, no side effects, operation log reproduces identically |
| Memory cost | High | Only stores operations (small discriminators + payloads), not full snapshots; bounded by maxDepth |
| Collaboration readiness | High | Operations are already serializable data — drop-in compatible with CRDT/OT later |
| Tree-shake-ability | High | Each op type and each reducer function is independently importable |
| Public API stability | High | Adding new op types is additive; existing ops never change shape |
| Playtest boundary | High | `enterPlaytest` is a separate pure function; clean separation |

**What this makes easy:** Multi-player collaboration (ops transmit over WebSocket), undo/redo with bounded memory, tile painting with sparse deltas, composability with existing `validateLevel`.

**What this makes hard:** Every consumer call site requires constructing typed op objects — more verbose than `editor.addEntity(...)`. The consumer must manage transaction IDs for drag grouping themselves.

---

## Approach B: Stateful Editor Wrapper

**Source pattern:** Spitekeep's `LevelStore` class (`src/dev/editor/store.ts`) combined with the Figma scene-graph pattern from `docs/research/editor-core.md` §Pattern 2.

**Core idea:** A `LevelEditor` class owns the current `LevelData`, the undo/redo history (over full snapshots, like Spitekeep's existing `UndoRedoState<LevelData>`), the selection state, and the snap-to-grid toggle. Exposes imperative methods (`editor.addEntity(...)`, `editor.moveEntities(...)`, `editor.undo()`). Internally each method deep-clones the level, applies the mutation, and pushes onto the history stack. Operations are NOT individually serializable — only the snapshot history is.

**Signature sketch:**

```ts
// src/editor/types.ts

import type { LevelData, EntityId, EntityKind, LevelRect } from '../level/types';
import type { ValidationResult } from '../level/types';

// ── Selection ───────────────────────────────────────────────────────

export type Selection =
  | { readonly kind: 'none' }
  | { readonly kind: 'entity'; readonly ids: readonly EntityId[] }
  | { readonly kind: 'spawn' };

// ── Config ──────────────────────────────────────────────────────────

export interface EditorConfig {
  readonly maxDepth?: number;
  readonly gridSize?: number;
}

// ── Editor class ────────────────────────────────────────────────────

export class LevelEditor {
  constructor(level: LevelData, config?: EditorConfig);

  // ── Current state ─────────────────────────────────────────────
  get level(): LevelData;
  get selection(): Selection;
  get snapToGrid(): boolean;
  get gridSize(): number;

  // ── Entity operations ─────────────────────────────────────────
  addEntity(
    kind: EntityKind,
    rect: LevelRect,
    props?: Record<string, unknown>,
  ): EntityId;
  removeEntity(id: EntityId): void;
  removeEntities(ids: readonly EntityId[]): void;
  updateEntityProps(id: EntityId, props: Record<string, unknown>): void;
  moveEntities(ids: readonly EntityId[], dx: number, dy: number): void;

  // ── Tile operations ───────────────────────────────────────────
  paintTiles(edits: readonly {
    readonly x: number;
    readonly y: number;
    readonly value: number;
  }[]): void;
  clearTiles(coords: readonly { readonly x: number; readonly y: number }[]): void;

  // ── Level-level ops ───────────────────────────────────────────
  setSpawnPoint(x: number, y: number): void;
  updateLevelProps(props: { name?: string; bottomLava?: { surfaceY: number } | null }): void;

  // ── History ───────────────────────────────────────────────────
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // ── Selection ─────────────────────────────────────────────────
  selectSingle(id: EntityId): void;
  selectAdditive(id: EntityId): void;
  selectNone(): void;

  // ── Playtest boundary ─────────────────────────────────────────
  enterPlaytest(): LevelData;

  // ── Validation ────────────────────────────────────────────────
  validate(): ValidationResult;
}
```

**Usage example:**

```ts
import { LevelEditor } from './lib/aicraft-engine/src/editor';

// 1. Create editor
const editor = new LevelEditor(myLevel, { maxDepth: 50, gridSize: 8 });

// 2. Place an entity
const id = editor.addEntity(
  'platform',
  { x: 100, y: 200, width: 64, height: 16 },
  { visual: 'normal' },
);

// 3. Drag the entity (single undo step because each move is a separate call
//    grouped by a beginTransaction/endTransaction pair)
editor.beginTransaction();
editor.moveEntities([id], 16, 0);
editor.moveEntities([id], 8, 0);
editor.endTransaction(); // groups into one undo step

// 4. Undo the drag
editor.undo();
// entity back at original position

// 5. Redo the drag
editor.redo();
// entity moved 24px right total

// 6. Select the entity
editor.selectSingle(id);

// 7. Enter playtest
const playtestLevel = editor.enterPlaytest();
// editor is frozen; playtestLevel is a deep clone
```

**Trade-offs:**

| Dimension | Rating | Justification |
|---|---|---|
| Ergonomics (simple) | High | `editor.addEntity(...)` reads like English; IDE autocomplete is excellent |
| Ergonomics (complex) | Medium | Transactions via begin/end pairs; harder to serialize for collaboration; imperative mutation makes multi-select transforms verbose |
| Determinism | Medium | Internally pure (clone + mutate + push), but the class itself is stateful — the mutation log is implicit, not replayable |
| Memory cost | Low | Stores full `LevelData` snapshots per undo step — a 500×500 tile level is ~1 MB per snapshot; 50 steps = 50 MB |
| Collaboration readiness | Low | No serializable operation log — you'd need to diff snapshots to transmit changes, or retrofit an op recorder |
| Tree-shake-ability | Low | The class bundles everything; consumers can't import just the tile painter without pulling in entity ops, selection, history |
| Public API stability | Medium | Adding methods is additive, but changing the class shape (e.g. adding a required config field) is breaking |
| Playtest boundary | High | `enterPlaytest()` is a clean method that deep-clones |

**What this makes easy:** Getting started — the consumer writes `editor.addEntity(...)` and it just works. Matches Spitekeep's existing `LevelStore` pattern almost 1:1, so migration is trivial.

**What this makes hard:** Multi-player collaboration (no op log to transmit), memory-heavy for large levels, tree-shaking (you get the whole class or nothing), and the imperative API hides the operation history from consumers who need it.

---

## Approach C: Hybrid — Operation Reducer + Snapshot History

**Source pattern:** Tiled's tile-paint history (`docs/research/editor-core.md` §Pattern 4) for the operation layer, combined with the Snapshot Sandbox pattern (§Pattern 8) for the history layer.

**Core idea:** A middle ground. Operations are serializable discriminated unions (like Approach A), but the history stores **full snapshots** (like Approach B) rather than replaying inverse operations. This gives you: (1) serializable ops for future collaboration, (2) cheap undo/redo via snapshot restore (no inverse-op computation), and (3) a pure reducer for testing. The trade-off is memory: snapshots are larger than operation logs.

**Signature sketch:**

```ts
// src/editor/types.ts

import type { LevelData, EntityId, EntityKind, LevelRect } from '../level/types';
import type { ValidationResult } from '../level/types';

// ── Operations (serializable — for future collaboration) ────────────

export type EditorOp =
  | { readonly type: 'addEntity'; readonly kind: EntityKind; readonly rect: LevelRect; readonly props: Record<string, unknown> }
  | { readonly type: 'removeEntity'; readonly id: EntityId }
  | { readonly type: 'updateEntityProps'; readonly id: EntityId; readonly props: Record<string, unknown> }
  | { readonly type: 'moveEntities'; readonly ids: readonly EntityId[]; readonly dx: number; readonly dy: number }
  | { readonly type: 'paintTiles'; readonly edits: readonly { readonly x: number; readonly y: number; readonly oldValue: number; readonly newValue: number }[] }
  | { readonly type: 'clearTiles'; readonly edits: readonly { readonly x: number; readonly y: number; readonly oldValue: number }[] }
  | { readonly type: 'setSpawnPoint'; readonly x: number; readonly y: number };

// ── Reducer (pure) ──────────────────────────────────────────────────

export function reduceLevel(level: LevelData, op: EditorOp): LevelData;

// ── Snapshot History ────────────────────────────────────────────────

export interface SnapshotHistory {
  readonly past: readonly LevelData[];
  readonly present: LevelData;
  readonly future: readonly LevelData[];
  readonly maxDepth: number;
}

export function createSnapshotHistory(
  initial: LevelData,
  maxDepth?: number,
): SnapshotHistory;
export function pushSnapshot(history: SnapshotHistory, level: LevelData): SnapshotHistory;
export function undoSnapshot(history: SnapshotHistory): SnapshotHistory;
export function redoSnapshot(history: SnapshotHistory): SnapshotHistory;

// ── Editor State ────────────────────────────────────────────────────

export interface EditorState {
  readonly level: LevelData;
  readonly history: SnapshotHistory;
  readonly selection: Selection;
  readonly snapToGrid: boolean;
  readonly gridSize: number;
  readonly pendingOps: readonly EditorOp[];
  // pendingOps accumulates ops within a transaction before committing
}

// ── Transaction ─────────────────────────────────────────────────────

export function beginTransaction(state: EditorState): EditorState;
export function applyOp(state: EditorState, op: EditorOp): EditorState;
// Applies op to level via reduceLevel AND appends to pendingOps.
// Does NOT push to snapshot history yet.

export function commitTransaction(state: EditorState): EditorState;
// Pushes current level to snapshot history, clears pendingOps.

// ── Convenience (thin wrappers) ─────────────────────────────────────

export function addEntity(
  state: EditorState,
  kind: EntityKind,
  rect: LevelRect,
  props?: Record<string, unknown>,
): EditorState;
// Wraps applyOp with { type: 'addEntity', ... }

// (similar for removeEntity, moveEntities, paintTiles, etc.)

export function undo(state: EditorState): EditorState;
export function redo(state: EditorState): EditorState;

// ── Selection ───────────────────────────────────────────────────────

export type Selection =
  | { readonly kind: 'none' }
  | { readonly kind: 'entity'; readonly ids: readonly EntityId[] }
  | { readonly kind: 'spawn' };

export function selectSingle(state: EditorState, id: EntityId): EditorState;
export function selectAdditive(state: EditorState, id: EntityId): EditorState;
export function clearSelection(state: EditorState): EditorState;

// ── Playtest ────────────────────────────────────────────────────────

export function enterPlaytest(level: LevelData): LevelData;

// ── Validation ──────────────────────────────────────────────────────

export function validateEditorLevel(level: LevelData): ValidationResult;
```

**Usage example:**

```ts
import {
  createEditorState,
  beginTransaction,
  applyOp,
  commitTransaction,
  undo,
  redo,
  selectSingle,
  enterPlaytest,
  snapToGrid,
} from './lib/aicraft-engine/src/editor';

// 1. Create initial state
let state = createEditorState(myLevel, { maxDepth: 50, gridSize: 8 });

// 2. Place an entity (committed immediately)
state = applyOp(state, {
  type: 'addEntity',
  kind: 'platform',
  rect: snapToGrid(100, 200, 8),
  props: { visual: 'normal' },
});
state = commitTransaction(state);
// state.level.entities now has one platform; history has one snapshot

// 3. Drag the entity (transaction groups many ops)
state = beginTransaction(state);
const entityId = state.level.nextEntityId - 1;
state = applyOp(state, { type: 'moveEntities', ids: [entityId], dx: 8, dy: 0 });
state = applyOp(state, { type: 'moveEntities', ids: [entityId], dx: 8, dy: 0 });
state = commitTransaction(state); // one undo step

// 4. Undo the drag
state = undo(state);
// state.level.entities[0].rect.x === 100 (original)

// 5. Redo the drag
state = redo(state);
// state.level.entities[0].rect.x === 116

// 6. Select entity
state = selectSingle(state, entityId);

// 7. Enter playtest
const playtestLevel = enterPlaytest(state.level);
```

**Trade-offs:**

| Dimension | Rating | Justification |
|---|---|---|
| Ergonomics (simple) | Medium | Same as Approach A — op object construction required; convenience wrappers help but still more verbose than a class |
| Ergonomics (complex) | High | Serializable ops + convenience wrappers give both power and readability |
| Determinism | High | Pure reducer + snapshot history — fully deterministic and reproducible |
| Memory cost | Low-Medium | Stores full snapshots (like Approach B) — but the op log is available for future delta-history optimization |
| Collaboration readiness | High | Ops are serializable for transmission; snapshots are the local undo mechanism |
| Tree-shake-ability | High | Pure functions, individually importable; the convenience wrappers are thin |
| Public API stability | High | Adding new op types is additive; snapshot history is stable |
| Playtest boundary | High | `enterPlaytest` is a separate pure function |

**What this makes easy:** Future migration to delta-history (swap snapshot storage for op-replay without changing the op types), collaboration (ops transmit, snapshots are local), and testing (pure reducer is independently testable).

**What this makes hard:** Two layers of indirection (ops + snapshots) — slightly more cognitive overhead than either pure approach. The `pendingOps` array on `EditorState` is transient state that consumers must not leak.

---

## Comparison Table

| Criterion | A: Op Reducer + Op History | B: Stateful Wrapper | C: Hybrid (Ops + Snapshot History) |
|---|---|---|---|
| Ergonomics (simple) | Medium | **High** | Medium |
| Ergonomics (complex) | **High** | Medium | **High** |
| Determinism | **High** | Medium | **High** |
| Memory cost | **High** | Low | Low-Medium |
| Collaboration readiness | **High** | Low | **High** |
| Tree-shake-ability | **High** | Low | **High** |
| Public API stability | **High** | Medium | **High** |
| Playtest boundary | **High** | **High** | **High** |

---

## Recommendation

**Approach C: Hybrid (Operation Reducer + Snapshot History).**

Approach C is the right design because it solves the real tension the research identified: operations must be serializable for collaboration, but undo/redo must be cheap and simple. By storing snapshots for undo (like Approach B's simplicity) while recording operations for future transmission (like Approach A's collaboration readiness), we get both without the inverse-operation complexity that Approach A's op-history requires. The inverse-op reducer in Approach A is fragile — tile paint operations need to record `oldValue` for every cell, entity adds need to record the allocated ID for removal, and any new op type requires a matching inverse. Snapshot history eliminates this entirely: undo is just "restore the previous snapshot."

For operation merging (the drag transaction question), Approach C handles it cleanly: the consumer calls `beginTransaction`, emits many `moveEntities` ops via `applyOp`, then calls `commitTransaction`. The ops are accumulated in `pendingOps` and the current level (after applying all ops) is pushed as one snapshot. The consumer controls the merge boundary — no heuristic needed in the core. This matches Spitekeep's existing `store.update(d => { d.platforms.push(...) })` pattern where the mutation closure IS the transaction boundary.

For sparse tile grids and large levels, the snapshot approach does store more memory than op-replay. However, the `LevelData.tiles.data` flat array for a typical 100×50 level at 8px tiles is only ~2 KB per snapshot. Even at 500×500 (~100 KB per snapshot × 50 depth = 5 MB), this is negligible for an editor running in a browser. The research note's concern about sparse grids is premature optimization — ship snapshots first, add delta-history later if profiling shows it matters. The op types are already designed to support sparse deltas (`paintTiles` carries `oldValue`/`newValue` pairs), so the migration path is clear.

Multi-layer support is deferred. The current `LevelData` schema has a single `tiles` grid and a single `entities` array. Adding layers later is a schema evolution (new field on `LevelData`), not an editor-core change. The reducer already handles arbitrary `LevelData` shapes — it doesn't care whether tiles are single-layer or multi-layer. The `EditorOp` types for tile operations would gain an optional `layer` field in v2, which is additive and non-breaking.

---

## Operation Taxonomy (v1)

The v1 must support these operations. Every operation is a serializable discriminated union variant. Every operation composes with `reduceLevel` and is independently testable.

| Operation | Description | ID Allocation | Notes |
|---|---|---|---|
| `addEntity` | Add a new entity at a position with a kind and props | Uses `allocateEntityId` internally; bumps `nextEntityId` | Returns the allocated ID via the resulting `LevelData.nextEntityId - 1` |
| `removeEntity` | Remove an entity by stable `EntityId` | None | No-op if ID not found |
| `updateEntityProps` | Partial-merge props onto an existing entity | None | No-op if ID not found; merges with spread |
| `moveEntities` | Translate one or more entities by `(dx, dy)` | None | Multi-select aware; each entity's `rect.x`/`rect.y` offset |
| `paintTiles` | Set a batch of tile cells to new values | None | Carries `oldValue` per cell for sparse undo (future optimization) |
| `clearTiles` | Reset a batch of tile cells to 0 | None | Carries `oldValue` per cell |
| `setSpawnPoint` | Move the default spawn position | None | Single `{x, y}` |
| `updateLevelProps` | Update level-level metadata (name, bottomLava, hints) | None | Partial merge; `null` removes the field |
| `batch` | Group multiple ops into one undo step | N/A | Transaction wrapper, not a reducer op — handled at the history level |

### Deferred operations (v2+)

| Operation | Why deferred |
|---|---|
| `copyEntities` / `pasteEntities` | Requires clipboard state management; ship a minimal version later |
| `rotateEntities` | Requires rotation math on rects; defer until rotation handles ship |
| `setTile` (single) | Covered by `paintTiles` with a single edit; no need for a separate op |
| `resizeLevel` | Schema migration risk; defer until consumers need it |
| `undoableBatch` (smart merge) | Qt-style merge heuristics; defer until profiling shows transaction grouping is insufficient |

---

## Scope for v1

### Ship in v1

- **Core edit loop:** `addEntity`, `removeEntity`, `updateEntityProps`, `moveEntities`, `paintTiles`, `clearTiles`, `setSpawnPoint`
- **Undo/redo:** Snapshot-based history with configurable `maxDepth` (default 50)
- **Transactions:** `beginTransaction` / `commitTransaction` for drag grouping
- **Selection:** Single entity select, additive select (shift-click), clear selection, marquee query
- **Grid snapping:** Pure `snapToGrid` utility function
- **Playtest boundary:** `enterPlaytest` returns a deep clone; editor frozen during playtest
- **Validation diagnostics:** `validateEditorLevel` wraps `validateLevel` from `src/level/`
- **Entity ID allocation:** Internal use of `allocateEntityId` from `src/level/entity-id.ts`

### Defer to v2+

- Smart guides / edge alignment
- Rotation handles / rotation ops
- Copy/paste clipboard (cross-tab or in-memory)
- Prefab library (minimal version can ship as a simple `addEntity` preset catalog)
- Multi-layer tile support
- Level resize
- Thumbnail rendering helper
- Multi-player collaboration (ops are already serializable — the CRDT layer is separate)
- Delta-history / sparse snapshot optimization

---

## Open Questions for @architect

1. **Should `EditorState` be immutable or mutable?** Approach C's sketch uses immutable state (every function returns a new `EditorState`). This matches the library's pure-progression-ops discipline but means the consumer must thread `state` through every call (`state = addEntity(state, ...)`). Spitekeep's `LevelStore` is mutable (class with `update()` method). Should we offer both? Or commit to immutable-only?

2. **Should the `LevelEditor` convenience class (Approach B's API shape) be a thin wrapper over Approach C's pure functions?** This would give consumers the ergonomic `editor.addEntity(...)` API while preserving the pure-function core for testing and collaboration. The class would own the `EditorState` and mutate it internally, exposing the same methods. This is essentially "Approach C with Approach B's ergonomics."

3. **Transaction ID format:** The sketch uses `string` IDs (`'tx-1'`, `'tx-drag'`). Should we use monotonic integers instead (cheaper, simpler), or keep strings for human-readability in logs and collaboration transcripts?

4. **`paintTiles` oldValue recording:** For v1, should every `paintTiles` op always record `oldValue` for each cell (enables future sparse undo), or should v1 skip `oldValue` and record it only when we actually implement delta-history? Recording `oldValue` has negligible cost for typical brush sizes but adds complexity to the reducer.
