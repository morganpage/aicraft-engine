import { describe, it, expect } from 'vitest';
import { drawGlow } from '../primitives/glow';
import { createMockCtx } from './_helpers';

describe('drawGlow', () => {
  it('creates a radial gradient centered at (x,y) with inner radius 0', () => {
    const ctx = createMockCtx();
    drawGlow(ctx as never, 100, 200, 32, '#ff8800');
    expect(ctx.createRadialGradient).toHaveBeenCalledWith(100, 200, 0, 100, 200, 32);
  });

  it('sets globalCompositeOperation to lighter for additive blending', () => {
    const ctx = createMockCtx();
    drawGlow(ctx as never, 0, 0, 16, '#ff0000');
    expect(ctx.globalCompositeOperation).toBe('lighter');
  });

  it('draws a filled circle via beginPath / arc / fill', () => {
    const ctx = createMockCtx();
    drawGlow(ctx as never, 50, 60, 24, '#00ff00');
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.arc).toHaveBeenCalledWith(50, 60, 24, 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
  });

  it('defaults intensity to 1 (full color at center)', () => {
    const ctx = createMockCtx();
    drawGlow(ctx as never, 0, 0, 10, '#ff8800');
    const gradient = ctx.createRadialGradient.mock.results[0].value;
    const stop0 = gradient.addColorStop.mock.calls[0];
    const stop1 = gradient.addColorStop.mock.calls[1];
    expect(stop0[0]).toBe(0);
    expect(stop0[1]).toBe('rgba(255, 136, 0, 1)');
    expect(stop1[0]).toBe(1);
    expect(stop1[1]).toBe('rgba(255, 136, 0, 0)');
  });

  it('honors custom intensity', () => {
    const ctx = createMockCtx();
    drawGlow(ctx as never, 0, 0, 10, '#3366cc', 0.5);
    const gradient = ctx.createRadialGradient.mock.results[0].value;
    expect(gradient.addColorStop.mock.calls[0][1]).toBe('rgba(51, 102, 204, 0.5)');
    expect(gradient.addColorStop.mock.calls[1][1]).toBe('rgba(51, 102, 204, 0)');
  });

  it('clamps intensity above 1 down to 1', () => {
    const ctx = createMockCtx();
    drawGlow(ctx as never, 0, 0, 10, '#ff0000', 5);
    const gradient = ctx.createRadialGradient.mock.results[0].value;
    expect(gradient.addColorStop.mock.calls[0][1]).toBe('rgba(255, 0, 0, 1)');
  });

  it('clamps negative intensity up to 0', () => {
    const ctx = createMockCtx();
    drawGlow(ctx as never, 0, 0, 10, '#ff0000', -2);
    const gradient = ctx.createRadialGradient.mock.results[0].value;
    expect(gradient.addColorStop.mock.calls[0][1]).toBe('rgba(255, 0, 0, 0)');
    expect(gradient.addColorStop.mock.calls[1][1]).toBe('rgba(255, 0, 0, 0)');
  });

  it('returns early on zero radius without creating a gradient', () => {
    const ctx = createMockCtx();
    drawGlow(ctx as never, 10, 10, 0, '#ff0000');
    expect(ctx.createRadialGradient).not.toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it('clamps negative radius to 0 (early return)', () => {
    const ctx = createMockCtx();
    drawGlow(ctx as never, 10, 10, -5, '#ff0000');
    expect(ctx.createRadialGradient).not.toHaveBeenCalled();
  });

  it('calls save and restore to manage ctx state', () => {
    const ctx = createMockCtx();
    drawGlow(ctx as never, 0, 0, 10, '#ff0000');
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });
});
