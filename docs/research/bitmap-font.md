# Bitmap / Pixel Font + Text Rendering

> Research note for an asset-less bitmap/pixel font + text rendering module. Slug: `bitmap-font`.
> Investigated: 2026-07-26.

## TL;DR

The library has no text rendering primitive anywhere — every HUD, score, menu, and dialogue box in a consumer game currently has to either pull in a webfont (anti-aliased, breaks the pixel-grid aesthetic and the WCAG-AA contrast rule on dark backgrounds) or ship a PNG atlas (breaks the "the algorithm IS the art" ethos). This note surveys the canonical 5×7 / 8×8 pixel-font lineage (HD44780 LCD ROM, Pascal Stang's `font5x7.h`, Tom Thumb 3×5/4×6, Robey Pointer's CC0 BDF, the demoscene bitfield renderer), the three dominant glyph-data encoding styles (column-major hex bytes, row-major Unicode-codepoint integers, packed bitfields), the JS13k / demoscene / Sokpop patterns for minimal text systems under tight size budgets, and the design of a pure `measureText` that does not require a Canvas2D context (needed for layout determinism and SSR safety). The top recommendations are: (a) ship a **monospace 5×7 font** as the v1 default (column-major hex bytes, ASCII A–Z + 0–9 + basic punctuation, ~95 glyphs × 5 bytes = ~475 bytes of data — trivially fits the zero-dep ethos), (b) ship a **glyph REGISTRY** (not a hardcoded singleton) so consumers can register custom glyphs without forking the library, (c) ship a **pure `measureText`** that takes `(text, font, scale)` and returns `{width, height, lines}` without touching a canvas, and (d) draw text as a sequence of `outlineRect` calls (one per lit pixel) so it composes cleanly with the existing flat-fill + 1px-outline primitive and inherits its contrast behavior.

## Why this matters for aicraft-engine

- **Pillars Touched**: Directly extends **Pillar 1 (Primitives / Rendering)**. Composes with `outlineRect` (the existing flat-fill + 1px-outline primitive) for the per-pixel draw call, with `color.ts` for the WCAG-AA contrast check on text colors, and with `motion.ts` for the `prefers-reduced-motion` probe (text shouldn't blink or scroll if the user opted out).
- **Consumer Games**: Spitekeep (HUD score, death-screen text, level-title cards, dialogue boxes), any future Clone-to-Jest title (idle-game counters, card labels, village-builder item names, platformer level intros). Every game in the Sokpop catalog has at least one text overlay — this is the most-requested missing primitive.
- **Unlocks**:
  - **Zero-asset text**: HUDs, scores, menus, and dialogue boxes render from code, no webfont fetch, no PNG atlas, no font-loader race condition. The library stays asset-less end-to-end.
  - **Pixel-grid integrity**: Webfonts render with sub-pixel anti-aliasing that bleeds across the integer-pixel grid and breaks the "flat colors, 1px outline, integer pixels" GDD §11.3 rule. Bitmap fonts snap cleanly to the grid.
  - **Deterministic layout**: A pure `measureText` (no `ctx.measureText`) means text layout is reproducible across machines, replays, SSR, and headless benchmarks — the same input always produces the same width.
  - **Cosmetic surface**: A bitmap font is a `CosmeticManifest` candidate — skins can ship alternate fonts (e.g., a "demonic" font for the IMP skin, a "cute" font for the village-builder skin) without any image asset, just a different glyph table.

---

## Prior Art Survey

### Pattern 1: Column-Major Hex-Byte Glyph Tables (HD44780 / Pascal Stang `font5x7.h`)

- **Source**: Pascal Stang's `font5x7.h` (https://andygock.github.io/glcd-documentation/font5x7_8h_source.html), the HD44780 LCD controller ROM (https://eleif.net/HD44780.html), the GLCD library (https://github.com/andygock/glcd), the AVR-Libc standard 5×7 font, and the Model 100 font (https://trmm.net/5x7/).
- **What it does**: Each glyph is stored as **5 bytes**, one byte per column, where each byte's bits represent the 7 rows of that column (LSB = top row, bit 6 = bottom row, bit 7 = unused). The glyph for `'A'` is `{0x7E, 0x11, 0x11, 0x11, 0x7E}` — column 0 has bits 1-5 set (the left vertical stroke), column 4 has bits 1-5 set (the right vertical stroke), and the middle three columns have bits 1 and 5 set (the crossbar). The table is a flat `Uint8Array` indexed by `(charCode - 0x20) * 5`.
- **Algorithmic shape**:

```typescript
// 95 ASCII glyphs × 5 bytes each = 475 bytes of data
// (verified verbatim from Pascal Stang's font5x7.h, MIT license)
const FONT_5X7: Uint8Array = new Uint8Array([
  0x00, 0x00, 0x00, 0x00, 0x00, // (space)
  0x00, 0x00, 0x5F, 0x00, 0x00, // !
  0x00, 0x07, 0x00, 0x07, 0x00, // "
  0x14, 0x7F, 0x14, 0x7F, 0x14, // #
  // ... 91 more glyphs ...
  0x7E, 0x11, 0x11, 0x11, 0x7E, // A
  0x7F, 0x49, 0x49, 0x49, 0x36, // B
  // ...
  0x08, 0x1C, 0x2A, 0x08, 0x08, // <-
]);

// Render one glyph by iterating columns and rows
function drawGlyphA(ctx, x, y, scale, color) {
  for (let col = 0; col < 5; col++) {
    const bits = FONT_5X7[('A'.charCodeAt(0) - 0x20) * 5 + col];
    for (let row = 0; row < 7; row++) {
      if ((bits >> row) & 1) {
        ctx.fillStyle = color;
        ctx.fillRect(x + col * scale, y + row * scale, scale, scale);
      }
    }
  }
}
```

- **Determinism profile**: Pure data + pure iteration. No `Math.random`, no `Date.now()`, no global state. Fully deterministic. Same `(charCode, scale)` → same pixels, forever.
- **Runtime cost**: 5 columns × 7 rows = 35 bit-tests per glyph. At `scale=2` (HUD-readable), that's 35 `fillRect` calls per character. For a 20-character score ("SCORE: 0000123456"), that's 700 `fillRect` calls per frame — well under 1ms on modern hardware. The dominant cost is the `fillRect` call itself, not the bit-test.
- **Dependencies**: None. The font data is a `Uint8Array` literal in the source file.
- **Fit for our constraints**: **Strong.** This is the canonical representation used by every embedded-systems font library for 40+ years. It is byte-for-byte the same data the HD44780 LCD controller shipped in ROM in 1987 — proven, battle-tested, and zero-dep. The 475-byte data size is negligible compared to the rest of the library.
- **What to steal**: The column-major encoding (one byte per column, LSB = top row). The flat `Uint8Array` indexed by `(charCode - 0x20) * 5`. The 5×7 cell size (5 columns wide, 7 rows tall, 1px gap between glyphs). The Pascal Stang font data itself (MIT-licensed, includes full printable ASCII 0x20–0x7E).
- **What to avoid**: Don't store the font as a 2D array of strings (`["00111", "10001", ...]`) — that's 7× the memory and 7× the parse cost. Don't store it as a `Map<string, number[]>` — that's 20× the memory and requires a hash lookup per character. The flat `Uint8Array` is the right shape.

### Pattern 2: Unicode-Codepoint Integer Glyph Tables (darkwebdev/tinyfont.js)

- **Source**: darkwebdev/tinyfont.js (https://github.com/darkwebdev/tinyfont.js, MIT, <700 bytes zipped, designed for js13k), PaulBGD/PixelFont (https://github.com/PaulBGD/PixelFont, MIT).
- **What it does**: Each glyph is stored as a **single integer** whose binary representation IS the glyph bitmap. The integer's bits are packed column-by-column (or row-by-row), and the codepoint IS the array index. The font for `'A'` is `15951` = binary `0011111000101001001001111` = 15 bits = 3 columns × 5 rows (Tom Thumb's 3×5 cell). The font for `'M'` is `33059359` = 25 bits = 5 columns × 5 rows. The font table is a sparse array indexed by `charCodeAt(0)`, with empty slots (`,`) for unsupported glyphs.
- **Algorithmic shape** (verbatim from tinyfont.js):

```typescript
// 95-glyph font as a sparse array indexed by charCode
// Each entry is either a number (the packed bitmap) or empty (unsupported)
// (verified verbatim from tinyfont.js src/fonts/pixel.js, MIT license)
export const font = [
  ...Array(33),                          // 0-32: control chars (empty)
  29,                                    // 33: '!' = 11101 (3 bits, 1 col × 3 rows)
  ,                                      // 34: '"' (unsupported)
  // ...
  "㹏",  // 65: 'A' = 15951 = 011111001001001111 (3 cols × 5 rows)
  "纮",  // 66: 'B' = 32430 = 111111010101001110 (3 cols × 5 rows)
  "縱",  // 67: 'C' = 32305 = 111111000100010001 (3 cols × 5 rows)
  // ...
  33059359,  // 77: 'M' = 1111110000100000111001000011111 (5 cols × 5 rows)
  // ...
];

// Render: convert number to binary string, split into columns, draw each bit
function renderChar(fontCode, ctx, x, y, size, color) {
  const binary = fontCode.toString(2).padStart(width * height, '0');
  const cols = binary.match(new RegExp(`.{${height}}`, 'g'));
  for (let col = 0; col < cols.length; col++) {
    for (let row = 0; row < height; row++) {
      if (cols[col][row] === '1') {
        ctx.fillRect(x + col * pixelSize, y + row * pixelSize, pixelSize, pixelSize);
      }
    }
  }
}
```

- **Determinism profile**: Pure data + pure iteration. Fully deterministic.
- **Runtime cost**: One `toString(2)` per character (allocates a string — GC pressure), one regex split per character (allocates an array — more GC pressure), then 15–35 bit-tests. The string allocation is the hidden cost — at 60fps with a 20-character score updating every frame, that's 1200 string allocations per second. Not catastrophic, but not free either.
- **Dependencies**: None.
- **Fit for our constraints**: **Medium.** The encoding is more compact than the column-major hex (1 number vs 5 bytes per glyph), but the runtime cost is higher (string allocation + regex split per character). The clever trick of using Unicode codepoints as the integer values (e.g., `"㹏"` for `'A'`) is a neat size hack for js13k but adds cognitive overhead — a reader has to look up the codepoint to know what glyph it is. For a library that prioritizes readability over byte count, the explicit hex bytes are better.
- **What to steal**: The **sparse-array-by-charCode** indexing pattern. The idea that the font table is just a `readonly Uint8Array` (or `readonly number[]`) indexed by `charCodeAt(0)`. The convention of leaving unsupported glyphs as empty/undefined (no error, just a missing-glyph box or skip).
- **What to avoid**: The Unicode-codepoint-as-integer trick — clever but unreadable. The `toString(2)` + regex split — allocates per character, defeats the zero-alloc hot path. The 3×5 cell size — too small for HUD readability at scale=1 (the Tom Thumb font is designed for terminal use at 6px tall, not for game HUDs at 14–28px tall).

### Pattern 3: Packed Bitfield Glyphs (Demoscene / 256-byte Intros)

- **Source**: Anders de Flon's "Tiny bitfield based text renderer" (https://www.onirom.fr/wiki/blog/25-09-2022_tiny_bitfield_based_text_renderer/), the Centurio 256-byte DOS intro (Baudsurfer/RSI), the Axon intro (Baudsurfer), the ianhan/BitmapFonts demoscene archive (https://github.com/ianhan/BitmapFonts).
- **What it does**: Under extreme size constraints (256-byte intros, 4KB JS13k entries), the entire font is packed into a **single integer or a small array of integers**, with each integer holding one row of one glyph (or one column, depending on orientation). The renderer iterates bits via `shr eax, cl` / `bt esi, ebp` / `sbb edi, edi` — pure bit manipulation, no allocation, no string conversion. The Centurio intro's entire "RSI" logo is a single 32-bit value (`0x171445dd`) that decodes to 30 bits of glyph data.
- **Algorithmic shape** (from the onirom.fr article, 3×3 monospace font):

```typescript
// 3×3 monospace font: each glyph is 9 bits = 3 cols × 3 rows
// Pack 3 glyphs into a single 32-bit value (27 bits used)
// (verified from onirom.fr/wiki/blog/25-09-2022_tiny_bitfield_based_text_renderer)

// "ORZ" packed into a single 32-bit integer:
//   O = 111111110 (row 0) | 101100010 (row 1) | 111100011 (row 2)
//   R = 111111110 (row 0) | 101100010 (row 1) | 111100011 (row 2)
//   Z = 111111110 (row 0) | 101100010 (row 1) | 111100011 (row 2)
// Packed: (row2 << 18) | (row1 << 9) | row0 = 104667903

const logo = 104667903;

// Render: extract bits via shift + AND
function renderRow(logo, row, width) {
  for (let x = 0; x < width; x++) {
    const bit = (logo >> (row * width + x)) & 1;
    if (bit) drawPixel(x, row);
  }
}
```

- **Determinism profile**: Pure bit manipulation. Fully deterministic.
- **Runtime cost**: O(1) per pixel — one shift, one AND, one branch. The absolute fastest possible renderer. The Centurio intro renders its logo in 30 bytes of x86 code.
- **Dependencies**: None.
- **Fit for our constraints**: **Weak for v1, strong for a future optimization.** The bitfield encoding is the smallest possible representation (one integer per glyph, or even one integer per string), but it is fundamentally **unreadable** — you cannot grep a bitfield and see what the glyph looks like. For a library that prioritizes "the algorithm IS the art" and ships source code that consumers will read and modify, the column-major hex bytes are the right v1 choice. The bitfield encoding is worth noting as a future optimization path if a consumer needs to render thousands of characters per frame (e.g., a typing-game or a chat log).
- **What to steal**: The **bit-test-and-branch** rendering loop (`if ((bits >> row) & 1) drawPixel()`). The observation that the renderer is just a tight inner loop over bits — no allocation, no string conversion, no regex. The idea that the font data and the renderer are **separate concerns** — the data is just bits, the renderer doesn't care how the bits are packed.
- **What to avoid**: The bitfield encoding for v1 — too clever, too unreadable. The 3×3 cell size — too small for game HUDs. The single-integer-per-string packing — only works for short fixed strings (logos, titles), not for arbitrary user input.

### Pattern 4: Pure `measureText` Without Canvas (Pretext / SSR Layout)

- **Source**: chenglou/pretext (https://github.com/chenglou/pretext, MIT, ~15KB gzipped, 600× faster than DOM measurement), darkroomengineering/fitbox (https://github.com/darkroomengineering/fitbox, MIT, ~1.25KB core).
- **What it does**: Pretext splits text layout into two phases: **prepare** (one-time, uses `ctx.measureText` to cache glyph widths) and **layout** (pure arithmetic, no DOM, no canvas, no reflow). The `layout` function takes a prepared handle + container width + line height and returns `{height, lineCount}` in ~0.001ms — fast enough to call thousands of times per frame. Fitbox uses the same pattern for SSR text fitting: prepare on the server with `@napi-rs/canvas`, ship the prepared handle to the client, hydrate with no layout shift.
- **Algorithmic shape** (the pattern, not the full library):

```typescript
// Phase 1: prepare (one-time, may use ctx.measureText)
// Phase 2: layout (pure arithmetic, no DOM)

// For a bitmap font, the "prepare" phase is trivial —
// every glyph has a known advance width (the cell width).
// The "layout" phase is just: count characters × advance + line breaks.

// Pure measureText for a monospace bitmap font:
function measureText(text: string, font: BitmapFont, scale: number): TextMetrics {
  const lines = text.split('\n');
  const cellWidth = font.cellWidth * scale;
  const cellHeight = font.cellHeight * scale;
  const lineHeight = (font.cellHeight + font.lineGap) * scale;
  return {
    width: Math.max(...lines.map(line => line.length * cellWidth)),
    height: lines.length * lineHeight,
    lineCount: lines.length,
  };
}
```

- **Determinism profile**: Pure arithmetic. No `ctx.measureText`, no DOM, no reflow. Fully deterministic. Same `(text, font, scale)` → same `{width, height, lineCount}`, forever.
- **Runtime cost**: O(n) where n is text length. One string split (allocates an array — could be avoided with a manual scan), one `Math.max` over lines, one multiply per character. Sub-microsecond for typical HUD strings.
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** This is exactly the pattern the library needs. A bitmap font has **known advance widths** (every glyph is the same width in monospace, or a known per-glyph width in proportional), so the "prepare" phase is just reading the font's `cellWidth` field — no `ctx.measureText` call needed at all. The `measureText` function is 100% pure arithmetic, safe to call from deterministic code, safe to call in SSR, safe to call in headless benchmarks.
- **What to steal**: The **two-phase split** (prepare once, layout many times). The observation that for a bitmap font, the prepare phase is trivial — no canvas measurement needed. The pure-arithmetic layout phase that returns `{width, height, lineCount}` in O(n).
- **What to avoid**: Don't import Pretext — it's 15KB gzipped and solves a problem (CJK + Unicode + ligatures) we don't have. Don't use `ctx.measureText` at all — it breaks determinism (depends on the browser's font engine) and breaks SSR (no canvas in Node). The pure-arithmetic approach is the right shape for a bitmap font.

### Pattern 5: Glyph Registry Pattern (lite-bmfont / PixiJS BitmapText)

- **Source**: PeshoVurtoleta/lite-bmfont (https://github.com/PeshoVurtoleta/lite-bmfont, MIT, ~1.3KB gzipped), PixiJS BitmapText (https://pixijs.com/8.x/guides/components/scene-objects/text/bitmap), Phaser DynamicBitmapText.
- **What it does**: The font is an **object** (not a singleton) that can be constructed from a glyph table + metrics. Consumers can create custom fonts by passing their own glyph data, or compose multiple fonts (e.g., a base ASCII font + a custom icon font for game-specific symbols). The font object exposes `measure(text, scale)` and `draw(ctx, text, x, y, scale, align)` methods. Multiple font instances can coexist — a HUD uses the default 5×7, a dialogue box uses a custom 8×8, a logo uses a custom 16×16.
- **Algorithmic shape**:

```typescript
// Font as an object, not a singleton
interface BitmapFont {
  readonly name: string;
  readonly cellWidth: number;      // advance width per glyph (monospace = same for all)
  readonly cellHeight: number;     // glyph height in pixels
  readonly lineGap: number;        // gap between lines (usually 1-2 px)
  readonly glyphs: ReadonlyMap<number, GlyphData>;  // charCode → glyph
  measure(text: string, scale: number): TextMetrics;
  draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, align?: Alignment): void;
}

// Default font shipped with the library
const DEFAULT_FONT: BitmapFont = createFont5x7();

// Consumer can register a custom font
const DEMONIC_FONT: BitmapFont = createFont({
  name: 'demonic',
  cellWidth: 6,
  cellHeight: 9,
  lineGap: 2,
  glyphs: customGlyphData,  // consumer's own bitmap data
});

// Consumer can compose: register a custom glyph into an existing font
DEFAULT_FONT.registerGlyph(0x00A1, customInvertedExclamationData);
```

- **Determinism profile**: The font object is immutable (all fields `readonly`). `measure` and `draw` are pure functions of `(text, scale)` and `(ctx, text, x, y, scale, align)`. Fully deterministic.
- **Runtime cost**: Same as Pattern 1 (35 bit-tests per glyph). The registry overhead is a single `Map.get(charCode)` lookup per character — O(1), negligible.
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** This is the right shape for a library that needs to support multiple fonts without forking. The default font is the 5×7 Pascal Stang data; consumers can create custom fonts for skins, dialogue boxes, logos, etc. The `registerGlyph` extension point allows consumers to add custom symbols (e.g., a heart icon for a health HUD) to the default font without redefining the whole table.
- **What to steal**: The **font-as-object** pattern (not a singleton). The `ReadonlyMap<number, GlyphData>` glyph table. The `measure` + `draw` method pair. The `registerGlyph` extension point for non-breaking expansion.
- **What to avoid**: Don't make the font a class with mutable state — the library's pure-progression-ops discipline says state should be immutable. Don't require consumers to pass a font to every `drawText` call — provide a `DEFAULT_FONT` constant for the common case. Don't support proportional fonts in v1 — the cell-width uniformity is what makes `measureText` trivial.

---

## Glyph Encoding Trade-off Matrix

| Encoding | Bytes per glyph | Readability | Render speed | Measure speed | Best for |
|---|---|---|---|---|---|
| **Column-major hex bytes** (Pattern 1) | 5 | High (grep-friendly) | Fast (35 bit-tests) | Trivial (cellWidth × charCount) | **v1 default** — readable, fast, small |
| **Row-major Unicode-codepoint integers** (Pattern 2) | 4 (avg, for 3×5) | Low (codepoint lookup) | Slow (string alloc + regex) | Trivial | js13k size hacks — not for us |
| **Packed bitfield** (Pattern 3) | 1–4 | Very low (binary soup) | Fastest (1 shift + 1 AND) | Trivial | Future optimization for hot paths |
| **2D string array** (e.g., `["00111", "10001"]`) | 7+ | Highest (visual) | Slow (string parse) | Trivial | Debugging only — not for shipping |
| **Coordinate/rect-list atlas** | 8+ per rect | Medium | Slow (rect iteration) | Trivial | Variable-width glyphs (proportional) |

**Recommendation: Column-major hex bytes (Pattern 1) for v1.** The 5×7 Pascal Stang data is 475 bytes, MIT-licensed, includes full printable ASCII, and is byte-for-byte the same data the HD44780 shipped in 1987. The encoding is grep-friendly (you can see `'A'` is `{0x7E, 0x11, 0x11, 0x11, 0x7E}` and understand it), the renderer is a tight inner loop with no allocation, and `measureText` is trivial multiplication. The bitfield encoding (Pattern 3) is worth noting as a future optimization if a consumer needs to render thousands of characters per frame.

---

## Character Subset Analysis

Game HUDs and score displays need a small, well-defined character set. The full printable ASCII (95 glyphs, 0x20–0x7E) is the right v1 baseline:

| Category | Characters | Count | Why |
|---|---|---|---|
| **Uppercase letters** | A–Z | 26 | Game titles, menu headers, level names, "GAME OVER", "YOU WIN" |
| **Digits** | 0–9 | 10 | Scores, timers, counters, combo displays, FPS |
| **Basic punctuation** | `! ? . , : ; ' " - + = * / ( ) [ ]` | 18 | Dialogue ("Hello!", "You win!"), stats ("HP: 100", "+50"), formatting |
| **Space** | (space) | 1 | Word separation |
| **Total** | | **55** | Covers ~95% of game HUD text |

**Optional v1 additions** (if data size budget allows):
- Lowercase letters a–z (26 more) — for dialogue boxes that want sentence-case ("You found a key!")
- Extended punctuation `< > & % $ # @ \ ^ _ { } | ~` — for special stats and tooltips

**Explicitly NOT in v1:**
- Unicode beyond ASCII (no accented characters, no CJK, no emoji) — the library is for game HUDs, not internationalized prose. Consumers who need Unicode should use a webfont or ship their own bitmap font.
- Box-drawing characters — the library already has `outlineRect` for drawing boxes; consumers can compose boxes + text.
- Icon glyphs (hearts, stars, swords) — consumers should register these as custom glyphs via the registry extension point.

**Why monospace-only in v1:**
- **Trivial `measureText`**: every glyph has the same advance width, so `width = charCount × cellWidth`. No per-glyph width table needed.
- **Pixel-grid integrity**: monospace cells align cleanly to the integer-pixel grid, no sub-pixel rounding.
- **Game HUD convention**: scores, timers, and counters are almost always monospace (think Sokpop's Stacklands, Spitekeep's score display, every arcade game ever made).
- **Non-breaking expansion**: a proportional variant can be added later by adding a `glyphWidths: Uint8Array` field to the font object. Existing monospace code keeps working.

---

## Pure `measureText` Design

The library needs a `measureText` that does NOT call `ctx.measureText`. Reasons:

1. **Determinism**: `ctx.measureText` depends on the browser's font engine. Different browsers (Chrome vs Firefox vs Safari) can return different widths for the same text. Different OS font fallbacks can return different widths. This breaks replay determinism.
2. **SSR safety**: `ctx.measureText` requires a Canvas2D context. In Node.js (SSR, headless benchmarks, tests), there is no canvas. A pure `measureText` works everywhere.
3. **Performance**: `ctx.measureText` is slow (~0.5–2ms per call, forces layout reflow). For a HUD that updates every frame, that's 30–120ms per second spent on measurement alone. A pure `measureText` is sub-microsecond.
4. **Composability**: a pure `measureText` can be called inside the deterministic core (e.g., to compute UI layout before rendering). A `ctx.measureText` call would leak the canvas into the deterministic core, violating the layer separation.

**Design** (for a monospace font):

```typescript
interface TextMetrics {
  readonly width: number;     // total width in pixels (at scale=1)
  readonly height: number;    // total height in pixels (at scale=1)
  readonly lineCount: number; // number of lines (split by '\n')
}

function measureText(text: string, font: BitmapFont, scale: number = 1): TextMetrics {
  // For monospace: width = max line length × cellWidth
  // For proportional (future): width = sum of glyph advances per line
  let maxLineLength = 0;
  let currentLineLength = 0;
  let lineCount = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 0x0A) {  // '\n'
      if (currentLineLength > maxLineLength) maxLineLength = currentLineLength;
      currentLineLength = 0;
      lineCount++;
    } else {
      currentLineLength++;
    }
  }
  if (currentLineLength > maxLineLength) maxLineLength = currentLineLength;
  return {
    width: maxLineLength * font.cellWidth * scale,
    height: lineCount * (font.cellHeight + font.lineGap) * scale,
    lineCount,
  };
}
```

**Properties:**
- **Pure**: no canvas, no DOM, no global state. Safe to call from deterministic code.
- **Deterministic**: same `(text, font, scale)` → same output, forever.
- **Fast**: O(n) where n is text length. No allocation (the `for` loop avoids the `split('\n')` allocation). Sub-microsecond for typical HUD strings.
- **SSR-safe**: works in Node.js, headless benchmarks, tests.
- **Composable**: can be called inside the deterministic core to compute layout before rendering.

**Alignment math** (for `drawText`):

```typescript
type Alignment = 'left' | 'center' | 'right';

function alignX(x: number, text: string, font: BitmapFont, scale: number, align: Alignment): number {
  const metrics = measureText(text, font, scale);
  switch (align) {
    case 'left':   return x;
    case 'center': return x - metrics.width / 2;
    case 'right':  return x - metrics.width;
  }
}
```

---

## Legibility & Accessibility

**Minimum glyph scale for readability:**
- At `scale=1` (5×7 pixels per glyph), the text is ~7px tall. This is **below** the WCAG-recommended 16px minimum for body text and **below** the EA Sports / XAG-recommended 28px minimum for game HUD text.
- At `scale=2` (10×14 pixels per glyph), the text is ~14px tall. **Acceptable** for secondary HUD text (small labels, tooltips).
- At `scale=3` (15×21 pixels per glyph), the text is ~21px tall. **Comfortable** for primary HUD text (scores, timers, menu items).
- At `scale=4` (20×28 pixels per glyph), the text is ~28px tall. **Recommended** for game HUD text per industry guidelines (EA Sports, XAG 101).

**Recommendation:** ship a `DEFAULT_TEXT_SCALE = 3` constant (21px tall) as the default for `drawText`. Document the WCAG / XAG guidelines in the JSDoc. Consumers can override per-call.

**WCAG contrast:**
- The `drawText` function should accept a `color: string` parameter (the text fill color) and the consumer is responsible for ensuring the text color contrasts with the background per WCAG AA (≥4.5:1).
- The library's existing `meetsWcagAa(foreground, background)` from `src/primitives/color.ts` is the right tool for consumers to validate their text colors.
- The library should NOT auto-validate contrast on every `drawText` call (too slow, too opinionated). Instead, document the requirement and provide the tool.

**Reduced motion:**
- Text that blinks, scrolls, or fades should respect `prefers-reduced-motion` via the existing `prefersReducedMotion()` probe from `src/primitives/motion.ts`.
- Static text (scores, menu items) is unaffected.

---

## Reference Implementations

| Source | What it teaches | URL |
|---|---|---|
| **Pascal Stang `font5x7.h`** | Canonical 5×7 column-major hex data, MIT-licensed, full printable ASCII. The exact data we should ship. | https://andygock.github.io/glcd-documentation/font5x7_8h_source.html |
| **HD44780 LCD ROM** | The original 5×7 font from 1987. Public-domain (datasheet). Useful for historical context and as a fallback if Stang's data is unavailable. | https://eleif.net/HD44780.html |
| **Tom Thumb (Robey Pointer)** | 3×5 / 4×6 monospace font, CC0 / CC-BY 3.0. Smaller than 5×7 but harder to read at game-HUD sizes. Good reference for the "tiny font" use case. | https://robey.lag.net/2010/01/23/tiny-monospace-font.html |
| **darkwebdev/tinyfont.js** | js13k-sized pixel font renderer, MIT, <700 bytes zipped. Shows the Unicode-codepoint-as-integer encoding trick. | https://github.com/darkwebdev/tinyfont.js |
| **Anders de Flon bitfield renderer** | Demoscene bitfield text renderer. Shows the extreme-size-optimization path (single 32-bit integer per string). | https://www.onirom.fr/wiki/blog/25-09-2022_tiny_bitfield_based_text_renderer/ |
| **chenglou/pretext** | Pure-arithmetic text layout (no DOM, no reflow). Shows the prepare/layout two-phase pattern. We don't import it, but the pattern is exactly right for our `measureText`. | https://github.com/chenglou/pretext |
| **PeshoVurtoleta/lite-bmfont** | Zero-GC bitmap font renderer with O(1) kerning LUT, multi-line alignment. Shows the font-as-object pattern and the alignment math. | https://github.com/PeshoVurtoleta/lite-bmfont |
| **ianhan/BitmapFonts** | Massive demoscene bitmap font archive. Useful for visual reference and for finding alternate font styles if a consumer wants a non-default look. | https://github.com/ianhan/BitmapFonts |

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Pascal Stang `font5x7.h` rendered | The canonical 5×7 font at scale=1, scale=2, scale=4. Shows the legibility tradeoff. | https://andygock.github.io/glcd-documentation/font5x7_8h_source.html |
| Tom Thumb 3×5 rendered | The smallest readable monospace font. Shows the floor of what's legible. | https://robey.lag.net/2010/01/23/tiny-monospace-font.html |
| HD44780 character map | The original 1987 LCD font. Shows the historical baseline. | https://eleif.net/HD44780.html |
| tinyfont.js demo | Live js13k-sized pixel font renderer. Shows the rendering loop in action. | https://darkwebdev.github.io/tinyfont.js/examples/ |
| lite-bmfont demo | Zero-GC bitmap font with alignment. Shows the font-as-object pattern. | https://github.com/PeshoVurtoleta/lite-bmfont |

---

## Open Questions

1. **Outline rendering**: should `drawText` draw each lit pixel as a bare `fillRect` (fast, flat) or as an `outlineRect` (1px outline, matches GDD §11.3 art rules)? The outline version is 4× more `fillRect` calls per pixel (the fill + 4 stroke segments) but matches the existing primitive's look. Recommendation: ship both — `drawText` (flat, fast) and `drawTextOutlined` (outlined, matches GDD). The benchmarker can compare visual results.

2. **Scale interpretation**: should `scale` mean "pixels per glyph cell" (scale=2 = 10×14 pixels per glyph) or "multiplier of native size" (scale=2 = 10×14 pixels per glyph, same thing)? The first is more intuitive for game HUDs ("I want 14px tall text"). The second is more consistent with the rest of the library (where `scale` is a multiplier). Recommendation: use "pixels per glyph cell" — it's more intuitive for the text use case and the rest of the library doesn't have a `scale` parameter.

3. **Kerning**: monospace fonts don't need kerning (every glyph has the same advance). But if we add a proportional variant later, kerning becomes important. Should we ship a kerning table in v1 even though monospace doesn't use it? Recommendation: no — add kerning when we add proportional. YAGNI.

4. **Text background**: should `drawText` draw a background rectangle behind the text (for contrast on busy backgrounds)? The XAG 101 guideline recommends a solid or semi-transparent background behind all UI text. Recommendation: ship a separate `drawTextBox(ctx, text, x, y, w, h, ...)` that draws a background + text. `drawText` stays minimal (text only).

5. **Custom glyph registration API**: should `registerGlyph(charCode, glyphData)` mutate the font object (breaking immutability) or return a new font (preserving immutability)? The library's pure-progression-ops discipline says return new. But fonts are large objects (475 bytes of data) — copying on every registration is wasteful. Recommendation: return new font, but use structural sharing (copy the glyph table reference, replace only the changed entry). Or: ship `createFont(name, cellWidth, cellHeight, lineGap, glyphs)` as the primary constructor and let consumers build custom fonts from scratch. The registry pattern is for extension, not for mutation.

6. **Font data location**: should the 5×7 font data live in `src/primitives/font5x7-data.ts` (475 bytes, imported by the font module) or inline in `src/primitives/font.ts`? Separate file is cleaner (data vs logic separation) but adds an import. Recommendation: separate file — matches the library's convention of separating types, implementation, and data.

7. **Default font name**: should the default font be exported as `DEFAULT_FONT`, `FONT_5X7`, `DEFAULT_BITMAP_FONT`, or something else? Recommendation: `DEFAULT_FONT` — short, matches the `DEFAULT_OUTLINE_COLOR` / `DEFAULT_GLOW_INTENSITY` convention.

---

## Top 3 Patterns Worth Prototyping

1. **Column-major hex-byte font + tight inner-loop renderer** — Ship `src/primitives/font.ts` with a `BitmapFont` interface (cellWidth, cellHeight, lineGap, glyphs), a `DEFAULT_FONT` constant built from Pascal Stang's 5×7 data (475 bytes, MIT-licensed, full printable ASCII), a `measureText(text, font, scale)` pure function, and a `drawText(ctx, text, x, y, font, scale, align, color)` renderer that draws each lit pixel as a `fillRect`. The renderer is a tight inner loop: for each character, for each column, for each row, if the bit is set, `fillRect`. No allocation, no string conversion, no regex. This is the foundation everything else builds on.

2. **Glyph registry with custom-glyph extension** — Ship a `createFont(name, cellWidth, cellHeight, lineGap, glyphs)` factory that lets consumers build custom fonts from their own bitmap data, and a `registerGlyph(font, charCode, glyphData)` function that returns a new font with the additional glyph. The registry is the non-breaking expansion point: consumers can add custom symbols (hearts, stars, swords) to the default font without redefining the whole table, and they can create entirely custom fonts for skins (demonic font for IMP, cute font for village-builder) without forking the library.

3. **Pure `measureText` with alignment math** — Ship `measureText(text, font, scale)` as a pure function that returns `{width, height, lineCount}` without touching a canvas. The implementation is a single `for` loop over the text (no `split('\n')` allocation), counting characters per line and tracking the max line length. Width = max line length × cellWidth × scale. Height = lineCount × (cellHeight + lineGap) × scale. This is the SSR-safe, deterministic, sub-microsecond measurement that the library needs for layout. Pair it with `alignX(x, text, font, scale, align)` and `alignY(y, text, font, scale, align)` helpers for left/center/right alignment.

---

## Cross-References

- `docs/architecture.md` — Layer separation: `measureText` is deterministic core (pure, no canvas); `drawText` is renderer-adjacent (takes a `CanvasRenderingContext2D`, draws, no simulation-state mutation)
- `docs/conventions.md` — Pure progression ops (font object is immutable, all fields `readonly`); no magic numbers (every tunable lives in a config object); extensive JSDoc on every public export
- `src/primitives/outline-rect.ts` — The existing flat-fill + 1px-outline primitive that `drawText` composes with (one `fillRect` per lit pixel)
- `src/primitives/color.ts` — The existing `meetsWcagAa(foreground, background)` checker that consumers use to validate text contrast
- `src/primitives/motion.ts` — The existing `prefersReducedMotion()` probe that text-blink/scroll animations should respect
- `src/primitives/pixel.ts` — The existing `clamp` / `floor` / `lerp` helpers that `drawText` may use for pixel-grid snapping
- `docs/research/easing-tween.md` — The easing curves that text-fade-in / text-scroll animations should use (not linear lerp)
- `docs/research/algorithmic-palette-substitution.md` — The palette-slot model that text colors should reference (`outline` for text-on-light-bg, `feature` for highlighted text)
- `docs/research/spritesheet-pipelines.md` — The REJECTED spritesheet approach; confirms the asset-less ethos that bitmap fonts serve
- `ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md` — The canonical Sokpop reference; every Sokpop game has at least one text overlay, confirming the demand
