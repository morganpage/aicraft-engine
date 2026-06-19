import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generatePalette } from '../../src/palette/generate';
import { contrastRatio } from '../../src/primitives/color';
import type { GenerationStrategy, Palette } from '../../src/palette/types';

const OUTPUT_DIR = 'benchmarks/palette';

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Get the generation strategy for a given seed to test all strategies.
 */
function getStrategyForSeed(seed: number): GenerationStrategy {
  if (seed <= 8) return 'triadic';
  if (seed <= 16) return 'complementary';
  return 'analogous';
}

/**
 * Helper to draw a rounded rectangle.
 */
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

/**
 * Render 1: Generated Palette Sheet (24 palettes)
 */
function renderGeneratedSheet(): void {
  const W = 1000;
  const H = 1320;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#121214';
  ctx.fillRect(0, 0, W, H);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('aicraft-engine — Algorithmic Palette Benchmark', 20, 40);

  // Subtitle
  ctx.fillStyle = '#88888e';
  ctx.font = '14px sans-serif';
  ctx.fillText('24 Generated Palettes (Seeds 1-24) with WCAG AA Contrast Validation', 20, 65);

  // Column Headers
  ctx.fillStyle = '#a0a0aa';
  ctx.font = 'bold 12px monospace';
  ctx.fillText('Seed & Strategy', 20, 100);
  ctx.fillText('outline', 180, 100);
  ctx.fillText('base', 340, 100);
  ctx.fillText('accent', 500, 100);
  ctx.fillText('feature', 660, 100);
  ctx.fillText('background', 820, 100);

  // Divider line
  ctx.strokeStyle = '#27272a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, 110);
  ctx.lineTo(980, 110);
  ctx.stroke();

  const startY = 125;
  const rowHeight = 48;
  const swatchW = 145;
  const swatchH = 34;
  const r = 4;

  for (let s = 1; s <= 24; s++) {
    const strategy = getStrategyForSeed(s);
    const p = generatePalette(s, { strategy });
    const y = startY + (s - 1) * rowHeight;

    // Seed label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`Seed ${s.toString().padStart(2, '0')}`, 20, y + 16);
    ctx.fillStyle = '#71717a';
    ctx.font = '10px monospace';
    ctx.fillText(strategy, 20, y + 28);

    // 1. outline swatch (Fill = base, Border = outline, Text = outline in outline color)
    drawRoundedRect(ctx, 180, y, swatchW, swatchH, r, p.base, p.outline, 2);
    ctx.fillStyle = p.outline;
    ctx.font = 'bold 10px monospace';
    ctx.fillText('outline', 188, y + 16);
    ctx.font = '9px monospace';
    ctx.fillText(p.outline, 188, y + 26);

    // 2. base swatch (Fill = base, Border = outline, Text = base in outline color)
    drawRoundedRect(ctx, 340, y, swatchW, swatchH, r, p.base, p.outline, 1);
    ctx.fillStyle = p.outline;
    ctx.font = 'bold 10px monospace';
    ctx.fillText('base', 348, y + 16);
    ctx.font = '9px monospace';
    ctx.fillText(p.base, 348, y + 26);

    // 3. accent swatch (Fill = accent, Border = outline, Text = accent in outline color)
    drawRoundedRect(ctx, 500, y, swatchW, swatchH, r, p.accent, p.outline, 1);
    ctx.fillStyle = p.outline;
    ctx.font = 'bold 10px monospace';
    ctx.fillText('accent', 508, y + 16);
    ctx.font = '9px monospace';
    ctx.fillText(p.accent, 508, y + 26);

    // 4. feature swatch (Fill = base, Border = outline, Text = feature in feature color)
    drawRoundedRect(ctx, 660, y, swatchW, swatchH, r, p.base, p.outline, 1);
    ctx.fillStyle = p.feature;
    ctx.font = 'bold 10px monospace';
    ctx.fillText('feature', 668, y + 16);
    ctx.font = '9px monospace';
    ctx.fillText(p.feature, 668, y + 26);

    // 5. background swatch (Fill = background, Border = outline, Text = bg in outline color)
    drawRoundedRect(ctx, 820, y, swatchW, swatchH, r, p.background, p.outline, 1);
    ctx.fillStyle = p.outline;
    ctx.font = 'bold 10px monospace';
    ctx.fillText('background', 828, y + 16);
    ctx.font = '9px monospace';
    ctx.fillText(p.background, 828, y + 26);
  }

  writeFileSync(join(OUTPUT_DIR, 'generated-sheet.png'), canvas.toBuffer('image/png'));
  console.log('Saved benchmarks/palette/generated-sheet.png');
}

/**
 * Render 2: In-Game Shapes (8 seeds)
 */
function renderInGameShapes(): void {
  const seeds = [1, 3, 5, 9, 11, 13, 17, 19];
  const W = 960;
  const H = 540;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background of the sheet itself
  ctx.fillStyle = '#121214';
  ctx.fillRect(0, 0, W, H);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('aicraft-engine — In-Game Shape Rendering', 20, 35);

  // Subtitle
  ctx.fillStyle = '#88888e';
  ctx.font = '13px sans-serif';
  ctx.fillText('Visualizing 8 representative seeds as in-game characters drawn on their background tiles', 20, 55);

  const cols = 4;
  const cardW = 215;
  const cardH = 200;
  const gapX = 20;
  const gapY = 20;
  const startX = 20;
  const startY = 80;

  seeds.forEach((s, idx) => {
    const strategy = getStrategyForSeed(s);
    const p = generatePalette(s, { strategy });

    const col = idx % cols;
    const row = Math.floor(idx / cols);

    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);

    // Draw card background (palette background)
    drawRoundedRect(ctx, x, y, cardW, cardH, 8, p.background, p.outline, 2);

    // Draw a cute Sokpop-style character centered in the card
    const cx = x + cardW / 2;
    const cy = y + cardH / 2 - 10;

    // 1. Legs (accent with outline)
    drawRoundedRect(ctx, cx - 16, cy + 24, 10, 14, 3, p.accent, p.outline, 2);
    drawRoundedRect(ctx, cx + 6, cy + 24, 10, 14, 3, p.accent, p.outline, 2);

    // 2. Main Body (base with outline)
    drawRoundedRect(ctx, cx - 25, cy - 25, 50, 50, 10, p.base, p.outline, 3);

    // 3. Antenna (outline line + accent tip)
    ctx.beginPath();
    ctx.moveTo(cx, cy - 25);
    ctx.lineTo(cx, cy - 38);
    ctx.strokeStyle = p.outline;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy - 38, 5, 0, Math.PI * 2);
    ctx.fillStyle = p.accent;
    ctx.fill();
    ctx.strokeStyle = p.outline;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 4. Glowing Cyclops Eye (feature with outline)
    ctx.beginPath();
    ctx.arc(cx, cy - 5, 11, 0, Math.PI * 2);
    ctx.fillStyle = p.feature;
    ctx.fill();
    ctx.strokeStyle = p.outline;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Pupil (outline)
    ctx.beginPath();
    ctx.arc(cx, cy - 5, 4, 0, Math.PI * 2);
    ctx.fillStyle = p.outline;
    ctx.fill();

    // Eye highlight (white)
    ctx.beginPath();
    ctx.arc(cx - 2, cy - 7, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // 5. Label below character
    ctx.fillStyle = p.outline;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`Seed ${s.toString().padStart(2, '0')}`, cx, y + cardH - 28);
    ctx.font = '9px monospace';
    ctx.fillText(strategy, cx, y + cardH - 14);
    ctx.textAlign = 'left'; // Reset
  });

  writeFileSync(join(OUTPUT_DIR, 'in-game-shapes.png'), canvas.toBuffer('image/png'));
  console.log('Saved benchmarks/palette/in-game-shapes.png');
}

/**
 * Render 3: Contrast Check (8 seeds)
 */
function renderContrastCheck(): void {
  const seeds = [1, 3, 5, 9, 11, 13, 17, 19];
  const W = 1000;
  const H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#121214';
  ctx.fillRect(0, 0, W, H);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('aicraft-engine — Palette Contrast Verification', 20, 35);

  // Subtitle
  ctx.fillStyle = '#88888e';
  ctx.font = '13px sans-serif';
  ctx.fillText('Measured WCAG 2.x Contrast Ratios for Checked Pairs (Target ≥ 4.5:1)', 20, 55);

  // Column Headers
  ctx.fillStyle = '#a0a0aa';
  ctx.font = 'bold 12px monospace';
  ctx.fillText('Seed & Strategy', 20, 95);
  ctx.fillText('outline vs base', 220, 95);
  ctx.fillText('feature vs base', 480, 95);
  ctx.fillText('outline vs background', 740, 95);

  // Divider line
  ctx.strokeStyle = '#27272a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, 105);
  ctx.lineTo(980, 105);
  ctx.stroke();

  const startY = 120;
  const rowHeight = 55;
  const boxW = 230;
  const boxH = 36;
  const r = 4;

  seeds.forEach((s, idx) => {
    const strategy = getStrategyForSeed(s);
    const p = generatePalette(s, { strategy });
    const y = startY + idx * rowHeight;

    // Seed label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`Seed ${s.toString().padStart(2, '0')}`, 20, y + 16);
    ctx.fillStyle = '#71717a';
    ctx.font = '10px monospace';
    ctx.fillText(strategy, 20, y + 28);

    // 1. outline vs base
    const ratio1 = contrastRatio(p.outline, p.base);
    const pass1 = ratio1 >= 4.5;
    drawRoundedRect(ctx, 220, y, boxW, boxH, r, p.base, p.outline, 1);
    ctx.fillStyle = p.outline;
    ctx.font = 'bold 10px monospace';
    ctx.fillText('outline text', 228, y + 21);
    drawPill(ctx, 220 + boxW - 75, y + 8, ratio1.toFixed(2) + ':1', pass1);

    // 2. feature vs base
    const ratio2 = contrastRatio(p.feature, p.base);
    const pass2 = ratio2 >= 4.5;
    drawRoundedRect(ctx, 480, y, boxW, boxH, r, p.base, p.outline, 1);
    ctx.fillStyle = p.feature;
    ctx.font = 'bold 10px monospace';
    ctx.fillText('feature text', 488, y + 21);
    drawPill(ctx, 480 + boxW - 75, y + 8, ratio2.toFixed(2) + ':1', pass2);

    // 3. outline vs background
    const ratio3 = contrastRatio(p.outline, p.background);
    const pass3 = ratio3 >= 4.5;
    drawRoundedRect(ctx, 740, y, boxW, boxH, r, p.background, p.outline, 1);
    ctx.fillStyle = p.outline;
    ctx.font = 'bold 10px monospace';
    ctx.fillText('outline text', 748, y + 21);
    drawPill(ctx, 740 + boxW - 75, y + 8, ratio3.toFixed(2) + ':1', pass3);
  });

  writeFileSync(join(OUTPUT_DIR, 'contrast-check.png'), canvas.toBuffer('image/png'));
  console.log('Saved benchmarks/palette/contrast-check.png');
}

/**
 * Helper to draw a pass/fail pill.
 */
function drawPill(ctx: any, x: number, y: number, text: string, pass: boolean): void {
  const w = 65;
  const h = 20;
  const r = 10;
  const bg = pass ? '#15803d' : '#b91c1c'; // green-700 or red-700
  const fg = '#ffffff';

  drawRoundedRect(ctx, x, y, w, h, r, bg);
  ctx.fillStyle = fg;
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, x + w / 2, y + 13);
  ctx.textAlign = 'left';
}

function main() {
  console.log('Generating palette-pillar benchmark PNGs...');
  const start = performance.now();

  renderGeneratedSheet();
  renderInGameShapes();
  renderContrastCheck();

  const end = performance.now();
  console.log(`Palette benchmark rendering complete in ${(end - start).toFixed(2)}ms.`);
}

main();
