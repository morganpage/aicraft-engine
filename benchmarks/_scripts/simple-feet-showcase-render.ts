import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  deriveHeroConfig,
  createHeroFrameState,
  drawSlimeKnight,
} from '../../showcase/helpers/slime-knight';
import {
  evaluateLocomotion,
  IK_PARITY_FEET,
  drawSimpleFeet,
  type LocomotionPose,
} from '../../src/animation';
import { computePlayerVisuals } from '../../showcase/sections/playground-helpers';

const OUTPUT_DIR = 'benchmarks/simple-feet-gait';

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

function renderShowcaseSimpleFeet(): void {
  console.log('Rendering simple-feet showcase comparison...');
  const start = performance.now();

  // Canvas dimensions: 4 columns (Phase 0, π/2, π, 3π/2) x 4 rows (Hero R, Hero L, Player R, Player L)
  const cellW = 200;
  const cellH = 200;
  const padding = 20;
  const headerH = 80;
  const W = cellW * 4 + padding * 2;
  const H = cellH * 4 + headerH + padding * 2;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d') as any;

  // 1. Background
  ctx.fillStyle = '#141424';
  ctx.fillRect(0, 0, W, H);

  // 2. Header Title & Subtitle
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('Simple Feet Showcase Verification', padding, 35);

  ctx.fillStyle = '#88888e';
  ctx.font = '12px sans-serif';
  ctx.fillText('Verifying: (1) Hero legStyle="simpleFeet" (Seed 98724) and (2) Playground Player using IK_PARITY_FEET', padding, 55);

  // Divider line below header
  ctx.strokeStyle = '#27272a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, 70);
  ctx.lineTo(W - padding, 70);
  ctx.stroke();

  // Column Headers (Phases)
  const phases = [
    { label: 'Phase 0 (Start)', val: 0 },
    { label: 'Phase π/2 (Mid-crossing)', val: Math.PI / 2 },
    { label: 'Phase π (Half-cycle)', val: Math.PI },
    { label: 'Phase 3π/2 (Mid-crossing 2)', val: Math.PI * 1.5 },
  ];

  ctx.fillStyle = '#a1a1aa';
  ctx.font = 'bold 11px monospace';
  phases.forEach((p, i) => {
    const cx = padding + i * cellW + cellW / 2;
    ctx.textAlign = 'center';
    ctx.fillText(p.label, cx, 95);
  });

  // Row Configs
  const rows = [
    { label: 'Hero (Facing Right)', type: 'hero', facing: 1 as (1 | -1) },
    { label: 'Hero (Facing Left)', type: 'hero', facing: -1 as (1 | -1) },
    { label: 'Playground Player (Facing Right)', type: 'player', facing: 1 as (1 | -1) },
    { label: 'Playground Player (Facing Left)', type: 'player', facing: -1 as (1 | -1) },
  ];

  const PLAYGROUND_GAIT = {
    baseFrequency: 0.05,
    strideLength: 8,
    strideHeight: 5,
    hipBobHeight: 2,
    hipSwayWidth: 1,
  };

  const COLOR_PLAYER = '#6c5ce7';
  const COLOR_FACE = '#1d1128';

  const startY = headerH + 40;

  rows.forEach((row, rIdx) => {
    const rowY = startY + rIdx * cellH;

    // Row label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(row.label, padding, rowY - 10);

    phases.forEach((phaseObj, pIdx) => {
      const phase = phaseObj.val;
      const cellX = padding + pIdx * cellW;
      const cx = cellX + cellW / 2;
      const cy = rowY + cellH / 2 + 10;

      // Draw cell border
      ctx.strokeStyle = '#1f1f35';
      ctx.lineWidth = 1;
      ctx.strokeRect(cellX, rowY, cellW, cellH - 20);

      // Draw midline (dashed)
      ctx.strokeStyle = '#3b3b5c';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, rowY + 10);
      ctx.lineTo(cx, rowY + cellH - 30);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw ground line
      ctx.strokeStyle = '#4b4b6c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 60, cy);
      ctx.lineTo(cx + 60, cy);
      ctx.stroke();

      if (row.type === 'hero') {
        // Render Hero using slime-knight
        const config = deriveHeroConfig(98724);
        const state = createHeroFrameState(config);
        state.locomotion.phase = phase;
        state.facing = row.facing;

        // We need to translate so that the hero is centered at (cx, cy)
        // In slime-knight, HERO_GROUND_Y is 320 * 0.82 = 262.4.
        // The character is drawn relative to HERO_CENTER_X (160) and HERO_GROUND_Y (262.4).
        // So we translate the context to place HERO_CENTER_X at cx, and HERO_GROUND_Y at cy.
        ctx.save();
        ctx.translate(cx - 160, cy - 262.4);
        drawSlimeKnight(ctx, state, 0, { x: row.facing, y: 0 }, { legStyle: 'simpleFeet', emotion: 0.3 });
        ctx.restore();
      } else {
        // Render Playground Player using IK_PARITY_FEET
        const vis = computePlayerVisuals({
          coreX: cx - 12, // centered at cx
          coreY: cy - 32, // bottom at cy
          coreW: 24,
          coreH: 32,
          scaleX: 1,
          scaleY: 1,
          breathScaleX: 1,
          breathScaleY: 1,
          footH: IK_PARITY_FEET.footH,
          clearance: 3,
        });

        // Simple feet
        const locoPose = evaluateLocomotion({ phase }, PLAYGROUND_GAIT);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(row.facing, 1);
        drawSimpleFeet(ctx, locoPose, {
          ...IK_PARITY_FEET,
          baseY: vis.feetBaseY,
          color: COLOR_PLAYER,
        });
        ctx.restore();

        // Body rect
        ctx.fillStyle = COLOR_PLAYER;
        ctx.fillRect(vis.bodyX, vis.bodyY, vis.bodyW, vis.bodyH);

        // Face features
        ctx.save();
        ctx.translate(vis.bodyX + vis.bodyW / 2, vis.bodyY + vis.bodyH * 0.35);
        ctx.scale(row.facing, 1);

        ctx.fillStyle = COLOR_FACE;
        ctx.fillRect(-3, -3, 6, 5);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(1, -2, 2, 2);

        ctx.fillStyle = COLOR_FACE;
        ctx.fillRect(-2, 4, 4, 1);
        ctx.restore();
      }
    });
  });

  const destPath = join(OUTPUT_DIR, 'showcase-simple-feet-comparison.png');
  writeFileSync(destPath, canvas.toBuffer('image/png'));

  const end = performance.now();
  console.log(`Showcase simple-feet rendering complete in ${(end - start).toFixed(2)}ms.`);
  console.log(`Output saved to: ${destPath}`);
}

renderShowcaseSimpleFeet();
