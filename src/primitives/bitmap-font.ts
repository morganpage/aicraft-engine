/**
 * Bitmap / pixel font + text rendering.
 *
 * Asset-less text for ultra-minimalist procedural rendering. Glyphs are drawn
 * as `fillRect` calls (one per lit pixel) — never `ctx.fillText` / `ctx.font`.
 * `measureText` is pure arithmetic (no `ctx`), so it is deterministic and
 * SSR-safe. The shipped {@link DEFAULT_FONT} is Pascal Stang's MIT-licensed
 * 5×7 font (full printable ASCII), see `font5x7-data.ts`.
 *
 * Layer split (per `docs/architecture.md`):
 * - `measureText` is deterministic core — pure, ctx-free, no global state.
 * - `drawText` / `drawTextOutlined` are renderer-adjacent — they take a
 *   `CanvasRenderingContext2D` and draw, but never mutate simulation state.
 *
 * See `docs/design/bitmap-font-decision.md` for the locked decisions.
 *
 * @module
 */

import type { BitmapFont, GlyphData, TextAlign, TextDrawOptions, TextMetrics } from './bitmap-font-types';
import {
  FONT_5X7_CELL_HEIGHT,
  FONT_5X7_CELL_WIDTH,
  FONT_5X7_GLYPHS,
} from './font5x7-data';
import { DEFAULT_OUTLINE_COLOR } from './outline-rect';

export type { BitmapFont, GlyphData, TextAlign, TextDrawOptions, TextMetrics } from './bitmap-font-types';

/** Default text fill color — white, high-contrast on the library's dark backgrounds. */
export const DEFAULT_TEXT_COLOR = '#ffffff';

/**
 * Default text scale: 3 (21px tall — comfortable for primary HUD text per
 * XAG 101). Consumers wanting Spitekeep's existing ~14px HUD look pass
 * `scale: 2` explicitly.
 */
export const DEFAULT_TEXT_SCALE = 3;

/**
 * Default line gap: 1px (HD44780 convention — the vertical space between one
 * cell's bottom and the next cell's top). {@link DEFAULT_FONT} is constructed
 * with `lineGap: DEFAULT_LINE_GAP`.
 */
export const DEFAULT_LINE_GAP = 1;

/**
 * Default uniform horizontal gap between adjacent glyphs in unscaled font
 * pixels (letter-spacing). Applied between glyphs only; the trailing gap
 * after the last glyph on a line is excluded from width. Mirrors the HD44780
 * convention of one blank column between cells so adjacent monospace glyphs
 * never touch. Override per-call via {@link TextDrawOptions.charGap} or per
 * measurement via the 4th arg to {@link measureText}.
 */
export const DEFAULT_CHAR_GAP = 1;

/**
 * Create a bitmap font from raw parameters.
 *
 * The input glyph `Map` is shallow-copied so the caller's map cannot be
 * mutated through the returned font. Glyph byte arrays are shared by reference
 * (treated as readonly per the {@link GlyphData} contract).
 *
 * @param name       - font identifier (debugging / manifest tagging)
 * @param cellWidth  - glyph cell width in px (monospace advance)
 * @param cellHeight - glyph cell height in px (rows encoded per column byte; ≤ 8)
 * @param lineGap    - vertical gap between lines in px
 * @param glyphs     - charCode → column-major glyph bytes
 * @returns a new immutable {@link BitmapFont}
 *
 * @example
 * ```ts
 * const demonic = createFont('demonic', 5, 7, 1, myGlyphMap);
 * ```
 */
export function createFont(
  name: string,
  cellWidth: number,
  cellHeight: number,
  lineGap: number,
  glyphs: ReadonlyMap<number, GlyphData>,
): BitmapFont {
  return {
    name,
    cellWidth,
    cellHeight,
    lineGap,
    glyphs: new Map(glyphs),
  };
}

/**
 * Return a new font with an additional (or replacement) glyph.
 *
 * Pure progression op: the input font is never mutated. The glyph `Map` is
 * shallow-copied (setup-time only — not intended for per-frame use, per the
 * `@architect` verdict on copy cost) and the new glyph's byte array is copied
 * so the caller's array cannot be aliased into the font.
 *
 * @param font      - source font (unchanged)
 * @param charCode  - ASCII code of the glyph to add or replace
 * @param glyphData - column-major glyph bytes (copied)
 * @returns a new {@link BitmapFont} with the glyph installed
 *
 * @example
 * ```ts
 * const withHeart = addGlyph(DEFAULT_FONT, 0x2665, [0x00, 0x66, 0xff, 0xff, 0x66]);
 * // DEFAULT_FONT is unchanged; withHeart renders '♥'.
 * ```
 */
export function addGlyph(
  font: BitmapFont,
  charCode: number,
  glyphData: GlyphData,
): BitmapFont {
  const glyphs = new Map(font.glyphs);
  glyphs.set(charCode, Array.from(glyphData));
  return {
    name: font.name,
    cellWidth: font.cellWidth,
    cellHeight: font.cellHeight,
    lineGap: font.lineGap,
    glyphs,
  };
}

/**
 * Pure text measurement — no `ctx`, no DOM, no allocation beyond the return.
 *
 * Width excludes the trailing `charGap` on the last glyph of each line
 * (standard text-layout convention — one gap per glyph *transition*, not per
 * glyph). For a line of `n` glyphs:
 *
 * ```
 * width = n === 0 ? 0 : (n - 1) × (cellWidth + charGap) × scale + cellWidth × scale
 * ```
 *
 * A single glyph therefore has width `cellWidth × scale` (no gap). Height
 * excludes the trailing `lineGap` on the last line:
 *
 * ```
 * height = (lineCount - 1) × (cellHeight + lineGap) × scale + cellHeight × scale
 * ```
 *
 * A single line therefore has height `cellHeight × scale` (no gap). The empty
 * string is one line of width 0 and height `cellHeight × scale`.
 *
 * Deterministic and SSR-safe: identical `(text, font, scale, charGap)` always
 * yields byte-identical metrics across Node, browser, SSR, and headless
 * benchmarks. Never throws.
 *
 * @param text    - text to measure (may contain `'\n'` for multi-line)
 * @param font    - font to measure with (defaults to {@link DEFAULT_FONT})
 * @param scale   - pixels per glyph cell (defaults to 1)
 * @param charGap - uniform horizontal gap between adjacent glyphs in unscaled
 *                  font pixels (defaults to {@link DEFAULT_CHAR_GAP})
 * @returns `{ width, height, lineCount }`
 *
 * @example
 * ```ts
 * const m = measureText('SCORE 1200', DEFAULT_FONT, DEFAULT_TEXT_SCALE);
 * const x = (canvasWidth - m.width) / 2;
 * ```
 */
export function measureText(
  text: string,
  font: BitmapFont = DEFAULT_FONT,
  scale: number = 1,
  charGap: number = DEFAULT_CHAR_GAP,
): TextMetrics {
  let maxLineLength = 0;
  let currentLineLength = 0;
  let lineCount = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0x0a) {
      if (currentLineLength > maxLineLength) maxLineLength = currentLineLength;
      currentLineLength = 0;
      lineCount++;
    } else {
      currentLineLength++;
    }
  }
  if (currentLineLength > maxLineLength) maxLineLength = currentLineLength;

  const cellHeightScaled = font.cellHeight * scale;
  const height = (lineCount - 1) * (font.cellHeight + font.lineGap) * scale + cellHeightScaled;
  const width =
    maxLineLength === 0
      ? 0
      : (maxLineLength - 1) * (font.cellWidth + charGap) * scale + font.cellWidth * scale;
  return { width, height, lineCount };
}

const NEWLINE = 0x0a;

interface ResolvedDrawConfig {
  font: BitmapFont;
  scale: number;
  align: TextAlign;
  color: string;
  charGap: number;
}

function resolveConfig(options: TextDrawOptions | undefined): ResolvedDrawConfig {
  return {
    font: options?.font ?? DEFAULT_FONT,
    scale: options?.scale ?? DEFAULT_TEXT_SCALE,
    align: options?.align ?? 'left',
    color: options?.color ?? DEFAULT_TEXT_COLOR,
    charGap: options?.charGap ?? DEFAULT_CHAR_GAP,
  };
}

function alignLineX(x: number, lineWidth: number, align: TextAlign): number {
  switch (align) {
    case 'left':
      return x;
    case 'center':
      return x - lineWidth / 2;
    case 'right':
      return x - lineWidth;
  }
}

function drawGlyphFlat(
  ctx: CanvasRenderingContext2D,
  glyph: GlyphData,
  originX: number,
  originY: number,
  scale: number,
  cellHeight: number,
  color: string,
): void {
  ctx.fillStyle = color;
  for (let col = 0; col < glyph.length; col++) {
    const bits = glyph[col];
    if (bits === 0) continue;
    for (let row = 0; row < cellHeight; row++) {
      if ((bits >> row) & 1) {
        ctx.fillRect(originX + col * scale, originY + row * scale, scale, scale);
      }
    }
  }
}

/**
 * Render every line in `text` flat (one `fillRect` per lit pixel) in `color`,
 * with the pen shifted by `(offsetX, offsetY)` screen-space pixels and by the
 * configured `charGap` between adjacent glyphs. Shared between the flat draw
 * path and each of the 4 outline-offset passes of {@link drawTextOutlined}.
 */
function drawTextFlatAt(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  config: ResolvedDrawConfig,
  color: string,
  offsetX: number,
  offsetY: number,
): void {
  const { font, scale, align, charGap } = config;
  const cellW = font.cellWidth;
  const cellH = font.cellHeight;
  const cellWscale = cellW * scale;
  const advanceScale = (cellW + charGap) * scale;
  const lineHeightStep = (cellH + font.lineGap) * scale;

  let lineIndex = 0;
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    const atEnd = i === text.length;
    if (atEnd || text.charCodeAt(i) === NEWLINE) {
      const lineLen = i - lineStart;
      const lineWidth =
        lineLen === 0 ? 0 : (lineLen - 1) * advanceScale + cellWscale;
      const leftX = alignLineX(x, lineWidth, align);
      const topY = y + lineIndex * lineHeightStep + offsetY;
      for (let j = 0; j < lineLen; j++) {
        const charCode = text.charCodeAt(lineStart + j);
        const glyph = font.glyphs.get(charCode);
        if (glyph === undefined) continue;
        const glyphX = leftX + j * advanceScale + offsetX;
        drawGlyphFlat(ctx, glyph, glyphX, topY, scale, cellH, color);
      }
      lineIndex++;
      lineStart = i + 1;
    }
  }
}

/**
 * The 4 cardinal screen-space offsets used to stamp the outline pass. Drawing
 * the flat glyph set at each offset in OUTLINE color, then drawing the flat
 * glyph set at origin in FILL color, produces a clean 1px outline around the
 * outer glyph boundary with a solid fill inside — the standard technique that
 * avoids the internal "screen door" grid that per-pixel `outlineRect` produces.
 */
const OUTLINE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * Draw text using flat `fillRect` calls (one per lit pixel). Fast and minimal
 * — the primary variant for high-density text (score counters, debug overlays).
 *
 * Each line is aligned independently (per-line left/center/right) so the total
 * horizontal span always matches {@link measureText}.width. Adjacent glyphs
 * advance by `(cellWidth + charGap) × scale`; multi-line text advances one
 * `(cellHeight + lineGap) × scale` per line. Unknown glyphs (chars not in the
 * font) are skipped — they render as blank space and never throw. Never uses
 * `ctx.fillText` / `ctx.font`.
 *
 * @param ctx     - canvas 2D context (caller owns transform/state)
 * @param text    - text to draw (may contain `'\n'` for multi-line)
 * @param x       - reference x for alignment (left edge / center / right edge)
 * @param y       - top edge of the first line
 * @param options - font, scale, align, color, charGap (all optional)
 *
 * @example
 * ```ts
 * drawText(ctx, 'SCORE 1200', centerX, 20, { scale: 3, align: 'center', color: '#ffd66b' });
 * ```
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options?: TextDrawOptions,
): void {
  const config = resolveConfig(options);
  drawTextFlatAt(ctx, text, x, y, config, config.color, 0, 0);
}

/**
 * Draw flat-fill text with a 1px outline around the outer glyph boundary.
 *
 * Implementation: the standard 4-offset technique — stamp the entire flat
 * text (all lit `fillRect`s) in OUTLINE color at the 4 cardinal offsets
 * `(x±1, y)` and `(x, y±1)`, then stamp the flat text in FILL color at the
 * origin on top. The fill is drawn LAST so it covers the interior cleanly,
 * leaving a solid 1px outline halo around the union of the glyph pixels.
 *
 * This replaces the earlier per-pixel `outlineRect` approach, which outlined
 * EVERY lit pixel individually and produced an internal "screen door" grid
 * wherever adjacent lit pixels met. The 4-offset technique is the canonical
 * fix and matches GDD §11.3 art rules for prominent text (level titles,
 * "GAME OVER"). Emits exactly 5× the `fillRect` count of {@link drawText}
 * (4 outline passes + 1 fill pass), and never calls `strokeRect`.
 *
 * The outline color defaults to {@link DEFAULT_OUTLINE_COLOR} (reused from
 * `outline-rect.ts`, not redefined) and is overridable via `options.outline`.
 *
 * @param ctx     - canvas 2D context (caller owns transform/state)
 * @param text    - text to draw (may contain `'\n'` for multi-line)
 * @param x       - reference x for alignment (left edge / center / right edge)
 * @param y       - top edge of the first line
 * @param options - font, scale, align, color, outline, charGap (all optional)
 *
 * @example
 * ```ts
 * drawTextOutlined(ctx, 'GAME OVER', centerX, centerY, { scale: 4, align: 'center' });
 * ```
 */
export function drawTextOutlined(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options?: TextDrawOptions,
): void {
  const config = resolveConfig(options);
  const outlineColor = options?.outline ?? DEFAULT_OUTLINE_COLOR;
  for (const [dx, dy] of OUTLINE_OFFSETS) {
    drawTextFlatAt(ctx, text, x, y, config, outlineColor, dx, dy);
  }
  drawTextFlatAt(ctx, text, x, y, config, config.color, 0, 0);
}

/**
 * Default 5×7 bitmap font (Pascal Stang, MIT-licensed — see
 * `font5x7-data.ts`). Full printable ASCII 0x20–0x7E. Constructed with
 * `lineGap: DEFAULT_LINE_GAP` (1px, HD44780 convention).
 */
export const DEFAULT_FONT: BitmapFont = createFont(
  'font5x7',
  FONT_5X7_CELL_WIDTH,
  FONT_5X7_CELL_HEIGHT,
  DEFAULT_LINE_GAP,
  FONT_5X7_GLYPHS,
);
