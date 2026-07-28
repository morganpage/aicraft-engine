# Level Visual Rendering — Phase 0 Record

> Status: COMPLETE
> Date: 2026-07-28
> Scope: showcase validation scenes, disposable prototype, visual-sheet tooling,
> and render baselines only. No public engine API was added.

Companion to [`level-visual-rendering-plan.md`](./level-visual-rendering-plan.md).
This is the artifact §19 asks for: **"What Phase 0 must produce is answers, not
code."** The code in PR 0 is scaffolding for the answers; the answers are §4–§6.

## Outcome

Phase 0 proves that one frame contract can render both level-authoring paths:

- a deterministic 60×34 room from `generateLevel(1337, ...)`;
- a hand-authored 60×34 topology room containing an isolated cell, ledge,
  corner, tunnel, pillar, enclosed room, staircase, passthrough, hazard, and
  runtime moving platform;
- the current flat fallback treatment;
- one disposable cave-material treatment over both tiles and rectangles.

The scene uses a 600×400 viewport over a 960×544 world, so camera movement and
culling-sensitive visual addressing have a real consumer before any public
terrain API is approved.

## 1. Phase 0 artifacts

No engine code. `src/` is untouched.

| Artifact | Location |
|---|---|
| Live validation scene (playable, follow camera) | `showcase/sections/tile-room.ts` |
| Shared DOM-free frame composition | `showcase/sections/tile-room-render.ts` |
| Generated + topology + §14.6 fixtures | `showcase/sections/tile-room-fixtures.ts` |
| Disposable cave prototype (§19) | `showcase/_prototype/cave-material.ts` |
| Contact-sheet generator | `benchmarks/_scripts/visual-sheets.ts` |
| Benchmark harness (§13.3) | `benchmarks/_scripts/level-visual-bench.ts` |
| Sheets, timings, stable review reference | `benchmarks/visual/` (see its README) |
| Tests | `showcase/tests/tile-room-fixtures.test.ts`, `showcase/tests/tile-room-render.test.ts` |

```bash
npm run visual:sheets
```

```bash
npm run bench:level-visual
```

One engine-adjacent edit: `PLAYGROUND_LEVEL` in `showcase/sections/playground.ts`
is now exported, so the baseline captures render *that* level rather than a
hand-copied lookalike that could drift from it.

### Deviations from the plan text

1. **Script location.** §14.6 names `scripts/visual-sheets.ts`. This repository
   has no `scripts/` directory, and `benchmarks/README.md` requires every
   committed PNG to be reproducible from a script in `benchmarks/_scripts/`. The
   generator lives there instead of opening a second home for render scripts.
2. **The §19 prototype does not add a live control to the playground.**
   §19 item 6 asks for an Art/Fallback comparison control on the playground.
   `playground.ts` is 2400 lines with a dense render dispatch, and wiring
   throwaway code into it makes the Phase 2 deletion risky — the one property
   §19 insists on. Instead the live toggle lives in the tile room (new code,
   deleted cleanly), and the playground is driven through the prototype
   *headlessly*, including under the fractional `sineShake` offset §19 item 5
   asks about. `treatment-compare.png` and `snapping-junction.png` are the
   resulting artifacts; both show the playground itself, not a substitute.

## 2. Baselines

### 2.1 `dist` size (§13.4)

Recorded after `npm run build:dist` on a clean `dist/`, Node v24.3.0.

| Measure | Bytes |
|---|---|
| `dist` total | 1,662,368 |
| — `.js` | 973,436 |
| — `.d.ts` | 688,932 |
| Files in `dist` | 394 |
| `npm pack` unpacked | 1,678,612 |
| `npm pack` tarball | 507,715 |

This is the number the Phase 6 ceiling is set against. Note that `.d.ts` is 41%
of `dist`: a terrain module with a large public type surface moves this number
without shipping a byte of runtime, so the Phase 2 and Phase 4 deltas should be
recorded as `.js` and `.d.ts` **separately** rather than as one total.

### 2.2 Draw cost (§13.3)

`npm run bench:level-visual` — Apple M1, Node v24.3.0, 30 warmup + 120 measured
frames per cell, camera panning across the level so the world transform is
fractional and the visible region keeps changing.

| §13.3 | Fixture | Viewport | Fallback median | Fallback p95 | Cave median | Cave p95 |
|---|---|---|---|---|---|---|
| 1 | `playground-rects` | 600×400 | 0.037 ms | 0.046 ms | 0.066 ms | 0.072 ms |
| 2 | `tile-room-generated-60x34` | 600×400 | 0.141 ms | 0.159 ms | 0.118 ms | 0.137 ms |
| 2 | `tile-room-topology-60x34` | 600×400 | 0.540 ms | 0.596 ms | 0.474 ms | 0.508 ms |
| 3 | `large-tile-level-200x34` | 600×400 | 0.469 ms | 1.072 ms | 0.119 ms | 0.153 ms |
| 4 | `dense-worst-case-60x34` | 600×400 | 2.250 ms | 2.425 ms | 0.837 ms | 0.921 ms |
| 5 | `parallax-plus-terrain` | 600×400 | 0.534 ms | 0.578 ms | 1.373 ms | 3.219 ms |
| 6 | `thumbnail-160x107` | 160×107 | 0.528 ms | 0.584 ms | 0.482 ms | 0.517 ms |

The cave column is a **sighting shot, not a target**: it is unoptimised
throwaway code, and it does less work than the finished renderer will (no
normalization, no connection table, one material). Its value is in the ratios,
discussed in §3.

All five sheets were byte-identical across two complete renders. Raw data,
including the host: `benchmarks/visual/level-visual-bench.json` and
`benchmarks/visual/phase0-baseline.json`. These are local development
baselines, not cross-machine performance promises; future phases compare deltas
under the same command on the same machine.

## 3. Measured findings

### F1 — The generator does not currently emit tile topology

§9.0 assumes the generated room supplies the tile shapes the renderer must
handle. It does not. `generateLevel(1337, { cols: 60, rows: 34 })` produces
**115 solid cells out of 2040** — a two-row ground strip with gaps and two
single-tile platforms. Rows 0–29 are entirely empty; raising `rows` adds empty
sky, not vertical structure.

So connectivity, corner joins, tunnels, pillars, and enclosed rooms have **no
generated consumer**. PR 0 therefore ships two tile scenes: the generated room
(kept, because §9.0 is right that the generator's actual output is what must
survive) and a hand-authored topology room carrying every §14.6 shape.

This is a finding about the *generator*, not the renderer, and §16 forbids
combining level-generation work into these PRs — it should be filed separately.
What matters here: **§9.0's premise that the tile room supplies topology is
false today**, and Phase 1's connectivity tests must target the topology fixture.

### F2 — `prepare(level)`-only exposure does not serve a runtime-terrain consumer

§7.6 and §20.13 specify exposure as computed once, in `prepare(level)`, over the
level's static terrain set. Checked against the four consumers §17 names:

| Consumer | Terrain source | Does `prepare(level)` fit? |
|---|---|---|
| Playground | authored `LevelEntity` rects | Yes |
| Tile room | generated tile grid + 6 entities | Yes |
| Flipside (`games/flipside.md`) | ASCII → `LevelData` tiles, 40×30 at 8px, per room | Yes |
| Doodle Knight (`games/doodle-knight.md`) | **runtime-spawned `Solid[]`; explicitly no `LevelData`, no `compileLevel`, no tile grid** | **No** |

Doodle Knight is the plan's own nominated rectangle-platform validation case and
has no `LevelData` to prepare from. Its platforms spawn and despawn continuously
as the camera climbs, so there is no static set to compute over.

**Recommended amendment:** keep `prepare(level)` as the convenient path, but
require `computeRectExposures` to be a public data helper callable over *any*
rect set, and require `drawTerrainRect` to accept an exposure result directly
rather than only a `PreparedLevelScene`. Restate the §13.1 rule as "the themed
*level* path never computes exposure per frame" — for a consumer with 5–20 live
platforms, per-frame computation is trivially cheap and is the only option.

This does not change the answer to §20.13. It amends §20.18: the two-step split
is right, but `drawTerrainRect` must not be reachable *only* through it.

### F3 — Constant cap and face thicknesses do not survive the scale sheet

The prototype uses `CAP_HEIGHT = 3` and `FACE_WIDTH = 2` world px. On
`scale-sheet.png`:

- at **8px** tiles the cap is 37% of the tile — terrain reads as a stack of lit
  bars rather than as rock;
- at **32px** it is 9% — the cap reads as a hairline and the "this is the
  surface you land on" signal weakens badly.

Flipside is an 8px game and Doodle Knight's platforms are chunky, so both ends
of the range are real. Phase 2's material model must derive cap and face
thickness from `tileSize` (or from the material's `cornerSize`, which §20.20
already establishes as the per-material scale knob), never from a constant.

### F4 — Procedural background is the most expensive thing in the frame

Fixture 5 versus fixture 2 (`tile-room-topology-60x34`) — same scene, layers on
versus off: **0.474 → 1.373 ms median, and 0.508 → 3.219 ms p95.** Two
background bands and one foreground silhouette cost roughly twice the terrain
they sit behind, and their p95 is 6× the terrain's.

The cause is visible in the prototype: each band walks the viewport in 24px
steps building a fresh polygon every frame. §13.1 budgets background work as
`O(layer count × copies covering viewport)` and says nothing about per-frame
path construction.

Phase 3 must give the example backgrounds a coarser step, cache silhouette
geometry per camera band, or explicitly document that procedural backgrounds are
the consumer's cost centre. Whichever it is: **the Phase 2 budget must be set on
terrain-only fixtures**, or background noise swamps the signal.

### F5 — Fallback cost is dominated by per-cell stroking and full-grid traversal

Two independent effects, both in the table:

- **Full-grid traversal (fixture 3).** The fallback's median more than triples
  from the 60×34 room to the 200×34 level (0.141 → 0.469 ms) though the
  *visible* area is unchanged, with p95 reaching 1.072 ms. The prototype, which
  iterates only the visible range plus one cell of overscan, is flat
  (0.118 → 0.119 ms). §13.1's "visible range is a foundation API" is not a
  stylistic preference — it is 4× at 200 columns, and it grows linearly.
- **Per-cell stroke (fixture 4).** On a fully solid grid the fallback costs
  2.250 ms against the prototype's 0.837 ms. Suppressing internal edges is a
  correctness requirement (§14.6 review question 5) that happens to be 2.7×
  faster.

### F6 — The wall/floor junction: exposure works, and the fallback's seam is real

`snapping-junction.png`, rendered into real device-pixel backing stores at DPR
1, 1.25, 1.5, and 2 under a fractional `sineShake` offset, magnified 5× with
smoothing off.

- **Fallback:** the playground's left wall (`y 0..368`) and floor (`y 368..400`)
  share an edge and `outlineRect` outlines both — a dark band across the
  junction at every DPR, its thickness varying by DPR. Exactly the "unintended
  internal outline" §14.6 and acceptance criterion 3 target.
- **Cave prototype:** clean at all four ratios. The wall body flows into the
  floor body, and the floor's lit cap begins only where the floor is actually
  uncovered — span-based exposure producing the right answer on the scene the
  plan says it must.

The one-backing-pixel body overlap (`BODY_OVERLAP = 1`) was load-bearing: shared
geometric coordinates alone left hairline gaps at DPR 1.25 and 1.5. §5.7's claim
that geometric coincidence does not guarantee raster coverage is confirmed, not
assumed. Note also the *method*: passing a DPR number into a 1× canvas would
have exercised only the snapping arithmetic. A seam is a rasterisation outcome,
which is why §20.16's rendered-pixel gate is the right gate.

### F7 — Terrain without an outer silhouette reads soft

On `topology-sheet.png` the fallback's per-cell outline is noise *inside* a body
but does real work at the body's *edge*: it separates terrain from the backdrop.
The prototype draws no outline at all, and its masses have a weak silhouette
against a dark backdrop — most visible on the `isolated` and `pillar` cells.

Phase 2's materials need an explicit outer-silhouette treatment (an outline on
exposed edges only, or a rim-darkened face). "Suppress internal outlines" must
not be implemented as "suppress outlines".

### F8 — Background value separation needs a rule, not a hex value

On `treatment-compare.png` the prototype's mid background band sits close in
value to the terrain body, and the topology room's silhouette competes with it
(review question 6). Recorded rather than tuned: the prototype is throwaway, and
the answer for Phase 3 is a *rule* — background layers must hold a documented
minimum value separation from the terrain body, in the spirit of §12.2's
contrast rule — not a hand-picked colour.

### F9 — The frame contract carried what the scene needed, minus one field

The Phase 0 frame is §7.7's `LevelRenderFrame` minus the parts Phases 1–3
deliver. Driving a live playable scene through it surfaced exactly one missing
capability: composing terrain **without** the background and foreground layers.
The sheets need it — atmosphere is precisely what must not be in frame when
judging whether connected surfaces read continuous — and it is not a rendering
mode but layer composition, which §5.4 already says is the consumer's to
arrange. Phase 3's `LevelRenderTheme` should treat every layer callback as
independently omittable, and imply none.

Nothing else was missing. `view` as the single authoritative world rectangle
(§20.17) held: the tile room's camera lerp, the clamped static sheet framing,
and the panning benchmark all express themselves as a `view` and nothing else.

### F10 — The implicit exposure cache argues for an explicit `prepare`

The prototype caches exposure in a `WeakMap` keyed on the `LevelData` object,
because it has no preparation step. It works, and it is *bad*: nothing tells a
consumer when it is invalidated, nothing tells them it exists, and an editor
producing a new level object per edit silently recomputes. First-hand support
for §20.18's two-step split — with the F2 amendment.

## 4. Contract findings (qualitative)

1. **Module name:** `src/terrain/` remains the clearest home for topology,
   materials, and drawing. Platformer-specific composition stays in
   `src/platformer/`.
2. **Two-step creation is justified** — see F10.
3. **One frame rectangle is sufficient** — see F9.
4. **Runtime entity rectangles must be consumer-resolved:** the moving platform
   is substituted before partitioning and drawing. Authored and runtime
   positions cannot safely be conflated.
5. **The role vocabulary is adequate for v1:** `solid`, `passthrough`, `moving`,
   and `hazard` produced visibly distinct prototype treatments with no gaps.
6. **Stable visual addressing must ship below terrain:** coordinate-addressed
   cracks stay put while camera framing changes — asserted by the
   culling-invariance test, not just observed. The final mixer belongs in
   `src/rng/`.
7. **Device-pixel snapping belongs in primitives:** it composes the camera and
   DPR transform and is not terrain-specific.
8. **Procedural layer callbacks are sufficient:** backdrop, far background,
   world, and foreground passes compose without a second renderer architecture —
   at a cost (F4).
9. **The generated room is necessary but insufficient** — see F1.
10. **Fallback must remain available:** it is clearer for collision/debug
    inspection and is the correct default until the public themed renderer
    completes automated and visual review.

## 5. §20 decisions

Every decision confirmed as recommended, with two amendments.

| # | Decision | Status |
|---|---|---|
| 1 | Module name `src/terrain/` | Confirmed |
| 2 | Ruins, Cavern, Mechanical built-ins | Confirmed |
| 3 | Platformer role vocabulary inside `terrain` | Confirmed |
| 4 | Themes passed directly; defer `LevelData.visuals` | Confirmed |
| 5 | Collision preview default in Edit | Confirmed |
| 6 | Procedural background baseline | Confirmed — see **F4** (cost) and **F8** (value separation) |
| 7 | Callback-error policy | Confirmed; untested in Phase 0 (the prototype has no consumer callbacks) |
| 8 | `isHexColor` / `safeHex` in `primitives` | Confirmed |
| 9 | Visual-address derivation in `src/rng/` | Confirmed — the integer fold carried every tile-loop detail decision with no string work |
| 10 | Generated tile room is a Phase 0 deliverable | Confirmed, **amended by F1**: a topology fixture is required alongside it |
| 11 | `dist` growth tracked at Phase 6 | Confirmed — baseline in §2.1; record `.js` and `.d.ts` separately |
| 12 | Sheets advisory, determinism blocking | Confirmed and implemented — the generator self-checks and exits non-zero on a mismatch |
| 13 | Exposure span-based and family-scoped | Confirmed — partial coverage at the junction is expressible and correct (**F6**) |
| 14 | Consumer supplies `frame.entities`; two-pass partition | Confirmed — partition is total and disjoint, asserted in tests |
| 15 | Branded normalization | Confirmed; untested in Phase 0 (the prototype deliberately skips normalization) |
| 16 | Snapping helper in `primitives`; rendered-pixel gate | Confirmed — **F6**; the rendered-pixel method is what made the seam visible |
| 17 | `view` is the single world rectangle | Confirmed — **F9** |
| 18 | Two-step `createLevelThemeRenderer` + `prepare(level)` | Confirmed, **amended by F2**: `drawTerrainRect` and `computeRectExposures` must be usable without a `PreparedLevelScene` |
| 19 | `familyId` defaults to the role material's `channelId` | Confirmed |
| 20 | `minimumSpan` resolved by `prepare` from `cornerSize` | Confirmed — `cornerSize` should also drive cap/face thickness (**F3**) |
| 21 | Tagged seed components | Confirmed |
| 22 | Shared edges + one-pixel body overlap + DPR matrix | Confirmed — the overlap was load-bearing (**F6**) |
| 23 | Compile-time partition exhaustiveness | Confirmed |

## 6. Phase 0 exit criteria

| Criterion | Status |
|---|---|
| The tile room exists, scrolls, and renders through the fallback path | Met — playable, follow camera, 600×400 over 960×544 |
| Same geometry renders as fallback and themed cave, on both scenes | Met — `treatment-compare.png`, plus a live toggle in the section |
| Collision and simulation code untouched | Met — `src/` unchanged; the only non-showcase edit is an `export` keyword |
| Prototype demonstrates top caps, shaded faces, stable cracks, procedural background | Met — `topology-sheet.png`, `scale-sheet.png`; crack stability asserted by the culling-invariance test |
| A contact sheet can be generated by one command | Met — `npm run visual:sheets` |
| API review resolves the §20 decisions | Met — §5 |
| Performance and `dist` budgets recorded | Met — §2 |
| Topology fixtures covering §14.6 shapes | Met — `TOPOLOGY_SHAPES` plus the composite room |

## 7. Phase 1 gate

Phase 1 may begin with `src/terrain/`, `src/rng/visual-seed.ts`, and
`src/primitives/snap.ts` as proposed. The disposable cave code is evidence, not
production source: **do not promote it by moving or exporting the file.**

What carries forward:

1. Write connectivity tests against the **topology fixture**, not the generated
   room (F1). Phase 1 may prefer to copy the tile art into `src/terrain/tests/`
   rather than reach into `showcase/`.
2. Make `computeRectExposures` and `drawTerrainRect` usable **without** a
   prepared scene (F2), and restate the §13.1 no-per-frame-exposure rule as a
   property of the themed level path.
3. Derive cap and face thickness from tile size / `cornerSize` (F3).
4. Set the Phase 2 draw budget on **terrain-only** fixtures (F4), using the
   fallback medians in §2.2 as the reference.
5. `visibleTileRange` is worth 4× at 200 columns (F5) — a Phase 1 deliverable
   for a measured reason, not a speculative one.
6. Keep the one-backing-pixel body overlap (F6); it is load-bearing at DPR 1.25
   and 1.5.
7. Design the outer silhouette treatment deliberately (F7).
8. Make every layer callback independently omittable (F9).

`showcase/_prototype/cave-material.ts` and the `cave` treatment in
`showcase/sections/tile-room-render.ts` are **deleted when Phase 2 lands.** The
tile-room scene, its fixtures, the sheets, and the benchmark stay.
