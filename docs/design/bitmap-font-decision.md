# Decision: Bitmap / Pixel Font + Text Rendering

> Date: 2026-07-26. Stage 6 (Decide) for the `bitmap-font` technique.

## Decision

**Adopt Approach A from `docs/design/bitmap-font-proposal.md`: standalone free
functions + an options bag**, living in `src/primitives/` (matches
`outline-rect.ts` / `parallax.ts`). Ship a default 5×7 monospace bitmap font
(column-major hex bytes, full printable ASCII) plus a pure `measureText` and two
draw variants (`drawText` flat, `drawTextOutlined`).

## Rationale

The research note (`docs/research/bitmap-font.md`) confirms an asset-less pixel
font fits the library's "the algorithm IS the art" thesis: glyph data is code
(the canonical Pascal Stang `font5x7` dataset, MIT-licensed, ~475 bytes for 95
glyphs), drawn as `fillRect` calls — no PNG atlas, no webfont, no `ctx.fillText`.
`measureText` is pure arithmetic (ctx-free), so it is deterministic + SSR-safe
and composes with the existing pure-primitive style (`parallaxOffset`,
`outlineRect`). The free-function + options-bag shape matches every other draw
primitive in `src/primitives/` and is additively extensible (`letterSpacing`,
`lineHeight` can be added later as optional fields without breaking anyone).

The `@architect` returned **APPROVED** after one revision loop (loop 1 raised a
blocker on the `measureText` trailing-`lineGap` contract + two minors; loop 2
confirmed all resolved with no regressions). No prototype/benchmark-before-
decide step was needed: the API choice is obvious from signatures and there is
only one visual approach (filled rects from a glyph grid) — there is nothing to
compare. A `@benchmarker` visual QA pass will run AFTER implementation to verify
glyph correctness (the orchestrator cannot read images).

Approach B (font-object methods) was rejected — it violates the flat-function
primitive convention and hurts tree-shaking. Approach C (positional params) was
rejected — poor ergonomics and an extensibility dead-end.

## Resolved questions (binding for implementation)

From the research note + proposal + two architect loops:

1. **Glyph encoding:** column-major hex bytes (Pascal Stang 5×7, MIT, cited +
   attributed in the data file header).
2. **Registry, not singleton:** `createFont(...)` factory + `DEFAULT_FONT`
   constant + immutable `addGlyph(font, char, data) → new font` (pure
   progression ops; setup-time-only copy).
3. **Character subset:** full printable ASCII 0x20–0x7E (95 glyphs) — lowercase
   is needed for dialogue. Unicode/CJK/emoji explicitly out of scope.
4. **`measureText(text, font, scale)` is pure + ctx-free** (deterministic core,
   SSR-safe). Height formula (no trailing gap on last line):
   `height = (lineCount - 1) × (cellHeight + lineGap) × scale + cellHeight × scale`.
5. **Two draw variants:** `drawText` (flat `fillRect`) primary;
   `drawTextOutlined` (1px outline via `outlineRect`/`DEFAULT_OUTLINE_COLOR`).
   Both take a `CanvasRenderingContext2D`. NEVER `ctx.fillText` / `ctx.font`.
6. **Scale semantics:** "pixels per glyph cell" (`scale=3` → 15×21 per glyph).
7. **`DEFAULT_TEXT_SCALE = 3`** (~21px, XAG-legible). Document that the reference implementation's
   existing HUD uses ~14px (scale 2) and should override per-call.
8. **No kerning in v1** (monospace; add when proportional fonts arrive).
9. **Named constants exported:** `DEFAULT_TEXT_COLOR` (#ffffff),
   `DEFAULT_TEXT_SCALE` (3), `DEFAULT_LINE_GAP` (1, HD44780 convention).
   `drawTextOutlined` reuses `DEFAULT_OUTLINE_COLOR` (#1d1128) from
   `outline-rect.ts` — do NOT redefine it.
10. **`measureText` height excludes trailing `lineGap`** (standard convention;
    one `lineGap` per line *break*, not per line).

## Scope (v1)

- `src/primitives/bitmap-font-types.ts` — `BitmapFont`, `GlyphData`, `TextMetrics`, `TextAlign`, `TextDrawOptions`. `@module` header.
- `src/primitives/font5x7-data.ts` — the 95-glyph column-major hex-byte dataset with MIT attribution.
- `src/primitives/bitmap-font.ts` — `DEFAULT_FONT`, `createFont`, `addGlyph`, `measureText`, `drawText`, `drawTextOutlined`, the named constants. `@module` header.
- `src/primitives/index.ts` — re-export the new public surface.
- `src/tests/bitmap-font.test.ts` — TDD: `measureText` purity + exact height/width math (single + multi-line), alignment; `addGlyph` immutability; `drawText` via a fake ctx that records `fillRect` calls (assert glyph coverage + positioning + that known glyphs like 'A' produce their expected pixel pattern, catching transcription errors).
- `docs/api-surface.md` — flip bitmap-font section from `(proposed)` to shipped.
- `README.md` — add a Primitives-subrow for the bitmap font (or extend the existing Primitives row).

## Post-implementation verification

Because the orchestrator cannot read images, `@benchmarker` will render a sample
sheet ("ABCDE...XYZ 0123456789", "SCORE 1200", multiline) to `benchmarks/` and
report glyph correctness, alignment, and any garbled characters. This is the
visual QA gate for the glyph-data transcription risk.

## Post-implementation amendments

The `@benchmarker` visual-QA pass after implementation identified two issues
that required API changes, plus one data correction:

### Amendment to Decision #4: `measureText` gains `charGap` parameter

**Original:** `measureText(text, font?, scale?)` — 3 params.
**Amended:** `measureText(text, font?, scale?, charGap?)` — 4 params.

**Rationale:** Monospace glyph cells need a 1px advance gap between adjacent
glyphs or they merge into illegible ribbons (confirmed by visual QA — "ABCDE"
rendered as a solid block at `scale=1`). The `charGap` parameter is
letter-spacing, NOT per-pair kerning — decision #7 ("no kerning in v1") still
holds. The trailing gap after the last glyph on each line is excluded from width
(standard text-layout convention): `width = (n - 1) × (cellWidth + charGap) × scale + cellWidth × scale`.

### Amendment to Decision #6: `drawTextOutlined` technique changed

**Original:** Per-pixel `outlineRect` on every lit pixel.
**Amended:** Standard 4-offset technique — stamp flat text in outline color at
`(x±1, y)` and `(x, y±1)`, then stamp flat text in fill color at origin.

**Rationale:** Per-pixel `outlineRect` outlined every lit pixel individually,
producing an internal "screen door" grid wherever adjacent lit pixels met (visible
as a faint checkerboard inside solid glyph regions). The 4-offset technique draws
the outline at the outer boundary of the entire glyph union, producing a clean 1px
outline with solid fill. Emits exactly 5× the `fillRect` count of `drawText` (4
outline passes + 1 fill pass). Still reuses `DEFAULT_OUTLINE_COLOR` from
`outline-rect.ts`.

### Data correction: `~` (0x7E) glyph hand-authored

The upstream Pascal Stang dataset draws 0x7E (ASCII tilde) as a right arrow
(`→`). This is faithful to the original source but renders incorrectly wherever a
real tilde is expected (e.g. version strings like `v1.0~beta`). The shipped data
replaces this with a hand-authored tilde wave: a single-pixel-wide sine wave
centered in the 5×7 cell. This is the ONLY byte that diverges from upstream Stang.
See `font5x7-data.ts` line 157–170 for the inline rationale.

## Inputs that drove this decision

- `docs/research/bitmap-font.md` (prior art + encoding trade-offs).
- `docs/design/bitmap-font-proposal.md` (Approach A, revised).
- `@architect` critique loop 1 (NEEDS REVISION) + loop 2 (APPROVED).
- `@benchmarker` visual-QA pass (post-implementation, drove the three amendments above).
