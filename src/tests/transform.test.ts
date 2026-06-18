import { describe, it, expect } from 'vitest';
import { createSkeleton, createRig, computeWorldTransforms } from '../animation/rig';
import { localToWorld, worldToLocal } from '../animation/transform';

describe('localToWorld', () => {
  it('transforms a local point through an identity bone unchanged', () => {
    const skel = createSkeleton([{ id: 'root', parentIndex: -1, restPose: {} }]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    expect(localToWorld({ x: 5, y: 7 }, rig, 0)).toEqual({ x: 5, y: 7 });
  });

  it('applies translation only', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: { translation: { x: 10, y: 20 } } },
    ]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    expect(localToWorld({ x: 1, y: 1 }, rig, 0)).toEqual({ x: 11, y: 21 });
  });

  it('applies parent translation + child scale (bit-exact, no trig)', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: { translation: { x: 10, y: 20 } } },
      { id: 'child', parentIndex: 0, restPose: { scale: { x: 2, y: 3 } } },
    ]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    // child world matrix: [2, 0, 0, 3, 10, 20]
    // local (1, 1) → world (2*1 + 0*1 + 10, 0*1 + 3*1 + 20) = (12, 23)
    expect(localToWorld({ x: 1, y: 1 }, rig, 1)).toEqual({ x: 12, y: 23 });
  });

  it('respects current localPoses (recomputes after pose change)', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: {} },
    ]);
    const rig = createRig(skel);
    rig.localPoses[0] = { translation: { x: 100, y: 200 } };
    computeWorldTransforms(rig);
    expect(localToWorld({ x: 0, y: 0 }, rig, 0)).toEqual({ x: 100, y: 200 });
  });
});

describe('worldToLocal', () => {
  it('inverts a pure translation', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: { translation: { x: 10, y: 20 } } },
    ]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    expect(worldToLocal({ x: 15, y: 25 }, rig, 0)).toEqual({ x: 5, y: 5 });
  });

  it('inverts a scale + translation (bit-exact)', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: { translation: { x: 10, y: 20 } } },
      { id: 'child', parentIndex: 0, restPose: { scale: { x: 2, y: 3 } } },
    ]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    // child world: [2, 0, 0, 3, 10, 20]; det = 6
    // world (12, 23) → local: ix=2, iy=3 → x=(3*2 - 0*3)/6 = 1, y=(-0*2 + 2*3)/6 = 1
    expect(worldToLocal({ x: 12, y: 23 }, rig, 1)).toEqual({ x: 1, y: 1 });
  });

  it('returns origin for a singular (zero-scale) bone', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: {} },
      { id: 'zero', parentIndex: 0, restPose: { scale: { x: 0, y: 0 } } },
    ]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    expect(worldToLocal({ x: 100, y: 100 }, rig, 1)).toEqual({ x: 0, y: 0 });
  });

  it('round-trips with localToWorld (identity, bit-exact for translation+scale)', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: { translation: { x: 5, y: 7 } } },
      {
        id: 'child',
        parentIndex: 0,
        restPose: { translation: { x: 1, y: 2 }, scale: { x: 3, y: 4 } },
      },
    ]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    const original = { x: 2.5, y: -1.5 };
    const world = localToWorld(original, rig, 1);
    const back = worldToLocal(world, rig, 1);
    // Integer-ish inputs through rational scale factors → exact round-trip.
    expect(back).toEqual(original);
  });

  it('round-trips with localToWorld through a rotated bone (trig, approximate)', () => {
    const skel = createSkeleton([
      { id: 'root', parentIndex: -1, restPose: { rotation: 0.7, translation: { x: 3, y: -2 } } },
    ]);
    const rig = createRig(skel);
    computeWorldTransforms(rig);
    const original = { x: 11.3, y: -4.2 };
    const world = localToWorld(original, rig, 0);
    const back = worldToLocal(world, rig, 0);
    expect(back.x).toBeCloseTo(original.x, 9);
    expect(back.y).toBeCloseTo(original.y, 9);
  });
});
