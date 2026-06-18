import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  solveLimb,
  calculateBendDir,
  solveFABRIK,
  createSpringChain,
  advanceSpringChain,
  DEFAULT_SPRING,
  createSkeleton,
  createRig,
  computeWorldTransforms,
  advanceLocomotion,
  evaluateLocomotion,
  DEFAULT_GAIT,
  volumeScale,
  projectTurnedPart,
} from '../../src/animation';
import type { Vec2, BoneNode, AffineTransform, VerletNode } from '../../src/animation';

const OUTPUT_DIR = 'benchmarks/animation';
const BACKGROUND_COLOR = '#f1f5f9'; // Slate-100: clean, high-contrast neutral background

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
 * Scene 1: 2-Bone Limb Reach
 */
export function sampleLimbReach(): SampleScene {
  const scene: SampleScene = { lines: [], points: [] };
  const root: Vec2 = { x: 128, y: 128 };
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
    const res = solveLimb(root, target, lenA, lenB, { bendDir });

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
  const farRes = solveLimb(root, farTarget, lenA, lenB, { bendDir: 1 });
  pushBone(scene, root, farRes.jointPos, PALETTE.ghost, 2);
  pushBone(scene, farRes.jointPos, farRes.endPos, PALETTE.ghost, 2);
  pushJoint(scene, farTarget, 3, PALETTE.target);

  return scene;
}

/**
 * Scene 2: FABRIK Chain
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
 * Scene 3: Spring Chain
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
 * Scene 4: Rig Hierarchy
 */
export function sampleRigHierarchy(): SampleScene {
  const scene: SampleScene = { lines: [], points: [] };
  const hipX = 128;
  const hipY = 180;

  const bones: BoneNode[] = [
    { id: 'hip', parentIndex: -1, restPose: { translation: { x: hipX, y: hipY } } },
    { id: 'spine', parentIndex: 0, restPose: { translation: { x: 0, y: -34 } } },
    { id: 'head', parentIndex: 1, restPose: { translation: { x: 0, y: -22 } } },
    { id: 'thigh', parentIndex: 0, restPose: { translation: { x: -8, y: 6 } } },
    { id: 'shin', parentIndex: 3, restPose: { translation: { x: 0, y: 28 } } },
  ];

  const template = createSkeleton(bones);
  const rig = createRig(template);

  // Posed: rotate the hip +35 deg (clockwise on screen), spine -20 deg (local).
  rig.localPoses[0].rotation = (35 * Math.PI) / 180;
  rig.localPoses[1].rotation = (-20 * Math.PI) / 180;
  computeWorldTransforms(rig);

  const drawRig = (
    world: readonly AffineTransform[],
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

  drawRig(template.restWorldTransforms, PALETTE.ghost, PALETTE.ghost, 2);
  drawRig(rig.worldTransforms, PALETTE.bone, PALETTE.joint, 3);

  return scene;
}

/**
 * Scene 5: Locomotion Cycle (NEW)
 */
export function sampleLocomotionCycle(): SampleScene {
  const scene: SampleScene = { lines: [], points: [] };
  const centerX = 128;
  const centerY = 100;
  const groundY = 170;
  const thighLen = 35;
  const shinLen = 35;

  const config = {
    baseFrequency: 0.05,
    strideLength: 30,
    strideHeight: 15,
    hipBobHeight: 6,
    hipSwayWidth: 3,
  };

  // 1. Draw trajectories of hip and feet over a full cycle (40 steps)
  const trajectoryPoints = 40;
  const hipPath: Vec2[] = [];
  const leftFootPath: Vec2[] = [];
  const rightFootPath: Vec2[] = [];

  for (let i = 0; i <= trajectoryPoints; i++) {
    const phase = (i / trajectoryPoints) * Math.PI * 2;
    const state = { phase };
    const pose = evaluateLocomotion(state, config);
    hipPath.push({ x: centerX + pose.hipOffset.x, y: centerY + pose.hipOffset.y });
    leftFootPath.push({ x: centerX + pose.leftFootOffset.x, y: groundY - pose.leftFootOffset.y });
    rightFootPath.push({ x: centerX + pose.rightFootOffset.x, y: groundY - pose.rightFootOffset.y });
  }

  // Draw paths
  for (let i = 0; i < trajectoryPoints; i++) {
    pushBone(scene, hipPath[i], hipPath[i + 1], '#caa42a60', 1.5);
    pushBone(scene, leftFootPath[i], leftFootPath[i + 1], '#FE570160', 1.5);
    pushBone(scene, rightFootPath[i], rightFootPath[i + 1], '#7c3aed60', 1.5);
  }

  // Draw ground line
  pushBone(scene, { x: 20, y: groundY }, { x: 236, y: groundY }, '#cbd5e1', 2);

  // 2. Draw stick figures at key phases
  const drawStickFigure = (phase: number, isMain: boolean) => {
    const state = { phase };
    const pose = evaluateLocomotion(state, config);

    const hip: Vec2 = { x: centerX + pose.hipOffset.x, y: centerY + pose.hipOffset.y };
    const leftFoot: Vec2 = { x: centerX + pose.leftFootOffset.x, y: groundY - pose.leftFootOffset.y };
    const rightFoot: Vec2 = { x: centerX + pose.rightFootOffset.x, y: groundY - pose.rightFootOffset.y };

    const leftLeg = solveLimb(hip, leftFoot, thighLen, shinLen, { bendDir: 1 });
    const rightLeg = solveLimb(hip, rightFoot, thighLen, shinLen, { bendDir: 1 });

    const opacity = isMain ? '' : '60';
    const boneColor = `${PALETTE.bone}${opacity}`;
    const spineColor = `${PALETTE.spine}${opacity}`;
    const jointColor = `${PALETTE.joint}${opacity}`;
    const ghostColor = `${PALETTE.ghost}${opacity}`;

    const width = isMain ? 3 : 1.5;

    // Spine
    const head: Vec2 = { x: hip.x, y: hip.y - 30 };
    pushBone(scene, hip, head, jointColor, width);
    pushJoint(scene, head, isMain ? 6 : 4, jointColor);

    // Left Leg (Bone)
    pushBone(scene, hip, leftLeg.jointPos, boneColor, width);
    pushBone(scene, leftLeg.jointPos, leftLeg.endPos, boneColor, width);
    pushJoint(scene, leftLeg.jointPos, isMain ? 3 : 2, jointColor);
    pushJoint(scene, leftLeg.endPos, isMain ? 3.5 : 2.5, boneColor);

    // Right Leg (Spine)
    pushBone(scene, hip, rightLeg.jointPos, spineColor, width);
    pushBone(scene, rightLeg.jointPos, rightLeg.endPos, spineColor, width);
    pushJoint(scene, rightLeg.jointPos, isMain ? 3 : 2, jointColor);
    pushJoint(scene, rightLeg.endPos, isMain ? 3.5 : 2.5, spineColor);

    // Hip joint
    pushJoint(scene, hip, isMain ? 4 : 2.5, ghostColor);
  };

  // Draw secondary/ghost poses
  drawStickFigure(0, false);
  drawStickFigure(Math.PI, false);

  // Draw main pose (mid-swing)
  drawStickFigure(Math.PI / 2, true);

  return scene;
}

/**
 * Scene 6: Squash & Stretch (NEW)
 */
export function sampleSquashStretch(): SampleScene {
  const scene: SampleScene = { lines: [], points: [] };

  // 1. Left Half: Breathing scale cycle
  const bCx = 64;
  const bCy = 128;
  const size = 40;

  const drawScaledSquare = (sx: number, sy: number, color: string, width: number) => {
    const w = size * sx;
    const h = size * sy;
    const p0 = { x: bCx - w / 2, y: bCy - h / 2 };
    const p1 = { x: bCx + w / 2, y: bCy - h / 2 };
    const p2 = { x: bCx + w / 2, y: bCy + h / 2 };
    const p3 = { x: bCx - w / 2, y: bCy + h / 2 };

    pushBone(scene, p0, p1, color, width);
    pushBone(scene, p1, p2, color, width);
    pushBone(scene, p2, p3, color, width);
    pushBone(scene, p3, p0, color, width);
  };

  // Neutral
  drawScaledSquare(1, 1, PALETTE.ghost, 1.5);
  // Max stretch (tall/narrow)
  const stretch = volumeScale(0.15);
  drawScaledSquare(stretch.scaleX, stretch.scaleY, PALETTE.bone, 3);
  // Max squash (short/wide)
  const squash = volumeScale(-0.15);
  drawScaledSquare(squash.scaleX, squash.scaleY, PALETTE.spine, 3);

  // Center anchor
  pushJoint(scene, { x: bCx, y: bCy }, 3, PALETTE.joint);

  // 2. Right Half: Turn projection
  const tCx = 192;
  const drawTurnedPart = (cy: number, angle: number) => {
    const sx = Math.abs(Math.cos(angle));
    const radius = 20;

    // Draw main body ellipse (16 segments)
    const segments = 16;
    const bodyPoints: Vec2[] = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      bodyPoints.push({
        x: tCx + Math.cos(theta) * radius * sx,
        y: cy + Math.sin(theta) * radius,
      });
    }
    for (let i = 0; i < segments; i++) {
      pushBone(scene, bodyPoints[i], bodyPoints[i + 1], PALETTE.bone, 2.5);
    }

    // Draw child element (shoulder/eye) at localX = 14, localY = 0
    const proj = projectTurnedPart(14, 0, angle);
    const childCx = tCx + proj.x;
    const childCy = cy + proj.y;
    const childRadius = 6;

    const childPoints: Vec2[] = [];
    for (let i = 0; i <= 12; i++) {
      const theta = (i / 12) * Math.PI * 2;
      childPoints.push({
        x: childCx + Math.cos(theta) * childRadius * proj.sx,
        y: childCy + Math.sin(theta) * childRadius,
      });
    }
    for (let i = 0; i < 12; i++) {
      pushBone(scene, childPoints[i], childPoints[i + 1], PALETTE.joint, 2);
    }

    // Anchor dots
    pushJoint(scene, { x: tCx, y: cy }, 2, PALETTE.ghost);
    pushJoint(scene, { x: childCx, y: childCy }, 2.5, PALETTE.joint);
  };

  // Top: Front-facing (0 deg)
  drawTurnedPart(64, 0);
  // Middle: Three-quarter (45 deg)
  drawTurnedPart(128, Math.PI / 4);
  // Bottom: Near profile (75 deg)
  drawTurnedPart(192, Math.PI / 2.4);

  return scene;
}

function renderSceneToCanvas(scene: SampleScene, bg: string) {
  const canvas = createCanvas(256, 256);
  const ctx = canvas.getContext('2d');

  // Fill background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 256);

  // Draw lines
  for (const line of scene.lines) {
    ctx.beginPath();
    ctx.moveTo(line.from.x, line.from.y);
    ctx.lineTo(line.to.x, line.to.y);
    ctx.strokeStyle = line.color;
    ctx.lineWidth = line.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // Draw points
  for (const pt of scene.points) {
    ctx.beginPath();
    ctx.arc(pt.pos.x, pt.pos.y, pt.r, 0, Math.PI * 2);
    ctx.fillStyle = pt.color;
    ctx.fill();
  }

  return canvas;
}

function main() {
  console.log('Generating animation-pillar production benchmark PNGs...');

  const start = performance.now();

  // 1. Generate scenes
  const limbReachScene = sampleLimbReach();
  const fabrikChainScene = sampleFabrikChain();
  const springChainScene = sampleSpringChain();
  const rigHierarchyScene = sampleRigHierarchy();
  const locomotionCycleScene = sampleLocomotionCycle();
  const squashStretchScene = sampleSquashStretch();

  // 2. Render to individual canvases
  const limbCanvas = renderSceneToCanvas(limbReachScene, BACKGROUND_COLOR);
  const fabrikCanvas = renderSceneToCanvas(fabrikChainScene, BACKGROUND_COLOR);
  const springCanvas = renderSceneToCanvas(springChainScene, BACKGROUND_COLOR);
  const rigCanvas = renderSceneToCanvas(rigHierarchyScene, BACKGROUND_COLOR);
  const locomotionCanvas = renderSceneToCanvas(locomotionCycleScene, BACKGROUND_COLOR);
  const squashCanvas = renderSceneToCanvas(squashStretchScene, BACKGROUND_COLOR);

  // 3. Save individual PNGs
  writeFileSync(join(OUTPUT_DIR, 'ik-limb-reach.png'), limbCanvas.toBuffer('image/png'));
  writeFileSync(join(OUTPUT_DIR, 'ik-fabrik-chain.png'), fabrikCanvas.toBuffer('image/png'));
  writeFileSync(join(OUTPUT_DIR, 'spring-chain.png'), springCanvas.toBuffer('image/png'));
  writeFileSync(join(OUTPUT_DIR, 'rig-hierarchy.png'), rigCanvas.toBuffer('image/png'));
  writeFileSync(join(OUTPUT_DIR, 'locomotion-cycle.png'), locomotionCanvas.toBuffer('image/png'));
  writeFileSync(join(OUTPUT_DIR, 'squash-stretch.png'), squashCanvas.toBuffer('image/png'));

  console.log('Saved individual PNGs to benchmarks/animation/');

  // 4. Generate 3x2 gallery composite (768x512)
  const galleryCanvas = createCanvas(768, 512);
  const gCtx = galleryCanvas.getContext('2d');

  // Draw the 6 canvases into the 3x2 grid
  gCtx.drawImage(limbCanvas, 0, 0);
  gCtx.drawImage(fabrikCanvas, 256, 0);
  gCtx.drawImage(springCanvas, 512, 0);
  gCtx.drawImage(rigCanvas, 0, 256);
  gCtx.drawImage(locomotionCanvas, 256, 256);
  gCtx.drawImage(squashCanvas, 512, 256);

  // Draw grid dividers
  gCtx.strokeStyle = '#cbd5e1'; // Slate-300 divider
  gCtx.lineWidth = 2;
  gCtx.beginPath();
  // Vertical dividers
  gCtx.moveTo(256, 0);
  gCtx.lineTo(256, 512);
  gCtx.moveTo(512, 0);
  gCtx.lineTo(512, 512);
  // Horizontal divider
  gCtx.moveTo(0, 256);
  gCtx.lineTo(768, 256);
  gCtx.stroke();

  // Save gallery
  writeFileSync(join(OUTPUT_DIR, 'gallery.png'), galleryCanvas.toBuffer('image/png'));
  console.log('Saved gallery composite to benchmarks/animation/gallery.png');

  const end = performance.now();
  console.log(`Benchmark rendering complete in ${(end - start).toFixed(2)}ms.`);
}

main();
