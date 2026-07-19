# API Proposal: Level Schema

> Target pillar: 4 (Fake-3D / Level Loading). Module: `src/level/`.
> Builds on research: `docs/research/level-schema.md`.
> Status: DRAFT.

## Problem Statement

A versioned, serializable 2D platformer level schema must support editor persistence (internal + UGC), runtime loading, forward-ladder migration, share-code generation, defensive validation of untrusted input, deterministic clear-check replay, and thumbnail rendering. The schema must compose with the existing `TileSolidityQuery` contract from `src/collision/types.ts` so the collision module consumes tile data without duplicating logic. It must work for Spitekeep's current `LevelData` shape (platforms, traps, decorations, exit, spawn, bottomLava, realExit, hints) while remaining general enough for future Clone-to-Jest siblings. Entity IDs must be stable across reorder/delete/undo without `Math.random` or array indices. The full schema is large, so the v1 must unblock the platformer kernel (Phase 2) and editor core (Phase 3) without over-engineering.

---

## Approach A: Generic Schema-First (Scaffolding Only)

**Source pattern:** LDTK's typed field instances + Celeste's forward-ladder migration + the existing `CosmeticManifest` versioning pattern from `src/cosmetics/types.ts`.

The library ships versioned-migration scaffolding, a canonical serializer, and a hand-rolled defensive parser — but **no entity-type opinions**. The consumer defines their own entity taxonomy via generics. The library validates structure (version, required fields, coordinate ranges) but not semantics (what constitutes a "platform" vs a "trigger").

### Signature sketch

```ts
// src/level/types.ts

/**
 * Schema version. Incremented on breaking shape changes.
 * The migration ladder upgrades old versions to this value.
 */
export const LEVEL_VERSION = 1;

/**
 * Axis-aligned bounding box. Reuses the collision module's Rect contract
 * conceptually; defined here as a standalone serialisable record.
 */
export interface LevelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Stable entity ID. Monotonic integer assigned by the level's ID counter.
 * Survives reorder, delete, undo. Never derived from array index or Math.random.
 */
export type EntityId = number;

/**
 * Generic entity record. The consumer provides `EntityType` to constrain `kind`
 * and `props`. The library only cares about `id`, `rect`, and the version shell.
 */
export interface LevelEntity<EntityType extends string = string, Props = Record<string, unknown>> {
  readonly id: EntityId;
  readonly kind: EntityType;
  readonly rect: LevelRect;
  readonly props: Readonly<Props>;
}

/**
 * Tile grid as a flat array of tile-type integers.
 * Index = tileY * cols + tileX. The consumer maps integers to TileType
 * via their own function (composing with TileSolidityQuery).
 */
export interface TileGrid {
  /** Tile type integers. 0 = empty by convention. */
  readonly data: readonly number[];
  /** Number of columns. */
  readonly cols: number;
  /** Number of rows. */
  readonly rows: number;
  /** Pixel size of each tile (square). */
  readonly tileSize: number;
}

/**
 * Versioned level envelope. Consumer fills `entities` with their own typed
 * records. The library handles version gating, migration, validation, and
 * serialisation.
 */
export interface LevelSchema<EntityType extends string = string, Props = Record<string, unknown>> {
  readonly version: number;
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly spawn: { readonly x: number; readonly y: number };
  readonly tiles: TileGrid;
  readonly entities: readonly LevelEntity<EntityType, Props>[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Validation result. Never throws — returns errors array.
 */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Migration function: takes raw data, returns upgraded data.
 * Part of a forward-ladder chain. Must never throw.
 */
export type LevelMigration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Build a TileSolidityQuery from a TileGrid + a type-map function.
 * This is the bridge between the level schema and the collision module.
 */
export function createTileQuery(
  grid: TileGrid,
  typeMap: (tileValue: number) => TileType,
): TileSolidityQuery;
```

### Usage example

```ts
import type { LevelSchema, TileGrid, ValidationResult } from 'aicraft-engine/src/level';
import { createTileQuery, migrateLevel, validateLevel } from 'aicraft-engine/src/level';
import type { TileSolidityQuery } from 'aicraft-engine/src/collision';

// Consumer defines their own entity types
type MyEntityKind = 'spawn' | 'exit' | 'spikes' | 'movingPlatform' | 'decoration';
interface MovingPlatformProps { speed: number; path: Array<{x: number; y: number}>; }
interface SpikesProps { damage: number; }

// Define a level
const level: LevelSchema<MyEntityKind> = {
  version: 1,
  id: 'the-pit-01',
  name: 'False Confidence',
  width: 960,
  height: 540,
  tileSize: 16,
  spawn: { x: 48, y: 288 },
  tiles: {
    data: [0, 0, 1, 1, /* ... */],
    cols: 60,
    rows: 34,
    tileSize: 16,
  },
  entities: [
    { id: 1, kind: 'exit', rect: { x: 880, y: 272, width: 32, height: 48 }, props: {} },
    { id: 2, kind: 'spikes', rect: { x: 200, y: 304, width: 64, height: 16 }, props: { damage: 1 } },
  ],
  metadata: {},
};

// Migrate v1 → v2
const v2Level = migrateLevel(rawJson, {
  1: (raw) => ({ ...raw, version: 2, metadata: { ...raw.metadata, migrated: true } }),
});

// Validate (never throws)
const result: ValidationResult = validateLevel(rawInput);
if (!result.valid) {
  console.error(result.errors);
}

// Compose with collision module
const query: TileSolidityQuery = createTileQuery(level.tiles, (v) =>
  v === 1 ? 'solid' : 'empty',
);
```

### Trade-offs

| Dimension | Rating | Justification |
|---|---|---|
| Ergonomics (simple platformer) | **Low** | Consumer must define every entity kind, props interface, and tile-map function from scratch. Nothing ships out-of-the-box for "place a platform." |
| Ergonomics (complex, 30+ types) | **High** | Full control over taxonomy. No fighting against built-in abstractions. Consumer's types are first-class. |
| Determinism discipline | **High** | No `Math.random` or `Date.now` anywhere. IDs are monotonic. Pure-data shape. |
| Type safety | **Medium** | Generic entity props are untyped by default (`Record<string, unknown>`). Consumer must supply their own type parameters to get safety. |
| Tree-shake-ability | **High** | Each function is independently importable. No monolithic parser pulls in unused migration code. |
| Public API stability | **High** | Generic scaffolding rarely needs breaking changes. Adding fields to `LevelSchema` is additive. |
| UGC safety | **Medium** | Structural validation (version, coords in range, required fields) is built-in. Semantic validation (is this entity kind valid? are props well-formed?) is the consumer's job. |
| Migration path | **High** | Forward ladder matches the proven `CosmeticManifest` pattern exactly. |
| Collaboration readiness | **Medium** | Serialisable, but no built-in ops model for CRDT merge. Consumer must build that layer. |

**What this makes easy:** Adding new entity types, migrating schemas, sharing levels via canonical JSON. **What this makes hard:** Getting started — the consumer must invent a platformer taxonomy from scratch.

---

## Approach B: Opinionated Platformer Schema (Shipped Taxonomy)

**Source pattern:** Celeste's Solids/Entities/Triggers taxonomy + SMM2's constrained palette + Spitekeep's actual `LevelData` shape from `src/config/types.ts`.

The library ships a **complete platformer entity taxonomy** that mirrors Spitekeep's `LevelData` (platforms, traps, decorations, exit, spawn). Entity kinds are a typed union, not free strings. Consumer extends via `params: Record<string, unknown>` bags on each entity kind. The tile grid composes directly with `TileSolidityQuery`.

### Signature sketch

```ts
// src/level/types.ts

export const LEVEL_VERSION = 1;

export interface LevelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type EntityId = number;

/**
 * Shipped entity kinds. Consumer extends the variant-specific `params` bags,
 * not this union. Adding a new kind later is a non-breaking union expansion
 * (same pattern as Rarity in cosmetics/types.ts).
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
  | 'movingPlatform';

/**
 * Platform-specific props. Sensible defaults for all fields.
 */
export interface PlatformProps {
  readonly visual?: 'normal' | 'cracked' | 'dark';
}

/**
 * Trap-specific props. Untyped bag — trap handlers dispatch on `type`.
 * Matches Spitekeep's `TrapEntity.params` exactly.
 */
export interface TrapProps {
  readonly type: string;
  readonly params: Record<string, unknown>;
}

/**
 * Moving-platform props.
 */
export interface MovingPlatformProps {
  readonly speed: number;
  readonly path: readonly { readonly x: number; readonly y: number }[];
  readonly loopMode?: 'loop' | 'pingpong';
}

/**
 * Decoration props.
 */
export interface DecorationProps {
  readonly sprite: string;
  readonly flipX?: boolean;
}

/**
 * Trigger props (rectangular event zones — Celeste pattern).
 */
export interface TriggerProps {
  readonly action: string;
  readonly params: Record<string, unknown>;
}

/**
 * Entity with kind-specific props via a discriminated union.
 */
export type LevelEntity =
  | { readonly id: EntityId; readonly kind: 'spawn'; readonly rect: LevelRect; readonly props: Record<string, never> }
  | { readonly id: EntityId; readonly kind: 'exit'; readonly rect: LevelRect; readonly props: { readonly isTrap: boolean; readonly locked: boolean } }
  | { readonly id: EntityId; readonly kind: 'platform'; readonly rect: LevelRect; readonly props: PlatformProps }
  | { readonly id: EntityId; readonly kind: 'passthrough'; readonly rect: LevelRect; readonly props: Record<string, never> }
  | { readonly id: EntityId; readonly kind: 'trap'; readonly rect: LevelRect; readonly props: TrapProps }
  | { readonly id: EntityId; readonly kind: 'hazard'; readonly rect: LevelRect; readonly props: Record<string, never> }
  | { readonly id: EntityId; readonly kind: 'decoration'; readonly rect: LevelRect; readonly props: DecorationProps }
  | { readonly id: EntityId; readonly kind: 'trigger'; readonly rect: LevelRect; readonly props: TriggerProps }
  | { readonly id: EntityId; readonly kind: 'movingPlatform'; readonly rect: LevelRect; readonly props: MovingPlatformProps };

export interface TileGrid {
  readonly data: readonly number[];
  readonly cols: number;
  readonly rows: number;
  readonly tileSize: number;
}

/**
 * Complete level schema. Ships with everything a platformer needs.
 */
export interface LevelData {
  readonly version: number;
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly spawn: { readonly x: number; readonly y: number };
  readonly tiles: TileGrid;
  readonly entities: readonly LevelEntity[];
  readonly nextEntityId: EntityId;
  /** Optional bottom lava sea — matches Spitekeep's LevelData.bottomLava. */
  readonly bottomLava?: { readonly surfaceY: number };
  /** Optional hints shown after N deaths. */
  readonly hints?: readonly string[];
  /** Optional flags for renderer opt-out. */
  readonly flags?: { readonly lookahead?: boolean; readonly foreground?: boolean; readonly background?: boolean };
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export type LevelMigration = (raw: Record<string, unknown>) => Record<string, unknown>;

export function createTileQuery(
  grid: TileGrid,
  typeMap: (tileValue: number) => TileType,
): TileSolidityQuery;

/**
 * Allocate a stable entity ID. Pure: returns nextId + 1. Never uses Math.random.
 */
export function allocateEntityId(level: LevelData): { readonly id: EntityId; readonly nextEntityId: EntityId };
```

### Usage example

```ts
import type { LevelData, ValidationResult } from 'aicraft-engine/src/level';
import { createTileQuery, migrateLevel, validateLevel, allocateEntityId } from 'aicraft-engine/src/level';
import type { TileSolidityQuery } from 'aicraft-engine/src/collision';

// Define a level — all entity kinds are typed out of the box
const level: LevelData = {
  version: 1,
  id: 'the-pit-01',
  name: 'False Confidence',
  width: 960,
  height: 540,
  tileSize: 16,
  spawn: { x: 48, y: 288 },
  tiles: { data: [0, 0, 1, 1, /* ... */], cols: 60, rows: 34, tileSize: 16 },
  nextEntityId: 3,
  entities: [
    { id: 1, kind: 'exit', rect: { x: 880, y: 272, width: 32, height: 48 }, props: { isTrap: false, locked: false } },
    { id: 2, kind: 'trap', rect: { x: 640, y: 320, width: 96, height: 16 }, props: { type: 'hiddenPit', params: { openRadius: 64 } } },
  ],
  bottomLava: { surfaceY: 384 },
};

// Add an entity with a stable ID
const { id: newId, nextEntityId } = allocateEntityId(level);

// Migrate
const migrated = migrateLevel(rawJson, {
  1: (raw) => ({ ...raw, version: 2, bottomLava: raw.bottomLava ?? undefined }),
});

// Validate
const result: ValidationResult = validateLevel(rawInput);
if (!result.valid) {
  console.error(result.errors);
}

// Compose with collision
const query: TileSolidityQuery = createTileQuery(level.tiles, (v) =>
  v === 1 ? 'solid' : v === 2 ? 'passthrough' : 'empty',
);
```

### Trade-offs

| Dimension | Rating | Justification |
|---|---|---|
| Ergonomics (simple platformer) | **High** | Ships a complete platformer taxonomy. Consumer writes `kind: 'platform'` and gets typed props immediately. Matches Spitekeep's mental model. |
| Ergonomics (complex, 30+ types) | **Medium** | Adding custom entity kinds requires extending the union (non-breaking) but the `params: Record<string, unknown>` bags are untyped. Complex games may outgrow the shipped kinds. |
| Determinism discipline | **High** | No `Math.random` or `Date.now`. Monotonic IDs. Pure-data shape. |
| Type safety | **High** | Discriminated union gives exhaustive kind checking. Props bags are partially typed (platform/trap/exit have specific shapes). |
| Tree-shake-ability | **High** | Same as Approach A — each function independently importable. |
| Public API stability | **Medium** | Adding new entity kinds is non-breaking (union expansion), but changing props shapes on existing kinds could break consumers. |
| UGC safety | **High** | Shipped validation can check entity kinds, prop shapes, coordinate bounds, and well-formedness invariants (e.g. exactly one spawn). |
| Migration path | **High** | Forward ladder identical to Approach A. |
| Collaboration readiness | **Medium** | Same as Approach A — serialisable but no CRDT ops model. |

**What this makes easy:** Getting started with a platformer. Matching Spitekeep's existing `LevelData` shape. Defensive parsing of UGC levels. **What this makes hard:** Games with entity types that don't fit the shipped taxonomy (e.g. a puzzle game with pressure plates, gates, conveyor belts).

---

## Approach C: Layered Core + Registry (Hybrid)

**Source pattern:** LDTK's IntGrid/Entity layer separation + Celeste's Solids/Entities/Triggers + the existing `TileSolidityQuery` composition pattern.

The library ships a **minimal pure-data level core** (version, dimensions, tile grid, entity array with stable IDs, metadata) plus a **consumer-populated entity registry** that maps kind strings to typed factories, validators, and renderers. The core knows nothing about "platforms" or "traps" — it only enforces structural invariants (version, bounds, ID allocation, tile grid shape). The registry adds semantic knowledge.

### Signature sketch

```ts
// src/level/types.ts

export const LEVEL_VERSION = 1;

export interface LevelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type EntityId = number;

export interface LevelEntity {
  readonly id: EntityId;
  readonly kind: string;
  readonly rect: LevelRect;
  readonly props: Readonly<Record<string, unknown>>;
}

export interface TileGrid {
  readonly data: readonly number[];
  readonly cols: number;
  readonly rows: number;
  readonly tileSize: number;
}

/**
 * Minimal level core. No entity-type opinions — just structure.
 */
export interface LevelCore {
  readonly version: number;
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly spawn: { readonly x: number; readonly y: number };
  readonly tiles: TileGrid;
  readonly entities: readonly LevelEntity[];
  readonly nextEntityId: EntityId;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export type LevelMigration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Entity type descriptor. Consumer registers one per entity kind.
 * The registry provides:
 *   - validateProps: type-safe prop validation for this kind
 *   - defaultProps: factory for default prop values
 *   - tileTypeMap: optional per-kind tile interaction hint
 */
export interface EntityTypeDescriptor {
  /** Validate props for this entity kind. Returns errors or empty array. */
  validateProps(props: Record<string, unknown>): readonly string[];
  /** Factory for default props when creating a new entity of this kind. */
  defaultProps(): Record<string, unknown>;
  /** Optional: map this entity kind to a TileType override for the collision grid. */
  tileTypeMap?: (rect: LevelRect) => TileType;
}

/**
 * Registry of entity types. Consumer populates at setup time.
 */
export type EntityTypeRegistry = Readonly<Record<string, EntityTypeDescriptor>>;

/**
 * Validate a level against its entity-type registry.
 * Structural validation (version, bounds, IDs) is always checked.
 * Prop validation is delegated to the registry.
 */
export function validateLevelWithRegistry(
  level: LevelCore,
  registry: EntityTypeRegistry,
): ValidationResult;

export function createTileQuery(
  grid: TileGrid,
  typeMap: (tileValue: number) => TileType,
): TileSolidityQuery;

export function allocateEntityId(level: LevelCore): { readonly id: EntityId; readonly nextEntityId: EntityId };
```

### Usage example

```ts
import type { LevelCore, EntityTypeRegistry, ValidationResult } from 'aicraft-engine/src/level';
import { createTileQuery, migrateLevel, validateLevelWithRegistry, allocateEntityId } from 'aicraft-engine/src/level';
import type { TileSolidityQuery } from 'aicraft-engine/src/collision';

// Consumer defines their entity types via a registry
const registry: EntityTypeRegistry = {
  platform: {
    validateProps: (p) => {
      const errors: string[] = [];
      if (p.visual !== undefined && typeof p.visual !== 'string') errors.push('visual must be string');
      return errors;
    },
    defaultProps: () => ({ visual: 'normal' }),
  },
  trap: {
    validateProps: (p) => {
      const errors: string[] = [];
      if (typeof p.type !== 'string') errors.push('trap type must be string');
      return errors;
    },
    defaultProps: () => ({ type: 'spikes', params: {} }),
  },
  spawn: {
    validateProps: () => [],
    defaultProps: () => ({}),
  },
  exit: {
    validateProps: (p) => {
      const errors: string[] = [];
      if (typeof p.isTrap !== 'boolean') errors.push('isTrap must be boolean');
      if (typeof p.locked !== 'boolean') errors.push('locked must be boolean');
      return errors;
    },
    defaultProps: () => ({ isTrap: false, locked: false }),
  },
};

// Define a level
const level: LevelCore = {
  version: 1,
  id: 'the-pit-01',
  name: 'False Confidence',
  width: 960,
  height: 540,
  tileSize: 16,
  spawn: { x: 48, y: 288 },
  tiles: { data: [0, 0, 1, 1, /* ... */], cols: 60, rows: 34, tileSize: 16 },
  nextEntityId: 3,
  entities: [
    { id: 1, kind: 'exit', rect: { x: 880, y: 272, width: 32, height: 48 }, props: { isTrap: false, locked: false } },
    { id: 2, kind: 'trap', rect: { x: 640, y: 320, width: 96, height: 16 }, props: { type: 'hiddenPit', params: {} } },
  ],
  metadata: {},
};

// Validate with registry
const result: ValidationResult = validateLevelWithRegistry(level, registry);
if (!result.valid) {
  console.error(result.errors);
}

// Compose with collision
const query: TileSolidityQuery = createTileQuery(level.tiles, (v) =>
  v === 1 ? 'solid' : 'empty',
);
```

### Trade-offs

| Dimension | Rating | Justification |
|---|---|---|
| Ergonomics (simple platformer) | **Medium** | Consumer must build a registry before getting any validation. More boilerplate than Approach B for a simple platformer. |
| Ergonomics (complex, 30+ types) | **High** | Each entity type gets its own typed validator and defaults. Scales cleanly to dozens of kinds without fighting a monolithic discriminated union. |
| Determinism discipline | **High** | Same as A and B — pure data, monotonic IDs. |
| Type safety | **Low** | `props: Record<string, unknown>` is completely untyped. The registry's `validateProps` is a runtime check, not a compile-time guarantee. Consumer must trust their own validators. |
| Tree-shake-ability | **Medium** | The registry itself is a plain object — tree-shaking works, but the consumer can't selectively omit entity kind code at import time (the registry is populated at setup). |
| Public API stability | **High** | The core types are extremely stable (structural invariants only). Registry API is additive. |
| UGC safety | **High** | Structural + semantic validation via the registry. Consumer controls exactly what's validated. |
| Migration path | **High** | Forward ladder identical to A and B. |
| Collaboration readiness | **High** | The registry pattern maps naturally to CRDT operations — each entity kind's registry entry could provide merge strategies. |

**What this makes easy:** Complex games with many entity types. Custom validation. CRDT-ready architectures. **What this makes hard:** Quick start for a simple platformer. Compile-time type safety for entity props.

---

## Comparison Table

| Criterion | A: Generic Scaffolding | B: Opinionated Platformer | C: Layered Core + Registry |
|---|---|---|---|
| Ergonomics (simple platformer) | Low | **High** | Medium |
| Ergonomics (30+ entity types) | **High** | Medium | **High** |
| Determinism discipline | **High** | **High** | **High** |
| Type safety | Medium | **High** | Low |
| Tree-shake-ability | **High** | **High** | Medium |
| Public API stability | **High** | Medium | **High** |
| UGC safety | Medium | **High** | **High** |
| Migration path | **High** | **High** | **High** |
| Collaboration readiness | Medium | Medium | **High** |
| Convention fit | High | **High** | High |

---

## Recommendation

**Approach B: Opinionated Platformer Schema.**

The library's first consumer is Spitekeep, which already has a well-defined `LevelData` shape with platforms, traps, decorations, exit, spawn, bottomLava, and flags. Approach B maps directly onto this existing shape — Spitekeep's migration from its local `LevelData` to the library's `LevelData` would be a near-trivial field-by-field rename, not a conceptual redesign. The discriminated union gives Spitekeep exhaustive kind checking today, and the `params: Record<string, unknown>` bags on traps and triggers provide exactly the extensibility Spitekeep already uses (each trap type has its own params shape dispatched at runtime).

The research note's three open questions resolve cleanly under Approach B:

- **RLE for tile grids:** Not needed for v1. Spitekeep's levels are 960×540 at 16px tiles = 60×34 = 2,040 tiles. Flat array of 2,040 integers is 2 KB uncompressed — well within share-code budget. The `TileGrid` type is storage-agnostic; a future `encodeTiles(grid)` function can add RLE or sparse encoding without changing the schema.

- **Thumbnail generation:** A `drawThumbnail(level, ctx)` helper can iterate `entities` filtered to `kind === 'platform'` or `kind === 'hazard'` and draw simplified rects. The shipped taxonomy makes this trivial — no registry lookup needed, just a switch on `kind`.

- **Replay desync on engine version change:** Store `engineVersion` in `LevelData.metadata` (via the open `metadata: Record<string, unknown>` field). When the engine version doesn't match, skip clear-check replay validation and trust the original `verified: boolean` flag. This is the standard industry approach (SMM2 does the same).

Approach B is the right balance: opinionated enough to be immediately useful, extensible enough to grow, and close enough to Spitekeep's existing shape to make migration effortless. If a future sibling game needs a radically different entity taxonomy (Approach A's strength) or CRDT merge semantics (Approach C's strength), the schema can evolve toward those patterns — but shipping the simple, correct thing first is the right call.

---

## Scope for v1

### In scope (unblocks Phase 2 platformer kernel + Phase 3 editor core)

- **`src/level/types.ts`** — `LevelData`, `LevelEntity` (discriminated union), `LevelRect`, `EntityId`, `TileGrid`, `ValidationResult`, `LevelMigration`
- **`src/level/constants.ts`** — `LEVEL_VERSION`, `DEFAULT_TILE_SIZE`, `DEFAULT_LEVEL_WIDTH`, `DEFAULT_LEVEL_HEIGHT`, `DEFAULT_ENTITY_ID_START`
- **`src/level/migrate.ts`** — Forward-ladder migration function (`migrateLevel`). Follows the `src/cosmetics/migrate.ts` pattern exactly: never throws, coercing/clamping/stripping unknown fields.
- **`src/level/validate.ts`** — Defensive validation (`validateLevel`). Returns `ValidationResult`, never throws. Checks: version in range, dimensions positive, spawn in bounds, exactly one spawn, entity IDs unique, tile grid dimensions match width/height/tileSize, props shape per kind.
- **`src/level/tiles.ts`** — `createTileQuery` bridge to `TileSolidityQuery`. The key composition point with `src/collision/`.
- **`src/level/entity-id.ts`** — `allocateEntityId` pure function. Monotonic counter, no `Math.random`.
- **`src/level/serialize.ts`** — `canonicalize` (RFC 8785 key-sorting) and `fnv1a` (32-bit hash). For share-code generation. Pure, zero-dep.
- **`src/level/index.ts`** — Barrel export.

### Deferred (after Phase 3 editor core is proven)

- **Clear-check replay storage and validation** — requires the simulation kernel to be running. Store `engineVersion` + `inputs: number[]` in `LevelData.metadata`. Validate by replaying inputs against the sim. Deferred to Phase 5.
- **Thumbnail generation** — `drawThumbnail(level, ctx)` helper. Deferred until the renderer is proven.
- **Sparse / RLE tile encoding** — `encodeTiles` / `decodeTiles`. Deferred until share-code size is actually a problem (it won't be for v1 levels).
- **Entity registry (Approach C pattern)** — If a future sibling game needs custom entity validation beyond the shipped union, add an optional `EntityTypeRegistry` parameter to `validateLevel`. Deferred until a second consumer arrives.
- **CRDT ops model** — Deferred until collaborative editing is needed.

---

## Open Questions for @architect

1. **Should `LevelEntity.props` be `Record<string, unknown>` (Approach B's current shape) or should each kind have a specific props interface exported from the library?** Specific interfaces give better type safety at the cost of more types to maintain. The current Spitekeep `TrapEntity.params` is `Record<string, unknown>` — matching that is pragmatic.

2. **Should `createTileQuery` live in `src/level/tiles.ts` or in `src/collision/`?** It bridges two modules. Putting it in `src/level/` keeps the collision module pure and avoids the level module importing collision internals. But it means the collision module's consumers must know to look in `src/level/` for the bridge function.

3. **Should `validateLevel` check that spawn and exit are within level bounds?** Spitekeep's `validateLevelWellFormed` only checks the doorIsTrap invariant. Bounds checking is a "nice to have" for UGC safety but could reject valid edge-case levels (e.g. a spawn at the exact level edge). The researcher recommends clamping in the parser, not rejecting in the validator.

4. **Should the v1 `LevelData` include `bottomLava` and `hints` fields, or should those be purely Spitekeep-specific and live in `metadata`?** They're Spitekeep-specific today but could become common across siblings. Keeping them as optional top-level fields is cleaner than burying them in an untyped bag.
