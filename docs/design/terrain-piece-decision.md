# Decision: Terrain Piece

> **Decision record** for the capped-end terrain rendering primitive. Locks the API shape chosen for implementation and records the rulings on open questions.
>
> Slug: `terrain-piece`. Date: 2026-08-24.
>
> **Inputs:** `.opencode/plans/terrain-piece-engine-plan.md` · consumer spec (Phase T, tasks TE.1–TE.3) · the prototype's 69 tests, now shipped as `src/tests/terrain-piece-*.test.ts` · showcase section `#terrain-piece`.

## The technique

A terrain fragment that renders as a **finished object** rather than a sliced rectangle. When a platform splits — a pit opening, a ledge crumbling — the newly-exposed ends must resolve to end-cap tiles rather than showing the raw cross-section of a filled rect.

"Capping the ends" reduces to one choice about how a boundary cell samples its neighbours:

- **Bonded** — sample the *global* terrain field, including cells outside the piece. A closed pit's edge cells see the floor next door, resolve to interior tiles, and the seam disappears.
- **Free** — sample only within the piece. Boundary cells resolve to end caps.

A closed pit is bonded; an opening pit's halves are free. The flip needs no new state machine: the consumer's solid-geometry function already returns one full-width solid when closed and two halves when open, so the cap transition rides that existing boundary and caps can never appear on a frame where no gap exists.

## The duplication this exists to prevent

Two consumers need this, with different motion. One needs capped ends on opening hidden pits (rigid pair, translated by an offset); the other needs crumbling terrain (N debris chunks under independent gravity and scatter). Both are the same *geometry projection* problem wearing different motion.

There is direct precedent. `src/collision/moving-gap.ts` — "a traveling absence of floor" — exists because a consumer's hand-rolled version coupled motion and geometry and shipped a bug. The engine already owns the **collision** half of "a hole in a platform." This is the **rendering** half, and the same separation applies: the caller owns the tick loop and the transform, the module owns the geometry projection.

## The chosen abstraction

**Bake → capped canvas; the caller supplies the transform.** A piece resolves to per-cell rule indices, bakes once to an offscreen canvas, and is drawn by the caller under whatever transform it likes. One consumer passes a slide offset; the other passes per-chunk gravity and rotation. Same primitive.

Shrinking motion is **reframed as rigid**: bake the capped piece once at full size, then clip at the anchored edge. This removes the only case that would otherwise require per-frame re-tiling. The clip has two readings, and both ship (rulings 12–13): with a draw offset the piece *translates* and reads as sliding into a wall; without one the texture stays pinned and the end is *eroded* in place, with an optional cap strip riding the cut.

## Locked API (for `src/terrain-art/piece.ts`)

**Types:** `TerrainPieceBondPolicy` (`'bonded' | 'free'`), `TerrainPiece` (`id`, `cells`, `originCol`, `originRow`, `bondPolicy`), `RectLike`, `RectsToTileGridResult`, `BakeTerrainPieceOptions`, `BakedTerrainPiece`, `TerrainPieceCache`, `TerrainPieceAnchor`.

**Functions:** `rectsToTileGrid(rects, tileSize, bounds, tileValue?)`, `resolveTerrainPieceFromPrepared(piece, preparedField)` *(primary)*, `resolveTerrainPiece(piece, kinds, ruleSet, field?)` *(convenience)*, `bakeTerrainPiece(prepared, options)`, `createTerrainPieceCache(options?)`, `drawClippedTerrainPiece(ctx, baked, anchor, visibleExtent, x, y)`, `drawMaskedTerrainPiece(ctx, baked, anchor, visibleExtent, x, y, cap?)`.

**Location:** `src/terrain-art/piece.ts`, re-exported from `src/terrain-art/index.ts`.

## Rulings on open questions

1. **Placement: `src/terrain-art/`, not `src/collision/` — overriding the consumer spec.** The spec asked for a new module beside `moving-gap.ts`, on the reasoning that the collision and rendering halves of "a hole in a platform" belong together. Rejected on dependency direction: `src/collision/` today has **zero imports from outside itself and zero canvas references**, while all three of this primitive's dependencies (`prepareTerrainArtRuleGrid`, `buildTerrainArtRuleAtlas`, `drawPreparedTerrainArtRuleGrid`) live in `terrain-art/`, and the bake needs Canvas2D. The spec's concern is discoverability, which a `@see` cross-reference in both files solves without inverting the dependency.

2. **Never-throw, not throw-on-`NaN` — deliberately diverging from `moving-gap` ruling 1.** The sibling throws on `NaN` ("programmer error, cannot arise from valid simulation state"). This primitive degrades instead: invalid input returns an empty grid or empty prepared result. Rationale: it now lives in `terrain-art/`, whose entire surface is never-throw, and it wraps `prepareTerrainArtRuleGrid`, which already returns an empty grid on bad input. Consistency *within* the module beats consistency with the sibling — and unlike a geometry helper, a renderer that throws produces a blank screen rather than a visible imperfection.

3. **Bond policy: uniform, no per-edge in v1.** All four known consumer cases are uniform across edges. `retractOneWay` appears to need a mixed piece, but the clip helper plus the draw-order rule (moving pieces first, static terrain on top) means the anchored edge is covered and its tiling is never visible. Typed as a **string union rather than a boolean** so it widens to a per-edge form later without breaking callers.

4. **Field preparation is hoisted to the caller.** `resolveTerrainPieceFromPrepared` is the primary API. *Prototype finding:* the natural single-piece signature re-resolves the entire global field once per piece — N full-field resolutions for N pieces, on every topology change. The convenience form is retained for the genuine single-piece case.

5. **Ownership masking is mandatory.** Cells inside a piece's bounding box that the piece does not own resolve to `-1`, whatever the global field holds there. *Prototype finding:* without this, a bonded non-rectangular piece (L-shaped ledge, crumble chunk) renders its neighbours' tiles and drags them along when it moves.

6. **Bonded windows are re-based to piece-local coordinates.** The bake draws each cell at `col * tileSize`, so a window carrying global col/row would bake at its world offset inside its own canvas.

7. **`tileValue: 0` falls back to `1`.** *Prototype finding:* `0` is the empty convention, so a caller passing it would produce a grid that claims to be solid but reads as air everywhere.

8. **Rasterizer coverage rule: cell-center.** A cell is solid iff some rect covers its center. Exact for grid-aligned input; stable and deterministic otherwise. *Any-overlap* over-covers (a 1px intrusion claims a whole cell, growing terrain past its collision box); *full-coverage* under-covers (a half-cell ledge vanishes).

9. **`unalignedRects` and `skippedRects` are first-class returns, kept as separate counters.** One consumer lints its levels to the cell grid; the other has no such guarantee, and under the center rule a rect thinner than half a cell renders nothing. Collapsing both counters would make a `NaN` rect indistinguishable from a merely-misaligned one.

10. **No reliance on `flipX` mirroring.** `TerrainArtRuleAtlasEntry.mirroredX` exists but `buildTerrainArtRuleAtlas` always writes `false` ("left for the resolver to set when it picks a mirror") and no resolver sets it. Both end caps are authored in the sheet rather than depending on that unbuilt path.

11. **Cache invalidation is by topology fingerprint, not caller discipline.** `createLdtkLevelSurfaceCache` keys on level iid and asks the consumer to `drop`/`clear` after edits — right for levels, which change at authoring time. A terrain piece flips bonded→free at the exact frame a pit opens, every time it opens, and a missed `drop` renders caps on a still-closed pit: the "capped but still closed pop" this work exists to prevent. The cache therefore stores an `fnv1aHash` of `(cols, rows, tileSize, ruleIndex[])` and rebakes when it changes, making the invariant true by construction — the same philosophy that put the clamp inside `gapSolids` rather than in each motion mode. Reference identity is checked first, so a stable prepared object costs nothing. Piece **position** is excluded from the fingerprint: moving a piece must never rebake it. `drop`/`clear` are retained for explicit control, and `bakeCount()` is exposed so the invariant stays observable to consumers.

12. **Shrinking splits into two helpers, because it is two different readings.** `drawClippedTerrainPiece` offsets the draw so the piece *translates* — it reads as sliding into a wall, and the surviving art is the piece's far portion. `drawMaskedTerrainPiece` applies the same clip with **no offset**, so the texture stays pinned to the ground and the end is *eroded* in place. Ground being eaten away and ground retreating are not the same event; crumbling terrain wants the second, a retracting ledge the first. One offset separates them, and both are one bake.

13. **The end cap on an eroding cut is an optional overlay, not baked into the body.** A body's own cap sits at its *original* end, so a mask eats it first and leaves the raw cross-section. Passing `cap` to `drawMaskedTerrainPiece` draws a one-tile strip — baked once — at the moving boundary, inside the same clip so it trims rather than spills. **Defaults off.** Reviewing the showcase, the un-capped cut was the preferred look for erosion: a bevelled cap reads as *finished*, while a raw cut reads as *freshly broken*, which is what ground being eaten away actually is. The cap is therefore for cases that want a deliberate manufactured edge — a sliding ledge that always had an end — not for fracture. Also correct un-capped when the cut is covered by something else. Two bakes, both once, for any number of frames; still no re-tiling.

14. **An eroding piece is bonded, not free.** It never moves, so its outer end stays welded to the neighbouring floor — a free piece would cap that end and paint a bright seam across ground meant to read as continuous. Every bit of end treatment comes from the cap overlay instead. This does **not** reopen ruling 3: the erode case is uniform like the other four, so a per-edge policy is still unnecessary. It does mean bond policy is chosen by *motion family*, not once per piece — the same geometry needs `bonded` when eroding and `free` when sliding.

15. **`x`/`y` address the full-size footprint, not the visible window.** A retracting piece's position argument does not change as it shrinks; the caller varies only `visibleExtent`. The clip rect and the draw offset both derive from a single `hidden = full - extent`, so they cannot disagree.

16. **Variants deferred.** The rule-grid path resolves one atlas entry per rule with no variant axis; variants live in the rejected dual-grid path. `TerrainPiece.id` is reserved as the determinism seed root so per-cell variants can be added without an API break.

## Invariants the test suite must lock

- **The acceptance case:** an isolated 1×3 strip resolves free → `left-end/middle/right-end`; the same strip bonded against neighbouring floor → `middle/middle/middle`.
- Free resolution is byte-identical to calling `prepareTerrainArtRuleGrid` on the piece grid — the primitive adds no resolution logic of its own.
- A bonded piece at the field edge still caps the exposed face.
- Unowned cells in a piece's bounding box resolve to `-1`.
- A bonded piece with a missing or unusable field degrades to free rather than throwing.
- `rectsToTileGrid` is idempotent under overlapping rects, and empty/`NaN`/negative-extent/zero-`tileSize` input yields an empty grid.
- Bake determinism: the same piece baked twice yields byte-identical `ImageData`; bake count is once per topology change, not per frame.
- Clip: visible extent matches the caller-supplied width at every step, for all four anchors.

## Determinism contract

Same `(piece, kinds, ruleSet, field)` → byte-identical `PreparedTerrainArtRuleGrid`, forever. Same `(prepared, atlas, image)` → byte-identical `ImageData`. No `Math.random`, no `Date.now()`, no DOM reads, no global mutable state. Canvas acquisition follows the ladder in `src/ldtk/surface.ts` — consumer factory, then `OffscreenCanvas`, then `document.createElement`, with `undefined` disabling caching rather than failing the draw.

## Out of scope for this work

- **Per-edge bond policy.** Deferred; the string union widens non-breakingly.
- **Per-cell variant selection.** See ruling 11.
- **The crumble/shatter state machine.** The primitive must *support* crumble — chunks are free pieces with independent transforms — but the debris recipe stays with the consumer. Whether it is later shared is a separate decision, made once both consumers' needs are visible.
- **Any collision change.** This is render-only; the collision half stays with `moving-gap.ts`.
- **Procedural tile generation, and `.ldtk` project files.** Authored sheets only; only the *rule model* is borrowed from LDtk.
- **Continuously-sliding pits.** A gap centre that moves every frame genuinely mutates the tile field per frame — the one case the rigid reframe does not rescue.

## Cross-references

- Plan: `.opencode/plans/terrain-piece-engine-plan.md`
- Prototype tests: shipped as `src/tests/terrain-piece-{resolve,bake,clip,rects-to-grid}.test.ts` (the `showcase/_prototype/` scratch was transplanted, not kept)
- Sibling primitive: `src/collision/moving-gap.ts` — the collision half of the same problem (`docs/design/moving-gap-decision.md`)
- Composes with: `src/terrain-art/rule-grid.ts`, `src/terrain-art/rule-atlas.ts`, `src/terrain-art/runtime-renderer.ts`, `src/terrain-art/import-tileset.ts`
