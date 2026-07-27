/**
 * Level schema type definitions (Pillar 4 — Level Loading).
 *
 * Approach B (opinionated platformer schema): the library ships a complete
 * platformer entity taxonomy as a discriminated union on `kind`. The shape
 * mirrors Spitekeep's existing `LevelData` near 1:1 — sibling migration is a
 * field rename, not a redesign.
 *
 * Determinism note: every field below is a primitive or plain readonly
 * object so the whole shape survives a JSON round-trip and reproduces
 * identically across engines. No timestamps, no closures, no `Set`/`Map`.
 *
 * @module
 */

/**
 * Axis-aligned bounding box in level-space. Coordinates are world-space
 * pixels; `x`/`y` is the top-left corner; the box spans `[x, x + width]`
 * horizontally and `[y, y + height]` vertically.
 */
export interface LevelRect {
  /** World X of the top-left corner. */
  readonly x: number;
  /** World Y of the top-left corner. */
  readonly y: number;
  /** Box width in world units. */
  readonly width: number;
  /** Box height in world units. */
  readonly height: number;
}

/**
 * Stable entity identifier. Monotonic integer assigned by the level's
 * `nextEntityId` counter (see {@link LevelData.nextEntityId}). Survives
 * reorder, delete, undo. Never derived from array index or `Math.random`.
 */
export type EntityId = number;

/**
 * Shipped entity kind variants. Adding a new kind later is a non-breaking
 * union expansion (same pattern as `Rarity` in `src/cosmetics/types.ts`).
 */
export type EntityKind =
  | 'spawn'
  | 'exit'
  | 'platform'
  | 'passthrough'
  | 'trap'
  | 'hazard'
  | 'decoration'
  | 'trigger'
  | 'movingPlatform'
  | 'enemy'
  | 'collectible';

/**
 * Props for the `'exit'` kind. `isTrap` marks decoy/failure exits (Spitekeep's
 * `doorIsTrap` invariant); `locked` gates progression until the consumer
 * unlocks it.
 */
export interface ExitProps {
  /** If `true`, touching this exit ends the run badly (decoy / trap door). */
  readonly isTrap: boolean;
  /** If `true`, the exit is locked and cannot be entered until unlocked. */
  readonly locked: boolean;
}

/** Props for the `'platform'` kind. All fields optional. */
export interface PlatformProps {
  /** Visual variant hint for the renderer. */
  readonly visual?: 'normal' | 'cracked' | 'dark';
}

/**
 * Props for the `'trap'` kind. The `params` bag is intentionally untyped —
 * each `type` dispatches to a consumer-supplied trap handler that owns its
 * own param shape (matches Spitekeep's `TrapEntity.params`).
 */
export interface TrapProps {
  /** Trap type identifier (e.g. `'hiddenPit'`, `'spikes'`). Dispatch key. */
  readonly type: string;
  /** Untyped parameter bag — shape depends on `type`. */
  readonly params: Record<string, unknown>;
}

/** Props for the `'decoration'` kind. */
export interface DecorationProps {
  /** Sprite / draw-call identifier. */
  readonly sprite: string;
  /** If `true`, mirror the sprite horizontally. */
  readonly flipX?: boolean;
}

/**
 * Props for the `'trigger'` kind — rectangular event zones (Celeste pattern).
 * Like `TrapProps`, `params` is an untyped bag dispatched on `action`.
 */
export interface TriggerProps {
  /** Action identifier (e.g. `'showHint'`, `'spawnEnemy'`). Dispatch key. */
  readonly action: string;
  /** Untyped parameter bag — shape depends on `action`. */
  readonly params: Record<string, unknown>;
}

/** Props for the `'movingPlatform'` kind. */
export interface MovingPlatformProps {
  /** Travel speed along the path, in pixels per second (consumer-defined). */
  readonly speed: number;
  /** Ordered list of waypoints the platform cycles through. */
  readonly path: readonly { readonly x: number; readonly y: number }[];
  /** Cycle mode: `'loop'` returns to start, `'pingpong'` reverses direction. */
  readonly loopMode?: 'loop' | 'pingpong';
}

/**
 * Props for the `'enemy'` kind. The `archetype` field dispatches to a
 * behavior handler in the enemy registry; `params` is an untyped bag
 * whose shape depends on the archetype (same pattern as `TrapProps.params`).
 */
export interface EnemyProps {
  /** Archetype identifier (e.g. `'spinny'`, `'turret'`, `'spider'`). Dispatch key. */
  readonly archetype: string;
  /** Untyped parameter bag — shape depends on `archetype`. */
  readonly params: Record<string, unknown>;
}

/**
 * Closed sub-kind union for the `'collectible'` entity kind. Mirrors the
 * `EnemyProps.archetype` dispatch pattern: one `EntityKind` with a typed
 * sub-kind discriminator on `props`. Adding a fourth kind later (e.g.
 * `'heart'`) is a non-breaking union expansion.
 */
export type CollectibleKind = 'coin' | 'gem' | 'key';

/**
 * Props for the `'collectible'` kind. The `kind` field dispatches to a
 * renderer palette entry and an editor catalog prefab (one prefab per
 * `CollectibleKind`, mirroring the `spinny`/`turret`/`spider` enemy
 * pattern).
 *
 * Note the field-name shadow: `CollectibleProps.kind` is the collectible
 * sub-kind (`'coin' | 'gem' | 'key'`), distinct from the outer
 * `LevelEntity.kind` (which is `'collectible'`). This mirrors
 * `EnemyProps.archetype` — a typed dispatch key nested inside a
 * kind-discriminated union variant.
 */
export interface CollectibleProps {
  /** Collectible sub-type. Dispatches to renderer palette and catalog prefabs. */
  readonly kind: CollectibleKind;
  /**
   * Opaque numeric value (score, currency, etc.). The consumer owns the
   * semantics — the library does not interpret this field. Must be a
   * finite number `>= 0` when present.
   */
  readonly value?: number;
  /**
   * If `true`, the collected state persists across runs (Celeste strawberry
   * / Mario Maker pink coin). Default `false` (per-run respawn, Mario coin).
   * The persistence boundary (per-level, per-checkpoint) is consumer-owned.
   */
  readonly persists?: boolean;
}

/**
 * Entity with kind-specific props via a discriminated union on `kind`.
 *
 * The variants with `props: Record<string, never>` (`spawn`, `passthrough`,
 * `hazard`) take no kind-specific configuration — an empty props object is
 * the only legal value.
 */
export type LevelEntity =
  | { readonly id: EntityId; readonly kind: 'spawn'; readonly rect: LevelRect; readonly props: Record<string, never> }
  | { readonly id: EntityId; readonly kind: 'exit'; readonly rect: LevelRect; readonly props: ExitProps }
  | { readonly id: EntityId; readonly kind: 'platform'; readonly rect: LevelRect; readonly props: PlatformProps }
  | { readonly id: EntityId; readonly kind: 'passthrough'; readonly rect: LevelRect; readonly props: Record<string, never> }
  | { readonly id: EntityId; readonly kind: 'trap'; readonly rect: LevelRect; readonly props: TrapProps }
  | { readonly id: EntityId; readonly kind: 'hazard'; readonly rect: LevelRect; readonly props: Record<string, never> }
  | { readonly id: EntityId; readonly kind: 'decoration'; readonly rect: LevelRect; readonly props: DecorationProps }
  | { readonly id: EntityId; readonly kind: 'trigger'; readonly rect: LevelRect; readonly props: TriggerProps }
  | { readonly id: EntityId; readonly kind: 'movingPlatform'; readonly rect: LevelRect; readonly props: MovingPlatformProps }
  | { readonly id: EntityId; readonly kind: 'enemy'; readonly rect: LevelRect; readonly props: EnemyProps }
  | { readonly id: EntityId; readonly kind: 'collectible'; readonly rect: LevelRect; readonly props: CollectibleProps };

/**
 * Flat tile grid. Indexing: `data[tileY * cols + tileX]`. `0` is empty by
 * convention; the consumer maps other integers to tile kinds via their own
 * `typeMap` function passed to `createTileQuery`.
 */
export interface TileGrid {
  /** Tile-value integers, row-major. `0` is conventionally empty. */
  readonly data: readonly number[];
  /** Number of columns. */
  readonly cols: number;
  /** Number of rows. */
  readonly rows: number;
  /** Pixel size of each (square) tile. */
  readonly tileSize: number;
}

/** Optional renderer flags. Forward-compat: more flags may be added later. */
export interface LevelFlags {
  /** Hint to render the lookahead / far background layer. */
  readonly lookahead?: boolean;
  /** Hint to render the foreground overlay layer. */
  readonly foreground?: boolean;
  /** Hint to render the background layer. */
  readonly background?: boolean;
}

/**
 * Versioned level envelope — the complete shape a platformer level serializes
 * into.
 *
 * **`id` is consumer-assigned.** The library never auto-generates it.
 * Auto-generation would require either `Math.random` (banned in deterministic
 * code) or a global monotonic counter (would collide across consumers
 * editing in parallel). The consumer chooses the id scheme (slug, UUID, etc.).
 *
 * Optional top-level fields (`bottomLava`, `hints`, `flags`) escape the
 * untyped-metadata pattern because they recur across platformer siblings.
 * If they turn out to be game-specific, a v2 migration can demote them.
 */
export interface LevelData {
  /** Schema version. The migration ladder upgrades old versions to {@link LEVEL_VERSION}. */
  readonly version: number;
  /** Consumer-assigned stable identifier (e.g. `'the-pit-01'`). */
  readonly id: string;
  /** Human-facing display name. */
  readonly name: string;
  /** Level width in pixels. */
  readonly width: number;
  /** Level height in pixels. */
  readonly height: number;
  /** Pixel size of each (square) tile. */
  readonly tileSize: number;
  /** Default player spawn point, in world coordinates. */
  readonly spawn: { readonly x: number; readonly y: number };
  /** Static tile grid. */
  readonly tiles: TileGrid;
  /** Spawn, exits, platforms, traps, decorations, triggers. */
  readonly entities: readonly LevelEntity[];
  /** Next monotonic entity id to allocate. */
  readonly nextEntityId: EntityId;
  /** Optional bottom lava sea — matches Spitekeep's `LevelData.bottomLava`. */
  readonly bottomLava?: { readonly surfaceY: number };
  /** Optional contextual hints shown after N deaths, etc. */
  readonly hints?: readonly string[];
  /** Optional renderer flags. */
  readonly flags?: LevelFlags;
}

/** Severity of a single {@link ValidationError}. */
export type ValidationErrorSeverity = 'error' | 'warning';

/**
 * Single validation diagnostic. `path` is a dotted path into the level
 * (e.g. `'entities[3].props.speed'`).
 */
export interface ValidationError {
  /** Dotted path to the offending field. Empty string for top-level errors. */
  readonly path: string;
  /** Human-readable description of the failure. */
  readonly message: string;
  /** `'error'` fails validation; `'warning'` is reported but does not fail. */
  readonly severity: ValidationErrorSeverity;
}

/**
 * Validation outcome. `valid` is `true` iff no error-severity diagnostics
 * exist; warnings still appear in `errors` but do not affect `valid`.
 */
export interface ValidationResult {
  /** `true` iff no `severity: 'error'` diagnostics exist. */
  readonly valid: boolean;
  /** All diagnostics (errors and warnings). */
  readonly errors: readonly ValidationError[];
}

/**
 * Single migration step on the forward ladder. Takes the raw shape at version
 * N, returns the raw shape at version N+1. The implementation is owned by the
 * caller (the library ships the ladder runner, not the steps themselves).
 *
 * Contract: should be pure (input unchanged, new object returned). The
 * library catches throws defensively — a throwing step aborts the ladder
 * rather than crashing the caller.
 */
export type LevelMigration = (raw: Record<string, unknown>) => Record<string, unknown>;
