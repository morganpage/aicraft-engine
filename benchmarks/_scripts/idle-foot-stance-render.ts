import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateLocomotion,
  blendLocomotionToStance,
  DEFAULT_GAIT,
  type LocomotionPose,
} from '../../src/animation/locomotion';
import {
  drawSimpleFeet,
  IK_PARITY_FEET,
  type SimpleFeetConfig,
} from '../../src/animation/simple-feet';
import { outlineRect } from '../../src/primitives/outline-rect';

const OUTPUT_DIR = 'benchmarks/idle-foot-stance';

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

const PALETTE = {
  background: '#0f0f1a',
  altRow: '#141426',
  headerStrong: '#ffffff',
  headerDim: '#94a3b8',
  headerMuted: '#64748b',
  columnHeader: '#cbd5e1',
  midline: '#334155',
  groundLine: '#475569',
  eye: '#ffffff',
  pupil: '#0f0f1a',
} as const;

/**
 * Custom character drawing function that scales the body and features
 * proportionally to the foot size.
 */
function drawCharacter(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  pose: LocomotionPose,
  feetConfig: SimpleFeetConfig,
  bodyW: number,
  bodyH: number,
  outlineWidth: number,
) {
  // Midline (dashed vertical through the body).
  ctx.strokeStyle = PALETTE.midline;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(cx, cy - bodyH - 30);
  ctx.lineTo(cx, cy + 10);
  ctx.stroke();
  ctx.setLineDash([]);

  // Ground line (horizontal at foot baseline).
  ctx.strokeStyle = PALETTE.groundLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - bodyW, cy);
  ctx.lineTo(cx + bodyW, cy);
  ctx.stroke();

  ctx.save();
  ctx.translate(cx, cy);

  // 1. Draw feet (drawn first so body covers their tops if they overlap)
  drawSimpleFeet(ctx, pose, feetConfig);

  // 2. Draw body (centered on midline, sitting above feet).
  // baseY is where the top of the feet rest when grounded.
  // We want the body to sit slightly above the feet baseline.
  const bodyX = -bodyW / 2 + pose.hipOffset.x;
  const bodyY = feetConfig.baseY + 2 + pose.hipOffset.y - bodyH;

  // Save context line width and set it to the custom outline width
  const oldLineWidth = ctx.lineWidth;
  ctx.lineWidth = outlineWidth;

  outlineRect(
    ctx,
    bodyX,
    bodyY,
    bodyW,
    bodyH,
    feetConfig.color,
    feetConfig.outline ?? PALETTE.pupil,
  );

  // 3. Draw cyclops eye (proportional to body size)
  const eyeSize = Math.max(3, Math.round(bodyW * 0.2));
  const pupilSize = Math.max(1, Math.round(eyeSize * 0.4));
  const eyeX = bodyX + (bodyW - eyeSize) / 2;
  const eyeY = bodyY + (bodyH - eyeSize) / 3;

  ctx.fillStyle = PALETTE.eye;
  ctx.fillRect(Math.round(eyeX), Math.round(eyeY), eyeSize, eyeSize);
  ctx.fillStyle = PALETTE.pupil;
  ctx.fillRect(
    Math.round(eyeX + (eyeSize - pupilSize) / 2),
    Math.round(eyeY + (eyeSize - pupilSize) / 2),
    pupilSize,
    pupilSize,
  );

  ctx.lineWidth = oldLineWidth;
  ctx.restore();
}

/**
 * Renders a comparison sheet for a specific scale.
 */
function renderScaleSheet(
  scaleName: string,
  footW: number,
  footH: number,
  desiredGap: number,
  idleFootSpread: number,
  bodyW: number,
  bodyH: number,
  outlineWidth: number,
  color: string,
  outline: string,
  fileName: string,
) {
  console.log(`Rendering ${scaleName} stance blend sheet...`);
  const start = performance.now();

  const steps = [0, 0.25, 0.5, 0.75, 1];
  const phases = [0, Math.PI * 1.5]; // 0 = footfall, 1.5π = mid-swing

  // Layout geometry
  const colWidth = Math.max(120, bodyW * 2.2);
  const rowHeight = Math.max(100, bodyH * 1.8);
  const gridLeft = 180;
  const gridTop = 110;
  const headerY = 90;
  const width = gridLeft + steps.length * colWidth + 40;
  const height = gridTop + phases.length * 2 * rowHeight + 40; // 2 rows per phase (Stance Blend vs Old)

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = PALETTE.background;
  ctx.fillRect(0, 0, width, height);

  // Title & Subtitle
  ctx.fillStyle = PALETTE.headerStrong;
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(`Idle Foot Stance Blend — ${scaleName} Scale`, 20, 35);

  ctx.fillStyle = PALETTE.headerDim;
  ctx.font = '12px sans-serif';
  ctx.fillText(
    `Comparing Approach A (Stance Blend) vs Old (Blend-to-Zero)  ·  footW=${footW}, desiredGap=${desiredGap}px, idleFootSpread=${idleFootSpread}`,
    20,
    55,
  );

  // Divider line below header
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, 72);
  ctx.lineTo(width - 20, 72);
  ctx.stroke();

  // Column Headers
  ctx.fillStyle = PALETTE.columnHeader;
  ctx.font = 'bold 11px monospace';
  ctx.fillText('PHASE & BEHAVIOR', 20, headerY);
  ctx.textAlign = 'center';
  steps.forEach((step, col) => {
    const cx = gridLeft + colWidth * (col + 0.5);
    ctx.fillText(`t = ${step.toFixed(2)}`, cx, headerY);
  });
  ctx.textAlign = 'left';

  const feetConfig: SimpleFeetConfig = {
    ...IK_PARITY_FEET,
    footW,
    footH,
    baseY: -footH,
    color,
    outline,
  };

  let rowIdx = 0;

  phases.forEach((phase) => {
    const basePose = evaluateLocomotion({ phase }, DEFAULT_GAIT);
    const phaseLabel = phase === 0 ? 'φ = 0.00π (footfall)' : 'φ = 1.50π (mid-swing)';

    // --- Row 1: Approach A (Stance Blend) ---
    const rowTopA = gridTop + rowIdx * rowHeight;
    const rowCenterYA = rowTopA + rowHeight / 2;

    // Alternating row background
    if (rowIdx % 2 === 1) {
      ctx.fillStyle = PALETTE.altRow;
      ctx.fillRect(10, rowTopA, width - 20, rowHeight);
    }

    ctx.fillStyle = PALETTE.headerStrong;
    ctx.font = 'bold 11px monospace';
    ctx.fillText(phaseLabel, 20, rowCenterYA - 10);
    ctx.fillStyle = '#38bdf8'; // Sky blue for Approach A
    ctx.font = 'bold 10px monospace';
    ctx.fillText('STANCE BLEND (A)', 20, rowCenterYA + 5);
    ctx.fillStyle = PALETTE.headerMuted;
    ctx.font = '9px monospace';
    ctx.fillText('Blends to ±spread/2', 20, rowCenterYA + 18);

    steps.forEach((step, col) => {
      const cellCx = gridLeft + colWidth * (col + 0.5);
      const blendedPose = blendLocomotionToStance(basePose, step, idleFootSpread);
      drawCharacter(ctx, cellCx, rowCenterYA + 15, blendedPose, feetConfig, bodyW, bodyH, outlineWidth);
    });

    rowIdx++;

    // --- Row 2: Old (Blend-to-Zero) ---
    const rowTopB = gridTop + rowIdx * rowHeight;
    const rowCenterYB = rowTopB + rowHeight / 2;

    // Alternating row background
    if (rowIdx % 2 === 1) {
      ctx.fillStyle = PALETTE.altRow;
      ctx.fillRect(10, rowTopB, width - 20, rowHeight);
    }

    ctx.fillStyle = PALETTE.headerStrong;
    ctx.font = 'bold 11px monospace';
    ctx.fillText(phaseLabel, 20, rowCenterYB - 10);
    ctx.fillStyle = '#f43f5e'; // Rose for Old Behavior
    ctx.font = 'bold 10px monospace';
    ctx.fillText('BLEND-TO-ZERO (OLD)', 20, rowCenterYB + 5);
    ctx.fillStyle = PALETTE.headerMuted;
    ctx.font = '9px monospace';
    ctx.fillText('Blends to 0 (overlap)', 20, rowCenterYB + 18);

    steps.forEach((step, col) => {
      const cellCx = gridLeft + colWidth * (col + 0.5);
      // Old behavior: simply scale the offsets to zero
      const oldPose: LocomotionPose = {
        hipOffset: {
          x: basePose.hipOffset.x * (1 - step),
          y: basePose.hipOffset.y * (1 - step),
        },
        leftFootOffset: {
          x: basePose.leftFootOffset.x * (1 - step),
          y: basePose.leftFootOffset.y * (1 - step),
        },
        rightFootOffset: {
          x: basePose.rightFootOffset.x * (1 - step),
          y: basePose.rightFootOffset.y * (1 - step),
        },
      };
      drawCharacter(ctx, cellCx, rowCenterYB + 15, oldPose, feetConfig, bodyW, bodyH, outlineWidth);
    });

    rowIdx++;
  });

  const destPath = join(OUTPUT_DIR, fileName);
  writeFileSync(destPath, canvas.toBuffer('image/png'));

  const end = performance.now();
  console.log(`${scaleName} sheet rendered in ${(end - start).toFixed(2)}ms -> ${destPath}`);
}

function main() {
  // 1. Hero Scale Sheet
  renderScaleSheet(
    'Hero',
    28,          // footW
    20,          // footH
    2,           // desiredGap
    30,          // idleFootSpread
    48,          // bodyW
    48,          // bodyH
    3,           // outlineWidth
    '#FE5701',   // color
    '#1d1128',   // outline
    'hero-comparison.png',
  );

  // 2. Playground Scale Sheet
  renderScaleSheet(
    'Playground',
    7,           // footW
    5,           // footH
    1,           // desiredGap
    8,           // idleFootSpread
    14,          // bodyW
    14,          // bodyH
    1,           // outlineWidth
    '#FE5701',   // color
    '#1d1128',   // outline
    'playground-comparison.png',
  );
}

main();
