import { describe, it, expect } from 'vitest';
import {
  drawSimpleFeet,
  DEFAULT_SIMPLE_FEET,
  IK_PARITY_FEET,
  type SimpleFeetConfig,
} from '../animation/simple-feet';
import { evaluateLocomotion, DEFAULT_GAIT, type LocomotionPose } from '../animation/locomotion';
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

describe('IK_PARITY_FEET', () => {
  it('is exported as a Readonly<SimpleFeetConfig> with idleSpread: 0', () => {
    expect(IK_PARITY_FEET).toBeDefined();
    expect(IK_PARITY_FEET.idleSpread).toBe(0);
  });

  it('derives every other field from DEFAULT_SIMPLE_FEET (preset recipe)', () => {
    expect(IK_PARITY_FEET.footW).toBe(DEFAULT_SIMPLE_FEET.footW);
    expect(IK_PARITY_FEET.footH).toBe(DEFAULT_SIMPLE_FEET.footH);
    expect(IK_PARITY_FEET.baseY).toBe(DEFAULT_SIMPLE_FEET.baseY);
    expect(IK_PARITY_FEET.color).toBe(DEFAULT_SIMPLE_FEET.color);
    expect(IK_PARITY_FEET.outline).toBe(DEFAULT_SIMPLE_FEET.outline);
  });

  // footW is overridden to an EVEN value so halfFootW is an integer and the
  // renderer's Math.round pixel-grid snapping does not shift the recovered
  // foot center. The idleSpread=0 contract is independent of footW.
  const EVEN_FOOT_W = 8;
  const SYMMETRIC_FEET: SimpleFeetConfig = { ...IK_PARITY_FEET, footW: EVEN_FOOT_W };

  it('produces equal-magnitude endpoint separation at phase 0 (a footfall endpoint)', () => {
    // At phase 0: cos(0) = +1, cos(π) = -1. With idleSpread = 0 the foot
    // CENTERS land at ±strideLength (drawSimpleFeet places the rect corner
    // at -halfFootW + center, so we add halfFootW back to recover center).
    const stride = DEFAULT_GAIT.strideLength;
    const pose = evaluateLocomotion({ phase: 0 }, DEFAULT_GAIT);
    const ctx = createMockCtx();
    drawSimpleFeet(ctx as never, pose, SYMMETRIC_FEET);
    const halfFootW = SYMMETRIC_FEET.footW / 2;
    const leftCenter = (ctx.fillRect.mock.calls[0]![0] as number) + halfFootW;
    const rightCenter = (ctx.fillRect.mock.calls[1]![0] as number) + halfFootW;
    expect(leftCenter).toBe(stride);
    expect(rightCenter).toBe(-stride);
    expect(Math.abs(leftCenter)).toBe(Math.abs(rightCenter));
  });

  it('swaps sides at phase 0: left foot is right of midline, right foot is left', () => {
    const pose = evaluateLocomotion({ phase: 0 }, DEFAULT_GAIT);
    const ctx = createMockCtx();
    drawSimpleFeet(ctx as never, pose, SYMMETRIC_FEET);
    const halfFootW = SYMMETRIC_FEET.footW / 2;
    const leftCenter = (ctx.fillRect.mock.calls[0]![0] as number) + halfFootW;
    const rightCenter = (ctx.fillRect.mock.calls[1]![0] as number) + halfFootW;
    expect(leftCenter).toBeGreaterThan(0);
    expect(rightCenter).toBeLessThan(0);
  });

  it('reverses the side swap at phase π (endpoints still equal-magnitude)', () => {
    const stride = DEFAULT_GAIT.strideLength;
    const pose = evaluateLocomotion({ phase: Math.PI }, DEFAULT_GAIT);
    const ctx = createMockCtx();
    drawSimpleFeet(ctx as never, pose, SYMMETRIC_FEET);
    const halfFootW = SYMMETRIC_FEET.footW / 2;
    const leftCenter = (ctx.fillRect.mock.calls[0]![0] as number) + halfFootW;
    const rightCenter = (ctx.fillRect.mock.calls[1]![0] as number) + halfFootW;
    expect(leftCenter).toBe(-stride);
    expect(rightCenter).toBe(stride);
    expect(leftCenter).toBeLessThan(0);
    expect(rightCenter).toBeGreaterThan(0);
  });

  it('orbits through zero separation at phase π/2 (midline crossing)', () => {
    // cos(π/2) ≈ 0, cos(3π/2) ≈ 0 — both feet at the midline.
    const pose = evaluateLocomotion({ phase: Math.PI / 2 }, DEFAULT_GAIT);
    const ctx = createMockCtx();
    drawSimpleFeet(ctx as never, pose, SYMMETRIC_FEET);
    const halfFootW = SYMMETRIC_FEET.footW / 2;
    const leftCenter = (ctx.fillRect.mock.calls[0]![0] as number) + halfFootW;
    const rightCenter = (ctx.fillRect.mock.calls[1]![0] as number) + halfFootW;
    expect(leftCenter).toBe(0);
    expect(rightCenter).toBe(0);
  });
});
