# Level Visual Rendering — Detailed Implementation Plan

> **Status:** PROPOSED IMPLEMENTATION PLAN
> **Date:** 2026-07-28
> **Revision:** rev 5 — fourth review pass. Changes: connection preparation is
> sparse over observed neighbor pairs rather than quadratic over tile values
> (§7.1); seam coverage uses a one-device-pixel internal body overlap and tests a
> non-commensurate tile-size/DPR pair (§5.7); prepared-scene mismatches fail
> closed (§7.8); play-mode frames exclude consumer-owned runtime enemies (§7.7,
> §9.1); the entity partition check now rejects both omissions and overlap, and
> `drawEntity` no longer promises batch-order equivalence (§7.8).
>
> **Revision:** rev 4 — third review pass. Changes: creation splits into
> `createLevelThemeRenderer` (theme) + `prepare(level)` → `PreparedLevelScene`,
> which is what actually owns exposure and the connection table (§7.8);
> `familyId` and `minimumSpan` are defined and resolved (§7.6); the connector is
> resolved into a connection table at preparation, removing the fallback that
> would have required per-neighbor `try`/`catch` (§7.1); seed components are
> type-tagged so strings cannot collide with their own channel ids (§7.3); the
> DPR guarantee is restated as shared-edge coincidence and tested at 1.25/1.5/
> 1.75 (§5.7); `trap` added to the entity partition with a compile-time
> exhaustiveness check (§7.8).
>
> **Revision:** rev 3 — second review pass. Changes: exposure is span-based,
> family-scoped, and computed once over a static set (§7.6, §11.3); the facade
> splits into `drawTerrainTiles` / `drawTerrainRects` / `drawEntities` and takes
> `ResolvedLevelEntity[]` so runtime rectangles are representable and nothing is
> drawn twice (§7.7, §7.8); pixel snapping becomes a device-space contract with a
> shipped helper and a rendered-pixel gate (§5.7); materials are branded and
> normalization is unbypassable (§7.4); the seed mixer becomes an unbounded
> `mixSeed` fold (§7.3); connector probing removed in favor of propagation plus
> opt-in diagnostics (§7.1); `view` is the single authoritative world rectangle
> and shake never affects culling (§7.2); §19 is now an explicitly disposable
> Phase 0 prototype (§16, §19).
>
> **Revision:** rev 2 — review pass against the current tree. Changes: two
> validation scenes (§2.5, §9.0); computed rectangle edge exposure (§7.6);
> settled consumer-callback error policy (§7.1, §20.7); address derivation moved
> to `src/rng/` with a two-tier hot-path API (§7.3); color guards added to
> `primitives` (§7.4); pixel-snapping contract (§5.7); `dist` size budget
> (§13.4); contact sheets made advisory with real tooling scheduled (§14.6);
> §15/§16/§19 reconciled into one ordering; `motif` → `surfaceDetail` and one
> canonical `visualSeed` name throughout.
> **Scope:** Procedural terrain presentation, level themes, scene layering,
> deterministic set dressing, semantic entity rendering, editor previews, and
> visual QA.
> **Primary validation scenes:** `showcase/sections/playground.ts` for the
> entity-rectangle path, and a new scrolling tile-grid section built from
> `levelgen`'s `realizeBlueprint` output for the tile path. Neither scene alone
> exercises this plan — see §2.5 and §9.0.
> **Related work:** `docs/design/level-generation-quality-implementation-plan.md`
> remains authoritative for generation, verification, repair, and quality
> scoring. This plan consumes `LevelData`; it does not change generation or
> simulation semantics.

## 1. Purpose

The engine already gives characters, particles, liquids, parallax backgrounds,
palettes, glow, and procedural animation a recognizable visual character. Levels
do not yet receive the same treatment.

The default level renderer currently communicates collision and editor semantics:

- solid entities are flat filled rectangles with one-pixel outlines;
- spawn, exit, trigger, and decoration entities are dashed markers;
- collectibles are flat color blocks;
- `drawTileGrid` delegates every visual decision to the consumer;
- the playground clears to one background color and draws the authored platform
  rectangles directly.

This is a useful fallback and debugging surface, but it makes a playable level read
as collision geometry rather than a place. The player and effects have more visual
identity than the world supporting them.

The goal of this plan is to add a reusable, asset-optional level-art system without
turning the engine into a game-specific renderer. The engine should own the
reusable visual grammar:

- terrain connectivity;
- exposed surfaces and edge treatment;
- palette-derived material shading;
- deterministic detail placement;
- camera-aware drawing;
- render-pass composition;
- semantic platformer entity treatments;
- safe renderer extension points;
- visual test and benchmark infrastructure.

Consumers should continue to own art direction:

- theme names;
- palette choices;
- biome identities;
- scene-specific silhouettes;
- custom props and motifs;
- imported raster assets;
- game-specific hazards and landmarks.

The intended outcome is that a consumer can give the same `LevelData` to three
themes and receive three visually distinct, readable scenes without changing
collision, level generation, replay behavior, or editor operations.

## 2. Current-state audit

### 2.1 Existing reusable pieces

The implementation should compose existing APIs rather than duplicate them:

| Capability | Existing API | Planned use |
|---|---|---|
| Flat outlined geometry | `outlineRect` | Base silhouette and fallback |
| Color derivation | `shade`, `mixHex` | Material highlights, faces, detail colors |
| Generated palettes | `generatePalette`, `resolvePalette` | Optional theme construction |
| Contrast repair | `repairContrast` | Readable foreground and hazard colors |
| Parallax | `drawTiledParallax`, `parallaxOffset` | Background and foreground depth |
| Glow | `drawGlow` | Lava, exits, collectibles, ambient light accents |
| Surface motion | `generateWaveLine` | Water and lava theme treatments |
| Particles | emitters, presets, spawn/step helpers | Ambient and reactive atmosphere |
| Pixel/DPR helpers | `resizeCanvasToBackingStore`, pixel helpers | Crisp, device-independent output |
| Entity dispatch | `drawLevelEntity` override map | Backward-compatible semantic drawing |
| Tile traversal | `drawTileGrid` | Low-level compatibility path |
| Tile semantics | `GeneratedTileSemantics`, `createTileTypeMap` | Collision-aligned terrain grouping |
| Seeded RNG | `mulberry32`, `nextInt`, `nextFloat` | Local detail generators seeded by a stable address |
| Reduced-motion probe | `prefersReducedMotion` | Default source for `LevelRenderFrame.reducedMotion` |
| Generated tile levels | `realizeBlueprint` | Tile-path validation scene and tile benchmarks |

### 2.2 Observable visual weaknesses

The current playground baseline shows:

1. The background is a uniform field with no depth or landmark.
2. Platforms are internally uniform slabs.
3. Floors, walls, ledges, and floating platforms share the same surface language.
4. Adjacent terrain does not connect visually.
5. Passthrough and moving platforms differ mostly by fill color.
6. The exit remains an abstract dashed marker during play.
7. Terrain contains no scale cues, wear, supports, or material detail.
8. The richer parallax demonstration exists as a separate showcase section rather
   than a component of the playable level.
9. The player glow, animation, face, dust, and enemies create a strong focal point,
   while the world remains visually neutral.

### 2.3 Repeated consumer work

The game briefs already specify multiple versions of the same general solution:

- connected-terrain neighbor masks;
- top-edge and exposed-face shading;
- cracks, mortar, rivets, water stains, crystal facets, and leaves;
- per-biome or per-band palettes;
- procedural parallax silhouettes;
- deterministic ambient dressing;
- visual contact sheets and screenshot review.

Those briefs correctly keep game-specific theme vocabulary in the consumer. The
repeated geometry, deterministic addressing, culling, and renderer composition are
the extraction candidates for this plan.

### 2.4 Constraints that remain in force

- Zero runtime dependencies.
- Canvas2D only.
- Strict TypeScript.
- No DOM reads in deterministic or renderer-adjacent drawing helpers.
- No `Math.random` for any visual result that must reproduce.
- Rendering must not mutate `LevelData`, runtime state, saves, or replay state.
- Same authored inputs must produce the same scene.
- Visual culling must not change which details appear when they return onscreen.
- Imported art remains optional.
- Existing `drawLevelEntity` and `drawTileGrid` behavior remains supported.
- Existing level-generation and simulation-test work remains independent.
- Built-in themes and materials must stay tree-shakeable. The root barrel
  re-exports every module with `export *`, so no aggregate array, registry, or
  index object may reference all built-in themes.
- Published `dist` growth is budgeted, not open-ended (§13.4).
- Consumer-callback error policy follows the convention settled in §20.7 rather
  than being decided per call site.

### 2.5 Validation-scene gaps

The current showcase cannot validate this plan as written, and the phase plan
must account for that before Phase 1 starts:

- `PLAYGROUND_LEVEL.tiles.data` is `new Array(...).fill(0)` — the playground has
  **no tiles at all**. Connectivity sampling, the tile address convention,
  `drawTerrainTiles`, and every tile surface-detail treatment have no consumer there.
- The playground has **no camera**: world-space equals screen-space at 600×400.
  Visible-range calculation, culling invariance (§11.3), and acceptance criteria
  8 and 11 cannot be demonstrated in it.
- The playground's floor (`y=368`, full width) and its two walls (`x=0` and
  `x=584`, spanning `y=0..368`) abut. Under an all-edges-exposed default, the
  room boundary produces exactly the seam artifacts §7.5 forbids.

Consequence: the tile path needs its own scrolling scene (§9.0), and rectangle
edge exposure must be computed rather than deferred to consumers (§7.6).

## 3. Goals

### 3.1 Product goals

1. A default themed level should look intentionally authored rather than debug-drawn.
2. A theme should change a level's identity without changing its geometry.
3. Platforms and tiles should clearly communicate their collision role by shape,
   not color alone.
4. Background, terrain, entities, effects, and foreground should form a deliberate
   depth hierarchy.
5. Procedural visual detail should be stable across runs, frame rates, camera
   movement, and draw-order changes.
6. Editor and play modes should share geometry while using presentation appropriate
   to their purpose.
7. Consumers should be able to replace any rendering layer or entity kind without
   forking the dispatcher.
8. The first useful release should improve the current playground substantially
   without requiring a level-schema migration.

### 3.2 Engineering goals

1. Pure topology and visual-addressing helpers are fully unit tested.
2. Visible-terrain rendering is proportional to visible cells and entities.
3. Canvas state is balanced and does not leak transforms, alpha, blend mode,
   shadows, line dashes, or smoothing settings.
4. The renderer tolerates malformed or missing optional theme data.
5. Render APIs accept the world view rectangle, tick, resolved entity rects, and
   reduced-motion state explicitly.
6. Built-in materials are data-driven and palette-derived.
7. Asset-backed callbacks and procedural callbacks use the same layer contracts.
8. Public APIs have JSDoc and appear in `docs/api-surface.md`.

## 4. Non-goals

This work does not initially include:

- changing collision resolution;
- changing generated-level reachability or quality scoring;
- a general lighting engine;
- normal maps, shaders, WebGL, or GPU batching;
- a sprite atlas or asset-loader framework;
- a full WYSIWYG art editor;
- runtime mutation of terrain for destruction;
- automatic conversion of arbitrary entity rectangles into a perfect polygon
  union (per-edge occlusion in §7.6 is in scope and is not a union);
- full fake-3D, isometric, heightmap, or orthographic-cube rendering;
- forcing every game to use the built-in themes;
- serializing renderer callbacks into `LevelData`;
- pixel-perfect screenshot assertions as the only correctness gate;
- moving game-specific biome catalogs into the engine.

Fake-3D can build on the scene-layer and material contracts later. It is not a
prerequisite for a large improvement to the current 2D presentation.

## 5. Design principles

### 5.1 Engine grammar, consumer art direction

The engine provides mechanisms such as "draw an exposed top cap" and "place a stable
detail at this tile." A consumer decides whether that detail is moss, snow, brass
rivets, alien growth, or nothing.

Built-in themes exist as examples and useful defaults. They are not the closed set
of allowed looks.

### 5.2 Visual addressing, not sequential visual randomness

Visual details must not depend on a shared PRNG stream advanced by draw order. A
shared stream produces visible instability when:

- the camera culls a row of tiles;
- an entity is inserted earlier in an array;
- one render layer is disabled;
- a custom renderer performs a different number of random reads.

Every procedural visual choice must instead have a stable address:

```text
level visual seed
  + feature channel
  + tile coordinate or entity id
  + local detail index
  → 32-bit detail seed
```

For example:

```text
(1234, "terrain-crack", col=8, row=5, detail=0) → stable crack seed
(1234, "exit-sparks", entityKey=19, detail=2)    → stable spark seed
```

The hash/address helper may seed `mulberry32`, but the caller must not share the
resulting generator across unrelated cells or entities.

Two consequences for where and how this lives:

- Address derivation is a general deterministic primitive, not a terrain
  concept. It belongs beside `mulberry32` in `src/rng/`, where `levelgen` and
  future modules can use it too.
- The authoring-friendly variadic string form must not run in the per-tile loop.
  String channel names are hashed **once**, at theme-normalization time, into
  int32 channel ids; the hot path then mixes integers only (§7.3).

### 5.3 Readability before decoration

The renderer must preserve gameplay reads:

- the top surface of a solid is unambiguous;
- passthroughs look thinner and top-supported;
- hazards use distinctive silhouette and animation;
- moving geometry reads as moving or mechanical;
- exits look reachable and important;
- background detail stays lower contrast than gameplay geometry;
- foreground overlays do not hide hazards or landing surfaces.

### 5.4 Composition through explicit passes

The standard scene order is:

```text
1. backdrop fill / sky
2. far background
3. middle background
4. back terrain faces and large shadows
5. terrain bodies and top surfaces
6. decorations behind gameplay entities
7. gameplay entities
8. reactive effects and particles
9. decorations in front of gameplay entities
10. near foreground
11. screen-space tint / transition
12. HUD and editor overlays
```

The engine should expose pass-sized operations. Consumers remain responsible for
the final call order because they own runtime enemies, projectiles, player art,
camera shake, and game-specific effects.

Pass 5 contains two sources of terrain — the tile grid and entity rectangles —
and a level may contain both (generated levels author tiles; the playground
authors rectangles). Their sub-order is fixed and documented: **tile grid first,
entity rectangles second**, so authored platforms read as placed on top of the
room rather than embedded in it. The facade exposes them as two passes
(`drawTerrainTiles`, then `drawTerrainRects`) rather than one, because only the
second needs runtime rectangles — see §7.8.

### 5.5 Asset-optional, not asset-hostile

Every built-in treatment must work with Canvas2D primitives. Theme callbacks may
draw images through the same contracts. Parallax remains asset-agnostic.

### 5.6 Edit and play are different presentations

Edit mode needs:

- grid visibility;
- selection and path widgets;
- trigger and spawn markers;
- collision role clarity;
- stable hit targets;
- optional production-art preview.

Play mode needs:

- themed entities;
- hidden authoring-only markers;
- atmosphere and depth;
- reactive visual states.

The renderer must not make one presentation compromise the other.

### 5.7 Pixel snapping is a stated contract, not an implementation detail

Subpixel seams are the most common way tile terrain visibly breaks, and the
existing draw helpers already floor coordinates and inset strokes by 0.5px
(`outlineRect`, the dashed-marker path in `platformer/renderer.ts`). Combined
with a fractional camera translate, that inset produces one-pixel cracks between
cells that are supposed to be continuous.

**Integer world coordinates are not sufficient, and an earlier draft of this
section was wrong to imply they were.** A world-space integer becomes fractional
the moment a fractional camera translate is applied, and DPR scaling makes even
integer CSS pixels land off the device-pixel grid. Asserting that `fillRect`
receives integer arguments proves nothing about what reaches the framebuffer.

The contract is therefore about **device-pixel alignment of the composed
transform**, and the engine supplies the helper rather than describing a rule:

```ts
export interface SnappedTranslation {
  readonly x: number;
  readonly y: number;
}

/**
 * Snap a world-space camera origin so that integer world coordinates land on
 * whole device pixels under the given device-pixel ratio.
 */
export function snapCameraTranslation(
  x: number,
  y: number,
  devicePixelRatio: number,
): SnappedTranslation;

/**
 * Apply the snapped translation to `ctx`. The caller still owns save/restore.
 */
export function applySnappedTranslate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  devicePixelRatio: number,
): void;
```

Snapping is `Math.round(v * dpr) / dpr`, matching how `resizeCanvasToBackingStore`
already establishes the backing-store scale.

**What snapping does and does not guarantee.** It does not put every integer
world coordinate on a whole device pixel — that is only true when `dpr` is an
integer. At `dpr = 1.5`, integer world coordinates land on multiples of 1.5
device pixels, so half of them sit mid-pixel no matter how the origin is snapped,
and fractional ratios (1.25, 1.5, 1.75) are common on real displays.

Two cells sharing an edge do map that edge to the **same** device-space
coordinate when both are drawn under the same transform. That is the geometric
guarantee. It is not, by itself, a raster guarantee: two separately antialiased
`source-over` fills can each contribute partial coverage at the same coordinate,
leaving some backdrop contribution in the seam pixel.

The body renderer therefore owns a second, explicit coverage rule:

- logical cell/rectangle bounds remain exact and abutting;
- body fill extends through each **connected internal edge** by exactly one
  backing-store pixel (`1 / devicePixelRatio` world units);
- tile ownership is deterministic: the north/west cell supplies the overlap
  across its south/east connected edges, matching row-major drawing;
- rectangle bodies extend only across the hidden portions of their exposure
  spans; exposed silhouette edges never overdraw;
- the overlap applies only to the base body fill, never to top caps, side
  shading, outlines, or surface details.

`devicePixelRatio` is therefore an explicit required draw input (§7.5–§7.7), not
read back from the canvas transform. Invalid non-positive/non-finite values
normalize to `1` at the public facade; direct low-level callers must pass a
positive finite value.

Snapping the origin keeps the transform stable frame to frame, so terrain does
not shimmer as the camera moves by subpixel amounts. The controlled body overlap
independently prevents backdrop bleed at ratios where tile width in device
pixels is fractional. The contract is stated in those terms rather than as
"integers land on pixels."

The resulting contract:

- Terrain draws on **integer world coordinates**, with no inset and no gap
  between adjacent cells.
- The caller composes the world transform with `applySnappedTranslate` (or
  applies an equivalently snapped translation). Terrain does not read back the
  current transform.
- The caller resolves one positive finite DPR and passes the same value to
  `applySnappedTranslate`, `LevelRenderFrame`, and any direct low-level terrain
  draw call.
- Camera shake, parallax offsets, and any other world-space translation are
  snapped by the same helper before they reach terrain.
- Connected internal body edges receive the one-device-pixel overlap above.
- Strokes used for silhouette readability, not tiling continuity, may keep the
  0.5px inset. Body fills never do.
- Violating the contract degrades to a soft visual artifact, never an exception.

**Testing follows the same correction (§14.4).** Two gates, neither of which is
"the arguments were integers", and neither of which assumes whole device pixels:

1. *Shared-edge and overlap geometry.* The recording context tracks the CTM.
   Assert that adjacent logical bounds share the same device-space coordinate,
   and that the base-body seam extension overlaps by exactly one backing-store
   pixel on connected internal edges and by zero on exposed silhouette edges.
2. *Rendered-pixel test.* Using the headless `canvas` devDependency, render two
   adjacent cells of the same material over a contrasting backdrop and assert
   that no seam pixel retains any backdrop contribution. With two connected
   materials, the seam may legitimately take the later cell's base color; the
   assertion is about backdrop bleed-through, not exact color equality.

Both run at 8px, 16px, and 32px across DPR **1, 1.25, 1.5, 1.75, 2, and 3**,
with fractional camera origins. They also include a deliberately
non-commensurate case — 9px tiles at DPR **1.3** — so all selected widths and
ratios cannot accidentally land on whole device pixels.

## 6. Proposed module architecture

### 6.1 File layout

The proposed implementation adds a renderer-adjacent `terrain` module and extends
the platformer renderer through separate files:

```text
src/
├── rng/
│   └── visual-seed.ts              # deterministic address derivation (general)
├── primitives/
│   ├── color.ts                    # + isHexColor / safeHex (see §7.4)
│   └── snap.ts                     # device-pixel transform snapping (see §5.7)
├── terrain/
│   ├── index.ts
│   ├── types.ts
│   ├── connectivity.ts
│   ├── viewport.ts
│   ├── material.ts
│   ├── surface-detail.ts           # built-in surface-detail treatments
│   ├── rect-exposure.ts            # per-edge occlusion for abutting rects
│   ├── tile-renderer.ts
│   └── rect-renderer.ts
├── platformer/
│   ├── renderer.ts                 # existing fallback remains
│   ├── themed-entity-renderer.ts   # semantic play-mode treatments
│   ├── level-theme.ts              # theme/frame contracts
│   └── level-layers.ts             # background/foreground pass helpers
└── tests/
    ├── visual-seed.test.ts
    ├── terrain-connectivity.test.ts
    ├── terrain-viewport.test.ts
    ├── terrain-material.test.ts
    ├── terrain-rect-exposure.test.ts
    ├── terrain-tile-renderer.test.ts
    ├── terrain-rect-renderer.test.ts
    └── platformer-themed-entity-renderer.test.ts
```

Two placements are deliberate and differ from the obvious "everything under
`terrain/`" layout:

- **`visual-seed.ts` lives in `src/rng/`.** Deterministic address derivation is a
  general primitive with no terrain knowledge, and `levelgen` wants the same
  helper. Putting it in `terrain` would force unrelated modules to depend on the
  renderer layer.
- **`surface-detail.ts`, not `motifs.ts`.** `src/levelgen/motifs.ts` already
  exists and exports `Motif` — a gameplay-rhythm concept. The root barrel
  re-exports every module with `export *`, so both meanings would land in one
  flat namespace. Visual treatments are named `SurfaceDetail` throughout.
- **`snap.ts` lives in `primitives/`.** Device-pixel transform snapping is a
  general Canvas2D concern that belongs beside `dpr.ts`, and consumers need it
  for their own world transforms (§5.7), not only for terrain.

This is a proposed layout, not permission to move the existing fallback renderer.
Small files may be combined if the public boundaries remain clear.

### 6.2 Layer ownership

| Module | Owns | Does not own |
|---|---|---|
| `level` | Serializable geometry and semantics | Canvas, themes, animation |
| `rng` | Seeded generators and deterministic address derivation | Any visual meaning |
| `terrain` | Connectivity, visible ranges, materials, rect exposure, procedural surface detail | Entity semantics, props, simulation meaning |
| `platformer` renderer | Entity-kind presentation and level-theme composition | Simulation state advancement |
| `primitives` | Small general Canvas2D/color/parallax helpers | Level knowledge |
| Consumer | Theme catalog, custom surface details, runtime draw order, game-specific entities | Reusable topology/culling algorithms |

### 6.3 Dependency direction

```text
primitives     rng     level
     ↑          ↑        ↑
     └───── terrain ─────┘
               ↑
        platformer renderer
               ↑
            consumer
```

`terrain` may import plain `TileGrid`/`LevelRect` types, `rng`, and general
primitives. It must not import the platformer kernel, editor, audio, DOM
adapters, or game-state modules.

**Accepted coupling.** `TerrainRectRole` uses platformer role words (`solid`,
`passthrough`, `moving`, `hazard`) even though `terrain` does not own entity
semantics. Visual-only names (`slab` / `ledge` / `carriage` / `spikes`) were
considered and rejected: consumers already think in the entity vocabulary, and a
second parallel vocabulary would have to be mapped at every call site. The
coupling is one-directional and type-level only — `terrain` imports no platformer
code, reads no `props`, and never sees an `EntityKind`. Confirm in §20.3.

## 7. Proposed public contracts

The signatures below define the intended shape. Exact names may change during the
API-design review, but the semantic boundaries should remain.

### 7.1 Connectivity

Use an eight-neighbor mask so renderers can distinguish outer edges, inner corners,
and enclosed tiles.

```ts
export const TERRAIN_NORTH = 1 << 0;
export const TERRAIN_NORTH_EAST = 1 << 1;
export const TERRAIN_EAST = 1 << 2;
export const TERRAIN_SOUTH_EAST = 1 << 3;
export const TERRAIN_SOUTH = 1 << 4;
export const TERRAIN_SOUTH_WEST = 1 << 5;
export const TERRAIN_WEST = 1 << 6;
export const TERRAIN_NORTH_WEST = 1 << 7;

export type TerrainNeighborMask = number;

export interface TerrainNeighborhood {
  readonly mask: TerrainNeighborMask;
  readonly north: boolean;
  readonly northEast: boolean;
  readonly east: boolean;
  readonly southEast: boolean;
  readonly south: boolean;
  readonly southWest: boolean;
  readonly west: boolean;
  readonly northWest: boolean;
}

export function sampleTerrainNeighborhood(
  grid: Readonly<TileGrid>,
  col: number,
  row: number,
  connects: (centerValue: number, neighborValue: number) => boolean,
): TerrainNeighborhood;
```

Required behavior:

- out-of-bounds neighbors are disconnected;
- malformed indices return an empty neighborhood;
- the center tile is not required to be non-zero;
- consumers decide whether different numeric tile values connect;
- the callback is never allowed to mutate the grid;
- results are identical for identical inputs.

**Connector error policy.** The connector is *not* wrapped in `try`/`catch`
inside the sampler, and a throwing connector propagates. This follows the
convention already documented in `src/level/tiles.ts`: the never-throw contract
covers level *data*, not consumer-supplied callbacks, because a throwing callback
is a programmer error and silently swallowing it hides the bug in a per-frame
loop where it will never be noticed. Two supporting rules:

- Per-neighbor `try`/`catch` is explicitly rejected: up to eight guarded calls per
  tile is both the hottest path in the renderer and the worst possible place to
  hide an exception.
- **Probing is not validation and has been removed.** An earlier draft probed the
  connector at normalization time with representative values and substituted
  `connectsEqualValue` on failure. That is unsound — a connector can pass any
  finite probe set and still throw on the first real tile value — and worse, the
  substitution silently converts a programmer error into a wrong-looking level
  with no signal. Structural validation at creation is kept (`typeof connects
  === 'function'`, rejected fail-fast); behavioral validation is not attempted.

**The connector does not run in the hot loop at all.** An earlier draft paired
"no per-neighbor `try`/`catch`" with an opt-in fallback mode, which is
self-contradictory: detecting a connector error *requires* guarding each
invocation. The contradiction dissolves once the connector stops being called per
neighbor. Connectivity is a function of tile *values*, and a grid contains a
finite set of observed neighbor relationships, so the answer is precomputed:

```ts
/** Sparse connection lookup over ordered neighbor pairs observed in a grid. */
export interface TerrainConnectionTable {
  readonly connects: (centerValue: number, neighborValue: number) => boolean;
}

export function createTerrainConnectionTable(
  grid: Readonly<TileGrid>,
  connects: (centerValue: number, neighborValue: number) => boolean,
  options?: {
    readonly onError?: (
      centerValue: number,
      neighborValue: number,
      error: unknown,
    ) => void;
  },
): TerrainConnectionTable;
```

Preparation scans the grid once and records the distinct **ordered value pairs**
that occur across its eight in-bounds neighbor directions. It calls the
consumer's connector exactly once per observed ordered pair and records any
unobserved pair as disconnected. Preparation is therefore `O(cells × 8)` rather
than quadratic in the number of distinct values, even when generated or malformed
input assigns a unique integer to every cell. The tile loop reads the sparse
table. Consequences:

- no callback invocation, and therefore no `try`/`catch`, anywhere in the tile
  loop — the earlier rule is now structurally satisfied rather than asserted;
- errors surface during preparation, where a single guard is cheap and the
  diagnostic can name the exact value pair that failed;
- an error that only occurs for a value pair never observed as an in-bounds
  adjacency cannot affect rendering, because that pair is never consulted;
- connector cost stops being a per-frame concern entirely.

`onError` is optional. Omitted, a throwing connector propagates out of
`createTerrainConnectionTable` — fail-fast at preparation, matching
`src/level/tiles.ts`. Supplied, the offending pair is reported and recorded as
disconnected, once, at preparation time. There is no per-frame degrade mode and
no `connectorErrorMode` option.

```ts
export interface TerrainDiagnostic {
  readonly code: 'connector-threw' | 'material-invalid' | 'detail-threw'
    | 'scene-mismatch';
  readonly detail: string;
  readonly error?: unknown;
}

export interface LevelThemeRendererOptions {
  readonly onDiagnostic?: (diagnostic: Readonly<TerrainDiagnostic>) => void;
}
```

`sampleTerrainNeighborhood` remains a standalone helper that takes a raw
connector and propagates; callers who use it directly accept that. The themed
path always goes through a connection table.

`drawTileGrid`'s existing swallow-per-tile behavior is unchanged; it is a
different, already-shipped contract. §20.7 records this as a decision so the two
policies stop being resolved ad hoc.

Convenience classifiers should cover common cases:

```ts
export function connectsEqualValue(
  centerValue: number,
  neighborValue: number,
): boolean;

export function createTerrainConnector(
  terrainValues: readonly number[],
): (centerValue: number, neighborValue: number) => boolean;
```

The second helper treats all configured values as one connected terrain family.
This allows several visual variants to share one continuous silhouette.

### 7.2 The world view rectangle, and the visible tile range

**One authoritative rectangle.** An earlier draft carried both a `camera: {x, y}`
on the frame and an `x`/`y` on `TerrainViewport`, with nothing saying which one
won or whether they were the same point. They are collapsed into a single
world-space view rectangle, and `camera` is removed from `LevelRenderFrame`:

```ts
/**
 * The world-space rectangle currently on screen. `x`/`y` are the world
 * coordinates of the view's top-left corner — the camera origin. There is no
 * second camera field anywhere in these contracts.
 */
export interface TerrainViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
```

**Camera shake does not affect culling.** Shake is a presentation offset applied
to the transform only; it never modifies `view`. Feeding shake into `view` would
make the visible set depend on a decaying animation and break the §11.3 culling
invariance argument. Instead:

- `view` is computed from the camera's logical position, before shake;
- shake is applied to the transform (snapped, per §5.7);
- `overscanTiles` must be at least `ceil(maxShakeMagnitude / tileSize)` so the
  edge that shake pulls into frame is already drawn. This is documented on both
  `visibleTileRange` and the theme facade, and the tile room exercises it.

The same rule applies to any other transform-only offset, including parallax and
transition nudges.

`drawTileGrid` currently traverses the full grid. The themed renderer needs a pure,
reusable range calculation over `view`:

```ts
export interface VisibleTileRange {
  readonly startCol: number;
  readonly endCol: number;   // exclusive
  readonly startRow: number;
  readonly endRow: number;   // exclusive
}

export function visibleTileRange(
  grid: Readonly<TileGrid>,
  view: Readonly<TerrainViewport>,
  overscanTiles?: number,
): VisibleTileRange;
```

Required behavior:

- clamps to grid bounds;
- returns an empty range for malformed or disjoint input;
- supports negative view origins;
- uses exclusive end indices;
- optional overscan permits surface details that extend beyond their source cell;
- work remains proportional to visible cells.

### 7.3 Stateless visual seeds (`src/rng/visual-seed.ts`)

Address derivation is a general deterministic primitive and ships from `src/rng/`
beside `mulberry32`, not from `terrain`.

The API is two-tier. The variadic string form is for authoring, theme setup, and
readable call sites. The integer form is what the per-tile loop actually calls.

```ts
export type VisualSeedPart = string | number;

/** Authoring-facing. Hashes string parts. Not for per-tile use. */
export function deriveVisualSeed(
  rootSeed: number,
  ...parts: readonly VisualSeedPart[]
): number;

/** Hash a channel name once, at setup time, into a stable int32 id. */
export function visualChannel(name: string): number;

/**
 * Fold a numeric component. Tags the component as a number before mixing.
 * Two arguments, no allocation, no string work.
 */
export function mixNumber(accumulator: number, value: number): number;

/**
 * Fold a channel id obtained from `visualChannel`. Tags the component as a
 * string-derived value, so it cannot collide with the same integer folded as
 * a number.
 */
export function mixChannel(accumulator: number, channelId: number): number;

/** Finalize an accumulator into an unsigned 32-bit seed. */
export function finalizeSeed(accumulator: number): number;
```

**Components carry a type tag, or strings and numbers collide.** Routing a
string through `visualChannel` yields an integer, and an untagged fold cannot
then tell `"foo"` from the literal number `visualChannel("foo")` — the address
`(root, "tile", 5)` would equal `(root, <that int>, 5)`. Every component is
therefore folded as `tag` then `value`, with distinct tags for numeric and
string-derived components. This is why the hot-path API exposes `mixNumber` and
`mixChannel` rather than one untagged `mixSeed`: the tag is not something a
caller can forget to apply.

**Arity is solved by folding, not by a wider signature.** An earlier draft used a
fixed `mixVisualSeed(root, channelId, a, b, c)`, which cannot encode the
addresses §7.3 itself documents: a tile needs root, channel, material id,
column, row, **and** detail index — six components, not five — and a rect needs
entity, material, and detail on top of the channel. Widening the signature just
moves the ceiling. Folding has no ceiling, stays monomorphic and
allocation-free, and makes the variadic form definable in terms of it:

```ts
// tile address, in the hot loop
let s = mixChannel(visualSeed, channelId);          // "tile"
s = mixChannel(s, material.channelId);              // material id
s = mixNumber(s, col);
s = mixNumber(s, row);
s = mixNumber(s, detailIndex);
const seed = finalizeSeed(s);
```

`deriveVisualSeed` is **implemented as** this fold, dispatching each part to
`mixChannel(visualChannel(part))` for strings and `mixNumber(part)` for numbers.
The two tiers therefore agree by construction rather than by two implementations
happening to match; the equivalence test in §14.2 guards against later drift, it
is not what establishes the property.

**String identifiers are resolved, never hashed in a loop.** `LevelEntity.id` is
already `EntityId = number` in this codebase. Draw options take a numeric
`entityKey`; callers holding string ids resolve them once through
`visualChannel` at the same point they normalize the theme.

Required behavior:

- returns an unsigned 32-bit integer;
- does not rely on locale-sensitive string formatting;
- **type-tags every component**, so a string part and a numeric part never
  produce the same address — including the case where the number happens to
  equal `visualChannel` of the string;
- normalizes non-finite numeric parts defensively;
- never uses `Math.random`;
- adding or removing a render pass does not affect other addresses;
- `deriveVisualSeed(root, ...parts)` equals the fold that applies `mixChannel`
  to `visualChannel(part)` for each string part and `mixNumber(part)` for each
  numeric part, at any arity;
- `visualChannel` is stable across calls and processes;
- both fold functions accept and return a plain int32 accumulator, so a partial
  address can be hoisted out of an inner loop (channel and material folded once
  per material, column folded once per column) without changing any result;
- documented as a deterministic fingerprint/address, not cryptographic hashing.

Recommended address conventions:

```text
tile:   root, "tile", materialId, col, row, detailIndex
rect:   root, "entity", entityKey, materialId, detailIndex
layer:  root, "layer", layerId, repeatIndex, detailIndex
effect: root, "effect", entityKey, effectName, fixedTick, detailIndex
```

**Hot-path rule.** The string form must not appear in any per-tile or per-detail
loop. A 600×400 viewport at 16px tiles is roughly 950 visible cells; at two or
three details each, the variadic form would perform several thousand string
hashes and rest-argument array allocations per frame, contradicting §13.1's
"no per-frame allocation" target. Instead:

- `createLevelThemeRenderer` resolves every channel name, every `material.id`,
  and any string entity key to an int32 id once, at theme-normalization time;
- the tile loop folds integers with `mixChannel` / `mixNumber`, hoisting the
  channel/material prefix out of the per-cell work;
- `TerrainDetailContext.seed` is the already-mixed integer, so custom detail
  renderers never pay the string cost either.

Decorative animation that changes over time must use a supplied deterministic tick,
not wall-clock time.

### 7.4 Material model

The initial material model should be expressive enough for strong visual identity
without becoming a shader graph:

```ts
export interface TerrainPalette {
  readonly fill: string;
  readonly top: string;
  readonly side: string;
  readonly shadow: string;
  readonly outline: string;
  readonly detail: string;
  readonly accent?: string;
}

export type BuiltinSurfaceDetail =
  | 'none'
  | 'mortar'
  | 'cracks'
  | 'rivulets'
  | 'rivets'
  | 'crystal';

/** Author-facing input. Loose, optional, unvalidated. */
export interface TerrainMaterialInput {
  readonly id: string;
  readonly palette: Readonly<TerrainPalette>;
  readonly topThickness?: number;
  readonly sideDepth?: number;
  readonly outlineWidth?: number;
  readonly cornerSize?: number;
  readonly surfaceDetail?: BuiltinSurfaceDetail;
  readonly detailDensity?: number;
  readonly detailScale?: number;
}
```

**Normalization must not be bypassable.** If draw APIs accept a structural
`TerrainMaterial`, every "normalization happens once" guarantee in this plan is
advisory: a caller can hand `drawTerrainRect` a hand-written object literal with
an unparseable color, a negative thickness, and an unresolved `id`, and the hot
path — which by §7.3 and §7.8 performs no validation — will either throw inside
`parseHex` or draw negative geometry. The type system carries the guarantee
instead:

```ts
declare const normalized: unique symbol;

/** Only obtainable from `normalizeTerrainMaterial`. */
export interface NormalizedTerrainMaterial {
  readonly [normalized]: true;
  readonly id: string;
  /** Int32 channel id resolved from `id` for hot-path seeding (§7.3). */
  readonly channelId: number;
  readonly palette: Required<Readonly<TerrainPalette>>;
  readonly topThickness: number;
  readonly sideDepth: number;
  readonly outlineWidth: number;
  readonly cornerSize: number;
  readonly surfaceDetail: BuiltinSurfaceDetail;
  readonly detailDensity: number;
  readonly detailScale: number;
}

export function normalizeTerrainMaterial(
  input: Readonly<TerrainMaterialInput>,
): NormalizedTerrainMaterial;
```

Every optional field is resolved, so the hot path reads concrete values with no
`??` chains. The `unique symbol` brand cannot be produced outside the module, so
`NormalizedTerrainMaterial` is not structurally forgeable, and it costs nothing
at runtime. Rules that follow:

- `drawTerrainRect`, `drawTerrainTiles`, and `TerrainDetailContext.material` all
  take or expose `NormalizedTerrainMaterial`, never the input type.
- `TerrainMaterialTable` is likewise opaque — obtainable only from
  `createTerrainMaterialTable`, which normalizes each entry.
- Themes are authored with `TerrainMaterialInput`;
  `createLevelThemeRenderer` normalizes them.
- Consumers calling `drawTerrainRect` directly call `normalizeTerrainMaterial`
  once, at setup, and the type error tells them so if they forget.

Normalization itself must:

- clamp thicknesses and densities to documented bounds;
- fall back to derived colors when optional palette entries are missing;
- replace invalid color strings before they reach color parsers that throw;
- make `'none'` the default surface detail;
- resolve `id` to an int32 channel id for hot-path seeding (§7.3);
- ensure a material can render at small tile sizes without negative geometry;
- be idempotent — re-normalizing a normalized material returns it unchanged.

**Color validation belongs in `primitives/color.ts`, not in `terrain`.**
`parseHex` throws on malformed input by design — invalid colors are treated as a
programmer error there. Theme data, however, can reach the renderer from level
files, editor UI, or generated content, so the renderer needs a non-throwing
guard. That guard is a general color concern and every future module will want
it, so this plan adds it to the existing primitive rather than hiding a private
copy inside `terrain`:

```ts
/** True when `value` is a parseable `#rrggbb` / `rrggbb` string. */
export function isHexColor(value: unknown): value is string;

/** `value` if parseable, otherwise `fallback`. Never throws. */
export function safeHex(value: unknown, fallback: string): string;
```

Material normalization routes every palette entry through `safeHex` once, so no
per-tile call site ever needs a guard.

Consumers needing custom surface treatments use a draw callback:

```ts
export interface TerrainDetailContext {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Already-mixed int32 address (§7.3). Seed `mulberry32` with it. */
  readonly seed: number;
  readonly neighborhood?: Readonly<TerrainNeighborhood>;
  readonly material: NormalizedTerrainMaterial;
}

export type TerrainDetailRenderer = (
  ctx: CanvasRenderingContext2D,
  detail: Readonly<TerrainDetailContext>,
) => void;
```

Built-in surface details are implemented through the same internal contract used
by custom detail renderers. A throwing detail renderer is caught per *entity or
tile*, not per neighbor probe — the guard sits at the tile boundary that
`drawTileGrid` already establishes, so one bad detail callback cannot abort the
rest of the terrain (§20.7).

### 7.5 Tile renderer

```ts
/**
 * Opaque tile-value → material lookup. Obtainable only from
 * `createTerrainMaterialTable`, which normalizes every entry. Replaces a
 * per-tile `materialFor` callback.
 */
export interface TerrainMaterialTable {
  readonly [normalized]: true;
  readonly get: (tileValue: number) => NormalizedTerrainMaterial | undefined;
}

export function createTerrainMaterialTable(
  entries: Readonly<Record<number, Readonly<TerrainMaterialInput>>>,
): TerrainMaterialTable;

export interface DrawTerrainTilesOptions {
  readonly visualSeed: number;
  /** The authoritative world view rectangle (§7.2). */
  readonly view: Readonly<TerrainViewport>;
  /** Positive finite DPR used for the §5.7 internal body overlap. */
  readonly devicePixelRatio: number;
  readonly materials: TerrainMaterialTable;
  /** Prepared once; this lookup never invokes the consumer connector. */
  readonly connections: TerrainConnectionTable;
  readonly drawDetail?: TerrainDetailRenderer;
  readonly includeValues?: readonly number[];
  readonly overscanTiles?: number;
}

export function drawTerrainTiles(
  ctx: CanvasRenderingContext2D,
  grid: Readonly<TileGrid>,
  options: Readonly<DrawTerrainTilesOptions>,
): void;
```

The implementation draws only visible included tiles. Per tile it should:

1. sample connectivity;
2. draw the body fill;
3. draw exposed side shading;
4. draw the exposed top cap;
5. resolve outer and inner corner treatment;
6. draw surface details using a coordinate-addressed integer seed
   (a `mixChannel`/`mixNumber` fold, never the string form);
7. draw only the outlines needed for silhouette readability.

It must not create dark seams between fully connected cells unless the selected
surface detail intentionally adds seams. Logical body bounds use integer world
coordinates with no inset; the base body fill additionally applies §5.7's
one-device-pixel overlap only across connected internal edges. The
fractional-camera and non-commensurate-ratio tests in §14.4 are the regression
gates for this.

### 7.6 Rectangular platform renderer

Entity-authored platforms require a related treatment even when the tile grid is
empty:

```ts
export type TerrainRectRole =
  | 'solid'
  | 'passthrough'
  | 'moving'
  | 'hazard';

export interface DrawTerrainRectOptions {
  readonly visualSeed: number;
  /** Positive finite DPR used for the §5.7 internal body overlap. */
  readonly devicePixelRatio: number;
  /** Numeric address key. String ids resolve via `visualChannel` (§7.3). */
  readonly entityKey: number;
  readonly role: TerrainRectRole;
  readonly material: NormalizedTerrainMaterial;
  readonly drawDetail?: TerrainDetailRenderer;
  /** Exposed spans per edge. Omitted → fully exposed on all four edges. */
  readonly exposure?: Readonly<TerrainRectExposure>;
}

export function drawTerrainRect(
  ctx: CanvasRenderingContext2D,
  rect: Readonly<LevelRect>,
  options: Readonly<DrawTerrainRectOptions>,
): void;
```

Role-specific rules:

- `solid`: full body, strong top cap, visible side face;
- `passthrough`: thin top surface with open/low-contrast underside;
- `moving`: distinct edge or mechanical treatment without relying on hue alone;
- `hazard`: pointed or warning silhouette owned by the terrain layer, so the
  shape-redundancy requirement in §12.1 and acceptance criterion 5 have an
  implementation. Consumers still override `hazard` entirely when they have
  bespoke art; this is the shared fallback geometry, not a mandate.

#### Rectangle edge exposure is computed, not delegated

The playground's floor spans the full world width and its two walls sit directly
on it. With an all-edges-exposed default, the room boundary draws wall side faces
and floor top caps into solid neighbors — the exact seam artifact §7.5 forbids,
in the scene the plan is validated against. Hand-authoring `exposed` flags for
that is not a reasonable ask of consumers.

Three properties are required, and a boolean-per-edge API satisfies none of them.

**Edges are partially covered, so exposure is a set of intervals.** A 96px ledge
meeting a 16px pillar has 80px of exposed top surface. A boolean can only choose
between drawing a cap across the junction or dropping the cap entirely; both are
wrong. Exposure is expressed as spans along each edge.

**Occlusion is family-scoped.** A stone platform overlapping a lava rect must not
suppress the lava's edge, and a passthrough ledge resting on solid ground is
still a distinct surface. Occlusion applies only within a connection family, on
the same terms as tile connectivity in §7.1.

**The input set must be stable, not the visible set.** Computing over visible
rectangles makes a rect's own appearance depend on which *other* rects the camera
happens to include — scroll an occluder off screen and an interior edge grows a
cap, which is precisely the §11.3 culling-invariance violation this plan forbids
elsewhere. Exposure is computed over the level's full static terrain set, once.

```ts
/** Half-open interval along an edge, in world coordinates. */
export interface ExposedSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * Exposed intervals per edge. `top`/`bottom` spans are x-intervals;
 * `left`/`right` spans are y-intervals. An empty array means fully occluded;
 * a single full-width span means fully exposed.
 */
export interface TerrainRectExposure {
  readonly top: readonly ExposedSpan[];
  readonly right: readonly ExposedSpan[];
  readonly bottom: readonly ExposedSpan[];
  readonly left: readonly ExposedSpan[];
}

/** A static terrain rectangle and the family it occludes within. */
export interface TerrainRectInput {
  readonly key: number;
  readonly rect: Readonly<LevelRect>;
  /** Rectangles occlude each other only within a family. */
  readonly familyId: number;
  /**
   * Spans shorter than this are dropped rather than emitted, so a sliver does
   * not produce a degenerate cap. Resolve from the rect's material corner size.
   * Default 0 (keep every span).
   */
  readonly minimumSpan?: number;
}

export interface ComputeRectExposureOptions {
  /** Default: identical `familyId` values connect. */
  readonly connects?: (centerFamily: number, neighborFamily: number) => boolean;
  /** World-unit tolerance for touching edges. Default 0. */
  readonly epsilon?: number;
}

/**
 * Compute exposure for every rectangle in a **static** set. Call once per
 * level, not per frame, and never with a camera-filtered subset.
 */
export function computeRectExposures(
  rects: readonly Readonly<TerrainRectInput>[],
  options?: Readonly<ComputeRectExposureOptions>,
): ReadonlyMap<number, TerrainRectExposure>;
```

Required behavior:

- an edge starts as one full-length span, and each connected neighbor whose
  perpendicular position touches that edge subtracts its overlapping interval;
- resulting spans are sorted, non-overlapping, half-open, and merged;
- spans shorter than the rect's `minimumSpan` are dropped, so a 1px sliver does
  not produce a degenerate cap;
- results are identical regardless of input order;
- results are independent of the camera, the viewport, and draw order;
- the function is pure and allocates only its output.

**Sliver suppression needs a length, not a material.** The rule is stated in
terms of the material's corner size, but `computeRectExposures` is pure geometry
and has no material, and pushing the filter into `drawTerrainRect` would mean
re-filtering and re-allocating spans every frame — breaking §13.1's "the rect
draw path allocates nothing." The threshold is therefore passed in as
`minimumSpan`, one scalar per rect, and the *caller* resolves it from the
material. `prepareLevelScene` (§7.8) does that automatically: for each entity it
looks up the role material it will actually be drawn with and passes that
material's `cornerSize`. Consumers calling `computeRectExposures` directly pass
`normalizeTerrainMaterial(m).cornerSize`, or omit it and keep every span.

This remains per-edge occlusion, not the polygon union ruled out in §4: no vertex
arithmetic, no shape merging, no derived geometry — interval subtraction along
four axes.

**Moving platforms are excluded from the occluder set.** Their position is a
runtime value, so including them would make static exposure depend on simulation
state and change during play. They render fully exposed unless the consumer
passes `exposure` explicitly, which also matches how they should read visually —
as objects moving through the space rather than part of the room.

Callers may still pass `exposure` directly to override the computed result.

**Where `familyId` comes from.** Two rectangles belong to the same family when
they would read as one continuous surface, which in practice means they are drawn
with the same material. The default derivation is exactly that: `familyId` is the
normalized material's `channelId` for the entity's terrain role, so all `platform`
rects in a theme share a family, `hazard` rects share a different one, and a
passthrough ledge resting on solid ground keeps its own surface. Themes that need
finer control override it:

```ts
export interface LevelTerrainTheme {
  // ...
  /** Default: the role material's `channelId`. */
  readonly rectFamilyFor?: (entity: Readonly<LevelEntity>) => number;
}
```

This mirrors §7.1's tile connectors — same question, same shape of answer — and
keeps the family decision with the theme, which is what owns material assignment.

**Where it runs.** `prepareLevelScene` computes the map once from
`level.entities` (excluding `movingPlatform`) and caches it keyed by entity id.
Consumers calling `drawTerrainRect` directly call `computeRectExposures`
themselves at level-load time. Neither path runs it per frame.

Deferring this to a later phase was considered and rejected: it is what decides
whether the first visible deliverable looks finished, so it ships in Phase 2.

### 7.7 Theme and frame contracts

```ts
/**
 * A resolved entity: the authored entity plus the rectangle it occupies **this
 * frame**. For `movingPlatform` the consumer substitutes the runtime rect; for
 * everything else `rect` equals `entity.rect`.
 */
export interface ResolvedLevelEntity {
  readonly entity: Readonly<LevelEntity>;
  readonly rect: Readonly<LevelRect>;
}

export interface LevelRenderFrame {
  readonly level: Readonly<LevelData>;
  /** The facade treats a non-positive or non-finite value as `1`. */
  readonly devicePixelRatio: number;
  /**
   * The authoritative world view rectangle (§7.2). Its `x`/`y` *is* the camera
   * origin — there is no separate `camera` field, and shake is not folded in.
   */
  readonly view: Readonly<TerrainViewport>;
  /**
   * Theme-renderer-owned entities to draw this frame, with runtime rectangles
   * already resolved. The renderer never derives this from `level.entities`,
   * because it cannot know a moving platform's current position. In play mode,
   * omit authored `enemy` entries when the consumer's runtime enemy renderer owns
   * them; edit/thumbnail mode may include them for previews.
   */
  readonly entities: readonly Readonly<ResolvedLevelEntity>[];
  readonly tick: number;
  readonly interpolation?: number;
  /** Omitted → the renderer reads `prefersReducedMotion()`. See §12.3. */
  readonly reducedMotion?: boolean;
  readonly mode?: 'play' | 'edit' | 'thumbnail';
}

export interface LevelTerrainTheme {
  readonly tiles: Readonly<Record<number, Readonly<TerrainMaterialInput>>>;
  readonly solid: Readonly<TerrainMaterialInput>;
  readonly passthrough: Readonly<TerrainMaterialInput>;
  readonly moving: Readonly<TerrainMaterialInput>;
  readonly hazard: Readonly<TerrainMaterialInput>;
  readonly connects?: (
    centerValue: number,
    neighborValue: number,
  ) => boolean;
  readonly drawTileDetail?: TerrainDetailRenderer;
  readonly drawRectDetail?: TerrainDetailRenderer;
}

export type LevelLayerRenderer = (
  ctx: CanvasRenderingContext2D,
  frame: Readonly<LevelRenderFrame>,
) => void;

export interface LevelRenderTheme {
  readonly id: string;
  readonly visualSeed: number;
  readonly backgroundColor: string;
  readonly terrain: Readonly<LevelTerrainTheme>;
  readonly entityPalette?: Readonly<EntityPalette>;
  readonly entityOverrides?: Readonly<DrawLevelEntityOverrideMap>;
  readonly farBackground?: LevelLayerRenderer;
  readonly midBackground?: LevelLayerRenderer;
  readonly backDecorations?: LevelLayerRenderer;
  readonly frontDecorations?: LevelLayerRenderer;
  readonly foreground?: LevelLayerRenderer;
  readonly screenTint?: LevelLayerRenderer;
}
```

The initial API should pass a theme directly. A global mutable registry is not
required for rendering and should not be introduced in the first milestone.

**Themes are authored, not normalized.** `LevelTerrainTheme` carries
`TerrainMaterialInput` values — plain author data. `createLevelThemeRenderer`
converts them to `NormalizedTerrainMaterial` and builds the
`TerrainMaterialTable`. A theme object is therefore safe to write by hand, hold
in a config file, or generate; only the renderer produces normalized values.

**The consumer builds the frame, including runtime rectangles.** `frame.entities`
is a resolved list, not `level.entities`. This is what makes the facade able to
draw moving platforms at all — see §7.8 and §9.3.

**One name for the seed.** Earlier drafts used `visualSeed` on the theme,
`rootSeed` on the draw options, and `seed` on the deferred schema field for the
same value. The canonical name is `visualSeed` everywhere — theme, draw options,
and any future `LevelVisuals` field. The one exception is the `rng` primitive
itself, whose first parameter stays `rootSeed`: it is a general helper with no
notion of visuals, and `visualSeed` is simply what callers pass into it.

**Tree-shaking.** Built-in themes are leaf modules. No `BUILTIN_THEMES` array,
registry object, or index map may reference them collectively; such an aggregate
would defeat `export *` tree-shaking for consumers who use none of them (§13.4).

### 7.8 Renderer facade

An earlier draft had a single `drawTerrain` pass that claimed to draw both tiles
and entity rectangles, while receiving only authored `LevelData`. That cannot
work: it has no access to a moving platform's runtime position, and any rectangle
it did draw would be drawn a second time by `drawEntity`. The facade splits the
two sources and partitions entity kinds explicitly.

**Creation is two steps, because the derived data has two lifetimes.** Theme
normalization — colors, clamps, channel ids, material tables — depends only on
the theme. Static exposure and the tile connection table depend on the *level*.
An earlier draft claimed `createLevelThemeRenderer(theme)` computed exposure
"from `level.entities`" while never receiving a level. Splitting the factory
fixes that and is useful on its own: an editor swapping levels under one theme
re-prepares without re-normalizing, and a theme switcher re-normalizes without
re-walking geometry.

```ts
/** Theme-derived, level-independent. Reusable across levels. */
export interface LevelThemeRenderer {
  /**
   * Bind the renderer to one level, computing level-derived data once:
   * the tile connection table (§7.1) and static rectangle exposure (§7.6).
   */
  readonly prepare: (level: Readonly<LevelData>) => PreparedLevelScene;
}

/** Theme + level. Owns every draw pass. */
export interface PreparedLevelScene {
  readonly level: Readonly<LevelData>;

  readonly drawBackground: LevelLayerRenderer;

  /** Tile grid only. Uses the prepared level's tiles and `frame.view`. */
  readonly drawTerrainTiles: LevelLayerRenderer;

  /**
   * Entity rectangles with terrain roles, drawn from `frame.entities` at their
   * resolved runtime rects. Ignores every other kind.
   */
  readonly drawTerrainRects: LevelLayerRenderer;

  /** Everything in `NON_TERRAIN_KINDS`. Nothing is drawn twice. */
  readonly drawEntities: LevelLayerRenderer;

  /** Escape hatch for consumers driving their own iteration order. */
  readonly drawEntity: (
    ctx: CanvasRenderingContext2D,
    resolved: Readonly<ResolvedLevelEntity>,
    frame: Readonly<LevelRenderFrame>,
  ) => void;

  readonly drawBackDecorations: LevelLayerRenderer;
  readonly drawFrontDecorations: LevelLayerRenderer;
  readonly drawForeground: LevelLayerRenderer;
  readonly drawScreenTint: LevelLayerRenderer;
}

export function createLevelThemeRenderer(
  theme: Readonly<LevelRenderTheme>,
  options?: Readonly<LevelThemeRendererOptions>,
): LevelThemeRenderer;
```

`frame.level` must be the exact level reference the scene was prepared from.
Every prepared draw operation checks this before touching the canvas. A mismatch
reports `'scene-mismatch'` through `onDiagnostic` once per mismatched level
reference and **returns without drawing**; it never combines frame geometry with
the prepared level's connection table, exposure, dimensions, or tiles. This is a
fail-closed programmer-error path, not a visual fallback. Editing a level in
place invalidates the preparation — the editor re-prepares on structural edits,
which §15 Phase 5 covers.

**The partition covers every `EntityKind`, including `trap`.** An earlier draft
listed six non-terrain kinds and silently dropped `trap`, which is neither a
terrain role nor drawn by anything else — the draw-exactly-once invariant was
violated by a kind simply going missing. The arrays are declared through a small
generic helper whose final two arguments are real compile-time assertions, not a
type alias that may silently evaluate to `never`:

```ts
function defineEntityKindPartition<
  const Terrain extends readonly EntityKind[],
  const NonTerrain extends readonly EntityKind[],
>(
  terrain: Terrain,
  nonTerrain: NonTerrain,
  _allKindsCovered: Exclude<
    EntityKind,
    Terrain[number] | NonTerrain[number]
  > extends never ? true : never,
  _noKindOverlaps: Extract<
    Terrain[number],
    NonTerrain[number]
  > extends never ? true : never,
): readonly [Terrain, NonTerrain] {
  return [terrain, nonTerrain] as const;
}

export const [TERRAIN_ROLE_KINDS, NON_TERRAIN_KINDS] =
  defineEntityKindPartition(
    ['platform', 'passthrough', 'movingPlatform', 'hazard'] as const,
    ['spawn', 'exit', 'trap', 'decoration', 'trigger', 'enemy', 'collectible']
      as const,
    true,
    true,
  );
```

Adding a kind without placing it in either array makes `_allKindsCovered`
require `never`; placing a kind in both makes `_noKindOverlaps` require `never`.
Either makes the call fail to typecheck, while the used helper and exported
arrays remain compatible with `noUnusedLocals`. §14.5 asserts the runtime
counterpart on a full edit-mode frame.

`drawEntity` remains available for consumers who interleave entity drawing with
their own runtime objects; it dispatches on kind and routes terrain roles to the
rectangle path. It guarantees the same **per-kind treatment**, but not the same
whole-frame pixels as `drawTerrainRects` followed by `drawEntities`: source-order
iteration may interleave terrain and non-terrain entities, changing compositing
where they overlap. Consumers choosing the escape hatch own that ordering.

Normalization is where all per-frame cost is bought out, and it is specified
rather than left to the implementation.

`createLevelThemeRenderer` (theme-derived):

- palette entries validated through `safeHex`;
- thicknesses, densities, and scales clamped;
- every material converted to `NormalizedTerrainMaterial`, with `id` and every
  channel name resolved to int32 ids (§7.3);
- the tile-value → material table built;
- `connects` and `rectFamilyFor` structurally validated; `onDiagnostic` captured;
- layer callbacks captured.

`prepare(level)` (level-derived):

- the sparse tile connection table built from observed ordered neighbor pairs
  (§7.1);
- `familyId` and `minimumSpan` resolved per entity from its role material;
- static rectangle exposure computed from `level.entities`, excluding
  `movingPlatform` (§7.6);
- the level reference retained for the mismatch check.

After `prepare` returns, no draw pass performs string hashing, color parsing,
material validation, connector invocation, or exposure computation.

The scene does not own the entire game frame and does not draw the player,
runtime enemies, projectiles, HUD, editor widgets, or consumer-specific effects.

## 8. Built-in visual vocabulary

### 8.1 Initial materials

Ship three sample material families. They validate flexibility and provide useful
defaults without claiming to cover every art direction.

#### Ruins

- warm stone palette;
- bright, readable top cap;
- shaded front/side face;
- sparse mortar seams;
- occasional edge chips;
- low-contrast dust;
- optional broken-column background silhouettes.

#### Cavern

- dark rock palette;
- irregular crack detail;
- warmer or cooler accent veins;
- stronger underside shadow;
- stalactite/stalagmite silhouettes in background layers;
- optional water or lava integration through consumer callbacks.

#### Mechanical

- plate-like body;
- heavy top edge;
- corner rivets;
- alternating seam lengths;
- optional hazard-stripe accent;
- pipes/gears as procedural background silhouettes.

Each built-in must be derivable from a small palette object. Hard-coded colors are
allowed only as documented fallback defaults.

### 8.2 Surface-detail behavior

Built-in surface details must be:

- sparse enough not to become texture noise;
- clipped to the terrain body when appropriate;
- stable by tile/entity address;
- sensitive to available dimensions;
- lower contrast than collision edges;
- reproducible in thumbnails;
- disabled or simplified below a documented minimum tile size.

### 8.3 Semantic platformer entities

The first themed entity renderer should cover:

| Kind | Play-mode treatment | Edit-mode treatment |
|---|---|---|
| `spawn` | Hidden by default; optional subtle spawn pad | Existing marker remains |
| `exit` | Door/portal silhouette; distinct locked/trap states | Door plus marker/selection |
| `platform` | Solid material | Solid material plus editor overlays |
| `passthrough` | Thin top-only ledge | Ledge plus role indicator |
| `movingPlatform` | Mechanical edge/joint treatment | Same plus path widget |
| `hazard` | Spikes or consumer override; danger silhouette | Hazard art plus bounds |
| `trap` | Consumer override; safe fallback with warning form | Marker/bounds remain clear |
| `decoration` | Sprite/callback dispatch by depth role | Bounds visible when selected |
| `trigger` | Hidden by default | Dashed trigger bounds |
| `enemy` | Runtime renderer remains authoritative | Authored preview or fallback |
| `collectible` | Coin/gem/key silhouette and optional glow | Same plus bounds when selected |

The `enemy` row is an ownership boundary, not a mode-specific skip hidden inside
`drawEntities`. A play-mode consumer with a runtime enemy system omits authored
enemy entries from `frame.entities`; edit and thumbnail frames include them when
they need the authored preview. Consequently every entry actually supplied to
the theme renderer still follows the same draw-exactly-once partition.

Unknown or throwing overrides fall back to the existing defensive behavior.

### 8.4 Atmosphere

Atmosphere is built from existing primitives and consumer-owned state:

- static procedural silhouettes via `drawTiledParallax`;
- low-density ambient particle emitters;
- glow around visually emissive surfaces and goals;
- palette tint on biome/theme transition;
- surface-specific dust, drips, bubbles, embers, or sparks;
- near-foreground occluders with strict opacity and coverage limits.

The engine should provide recipes/examples, not one global atmosphere simulation.
Particle state remains consumer-owned and fixed-step advanced.

## 9. Scene integration

### 9.0 Two validation scenes

Per §2.5, the playground validates only half of this plan. The showcase gets a
second scene, and each scene owns explicit responsibilities:

| Scene | Path | Validates |
|---|---|---|
| Playground | `showcase/sections/playground.ts` | Rect renderer, roles, edge exposure, themed entities, edit/play split |
| Tile room | new section, built from `realizeBlueprint` | Connectivity, visible range, culling invariance, tile surface details, scrolling camera, tile benchmarks |

The tile room is a **Phase 0 deliverable**, not an assumption. It uses a
generated `LevelData` from `src/levelgen/` — which already emits a real tile grid
and tile semantics — rendered through a scrolling camera larger than the
viewport. Without it, `sampleTerrainNeighborhood`, `visibleTileRange`,
`drawTerrainTiles`, §11.3's culling invariance, and acceptance criteria 3, 8, and
11 ship with no exercised consumer.

The tile room also supplies the §13.3 benchmark fixtures 2, 3, and 4 directly,
so it is not a cost paid purely for validation.

### 9.1 Playground target pipeline

The first integration replaces the playground's flat entity drawing in play mode:

```text
once per level:  scene = themeRenderer.prepare(level)
--- per frame ---
resolve theme-renderer-owned entities (runtime rects for moving platforms;
  omit authored enemies because the runtime enemy renderer owns them in play)
build LevelRenderFrame { level, devicePixelRatio, view, entities, tick, ... }
fill theme backdrop
draw far background
draw mid background
apply snapped world transform (camera origin + shake)
drawTerrainTiles
drawTerrainRects
draw back decorations
draw dust
draw runtime enemies and projectiles
draw player
drawEntities            // exit, collectibles, decorations — never terrain roles
draw front decorations
restore world transform
draw screen tint / transition
draw HUD
```

Three notes on this pipeline. The playground's world equals its screen at
600×400, so the shake offset is its *only* world transform — the scrolling-camera
path is exercised by the tile room (§9.0), not here. That shake is fractional by
construction (`sineShake`), so the playground applies it through
`applySnappedTranslate` (§5.7), making it the natural regression case for the
pixel-snapping contract. And the resolve step at the top is the consumer's, not
the renderer's: it is where the playground's existing runtime moving-platform
rect substitution lives today, now expressed as `ResolvedLevelEntity[]`, and
where play-mode enemy ownership is resolved before anything reaches the themed
passes.

Edit mode keeps the grid and existing editor widgets. A toolbar toggle should allow:

- `Art preview`: themed terrain/entities;
- `Collision preview`: existing flat role colors and dashed markers.

The toggle is an editor presentation state, not part of `LevelData`.

### 9.2 First showcase comparison

Before deeper integration, add a deterministic comparison artifact for each
validation scene — the playground for the rect path, the tile room for the tile
path — holding the scene fixed and varying only the treatment:

1. current fallback;
2. Ruins;
3. Cavern;
4. Mechanical.

The level geometry, player position, camera, and entity list remain identical.
Only rendering changes.

The comparison should be available as:

- a showcase control or dedicated section;
- a generated contact sheet for review;
- a benchmark fixture.

### 9.3 Dynamic entity positions

The renderer must accept the entity rectangle to draw for the current frame. The
consumer remains responsible for replacing authored positions with runtime moving
platform positions, matching the current playground behavior.

This is expressed as `LevelRenderFrame.entities: ResolvedLevelEntity[]` (§7.7).
The rules that fall out of it:

- The renderer never reads `level.entities` to decide what to draw. It reads
  `frame.entities`. `level` remains on the frame for geometry, dimensions, and
  tiles.
- A resolved entity's `rect` is authoritative for the frame; `entity.rect` is
  the authored position and is used only for static exposure, computed once in
  `prepare(level)` (§7.6).
- `frame.level` must be the level the scene was prepared from; a mismatch is
  reported as `'scene-mismatch'` and the prepared draw operation returns without
  touching the canvas.
- Moving platforms are excluded from the static occluder set, so a runtime rect
  can never invalidate a cached exposure result.
- Each resolved entity **supplied in `frame.entities`** is drawn exactly once:
  terrain roles by
  `drawTerrainRects`, everything else by `drawEntities` (§7.8). §14.5 asserts
  this against a full frame.
- In play mode, consumers with a runtime enemy renderer omit authored `enemy`
  entries from `frame.entities`; edit and thumbnail modes may include them for
  previews. This makes ownership explicit and prevents double rendering.
- Consumers who cull entities themselves simply pass a shorter list. Culling
  changes which entities are drawn, never how any one of them looks.

The theme renderer must never advance moving platforms or enemy behavior.

## 10. Schema and persistence strategy

### 10.1 No schema change in the first implementation

Milestones 1–4 pass `LevelRenderTheme` directly from the consumer. This proves the
render contract without coupling unproven visual fields to serialization,
migration, validation, hashing, or generated levels.

Existing `LevelFlags` remain unchanged. They are coarse renderer hints, not a theme
system.

### 10.2 Optional later `LevelVisuals`

After at least two consumers use the renderer, evaluate an optional plain-data
reference:

```ts
export interface LevelVisuals {
  readonly themeId: string;
  readonly visualSeed?: number;
}

export interface LevelData {
  // existing fields...
  readonly visuals?: Readonly<LevelVisuals>;
}
```

Rules:

- `themeId` resolves through a consumer-owned registry or lookup map;
- unknown IDs fall back to a supplied default theme;
- `visualSeed` affects rendering only;
- no palette callbacks, image objects, gradients, `Set`, `Map`, or functions are
  serialized;
- the optional field must receive validation, migration, editor replacement,
  canonicalization, and documentation coverage;
- replay and collision results must remain unchanged when only `visuals` changes.

Adding this field is explicitly deferred until the renderer API is validated.

## 11. Determinism contract

### 11.1 Stable inputs

A themed frame is a pure rendering function of:

```text
LevelData
+ LevelRenderTheme
+ the world view rectangle
+ explicit deterministic tick/interpolation
+ runtime entity rectangles supplied by the consumer
+ consumer-owned deterministic effect state
```

### 11.2 Forbidden inputs

Core themed render output must not depend on:

- `Date.now`;
- `performance.now`;
- unseeded `Math.random`;
- current array traversal outside the entity's stable ID/address;
- number of offscreen tiles visited;
- which *other* entities happen to be on screen;
- camera shake, parallax offset, or any other transform-only nudge;
- DOM size reads;
- device locale;
- object identity;
- mutable global theme state.

### 11.3 Culling invariance

If tile `(12, 8)` contains two cracks when visible at view origin X=0, it must
contain the same two cracks after scrolling away and returning. Changing view
size may change which tiles are drawn, but not their local details.

The same invariant governs rectangle exposure, and it is the reason §7.6
computes exposure over the level's full static terrain set rather than the
visible subset. If exposure were computed per frame from visible rectangles,
scrolling an occluding wall off screen would grow a cap on the floor edge it was
covering — a visible change to a rect that never moved, caused only by the
camera. Exposure is computed once, in `prepare(level)`, and cached by entity id.

Camera shake is likewise excluded from `view` (§7.2), so a decaying shake cannot
change the visible set mid-animation; `overscanTiles` covers the edge instead.

### 11.4 Animation

Animation uses one of:

- fixed simulation tick for replay-stable cues;
- a consumer-supplied render tick for decorative motion that is explicitly allowed
  to be visual-only;
- static output when reduced motion is enabled.

No renderer helper reads time itself.

## 12. Accessibility and motion

### 12.1 Shape redundancy

Critical roles cannot be distinguished by hue alone:

- passthroughs are thin/open underneath;
- hazards have pointed or warning silhouettes;
- moving platforms have mechanical or directional treatment;
- exits have a doorway/portal form;
- collectibles have distinct silhouettes.

### 12.2 Contrast

- Terrain top edges must contrast with their bodies.
- Player and hazards must remain readable against terrain and backgrounds.
- Background layers use lower contrast and saturation than gameplay layers.
- Theme examples should run palette contrast checks using existing helpers.
- HUD text retains normal text contrast requirements.

### 12.3 Reduced motion

`LevelRenderFrame.reducedMotion` is optional. When omitted, the renderer falls
back to `prefersReducedMotion()` from `src/primitives/motion.ts` — the existing
cached-at-module-load probe that conventions require as the single source for
this signal. An explicit `false` disables the fallback, so consumers who manage
the preference themselves are never overridden. The probe is read once per frame
in the facade, never inside a draw loop, so the "no DOM reads in deterministic
helpers" rule still holds for every `terrain` function.

When `reducedMotion` resolves true:

- parallax may render at a static camera-relative position;
- ambient particles become static, sparse, or disabled;
- flicker and pulse freeze at a readable phase;
- transition tints avoid rapid flashing;
- gameplay-required hazard states remain visible through non-motion cues.

## 13. Performance model

### 13.1 Complexity targets

- Tile work: `O(visible tile count)`.
- Entity work: `O(visible entity count)` where consumer culling is available.
- Background work: `O(layer count × copies covering viewport)`.
- No per-frame allocation proportional to full level size.
- No per-tile gradients, offscreen canvases, or image decoding in the hot loop.
- Material normalization happens when creating the theme renderer, not per tile.
- No string hashing, string concatenation, template literals, or rest-argument
  allocation anywhere in the tile or detail loops (§7.3).
- No `try`/`catch` per neighbor probe (§7.1). Guards sit at tile/entity
  granularity only.
- Rectangle edge exposure is `O(static rect count²)` worst case, computed **once
  in `prepare(level)`** over the level's full static terrain set and cached by
  entity id — never per frame, and never over a camera-filtered subset (§7.6,
  §11.3). Per-frame cost is a map lookup. Levels with enough static rectangles
  for the one-time cost to matter should author terrain as tiles; the benchmark
  suite records where that crossover falls.
- Exposure spans are allocated once in `prepare`. The rect draw path reads them
  and allocates nothing.
- The tile connection table is built once in `prepare` from the grid's distinct
  ordered neighbor pairs — at most eight pair observations per cell,
  with the connector called once per unique pair. The consumer's connector is
  never invoked during a frame, which is what makes the no-`try`/`catch` rule
  structural (§7.1).

### 13.2 Canvas discipline

- Group operations by material where practical.
- Avoid `save`/`restore` inside every tiny surface detail when a caller-owned balanced scope
  is sufficient.
- Never leak `globalAlpha`, `globalCompositeOperation`, line dash, transform,
  `shadowBlur`, `shadowColor`, `filter`, or image smoothing.
- Clip once per terrain region or batch when clipping is required.
- Reuse paths only when doing so cannot retain unbounded level state.

### 13.3 Benchmark fixtures

Add headless `canvas` benchmarks for:

1. 600×400 playground with entity rectangles;
2. 60×34 tile room;
3. large tile level viewed through a 600×400 camera;
4. dense worst-case visible terrain with surface details;
5. three procedural parallax layers plus terrain;
6. thumbnails rendered at reduced resolution.

Fixtures 2, 3, and 4 come from the tile room in §9.0, so the scene needed for
validation and the scene needed for benchmarking are the same work.

Phase 0 records the baseline. Before the Phase 2 renderer merge, set a documented
median and p95 regression budget based on those measurements rather than choosing
an arbitrary number in advance.

### 13.4 Distribution size budget

This is the largest visual addition since the animation module, in a library
whose stated identity is "ultra-minimalist procedural rendering, zero runtime
dependencies." Size is therefore a tracked gate, not an afterthought:

- Phase 0 records the current `dist` size after `npm run build:dist`.
- Phase 6 exit criteria include a documented ceiling on the `dist` delta,
  agreed from the Phase 2 and Phase 4 measurements rather than guessed now.
- A consumer importing only `drawTerrainRect` must not pull in the three
  built-in theme families, the tile renderer, or the surface-detail catalog.
  Verified by a bundling smoke test, not by inspection: `sideEffects: false` and
  `export *` make this achievable, but only if no aggregate references the
  built-ins (§7.7).

## 14. Testing strategy

### 14.1 Unit tests: connectivity

Cover:

- isolated cell;
- horizontal span;
- vertical column;
- filled 3×3 block;
- outer corners;
- inner corners;
- border cells;
- out-of-bounds queries;
- values that connect as one family;
- equal-value-only connection;
- malformed grid lengths;
- a throwing connector propagates out of `sampleTerrainNeighborhood` (§7.1);
- a non-function `connects` is rejected at renderer creation, fail-fast;
- `createTerrainConnectionTable` calls the connector exactly once per distinct
  ordered value pair observed across an in-bounds eight-neighbor adjacency, and
  never again during rendering;
- without `onError`, a throwing connector propagates out of table construction;
- with `onError`, the failing value pair is reported once and recorded as
  disconnected, and rendering proceeds;
- a connector that throws only for a pair not observed as an adjacency never
  affects anything;
- a grid with one unique integer per cell performs at most eight connector calls
  per cell, demonstrating that preparation is linear rather than `n²`.

Use compact ASCII fixtures to make expected masks reviewable.

### 14.2 Unit tests: visual seed

Assert:

- same address produces the same unsigned seed;
- changing any part usually changes the seed;
- string `"1"` and number `1` do not collide;
- **`deriveVisualSeed(root, "foo")` differs from `deriveVisualSeed(root,
  visualChannel("foo"))`** — the type tag makes a string component and the
  integer it hashes to distinct addresses;
- `mixChannel(acc, n)` differs from `mixNumber(acc, n)` for every `n`;
- draw order does not affect addresses;
- culling unrelated cells does not affect a target cell;
- non-finite numbers normalize deterministically;
- `deriveVisualSeed` equals the equivalent `mixChannel`/`mixNumber` fold across
  a matrix of arities (3 to 8 parts) and mixed string/number parts — the tiers
  must not drift even though one is defined in terms of the other;
- folding a partial address once and reusing it equals folding it per item;
- `visualChannel` is stable across calls and processes;
- no forbidden random/time source appears.

### 14.3 Unit tests: visible tile range

Cover:

- view inside grid;
- view crossing each boundary;
- view fully outside;
- negative view origin;
- fractional view origin;
- overscan, including overscan sized for a given shake magnitude;
- tile size larger than the view;
- malformed tile size and dimensions.

### 14.4 Renderer behavior tests

With a recording/mock Canvas2D context, assert:

- exposed top edges are drawn only where expected;
- enclosed tile seams are omitted;
- passthrough, solid, moving, and hazard roles use different geometry;
- detail callbacks receive stable seeds and bounds;
- malformed materials do not throw;
- invalid color strings resolve through `safeHex` instead of reaching `parseHex`;
- a throwing *detail* callback does not abort the rest of the terrain;
- canvas state is restored;
- no input object is mutated.

Three additions carry the contracts this plan added:

**Pixel snapping and seam coverage (§5.7).** Asserting that `fillRect` received
integers proves nothing — a world integer is fractional after a fractional
translate. Both gates work on *transformed* output:

- *Device-space geometry.* The recording context tracks the CTM and reports each
  logical bound and base-body fill in device space. With the world transform
  applied through `applySnappedTranslate` at fractional camera origins (`0.5`,
  `0.37`, `-2.75`), assert adjacent logical cells abut exactly, connected body
  fills overlap by exactly one backing-store pixel on their internal edge, and
  exposed silhouette edges receive no overlap.
- *Rendered pixels.* With headless `canvas`, render two adjacent same-material
  cells over a contrasting backdrop and assert no backdrop pixel survives in the
  seam column. Repeat with two different materials that the connector treats as
  one family; deterministic row-major ownership may choose the later body's
  color, but backdrop may not survive.

Both gates run at 8px, 16px, and 32px across DPR **1, 1.25, 1.5, 1.75, 2, and
3**, plus the non-commensurate case of 9px at DPR **1.3**. A negative control
with internal body overlap disabled must fail the rendered-pixel test at the
non-commensurate case. Separately, an unsnapped fractional translation must fail
the transform-stability assertion; seam overlap is expected to prevent backdrop
bleed even when snapping is accidentally omitted, so the pixel test must not
pretend that snapping alone owns coverage.

**Rectangle exposure (§7.6).** Using the playground's own floor-and-walls
geometry, assert that:

- the wall/floor junction reports the shared interval as removed;
- isolated stair-step platforms report one full-length span per edge;
- a partial overlap leaves the uncovered remainder as a span, rather than
  clearing the edge or keeping it whole;
- two rectangles in different families do not occlude each other, and the
  default `familyId` derivation puts same-material rects in one family;
- span output is order-independent, sorted, merged, and non-overlapping;
- spans shorter than the per-rect `minimumSpan` are dropped, and `prepare`
  resolves that value from the role material's `cornerSize`;
- moving platforms neither occlude nor receive computed exposure;
- an explicit `exposure` option overrides the computed result.

**Material normalization cannot be bypassed (§7.4).** A type-level test asserts
that a structural object literal is not assignable to
`NormalizedTerrainMaterial` and that `TerrainMaterialTable` cannot be
hand-constructed. Runtime tests assert normalization is idempotent and that every
optional input field resolves to a concrete value.

Do not encode the entire visual appearance as brittle call-order snapshots.

### 14.5 Integration tests

1. `compileLevel` output is byte-identical before and after rendering integration.
2. Changing themes does not change static solids, moving platforms, tile query, or
   initial platformer state.
3. Rendering the same frame twice produces the same recording-context calls.
   **This is the blocking determinism gate** referenced by §14.6; run it on both
   validation scenes and across a camera round trip (scroll away, scroll back).
4. A moving platform is drawn at the supplied runtime rect, and moving it
   changes nothing about any static rectangle's exposure.
5. **Every resolved entity supplied to the renderer is drawn exactly once**
   across a full edit-mode frame —
   `drawTerrainRects` and `drawEntities` partition `frame.entities` with no
   overlap and no gap — asserted against a fixture containing **every**
   `EntityKind`, `trap` included. In isolated per-kind fixtures, `drawEntity`
   produces the same treatment as the responsible batch pass; no whole-frame
   output equivalence is asserted because the escape hatch owns compositing
   order (§7.8).
6. Culling entities out of `frame.entities` does not change how any remaining
   entity is drawn.
7. One `LevelThemeRenderer` prepared against two different levels yields two
   independent scenes, and preparing a second level does not disturb the first.
8. Drawing a frame whose `level` differs from the prepared level reports
   `'scene-mismatch'` once for that mismatched reference and produces zero canvas
   calls; no prepared or frame-level geometry is drawn.
9. A play-mode frame omits authored enemies when the consumer runtime owns enemy
   rendering, while an edit-mode frame includes the authored preview; the play
   pipeline draws each runtime enemy once.
10. Play mode hides trigger/spawn authoring markers by default.
11. Edit mode retains marker visibility and hit-test bounds.
12. Unknown theme IDs fall back safely once schema integration exists.

A type-level test also calls `defineEntityKindPartition` with one fixture missing
`trap` and one fixture containing `hazard` in both arrays, marking both calls with
`@ts-expect-error`. This proves that the production helper rejects omissions and
overlap rather than merely documenting the intention.

### 14.6 Visual review

Automated correctness is necessary but cannot establish visual quality. Produce:

- material sample sheet: all built-in surface details at several sizes;
- topology sheet: isolated tile, ledge, corner, tunnel, pillar, room, staircase;
- theme sheet: the same level in Ruins, Cavern, and Mechanical;
- role sheet: solid, passthrough, moving, hazard, exit, collectibles;
- scale sheet: 8px, 16px, and 32px tile sizes;
- reduced-motion stills;
- editor/play comparison.

Review questions:

1. Can the collision surface be read at a glance?
2. Are the three themes identifiable without labels?
3. Does any surface detail become noise at small scale?
4. Are the player and hazards always foreground-readable?
5. Do connected surfaces look continuous?
6. Does the background add depth without competing with gameplay?
7. Do exit and collectible silhouettes communicate their roles?
8. Are visible seams, subpixel cracks, or Canvas state leaks present?

#### What blocks a merge

`docs/conventions.md` states that visual verification is deferred to the
consumer, and this plan does not overturn that. The split:

- **Hard gate (blocking):** the §14.5 determinism assertion — rendering the same
  frame twice produces identical recording-context calls — plus the §14.4 unit
  and behavior tests. These are automated, cheap, and catch the failure modes
  that actually regress.
- **Advisory (non-blocking, but required to exist):** the contact sheets. They
  inform the reviewer; they do not mechanically fail a PR.

The sheets need tooling that does not exist today. `canvas@3` is already a
devDependency, so headless PNG output is feasible, but the generator is a real
deliverable with a real cost and is scheduled accordingly:

- script: `scripts/visual-sheets.ts`, run via an explicit npm script;
- output: `benchmarks/visual/` (gitignored except a small committed reference
  set for the three themes);
- scheduled in Phase 0 alongside the benchmark harness, because Phase 2 review
  depends on it.

## 15. Implementation phases

### Phase 0 — Baseline and API proof

**Deliverables**

- Capture the current playground frame as the comparison baseline.
- **Build the tile-room showcase scene (§9.0)** from `realizeBlueprint` output,
  with a scrolling camera and a viewport smaller than the level. This is the
  blocking prerequisite for Phases 1–2; without it the tile half of the plan has
  no consumer.
- Create topology fixtures covering the shapes in §14.6.
- **Build `scripts/visual-sheets.ts`** (headless `canvas` → PNG) and the
  benchmark harness. Phase 2 review depends on both.
- Add the throwaway contract-proof prototype in a non-public showcase/prototype
  location, scoped per §19. It ships nothing and is deleted at Phase 2.
- Render one cave material over the existing `PLAYGROUND_LEVEL` *rectangles*
  (the playground has no tiles) and over the tile room's *grid*.
- Benchmark current fallback terrain drawing, on both scenes.
- Record the current `dist` size after `npm run build:dist` (§13.4).
- Confirm the proposed theme/frame contracts against the playground, the tile
  room, a tile-authored game brief, and a rectangle-platform game brief.

**Exit criteria**

- The tile room exists, scrolls, and renders through the fallback path.
- Same geometry can render as fallback and themed cave, on both scenes.
- Collision and simulation code are untouched.
- The prototype demonstrates top caps, shaded faces, stable cracks, and a simple
  procedural background.
- A contact sheet can be generated by one command.
- API review resolves the §20 decisions, including module name, role vocabulary,
  and the callback-error policy.
- Performance and `dist` size budgets are recorded for subsequent phases.

### Phase 1 — Deterministic terrain foundation

**Files**

- `src/rng/visual-seed.ts` (+ `src/rng/index.ts` export)
- `src/primitives/color.ts` (add `isHexColor`, `safeHex`)
- `src/primitives/snap.ts` (+ `src/primitives/index.ts` export)
- `src/terrain/types.ts`
- `src/terrain/connectivity.ts`
- `src/terrain/viewport.ts`
- `src/terrain/rect-exposure.ts`
- `src/terrain/index.ts`
- corresponding unit tests

**Deliverables**

- Eight-neighbor sampling, with the §7.1 connector-error policy implemented
  (propagate; no probing; no silent substitution).
- `createTerrainConnectionTable`, so the connector never runs in a frame.
- Common connector factories.
- The world view rectangle and visible tile range (§7.2).
- Two-tier visual-seed derivation (`deriveVisualSeed`, `visualChannel`,
  `mixNumber`, `mixChannel`, `finalizeSeed`) in `rng`, with type-tagged
  components, `deriveVisualSeed` implemented as the matching fold, and the
  arity + tag-collision tests.
- Non-throwing color guards and device-pixel snapping in `primitives`.
- Span-based, family-scoped rectangle exposure over a static set, with
  per-rect `minimumSpan` (§7.6).
- Full JSDoc and barrel exports.

**Exit criteria**

- Unit-test matrix in §§14.1–14.3 passes.
- Data-side helpers never throw on malformed public inputs; consumer-callback
  errors propagate as specified.
- Culling invariance is demonstrated **against the tile room**, not asserted.
- Exposure results are provably independent of input order and of any camera
  filtering.
- No Canvas or DOM dependency exists in these foundation files (`snap.ts` takes
  DPR as a parameter and reads nothing).
- `visual-seed` has no import from `terrain`, `level`, or `platformer`.

### Phase 2 — Terrain materials and platform roles

**Files**

- `src/terrain/material.ts`
- `src/terrain/surface-detail.ts`
- `src/terrain/tile-renderer.ts`
- `src/terrain/rect-renderer.ts`
- renderer tests

**Deliverables**

- `TerrainMaterialInput` → branded `NormalizedTerrainMaterial` normalization,
   plus the opaque `createTerrainMaterialTable` (§7.4).
- `drawTerrainTiles`.
- `drawTerrainRect`, consuming span-based exposure.
- Built-in surface details.
- Ruins, Cavern, and Mechanical example materials.
- Material/topology visual sheets (using the Phase 0 script).

**Exit criteria**

- Connected terrain has no unintended internal outlines.
- Solid, passthrough, moving, and hazard roles are readable in grayscale.
- Details remain stable after camera movement, verified on the tile room.
- The playground's wall/floor junction shows no seam or internal cap, and a
  partially covered ledge keeps its uncovered cap.
- Shared-edge and rendered-pixel seam tests pass at 8px, 16px, and 32px across
  DPR 1, 1.25, 1.5, 1.75, 2, and 3, plus 9px at DPR 1.3 (§5.7, §14.4).
- A structural material literal fails to typecheck against a draw API.
- 8px, 16px, and 32px samples remain legible.
- No string hashing or allocation in the tile loop (§13.1), verified by review
  and by the allocation-sensitive benchmark fixture.
- Benchmark remains inside the Phase 0 budget.
- `dist` delta recorded against the Phase 0 baseline.

### Phase 3 — Theme facade and scene depth

**Files**

- `src/platformer/level-theme.ts`
- `src/platformer/level-layers.ts`
- platformer exports and docs
- playground integration

**Deliverables**

- `LevelRenderFrame`.
- `LevelRenderTheme`.
- Explicit layer callbacks.
- `createLevelThemeRenderer` and `prepare(level)` → `PreparedLevelScene`.
- Procedural example backgrounds using existing parallax helpers.
- `ResolvedLevelEntity` and the `drawTerrainTiles` / `drawTerrainRects` /
  `drawEntities` partition, with the draw-exactly-once test (§7.8, §14.5).
- Theme normalization per §7.8 (channel ids, material table, static exposure,
  color guards, connector validation) with a test that no draw pass parses
  colors, hashes strings, or computes exposure.
- `createTerrainConnectionTable` and `onDiagnostic` plumbing (§7.1).
- `reducedMotion` resolution from `prefersReducedMotion()` when omitted.
- Playground **and tile-room** theme switcher/comparison.

**Exit criteria**

- Same playground level renders in three clearly different themes.
- Same tile room renders in three clearly different themes.
- Procedural and raster layer callbacks both work.
- Background, world, foreground, and HUD transforms remain correctly separated,
  and the world transform is applied through `applySnappedTranslate`.
- A moving platform renders at its runtime rect and is drawn exactly once.
- Camera shake changes no visible set and no cached exposure.
- Theme renderer never advances simulation or effect state.
- Existing fallback renderer remains available and unchanged by default.

### Phase 4 — Semantic entities and atmosphere

**Files**

- `src/platformer/themed-entity-renderer.ts`
- theme entity examples
- playground play/edit integration

**Deliverables**

- Door/portal exit.
- Role-specific platforms.
- Hazard fallback silhouette.
- `trap` treatment (consumer override plus safe warning-form fallback) — it is
  in `NON_TERRAIN_KINDS` and must not be left unhandled (§7.8, §8.3).
- Coin/gem/key silhouettes.
- Moving-platform mechanical treatment.
- Play/edit visibility rules.
- Example ambient particle and glow recipes.

**Exit criteria**

- No abstract dashed exit is shown in normal play mode.
- Spawn/trigger markers remain available in edit/debug views.
- Hazard and passthrough roles are shape-readable.
- Runtime enemies remain rendered only by their authoritative runtime renderer.
- Reduced-motion treatment has a static readable state.

### Phase 5 — Editor preview, thumbnails, and optional persistence decision

**Deliverables**

- Art/collision preview toggle.
- Theme selector using consumer-supplied theme options.
- Re-preparation on structural edits: the editor calls `prepare(level)` again
  when geometry changes, and presentation-only toggles do not (§7.8).
- Thumbnail render mode.
- Theme ID fallback behavior prototype.
- Decision document on whether `LevelVisuals` belongs in the schema.

**Exit criteria**

- Editor history is unaffected by presentation-only toggles.
- Theme preview does not mutate the level unless the optional schema field has been
  explicitly approved and implemented.
- Thumbnails reproduce the same stable details at reduced scale.
- Unknown or missing themes fall back cleanly.
- Any schema change includes migration, validation, serialization, editor, and
  integration coverage.

### Phase 6 — Documentation and release gate

**Deliverables**

- Update `docs/api-surface.md`.
- Update `docs/architecture.md` with the `terrain` layer.
- Add integration examples for tile and rectangle levels.
- Update README capability table and showcase description.
- Add generated visual sheets to a benchmark/gallery directory.
- Document custom material, custom surface detail, and asset-backed layer examples.

**Exit criteria**

- Build, distribution build, engine tests, showcase typecheck, showcase tests, and
  showcase build pass.
- Public exports match API documentation.
- No new runtime dependency exists.
- `dist` delta is inside the ceiling agreed from Phase 2/4 measurements (§13.4).
- Tree-shaking smoke test confirms a `drawTerrainRect`-only import does not pull
  in the built-in themes, the tile renderer, or the surface-detail catalog.
- Final visual review accepts all three themes and the role sheet.

## 16. Pull-request boundaries

Keep changes reviewable and independently reversible. §15 (phases) and §16 (PRs)
describe **one** ordering — the list below is the phase list, cut at merge
boundaries. §19 is no longer a competing sequence: it is a throwaway Phase 0
prototype that ships nothing and is deleted at Phase 2.

1. **PR 0 (Phase 0): Tile-room scene, visual-sheet script, benchmark harness,
   baseline capture.** No engine code. Everything after depends on it.
2. **PR 1 (Phase 1): Visual addressing in `rng`, color guards in `primitives`,
   terrain topology, visible range, rect exposure**
3. **PR 2 (Phase 2): Material model, built-in surface details, tile and rect
   renderers**
4. **PR 3 (Phase 3): Theme facade, render layers, and procedural backgrounds**
5. **PR 4 (Phase 4): Semantic platformer entities and scene integration**
6. **PR 5 (Phase 5–6): Editor previews, thumbnails, documentation, schema
   decision**

Do not combine level-generation algorithms or simulation-test policy changes into
these PRs. They may consume the same `LevelData`, but their correctness and review
surfaces are different.

## 17. Risks and mitigations

### Risk: The abstraction is designed around one showcase

**Mitigation:** Validate every public contract against:

- the entity-authored playground (rect path, no camera);
- the generated tile room from §9.0 (tile path, scrolling camera) — a scene this
  plan builds, not one it hopes exists;
- a tile-authored room such as Flipside/Embertomb;
- a runtime rectangle-platform game such as Doodle Knight.

The first two ship in the showcase, so the contracts are exercised on every
`showcase:test` run rather than reviewed by inspection against game briefs.

### Risk: Themes become hard-coded game art

**Mitigation:** Keep materials palette-derived, expose custom detail callbacks, and
ship only three example families.

### Risk: Visual details obscure collision

**Mitigation:** Top surfaces and hazard silhouettes have protected contrast and
shape rules. Contact sheets include grayscale review.

### Risk: Random details pop when camera or arrays change

**Mitigation:** Coordinate/entity-addressed visual seeds are a Phase 1 prerequisite,
not an optional polish step.

### Risk: Renderer and collision disagree about tile families

**Mitigation:** Theme connectors can be constructed from the same serialized tile
semantics used by `createTileTypeMap`. Integration tests compare the configured
families.

### Risk: Tile and rectangle paths drift into two visual systems

**Mitigation:** Both use the same normalized material, `TerrainPalette`, seed
derivation, surface-detail contract, and role vocabulary.

### Risk: Canvas state leaks between passes

**Mitigation:** Explicit pass boundaries, balanced state tests, and defensive
fallbacks. Every public draw function documents caller/callee state ownership.

### Risk: Large levels become expensive

**Mitigation:** Visible range is a foundation API. Full-grid traversal is never used
by the themed hot path.

### Risk: Schema gains unstable visual data

**Mitigation:** No schema change until two consumers validate the direct theme API.
If adopted, only `themeId` and seed are serialized.

### Risk: Background art requires a second renderer architecture

**Mitigation:** All background layers use the same `LevelLayerRenderer` callback,
whether they call Canvas primitives or `drawImage`.

### Risk: Visual goldens become brittle across canvas implementations

**Mitigation:** Unit-test geometry and invariants, benchmark draw cost, and use
contact sheets for advisory human/vision review (§14.6). Pixel goldens may
supplement but do not replace these gates.

### Risk: `dist` grows out of proportion to a minimalist library

**Mitigation:** Size baseline in Phase 0, delta recorded per phase, ceiling in
the Phase 6 gate, no aggregate that defeats tree-shaking, and a bundling smoke
test rather than an assurance (§13.4).

### Risk: Subpixel seams appear only on real hardware, after merge

**Mitigation:** Snapping is an engine-supplied helper operating on the composed
device-pixel transform, not a rule about world coordinates (§5.7). Connected
internal body edges additionally overlap by one explicit backing-store pixel,
because shared geometric coordinates alone do not guarantee raster coverage.
Rendered-pixel tests include 9px tiles at DPR 1.3 as a non-commensurate case. The
playground's `sineShake` offsets make fractional transforms the default path
rather than an exotic one.

### Risk: Per-frame string hashing makes the hot path allocate

**Mitigation:** The address API is two-tier by design (§7.3), the integer fold is
the only form permitted in tile loops, and the authoring form is *defined as*
that fold, so the fast path cannot diverge from the readable one.

### Risk: Guarantees that live only in prose get bypassed

**Mitigation:** The invariants that matter are carried by types rather than by
documentation — branded `NormalizedTerrainMaterial` and opaque
`TerrainMaterialTable` make unvalidated data unrepresentable at draw time (§7.4),
and `ResolvedLevelEntity` makes "who supplies runtime rectangles" a compile
error rather than a convention (§7.7).

### Risk: Presentation state leaks into the visible set

**Mitigation:** `view` is the single authoritative world rectangle (§7.2), camera
shake and parallax are transform-only and never fold into it, exposure is
computed over a static set, and §14.5 asserts that culling changes only which
things are drawn.

## 18. Final acceptance criteria

The level-visual work is complete when:

1. The unchanged playground level **and the tile room** each render through
   fallback, Ruins, Cavern, and Mechanical treatments.
2. The three themes are identifiable without labels.
3. Tile terrain connects across edges and corners without unintended seams.
4. Entity-authored rectangles share the same material vocabulary, and abutting
   rectangles suppress the edges they share.
5. Solid, passthrough, moving, and hazard roles are readable without color.
6. Normal play mode uses a recognizable exit treatment.
7. Editor mode retains spawn, trigger, selection, path, and collision information.
8. Visual details are stable across reload, camera movement, viewport changes, and
   unrelated entity insertion.
9. Rendering does not mutate level or runtime inputs.
10. Changing only the theme leaves compiled collision and simulation state
    byte-identical.
11. The renderer touches only visible terrain plus configured overscan.
12. Canvas state is balanced after every public draw call.
13. Reduced-motion output remains readable and does not require animation.
14. Procedural and raster-backed parallax callbacks both compose with the scene.
15. Malformed optional theme data fails to a safe renderer rather than throwing.
16. No new runtime dependencies are added.
17. Public APIs are exported and documented.
18. Unit, integration, showcase, typecheck, distribution-build, and benchmark
    gates pass. Contact-sheet review is advisory (§14.6).
19. Adjacent terrain cells map their logical shared edge to the same device-space
    coordinate and apply a one-backing-pixel internal body overlap under
    fractional camera origins, at 8px, 16px, and 32px across DPR 1, 1.25, 1.5,
    1.75, 2, and 3, plus 9px at DPR 1.3 — with no backdrop bleed-through.
20. No draw pass hashes strings, parses colors, computes exposure, allocates
    rest arguments, or invokes a consumer connector; all of it happens once in
    `createLevelThemeRenderer` or `prepare(level)`.
21. Unvalidated material data and unresolved entity rectangles are
    unrepresentable at draw time, enforced by types rather than documentation.
22. Every resolved entity supplied in `frame.entities` is drawn exactly once per
    frame, and play-mode consumers do not also pass enemies owned by their
    runtime renderer.
23. `dist` growth is inside the agreed ceiling, and importing one terrain
    function does not pull in the built-in theme families.

## 19. Phase 0 contract-proof prototype

This is a **throwaway prototype, not the first increment of shipped code.** It
exists only to put the §7 contracts under load before they are frozen, and it is
deliberately not sequenced against §16 — an earlier draft presented it as a
"first slice" that combined Phase 1–4 work while excluding an API that PR 1
contains, which made it impossible to reconcile with the phase plan at all.

Rules that make it disposable rather than contradictory:

- It lives in the showcase prototype location named in Phase 0, never in `src/`.
- Nothing in it is exported from any barrel or documented as public API.
- It is deleted when Phase 2 lands; no code is promoted from it, only findings.
- It may cut every corner the real implementation may not — inline constants,
  no normalization, no tests beyond a smoke render.

Scope, on the entity-authored playground only:

1. Sketch visual addressing, one warm cave material, and rect drawing for solid,
   passthrough, moving, and hazard roles.
2. Sketch span-based exposure against the floor-and-walls geometry.
3. Add one procedural far background and one foreground silhouette callback.
4. Draw the playground's play-mode platforms and exit through the sketch.
5. Apply a snapped shake transform and look hard at the wall/floor junction.
6. Add an Art/Fallback comparison control and capture the same frame in both.
7. Confirm collision traces and compiled level output are unchanged.
8. Review visual hierarchy and rough draw cost.

Deliberately out of scope: `visibleTileRange` and tile topology. The playground
has neither a camera nor tiles, so exercising them here would prove nothing.
They are proved against the tile room, in Phase 1, where PR 1 delivers them.

**What Phase 0 must produce is answers, not code:** whether the frame contract
carries what a real scene needs, whether span exposure reads correctly at the
room boundary, whether the role geometry is legible, and whether the §20
decisions still look right. Phase 1 then starts from a clean slate.

## 20. Decisions to confirm before Phase 1

1. **Module name:** approve `src/terrain/`, or choose `src/level-render/`.
   Recommendation: `terrain`, because topology and materials can serve
   platformers, top-down games, and runtime solids without owning a complete level.
2. **Initial built-ins:** approve Ruins, Cavern, and Mechanical.
3. **Role vocabulary:** approve platformer role words (`solid`, `passthrough`,
   `moving`, `hazard`) inside `terrain`, accepting the type-level coupling
   documented in §6.3, rather than a parallel visual vocabulary.
4. **Theme persistence:** confirm that the first release passes themes directly and
   defers `LevelData.visuals`.
5. **Editor default:** confirm collision preview remains the default in Edit mode,
   with art preview opt-in.
6. **Background baseline:** confirm the built-in examples remain procedural, while
   image callbacks are documented and tested.
7. **Callback-error policy:** confirm the split in §7.1 — consumer callbacks that
   classify or compute (connectors) propagate, matching `src/level/tiles.ts`;
   callbacks that only draw (detail renderers) are guarded at tile/entity
   granularity, matching `drawTileGrid`. Confirm also that the connector is
   resolved into a connection table at preparation time, so it is never invoked
   during a frame — this is what makes "no per-neighbor `try`/`catch`"
   structural rather than a rule in tension with a fallback mode. Behavioral
   probing is not attempted, and there is no per-frame degrade path.
8. **Color guards in `primitives`:** confirm `isHexColor` / `safeHex` are added to
   `src/primitives/color.ts` rather than kept private to `terrain`, given that
   `parseHex` throws by design and theme data can arrive from level files.
9. **Seed location:** confirm visual-address derivation ships from `src/rng/`
   beside `mulberry32`, with the two-tier API in §7.3.
10. **Validation scenes:** confirm the generated tile room (§9.0) is a Phase 0
    deliverable, and that the playground alone is not accepted as validation for
    the tile half of this plan.
11. **Size budget:** confirm `dist` growth is a tracked Phase 6 gate (§13.4).
12. **Visual review:** confirm contact-sheet review is **advisory**, with the
    §14.5 determinism assertion as the blocking automated gate — consistent with
    `docs/conventions.md` deferring visual verification to the consumer.
13. **Exposure model:** confirm exposure is span-based, family-scoped, and
    computed once over the level's static terrain set (§7.6). A boolean per edge
    cannot express partial coverage, and computing over visible rectangles would
    make a rect's appearance depend on the camera (§11.3).
14. **Frame ownership:** confirm the consumer supplies
    `LevelRenderFrame.entities` as `ResolvedLevelEntity[]`, that terrain and
    non-terrain kinds are partitioned across two passes, and that the renderer
    never derives its draw list from `level.entities`. In play mode, an authored
    enemy omitted because a runtime renderer owns it is not part of the themed
    frame (§7.7, §7.8).
15. **Branded normalization:** confirm draw APIs accept only
    `NormalizedTerrainMaterial` and the opaque `TerrainMaterialTable`, so the
    "validate once" guarantee is enforced by the type system rather than by
    documentation (§7.4). The alternative — a structural type plus a convention —
    was rejected as unenforceable.
16. **Snapping helper:** confirm the engine ships
    `snapCameraTranslation` / `applySnappedTranslate` in `primitives`, and that
    the snapping gate is a rendered-pixel seam test rather than an assertion
    about draw-call arguments (§5.7).
17. **One view rectangle:** confirm `LevelRenderFrame.view` is the single
    authoritative world-space rectangle, `camera` is removed, and shake and other
    transform-only offsets never fold into culling (§7.2).
18. **Two-step creation:** confirm the split into `createLevelThemeRenderer`
    (theme-derived) and `prepare(level)` → `PreparedLevelScene` (level-derived),
    with draw passes living on the scene (§7.8). The alternative — passing
    `LevelData` into the factory — was rejected because it forces a full
    re-normalization whenever the level changes.
19. **Family derivation:** confirm `familyId` defaults to the role material's
    `channelId`, with a `rectFamilyFor` override on the theme (§7.6).
20. **Sliver threshold:** confirm `minimumSpan` is per-rect input data resolved
    by `prepare` from the material's `cornerSize`, rather than a material lookup
    inside `computeRectExposures` or a per-frame filter in `drawTerrainRect`
    (§7.6).
21. **Tagged components:** confirm every seed component is type-tagged, so a
    string part and the integer `visualChannel` maps it to cannot collide, and
    that the hot-path API is `mixNumber` / `mixChannel` rather than one untagged
    fold (§7.3).
22. **Snapping and coverage guarantees:** confirm shared logical edges map to the
    same device coordinate, while connected body fills overlap by one backing
    pixel because geometric coincidence alone does not guarantee raster
    coverage; confirm the matrix includes 1.25, 1.5, 1.75, and the
    non-commensurate 9px-at-1.3 case (§5.7).
23. **Partition exhaustiveness:** confirm `TERRAIN_ROLE_KINDS` and
    `NON_TERRAIN_KINDS` are checked with real compile-time assertions for both
    omissions and overlap, so a kind such as `trap` cannot go unhandled or be
    drawn twice (§7.8).

The recommended answer to all twenty-three is the option stated above. Together they
produce a small, deterministic foundation that improves the engine immediately
and leaves room for game-specific visual identity.
