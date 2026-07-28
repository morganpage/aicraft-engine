/**
 * Type definitions for the editor module (Pillar 4 — Level Editor Core).
 *
 * The editor core is a deterministic, zero-dependency, never-throw reducer
 * layer that sits between the host application's UI event loop and the
 * level schema in `src/level/types.ts`. It exposes serializable operations
 * (no function closures) so history can later be transmitted over a network
 * for multi-player collaboration, and snapshot-based undo/redo so restore
 * is cheap and inverse-op computation is unnecessary.
 *
 * Determinism note: every field below is a primitive, plain readonly
 * object, or readonly array — the shape survives a JSON round-trip and
 * reproduces identically across engines. The single intentional exception
 * is {@link SelectionState.ids}, which is a `ReadonlySet<EntityId>` for
 * O(1) membership checks in hot UI code paths. Selection is **ephemeral
 * UI state** — it is never recorded in history and never serialized.
 *
 * @module
 */

import type {
  LevelData,
  LevelEntity,
  EntityId,
  EntityKind,
  LevelRect,
  ValidationResult,
} from '../level/types';

/**
 * A single serializable editor operation. **Never contains closures.**
 *
 * Operations are a discriminated union on `type`. Every variant is plain
 * data only — safe to transmit over a network, persist to disk, or replay
 * deterministically. The reducer ({@link applyOp}) consumes ops and emits
 * a fresh {@link EditorState}; inverse-op computation is never required
 * because undo uses snapshots.
 *
 * Each variant documents its no-op conditions (the reducer never throws).
 */
export type EditorOperation =
  | {
      readonly type: 'addEntity';
      readonly kind: EntityKind;
      readonly rect: LevelRect;
      readonly props: Record<string, unknown>;
    }
  | { readonly type: 'removeEntity'; readonly id: EntityId }
  | {
      readonly type: 'updateEntityProps';
      readonly id: EntityId;
      readonly propsPatch: Record<string, unknown>;
    }
  | {
      readonly type: 'moveEntities';
      readonly ids: readonly EntityId[];
      readonly dx: number;
      readonly dy: number;
    }
  | {
      readonly type: 'setEntityRect';
      readonly id: EntityId;
      readonly rect: LevelRect;
    }
  | {
      readonly type: 'paintTiles';
      readonly cells: readonly {
        readonly x: number;
        readonly y: number;
        readonly newValue: number;
        readonly oldValue: number;
      }[];
    }
  | { readonly type: 'setSpawnPoint'; readonly x: number; readonly y: number }
  | {
      readonly type: 'batch';
      readonly ops: readonly EditorOperation[];
      readonly label: string;
    }
  | {
      readonly type: 'replaceLevel';
      readonly level: LevelData;
      readonly label: string;
    };

/**
 * A single entry in the undo/redo history stack.
 *
 * Stores both the serializable op (for diagnostics and future CRDT
 * transmission) and the pre/post snapshots (for cheap restore without
 * inverse-op computation). Snapshots are deep JSON-clones — no shared
 * references with the live {@link EditorState.level}.
 */
export interface HistoryEntry {
  /** The op that was applied (for diagnostics / collaboration). */
  readonly op: EditorOperation;
  /** The level state BEFORE the op was applied. */
  readonly preSnapshot: LevelData;
  /** The level state AFTER the op was applied. */
  readonly postSnapshot: LevelData;
  /** Human-readable label for the UI ("Undo: Move 3 entities"). */
  readonly label: string;
  /** Monotonic ID for transaction grouping. */
  readonly transactionId: number;
}

/**
 * Selection mode for additive/subtractive selection.
 *
 * - `'replace'` — new set is exactly the given IDs (default click).
 * - `'add'` — union of existing and new (shift-click adds).
 * - `'subtract'` — existing minus new (alt-click removes).
 * - `'toggle'` — symmetric difference (ctrl-click flips).
 */
export type SelectionMode = 'replace' | 'add' | 'subtract' | 'toggle';

/**
 * Pure-data selection state. **No closures.**
 *
 * `ids` is a `ReadonlySet` for O(1) membership checks. Selection is
 * **ephemeral UI state** — it is never recorded in {@link HistoryEntry}
 * and never serialized. Undo/redo does not restore selection except
 * defensively (clearing selection if the selected entities no longer
 * exist after an undo).
 */
export interface SelectionState {
  readonly ids: ReadonlySet<EntityId>;
}

/**
 * Alignment guide returned by `snapToEdges` for UI rendering.
 *
 * The reference editor draws these as thin lines spanning `[start, end]`
 * along the relevant axis, positioned at `position`. Pure data — the
 * editor core never touches the DOM.
 */
export interface SnapGuide {
  /** Which axis the guide runs along. */
  readonly axis: 'x' | 'y';
  /** World-space position of the snapped edge. */
  readonly position: number;
  /** Start of the guide span (world units on the other axis). */
  readonly start: number;
  /** End of the guide span (world units on the other axis). */
  readonly end: number;
}

/**
 * Editor state — the single source of truth for the editor.
 *
 * **Immutable.** Every reducer returns a brand-new `EditorState`; the
 * input is never mutated. The live `level` is replaced (not patched) on
 * each committed op so shallow-equality checks in the host UI work as
 * expected.
 *
 * Selection, playtest snapshot, and validation cache are all carried
 * here for single-call ergonomics. Selection is NOT recorded in history;
 * playtest snapshot is informational (the caller owns the authoritative
 * copy via `enterPlaytest` / `exitPlaytest`).
 */
export interface EditorState {
  /** The current level being edited. */
  readonly level: LevelData;
  /** Undo stack (newest at top / last index). */
  readonly undoStack: readonly HistoryEntry[];
  /** Redo stack (newest at top / last index). */
  readonly redoStack: readonly HistoryEntry[];
  /** Max undo entries before oldest is evicted. */
  readonly maxHistoryDepth: number;
  /** Current selection (ephemeral — NOT recorded in history). */
  readonly selection: SelectionState;
  /** Monotonic counter for transaction grouping. */
  readonly nextTransactionId: number;
  /** Pending transaction ops (`null` when not in a transaction). */
  readonly pendingTransaction: readonly EditorOperation[] | null;
  /**
   * Level snapshot taken when entering a transaction (`null` when not in
   * a transaction). Used as the `preSnapshot` for the committed history
   * entry so undo restores the level to its pre-transaction state.
   */
  readonly transactionStartSnapshot: LevelData | null;
  /** Snapshot taken when entering playtest mode (null when not in playtest). */
  readonly playtestSnapshot: LevelData | null;
  /** Cached validation result. Recomputed on each `applyOp`. */
  readonly validation: ValidationResult;
}

/**
 * A clipboard entry — in-memory only, never serialized to disk in v1.
 *
 * The entities are deep JSON-clones of the selected entities at copy
 * time. Paste allocates fresh stable IDs (via `allocateEntityId`) so
 * pasted entities never collide with originals.
 */
export interface ClipboardEntry {
  readonly entities: readonly LevelEntity[];
}

/**
 * A prefab catalog entry — a template for spawning a configured entity.
 *
 * Catalog entries let the editor expose a "Add Platform" button that
 * drops a sensible default at a click position without the caller
 * constructing the full props bag themselves.
 */
export interface CatalogEntry {
  /** Entity kind for this prefab. */
  readonly kind: EntityKind;
  /** Human-facing label for the UI. */
  readonly label: string;
  /** Default rect (top-left at `{0,0}` — translated at instantiate time). */
  readonly defaultRect: LevelRect;
  /** Default props for the kind. */
  readonly defaultProps: Record<string, unknown>;
}

/**
 * Catalog of prefabs the editor can spawn. Keyed by a stable string id
 * (e.g. `'platform'`, `'exit'`). Consumers may add their own entries via
 * `createCatalogEntry` and assemble their own `EntityCatalog` record.
 */
export interface EntityCatalog {
  readonly entries: Readonly<Record<string, CatalogEntry>>;
}
