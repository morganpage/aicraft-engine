# Headless Level-Editor Core

> Research note for headless level-editor core. Slug: `editor-core`.
> Investigated: 2026-07-19.

## TL;DR

A headless level-editor core provides the state management, transaction history, selection logic, and spatial heuristics required to power both internal developer tools and polished, player-facing User-Generated Content (UGC) level editors. By separating the editor's logical operations from the host application's UI and rendering layers, we can build a highly portable, zero-runtime-dependency TypeScript module that integrates seamlessly with any 2D canvas or DOM-based interface. This research note surveys industry-standard editor architectures (Figma, LDTK, Tiled, Super Mario Maker, Minecraft) and collaborative editing foundations (CRDTs/OT) to define a robust, deterministic, and multiplayer-ready editor core. We recommend three key architectural patterns for prototyping: (1) a **Serializable Data-Only Operation (Redux-style) Pipeline** paired with a **Linear Transaction History Stack** to support robust undo/redo and multiplayer synchronization, (2) an **Immutable Sandbox Playtest Boundary** that deep-clones level data to isolate runtime simulation state from authoring state, and (3) a **Pure Spatial Selection and Snapping Engine** that provides deterministic grid-snapping, smart-edge alignment, and multi-select bounding box transformations.

## Why this matters for aicraft-engine

- **Pillars Touched**: Directly establishes **Pillar 4 (Fake-3D / Level Loading)** editor capabilities, integrates with **Pillar 1 (Primitives / Seeded RNG)** for procedural placement and snapping, and supports **Pillar 2 (Cosmetics / Skin Manifests)** by enabling custom entity and theme selection.
- **Consumer Games**: Consumer titles require a robust, flexible level editor. Providing a headless core allows us to write the complex state, undo/redo, selection, and snapping logic once in the library, while letting each game build its own custom, highly polished UI (e.g., using React, Canvas2D, or Svelte).
- **Unlocks**:
  - **Unified Editor Logic**: Developers use the exact same editor core for internal level design that players use for UGC creation, guaranteeing feature parity and eliminating duplicate bug-fixing.
  - **Multiplayer Collaboration Readiness**: By enforcing serializable, data-only operations (instead of closure-based commands), the editor is natively ready for real-time multiplayer editing via WebSockets or WebRTC.
  - **Crash-Proof UGC Authoring**: Combines with our defensive level validation (`src/level/validate.ts`) to ensure that player-created levels are structurally sound at every step of the editing process.

---

## Prior Art Survey

### Pattern 1: Serializable Edit Operations (VS Code / Qt QUndoCommand)
- **Source**: VS Code Text Edit Operations ([github.com/microsoft/vscode](https://github.com/microsoft/vscode)) & Qt QUndoCommand ([doc.qt.io/qt-6/qundocommand.html](https://doc.qt.io/qt-6/qundocommand.html))
- **What it does**: Represents edits as plain, serializable data structures rather than stateful command objects containing closures or direct object references. VS Code represents text edits as simple range-replacement records. Qt's undo framework supports merging consecutive, similar operations (e.g., merging individual character keystrokes or small mouse drags into a single undo step).
- **Algorithmic shape**:
  ```typescript
  export interface EditorOperation {
    readonly type: string;
    readonly payload: Record<string, unknown>;
  }

  export interface HistoryEntry {
    readonly id: string; // Unique transaction ID
    readonly redo: readonly EditorOperation[];
    readonly undo: readonly EditorOperation[];
    readonly timestamp: number;
  }
  ```
- **Determinism profile**: Pure static data. Fully deterministic.
- **Runtime cost**: Extremely low. Applying operations involves simple object mapping and array updates.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Plain JSON operations align perfectly with our zero-dependency, pure-progression-ops discipline.
- **What to steal**: The use of plain, serializable data objects for operations, and the ability to merge consecutive operations (like dragging an entity) into a single transaction via an operation ID or type check.
- **What to avoid**: Avoid closure-based commands (e.g., `execute() { entity.x += dx; }`) which cannot be serialized, sent over a network, or saved to disk.

---

### Pattern 2: Collaborative Scene Graph & Relative Transforms (Figma)
- **Source**: Figma Multiplayer Engine & Scene Graph ([figma.com/blog/how-figmas-multiplayer-technology-works/](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/))
- **What it does**: Figma structures its editor as a tree-like scene graph of nodes. Instead of syncing the entire document, it transmits fine-grained, serializable property updates. When multiple items are selected, the editor computes a temporary bounding box. Transformations (translation, scaling) are applied to this bounding box, and the resulting deltas are propagated to each selected node relative to its initial state.
- **Algorithmic shape**:
  ```typescript
  export function computeBoundingBox(rects: readonly LevelRect[]): LevelRect {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rects) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  export function applyTransformDelta(
    entities: readonly LevelEntity[],
    selectionIds: readonly EntityId[],
    dx: number,
    dy: number
  ): readonly LevelEntity[];
  ```
- **Determinism profile**: Pure. Fully deterministic.
- **Runtime cost**: Low. Computing bounding boxes and applying relative transforms scales linearly with the number of selected entities.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Allows multi-selection transforms without relying on a mutable DOM or heavy vector math libraries.
- **What to steal**: Temporary bounding box computation for multi-selection, and delta-based relative propagation for translation and scaling.
- **What to avoid**: Avoid storing the temporary bounding box in the authoritative level schema; it should live strictly in the transient editor state.

---

### Pattern 3: Layered Grid & Entity Separation (LDTK)
- **Source**: LDTK Editor Internals ([github.com/deepnight/ldtk](https://github.com/deepnight/ldtk))
- **What it does**: Structures levels into discrete, single-purpose layers: integer grids (`IntGrid`) for collision, visual tiles (`Tiles`), and dynamic point/rect objects (`Entities`). It provides a reactive model where the host application can subscribe to level changes and instantly re-render the live preview.
- **Algorithmic shape**:
  ```typescript
  export interface EditorState {
    readonly level: LevelData;
    readonly activeLayer: 'tiles' | 'entities';
    readonly selectedEntityIds: readonly EntityId[];
    readonly layerVisibility: Record<string, boolean>;
    readonly layerLock: Record<string, boolean>;
  }
  ```
- **Determinism profile**: Pure static data.
- **Runtime cost**: One-time load cost. High performance due to layer isolation.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Separating tile grid editing from entity editing prevents collision bugs and simplifies the editor's state machine.
- **What to steal**: The separation of active editing modes (Tile Mode vs. Entity Mode) and tracking layer visibility/lock states in the editor state to prevent accidental modifications.
- **What to avoid**: Avoid tightly coupling the editor state to a specific rendering framework (LDTK is tightly bound to Haxe/Heaps); keep the core 100% headless.

---

### Pattern 4: Tile-Paint History & Object Manipulation (Tiled)
- **Source**: Tiled Map Editor Undo Stack ([github.com/mapeditor/tiled](https://github.com/mapeditor/tiled))
- **What it does**: Groups large-scale tile painting operations (such as brush strokes or bucket fills) into a single undo transaction. It represents these edits as a list of coordinate-to-value changes.
- **Algorithmic shape**:
  ```typescript
  export interface SetTilesPayload {
    readonly edits: readonly {
      readonly x: number;
      readonly y: number;
      readonly oldValue: number;
      readonly newValue: number;
    }[];
  }
  ```
- **Determinism profile**: Pure.
- **Runtime cost**: Low. Applying a list of edits is a simple loop over an array.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Essential for keeping the undo/redo stack highly efficient during tile painting.
- **What to steal**: Batched tile edits represented as a single transaction containing both the old and new values for each modified tile coordinate.
- **What to avoid**: Avoid storing the entire tile grid state in each undo step; only store the sparse delta (modified coordinates) to prevent massive memory consumption.

---

### Pattern 5: Deterministic Clear-Checks & Touch UX (Super Mario Maker)
- **Source**: Super Mario Maker Level Format & Editor Analyses ([github.com/thegreatestgiant/SMM2-Level-Format](https://github.com/thegreatestgiant/SMM2-Level-Format))
- **What it does**: Imposes a highly constrained entity palette and requires a successful "clear-check" (completing the level) before sharing. The editor utilizes strict grid snapping for building blocks, while allowing free-floating placement for certain entities.
- **Algorithmic shape**:
  ```typescript
  export interface ClearCheck {
    readonly verified: boolean;
    readonly replayInputs?: string; // Run-length encoded input frames
  }
  ```
- **Determinism profile**: Pure.
- **Runtime cost**: Low.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Integrates perfectly with our deterministic game loop and validation layer.
- **What to steal**: The clear-check validation workflow and enforcing strict grid-alignment constraints on structural blocks while allowing free-floating coordinates for dynamic entities.
- **What to avoid**: Avoid complex client-side encryption for clear-checks; rely on deterministic replay verification instead.

---

### Pattern 6: Selection Volumes & Clipboard Transforms (Minecraft Bedrock Editor)
- **Source**: Minecraft Structure Blocks & Bedrock Editor Scripting API ([learn.microsoft.com/en-us/minecraft/creator/](https://learn.microsoft.com/en-us/minecraft/creator/))
- **What it does**: Allows creators to define a 3D bounding box (selection volume), copy the blocks and entities within that volume to a clipboard buffer, and paste them elsewhere with optional rotation (90, 180, 270 degrees) and mirroring.
- **Algorithmic shape**:
  ```typescript
  export interface ClipboardBuffer {
    readonly width: number;
    readonly height: number;
    readonly tiles: readonly number[]; // Flat row-major array
    readonly entities: readonly Omit<LevelEntity, 'id'>[];
  }
  ```
- **Determinism profile**: Pure.
- **Runtime cost**: Low.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Copy-paste and rotation are essential productivity features for both internal and UGC editors.
- **What to steal**: A relative clipboard buffer that stores copied tiles and entities with coordinates offset from the top-left of the selection volume, supporting pure-functional rotation and mirroring transforms.
- **What to avoid**: Avoid pasting entities with their original IDs; always allocate fresh, stable IDs using `allocateEntityId` during the paste operation.

---

### Pattern 7: Operation-Based CRDT Foundations (Yjs / Automerge)
- **Source**: Yjs Conflict-Free Replicated Data Type ([yjs.dev](https://yjs.dev)) & Automerge ([automerge.org](https://automerge.org))
- **What it does**: Guarantees eventual consistency across distributed clients editing the same document without requiring a central coordinating server. Operation-based CRDTs transmit fine-grained, idempotent operations containing unique causal identifiers (e.g., a client ID and a monotonic sequence number).
- **Algorithmic shape**:
  ```typescript
  export interface CollaborativeOp {
    readonly clientId: string;
    readonly seq: number; // Monotonic sequence number per client
    readonly type: 'tile:set' | 'entity:create' | 'entity:update' | 'entity:delete';
    readonly payload: Record<string, unknown>;
  }
  ```
- **Determinism profile**: Pure. Fully deterministic.
- **Runtime cost**: Low to medium. Merging concurrent operations requires sorting them by their causal identifiers.
- **Dependencies**: None (we can implement the minimal serializable-op shape without importing Yjs/Automerge).
- **Fit for our constraints**: Strong. By designing our core operations to carry a client ID and sequence number, we make the editor natively ready for multiplayer synchronization.
- **What to steal**: The use of a client-prefixed monotonic sequence number for operations, enabling a simple Last-Write-Wins (LWW) merge strategy for concurrent edits.
- **What to avoid**: Avoid importing heavy, complex CRDT libraries; instead, design our raw operation types to be compatible with them.

---

### Pattern 8: Sandbox Playtest Isolation (Unity / Godot)
- **Source**: Unity Play Mode & Godot Scene Tree Instantiation
- **What it does**: Instantly switches the editor into a playtest state. Unity serializes the current scene, instantiates a runtime copy for the simulation, and restores the original serialized scene when exiting playtest mode, discarding any runtime mutations.
- **Algorithmic shape**:
  ```typescript
  export function enterPlaytest(level: LevelData): LevelData {
    // Return a deep copy of the level data to feed the simulation
    return JSON.parse(JSON.stringify(level));
  }
  ```
- **Determinism profile**: Pure.
- **Runtime cost**: Negligible (only runs on entering/exiting playtest).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Aligns with our pure-progression-ops and JSON-clone discipline.
- **What to steal**: The sandbox boundary pattern: deep-cloning the authoritative level data to run the simulation, while freezing the editor core in a read-only state.
- **What to avoid**: Avoid mutating the editor's authoritative level data during playtest; any runtime state (player position, collected coins, destroyed blocks) must live strictly in the simulation instance.

---

### Pattern 9: Pure Snapping & Smart Guide Heuristics (Figma / Pixel Art Editors)
- **Source**: Figma Smart Guides & Aseprite Grid Snapping ([aseprite.org](https://aseprite.org))
- **What it does**: Computes snapping coordinates based on active rules. Grid snapping aligns coordinates to the nearest grid cell. Smart guides compute distances between the dragged entity's edges and other visible entities' edges, snapping the position if within a pixel threshold (e.g., 5px).
- **Algorithmic shape**:
  ```typescript
  export interface AlignmentGuide {
    readonly type: 'x' | 'y';
    readonly value: number;
  }

  export function snapToGrid(x: number, y: number, gridSize: number): { x: number; y: number } {
    return {
      x: Math.round(x / gridSize) * gridSize,
      y: Math.round(y / gridSize) * gridSize,
    };
  }
  ```
- **Determinism profile**: Pure.
- **Runtime cost**: Low. Smart guides require a simple spatial query against visible entities.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Pure snapping functions can be exposed as utilities that the host UI calls during drag operations.
- **What to steal**: Exposing pure, stateless snapping utilities that return both the snapped coordinate and the alignment guides to be drawn by the UI.
- **What to avoid**: Avoid hardcoding snapping logic into the mouse/touch event handlers; keep it in pure mathematical functions in the core.

---

### Pattern 10: Pure Spatial Selection Models (Aseprite / Vector Editors)
- **Source**: Vector Selection Models & Marquee Selection
- **What it does**: Manages selection state as a list of unique identifiers. Supports additive selection (Shift-click), subtractive selection, and marquee box selection (drag-selecting all entities intersecting a rectangle).
- **Algorithmic shape**:
  ```typescript
  export function queryMarquee(
    entities: readonly LevelEntity[],
    marquee: LevelRect
  ): readonly EntityId[] {
    return entities
      .filter((e) => intersects(e.rect, marquee))
      .map((e) => e.id);
  }
  ```
- **Determinism profile**: Pure.
- **Runtime cost**: Low. Spatial intersection checks are extremely fast for 2D bounding boxes.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Selection state can be managed as a sorted array of `EntityId`s to maintain canonical ordering.
- **What to steal**: Sorted `EntityId` arrays for selection state, and pure spatial query functions for marquee selection.
- **What to avoid**: Avoid storing full entity objects in the selection state; only store stable `EntityId`s.

---

## Recommended Operation Shape

To ensure collaboration readiness and clean serialization, we recommend a **Serializable Data-Only Operation Pipeline** (Redux-style). Every modification to the level state must flow through a single `reduceLevel` function that takes the current `LevelData` and an `EditorOperation`, and returns a fresh, deep-cloned `LevelData` (following our pure-progression-ops discipline).

### Operation Schema

```typescript
export type EditorOperation =
  | { type: 'tile:set'; payload: { x: number; y: number; value: number } }
  | { type: 'tile:fill'; payload: { x: number; y: number; value: number } }
  | { type: 'entity:create'; payload: { kind: EntityKind; rect: LevelRect; props: any } }
  | { type: 'entity:update'; payload: { id: EntityId; rect?: Partial<LevelRect>; props?: any } }
  | { type: 'entity:delete'; payload: { id: EntityId } }
  | { type: 'level:resize'; payload: { width: number; height: number } }
  | { type: 'level:properties'; payload: { name?: string; id?: string; tileSize?: number } };
```

### Reducer Signature

```typescript
export function reduceLevel(level: LevelData, op: EditorOperation): LevelData {
  // 1. Deep clone level data (pure-progression-ops pattern)
  const next = JSON.parse(JSON.stringify(level)) as LevelData;
  
  // 2. Apply operation based on type
  switch (op.type) {
    case 'tile:set': {
      const { x, y, value } = op.payload;
      const idx = y * next.tiles.cols + x;
      if (idx >= 0 && idx < next.tiles.data.length) {
        (next.tiles.data as number[])[idx] = value;
      }
      break;
    }
    // ... other cases ...
  }
  
  // 3. Return the fresh, mutated clone
  return next;
}
```

---

## Recommended History Model

We recommend a **Linear Transaction History Stack** with a configurable maximum depth (to prevent memory leaks). The history state should be managed separately from the level data itself, allowing the host application to track undo/redo stacks.

### History State Shape

```typescript
export interface HistoryState {
  readonly past: readonly LevelData[];
  readonly present: LevelData;
  readonly future: readonly LevelData[];
  readonly maxDepth: number;
}
```

### History Operations

- **Commit**: When an operation is performed, push the *current* state to `past`, set `present` to the *new* state, and clear `future`. If `past.length > maxDepth`, shift the oldest state out.
- **Undo**: Pop the last state from `past`, push the `present` state to `future`, and set `present` to the popped state.
- **Redo**: Pop the last state from `future`, push the `present` state to `past`, and set `present` to the popped state.

This model is incredibly robust, simple to implement, and completely avoids the complexity of storing inverse operations, as it relies on storing full snapshots of our highly compact, JSON-serializable `LevelData`.

---

## Recommended Selection Model

The selection model should live in the transient **Editor State** (not in the serialized `LevelData`). It should track selected entity IDs as a sorted array of `EntityId`s.

```typescript
export interface SelectionState {
  readonly selectedIds: readonly EntityId[];
}
```

### Selection Operations

- **Select Single**: Sets `selectedIds` to `[id]`.
- **Select Additive**: Appends `id` to `selectedIds` if not present, then sorts the array numerically to maintain canonical order.
- **Select Toggle**: Removes `id` if present, otherwise adds it, then sorts.
- **Select Marquee**: Takes a marquee drag rect, queries the level entities for intersections, and replaces `selectedIds` with the intersecting IDs.
- **Clear Selection**: Sets `selectedIds` to `[]`.

---

## Recommended Playtest Boundary (Sandbox Pattern)

To guarantee that runtime gameplay simulation never corrupts the authoritative editor state, we enforce a strict **Sandbox Playtest Boundary**:

```
┌────────────────────────────────────────────────────────┐
│ Editor Core State                                      │
│ - Authoritative LevelData                              │
│ - Undo/Redo History Stacks                             │
│ - Selection State                                      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ (Enter Playtest)
                 [ JSON Deep Clone ]
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Simulation Instance (Runtime Game Loop)                │
│ - Mutates player position, physics, enemy states       │
│ - Editor Core is frozen / read-only                    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ (Exit Playtest)
               [ Discard Simulation State ]
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Editor Core State Resumes                              │
│ - Original LevelData remains 100% untouched            │
└────────────────────────────────────────────────────────┘
```

1. **Enter Playtest**: The host application requests a deep clone of the current `LevelData` via `JSON.parse(JSON.stringify(level))`.
2. **Simulation**: The host passes this cloned level data to the game's simulation engine (e.g., `src/collision/` and the game loop). The simulation runs, mutating its own runtime state. The editor core is suspended.
3. **Exit Playtest**: The host discards the simulation instance entirely. The editor core resumes with its original `LevelData` completely untouched.

---

## Anti-Patterns Observed

1. **Closure-Based Commands**: Storing functions like `execute()` and `undo()` in the history stack. This prevents serializing the undo history, breaks multiplayer synchronization, and easily leads to memory leaks by holding references to deleted DOM or canvas elements.
2. **Mutating Authoritative State During Playtest**: Allowing the runtime simulation to directly mutate the editor's level data. This leads to "ghost" states where collected coins or destroyed blocks remain missing when returning to the editor.
3. **Using Array Indices as Entity IDs**: Referencing entities by their index in the `entities` array. When entities are reordered, deleted, or inserted, indices shift, which corrupts selection states, undo/redo history, and multiplayer synchronization.
4. **Hardcoding UI/Rendering Logic**: Coupling the editor's logical operations (like snapping or selection) to mouse/touch events or specific canvas rendering contexts. This makes the editor impossible to test in Node.js and prevents reusing the core for different UI implementations.

---

## Top 3 Patterns Worth Prototyping

1. **Serializable Operation Reducer (`reduceLevel`)** — Prototyping a pure, never-throw reducer that applies serializable operations to `LevelData` and returns a fresh, deep-cloned level state, ensuring 100% determinism and multiplayer readiness.
2. **Stateless Snapping & Smart Guide Utilities** — Prototyping pure mathematical functions for grid-snapping and smart-edge alignment that take raw coordinates and other entity bounding boxes, returning snapped coordinates and alignment guides.
3. **Sandbox Playtest Cloner & History Manager** — Prototyping a lightweight history manager (with configurable max depth) and a sandbox cloner to cleanly isolate authoring state from runtime simulation state.

---

## Open Questions for @api-designer

- **Operation Merging Heuristic**:
  How should the core expose a hook for merging consecutive operations? For example, when a user drags an entity, the UI will emit dozens of `entity:update` operations. We want to merge these into a single undo step. Should the core accept a `transactionId` or a `merge: boolean` flag on operations to handle this?
- **Sparse Tile Grids for Large Levels**:
  If a level is very large (e.g., 500x500 tiles), storing the entire tile grid in every history snapshot can consume significant memory. Should we implement a sparse tile-map representation (e.g., storing only non-zero tiles in a Record) or a lightweight delta-history mechanism for tile edits?
- **Multi-Layer Support**:
  Should the `LevelData` schema be extended to support multiple visual/collision layers explicitly (e.g., background, main, foreground), or should we represent layers using the existing `LevelFlags` and entity properties?

---

## Cross-References

- `docs/architecture.md` (layer separation, determinism rules, and pure progression ops)
- `docs/conventions.md` (code style rules, naming patterns, and pure progression ops)
- `src/level/types.ts` (the level schema the editor edits)
- `src/level/validate.ts` (the validation API the editor uses)
- `src/level/entity-id.ts` (stable entity ID allocation)
- `src/cosmetics/ownership.ts` (the existing pure-progression-ops pattern)
- `docs/research/level-schema.md` (the related level-schema research)
