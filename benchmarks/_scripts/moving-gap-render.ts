import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sampleMovingGapScene } from '../../src/collision/moving-gap';

const OUTPUT_DIR = 'benchmarks/moving-gap';

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

function drawRoundedRect(
  ctx: any,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fillColor: string,
  strokeColor?: string,
  strokeWidth = 1
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
}

function renderMovingGapBenchmark(): void {
  console.log('Rendering moving-gap-on-platform primitive benchmark...');
  const start = performance.now();

  const data = sampleMovingGapScene();
  const { palette, layout, scenes } = data;

  const W = layout.canvasWidth; // 960
  const H = layout.canvasHeight; // 1100
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 1. Background
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, W, H);

  // 2. Header Title & Subtitle
  ctx.fillStyle = palette.label;
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('aicraft-engine — Moving Gap Platform Primitive', 60, 45);

  ctx.fillStyle = '#88888e';
  ctx.font = '13px sans-serif';
  ctx.fillText("Verifying the 'void is never standable' invariant across 6 test scenes", 60, 68);

  // 3. Legend (Top Right)
  const legendX = 620;
  const legendY = 25;
  const legendItemW = 30;
  const legendItemH = 12;
  const legendGap = 8;

  const legendItems = [
    { color: palette.fragment, label: 'Solid Frag' },
    { color: palette.voidFill, label: 'Void (Gap)', stroke: palette.spanOutline },
    { color: palette.playerSafe, label: 'Player Safe' },
    { color: palette.playerFalling, label: 'Player Fall' },
  ];

  legendItems.forEach((item, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const ix = legendX + col * 160;
    const iy = legendY + row * (legendItemH + legendGap);

    ctx.fillStyle = item.color;
    ctx.fillRect(ix, iy, legendItemW, legendItemH);
    ctx.strokeStyle = item.stroke || palette.spanOutline;
    ctx.lineWidth = 1;
    ctx.strokeRect(ix, iy, legendItemW, legendItemH);

    ctx.fillStyle = '#88888e';
    ctx.font = '11px monospace';
    ctx.fillText(item.label, ix + legendItemW + 8, iy + 10);
  });

  // Divider line below header
  ctx.strokeStyle = '#27272a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, 85);
  ctx.lineTo(W - 60, 85);
  ctx.stroke();

  // 4. Render Scenes
  const startY = 100;
  const rowHeight = 155;
  const margin = layout.margin; // 60
  const totalWidth = W - 2 * margin; // 840
  const gapX = 15;

  scenes.forEach((scene, sceneIdx) => {
    const sceneY = startY + sceneIdx * rowHeight;

    // Draw Scene Title & Description
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(scene.title, margin, sceneY + 18);

    ctx.fillStyle = '#88888e';
    ctx.font = '11px sans-serif';
    ctx.fillText(scene.description, margin, sceneY + 32);

    // Layout frames horizontally
    const N = scene.frames.length;
    const frameWidth = (totalWidth - (N - 1) * gapX) / N;
    const frameHeight = layout.frameHeight; // 90

    scene.frames.forEach((frame, frameIdx) => {
      const boxX = margin + frameIdx * (frameWidth + gapX);
      const boxY = sceneY + 45;

      ctx.save();

      // Draw frame box background & border
      ctx.fillStyle = '#141424'; // Slightly lighter than background to define the frame
      ctx.fillRect(boxX, boxY, frameWidth, frameHeight);
      ctx.strokeStyle = '#2a2a3a';
      ctx.lineWidth = 1;
      ctx.strokeRect(boxX, boxY, frameWidth, frameHeight);

      // Draw frame caption
      let caption = frame.caption;
      if (scene.id === 'edge-clamp') {
        if (caption.includes('flush L:')) {
          caption = 'flush L (centerX=152)';
        } else if (caption.includes('flush R:')) {
          caption = 'flush R (centerX=808)';
        } else if (caption.includes('centerX = -9999')) {
          caption = 'centerX = -9999 (clamped L)';
        } else if (caption.includes('centerX = +9999')) {
          caption = 'centerX = +9999 (clamped R)';
        }
      }
      ctx.fillStyle = palette.label;
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(caption, boxX + frameWidth / 2, boxY + 15);

      // Scale factor for X coordinates
      const scaleX = frameWidth / 960;

      // Draw the span outline (representing the platform bounds)
      const spanX = boxX + scene.span.x * scaleX;
      const spanY = boxY + 37 + scene.span.y;
      const spanW = scene.span.width * scaleX;
      const spanH = scene.span.height;

      // Fill span with voidFill (representing the gap area)
      ctx.fillStyle = palette.voidFill;
      ctx.fillRect(spanX, spanY, spanW, spanH);

      // Stroke span outline
      ctx.strokeStyle = palette.spanOutline;
      ctx.lineWidth = 1;
      ctx.strokeRect(spanX, spanY, spanW, spanH);

      // Draw fragments (solid platform pieces)
      frame.fragments.forEach((fragment) => {
        const fragX = boxX + fragment.x * scaleX;
        const fragY = boxY + 37 + fragment.y;
        const fragW = fragment.width * scaleX;
        const fragH = fragment.height;

        ctx.fillStyle = fragment.passthrough ? palette.fragmentPassthrough : palette.fragment;
        ctx.fillRect(fragX, fragY, fragW, fragH);

        ctx.strokeStyle = palette.spanOutline;
        ctx.lineWidth = 1;
        ctx.strokeRect(fragX, fragY, fragW, fragH);
      });

      // Draw overlays (players, targets, etc.)
      frame.overlays.forEach((overlay) => {
        const overX = boxX + overlay.x * scaleX;
        const overY = boxY + 37 + overlay.y;
        const overW = overlay.width * scaleX;
        const overH = overlay.height;

        ctx.fillStyle = overlay.color;
        ctx.fillRect(overX, overY, overW, overH);

        ctx.strokeStyle = palette.spanOutline;
        ctx.lineWidth = 1;
        ctx.strokeRect(overX, overY, overW, overH);
      });

      ctx.restore();
    });
  });

  const destPath = join(OUTPUT_DIR, 'sample-sheet.png');
  writeFileSync(destPath, canvas.toBuffer('image/png'));

  const end = performance.now();
  console.log(`Moving gap benchmark rendering complete in ${(end - start).toFixed(2)}ms.`);
  console.log(`Output saved to: ${destPath}`);
}

renderMovingGapBenchmark();
