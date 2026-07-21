import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateLocomotion,
  scaledGait,
  DEFAULT_GAIT,
  drawSimpleFeet,
  type SimpleFeetConfig,
  type LocomotionPose
} from '../../src/animation';
import { outlineRect } from '../../src/primitives';

const OUTPUT_DIR = 'benchmarks/simple-feet-gait';

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

function drawCharacter(
  ctx: any,
  cx: number,
  cy: number,
  pose: LocomotionPose,
  config: SimpleFeetConfig,
) {
  ctx.save();
  ctx.translate(cx, cy);

  // 1. Draw feet (drawn first so body covers their tops)
  drawSimpleFeet(ctx, pose, config);

  // 2. Draw body (centered on X, bottom at baseY + 2 + hipOffset.y)
  const bodyW = 12;
  const bodyH = 12;
  const bodyX = -bodyW / 2 + pose.hipOffset.x;
  const bodyY = config.baseY + 2 + pose.hipOffset.y - bodyH;
  outlineRect(ctx, bodyX, bodyY, bodyW, bodyH, config.color, config.outline);

  // 3. Draw a cute cyclops eye
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(Math.round(pose.hipOffset.x + 1), Math.round(bodyY + 3), 3, 3);
  ctx.fillStyle = '#1d1128';
  ctx.fillRect(Math.round(pose.hipOffset.x + 2), Math.round(bodyY + 4), 1, 1);

  ctx.restore();
}

function renderGaitBenchmark(): void {
  console.log('Rendering simple-feet gait benchmark...');
  const start = performance.now();

  const W = 460;
  const H = 1540;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 1. Background
  ctx.fillStyle = '#141424';
  ctx.fillRect(0, 0, W, H);

  // 2. Header Title & Subtitle
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('Simple Feet Gait Comparison (24 Frames)', 20, 30);

  ctx.fillStyle = '#88888e';
  ctx.font = '11px sans-serif';
  ctx.fillText('Comparing (A) Embertomb, (B) IK-Parity, and (C) Rigid-Width Waddle', 20, 48);

  // Divider line below header
  ctx.strokeStyle = '#27272a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, 65);
  ctx.lineTo(W - 20, 65);
  ctx.stroke();

  // Column Headers
  ctx.fillStyle = '#a1a1aa';
  ctx.font = 'bold 10px monospace';
  ctx.fillText('FRAME/PHASE', 20, 85);
  ctx.fillText('(A) EMBERTOMB', 110, 85);
  ctx.fillText('(B) IK-PARITY', 230, 85);
  ctx.fillText('(C) WADDLE', 350, 85);

  // 3. Gait & Config Setup
  const gait = scaledGait(DEFAULT_GAIT, 0.55); // Embertomb gait: strideLength = 2.2, strideHeight = 1.65

  const configA: SimpleFeetConfig = {
    footW: 5,
    footH: 4,
    idleSpread: 3,
    baseY: -4,
    color: '#FE5701',
    outline: '#1d1128',
  };

  const configB: SimpleFeetConfig = {
    footW: 5,
    footH: 4,
    idleSpread: 0,
    baseY: -4,
    color: '#FE5701',
    outline: '#1d1128',
  };

  const startY = 100;
  const rowHeight = 60;

  for (let i = 0; i < 24; i++) {
    const phase = i * (2 * Math.PI / 24);
    const rowY = startY + i * rowHeight;

    // Alternating row background
    if (i % 2 === 1) {
      ctx.fillStyle = '#18182c';
      ctx.fillRect(10, rowY, W - 20, rowHeight);
    }

    // Draw Frame / Phase info
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`F${i.toString().padStart(2, '0')}`, 20, rowY + 28);
    ctx.fillStyle = '#71717a';
    ctx.font = '9px monospace';
    ctx.fillText(`${(phase / Math.PI).toFixed(2)}π`, 20, rowY + 42);

    // Draw grid/midlines/ground lines and characters for each column
    const cols = [
      { cx: 150, type: 'A' },
      { cx: 270, type: 'B' },
      { cx: 390, type: 'C' },
    ];

    cols.forEach((col) => {
      const cx = col.cx;
      const cy = rowY + 45; // Ground line Y

      // Draw midline (dashed)
      ctx.strokeStyle = '#2a2a3a';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(cx, rowY + 5);
      ctx.lineTo(cx, rowY + 55);
      ctx.stroke();
      ctx.setLineDash([]); // Reset

      // Draw ground line
      ctx.strokeStyle = '#3f3f46';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 35, cy);
      ctx.lineTo(cx + 35, cy);
      ctx.stroke();

      // Compute pose
      let pose: LocomotionPose;
      let config: SimpleFeetConfig;

      if (col.type === 'A') {
        pose = evaluateLocomotion({ phase }, gait);
        config = configA;
      } else if (col.type === 'B') {
        pose = evaluateLocomotion({ phase }, gait);
        config = configB;
      } else {
        // Rigid-width waddle
        pose = {
          hipOffset: {
            x: Math.sin(phase) * gait.hipSwayWidth,
            y: -Math.abs(Math.sin(phase)) * gait.hipBobHeight,
          },
          leftFootOffset: {
            x: Math.cos(phase) * gait.strideLength,
            y: Math.max(0, -Math.sin(phase)) * gait.strideHeight,
          },
          rightFootOffset: {
            x: Math.cos(phase) * gait.strideLength,
            y: Math.max(0, -Math.sin(phase + Math.PI)) * gait.strideHeight,
          },
        };
        config = configA; // uses idleSpread = 3
      }

      // Draw character
      drawCharacter(ctx, cx, cy, pose, config);
    });
  }

  const destPath = join(OUTPUT_DIR, 'gait-sheet.png');
  writeFileSync(destPath, canvas.toBuffer('image/png'));

  const end = performance.now();
  console.log(`Gait benchmark rendering complete in ${(end - start).toFixed(2)}ms.`);
  console.log(`Output saved to: ${destPath}`);
}

renderGaitBenchmark();
