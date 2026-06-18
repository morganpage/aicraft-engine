/**
 * Deterministic sample-scene generators for the animation prototypes.
 *
 * Each sample returns a plain-data `SampleScene` (arrays of line segments and
 * point markers). The pillar is pure math (no `ctx` here); the benchmarker
 * renders these descriptors to PNG via node-canvas.
 *
 * Coordinate space: 256x256 canvas, origin TOP-LEFT, +X right, +Y down. This
 * matches the pillar rotation convention: positive rotation is clockwise on
 * screen, identical to `ctx.rotate(+angle)`.
 *
 * Benchmarker entry points:
 *   - `sampleLimbReach()`     2-bone limb reaching several targets (bend dir).
 *   - `sampleFabrikChain()`   FABRIK before/after + unreachable stretch.
 *   - `sampleSpringChain()`   hanging Verlet chain, 4 overlaid snapshots.
 *   - `sampleRigHierarchy()`  5-bone skeleton, rest vs posed (rotation drag).
 */

import type { Vec2, AffineTransform, Bone, BonePose } from './anim-rig-min';
import { computeWorldTransforms } from './anim-rig-min';
import { solveLimb, calculateBendDir, solveFABRIK } from './anim-ik';
import {
  advanceSpringChain,
  createSpringChain,
  DEFAULT_SPRING,
} from './anim-spring';
import type { VerletNode } from './anim-spring';

/** Canvas dimension (square). */
const CANVAS_SIZE = 256;

/** Spitekeep-spirit palette: warm fill, dark outline, plus accents. */
const PALETTE = {
  /** Primary bone color (solved / posed limbs and chains). */
  bone: '#FE5701',
  /** Joint markers and root dots. */
  joint: '#1d1128',
  /** Target markers. */
  target: '#1d1128',
  /** Pole-vector markers. */
  pole: '#b91c1c',
  /** Ghost / before / rest color. */
  ghost: '#caa42a',
  /** Secondary accent (unreachable-stretch chain). */
  spine: '#7c3aed',
} as const;

/** A line segment to stroke. */
export interface LineSegment {
  from: Vec2;
  to: Vec2;
  color: string;
  /** Stroke width in px. */
  width: number;
}

/** A point marker to fill. */
export interface PointMarker {
  pos: Vec2;
  /** Radius in px. */
  r: number;
  color: string;
}

/** A drawable scene: lists of segments and points (plain data, no `ctx`). */
export interface SampleScene {
  lines: LineSegment[];
  points: PointMarker[];
}

function pushBone(
  scene: SampleScene,
  a: Vec2,
  b: Vec2,
  color: string,
  width: number,
): void {
  scene.lines.push({ from: a, to: b, color, width });
}

function pushJoint(scene: SampleScene, p: Vec2, r: number, color: string): void {
  scene.points.push({ pos: p, r, color });
}

/**
 * Sample: a 2-bone limb (root fixed at canvas center) reaching 5 target
 * directions, plus one unreachable target. Each reachable target carries a pole
 * vector; the joint should visibly bend toward the pole. The 5th target flips
 * the pole to the opposite side to prove `calculateBendDir` responds to it.
 *
 * Renders, per target: the two bone segments (root -> joint, joint -> end), the
 * root / joint / target / pole markers. The unreachable target is drawn in the
 * ghost color as a straight clamp.
 *
 * @returns a drawable SampleScene
 */
export function sampleLimbReach(): SampleScene {
  const scene: SampleScene = { lines: [], points: [] };
  const root: Vec2 = { x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 };
  const lenA = 40;
  const lenB = 40;
  const reachableR = 65;
  const poleDist = 26;

  const angles = [0, 72, 144, 216, 288].map((d) => (d * Math.PI) / 180);

  angles.forEach((ang, idx) => {
    const target: Vec2 = {
      x: root.x + Math.cos(ang) * reachableR,
      y: root.y + Math.sin(ang) * reachableR,
    };
    // Perpendicular to root -> target. Default rotates +90 deg (clockwise on
    // screen); the last target flips to -90 deg to demonstrate the bend flip.
    const sign = idx === angles.length - 1 ? -1 : 1;
    const perpAng = ang + (Math.PI / 2) * sign;
    const pole: Vec2 = {
      x: root.x + Math.cos(perpAng) * poleDist,
      y: root.y + Math.sin(perpAng) * poleDist,
    };
    const bendDir = calculateBendDir(root, target, pole);
    const res = solveLimb(root, target, lenA, lenB, bendDir);

    pushBone(scene, root, res.jointPos, PALETTE.bone, 3);
    pushBone(scene, res.jointPos, res.endPos, PALETTE.bone, 3);
    pushJoint(scene, root, 3.5, PALETTE.joint);
    pushJoint(scene, res.jointPos, 2.5, PALETTE.joint);
    pushJoint(scene, target, 4, PALETTE.target);
    pushJoint(scene, pole, 2.5, PALETTE.pole);
  });

  // Unreachable target (radius 95 > maxReach 80) -> straight-line clamp.
  const farAng = (45 * Math.PI) / 180;
  const farTarget: Vec2 = {
    x: root.x + Math.cos(farAng) * 95,
    y: root.y + Math.sin(farAng) * 95,
  };
  const farRes = solveLimb(root, farTarget, lenA, lenB, 1);
  pushBone(scene, root, farRes.jointPos, PALETTE.ghost, 2);
  pushBone(scene, farRes.jointPos, farRes.endPos, PALETTE.ghost, 2);
  pushJoint(scene, farTarget, 3, PALETTE.target);

  return scene;
}

/**
 * Sample: a 5-segment FABRIK chain solving to two targets, showing convergence.
 *
 * Renders the initial straight chain (ghost) plus two solved chains:
 *   - Target A is reachable and off-axis -> produces a curved solve (bone).
 *   - Target B is unreachable (beyond total chain length) -> straight stretch
 *     toward it (spine accent).
 *
 * Joint markers are drawn on chain A so the curve is readable.
 *
 * @returns a drawable SampleScene
 */
export function sampleFabrikChain(): SampleScene {
  const scene: SampleScene = { lines: [], points: [] };
  const segLen = 20;
  const segCount = 5;
  const boneLengths: number[] = [];
  for (let i = 0; i < segCount; i++) boneLengths.push(segLen);

  // Initial straight chain: root at left-center, extending right.
  const root: Vec2 = { x: 30, y: 128 };
  const initial: Vec2[] = [];
  for (let i = 0; i <= segCount; i++) {
    initial.push({ x: root.x + i * segLen, y: root.y });
  }

  // Ghost: straight initial chain.
  for (let i = 0; i < segCount; i++) {
    pushBone(scene, initial[i], initial[i + 1], PALETTE.ghost, 2);
  }
  pushJoint(scene, root, 3.5, PALETTE.joint);

  // Target A: reachable, up and to the right -> curved solve.
  const targetA: Vec2 = { x: 100, y: 70 };
  const resA = solveFABRIK(initial, boneLengths, targetA);
  for (let i = 0; i < segCount; i++) {
    pushBone(scene, resA.positions[i], resA.positions[i + 1], PALETTE.bone, 3);
  }
  for (const p of resA.positions) pushJoint(scene, p, 2.5, PALETTE.joint);
  pushJoint(scene, targetA, 4, PALETTE.target);

  // Target B: unreachable (distance > totalLength 100) -> straight stretch.
  const targetB: Vec2 = { x: 230, y: 50 };
  const resB = solveFABRIK(initial, boneLengths, targetB);
  for (let i = 0; i < segCount; i++) {
    pushBone(scene, resB.positions[i], resB.positions[i + 1], PALETTE.spine, 2);
  }
  pushJoint(scene, targetB, 4, PALETTE.target);

  return scene;
}

/**
 * Sample: a hanging 8-node spring chain under gravity, with the anchor moving
 * along a horizontal sine path over 30 ticks. Overlays 4 snapshots (ticks 0,
 * 10, 20, 30) in distinct colors so the sway, lag, and damping are visible at
 * a glance.
 *
 * @returns a drawable SampleScene
 */
export function sampleSpringChain(): SampleScene {
  const scene: SampleScene = { lines: [], points: [] };
  const nodeCount = 8;
  const segLen = 12;
  const baseAnchorX = 128;
  const baseAnchorY = 70;
  const ticks = 30;

  const colors = ['#caa42a', '#FE5701', '#b91c1c', '#1d1128'];
  const snapshotTicks = [0, 10, 20, 30];
  const snapshots: VerletNode[][] = [];

  let nodes = createSpringChain(nodeCount, baseAnchorX, baseAnchorY, segLen);

  for (let t = 0; t <= ticks; t++) {
    const anchorX = baseAnchorX + Math.sin(t * 0.25) * 40;
    if (snapshotTicks.includes(t)) {
      snapshots.push(nodes.map((n) => ({ ...n })));
    }
    nodes = advanceSpringChain(nodes, anchorX, baseAnchorY, 1, {
      ...DEFAULT_SPRING,
      segmentLength: segLen,
    });
  }

  snapshots.forEach((snap, idx) => {
    const color = colors[idx];
    for (let i = 0; i < snap.length - 1; i++) {
      pushBone(scene, snap[i], snap[i + 1], color, 2);
    }
    pushJoint(scene, snap[0], 3, color);
  });

  return scene;
}

/**
 * Sample: a 5-bone humanoid-ish skeleton (hip -> spine -> head, plus
 * hip -> thigh -> shin). Demonstrates world-transform propagation: a positive
 * rotation on the hip visibly rotates ALL children (spine, head, leg) with it,
 * and a negative local rotation on the spine stacks on top of the hip's.
 *
 * Overlays the rest pose (ghost) and the posed pose (bone / joint) sharing the
 * same hip origin so the rotation effect is obvious. Bones are drawn as lines
 * from each parent's world origin to the child's world origin.
 *
 * @returns a drawable SampleScene
 */
export function sampleRigHierarchy(): SampleScene {
  const scene: SampleScene = { lines: [], points: [] };
  const hipX = 128;
  const hipY = 180;

  // parentIndex precedes child. Translations are LOCAL (relative to parent).
  // +Y is down, so "up the body" is negative ty.
  const bones: Bone[] = [
    { parentIndex: -1, rest: { tx: hipX, ty: hipY } }, // 0 hip (root)
    { parentIndex: 0, rest: { tx: 0, ty: -34 } },      // 1 spine
    { parentIndex: 1, rest: { tx: 0, ty: -22 } },      // 2 head
    { parentIndex: 0, rest: { tx: -8, ty: 6 } },       // 3 thigh (left of hip)
    { parentIndex: 3, rest: { tx: 0, ty: 28 } },       // 4 shin
  ];

  const restPoses: BonePose[] = bones.map((b) => ({ ...b.rest }));

  // Posed: rotate the hip +35 deg (clockwise on screen), spine -20 deg (local).
  const posedPoses: BonePose[] = bones.map((b) => ({ ...b.rest }));
  posedPoses[0].rotation = (35 * Math.PI) / 180;
  posedPoses[1].rotation = (-20 * Math.PI) / 180;

  const restWorld = computeWorldTransforms(bones, restPoses);
  const posedWorld = computeWorldTransforms(bones, posedPoses);

  const drawRig = (
    world: AffineTransform[],
    boneColor: string,
    jointColor: string,
    width: number,
  ): void => {
    for (let i = 0; i < bones.length; i++) {
      const p = bones[i].parentIndex;
      if (p === -1) continue;
      const from: Vec2 = { x: world[p][4], y: world[p][5] };
      const to: Vec2 = { x: world[i][4], y: world[i][5] };
      pushBone(scene, from, to, boneColor, width);
    }
    for (let i = 0; i < bones.length; i++) {
      pushJoint(scene, { x: world[i][4], y: world[i][5] }, i === 0 ? 3.5 : 2.5, jointColor);
    }
  };

  drawRig(restWorld, PALETTE.ghost, PALETTE.ghost, 2);
  drawRig(posedWorld, PALETTE.bone, PALETTE.joint, 3);

  return scene;
}
