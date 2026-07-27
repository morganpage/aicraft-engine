import { describe, it, expect, vi } from 'vitest';
import {
  measureText,
  drawText,
  drawTextOutlined,
  createFont,
  addGlyph,
  DEFAULT_FONT,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_SCALE,
  DEFAULT_LINE_GAP,
  DEFAULT_CHAR_GAP,
  type BitmapFont,
  type TextDrawOptions,
} from '../primitives/bitmap-font';
import { DEFAULT_OUTLINE_COLOR } from '../primitives/outline-rect';
import { FONT_5X7_CELL_WIDTH, FONT_5X7_CELL_HEIGHT } from '../primitives/font5x7-data';
import { createMockCtx } from './_helpers';

const CELL_W = FONT_5X7_CELL_WIDTH;
const CELL_H = FONT_5X7_CELL_HEIGHT;
const GAP = DEFAULT_LINE_GAP;

function decodeLitPixels(glyph: readonly number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let col = 0; col < glyph.length; col++) {
    const bits = glyph[col];
    for (let row = 0; row < CELL_H; row++) {
      if ((bits >> row) & 1) out.push([col, row]);
    }
  }
  return out;
}

function fillRectCalls(ctx: ReturnType<typeof createMockCtx>): number[][] {
  return ctx.fillRect.mock.calls as unknown as number[][];
}

describe('bitmap-font constants', () => {
  it('DEFAULT_TEXT_COLOR is #ffffff', () => {
    expect(DEFAULT_TEXT_COLOR).toBe('#ffffff');
  });

  it('DEFAULT_TEXT_SCALE is 3', () => {
    expect(DEFAULT_TEXT_SCALE).toBe(3);
  });

  it('DEFAULT_LINE_GAP is 1 (HD44780 convention)', () => {
    expect(DEFAULT_LINE_GAP).toBe(1);
  });

  it('DEFAULT_CHAR_GAP is 1 (uniform letter-spacing default)', () => {
    expect(DEFAULT_CHAR_GAP).toBe(1);
  });

  it('DEFAULT_FONT is the 5x7 font with lineGap = DEFAULT_LINE_GAP', () => {
    expect(DEFAULT_FONT.cellWidth).toBe(5);
    expect(DEFAULT_FONT.cellHeight).toBe(7);
    expect(DEFAULT_FONT.lineGap).toBe(DEFAULT_LINE_GAP);
    expect(DEFAULT_FONT.glyphs.size).toBe(95);
  });
});

describe('measureText — purity', () => {
  it('returns identical output for identical inputs across repeated calls', () => {
    const a = measureText('SCORE 1200', DEFAULT_FONT, 3);
    const b = measureText('SCORE 1200', DEFAULT_FONT, 3);
    expect(a).toEqual(b);
  });

  it('never throws on weird input (empty / whitespace / unknown)', () => {
    expect(() => measureText('', DEFAULT_FONT, 1)).not.toThrow();
    expect(() => measureText('   ', DEFAULT_FONT, 1)).not.toThrow();
    expect(() => measureText('\n\n\n', DEFAULT_FONT, 1)).not.toThrow();
    expect(() => measureText('\u2603\u0001', DEFAULT_FONT, 1)).not.toThrow();
  });

  it('does not accept a ctx parameter (pure, ctx-free signature)', () => {
    expect(measureText.length).toBeLessThanOrEqual(4);
  });
});

describe('measureText — exact shapes', () => {
  /** Expected width for one line of `lineLen` glyphs with uniform charGap. */
  const expectedLineWidth = (lineLen: number, scale: number, charGap: number): number =>
    lineLen === 0
      ? 0
      : (lineLen - 1) * (CELL_W + charGap) * scale + CELL_W * scale;

  it('empty string → { width: 0, height: cellHeight*scale, lineCount: 1 }', () => {
    expect(measureText('', DEFAULT_FONT, 1)).toEqual({ width: 0, height: CELL_H * 1, lineCount: 1 });
    expect(measureText('', DEFAULT_FONT, 3)).toEqual({ width: 0, height: CELL_H * 3, lineCount: 1 });
  });

  it('single-line height = cellHeight * scale (NO trailing lineGap)', () => {
    const m = measureText('HELLO', DEFAULT_FONT, 3);
    expect(m.height).toBe(CELL_H * 3);
    expect(m.lineCount).toBe(1);
  });

  it('single-line width excludes trailing charGap on the last glyph (default charGap)', () => {
    // 1 char: just cellWidth (no gap, nothing follows it).
    expect(measureText('H', DEFAULT_FONT, 1).width).toBe(1 * CELL_W * 1);
    expect(measureText('H', DEFAULT_FONT, 3).width).toBe(1 * CELL_W * 3);
    // 2 chars: cellWidth + charGap + cellWidth (one gap between, none trailing).
    expect(measureText('HI', DEFAULT_FONT, 1).width).toBe(expectedLineWidth(2, 1, DEFAULT_CHAR_GAP));
    expect(measureText('HI', DEFAULT_FONT, 3).width).toBe(expectedLineWidth(2, 3, DEFAULT_CHAR_GAP));
    // 5 chars: 4 interior gaps + 5 cellWidths.
    expect(measureText('SCORE', DEFAULT_FONT, 2).width).toBe(expectedLineWidth(5, 2, DEFAULT_CHAR_GAP));
  });

  it('multi-line height uses the decision formula exactly (one gap per break, not per line)', () => {
    const scale = 3;
    const text = 'A\nBB\nCCC';
    const lineCount = 3;
    const expectedHeight =
      (lineCount - 1) * (CELL_H + GAP) * scale + CELL_H * scale;
    const m = measureText(text, DEFAULT_FONT, scale);
    expect(m.lineCount).toBe(3);
    expect(m.height).toBe(expectedHeight);
  });

  it('multi-line width = max line width with charGap (trailing gap excluded per line)', () => {
    const scale = 2;
    const m = measureText('A\nBBB\nCC', DEFAULT_FONT, scale);
    expect(m.width).toBe(expectedLineWidth(3, scale, DEFAULT_CHAR_GAP));
  });

  it('trailing newline yields a trailing empty line counted in lineCount', () => {
    const m = measureText('A\n', DEFAULT_FONT, 1);
    expect(m.lineCount).toBe(2);
    expect(m.width).toBe(CELL_W * 1);
  });

  it('two consecutive newlines produce an empty middle line', () => {
    const m = measureText('A\n\nB', DEFAULT_FONT, 1);
    expect(m.lineCount).toBe(3);
  });

  it('scale defaults to 1 when omitted', () => {
    const withScale = measureText('AB', DEFAULT_FONT, 1);
    const defaulted = measureText('AB', DEFAULT_FONT);
    expect(defaulted).toEqual(withScale);
  });

  it('font defaults to DEFAULT_FONT when omitted', () => {
    expect(measureText('AB')).toEqual(measureText('AB', DEFAULT_FONT, 1));
  });

  it('charGap defaults to DEFAULT_CHAR_GAP when omitted', () => {
    expect(measureText('AB', DEFAULT_FONT, 1)).toEqual(
      measureText('AB', DEFAULT_FONT, 1, DEFAULT_CHAR_GAP),
    );
  });
});

describe('measureText — charGap parameter', () => {
  it('1 char = cellWidth * scale (charGap irrelevant for single glyph)', () => {
    expect(measureText('A', DEFAULT_FONT, 1, 0).width).toBe(CELL_W * 1);
    expect(measureText('A', DEFAULT_FONT, 1, 1).width).toBe(CELL_W * 1);
    expect(measureText('A', DEFAULT_FONT, 3, 5).width).toBe(CELL_W * 3);
  });

  it('2 chars = 2*cellWidth*scale + charGap*scale (one interior gap)', () => {
    expect(measureText('AB', DEFAULT_FONT, 1, 0).width).toBe(2 * CELL_W * 1);
    expect(measureText('AB', DEFAULT_FONT, 1, 1).width).toBe(2 * CELL_W * 1 + 1 * 1);
    expect(measureText('AB', DEFAULT_FONT, 3, 2).width).toBe(2 * CELL_W * 3 + 2 * 3);
  });

  it('trailing gap is excluded: N chars have exactly (N-1) interior gaps', () => {
    const scale = 2;
    const charGap = 3;
    const n = 5;
    const expected = (n - 1) * (CELL_W + charGap) * scale + CELL_W * scale;
    expect(measureText('ABCDE', DEFAULT_FONT, scale, charGap).width).toBe(expected);
  });

  it('charGap=0 reproduces the old touching-cells width (charCount * cellWidth * scale)', () => {
    expect(measureText('SCORE', DEFAULT_FONT, 2, 0).width).toBe(5 * CELL_W * 2);
  });

  it('empty string width stays 0 regardless of charGap', () => {
    expect(measureText('', DEFAULT_FONT, 1, 0).width).toBe(0);
    expect(measureText('', DEFAULT_FONT, 1, 5).width).toBe(0);
  });

  it('never throws on weird input regardless of charGap', () => {
    expect(() => measureText('HI', DEFAULT_FONT, 1, -1)).not.toThrow();
    expect(() => measureText('HI', DEFAULT_FONT, 1, NaN)).not.toThrow();
  });
});

describe('createFont', () => {
  it('constructs a font from raw parameters without aliasing the input Map', () => {
    const src = new Map<number, readonly number[]>([[0x41, [0x7e, 0x11, 0x11, 0x11, 0x7e]]]);
    const font = createFont('test', 5, 7, 1, src);
    src.set(0x42, [0, 0, 0, 0, 0]);
    expect(font.glyphs.has(0x42)).toBe(false);
    expect(font.glyphs.size).toBe(1);
    expect(font.name).toBe('test');
  });
});

describe('addGlyph — immutability (pure progression op)', () => {
  it('returns a NEW font; the original is unchanged', () => {
    const before = DEFAULT_FONT.glyphs.size;
    const custom = addGlyph(DEFAULT_FONT, 0x2665, [0x00, 0x66, 0xff, 0x66, 0x00]);
    expect(custom.glyphs.size).toBe(before + 1);
    expect(DEFAULT_FONT.glyphs.size).toBe(before);
    expect(custom.glyphs.has(0x2665)).toBe(true);
    expect(DEFAULT_FONT.glyphs.has(0x2665)).toBe(false);
  });

  it('the new glyph is readable and matches the data passed in', () => {
    const data = [0x00, 0x66, 0xff, 0x66, 0x00];
    const custom = addGlyph(DEFAULT_FONT, 0x2665, data);
    expect(Array.from(custom.glyphs.get(0x2665)!)).toEqual(data);
  });

  it('does not mutate the glyph data array passed by the caller', () => {
    const data = [0x00, 0x66, 0xff, 0x66, 0x00];
    const snapshot = [...data];
    addGlyph(DEFAULT_FONT, 0x2665, data);
    expect(data).toEqual(snapshot);
  });

  it('original DEFAULT_FONT remains pristine across multiple addGlyph calls', () => {
    const originalSize = DEFAULT_FONT.glyphs.size;
    addGlyph(DEFAULT_FONT, 0x2665, [0, 0, 0, 0, 0]);
    addGlyph(DEFAULT_FONT, 0x2660, [0, 0, 0, 0, 0]);
    addGlyph(DEFAULT_FONT, 0x2666, [0, 0, 0, 0, 0]);
    expect(DEFAULT_FONT.glyphs.size).toBe(originalSize);
  });

  it('overriding an existing charCode yields a new font with the replacement', () => {
    const custom = addGlyph(DEFAULT_FONT, 0x41, [0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(Array.from(custom.glyphs.get(0x41)!)).toEqual([0, 0, 0, 0, 0]);
    expect(Array.from(DEFAULT_FONT.glyphs.get(0x41)!)).toEqual([0x7e, 0x11, 0x11, 0x11, 0x7e]);
  });
});

describe("drawText — known glyph 'A' produces its exact canonical lit-pixel set", () => {
  const CANONICAL_A_BYTES = [0x7e, 0x11, 0x11, 0x11, 0x7e];
  const expectedAPixels = decodeLitPixels(CANONICAL_A_BYTES);

  it('the hardcoded canonical A decodes to the expected pixel set', () => {
    expect(expectedAPixels).toEqual([
      [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6],
      [1, 0], [1, 4],
      [2, 0], [2, 4],
      [3, 0], [3, 4],
      [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6],
    ]);
  });

  it("DEFAULT_FONT's 'A' glyph matches the canonical A bytes (transcription check)", () => {
    expect(Array.from(DEFAULT_FONT.glyphs.get(0x41)!)).toEqual(CANONICAL_A_BYTES);
  });

  it("drawText('A') at scale 1 emits one fillRect per lit pixel at (col, row, 1, 1)", () => {
    const ctx = createMockCtx();
    drawText(ctx as never, 'A', 0, 0, { scale: 1 });
    const calls = fillRectCalls(ctx);
    const expected = expectedAPixels.map(([c, r]) => [c, r, 1, 1]);
    expect(calls.length).toBe(expected.length);
    expect(calls.sort()).toEqual(expected.sort());
  });
});

describe('drawText — fillRect count matches lit pixels in glyphs (sanity)', () => {
  it("'H' has 17 lit pixels", () => {
    const ctx = createMockCtx();
    drawText(ctx as never, 'H', 0, 0, { scale: 1 });
    expect(ctx.fillRect).toHaveBeenCalledTimes(17);
  });

  it("'I' has 11 lit pixels", () => {
    const ctx = createMockCtx();
    drawText(ctx as never, 'I', 0, 0, { scale: 1 });
    expect(ctx.fillRect).toHaveBeenCalledTimes(11);
  });

  it("'HI' has 28 lit pixels (17 + 11)", () => {
    const ctx = createMockCtx();
    drawText(ctx as never, 'HI', 0, 0, { scale: 1 });
    expect(ctx.fillRect).toHaveBeenCalledTimes(28);
  });

  it("' ' (space) has 0 lit pixels", () => {
    const ctx = createMockCtx();
    drawText(ctx as never, ' ', 0, 0, { scale: 1 });
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("every printable ASCII glyph renders without crashing", () => {
    for (let code = 0x20; code <= 0x7e; code++) {
      const ctx = createMockCtx();
      const ch = String.fromCharCode(code);
      expect(() => drawText(ctx as never, ch, 0, 0, { scale: 1 })).not.toThrow();
    }
  });
});

describe('drawText — scale', () => {
  it('scale multiplies pixel positions and sizes', () => {
    const ctx = createMockCtx();
    drawText(ctx as never, 'A', 10, 20, { scale: 2 });
    const calls = fillRectCalls(ctx);
    const expected = decodeLitPixels([0x7e, 0x11, 0x11, 0x11, 0x7e]).map(([c, r]) => [
      10 + c * 2,
      20 + r * 2,
      2,
      2,
    ]);
    expect(calls.length).toBe(expected.length);
    expect(calls.sort()).toEqual(expected.sort());
  });

  it('scale defaults to DEFAULT_TEXT_SCALE (3) when omitted', () => {
    const ctx = createMockCtx();
    drawText(ctx as never, 'A', 0, 0);
    const calls = fillRectCalls(ctx);
    expect(calls[0][2]).toBe(DEFAULT_TEXT_SCALE);
    expect(calls[0][3]).toBe(DEFAULT_TEXT_SCALE);
  });
});

describe('drawText — color', () => {
  it("color option flows to ctx.fillStyle", () => {
    const ctx = createMockCtx();
    drawText(ctx as never, 'A', 0, 0, { scale: 1, color: '#ff8800' });
    expect(ctx.fillStyle).toBe('#ff8800');
  });

  it('defaults to DEFAULT_TEXT_COLOR (#ffffff) when color omitted', () => {
    const ctx = createMockCtx();
    drawText(ctx as never, 'A', 0, 0, { scale: 1 });
    expect(ctx.fillStyle).toBe(DEFAULT_TEXT_COLOR);
  });
});

describe('drawText — alignment matches measureText', () => {
  it("left align: first pixel starts at x", () => {
    const ctx = createMockCtx();
    drawText(ctx as never, 'AB', 100, 0, { scale: 1, align: 'left' });
    const xs = fillRectCalls(ctx).map((c) => c[0]);
    expect(Math.min(...xs)).toBe(100);
  });

  it("right align: last pixel ends at x (x + scale)", () => {
    const ctx = createMockCtx();
    drawText(ctx as never, 'AB', 100, 0, { scale: 1, align: 'right' });
    const calls = fillRectCalls(ctx);
    const rightEdges = calls.map((c) => c[0] + c[2]);
    expect(Math.max(...rightEdges)).toBe(100);
  });

  it("center align: drawn pixel span is symmetric about x (bounding-box center === x)", () => {
    const ctx = createMockCtx();
    const x = 1000;
    drawText(ctx as never, 'AB', x, 0, { scale: 1, align: 'center' });
    const calls = fillRectCalls(ctx);
    const lefts = calls.map((c) => c[0]);
    const rights = calls.map((c) => c[0] + c[2]);
    const center = (Math.min(...lefts) + Math.max(...rights)) / 2;
    expect(center).toBe(x);
  });

  it('center align span matches measureText width', () => {
    const text = 'SCORE';
    const scale = 2;
    const m = measureText(text, DEFAULT_FONT, scale);
    const ctx = createMockCtx();
    drawText(ctx as never, text, 500, 0, { scale, align: 'center' });
    const calls = fillRectCalls(ctx);
    const span = Math.max(...calls.map((c) => c[0] + c[2])) - Math.min(...calls.map((c) => c[0]));
    expect(span).toBe(m.width);
  });

  it('multi-line: each line is independently centered (per-line alignment)', () => {
    const ctx = createMockCtx();
    const x = 200;
    const scale = 1;
    drawText(ctx as never, 'A\nBBB', x, 0, { scale, align: 'center' });
    const calls = fillRectCalls(ctx);
    const band = (top: number) => (c: number[]) => c[1] >= top && c[1] < top + CELL_H * scale;
    const line0Top = 0;
    const line1Top = (CELL_H + GAP) * scale;
    const row0 = calls.filter(band(line0Top));
    const row1 = calls.filter(band(line1Top));
    const center = (cs: number[][]) =>
      (Math.min(...cs.map((c) => c[0])) + Math.max(...cs.map((c) => c[0] + c[2]))) / 2;
    expect(center(row0)).toBe(x);
    expect(center(row1)).toBe(x);
  });
});

describe('drawText — multi-line y positioning', () => {
  it('line N starts at y + N * (cellHeight + lineGap) * scale', () => {
    const ctx = createMockCtx();
    const scale = 2;
    drawText(ctx as never, 'A\nB\nC', 0, 10, { scale });
    const calls = fillRectCalls(ctx);
    const ys = new Set(calls.map((c) => c[1]));
    expect(ys.has(10)).toBe(true);
    expect(ys.has(10 + (CELL_H + GAP) * scale)).toBe(true);
    expect(ys.has(10 + 2 * (CELL_H + GAP) * scale)).toBe(true);
  });
});

describe('drawText — unknown glyph fallback', () => {
  it('a control char (outside 0x20-0x7E) does not crash and renders blank', () => {
    const ctx = createMockCtx();
    expect(() => drawText(ctx as never, '\u0001', 0, 0, { scale: 1 })).not.toThrow();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('a Unicode char (outside ASCII) does not crash and renders blank', () => {
    const ctx = createMockCtx();
    expect(() => drawText(ctx as never, '\u2603', 0, 0, { scale: 1 })).not.toThrow();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('unknown glyphs mixed with known glyphs do not corrupt known-glyph rendering', () => {
    const ctx = createMockCtx();
    drawText(ctx as never, 'A\u2603B', 0, 0, { scale: 1 });
    // 'A' = 18 lit pixels (0x7E has 6 set bits), 'B' = 20 lit pixels.
    expect(ctx.fillRect).toHaveBeenCalledTimes(18 + 20);
  });
});

describe('drawText — determinism', () => {
  it('identical (text, font, scale) yields identical fillRect call sequences', () => {
    const ctxA = createMockCtx();
    const ctxB = createMockCtx();
    const opts: TextDrawOptions = { scale: 2, color: '#abcdef', align: 'center' };
    drawText(ctxA as never, 'DETERMINISM!', 50, 50, opts);
    drawText(ctxB as never, 'DETERMINISM!', 50, 50, opts);
    expect(ctxA.fillRect.mock.calls).toEqual(ctxB.fillRect.mock.calls);
  });
});

describe('drawText — charGap (uniform letter-spacing)', () => {
  it('charGap defaults to DEFAULT_CHAR_GAP when omitted', () => {
    const ctxDefault = createMockCtx();
    const ctxExplicit = createMockCtx();
    drawText(ctxDefault as never, 'AB', 0, 0, { scale: 1 });
    drawText(ctxExplicit as never, 'AB', 0, 0, { scale: 1, charGap: DEFAULT_CHAR_GAP });
    expect(ctxDefault.fillRect.mock.calls).toEqual(ctxExplicit.fillRect.mock.calls);
  });

  it('charGap=0 reproduces touching cells (second glyph starts at cellWidth*scale)', () => {
    const ctx = createMockCtx();
    drawText(ctx as never, 'AB', 0, 0, { scale: 1, charGap: 0 });
    const calls = fillRectCalls(ctx);
    // Glyph A occupies columns 0..4; glyph B should start at column 5 (no gap).
    const bColumns = calls.filter((c) => c[0] >= CELL_W).map((c) => c[0]);
    expect(Math.min(...bColumns)).toBe(CELL_W);
  });

  it('charGap=2 advances the pen by (cellWidth+2)*scale per char', () => {
    const ctx = createMockCtx();
    const scale = 3;
    const charGap = 2;
    drawText(ctx as never, 'AB', 0, 0, { scale, charGap });
    const calls = fillRectCalls(ctx);
    // Second glyph's leftmost column should be at (CELL_W + charGap) * scale.
    const advance = (CELL_W + charGap) * scale;
    const bColumns = calls.filter((c) => c[0] >= advance - 0.5).map((c) => c[0]);
    expect(Math.min(...bColumns)).toBe(advance);
  });

  it("charGap doesn't affect the lit-pixel count (only positions)", () => {
    const ctxGap0 = createMockCtx();
    const ctxGap5 = createMockCtx();
    drawText(ctxGap0 as never, 'HELLO', 0, 0, { scale: 1, charGap: 0 });
    drawText(ctxGap5 as never, 'HELLO', 0, 0, { scale: 1, charGap: 5 });
    expect(ctxGap0.fillRect.mock.calls.length).toBe(ctxGap5.fillRect.mock.calls.length);
  });

  it('drawText width span matches measureText width for the same charGap', () => {
    const text = 'SCORE';
    const scale = 2;
    const charGap = 3;
    const m = measureText(text, DEFAULT_FONT, scale, charGap);
    const ctx = createMockCtx();
    drawText(ctx as never, text, 0, 0, { scale, charGap });
    const calls = fillRectCalls(ctx);
    const span = Math.max(...calls.map((c) => c[0] + c[2])) - Math.min(...calls.map((c) => c[0]));
    expect(span).toBe(m.width);
  });
});

describe('drawTextOutlined', () => {
  /**
   * Build a mock ctx that records `(fillStyle, fillRectArgs)` for every
   * `fillRect` call, so tests can assert which color was active at each call
   * (the plain MockCtx only retains the latest fillStyle).
   */
  function recordingCtx() {
    const calls: Array<{ style: string; args: number[] }> = [];
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      lineCap: 'butt',
      lineJoin: 'miter',
      globalCompositeOperation: 'source-over',
      globalAlpha: 1,
      fillRect: vi.fn((...args: number[]) => {
        calls.push({ style: ctx.fillStyle, args });
      }),
      strokeRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      transform: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };
    return { ctx, calls };
  }

  it('emits exactly 5x the flat fillRect count (4 outline offset passes + 1 fill pass)', () => {
    const flat = createMockCtx();
    const outlined = createMockCtx();
    drawText(flat as never, 'HI', 0, 0, { scale: 1 });
    drawTextOutlined(outlined as never, 'HI', 0, 0, { scale: 1 });
    const flatCount = flat.fillRect.mock.calls.length;
    expect(outlined.fillRect.mock.calls.length).toBe(flatCount * 5);
  });

  it('does NOT use strokeRect (4-offset fillRect technique, not per-pixel outlineRect)', () => {
    const ctx = createMockCtx();
    drawTextOutlined(ctx as never, 'A', 0, 0, { scale: 1 });
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });

  it('fill color is drawn LAST (on top of the 4 outline passes)', () => {
    const { ctx, calls } = recordingCtx();
    drawTextOutlined(ctx as never, 'A', 0, 0, {
      scale: 1,
      color: '#00ff00',
      outline: '#ff0000',
    });
    // The flat pixel count for 'A' is 18 (6 + 3 + 3 + 3 + 6 in canonical bytes).
    const litPixelCount = calls.length / 5;
    expect(litPixelCount).toBe(18);
    // First 4 passes (litPixelCount each) are the outline color.
    const first4Passes = calls.slice(0, litPixelCount * 4);
    expect(first4Passes.every((c) => c.style === '#ff0000')).toBe(true);
    // Last pass (litPixelCount calls) is the fill color.
    const lastPass = calls.slice(litPixelCount * 4);
    expect(lastPass.every((c) => c.style === '#00ff00')).toBe(true);
  });

  it('outline color is drawn at 4 offset passes: (x±1,y) and (x,y±1)', () => {
    const { ctx, calls } = recordingCtx();
    drawTextOutlined(ctx as never, 'I', 50, 60, { scale: 1 });
    // 'I' canonical bytes: [0x00, 0x41, 0x7f, 0x41, 0x00] — lit pixels in cols 1,2,3.
    // Group consecutive fillRect calls into 5 equal passes.
    const litPixelCount = calls.length / 5;
    const passes: number[][][] = [];
    for (let p = 0; p < 5; p++) {
      passes.push(calls.slice(p * litPixelCount, (p + 1) * litPixelCount).map((c) => c.args));
    }
    // The first 4 passes are at offsets (-1,0), (+1,0), (0,-1), (0,+1) from origin (50,60).
    // Compare each pass's x/y set against the flat pass (last) shifted by the offset.
    const flatPass = passes[4];
    const offsetXs = [-1, 1, 0, 0];
    const offsetYs = [0, 0, -1, 1];
    for (let p = 0; p < 4; p++) {
      const shifted = flatPass.map(([x, y, w, h]) => [x + offsetXs[p], y + offsetYs[p], w, h]);
      expect(passes[p].sort()).toEqual(shifted.sort());
    }
  });

  it("outline color defaults to DEFAULT_OUTLINE_COLOR (#1d1128) — reused from outline-rect", () => {
    const { ctx, calls } = recordingCtx();
    drawTextOutlined(ctx as never, 'A', 0, 0, { scale: 1 });
    // Outline color must be used during the 4 offset passes.
    const outlinePassStyles = new Set(
      calls.slice(0, Math.floor(calls.length / 5) * 4).map((c) => c.style),
    );
    expect(outlinePassStyles.has(DEFAULT_OUTLINE_COLOR)).toBe(true);
  });

  it('outline color is overridable via options.outline', () => {
    const { ctx, calls } = recordingCtx();
    drawTextOutlined(ctx as never, 'A', 0, 0, { scale: 1, outline: '#ff0000' });
    const outlinePassStyles = new Set(
      calls.slice(0, Math.floor(calls.length / 5) * 4).map((c) => c.style),
    );
    expect(outlinePassStyles.has('#ff0000')).toBe(true);
  });

  it('fill color flows through to ctx.fillStyle (last pass wins)', () => {
    const ctx = createMockCtx();
    drawTextOutlined(ctx as never, 'A', 0, 0, { scale: 1, color: '#00ff00' });
    expect(ctx.fillStyle).toBe('#00ff00');
  });
});

describe('drawTextOutlined — charGap advances both outline and fill passes', () => {
  it('charGap option is honoured by the outlined variant', () => {
    const flat = createMockCtx();
    const outlined = createMockCtx();
    drawText(flat as never, 'AB', 0, 0, { scale: 1, charGap: 4 });
    drawTextOutlined(outlined as never, 'AB', 0, 0, { scale: 1, charGap: 4 });
    // Same lit-pixel count (charGap doesn't change pixel count, only positions).
    const litPixelCount = flat.fillRect.mock.calls.length;
    expect(outlined.fillRect.mock.calls.length).toBe(litPixelCount * 5);
  });
});

describe('drawText with a custom font (createFont + addGlyph)', () => {
  it('renders a custom-registered glyph', () => {
    const heart = [0x00, 0x66, 0xff, 0xff, 0x66];
    const font = addGlyph(DEFAULT_FONT, 0x2665, heart);
    const ctx = createMockCtx();
    drawText(ctx as never, '\u2665', 0, 0, { scale: 1, font });
    const expected = decodeLitPixels(heart).map(([c, r]) => [c, r, 1, 1]);
    expect(fillRectCalls(ctx).sort()).toEqual(expected.sort());
  });

  it('uses the provided font instead of DEFAULT_FONT', () => {
    const blankA: BitmapFont = addGlyph(DEFAULT_FONT, 0x41, [0x00, 0x00, 0x00, 0x00, 0x00]);
    const ctx = createMockCtx();
    drawText(ctx as never, 'A', 0, 0, { scale: 1, font: blankA });
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});

describe('font5x7 — tilde (0x7E) divergence from upstream Stang', () => {
  // Stang's `font5x7.h` encodes 0x7E as a right arrow ('->'): [0x08, 0x08, 0x2a, 0x1c, 0x08].
  // We hand-authored a real tilde wave instead. See `font5x7-data.ts` for the rationale.
  const STANG_ARROW_0x7E = [0x08, 0x08, 0x2a, 0x1c, 0x08];
  // The hand-authored tilde: a single-pixel-wide sine wave centered vertically.
  // Bits per column (bit 0 = top row of a 7-row cell):
  //   col 0 = 0x08 → row 3   (wave at vertical center)
  //   col 1 = 0x04 → row 2   (wave rises one row)
  //   col 2 = 0x08 → row 3   (wave back to center)
  //   col 3 = 0x10 → row 4   (wave falls one row)
  //   col 4 = 0x08 → row 3   (wave back to center)
  // Result, rendered (rows 2-4 lit, symmetric about the cell's vertical middle):
  //   row 0: . . . . .
  //   row 1: . . . . .
  //   row 2: . X . . .
  //   row 3: X . X . X
  //   row 4: . . . X .
  //   row 5: . . . . .
  //   row 6: . . . . .
  const HAND_AUTHORED_TILDE_0x7E = [0x08, 0x04, 0x08, 0x10, 0x08];

  it("DEFAULT_FONT's 0x7E is no longer Stang's right arrow bytes", () => {
    const tilde = DEFAULT_FONT.glyphs.get(0x7e)!;
    expect(Array.from(tilde)).not.toEqual(STANG_ARROW_0x7E);
  });

  it("DEFAULT_FONT's 0x7E matches the hand-authored tilde wave", () => {
    const tilde = DEFAULT_FONT.glyphs.get(0x7e)!;
    expect(Array.from(tilde)).toEqual(HAND_AUTHORED_TILDE_0x7E);
  });

  it('the tilde glyph is centered vertically in the 5×7 cell (lit rows span 2-4 only)', () => {
    const litPixels = decodeLitPixels(HAND_AUTHORED_TILDE_0x7E);
    const litRows = new Set(litPixels.map(([, r]) => r));
    expect(litRows.size).toBe(3);
    expect(Math.min(...Array.from(litRows))).toBe(2);
    expect(Math.max(...Array.from(litRows))).toBe(4);
  });

  it('the tilde glyph is a single-pixel-wide wave (exactly 5 lit pixels, one per column)', () => {
    const litPixels = decodeLitPixels(HAND_AUTHORED_TILDE_0x7E);
    expect(litPixels.length).toBe(5);
    const litColumns = new Set(litPixels.map(([c]) => c));
    expect(litColumns.size).toBe(5);
  });

  it("drawText('~') renders without crashing", () => {
    const ctx = createMockCtx();
    expect(() => drawText(ctx as never, '~', 0, 0, { scale: 1 })).not.toThrow();
    expect(ctx.fillRect).toHaveBeenCalledTimes(5);
  });
});
