# Engine gaps from review §4.8 — parse `tileRenderMode` + ship `drawLdtkEntityTile`

Status: **implemented** — shipped as `0.16.0` on 2026-08-16 (all seven phases; §7.1 sample `tsc --strict`-clean against `dist/`, pack simulation 7/7 with all six spike strips tiling correctly, full suite + showcase + release smoke green)
Source: `CELEROCK_BRIEF_REVIEW.md` §4.8 ("Two engine gaps worth filing separately"), against `aicraft-engine@0.15.0` and `games/celerock.md` as of commit `1aa8ce0`.

## The two gaps

1. **`LdtkEntityDef` drops `tileRenderMode`.** Every raw `.ldtk` entity def carries it (`games/celerock.ldtk`: Gem = `FitInside`, Spike = `Repeat`; the engine's own `assets/ldtk/samples/Entities.ldtk` also uses `Stretch` and `NineSlice`), but `parseEntityDef` (`src/ldtk/parse.ts:471-506`) never reads it and `LdtkEntityDef` (`src/ldtk/types.ts:480-506`) has no field for it. Every consumer must re-derive Repeat-vs-Fit from rect geometry.
2. **No `drawLdtkEntityTile` helper.** `src/ldtk/render.ts` draws tile *layers* only (`drawLdtkLayer` / `drawLdtkLevel` / private `blitTile`), so any consumer wanting authored entity art hand-rolls the repeat/fit blit loop — in a codebase whose stated rule is "never hand-roll a tile blit." Celerock's brief §7.1 currently carries that loop plus a §12.8 carve-out to legalize it.

## Verdict: yes — plug both, in one 0.16.0 release

Beyond tidiness, the current workaround is **wrong in general**: §7.1's heuristic ("instance ≤ tile → fit, else repeat") repeat-tiles exactly the instances a `Stretch` or `Cover` author wanted scaled. Harmless for the shipped Celerock pack (only `FitInside`/`Repeat` appear), but the brief states the derivation as a general rule, and **all five modes already ship in this repo's own fixtures** — `Entities.ldtk` alone has `FitInside`×7, `NineSlice`×2, `Stretch`×2, `Repeat`×1, and `Cover` appears at `assets/ldtk/samples/Typical_2D_platformer_example.ldtk:1772`. The schema's enum is also **seven values wide, not five** — add `FullSizeCropped` and `FullSizeUncropped` (verified against [`deepnight/ldtk` `docs/JSON_SCHEMA.json`](https://github.com/deepnight/ldtk/blob/master/docs/JSON_SCHEMA.json); neither appears in any repo fixture). Counted against the real enum, the heuristic renders exactly two of the seven modes correctly (`FitInside`, `Repeat`); the other five degrade to fit-or-repeat against art we ship.

The payoff: the helper deletes the entire carve-out apparatus — §12.8's "Scope: LEVEL TILE LAYERS" blockquote, acceptance criterion 11's "on level tile layers" wording, and §7.1's 20-line hand-rolled blit loop — restoring the blanket "never hand-roll a tile blit" rule. Cost: one additive minor release plus a mechanical repin, the exact dance `eec6a66` already performed.

---

## Phase A — Engine: parse `tileRenderMode` (gap 1)

- `src/ldtk/types.ts` (~line 474, next to `LdtkEntityRenderMode`):
  - `export type LdtkTileRenderMode = 'Cover' | 'FitInside' | 'Repeat' | 'Stretch' | 'FullSizeCropped' | 'FullSizeUncropped' | 'NineSlice';` — all seven schema values, so valid LDtk round-trips instead of silently defaulting.
  - Add `readonly tileRenderMode: LdtkTileRenderMode;` to `LdtkEntityDef`, after `renderMode` (line 491).
- `src/ldtk/parse.ts`:
  - Add `parseTileRenderMode(v: unknown)` guarding the seven schema values, mirroring `parseEntityRenderMode` at `parse.ts:466-469`.
  - Wire into `parseEntityDef`'s return (~line 499).
- **No in-repo `LdtkEntityDef` literals need updating.** Grepping `renderMode:` across `src/` outside `parse.ts`/`types.ts` returns nothing — the interface is only ever constructed by the parser, so adding a required property breaks no existing construction site. (Keep the grep as a check; expect zero hits.)

### The default is a real decision, not a formality

`src/tests/fixtures/celerock-adversarial.ldtk` contains **zero** `tileRenderMode` keys — but also **zero tile-bearing defs** (verified: every def has `tileRect: null` and no instance is oversized), so its *draw* is unaffected — no-tile entities fall to the engine palette shape regardless of this choice. The default changes (a) that fixture's parsed def values, and (b) the draw of any tile-bearing file that omits the key — and there the two candidates diverge visibly:

| Default | A tile-bearing def missing the key, with a 40×8 instance over an 8×8 tile |
|---|---|
| `'FitInside'` | One aspect-preserved centered blit — **one 8×8 tile floating in a 40px box** |
| geometry heuristic | Repeat-tiled — matches today's §7.1 behavior exactly |

Ship **`'FitInside'`** (the schema declares no default of its own; every editor-written def in the repo carries an explicit value, and the untouched no-tile defs — celerock's Player/Spring/DashRefill — all carry `FitInside`; it is also the least-surprise single blit), but **add the Phase C tests that pin both levels** — the fixture's parsed `'FitInside'` and the synthetic oversized draw — so the change reads as deliberate rather than as a regression someone finds in a screenshot later. If that synthetic draw looks wrong on inspection, switch the default to the heuristic sentinel instead — that choice is cheap now and expensive after 0.16.0 ships.

## Phase B — Engine: `drawLdtkEntityTile` (gap 2)

New export in `src/ldtk/render.ts`, next to `blitTile` (house style: never throws, `save`/`try`/`finally`, `imageSmoothingEnabled = false`, defensive typeof guards, `@param`/`@returns` JSDoc):

```ts
drawLdtkEntityTile(
  context: CanvasRenderingContext2D,
  tile: Readonly<{ tilesetUid: number; x: number; y: number; w: number; h: number }>,
  dest: Readonly<{ x: number; y: number; width: number; height: number }>,
  tilesets: Readonly<LdtkTilesetBundle>,
  mode?: LdtkTileRenderMode,
): boolean
```

Mode semantics:

| Mode | Behavior |
|---|---|
| `Repeat` | Nested repeat loop with partial-tile clipping — the brief §7.1 logic verbatim |
| `Stretch` | Single scaled `drawImage` filling dest |
| `FitInside` | Scale to fit inside dest preserving aspect ratio, centered |
| `Cover` | Scale to cover dest preserving aspect ratio, clipped to dest |
| `FullSizeCropped` / `FullSizeUncropped` / `NineSlice` | Fallback heuristic, documented in JSDoc — see below |
| omitted | Geometry heuristic (instance ≤ tile both axes → fit blit; else repeat) — preserves the brief's current behavior for consumers that don't look up the def |

Returns `false` on missing tileset / degenerate tile / draw throw. Never throws.

**NineSlice is blocked deeper than one lookup.** It needs `nineSliceBorders`, and **`LdtkEntityDef` has no such field and `parseEntityDef` never parses it** — so this is not "per-instance tile data doesn't carry it, look up the def"; the def doesn't carry it either. Parsing it is effectively a third gap, deliberately out of scope (see *Not in scope*). Say that in the JSDoc so the fallback reads as a known boundary rather than an oversight. The `FullSize*` pair needs no extra data (native-size blit, cropped/uncropped to the bounds) but ships in no repo fixture — same documented-fallback bucket until one does.

Also:

- `src/ldtk/index.ts`: export the function (values block ~line 110) and `type LdtkTileRenderMode` (types block ~line 41).
- `src/tests/barrel-contract.test.ts`: add **`drawLdtkEntityTile` only**. That file is `import * as aicraft` + runtime `typeof` assertions, so a type-only export is invisible to it — which is exactly why `LdtkEntityRenderMode` isn't asserted there today. Either leave `LdtkTileRenderMode` out (consistent with the existing precedent) or cover it with an explicit compile-time reference; do not write a `typeof` check that would silently pass on a deleted type.

## Phase C — Engine tests

- `src/tests/ldtk-parse.test.ts`: `tileRenderMode` parses for each of the seven values; absent → `'FitInside'`; garbage → `'FitInside'`.
- **Default pins, two levels** (the Phase A decision): (1) parse `src/tests/fixtures/celerock-adversarial.ldtk` — zero `tileRenderMode` keys in the raw file — and assert every entity def comes back `'FitInside'`; (2) a synthetic inline project — a tile-bearing def with the key absent, one 40×8 instance over its 8×8 tile — drawn through the helper: **one centered blit, not a repeat run**. These are the tests that make the default a choice on the record. (The raw fixture cannot host the draw pin — it has no tile-bearing defs; verified.)
- `src/tests/ldtk-render.test.ts` (new describe, node-canvas red/green pattern like the existing ones):
  - Repeat: `40×8` dest over an `8×8` tile → 5 blits, plus a partial-column clip case.
  - FitInside letterboxes a non-square dest; Stretch fills it.
  - Omitted mode + oversized dest → heuristic repeat (regression guard for the brief's current path).
  - Unknown `tilesetUid` → `false`, no throw.
- Real-pack assertion (Spike def parses `Repeat`, Gem `FitInside`) via a small fixture snippet, or a direct read of `games/celerock.ldtk` if precedent exists in `ldtk-fixtures.ts`.

## Phase D — Release 0.16.0

- `npm test`; `npm run build:dist`. **`dist/` is gitignored** (`.gitignore:2`; `git ls-files dist` → 0 files) — it is a `prepack` artifact, not a committed one. The build exists to give Phase G's `tsc --strict` something to typecheck the rewritten §7.1 sample against; there is nothing to commit from it.
- `package.json` → `0.16.0`; `CHANGELOG.md` gains `## [0.16.0] - 2026-08-16` in the house voice (both features; additive, non-breaking).

## Phase E — Repin the catalog (mirror `eec6a66`'s 8-file pattern)

- `games/celerock.md`: title (line 1), §1 install/pin (lines 20–25), §16 ledger (lines 1172/1198/1204) — 0.16.0's pin reason: "authoritative `tileRenderMode` + `drawLdtkEntityTile`".
- `games/README.md` and `games/SHOWCASE.md`: **selective, not blanket.** Each file mixes live pins with historical claims about what `0.15.0` shipped, and a `sed` over the version string corrupts the second kind:

  | Location | Kind | Action |
  |---|---|---|
  | `games/README.md:9` ("All seven prompts pin …") | live pin | → `0.16.0` |
  | `games/README.md:11` ("typechecked against the `0.15.0` surface at repin time") | provenance | **leave** |
  | `games/SHOWCASE.md:5` ("All seven install … exactly") | live pin — **but shares its paragraph line with the provenance clause** "typechecked against the `0.15.0` surface" | → `0.16.0` for the install clause only; the typecheck clause on the same line stays |
  | `games/SHOWCASE.md:36` ("the only step on `0.15.0`") | live pin, step-level | → `0.16.0` |
  | `games/SHOWCASE.md:85` ("The `0.15.0` session makes the invariants structural") | historical — names what that release shipped | **leave** |

  (`SHOWCASE.md:2` is a blank line; the plan's earlier reference to it was wrong.) The additive-only argument still holds: no re-typechecking needed for the "imports compile as written" claim.
- Six briefs (`bosscard`, `doodle-knight`, `flipside`, `simple-platformer`, `spin-loop`, `world-1-1` — all present in `games/`): pin strings → `0.16.0`. Same live-vs-historical split applies; `bosscard.md:907` and the `0.4.0`-era provenance notes stay as written.

## Phase F — Celerock brief §7.1 rewrite onto the helper

- The rect index becomes rect → `{ tile, mode }` (mode resolved once per room via `defUid` → `project.defs.entities` — the lookup key exists: `LdtkEntityInstance.defUid` is a required `number` at `src/ldtk/types.ts:132`); the override's draw body collapses to `return drawLdtkEntityTile(ctx, tile, entity.rect, tilesets, mode);`. Delete the "derive it" comment block and both hand-rolled blit paths.
- Delete §12.8's "Scope: LEVEL TILE LAYERS" blockquote (line 1079); restore criterion 11's blanket wording (line 1060).
- §12.1 smoke assertion (line 1007): assert the *parsed* `tileRenderMode` values (Gem `FitInside`, Spike `Repeat`) — authoritative, no derivation language.
- §11 `entity-art.ts` entry (line 982), §1 import block (add `drawLdtkEntityTile`, `type LdtkTileRenderMode`), §7.1 prose, and the closing statement updated to match.
- `CELEROCK_BRIEF_REVIEW.md` §4.8: add a one-line "landed in 0.16.0" status note.

## Phase G — Verification & commits

- Full `npm test` green.
- Extract the rewritten §7.1 sample and `tsc --strict` it against the rebuilt `dist/` typings (same harness as the previous session's verification).
- Re-run the pack simulation: 7/7 entities resolve; spikes tile 16×8→2, 40×8→5, 24×8→3, 8×16→2 — now driven by the parsed mode, not geometry.
- Stale-text sweep of `games/celerock.md` ("NOT preserved", "derive", leftover "0.15.0"). Read every `0.15.0` hit before changing it — §16's ledger and §1's blockquote both narrate *what each release shipped*, and those stay at `0.15.0` forever; only the pins move. Same rule as Phase E's table.
- Commits: `feat(ldtk)`, `chore(release)`, `docs(games)` — three conventional commits.

## Not in scope

- `__smartColor` parsing (review side-note; the def's `color` already covers the halo tint).
- NineSlice rendering **and `nineSliceBorders` parsing** — the latter is a genuine third gap (`LdtkEntityDef` has no such field at all), not a lookup the helper could have done. Documented fallback pending a pack that uses it; two of the samples do (`Entities.ldtk`, `Typical_TopDown_example.ldtk`), so expect this to come back.
- Any surface-cache / `drawLdtkLevel` change.
