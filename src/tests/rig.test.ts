import { describe, it, expect } from 'vitest';
import { createSkeleton, createRig, computeWorldTransforms } from '../animation/rig';
import type { BoneNode } from '../animation/types';

const ROOT_BONES: BoneNode[] = [
  { id: 'root', parentIndex: -1, restPose: {} },
];

describe('createSkeleton', () => {
  it('builds slotMap from attachmentSlot names', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: {}, attachmentSlot: 'root' },
      { id: 'hand', parentIndex: 0, restPose: {}, attachmentSlot: 'left_hand' },
    ]);
    expect(skel.slotMap['root']).toBe(0);
    expect(skel.slotMap['left_hand']).toBe(1);
  });

  it('omits absent slots from slotMap', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: {} },
      { id: 'child', parentIndex: 0, restPose: {} },
    ]);
    expect(Object.keys(skel.slotMap)).toHaveLength(0);
  });

  it('throws when a parent appears after its child (non-topological)', () => {
    expect(() =>
      createSkeleton([
        { id: 'child', parentIndex: 1, restPose: {} },
        { id: 'parent', parentIndex: -1, restPose: {} },
      ]),
    ).toThrow();
  });

  it('throws on parentIndex === own index (self-cycle)', () => {
    expect(() =>
      createSkeleton([
        { id: 'a', parentIndex: 0, restPose: {} },
      ]),
    ).toThrow();
  });

  it('throws on out-of-range parentIndex', () => {
    expect(() =>
      createSkeleton([
        { id: 'a', parentIndex: 5, restPose: {} },
      ]),
    ).toThrow();
  });

  it('throws on duplicate attachment slot names', () => {
    expect(() =>
      createSkeleton([
        { id: 'a', parentIndex: -1, restPose: {}, attachmentSlot: 'tip' },
        { id: 'b', parentIndex: 0, restPose: {}, attachmentSlot: 'tip' },
      ]),
    ).toThrow();
  });

  it('computes rest world transforms at creation (pure translation, bit-exact)', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: { translation: { x: 10, y: 20 } } },
      { id: 'child', parentIndex: 0, restPose: { translation: { x: 5, y: 7 } } },
    ]);
    // c = -sin(0)*sy = -0 under IEEE 754; this is the bit-exact value the
    // validated prototype also produces. -0 and +0 are functionally identical
    // for all downstream math and ctx.transform().
    expect([...skel.restWorldTransforms[0]]).toEqual([1, 0, -0, 1, 10, 20]);
    expect([...skel.restWorldTransforms[1]]).toEqual([1, 0, -0, 1, 15, 27]);
  });

  it('computes bone lengths from rest-pose world positions', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: { translation: { x: 0, y: 0 } } },
      { id: 'child', parentIndex: 0, restPose: { translation: { x: 3, y: 4 } } },
      { id: 'leaf', parentIndex: 1, restPose: { translation: { x: 0, y: 3 } } },
    ]);
    // root → child: dist((0,0),(3,4)) = 5
    expect(skel.boneLengths[0]).toBeCloseTo(5, 10);
    // child → leaf: dist((3,4),(3,7)) = 3
    expect(skel.boneLengths[1]).toBeCloseTo(3, 10);
    // leaf has no children → 0
    expect(skel.boneLengths[2]).toBe(0);
  });

  it('uses the first child for bone length when multiple children exist', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: {} },
      { id: 'a', parentIndex: 0, restPose: { translation: { x: 10, y: 0 } } },
      { id: 'b', parentIndex: 0, restPose: { translation: { x: 0, y: 20 } } },
    ]);
    // root has two children: a (dist 10) and b (dist 20). First child is a.
    expect(skel.boneLengths[0]).toBeCloseTo(10, 10);
  });

  it('accepts an empty bone array', () => {
    const skel = createSkeleton([]);
    expect(skel.bones).toHaveLength(0);
    expect(skel.restWorldTransforms).toHaveLength(0);
    expect(skel.boneLengths).toHaveLength(0);
  });
});

describe('createRig', () => {
  it('initializes localPoses to cloned rest poses', () => {
    const skel = createSkeleton([
      {
        id: 'root',
        parentIndex: -1,
        restPose: { translation: { x: 1, y: 2 }, rotation: 0.5, scale: { x: 2, y: 3 } },
      },
    ]);
    const rig = createRig(skel);
    expect(rig.localPoses[0].translation).toEqual({ x: 1, y: 2 });
    expect(rig.localPoses[0].rotation).toBe(0.5);
    expect(rig.localPoses[0].scale).toEqual({ x: 2, y: 3 });
  });

  it('does not share translation/scale object identity with the template rest pose', () => {
    const skel = createSkeleton([
      {
        id: 'root',
        parentIndex: -1,
        restPose: { translation: { x: 1, y: 2 }, scale: { x: 2, y: 3 } },
      },
    ]);
    const rig = createRig(skel);
    expect(rig.localPoses[0].translation).not.toBe(skel.bones[0].restPose.translation);
    expect(rig.localPoses[0].scale).not.toBe(skel.bones[0].restPose.scale);
  });

  it('allocates world arrays sized to bone count', () => {
    const skel = createSkeleton([
      { id: 'a', parentIndex: -1, restPose: {} },
      { id: 'b', parentIndex: 0, restPose: {} },
      { id: 'c', parentIndex: 1, restPose: {} },
    ]);
    const rig = createRig(skel);
    expect(rig.worldTransforms).toHaveLength(3);
    expect(rig.worldPositions).toHaveLength(3);
    expect(rig.worldRotations).toHaveLength(3);
  });

  it('references the source template (identity)', () => {
    const skel = createSkeleton(ROOT_BONES);
    const rig = createRig(skel);
    expect(rig.template).toBe(skel);
  });

  it('computes initial world transforms from the rest pose', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: { translation: { x: 5, y: 7 } } },
    ]);
    const rig = createRig(skel);
    // c = -sin(0)*sy = -0 (IEEE 754 signed zero; see createSkeleton test note).
    expect([...rig.worldTransforms[0]]).toEqual([1, 0, -0, 1, 5, 7]);
    expect(rig.worldPositions[0]).toEqual({ x: 5, y: 7 });
    expect(rig.worldRotations[0]).toBe(0);
  });
});

describe('computeWorldTransforms', () => {
  it('pure translation + scale chain composes bit-exact (no trig)', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: { translation: { x: 5, y: 7 } } },
      {
        id: 'child',
        parentIndex: 0,
        restPose: { translation: { x: 10, y: 20 }, scale: { x: 2, y: 3 } },
      },
    ]);
    const rig = createRig(skel);
    // Set an explicit non-rest local pose to prove computeWorldTransforms runs on localPoses.
    rig.localPoses[0] = { translation: { x: 5, y: 7 } };
    rig.localPoses[1] = { translation: { x: 10, y: 20 }, scale: { x: 2, y: 3 } };
    computeWorldTransforms(rig);
    // Parent world: identity rotation, scale 1, translation (5,7).
    // Child local matrix: [2, 0, 0, 3, 10, 20].
    // Child world = parent · child = [2, 0, 0, 3, 5+10, 7+20] = [2, 0, 0, 3, 15, 27].
    // c comes out as -0 (IEEE 754: -sin(0)*sy); functionally identical to +0.
    expect([...rig.worldTransforms[1]]).toEqual([2, 0, -0, 3, 15, 27]);
    expect(rig.worldPositions[1]).toEqual({ x: 15, y: 27 });
    expect(rig.worldRotations[1]).toBe(0);
  });

  it('parent rotation visibly drags children (hip +90° → child local (0,-10) ends at world (10,0))', () => {
    const skel = createSkeleton([
      { id: 'hip', parentIndex: -1, restPose: {} },
      { id: 'spine', parentIndex: 0, restPose: { translation: { x: 0, y: -10 } } },
    ]);
    const rig = createRig(skel);
    rig.localPoses[0] = { rotation: Math.PI / 2 };
    rig.localPoses[1] = { translation: { x: 0, y: -10 } };
    computeWorldTransforms(rig);
    expect(rig.worldPositions[1].x).toBeCloseTo(10, 6);
    expect(rig.worldPositions[1].y).toBeCloseTo(0, 6);
    expect(rig.worldRotations[1]).toBeCloseTo(Math.PI / 2, 6);
  });

  it('local rotations stack additively in world space', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: {} },
      { id: 'child', parentIndex: 0, restPose: {} },
    ]);
    const rig = createRig(skel);
    rig.localPoses[0] = { rotation: 0.3 };
    rig.localPoses[1] = { rotation: 0.5 };
    computeWorldTransforms(rig);
    expect(rig.worldRotations[0]).toBeCloseTo(0.3, 6);
    expect(rig.worldRotations[1]).toBeCloseTo(0.8, 6);
  });

  it('flat-array order processes parents before children (3-deep translation chain)', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: { translation: { x: 1, y: 0 } } },
      { id: 'mid', parentIndex: 0, restPose: { translation: { x: 1, y: 0 } } },
      { id: 'tip', parentIndex: 1, restPose: { translation: { x: 1, y: 0 } } },
    ]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    expect(rig.worldPositions[0]).toEqual({ x: 1, y: 0 });
    expect(rig.worldPositions[1]).toEqual({ x: 2, y: 0 });
    expect(rig.worldPositions[2]).toEqual({ x: 3, y: 0 });
  });

  it('does not mutate localPoses', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: { rotation: 0.4, translation: { x: 2, y: 3 } } },
      { id: 'child', parentIndex: 0, restPose: { scale: { x: 2, y: 2 } } },
    ]);
    const rig = createRig(skel);
    const before = JSON.parse(JSON.stringify(rig.localPoses));
    computeWorldTransforms(rig);
    expect(rig.localPoses).toEqual(before);
  });

  it('root bone with parentIndex -1 composes against identity', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: { translation: { x: 4, y: 5 }, rotation: 0 } },
    ]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    // c = -sin(0)*sy = -0 (IEEE 754 signed zero).
    expect([...rig.worldTransforms[0]]).toEqual([1, 0, -0, 1, 4, 5]);
  });

  it('multiple root bones are independent', () => {
    const skel = createSkeleton([
      { id: 'rootA', parentIndex: -1, restPose: { translation: { x: 10, y: 0 } } },
      { id: 'rootB', parentIndex: -1, restPose: { translation: { x: 0, y: 20 } } },
    ]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    expect(rig.worldPositions[0]).toEqual({ x: 10, y: 0 });
    expect(rig.worldPositions[1]).toEqual({ x: 0, y: 20 });
  });
});
