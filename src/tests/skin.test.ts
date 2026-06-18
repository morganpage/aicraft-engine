import { describe, it, expect, vi } from 'vitest';
import { createMockCtx } from './_helpers';
import {
  createSkeleton,
  createRig,
  computeWorldTransforms,
  drawRig,
} from '../animation';
import type { BoneDrawMap } from '../animation/types';

describe('drawRig', () => {
  it('calls save/transform/restore once per non-null bone entry', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: {} },
      { id: 'torso', parentIndex: 0, restPose: {} },
      { id: 'head', parentIndex: 1, restPose: {} },
    ]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    const ctx = createMockCtx();
    const drawA = vi.fn();
    const drawB = vi.fn();
    const skin: BoneDrawMap = [
      { boneIndex: 0, draw: drawA },
      null,
      { boneIndex: 2, draw: drawB },
    ];
    drawRig(ctx as never, rig, skin);
    // Two non-null entries → two save/transform/restore cycles.
    expect(ctx.save).toHaveBeenCalledTimes(2);
    expect(ctx.transform).toHaveBeenCalledTimes(2);
    expect(ctx.restore).toHaveBeenCalledTimes(2);
    expect(drawA).toHaveBeenCalledTimes(1);
    expect(drawB).toHaveBeenCalledTimes(1);
  });

  it('applies the bone world transform via ctx.transform(a,b,c,d,tx,ty)', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: { translation: { x: 5, y: 7 } } },
    ]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    const ctx = createMockCtx();
    const skin: BoneDrawMap = [{ boneIndex: 0, draw: () => {} }];
    drawRig(ctx as never, rig, skin);
    // c = -sin(0)*sy = -0 (IEEE 754 signed zero; functionally identical to +0
    // for ctx.transform).
    expect(ctx.transform).toHaveBeenCalledWith(1, 0, -0, 1, 5, 7);
  });

  it('passes the ctx and rig to the draw callback', () => {
    const skel = createSkeleton([{ id: 'root', parentIndex: -1, restPose: {} }]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    const ctx = createMockCtx();
    const draw = vi.fn();
    const skin: BoneDrawMap = [{ boneIndex: 0, draw }];
    drawRig(ctx as never, rig, skin);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.mock.calls[0][1]).toBe(rig);
  });

  it('skips null entries silently (no save/transform/restore)', () => {
    const skel = createSkeleton([{ id: 'root', parentIndex: -1, restPose: {} }]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    const ctx = createMockCtx();
    const skin: BoneDrawMap = [null];
    drawRig(ctx as never, rig, skin);
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.transform).not.toHaveBeenCalled();
    expect(ctx.restore).not.toHaveBeenCalled();
  });

  it('does not throw on an empty skin', () => {
    const skel = createSkeleton([{ id: 'root', parentIndex: -1, restPose: {} }]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    const ctx = createMockCtx();
    expect(() => drawRig(ctx as never, rig, [])).not.toThrow();
  });

  it('brackets each draw with save-then-restore in order', () => {
    const skel = createSkeleton([
      { id: 'a', parentIndex: -1, restPose: {} },
      { id: 'b', parentIndex: 0, restPose: {} },
    ]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    const ctx = createMockCtx();
    const order: string[] = [];
    const track = (label: string) => () => {
      order.push(`draw:${label}`);
    };
    // Wrap the ctx methods to record relative order against draws.
    const saveCalls = ctx.save;
    const restoreCalls = ctx.restore;
    saveCalls.mockImplementation(() => order.push('save'));
    restoreCalls.mockImplementation(() => order.push('restore'));
    const skin: BoneDrawMap = [
      { boneIndex: 0, draw: track('a') },
      { boneIndex: 1, draw: track('b') },
    ];
    drawRig(ctx as never, rig, skin);
    expect(order).toEqual([
      'save', 'draw:a', 'restore',
      'save', 'draw:b', 'restore',
    ]);
  });
});
