import { describe, it, expect } from 'vitest';
import {
  drawSimpleFeet,
  DEFAULT_SIMPLE_FEET,
  type SimpleFeetConfig,
} from '../animation/simple-feet';
import type { LocomotionPose } from '../animation/locomotion';
import { createMockCtx } from './_helpers';

function makePose(
  left: { x: number; y: number } = { x: 0, y: 0 },
  right: { x: number; y: number } = { x: 0, y: 0 },
): LocomotionPose {
  return {
    hipOffset: { x: 0, y: 0 },
    leftFootOffset: left,
    rightFootOffset: right,
  };
}

const NO_OUTLINE: SimpleFeetConfig = { ...DEFAULT_SIMPLE_FEET, outline: undefined };

describe('drawSimpleFeet', () => {
  it('places both feet at idle spread on a neutral pose', () => {
    const ctx = createMockCtx();
    drawSimpleFeet(ctx as never, makePose(), NO_OUTLINE);
    const halfFootW = DEFAULT_SIMPLE_FEET.footW / 2;
    const expectedLeftX = Math.round(-DEFAULT_SIMPLE_FEET.idleSpread - halfFootW);
    const expectedRightX = Math.round(DEFAULT_SIMPLE_FEET.idleSpread - halfFootW);
    expect(ctx.fillRect).toHaveBeenNthCalledWith(
      1,
      expectedLeftX,
      DEFAULT_SIMPLE_FEET.baseY,
      DEFAULT_SIMPLE_FEET.footW,
      DEFAULT_SIMPLE_FEET.footH,
    );
    expect(ctx.fillRect).toHaveBeenNthCalledWith(
      2,
      expectedRightX,
      DEFAULT_SIMPLE_FEET.baseY,
      DEFAULT_SIMPLE_FEET.footW,
      DEFAULT_SIMPLE_FEET.footH,
    );
  });

  it('lifts the left foot upward when leftFootOffset.y > 0', () => {
    const ctx = createMockCtx();
    drawSimpleFeet(ctx as never, makePose({ x: 0, y: 3 }, { x: 0, y: 0 }), NO_OUTLINE);
    expect(ctx.fillRect).toHaveBeenNthCalledWith(
      1,
      -9,
      DEFAULT_SIMPLE_FEET.baseY - 3,
      DEFAULT_SIMPLE_FEET.footW,
      DEFAULT_SIMPLE_FEET.footH,
    );
  });

  it('shifts the left foot forward when leftFootOffset.x > 0', () => {
    const ctx = createMockCtx();
    drawSimpleFeet(ctx as never, makePose({ x: 2, y: 0 }, { x: 0, y: 0 }), NO_OUTLINE);
    expect(ctx.fillRect).toHaveBeenNthCalledWith(
      1,
      -7,
      DEFAULT_SIMPLE_FEET.baseY,
      DEFAULT_SIMPLE_FEET.footW,
      DEFAULT_SIMPLE_FEET.footH,
    );
  });

  it('positions the right foot independently when it is out of phase', () => {
    const ctx = createMockCtx();
    drawSimpleFeet(ctx as never, makePose({ x: 0, y: 0 }, { x: 3, y: 2 }), NO_OUTLINE);
    expect(ctx.fillRect).toHaveBeenNthCalledWith(
      2,
      5,
      DEFAULT_SIMPLE_FEET.baseY - 2,
      DEFAULT_SIMPLE_FEET.footW,
      DEFAULT_SIMPLE_FEET.footH,
    );
  });

  it('routes through outlineRect (fillRect + strokeRect) when outline is provided', () => {
    const ctx = createMockCtx();
    drawSimpleFeet(ctx as never, makePose(), DEFAULT_SIMPLE_FEET);
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(2);
    expect(ctx.lineWidth).toBe(1);
    expect(ctx.strokeStyle).toBe(DEFAULT_SIMPLE_FEET.outline);
  });

  it('uses bare fillRect with fillStyle=color and no stroke when outline is omitted', () => {
    const ctx = createMockCtx();
    drawSimpleFeet(ctx as never, makePose(), NO_OUTLINE);
    expect(ctx.fillStyle).toBe(DEFAULT_SIMPLE_FEET.color);
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });

  it('rounds fractional offsets to integer pixel positions via Math.round', () => {
    const ctx = createMockCtx();
    drawSimpleFeet(ctx as never, makePose({ x: 1.4, y: 2.6 }, { x: 0, y: 0 }), NO_OUTLINE);
    expect(ctx.fillRect).toHaveBeenNthCalledWith(
      1,
      Math.round(-9 + 1.4),
      Math.round(DEFAULT_SIMPLE_FEET.baseY - 2.6),
      DEFAULT_SIMPLE_FEET.footW,
      DEFAULT_SIMPLE_FEET.footH,
    );
  });

  it('respects a custom config (footW/footH/idleSpread/baseY/color)', () => {
    const ctx = createMockCtx();
    const custom: SimpleFeetConfig = {
      footW: 10,
      footH: 8,
      idleSpread: 8,
      baseY: 20,
      color: '#abcdef',
    };
    drawSimpleFeet(ctx as never, makePose(), custom);
    expect(ctx.fillRect).toHaveBeenNthCalledWith(1, -13, 20, 10, 8);
    expect(ctx.fillRect).toHaveBeenNthCalledWith(2, 3, 20, 10, 8);
    expect(ctx.fillStyle).toBe('#abcdef');
  });
});
