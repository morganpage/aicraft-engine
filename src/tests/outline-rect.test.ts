import { describe, it, expect } from 'vitest';
import { outlineRect, DEFAULT_OUTLINE_COLOR } from '../primitives/outline-rect';
// Also import OutlineCoverage from the primitives barrel — pins the
// public re-export and protects against barrel drift.
import { type OutlineCoverage } from '../primitives';
import { createMockCtx } from './_helpers';

describe('OutlineCoverage (barrel export)', () => {
  it('is importable from the primitives barrel', () => {
    // Compile-time contract: the type alias resolves to the expected union.
    // If `OutlineCoverage` is ever dropped from `src/primitives/index.ts`,
    // `tsc --noEmit` fails at the import above; this assertion documents
    // the intent at runtime.
    const coverage: OutlineCoverage = 'floor';
    expect(coverage).toBe('floor');
  });
});

describe('outlineRect', () => {
  it('floors coordinates to integers', () => {
    const ctx = createMockCtx();
    outlineRect(ctx as never, 10.7, 20.3, 32, 32, '#ff0000');
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 32, 32);
    expect(ctx.strokeRect).toHaveBeenCalledWith(10.5, 20.5, 31, 31);
  });

  it('uses default outline color when none is provided', () => {
    const ctx = createMockCtx();
    outlineRect(ctx as never, 0, 0, 10, 10, '#ff0000');
    expect(ctx.strokeStyle).toBe(DEFAULT_OUTLINE_COLOR);
  });

  it('uses provided outline color', () => {
    const ctx = createMockCtx();
    outlineRect(ctx as never, 0, 0, 10, 10, '#ff0000', '#00ff00');
    expect(ctx.strokeStyle).toBe('#00ff00');
  });

  it('sets fillStyle to the fill color', () => {
    const ctx = createMockCtx();
    outlineRect(ctx as never, 0, 0, 10, 10, '#abcdef');
    expect(ctx.fillStyle).toBe('#abcdef');
  });

  it('uses 1px line width', () => {
    const ctx = createMockCtx();
    outlineRect(ctx as never, 0, 0, 10, 10, '#000000');
    expect(ctx.lineWidth).toBe(1);
  });

  it('draws stroke inset by 0.5px for pixel-grid alignment', () => {
    const ctx = createMockCtx();
    outlineRect(ctx as never, 0, 0, 10, 10, '#000000');
    expect(ctx.strokeRect).toHaveBeenCalledWith(0.5, 0.5, 9, 9);
  });

  it("extends fill by 1px under 'ceil' coverage on fractional position", () => {
    const ctx = createMockCtx();
    outlineRect(ctx as never, 10.7, 20.3, 32, 32, '#ff0000', undefined, 'ceil');
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 33, 33);
  });

  it("is a no-op under 'ceil' coverage on integer position", () => {
    const ctx = createMockCtx();
    outlineRect(ctx as never, 10, 20, 32, 32, '#ff0000', undefined, 'ceil');
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 32, 32);
  });

  it("rounds up fractional width/height under 'ceil' coverage", () => {
    const ctx = createMockCtx();
    outlineRect(ctx as never, 0, 0, 10.5, 10.5, '#ff0000', undefined, 'ceil');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 11, 11);
  });
});
