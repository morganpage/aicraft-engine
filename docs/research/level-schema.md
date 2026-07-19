# 2D Platformer Level Schema

> Research note for 2D platformer level schema. Slug: `level-schema`.
> Investigated: 2026-07-19.

## TL;DR

A 2D platformer level schema defines a versioned, serializable, and highly compact data format that supports both an internal level editor and a polished player-facing user-generated content (UGC) editor. For a zero-runtime-dependency, strictly deterministic TypeScript library like `aicraft-engine`, this schema must flow seamlessly through editor persistence, runtime loading, schema migration, sharing, validation, replay, and thumbnail generation. This note surveys industry-standard level formats (LDTK, Tiled, Celeste, Super Mario Maker), versioned save patterns, stable entity identifier strategies, canonical serialization, and defensive parsing. We propose three key architectural pillars: (1) a **Celeste-Inspired Static-to-Runtime Taxonomy** separating visual decorations, static physical collision (Solids), and dynamic entities/triggers, (2) a **Forward-Ladder Migration Pipeline** combined with a **Lightweight Defensive Parser** to safely load untrusted UGC data without crashing or dragging in heavy validation libraries, and (3) a **Canonical JSON Serializer (RFC 8785)** paired with a **Deterministic 32-bit FNV-1a Hasher** to generate compact, tamper-proof share codes and validate clear-check input replays.

## Why this matters for aicraft-engine

- **Pillars Touched**: Establishes the core data representation for **Pillar 4 (Fake-3D / Level Loading)**, integrates with **Pillar 1 (Primitives / Seeded RNG)**, and supports **Pillar 2 (Cosmetics / Skin Manifests)**.
- **Consumer Games**: Sibling games like *IMP - Not a Troll* (formerly Spitekeep) and future Clone-to-Jest titles require a robust, flexible level format. A unified schema allows creators to build levels in an editor, share them via short text codes, and play them deterministically across platforms.
- **Unlocks**:
  - **Player-Facing UGC Editors**: Enables players to build, playtest, and share custom levels directly within the game client, driving organic virality and long-term retention.
  - **Deterministic Clear-Check Replays**: Since the simulation is 100% deterministic, a level can store a sequence of player input frames (a "clear-check"). The server or client can replay these inputs to verify the level is winnable before allowing it to be shared, completely eliminating unwinnable spam.
  - **Zero-Dependency Portability**: Keeps level file sizes extremely small (suitable for URL query parameters or short share codes) and ensures parsing is completely safe in Node.js, WebViews, and browser environments.

---

## Prior Art Survey

### Pattern 1: Layered Grid/Entity Separation (LDTK)
- **Source**: LDTK JSON Schema ([ldtk.org/json/](https://ldtk.org/json/))
- **What it does**: Separates level layouts into discrete, single-purpose layers: structural integer grids (`IntGrid`) for collision, visual tilesets (`Tiles`), and dynamic point/rect objects (`Entities`). It supports custom fields with strict typing and enums.
- **Algorithmic shape**:
  ```typescript
  export interface LDTKLayerInstance {
    __identifier: string;
    __type: 'IntGrid' | 'Tiles' | 'Entities' | 'AutoLayer';
    gridSize: number;
    intGridCsv?: number[]; // Flat array of tile types (e.g., 0 = air, 1 = solid, 2 = passthrough)
    entityInstances?: LDTKEntityInstance[];
  }

  export interface LDTKEntityInstance {
    __identifier: string; // e.g., "spawn", "spikes"
    iid: string; // Unique instance identifier
    px: [number, number]; // Pixel coordinates [x, y]
    fieldInstances: Array<{ __identifier: string; __value: unknown }>;
  }
  ```
- **Determinism profile**: Pure static data. Fully deterministic.
- **Runtime cost**: One-time load cost. Highly performant because collision queries are direct array lookups.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Separating collision grids from visual tiles aligns perfectly with our `TileSolidityQuery` and `TileType` contracts.
- **What to steal**: The separation of a structural collision grid (IntGrid) for fast physics resolution and an Entity layer for dynamic point/rect behaviors.
- **What to avoid**: Avoid LDTK's extremely deep nesting, verbose field descriptors, and redundant coordinate tracking (storing both grid-aligned and pixel-aligned coordinates for every entity).

---

### Pattern 2: General-Purpose XML/JSON Map Structure (Tiled)
- **Source**: Tiled Map Editor JSON Format ([doc.mapeditor.org/en/stable/reference/json-map-format/](https://doc.mapeditor.org/en/stable/reference/json-map-format/))
- **What it does**: Represents maps as arbitrary layers of tiles, vector objects, or images, using generic custom properties for metadata. It supports external tilesets and autotiling (Wang sets).
- **Algorithmic shape**:
  ```typescript
  export interface TiledLayer {
    data?: number[] | string; // Flat array or compressed base64 string
    objects?: TiledObject[];
    type: 'tilelayer' | 'objectgroup' | 'imagelayer';
    properties?: Array<{ name: string; type: string; value: any }>;
  }

  export interface TiledObject {
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    type: string;
    properties?: Array<{ name: string; type: string; value: any }>;
  }
  ```
- **Determinism profile**: Pure static data.
- **Runtime cost**: Medium. Parsing compressed tile layers (e.g., base64-gzip) requires runtime decompression, which is slow in JS and requires external dependencies.
- **Dependencies**: Decompression libraries (like `pako` or `zlib`) if using compressed data.
- **Fit for our constraints**: Weak. Too verbose, un-typed custom properties, and heavy dependency risk for decompression.
- **What to steal**: The concept of an `ObjectGroup` for placing arbitrary rectangular shapes (Solids) and decorations.
- **What to avoid**: Avoid compressed tile arrays, external tileset dependencies, and loosely typed custom property arrays.

---

### Pattern 3: Static-to-Runtime Taxonomy Decoupling (Celeste)
- **Source**: Celeste Binary Map Format & Ahorn/Lönn Editors ([github.com/CelesteREST/CelesteMapFormat](https://github.com/CelesteREST/CelesteMapFormat))
- **What it does**: Decouples authored level data from runtime simulation state. Levels are structured as static "rooms" containing `Solids` (collision blocks), `Entities` (stateful objects), and `Triggers` (rectangular event zones).
- **Algorithmic shape**:
  ```typescript
  export interface CelesteRoom {
    name: string;
    bounds: Rect;
    solids: string; // Grid of characters representing collision
    entities: Array<{ name: string; id: number; x: number; y: number; values: Record<string, any> }>;
    triggers: Array<{ name: string; id: number; x: number; y: number; width: number; height: number; values: Record<string, any> }>;
  }
  ```
- **Determinism profile**: Pure static data. Fully deterministic.
- **Runtime cost**: One-time instantiation cost.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. The clean division of `Solids`, `Entities`, and `Triggers` matches our collision and physics modules.
- **What to steal**: The `Trigger` concept for rectangular event zones (e.g., teleporters, camera boundaries, gravity-shifts) and local IDs combined with room names.
- **What to avoid**: Avoid binary parsing if we can use lightweight JSON, and avoid Celeste's custom string-based grid representation for collision, which requires custom parsers.

---

### Pattern 4: Palette-Based UGC Constraints & Clear-Checks (Super Mario Maker)
- **Source**: Super Mario Maker Level Format ([github.com/thegreatestgiant/SMM2-Level-Format](https://github.com/thegreatestgiant/SMM2-Level-Format))
- **What it does**: Imposes a highly constrained object palette for player-facing level creation, and requires a successful clear-check (completing the level) before sharing.
- **Algorithmic shape**:
  ```typescript
  export interface UGCLevel {
    paletteVersion: number;
    objects: Array<{ typeId: number; gridX: number; gridY: number; flags: number }>;
    clearCheckReplay?: {
      engineVersion: string;
      inputs: string; // Base64 or run-length encoded input frame sequence
    };
  }
  ```
- **Determinism profile**: Pure static data.
- **Runtime cost**: Low.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Constrained palettes make defensive parsing trivial, and deterministic clear-check replays are perfectly supported by our deterministic core.
- **What to steal**: The clear-check requirement with a deterministic input replay log, and a highly constrained, integer-mapped object palette for UGC.
- **What to avoid**: Avoid complex encryption or obfuscation that prevents easy sharing and debugging.

---

### Pattern 5: Forward-Ladder Schema Migration (Celeste / Spelunky Saves)
- **Source**: Celeste Save Format & `src/cosmetics/migrate.ts` ([Local: src/cosmetics/migrate.ts](../src/cosmetics/migrate.ts))
- **What it does**: Evolves level schemas over time using a sequential chain of pure, never-throw migration functions that upgrade old level formats to the current target version.
- **Algorithmic shape**:
  ```typescript
  export type LevelMigration = (raw: any) => any;
  export const LEVEL_MIGRATIONS: Record<number, LevelMigration> = {
    1: (raw) => ({ ...raw, version: 2, decorations: raw.decorations ?? [] }),
    2: (raw) => ({ ...raw, version: 3, lookahead: raw.lookahead ?? true }),
  };
  ```
- **Determinism profile**: Pure. Fully deterministic.
- **Runtime cost**: Amortized (only runs once at level load).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Matches the proven pattern in `src/cosmetics/migrate.ts`.
- **What to steal**: The sequential forward-ladder migration chain that guarantees the engine always receives the latest schema shape.
- **What to avoid**: Avoid "capability negotiation" or branching logic inside the game engine to support multiple old formats; migrate everything to the latest version at load time.

---

### Pattern 6: Stable Entity Identifiers (Figma / Collaborative Editors)
- **Source**: Figma / CRDTs (Fractional Indexing & Seeded IDs)
- **What it does**: Generates stable, unique identifiers for level entities that survive moves, deletions, duplications, and re-orderings in the editor.
- **Algorithmic shape**:
  ```typescript
  export interface LevelMetadata {
    nextEntityId: number; // For monotonic counter
  }
  export interface Entity {
    id: number; // Stable monotonic ID
  }
  ```
- **Determinism profile**: Pure.
- **Runtime cost**: Negligible.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Monotonic counters keep IDs small, readable, and fully deterministic without needing heavy UUID libraries or non-deterministic `Math.random` calls.
- **What to steal**: A local monotonic integer counter stored in the level root (`nextEntityId`) to assign stable IDs to new entities.
- **What to avoid**: Avoid UUID strings (which are large and non-deterministic) and avoid using array indices as IDs.

---

### Pattern 7: Canonical Serialization & Content-Addressing (RFC 8785)
- **Source**: RFC 8785 (JSON Canonicalization Scheme) & FNV-1a Hashing ([rfc-editor.org/rfc/rfc8785](https://www.rfc-editor.org/rfc/rfc8785))
- **What it does**: Standardizes JSON serialization by sorting object keys alphabetically and removing whitespace, allowing deterministic hashing for share codes and integrity checks.
- **Algorithmic shape**:
  ```typescript
  export function canonicalize(obj: any): string {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
    const keys = Object.keys(obj).sort();
    const parts = keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k]));
    return '{' + parts.join(',') + '}';
  }
  ```
- **Determinism profile**: Pure. Fully deterministic.
- **Runtime cost**: Amortized (only runs on save or share).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Allows us to generate short, tamper-proof share codes (e.g., FNV-1a hash converted to Base36) without any dependencies.
- **What to steal**: A recursive key-sorting canonicalizer and a 32-bit FNV-1a hash function to generate share codes.
- **What to avoid**: Avoid relying on native `JSON.stringify` key ordering, which is non-standard and runtime-dependent.

---

### Pattern 8: Lightweight Defensive Parsing (Ajv / Valibot / Zod Alternatives)
- **Source**: `src/cosmetics/migrate.ts` & `src/save/storage.ts` ([Local: src/cosmetics/migrate.ts](../src/cosmetics/migrate.ts))
- **What it does**: Parses untrusted UGC level data defensively using pure-TS type guards, type coercion, coordinate clamping, and unknown-field stripping to prevent crashes or exploits.
- **Algorithmic shape**:
  ```typescript
  export function parseLevel(raw: unknown): LevelData {
    if (!isRecord(raw)) return createFallbackLevel();
    // Coerce, clamp, and strip...
  }
  ```
- **Determinism profile**: Pure. Never throws.
- **Runtime cost**: Low.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Essential for a zero-dependency library loading untrusted player-created levels.
- **What to steal**: The "never-throw, type-coerce, clamp, and strip" parsing pattern from `src/cosmetics/migrate.ts`.
- **What to avoid**: Avoid dragging in heavy validation libraries like Zod or Valibot, which would violate our zero-runtime-dependency constraint.

---

## Reference Implementations

- **LDTK JSON Schema** ([GitHub: deepnight/ldtk](https://github.com/deepnight/ldtk)): The official repository for LDTK. Teaches highly structured, multi-layer level serialization.
- **Celeste Map Format** ([GitHub: CelesteREST/CelesteMapFormat](https://github.com/CelesteREST/CelesteMapFormat)): A community documentation of Celeste's binary level format, highlighting the decoupling of static authored data and runtime state.
- **SMM2 Level Format** ([GitHub: thegreatestgiant/SMM2-Level-Format](https://github.com/thegreatestgiant/SMM2-Level-Format)): A community-documented file format for Super Mario Maker 2, illustrating palette-based entity constraints.
- **RFC 8785 (JSON Canonicalization Scheme)** ([RFC Editor](https://www.rfc-editor.org/rfc/rfc8785)): The official specification for standardizing JSON serialization.
- **Spitekeep Config Types** (`src/config/types.ts`): The sibling game's level data structure, serving as the canonical consumer pattern.

---

## Visual References

The following diagram illustrates the lifecycle of a level from the editor, through canonical serialization and hashing, to runtime loading and deterministic validation:

```
┌────────────────────────────────────────────────────────┐
│ Level Editor (Internal or Player-facing UGC)           │
│ 1. Creator places Solids, Entities, and Triggers       │
│ 2. Editor assigns stable IDs via monotonic counter     │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ (Save / Export)
┌────────────────────────────────────────────────────────┐
│ Canonical Serialization & Hashing                      │
│ 1. `canonicalize(level)` sorts keys alphabetically    │
│ 2. `fnv1a(json)` generates a 32-bit hash               │
│ 3. Hash is converted to a compact share code (Base36)  │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ (Share / Distribute)
┌────────────────────────────────────────────────────────┐
│ Defensive Parsing & Migration (UGC Loading)            │
│ 1. `migrateLevel(raw)` upgrades old formats            │
│ 2. `parseLevel(raw)` coerces, clamps, and strips data  │
│ 3. Returns a guaranteed-valid, crash-proof LevelData   │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ (Gameplay / Simulation)
┌────────────────────────────────────────────────────────┐
│ Deterministic Replay Verification                      │
│ 1. Simulation runs clear-check replay inputs           │
│ 2. If player reaches exit, level is verified winnable  │
└────────────────────────────────────────────────────────┘
```

---

## Open Questions

- **Run-Length Encoding (RLE) for Collision Grids**:
  For large levels, a raw 2D array or flat CSV array of tile IDs can become large. Should we support a simple, zero-dependency Run-Length Encoding (e.g., `[1, 10, 0, 5]` meaning 10 solid tiles followed by 5 empty tiles) to keep share codes tiny?
  *Draft Answer*: For UGC levels, which are typically small (e.g., 100x100 tiles max), a sparse coordinate-to-tile map (e.g., `{"12,5": 1}`) or a simple flat string is much more compact than a full 2D array and easier to parse than RLE.
- **Thumbnail Generation from Schema**:
  Can we generate a lightweight, static thumbnail of a level directly from the schema without running the full renderer?
  *Draft Answer*: Yes. Since the schema contains a static list of `solids` and `decorations` with coordinates, we can write a tiny, high-performance canvas helper `drawThumbnail(level, canvas)` that draws a simplified, low-resolution pixel-art map of the level. This is perfect for level selection screens.
- **Replay Desynchronization on Engine Version Change**:
  If a physics parameter (like gravity or run speed) changes in a library update, old clear-check replays will desync and fail. How do we prevent valid levels from being marked as "unwinnable"?
  *Draft Answer*: We must store the library's `engineVersion` in the level metadata. If the current engine version does not match the level's authored engine version, we can either skip the clear-check replay validation (and trust the original flag) or run a migration on the replay inputs if possible (though physics changes are rarely migratable; skipping verification for legacy levels is the standard industry approach).

---

## Top 3 Patterns Worth Prototyping

1. **Lightweight Defensive Parser & Migration Ladder** — Prototyping a zero-dependency `parseLevel` and `migrateLevel` utility that safely upgrades old level schemas, coerces malformed fields, clamps coordinates, and strips unknown properties, ensuring the engine never crashes on corrupt UGC.
2. **Canonical JSON Serializer & FNV-1a Hasher** — Prototyping a recursive key-sorting canonicalizer and a fast 32-bit FNV-1a hashing function to generate compact, tamper-proof share codes (e.g., converting the hash to Base36) for level sharing.
3. **Deterministic Clear-Check Replay Validator** — Prototyping a simple input-replay runner that executes a sequence of frame inputs against the deterministic simulation core to verify that the player successfully reaches the exit, proving the level is winnable.

---

## Cross-References

- `docs/architecture.md` (layer separation, determinism rules, and defensive adapter patterns)
- `docs/conventions.md` (code style rules, naming patterns, and pure progression ops)
- `src/cosmetics/migrate.ts` (the existing forward-ladder migration pattern to generalize)
- `src/collision/types.ts` (`TileSolidityQuery` and `TileType` contracts to compose with)
- `src/save/storage.ts` (defensive storage and parsing patterns)
- `ai-craft-game-dev-devil/src/config/types.ts` (the sibling game's level data structure)
