# Decision: Editor Core

> Status: APPROVED for implementation.
> Proposal: `docs/design/editor-core-proposal.md`.
> Research: `docs/research/editor-core.md`.
> Architect: self-review (orchestrator decision per workflow §Step 6).

## Chosen approach

**Approach C (Hybrid) — Serializable Operations + Snapshot History, with immutable EditorState.**

Operations are a serializable discriminated union (data-only, no closures). History stores `{ op, preSnapshot, postSnapshot }` triples where each snapshot is a deep JSON-clone of the level. Undo restores `preSnapshot`; redo restores `postSnapshot`. The serializable `op` is kept for future collaboration (CRDT/OT) and for editor diagnostics ("Undo: Move 3 entities").

## Why

1. **Approach A (pure op-reducer) is the right purity model but inverse-op computation is fragile.** Computing "the inverse of moving entities from {A,B,C} to {A',B',C'}" requires storing the pre-state anyway. If we're storing pre-state, we may as well snapshot the whole level — it's small (a LevelData is a few KB).

2. **Approach B (stateful class wrapper) is ergonomic but locks us out of collaboration.** Closure-based commands can't be serialized for CRDT merge. Imperative mutability breaks determinism. The pure-functions-with-snapshot-history of Approach C gives us the same ergonomics via thin wrapper functions (`beginTransaction`, `commitTransaction`) without the costs.

3. **Snapshots are cheap.** A typical LevelData is ~2 KB (60×34 tile grid as a flat number array = 2 KB; entities array = a few hundred bytes; metadata = negligible). A bounded 100-step history is ~200 KB — trivially small for a tab. Sparse delta-history is premature optimization.

4. **Operations stay serializable for collaboration readiness.** Even though undo uses snapshots, the op record is the data a future CRDT layer would transmit. We don't implement CRDT in v1, but we don't preclude it.

## Resolutions to open questions

1. **EditorState is immutable.** Every reducer returns a new EditorState (shallow-copied). The `LevelEditor` class wrapper is the consumer's choice, not the library's. The library ships pure functions only.

2. **No `LevelEditor` class in v1.** The library ships `createEditorState(level)`, `applyOp(state, op)`, `undo(state)`, `redo(state)`, `beginTransaction(state)`, `commitTransaction(state)`. A class wrapper can be added later if consumers want it. The showcase or a future reference editor app can compose these.

3. **Transaction ID format: monotonic integer.** Cheap, deterministic, sortable. The editor state owns a `nextTransactionId` counter (allocated via the same `allocateEntityId`-style pure pattern). String IDs would require either `Date.now()` (banned) or `Math.random` (banned).

4. **`paintTiles` records `oldValue` per cell in the op.** This makes the op self-contained for diagnostics ("Undo: Paint 24 tiles from solid→empty") and for future sparse-delta optimization. Memory cost: 24 bytes per cell × typical paint = trivial.

## Operation taxonomy (v1)

The discriminated union `EditorOperation`:

```ts
type EditorOperation =
  | { type: 'addEntity'; kind: EntityKind; rect: LevelRect; props: Record<string, unknown> }
  | { type: 'removeEntity'; id: EntityId }
  | { type: 'updateEntityProps'; id: EntityId; propsPatch: Record<string, unknown> }
  | { type: 'moveEntities'; ids: readonly EntityId[]; dx: number; dy: number }
  | { type: 'setEntityRect'; id: EntityId; rect: LevelRect }
  | { type: 'paintTiles'; cells: readonly { x: number; y: number; newValue: number; oldValue: number }[] }
  | { type: 'setSpawnPoint'; x: number; y: number }
  | { type: 'batch'; ops: readonly EditorOperation[]; label: string };
```

- All operations are serializable (data only).
- `batch` groups multiple ops into one undo step with a human-readable label.
- `moveEntities` is the workhorse for drag operations (multi-select translate).
- `paintTiles` carries both old and new values per cell for diagnostics.

## History model

- Bounded stack (default `maxDepth: 100`).
- Each entry: `{ op: EditorOperation; preSnapshot: LevelData; postSnapshot: LevelData; label: string; transactionId: number }`.
- `undo(state)`: pops the top entry, restores `preSnapshot`, pushes the entry to the redo stack, returns new EditorState.
- `redo(state)`: pops the top redo entry, restores `postSnapshot`, pushes back to undo stack.
- New op (not part of a batch): clears the redo stack.
- Transactions: `beginTransaction(state)` returns a state with `pendingTransaction: []`. `applyOp` during a transaction appends to `pendingTransaction` without touching history. `commitTransaction(state, label)` collapses the pending ops into one history entry.

## Selection model

```ts
interface SelectionState {
  readonly ids: ReadonlySet<EntityId>;
  readonly mode: 'replace' | 'add' | 'subtract' | 'toggle';
}
```

- Pure data — no closures.
- Selecting is itself NOT a history operation (selection is ephemeral UI state, not authoring state). The library tracks selection in `EditorState.selection` but does not record selection changes in history.
- Marquee selection is a UI concern (compute the box, call `selectInRect(editor.level, rect, mode)`).

## Snapping model

Pure functions in `src/editor/snapping.ts`:

- `snapToGrid(x, y, gridSize) → { x, y }`
- `snapRectToGrid(rect, gridSize) → LevelRect`
- `snapToEdges(movedRect, otherRects, threshold) → { rect, guides: SnapGuide[] }` — returns the snapped rect plus any alignment guides for UI rendering.

No DOM, no rendering — just math. The reference editor renders the guides.

## Playtest boundary (sandbox pattern)

- `enterPlaytest(level) → { snapshot: LevelData; runtimeLevel: LevelData }` — deep JSON-clones the level.
- The consumer runs their simulation (e.g. `stepPlatformer`) against `runtimeLevel`. All mutations stay on the runtime copy.
- `exitPlaytest(snapshot) → LevelData` — restores the snapshot. Any runtime mutations are discarded.
- The library does NOT run the simulation — that's the consumer's job. It just provides the snapshot/restore boundary.

## Validation integration

- The editor calls `validateLevel(state.level)` from `src/level/validate.ts` after every op (or on demand).
- `EditorState` carries a `validation: ValidationResult` cache, recomputed on each `applyOp`.
- The reference editor surfaces diagnostics via the `ValidationError.path` field (clickable in inspector).

## Out of scope for v1 (deferred)

- Smart alignment guides (snap to centers, snap to equal spacing).
- Rotation handles (LevelEntity rects are axis-aligned; rotation needs entity type extension).
- Cross-tab clipboard (in-app copy/paste is in scope; system clipboard is deferred).
- Prefab libraries beyond a simple catalog.
- Multiplayer collaboration (ops are serializable, ready for future CRDT, but no merge layer ships).
- Thumbnails (deferred to renderer pillar integration).
- Reference editor app UI (Phase 4 — separate app).

## Files to implement

```
src/editor/
├── types.ts              # EditorState, EditorOperation (discriminated union), SelectionState, HistoryEntry, PlaytestState, SnapGuide
├── constants.ts          # DEFAULT_MAX_HISTORY_DEPTH, DEFAULT_GRID_SIZE
├── operations.ts         # applyOp(state, op) — pure reducer that applies op to level
├── history.ts            # undo, redo, beginTransaction, commitTransaction
├── selection.ts          # select, selectAdd, selectRemove, selectToggle, selectInRect, clearSelection
├── snapping.ts           # snapToGrid, snapRectToGrid, snapToEdges
├── clipboard.ts          # copySelection, pasteClipboard (in-memory only)
├── playtest.ts           # enterPlaytest, exitPlaytest
├── catalog.ts            # EntityCatalog — minimal prefab registry (kind → default rect + props)
├── factory.ts            # createEditorState(level) — initializes state with validation cache
└── index.ts              # Barrel export
```

Tests in `src/tests/`:
- `editor-operations.test.ts`
- `editor-history.test.ts`
- `editor-selection.test.ts`
- `editor-snapping.test.ts`
- `editor-clipboard.test.ts`
- `editor-playtest.test.ts`
- `editor-catalog.test.ts`
- `editor-barrel.test.ts` (or extend `barrel-contract.test.ts`)

## v1 conformance suite (must pass before merge)

1. **Add entity**: applyOp with addEntity → entity appears in level; history has 1 entry; allocateEntityId advances.
2. **Remove entity**: removes by ID; history records the removed entity for undo.
3. **Update props**: partial patch merges cleanly.
4. **Move entities**: multi-select translate produces correct new positions.
5. **Paint tiles**: rect of tile values updates grid.
6. **Undo**: restores preSnapshot exactly.
7. **Redo**: restores postSnapshot exactly.
8. **New op clears redo stack**.
9. **Transaction**: beginTransaction + N ops + commitTransaction produces 1 history entry.
10. **History bounded**: pushing past maxDepth evicts the oldest entry.
11. **Selection**: add/remove/toggle produce correct ID sets.
12. **Snapping**: grid and edge snapping produce correct snapped coordinates.
13. **Playtest snapshot/restore**: round-trip preserves editor state byte-identically.
14. **Validation cache**: recompute after each op; diagnostics current.
15. **Purity**: no input mutation across all operations.
