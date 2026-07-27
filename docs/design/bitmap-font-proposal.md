# API Proposal: Bitmap / Pixel Font + Text Rendering

> Target pillar: 1 (Primitives). Module: `src/primitives/`.
> Builds on research: `docs/research/bitmap-font.md`.
> Status: DRAFT.

## Consumer Need

Every game in the Spitekeep family needs text rendering — HUD scores ("SCORE 1200"), death screens ("GAME OVER"), level titles, dialogue boxes, counters. Today Spitekeep uses `ctx.fillText` with webfonts (`system-ui, sans-serif`) which:
1. **Breaks pixel-grid integrity** — anti-aliased sub-pixel rendering bleeds across the integer-pixel grid (GDD §11.3 violation).
2. **Is non-deterministic** — `ctx.measureText` returns browser/OS-dependent widths, breaking replay determinism.
3. **Requires a host font** — `ctx.font` triggers a font-load race; no webfont = no text in SSR/headless/benchmarks.
4. **Breaks the asset-less ethos** — a PNG atlas for text is the obvious escape hatch but violates "the algorithm IS the art."

A bitmap font module solves all four: pixel-snapped rendering, pure-arithmetic measurement, zero assets, deterministic layout.

**When it ships, consumers can:**
- Render "SCORE 1200" centered on screen using only `outlineRect` calls — no `ctx.fillText`, no webfont, no PNG atlas.
- Measure text layout in the deterministic core (before any canvas exists).
- Register custom glyphs (hearts, stars, swords) for HUD icons.
- Create custom fonts (demonic, cute) for cosmetic skins without forking the library.

---

## Open Questions — Resolved

### Q1. Glyph encoding format
**Decision: Column-major hex bytes (Pattern 1 from research).**

5 bytes per glyph (one per column, LSB = top row). The Pascal Stang `font5x7.h` data is MIT-licensed, 475 bytes for 95 printable ASCII glyphs, and byte-for-byte identical to the HD44780 LCD ROM from 1987. It is the most widely used encoding in embedded-systems font libraries for 40+ years. Readable (you can grep `{0x7E, 0x11, 0x11, 0x11, 0x7E}` and see 'A'), zero-allocation at render time (bit-test loop, no string conversion), and trivially small. The bitfield encoding (Pattern 3) is noted as a future optimization for hot paths but is unreadable and unsuitable for v1 source code. The Unicode-codepoint integer encoding (Pattern 2) allocates strings per character via `toString(2)` + regex — unacceptable for a zero-alloc hot path.

### Q2. Registry vs single hardcoded font
**Decision: Registry. Ship a `createFont()` factory + a `DEFAULT_FONT` constant.**

The research note's Pattern 5 (lite-bmfont / PixiJS BitmapText) is the right shape. A single hardcoded font would force consumers to fork for custom looks. The registry lets consumers:
- Create custom fonts from their own glyph data via `createFont()`.
- Extend the default font via `addGlyph(font, charCode, glyphData)` (returns a new font — pure progression ops).
- Compose multiple fonts (default 5×7 for HUD, custom 8×8 for dialogue).

The `DEFAULT_FONT` constant provides zero-arg ergonomics for the common case.

### Q3. Character subset
**Decision: Full printable ASCII (95 glyphs, 0x20–0x7E) in v1.**

This includes uppercase A–Z, digits 0–9, lowercase a–z, and all standard punctuation (`! ? . , : ; ' " - + = * / ( ) [ ] < > & % $ # @ \ ^ _ { } | ~`). 95 glyphs × 5 bytes = 475 bytes — negligible. Lowercase is included because dialogue boxes need sentence-case ("You found a key!"). Unicode beyond ASCII is explicitly out of scope — consumers who need it should use a webfont or register custom glyphs.

### Q4. Pure `measureText` design
**Decision: `measureText(text, font, scale)` — ctx-free, pure arithmetic.**

The function takes `(text: string, font: BitmapFont, scale: number)` and returns `{ width: number, height: number, lineCount: number }`. It never accepts a `CanvasRenderingContext2D`. For a monospace font, the algorithm is: count characters per line (manual `for` loop, no `split('\n')` allocation), `width = maxLineLength × cellWidth × scale`, `height = lineCount × (cellHeight + lineGap) × scale`. This is O(n), sub-microsecond for typical HUD strings, deterministic across all environments (Node, browser, SSR, headless benchmarks).

The layer split is confirmed: `measureText` lives in deterministic core (pure, no ctx); `drawText` lives in renderer-adjacent (takes ctx, draws, no simulation-state mutation).

### Q5. Outline vs flat rendering
**Decision: Ship `drawText` (flat fillRect) as the primary; `drawTextOutlined` (outlineRect per pixel) as secondary.**

`drawText` draws each lit pixel as a single `fillRect` — fast, minimal. `drawTextOutlined` draws each lit pixel as an `outlineRect` (fill + 1px outline) — matches the GDD §11.3 art rule for interactive entities. The outline variant is ~4× more fillRect calls per pixel (fill + 4 stroke segments) but matches the existing primitive's visual language. Both are exported. The consumer picks per-use-case: flat for high-density text (debug overlays, score counters); outlined for prominent text (level titles, "GAME OVER").

### Q6. Scale semantics
**Decision: "Pixels per glyph cell" — an integer multiplier.**

`scale = 1` means each glyph pixel is 1×1 (5×7px per glyph). `scale = 2` means each glyph pixel is 2×2 (10×14px per glyph). `scale = 3` means 15×21px. This is the most intuitive model for game HUDs: "I want 21px-tall text" → `scale = 3`. The alternative ("multiplier of native size") means the same thing for a bitmap font, but "pixels per glyph cell" is clearer language for the text use case. The library doesn't have a competing `scale` parameter elsewhere, so no collision.

### Q7. Kerning in v1
**Decision: No kerning in v1. Monospace fonts don't need it. YAGNI.**

Every glyph has the same advance width. Kerning is relevant only for proportional fonts, which are deferred to v2. A `glyphWidths: Uint8Array` field can be added to the `BitmapFont` interface later as a non-breaking additive change.

### Q8. Font-data file location
**Decision: Separate `font5x7-data.ts` file.**

The 475-byte `Uint8Array` lives in `src/primitives/font5x7-data.ts`. The font module (`src/primitives/bitmap-font.ts`) imports it. This matches the library's convention of separating data, types, and implementation. The separate file also lets consumers import the raw data directly if they want to build a renderer without the library's draw functions.

### Q9. Layer split confirmation
**Confirmed.** `measureText` never accepts a ctx. It is a pure function in the deterministic core layer. `drawText` / `drawTextOutlined` accept a `CanvasRenderingContext2D` and are renderer-adjacent. This mirrors the existing `outlineRect` pattern (renderer-adjacent, takes ctx) vs `parallaxOffset` (deterministic core, no ctx).

---

## Approach A: Standalone Functions + Font Object

**Source pattern:** Pattern 1 (column-major hex bytes) + Pattern 5 (font-as-object) from research. Mirrors the library's existing standalone-function convention (`outlineRect`, `measureText` as free functions, not methods on a class).

**Signature sketch:**

```typescript
// src/primitives/bitmap-font-types.ts

/** Bitmap font definition. Immutable after creation. */
export interface BitmapFont {
  /** Font name for debugging and registry lookup. */
  readonly name: string;
  /** Glyph cell width in pixels (advance width). Monospace: same for all glyphs. */
  readonly cellWidth: number;
  /** Glyph cell height in pixels. */
  readonly cellHeight: number;
  /** Vertical gap between lines in pixels (between cell bottom and next line top). */
  readonly lineGap: number;
  /** Glyph data: charCode → column-major byte array. Readonly after creation. */
  readonly glyphs: ReadonlyMap<number, readonly number[]>;
}

/** Pure text measurement result. */
export interface TextMetrics {
  /** Total width in pixels (at given scale). */
  readonly width: number;
  /** Total height in pixels (at given scale). */
  readonly height: number;
  /** Number of lines (split by '\n'). */
  readonly lineCount: number;
}

/** Text alignment for drawText. */
export type TextAlign = 'left' | 'center' | 'right';

/** Draw options for drawText / drawTextOutlined. */
export interface TextDrawOptions {
  readonly font?: BitmapFont;     // defaults to DEFAULT_FONT
  readonly scale?: number;        // pixels per glyph cell, default DEFAULT_TEXT_SCALE
  readonly align?: TextAlign;     // default 'left'
  readonly color?: string;        // fill color, default DEFAULT_TEXT_COLOR
  readonly outline?: string;      // outline color (drawTextOutlined only), default DEFAULT_OUTLINE_COLOR
}
```

```typescript
// src/primitives/bitmap-font.ts

import type { BitmapFont, TextMetrics, TextAlign, TextDrawOptions } from './bitmap-font-types';

/** Default text color (white — high contrast on dark backgrounds). */
export const DEFAULT_TEXT_COLOR = '#ffffff';

/** Default text scale: 3 (21px tall — comfortable for primary HUD text per XAG 101). */
export const DEFAULT_TEXT_SCALE = 3;

/**
 * Default line gap: 1px (HD44780 convention — vertical space between the
 * bottom of one line's cell and the top of the next line's cell).
 * `DEFAULT_FONT` is constructed with `lineGap: DEFAULT_LINE_GAP`.
 */
export const DEFAULT_LINE_GAP = 1;

/**
 * Create a bitmap font from glyph data. For the default 5×7 font, use
 * `lineGap: DEFAULT_LINE_GAP` (1px, HD44780 convention).
 *
 * @param name - font identifier
 * @param cellWidth - glyph cell width in px
 * @param cellHeight - glyph cell height in px
 * @param lineGap - vertical gap between lines in px
 * @param glyphs - charCode → column-major byte array
 */
export function createFont(
  name: string,
  cellWidth: number,
  cellHeight: number,
  lineGap: number,
  glyphs: ReadonlyMap<number, readonly number[]>,
): BitmapFont;

/**
 * Add a glyph to a font, returning a new font (pure — input unchanged).
 */
export function addGlyph(
  font: BitmapFont,
  charCode: number,
  glyphData: readonly number[],
): BitmapFont;

/**
 * Pure text measurement. No ctx, no DOM, no allocation beyond the return object.
 *
 * Height calculation excludes trailing `lineGap` on the last line (standard
 * text-layout convention):
 *
 * ```
 * height = (lineCount - 1) × (cellHeight + lineGap) × scale + cellHeight × scale
 * ```
 *
 * A single line has height = `cellHeight × scale` (no gap). Multi-line text
 * has one `lineGap` per line *break*, not per line.
 *
 * @param text - text to measure (may contain '\n' for multi-line)
 * @param font - bitmap font (defaults to DEFAULT_FONT)
 * @param scale - pixels per glyph cell (default 1)
 */
export function measureText(
  text: string,
  font?: BitmapFont,
  scale?: number,
): TextMetrics;

/**
 * Draw text using flat fillRect calls (one per lit pixel).
 *
 * @param ctx - canvas rendering context
 * @param text - text to draw
 * @param x - left edge (or center/right depending on align)
 * @param y - top edge
 * @param options - draw options (font, scale, align, color)
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options?: TextDrawOptions,
): void;

/**
 * Draw text using outlineRect calls (one per lit pixel — fill + 1px outline).
 * Matches GDD §11.3 art rules for interactive entities.
 */
export function drawTextOutlined(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options?: TextDrawOptions,
): void;

/** Default 5×7 bitmap font (Pascal Stang, MIT-licensed). Full printable ASCII. Constructed with `lineGap: DEFAULT_LINE_GAP`. */
export const DEFAULT_FONT: BitmapFont;
```

**Usage example:**

```typescript
import { drawText, measureText, DEFAULT_FONT, DEFAULT_TEXT_SCALE } from 'aicraft-engine/src/primitives';

// Draw "SCORE 1200" centered on screen
const text = 'SCORE 1200';
const metrics = measureText(text, DEFAULT_FONT, DEFAULT_TEXT_SCALE);
const x = (canvasWidth - metrics.width) / 2;
const y = 20;
drawText(ctx, text, x, y, { scale: DEFAULT_TEXT_SCALE, color: '#ffd66b' });
```

**Trade-offs:**
- **Ergonomics:** Good. Free functions match the library's convention. The `options` bag keeps call sites clean for the common case (`drawText(ctx, text, x, y)` with all defaults). The consumer never needs to construct a font for the common case (`DEFAULT_FONT` is always available).
- **Determinism:** Excellent. `measureText` is pure arithmetic. `drawText` is renderer-adjacent (ctx-dependent) but deterministic for identical inputs.
- **Runtime cost:** Low. One `Map.get(charCode)` per character (O(1)), 35 bit-tests per glyph, one `fillRect` per lit pixel. For 20-char text at scale=3: ~700 `fillRect` calls — well under 1ms.
- **Consumer complexity:** Low. Import `{ drawText, DEFAULT_FONT }`, call `drawText(ctx, text, x, y)`. No setup, no registration.
- **Tree-shake-ability:** Excellent. `measureText` and `drawText` are separate functions. A consumer can import just `measureText` for layout without pulling in any ctx-dependent code.
- **Convention fit:** Matches `outlineRect` (standalone function, takes ctx, uses config defaults). Matches `parallaxOffset` (pure function, no ctx). File naming: `bitmap-font.ts`, `bitmap-font-types.ts`, `font5x7-data.ts`.

**What this makes easy:**
- Drop-in text rendering for any consumer game.
- Pure layout computation without a canvas (SSR, benchmarks, deterministic core).
- Custom fonts via `createFont()` without forking the library.
- Glyph extension via `addGlyph()` for HUD icons.

**What this makes hard:**
- Kerning (not supported in v1 — monospace only).
- Proportional fonts (deferred to v2).
- Emoji rendering (out of scope — use a webfont for emoji).

---

## Approach B: Font Object with Methods

**Source pattern:** Pattern 5 (lite-bmfont / PixiJS BitmapText) — the font is an object that owns `measure` and `draw` methods. More OOP-flavored.

**Signature sketch:**

```typescript
// src/primitives/bitmap-font.ts

export interface BitmapFont {
  readonly name: string;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly lineGap: number;
  readonly glyphs: ReadonlyMap<number, readonly number[]>;

  /** Pure text measurement. No ctx. */
  measure(text: string, scale?: number): TextMetrics;

  /** Draw text using flat fillRect calls. */
  draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, options?: TextDrawOptions): void;

  /** Draw text using outlineRect calls (GDD §11.3). */
  drawOutlined(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, options?: TextDrawOptions): void;

  /** Return a new font with an additional glyph (pure — this font unchanged). */
  addGlyph(charCode: number, glyphData: readonly number[]): BitmapFont;
}

export function createFont(
  name: string,
  cellWidth: number,
  cellHeight: number,
  lineGap: number,
  glyphs: ReadonlyMap<number, readonly number[]>,
): BitmapFont;

export const DEFAULT_FONT: BitmapFont;
```

**Usage example:**

```typescript
import { DEFAULT_FONT } from 'aicraft-engine/src/primitives';

const metrics = DEFAULT_FONT.measure('SCORE 1200', 3);
const x = (canvasWidth - metrics.width) / 2;
DEFAULT_FONT.draw(ctx, 'SCORE 1200', x, 20, { scale: 3, color: '#ffd66b' });
```

**Trade-offs:**
- **Ergonomics:** Slightly better at the call site — `DEFAULT_FONT.draw(ctx, text, x, y)` reads naturally. But methods on an object are less tree-shakeable (importing the font pulls in `draw`, `drawOutlined`, `measure` even if you only need one).
- **Determinism:** Same as Approach A.
- **Runtime cost:** Same as Approach A. The method dispatch adds one virtual call per character — negligible.
- **Consumer complexity:** Slightly higher — consumers must understand the font object model. The methods-on-object pattern is less familiar to developers coming from the Canvas2D API (which uses free functions like `ctx.fillText`).
- **Tree-shake-ability:** Worse. Importing `DEFAULT_FONT` pulls in all methods. A consumer who only needs `measureText` for layout still gets `draw` and `drawOutlined` in their bundle.
- **Convention fit:** Violates the library's existing pattern. Every other primitive is a standalone function (`outlineRect`, `parallaxOffset`, `waveDisplacement`). Methods on objects are the pattern the research note warns against for v1 (too class-like, less composable).

**What this makes easy:**
- Natural OOP usage: `font.draw(ctx, text, x, y)`.
- Method chaining for glyph extension: `font.addGlyph(0x2665, heartData).draw(...)`.

**What this makes hard:**
- Tree-shaking (all methods bundled together).
- Composability (can't pass `font.draw` as a callback without binding).
- Convention alignment (every other primitive is a free function).

---

## Approach C: Standalone Functions Only (No Font Object)

**Source pattern:** Pattern 1 (column-major hex bytes) + the library's existing convention of flat function exports. The font is a plain data object (interface), not a behavior object. All operations are free functions.

**Signature sketch:**

```typescript
// src/primitives/bitmap-font-types.ts

export interface BitmapFont {
  readonly name: string;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly lineGap: number;
  readonly glyphs: ReadonlyMap<number, readonly number[]>;
}

export interface TextMetrics {
  readonly width: number;
  readonly height: number;
  readonly lineCount: number;
}

export type TextAlign = 'left' | 'center' | 'right';
```

```typescript
// src/primitives/bitmap-font.ts

/** Create a font from raw parameters. */
export function createFont(...): BitmapFont;

/** Add a glyph, returning a new font. */
export function addGlyph(font, charCode, glyphData): BitmapFont;

/** Pure measurement. */
export function measureText(text, font?, scale?): TextMetrics;

/** Draw with flat fillRect. */
export function drawText(ctx, text, x, y, font?, scale?, color?, align?): void;

/** Draw with outlineRect. */
export function drawTextOutlined(ctx, text, x, y, font?, scale?, color?, outline?): void;

export const DEFAULT_FONT: BitmapFont;
```

**Usage example:**

```typescript
import { drawText, measureText, DEFAULT_TEXT_SCALE } from 'aicraft-engine/src/primitives';

// drawText uses DEFAULT_FONT implicitly
drawText(ctx, 'SCORE 1200', 100, 20);
drawText(ctx, 'SCORE 1200', 100, 20, undefined, DEFAULT_TEXT_SCALE, '#ffd66b', 'center');
```

**Trade-offs:**
- **Ergonomics:** Poor for `drawText`. The positional parameter list after `y` is confusing: `drawText(ctx, text, x, y, undefined, 3, '#ffd66b', 'center')` — the `undefined` for font is ugly. Options bags (Approach A) are cleaner.
- **Determinism:** Same as Approach A.
- **Runtime cost:** Same as Approach A.
- **Consumer complexity:** High. Consumers must remember parameter order and pass `undefined` for defaults they want to skip. The positional API is error-prone.
- **Tree-shake-ability:** Excellent. Same as Approach A.
- **Convention fit:** Matches the library's flat-function convention, but the parameter ordering is worse than the options-bag pattern.

**What this makes easy:**
- Simple imports (no types to worry about for basic use).
- Maximum tree-shaking.

**What this makes hard:**
- Call-site readability (positional params after `y`).
- Default parameter management (passing `undefined` for skipped params).
- Extensibility (adding a new option later requires adding a positional parameter — breaking change).

---

## Comparison Table

| Criterion | A: Functions + Options Bag | B: Font Object Methods | C: Functions Only |
|---|---|---|---|
| **Ergonomics** | ★★★★ clean options bag, familiar pattern | ★★★★ natural OOP at call site | ★★ positional params after y are ugly |
| **Determinism** | ★★★★★ pure measureText, deterministic draw | ★★★★★ same | ★★★★★ same |
| **Runtime cost** | ★★★★ Map.get + bit-tests + fillRect | ★★★★ same + one virtual call | ★★★★ same |
| **Consumer complexity** | ★★★★ import + call, options for defaults | ★★★ understand font object model | ★★ must remember param order |
| **Tree-shake-ability** | ★★★★★ separate functions | ★★★ all methods bundled | ★★★★★ separate functions |
| **Convention fit** | ★★★★★ matches outlineRect/parallaxOffset | ★★ violates flat-function convention | ★★★★ flat but positional params |
| **Extensibility** | ★★★★★ add fields to options bag (additive) | ★★★★ add methods to interface | ★★ adding params is breaking |

---

## Recommendation

**Approach A: Standalone Functions + Options Bag.**

This is the right balance of ergonomics, tree-shake-ability, and convention alignment. The options bag (`TextDrawOptions`) keeps call sites clean for the common case (`drawText(ctx, text, x, y)` with all defaults) while remaining extensible (adding `letterSpacing` or `lineHeight` later is additive — new optional field on the bag, not a new positional parameter). The standalone functions match every other primitive in the library (`outlineRect`, `parallaxOffset`, `waveDisplacement`). The `DEFAULT_FONT` constant provides zero-arg ergonomics.

Approach B's font-object pattern is more OOP-flavored but violates the library's flat-function convention and hurts tree-shaking. Approach C's positional params are extensibility poison — every new option is a potential breaking change.

**Implementation constraints for @coder:**
1. `measureText` must NEVER accept a `CanvasRenderingContext2D`. Pure arithmetic only.
2. `drawText` and `drawTextOutlined` MUST use `fillRect` / `outlineRect` primitives. NEVER use `ctx.fillText` or `ctx.font`.
3. `DEFAULT_FONT` is built from `font5x7-data.ts` (Pascal Stang, MIT-licensed, 95 glyphs × 5 bytes = 475 bytes).
4. `addGlyph` returns a new `BitmapFont` (pure progression ops — input never mutated).
5. All types go in `bitmap-font-types.ts`. Implementation in `bitmap-font.ts`. Data in `font5x7-data.ts`. Barrel in `index.ts`.
6. The types file (`bitmap-font-types.ts`) ALSO carries a `@module` header, same as the implementation files.
7. Every public export gets JSDoc with `@param`, `@returns`, and a usage example.
8. `addGlyph` JSDoc must note "setup-time only — not intended for per-frame use" to document the Map-copy cost.
9. Test file: `src/tests/bitmap-font.test.ts`.

---

## Locked-in Architect Verdicts

The following five points were reviewed by `@architect` and confirmed as-is (no revision required):

1. **Options-bag allocation per `drawText` call** — Acceptable. One object per call is negligible at typical call rates (10–50 `drawText` calls per frame). The frozen-default-alternative still allocates; the options bag is the cleaner extensibility path.

2. **`addGlyph` copy cost** — Acceptable. `addGlyph` shallow-copies the `glyphs` Map (95 entries for the default font). This is a setup-time-only operation (called once per custom font, not per frame). Documented in its JSDoc as "setup-time only".

3. **`DEFAULT_TEXT_SCALE = 3` (21px)** — Confirmed. Spitekeep's existing HUD uses `ctx.font = 'bold 14px sans-serif'` (≈scale 2), but `scale = 3` is the right library default for legibility per XAG 101. Consumers who want the 14px look pass `scale: 2` explicitly — the options bag makes this trivial.

4. **`drawTextOutlined` reuses `DEFAULT_OUTLINE_COLOR` (#1d1128)** — Confirmed. The `TextDrawOptions.outline` field defaults to `DEFAULT_OUTLINE_COLOR`, matching the existing outline primitive. Overridable per-call via `options.outline`.

5. **Trailing `lineGap` excluded from `measureText` height** — Confirmed (BLOCKER resolved). See the `measureText` JSDoc contract above for the exact formula.
