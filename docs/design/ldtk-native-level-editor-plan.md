# LDtk-Native Level Editor — Implementation Plan

> **Status:** Implemented. All six phases landed 2026-08-06.
> **Date:** 2026-08-06
> **Scope:** Make `.ldtk` the document the engine's level editor owns — open it,
> draw into it with live auto-tiling driven by the project's own rules and
> tilesets, and save a file that reopens cleanly in LDtk desktop.
> **Primary modules:** `src/ldtk/` (extended), a new showcase editor surface,
> and a reduced `showcase/sections/tile-room.ts`.
> **Supersedes for tile authoring:** the level-editing half of
> `dual-grid-terrain-authoring-plan.md`. That plan's procedural art system
> (`src/terrain-art/`) is retained — see §9.

## 1. Executive summary

Today `src/ldtk/` is a **playback** pipeline: parse a `.ldtk` file, translate its
IntGrid into `LevelData`, and blit the tiles LDtk already baked at save time. You
cannot draw with it. The moment a cell changes, nothing recomputes which tile
belongs there, because the rules that make that decision are discarded at parse
time.

This plan closes that gap by implementing **LDtk's auto-layer rule engine** in
TypeScript, adding **editing operations** and a **writer** over the LDtk
document, and rebuilding the showcase level editor on top of them.

The load-bearing idea is the correctness strategy. Every `.ldtk` sample carries
both the inputs (`intGridCsv` + rule definitions) *and* LDtk's own baked output
(`autoLayerTiles`). That makes each file a self-verifying fixture: re-run our
engine on the input, compare to LDtk's output, demand an exact match. The sample
suite now in the repo gives **360 rules across 15 projects**, exercising every
auto-layer feature LDtk has. No hand-written test could establish parity this
convincingly, and it is free.

## 2. Decisions taken

| Question | Decision |
|---|---|
| Source of truth | **Round-trip `.ldtk`.** The editor owns and writes the LDtk document. `LevelData` becomes a derived runtime export. |
| Rule authoring | **Evaluate only.** Rules are authored in LDtk desktop; the engine matches them faithfully. No in-engine rule editor. |
| `src/terrain-art/` | **Keep, demote.** LDtk becomes the primary tile pipeline; terrain-art remains the zero-asset procedural path with its public API and package export intact. |
| Sample content | **Use the real LDtk sample suite** now vendored under `assets/ldtk/samples/` as the correctness oracle. See §10 for the licensing split this forces. |
| File access | **File System Access API**, with a multi-file-picker + download fallback for non-Chromium browsers. See §11.1. |
| Sample pruning | **Prune** `thumbs/`, the NuclearBlaze aseprite, and the two WorldMap projects. See §10. |

## 3. Findings in the current code

Three concrete defects/gaps found while surveying. Each is independently
verifiable and each is addressed by a phase below.

### 3.1 The bundled sample has no rules

`assets/ldtk/samples/platformer.ldtk` has `autoRuleGroups: []` on every layer.
Its 25 `autoLayerTiles` are hand-written. It was synthesized in-repo, not
produced by LDtk desktop. `assets/ldtk/README.md:47` claims it is "a small
hand-authored level built in the LDtk desktop editor … exercising auto-layer
rules" — none of which is true. The file should be deleted in favour of the real
samples, and the README corrected.

### 3.2 `drawLdtkLayer` never draws IntGrid layers

`src/ldtk/render.ts:164` returns `0` for `__type === 'IntGrid'`. But an IntGrid
layer can carry its own auto-rules and therefore its own `autoLayerTiles`. In
`Typical_2D_platformer_example.ldtk` the `Collisions` IntGrid layer holds **784
baked tiles** — the level's primary terrain art — and the current renderer
discards all of them. This is a today-bug, independent of any new feature.

### 3.3 The parser discards everything needed to draw

`parse.ts` keeps a deliberate "runtime-relevant subset". Drawing needs the
authoring half, all currently dropped: `autoRuleGroups`, `intGridValuesGroups`,
`autoSourceLayerDefUid`, `defs.entities`, layer parallax, and level backgrounds.

## 4. The auto-layer rule format

Reverse-engineered from the vendored samples (LDtk `jsonVersion` 1.5.3) and
confirmed against usage counts across all 360 rules.

### 4.1 Pattern encoding

`rule.pattern` is a flat `size × size` array (observed sizes: 1, 3, 5, 7) read
row-major, centred on the cell under test. Value semantics:

| Value | Meaning |
|---|---|
| `0` | Wildcard — matches anything, including empty |
| `1000001` | Matches any non-zero IntGrid value |
| `-1000001` | Matches only empty (`0`) |
| `±(groupUid + 1) × 1000` | Cell's value must (not) belong to that `intGridValuesGroups` entry |
| `N > 0` | Cell value must equal `N` |
| `N < 0` | Cell value must not equal `\|N\|` |

The group encoding was confirmed empirically: in
`Typical_2D_platformer_example.ldtk` the `Collisions` layer defines group
`walls` with `uid: 1`, containing `dirt(1)` and `stone(3)`; its rules reference
`±2000`. Only `intGridValues[].groupUid` maps values into groups; `0` means
ungrouped.

### 4.2 Feature usage across the sample suite

This is the implementation checklist, ordered by how much of the corpus depends
on each feature.

| Feature | Rules using it | Notes |
|---|---|---|
| `size` 3 / 1 / 5 / 7 | 275 / 50 / 30 / 5 | Square patterns only |
| `tileMode` Single / Stamp | 338 / 22 | Stamp is multi-tile with `pivotX/Y` |
| `breakOnMatch` | 216 | Stops later rules for that cell |
| `flipX` / `flipY` | 125 / 68 | Match under mirroring; emit `f` bits |
| `chance < 1` | 89 | **Stochastic — see §7.1** |
| `tileRectsIds.length > 1` | 88 | Random pick among alternatives — **stochastic** |
| `perlinActive` | 63 | **Stochastic** |
| `outOfBoundsValue` non-null | 55 | `null` = never match out of bounds |
| `xModulo`/`yModulo` > 1 | 41 | With `xOffset`/`yOffset` |
| `tileRandomX/Y` | 18 | Per-tile source jitter — **stochastic** |
| `checker` Horizontal / Vertical | 7 / 2 | Alternating-cell skip |
| `alpha < 1` | 6 | Per-tile alpha |
| `tileXOffset`/`tileYOffset` | 2 | Static source nudge |
| Group `isOptional` | 5 groups | Enabled per layer *instance* |
| Group biome requirements | 8 groups | Driven by level fields |
| `autoSourceLayerDefUid` | 12 layers | AutoLayer reads a *different* layer's IntGrid |

## 5. Architecture

```
                        ┌──────────────────────────────┐
   .ldtk file  ────────▶│  parse.ts  (+ rules, defs)   │
                        └──────────────┬───────────────┘
                                       │  LdtkProject (typed) + raw (preserved)
                     ┌─────────────────┼─────────────────┐
                     ▼                 ▼                 ▼
              ┌────────────┐   ┌──────────────┐   ┌────────────┐
              │  edit.ts   │──▶│   rules.ts   │──▶│ render.ts  │
              │ pure ops   │   │ auto-tiler   │   │  blit      │
              └─────┬──────┘   └──────────────┘   └────────────┘
                    │  dirty cells                       ▲
                    ▼                                    │
              ┌────────────┐                      ┌──────┴──────┐
              │  write.ts  │─▶ .ldtk              │ translate.ts│─▶ LevelData
              └────────────┘                      └─────────────┘   (play mode)
```

### 5.1 New and changed modules

```text
src/ldtk/
├── types.ts        EXTEND  rule/group/entity-def/parallax/background types
├── parse.ts        EXTEND  retain the authoring subset (§3.3)
├── rules.ts        NEW     the auto-layer rule engine          ← the heart
├── rng.ts          NEW     LDtk-compatible RNG + perlin        ← see §7.1
├── edit.ts         NEW     pure editing ops + dirty-region invalidation
├── write.ts        NEW     structural-preserving serializer
├── format.ts       NEW     LDtk-style JSON formatter
├── render.ts       FIX     draw IntGrid autoLayerTiles; parallax; backgrounds
├── translate.ts    KEEP    unchanged; still the play-mode bridge
└── index.ts        EXTEND  barrel (+ `src/tests/barrel-contract.test.ts`)
```

### 5.2 `rules.ts` contract

```ts
export interface LdtkRuleGridSource {
  readonly cols: number;
  readonly rows: number;
  /** IntGrid value at (cx, cy). Out of bounds returns `undefined`. */
  readonly valueAt: (cx: number, cy: number) => number | undefined;
  /** Group uid for a value, or 0 when ungrouped. */
  readonly groupOf: (value: number) => number;
}

export interface RunLdtkAutoLayerOptions {
  /** Layer instance seed — drives all stochastic decisions. */
  readonly seed: number;
  /** Uids of optional rule groups enabled on this layer instance. */
  readonly enabledOptionalGroups?: readonly number[];
  /** Level field values, for biome-gated groups. */
  readonly biomeValues?: readonly string[];
  /** Restrict work to a dirty rect. Omit to resolve the whole layer. */
  readonly region?: Readonly<{ cx: number; cy: number; cols: number; rows: number }>;
}

/** Never throws. Returns tiles in LDtk's own emission order. */
export function runLdtkAutoLayer(
  source: LdtkRuleGridSource,
  layerDef: Readonly<LdtkLayerDef>,
  options: Readonly<RunLdtkAutoLayerOptions>,
): readonly LdtkTile[];
```

Pure, DOM-free, no `Math.random`, no `Date.now` — it satisfies the determinism
rules in `docs/conventions.md` and stays testable under `environment: 'node'`.

### 5.3 A capability this unlocks

Because `rules.ts` takes an abstract grid source rather than an LDtk document,
`generateLevel()` output can be skinned with an LDtk ruleset at load time —
procedural levels, hand-authored art direction. That is a genuine engine
feature, not just editor plumbing. It also argues for keeping `rules.ts` a
separate tree-shakeable leaf rather than folding it into `parse.ts`.

## 6. Phase plan

Each phase lands independently and has a falsifiable acceptance test.

### Phase 0 — Oracle harness + the render fix

1. Extend `types.ts`/`parse.ts` to retain rules, groups, entity defs,
   `autoSourceLayerDefUid`, parallax, backgrounds.
2. Build `src/tests/ldtk-rules-oracle.test.ts`: for every sample, every
   rule-bearing layer, extract `(intGridCsv, ruleDefs, bakedTiles)` and report a
   match percentage. It fails loudly at 0% — the point is to establish the
   measurement *before* the implementation exists.
3. Fix §3.2 (IntGrid `autoLayerTiles`).
4. Delete the fake `platformer.ldtk`; correct `assets/ldtk/README.md`.

**Acceptance:** the oracle harness runs over all 15 samples and reports a
baseline. `Typical_2D_platformer_example.ldtk` renders its 784 Collisions tiles.

### Phase 1 — Deterministic rule engine

Pattern matcher with all sentinels and group refs; flips; checker; modulo +
offset; out-of-bounds; `breakOnMatch`; group `active`/`isOptional`; Single and
Stamp tile modes; `autoSourceLayerDefUid` indirection; `alpha`; static tile
offsets.

**Acceptance:** 100% oracle match on every rule with `chance === 1`,
`perlinActive === false`, no tile randomisation, and a single `tileRectsIds`
entry. Estimated ~200 of 360 rules. Any shortfall is a real bug, not a tolerance.

### Phase 2 — Stochastic parity

Match LDtk's RNG for `chance`, multi-`tileRectsIds` selection, `tileRandomX/Y`,
and perlin. See §7.1 — this is the plan's main technical risk and is deliberately
isolated in its own phase so Phase 1 can ship regardless.

**Acceptance:** 100% oracle match across all 360 rules. If the RNG proves
unmatchable, the documented fallback is our own deterministic selection — usable
for authoring, divergent from LDtk's bake, recorded explicitly in the module doc.

### Phase 3 — Editing operations

`edit.ts`: pure, never-throw ops returning a new project plus a dirty-cell set —
`setIntGridValue`, `paintIntGridCells`, `setGridTile`, `add/move/removeEntity`,
`setEntityField`, `resizeLevel`, `add/removeLevel`.

Invalidation: changing cell `(cx, cy)` invalidates a radius-`⌊size/2⌋`
neighbourhood per rule, widened by stamp pivots. The union feeds
`RunLdtkAutoLayerOptions.region` so a brush stroke re-resolves a small
neighbourhood, not the level.

**Acceptance:** painting a cell then re-resolving the dirty region produces the
same tiles as a full-layer resolve (region-invariance test, mirroring the
existing culling-invariance discipline in `src/terrain/`). Undo/redo round-trips.

### Phase 4 — Writer

`write.ts` uses **structural preservation**: retain the raw `JSON.parse` object
alongside the typed view, mutate only fields we own, and re-serialize. Fields we
never model survive untouched — this is what makes "reopens in LDtk desktop"
achievable, and it is far safer than reconstructing a document from our subset.

Formatting note, measured: LDtk writes tab-indented JSON but compacts leaf arrays
onto single lines. `JSON.stringify(o, null, '\t')` inflates
`Typical_2D_platformer_example.ldtk` from 401 KB to 897 KB. Byte-identical
round-trip therefore needs `format.ts` to replicate that style. **Semantic**
round-trip does not — but since these files are checked into git, a matching
formatter keeps diffs readable and is worth the small effort.

**Acceptance:** `parse → write → parse` deep-equals for all 15 samples;
`write` of an unmodified project is byte-identical to input; manual confirmation
that an edited file reopens in LDtk desktop without repair warnings.

### Phase 5 — Editor rebuild

```text
showcase/sections/ldtk-editor/
├── index.ts             mount / dispose
├── document.ts          open, save, dirty tracking, tileset image loading
├── state.ts             editor state + reducer + undo stack
├── viewport.ts          camera, zoom, Fit, pan (per plan §8.7 wheel discipline)
├── render.ts            layers, grid, selection, overlays
├── tools.ts             pencil / line / rect / fill / picker / erase
├── palette-intgrid.ts   IntGrid values, coloured, grouped
├── palette-tiles.ts     tileset picker for `Tiles` layers
├── palette-entities.ts  entity palette + field editor from `defs.entities`
├── panel-layers.ts      layer list, visibility, opacity, optional-rule toggles
├── panel-levels.ts      level / world browser
└── play.ts              ldtkLevelToLevelData → compileGeneratedLevel → stepPlatformer
```

`tile-room.ts` (1937 lines) sheds its level-editing tooling and reverts to what
its own header says it is: the procedural terrain-art validation scene. The
standalone `tile-room-ldtk.ts` demo section is absorbed into the new editor.

**Acceptance:** open `Typical_2D_platformer_example.ldtk`, paint into the
Collisions IntGrid, watch auto-tiling resolve live, place an entity, press Play,
run the platformer on the result, save, and reopen in LDtk desktop.

### Phase 6 — Runtime, budgets, docs

Keep `render.ts` as the lean runtime leaf — `scripts/check-ldtk-runtime-size.mjs`
already enforces a 12 KB budget and forbids parser leakage; extend the forbidden
list with `rules.ts`, `edit.ts`, `write.ts`, `format.ts`. Add a separate budget
for the auto-tiler leaf so §5.3 stays viable. Update `docs/api-surface.md`,
`docs/integration.md`, `THIRD_PARTY.md`, and the barrel contract test.

## 7. Risks

### 7.1 LDtk's RNG — resolved

**Outcome: fully matched.** The engine reproduces LDtk's bake exactly, including
every stochastic decision. What it took, recorded because none of it is
guessable from the JSON schema:

- `dn.M.randSeedCoords` had to be transcribed *literally*. LDtk runs on Haxe's
  JavaScript target, where `Int` multiplication overflows 2^53 and silently
  loses precision before the following `^` truncates to 32 bits. Reimplementing
  it "correctly" with `Math.imul` produces a different hash that disagrees with
  every saved file. The result is also signed — LDtk takes no absolute value —
  and a negative draw makes a rule's tile lookup miss, which is a gap real
  `.ldtk` files contain and the engine must reproduce.
- Perlin is `hxd.Perlin` from Heaps with `normalize = true` and
  `adjustScale(50, 1)`, not a generic implementation. Its 256-entry gradient
  table is part of the contract; it was extracted from source rather than
  retyped.
- Seed expressions are asymmetric in ways that look like typos but are not:
  the tile-alternative pick and the X offset both use `uid + seed + flips`,
  while the Y offset uses `uid + seed + 1`.

The original risk assessment held up — the oracle measured divergence precisely
enough to isolate each cause in turn (74% → 88% → 93% → 95% → 100%), and the
documented fallback was never needed.

### 7.1b What the plan did not anticipate

Four behaviours were invisible in the schema and only surfaced because the
oracle disagreed:

1. **Opaque-tile occlusion.** A rule painting a fully opaque tile at full alpha
   with no position offset locks its cell, and every later rule's tiles there
   are *discarded from the saved output*. Without this the engine over-emits.
   The opacity data ships in the project file (`cachedPixelData.opaqueTiles`),
   verified to match real PNG alpha for 140/140 tiles, so no image decoding is
   needed.
2. **Every matching orientation paints.** A rule with `flipX` whose pattern
   matches both mirrorings emits *two* stacked tiles, not one — unless
   `breakOnMatch` stops it after the first.
3. **Checker and modulo interlock.** A checker axis derives its phase from the
   *other* axis's modulo. They are one test, not two independent ones.
4. **Tile offsets are pixels, not cells**, and mirroring negates the whole
   offset including the author's static nudge.

### 7.1c Original risk assessment (retained)

`chance`, alternative-tile selection, `tileRandomX/Y`, and perlin all consume
LDtk's internal RNG, seeded per layer instance and mixed with rule uid and cell
coordinates. Reproducing baked output byte-for-byte requires matching that
algorithm exactly, and it is Haxe source, not documented schema. 89 rules use
`chance`, 88 use multiple tile rects, 63 use perlin.

Mitigations, in order: the oracle test reports divergence immediately and per
rule, so the problem is measured rather than discovered late; the work is
isolated in Phase 2 so nothing else blocks on it; and a documented fallback
(our own deterministic selection) still produces good authoring behaviour — a
painted level looks right, it simply will not match a bake LDtk produced earlier.
The honest failure mode is cosmetic divergence, not a broken editor.

### 7.2 Round-trip fidelity

Mitigated by structural preservation (§ Phase 4) — we cannot corrupt fields we
never touch. Residual risk is LDtk rejecting a file for a cross-field invariant
we break (e.g. `nextUid` not advanced when adding entities). The parse → write →
parse test plus manual LDtk verification covers it.

### 7.3 Editor scope creep

LDtk desktop is a mature application. The editor here should target the platformer
authoring loop — IntGrid painting, tile painting, entity placement, play test —
and explicitly *not* chase world-layout editing, enum management, or level
field schemas in the first release.

## 8. Explicit non-goals

- An in-engine auto-layer **rule editor** (decided: evaluate only).
- Authoring `defs` of any kind — tilesets, entities, enums, layers. Those stay
  LDtk desktop's job.
- World-layout editing (GridVania/Free placement of levels).
- External-level (`.ldtkl`) *writing*. Reading is in scope; writing is not.
- Multi-world projects.

## 9. Relationship to `src/terrain-art/`

`src/terrain-art/` keeps its public API, its `./terrain-art/editor` package
export, and its tests. Its role narrows to what it is uniquely good at: complete
terrain art with **zero asset dependencies**, which remains this engine's stated
identity. LDtk covers the opposite case — you have art and want a real editor.

One correction to the record: `src/ldtk/render.ts:6-8` asserts it is "the
replacement for both `drawPreparedTerrainArtDualGrid` and the procedural
`drawTerrainTiles`". Per the decision in §2 that is not the plan, and the comment
should be revised when Phase 0 touches the file.

`terrain-art/import-tileset.ts` (quarter-tile assembly of an edge-based tilesheet
into the dual-grid corner atlas) stays relevant for users bringing a bare PNG
with no `.ldtk` project. It is a genuinely different input, not a redundant one.

## 10. Licensing and repo weight

The vendored sample suite is **6.7 MB**, and it conflicts with a decision already
recorded in `assets/ldtk/README.md`:

| Item | Size | Status |
|---|---|---|
| `atlas/NuclearBlaze_by_deepnight.aseprite` | 8 KB | **CC-BY-SA 4.0** — README explicitly says do not add |
| `atlas/Beach by deepnight.png`, `atlas/TopDown_by_deepnight.png` | 112 KB | No explicit per-asset license; README says seek clearance |
| `thumbs/` | 424 KB | Preview images; no purpose in this repo |
| `WorldMap_GridVania_layout.ldtk` | 3.1 MB | Out of scope per §8 (multi-world) |
| `*.ldtk` (remaining) | ~2.5 MB | MIT via the LDtk repo — fine as fixtures |

**Decided split:**

- **Test fixtures** (not redistributed, referenced only by vitest): the `.ldtk`
  project files. These are the oracle and they must stay.
- **Showcase assets** (redistributed): only the already-cleared CC0/PD tilesets
  in `assets/ldtk/{sunny-land,cavernas,inca}/`.
- **Drop in Phase 0:** `thumbs/` (424 KB), `atlas/NuclearBlaze_by_deepnight.aseprite`
  (CC-BY-SA), and both WorldMap projects (4.2 MB; multi-world is out of scope
  per §8). Net saving ~4.6 MB, with every rule-bearing fixture retained.

`atlas/Beach by deepnight.png` and `atlas/TopDown_by_deepnight.png` are retained
as fixtures — `Entities.ldtk` and the top-down samples reference them — but are
recorded in `THIRD_PARTY.md` as test-only and excluded from distribution. The
package already ships `dist/` alone, so nothing under `assets/` is redistributed
via npm.

## 11. Resolved design details

### 11.1 File access — File System Access API

`relPath` is relative to the `.ldtk` file, which a browser file input cannot
follow. The editor requests a **directory handle** via
`window.showDirectoryPicker()`, resolves tileset PNGs against it, and saves in
place with `FileSystemFileHandle.createWritable()` — so LDtk desktop sees edits
live and the round-trip loop is genuinely two-way.

Fallbacks, in order:

1. **Multi-file picker** — user selects the `.ldtk` and its PNGs together;
   `relPath` is matched by basename. Save produces a download.
2. **Bundled tilesets** — name-match against `assets/ldtk/{sunny-land,cavernas,inca}/`
   so the showcase demo works with no file access at all.

Per `docs/conventions.md`, all three paths resolve host APIs lazily inside the
function that uses them, never at module load, and degrade without throwing.
Feature detection is `typeof window.showDirectoryPicker === 'function'`, not a
browser sniff.

### 11.2 Level fields and biomes — read-only

8 rule groups are biome-gated via `requiredBiomeValues`/`biomeRequirementMode`.
Level fields are **parsed and read** so those groups evaluate correctly, but
editing them is out of scope (§8). A level whose biome field the author wants to
change is a round-trip to LDtk desktop.
