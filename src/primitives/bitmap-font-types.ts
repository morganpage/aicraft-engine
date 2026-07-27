/**
 * Type definitions for the bitmap / pixel font + text rendering module.
 *
 * A bitmap font is an immutable record of cell metrics + a charCode→glyph
 * table. Glyphs are column-major hex byte arrays (one byte per column, bit 0
 * = top row), the canonical 5×7 encoding used by embedded-systems font
 * libraries for 40+ years (HD44780 LCD ROM, 1987).
 *
 * These types carry NO behaviour — they describe the public contract of
 * `bitmap-font.ts`. See `docs/design/bitmap-font-decision.md` for the locked
 * decisions (resolved questions 1–10 are binding).
 *
 * @module
 */

/**
 * Column-major glyph bitmap.
 *
 * One byte per column (5 columns for the default 5×7 font). Within each byte,
 * bit 0 (LSB) is the top row and bit `cellHeight - 1` is the bottom row. Bit
 * `cellHeight` and above are unused (a byte holds 8 rows; the 5×7 font uses 7).
 *
 * Example — the glyph for `'A'` in the default font is
 * `[0x7E, 0x11, 0x11, 0x11, 0x7E]`:
 * ```
 * col 0 = 0x7E = 0b01111110 → rows 1,2,3,4,5,6 lit (left stroke)
 * col 1 = 0x11 = 0b00010001 → rows 0,4 lit
 * col 2 = 0x11               → rows 0,4 lit
 * col 3 = 0x11               → rows 0,4 lit
 * col 4 = 0x7E               → rows 1,2,3,4,5,6 lit (right stroke)
 * ```
 * which renders as a recognizable capital A with the crossbar at row 4.
 */
export type GlyphData = readonly number[];

/**
 * Immutable bitmap font definition.
 *
 * All fields are readonly after construction. Use {@link createFont} to build
 * one from raw parameters, or import {@link DEFAULT_FONT} for the shipped 5×7
 * font (Pascal Stang, MIT-licensed, full printable ASCII).
 */
export interface BitmapFont {
  /** Font name — for debugging, registry lookup, and cosmetic-manifest tagging. */
  readonly name: string;
  /** Glyph cell width in pixels. Monospace: every glyph advances by this amount. */
  readonly cellWidth: number;
  /** Glyph cell height in pixels (the number of rows encoded per column byte). */
  readonly cellHeight: number;
  /** Vertical gap between lines in pixels (between one cell's bottom and the next cell's top). */
  readonly lineGap: number;
  /** charCode → column-major glyph bytes. Readonly after creation. */
  readonly glyphs: ReadonlyMap<number, GlyphData>;
}

/**
 * Pure text-measurement result returned by {@link measureText}.
 *
 * `measureText` is ctx-free and deterministic — the same `(text, font, scale)`
 * always yields byte-identical metrics across Node, browser, SSR, and headless
 * benchmarks.
 */
export interface TextMetrics {
  /** Total width in pixels = `maxLineLength × cellWidth × scale` (monospace). */
  readonly width: number;
  /**
   * Total height in pixels. Excludes the trailing `lineGap` on the last line:
   * ```
   * height = (lineCount - 1) × (cellHeight + lineGap) × scale + cellHeight × scale
   * ```
   * A single line therefore has height `cellHeight × scale` (no gap).
   */
  readonly height: number;
  /** Number of lines (text is split on `'\n'`). An empty string is one line. */
  readonly lineCount: number;
}

/** Horizontal text alignment for the draw variants. */
export type TextAlign = 'left' | 'center' | 'right';

/**
 * Options bag for {@link drawText} / {@link drawTextOutlined}.
 *
 * Every field is optional and defaults to a named constant — the common case
 * is `drawText(ctx, text, x, y)` with no options at all. The bag is
 * additively extensible: a future `lineHeight` field is a non-breaking
 * addition.
 */
export interface TextDrawOptions {
  /** Font to draw with. Defaults to {@link DEFAULT_FONT}. */
  readonly font?: BitmapFont;
  /** Pixels per glyph cell (`scale=3` → 15×21 per glyph). Defaults to {@link DEFAULT_TEXT_SCALE}. */
  readonly scale?: number;
  /** Horizontal alignment relative to `x`. Defaults to `'left'`. */
  readonly align?: TextAlign;
  /** Fill color as `#rrggbb`. Defaults to {@link DEFAULT_TEXT_COLOR}. */
  readonly color?: string;
  /** Outline color (`drawTextOutlined` only). Defaults to {@link DEFAULT_OUTLINE_COLOR}. */
  readonly outline?: string;
  /**
   * Uniform horizontal gap between adjacent glyphs in unscaled font pixels
   * (letter-spacing, NOT per-pair kerning — the same constant advances every
   * pair). Applied between glyphs only; the trailing gap after the last glyph
   * on a line is excluded from width. Defaults to {@link DEFAULT_CHAR_GAP}.
   */
  readonly charGap?: number;
}
