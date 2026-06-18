import { describe, it, expect } from 'vitest';
import { outlineRect, DEFAULT_OUTLINE_COLOR } from '../primitives/outline-rect';
import { createMockCtx } from './_helpers';

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
});
