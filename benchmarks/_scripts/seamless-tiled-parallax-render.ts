import { createCanvas, CanvasRenderingContext2D } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  tiledParallaxRange,
  drawTiledParallax,
  type TiledParallaxRange,
} from '../../src/primitives/parallax';

const OUTPUT_DIR = 'benchmarks/seamless-tiled-parallax';

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// --- Formulas ---

// `tiledParallaxRange` and `drawTiledParallax` (the "Proposed" / Optimal
// Branching Remainder formula) are imported from the shipped library above.
// This keeps the benchmark in sync with the canonical implementation.

/**
 * Naive Formula (Always shifts left by one tileWidth).
 *
 * Intentionally divergent regression baseline: the naive approach always
 * subtracts one full `tileWidth` from `startX`, wasting a fully-off-screen
 * draw call on perfect grid alignment. Kept inline (not imported) so the
 * comparison.png / perfect-alignment.png sheets can contrast the two.
 */
function tiledParallaxRangeNaive(camera: number, factor: number, tileWidth: number, viewportWidth: number): TiledParallaxRange {
  if (tileWidth <= 0) return { startX: 0, copies: 0 };
  const offset = -(camera * factor);
  let startX = offset % tileWidth;
  startX -= tileWidth;
  const copies = Math.max(1, Math.ceil((viewportWidth - startX) / tileWidth));
  return { startX, copies };
}

// --- Procedural Drawing Helpers ---

function drawWrappingCircle(ctx: CanvasRenderingContext2D, localX: number, localY: number, r: number, tileWidth: number) {
  for (const offset of [-tileWidth, 0, tileWidth]) {
    ctx.beginPath();
    ctx.arc(localX + offset, localY, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWrappingTree(ctx: CanvasRenderingContext2D, localX: number, localY: number, w: number, h: number, tileWidth: number) {
  for (const offset of [-tileWidth, 0, tileWidth]) {
    const x = localX + offset;
    ctx.beginPath();
    ctx.moveTo(x, localY);
    ctx.lineTo(x - w / 2, localY + h);
    ctx.lineTo(x + w / 2, localY + h);
    ctx.closePath();
    ctx.fill();
  }
}

// --- Layer Drawing Functions ---

// Layer 1: Sky Gradient & Clouds (factor=0.05, tileWidth=800)
function drawSkyTile(ctx: CanvasRenderingContext2D, screenX: number, tileWidth: number, height: number) {
  ctx.save();
  ctx.translate(screenX, 0);

  // Vertical gradient
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#0b091a');
  grad.addColorStop(1, '#21183c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, tileWidth, height);

  // Clouds
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  drawWrappingCircle(ctx, 150, 60, 40, tileWidth);
  drawWrappingCircle(ctx, 180, 55, 30, tileWidth);
  drawWrappingCircle(ctx, 120, 65, 25, tileWidth);

  drawWrappingCircle(ctx, 500, 100, 50, tileWidth);
  drawWrappingCircle(ctx, 540, 90, 40, tileWidth);
  drawWrappingCircle(ctx, 460, 105, 35, tileWidth);

  drawWrappingCircle(ctx, 0, 80, 35, tileWidth);
  drawWrappingCircle(ctx, 25, 75, 25, tileWidth);
  drawWrappingCircle(ctx, -25, 85, 20, tileWidth);

  ctx.restore();
}

// Layer 2: Distant Hills & Trees (factor=0.12, tileWidth=600)
function drawHillsTile(ctx: CanvasRenderingContext2D, screenX: number, tileWidth: number, height: number) {
  ctx.save();
  ctx.translate(screenX, 0);

  ctx.fillStyle = '#3b2554';
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let x = 0; x <= tileWidth; x += 5) {
    const y = 220 + 25 * Math.sin(2 * Math.PI * x / 300) + 10 * Math.sin(2 * Math.PI * x / 150);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(tileWidth, height);
  ctx.closePath();
  ctx.fill();

  // Trees
  ctx.fillStyle = '#2a1a3d';
  const treePositions = [40, 150, 280, 400, 520, 0];
  for (const tx of treePositions) {
    const ty = 220 + 25 * Math.sin(2 * Math.PI * tx / 300) + 10 * Math.sin(2 * Math.PI * tx / 150);
    drawWrappingTree(ctx, tx, ty - 30, 12, 30, tileWidth);
  }

  ctx.restore();
}

// Layer 3: Mid Statues & Arches (factor=0.25, tileWidth=400)
function drawStatuesTile(ctx: CanvasRenderingContext2D, screenX: number, tileWidth: number, height: number) {
  ctx.save();
  ctx.translate(screenX, 0);

  ctx.fillStyle = '#5c3c7a';
  ctx.strokeStyle = '#8e62b0';
  ctx.lineWidth = 2;

  const yBeam = 120;
  const hBeam = 20;

  // Draw horizontal beam
  ctx.fillRect(0, yBeam, tileWidth, hBeam);
  ctx.beginPath();
  ctx.moveTo(0, yBeam);
  ctx.lineTo(tileWidth, yBeam);
  ctx.moveTo(0, yBeam + hBeam);
  ctx.lineTo(tileWidth, yBeam + hBeam);
  ctx.stroke();

  // Draw columns at 0, 100, 200, 300, 400
  const colWidth = 24;
  const colHeight = 160;
  const colY = yBeam + hBeam;

  const columns = [0, 100, 200, 300, 400];
  for (const cx of columns) {
    // Draw column shaft
    ctx.fillRect(cx - colWidth / 2, colY, colWidth, colHeight);
    ctx.strokeRect(cx - colWidth / 2, colY, colWidth, colHeight);

    // Draw column base
    ctx.fillRect(cx - colWidth / 2 - 4, colY + colHeight - 12, colWidth + 8, 12);
    ctx.strokeRect(cx - colWidth / 2 - 4, colY + colHeight - 12, colWidth + 8, 12);

    // Draw column capital
    ctx.fillRect(cx - colWidth / 2 - 4, colY, colWidth + 8, 12);
    ctx.strokeRect(cx - colWidth / 2 - 4, colY, colWidth + 8, 12);
  }

  // Draw arches between columns (centered at 50, 150, 250, 350)
  const archCenters = [50, 150, 250, 350];
  for (const ax of archCenters) {
    ctx.beginPath();
    ctx.arc(ax, colY + 20, 38, Math.PI, 0, false);
    ctx.lineTo(ax + 38, colY);
    ctx.lineTo(ax - 38, colY);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.arc(ax, colY + 20, 38, Math.PI, 0, false);
    ctx.stroke();
  }

  ctx.restore();
}

// Layer 4: Near Chains & Labels (factor=0.45, tileWidth=300)
function drawChainsTile(ctx: CanvasRenderingContext2D, screenX: number, tileWidth: number, height: number) {
  ctx.save();
  ctx.translate(screenX, 0);

  // Draw chains
  const chainPositions = [0, 50, 100, 150, 200, 250, 300];
  for (const cx of chainPositions) {
    drawWrappingChain(ctx, cx, 0, 180, tileWidth);
  }

  // Draw labels
  ctx.fillStyle = '#110822';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const labelPositions = [0, 50, 100, 150, 200, 250];
  for (const lx of labelPositions) {
    // Label background box
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(lx - 12, 15, 24, 12);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(lx - 12, 15, 24, 12);

    ctx.fillStyle = '#000000';
    ctx.fillText(lx.toString(), lx, 21);
  }

  ctx.restore();
}

function drawWrappingChain(ctx: CanvasRenderingContext2D, localX: number, yStart: number, yEnd: number, tileWidth: number) {
  for (const offset of [-tileWidth, 0, tileWidth]) {
    const x = localX + offset;
    ctx.strokeStyle = '#ffd700'; // gold chains!
    ctx.lineWidth = 1.5;
    ctx.fillStyle = '#b8860b';
    for (let y = yStart; y < yEnd; y += 12) {
      ctx.beginPath();
      ctx.ellipse(x, y + 6, 3, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

// --- Debug Overlay Helper ---

function drawDebugOverlay(ctx: CanvasRenderingContext2D, camera: number, viewportWidth: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillRect(10, 10, 240, 95);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(10, 10, 240, 95);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  ctx.fillText(`Camera X: ${camera}`, 20, 18);

  const layers = [
    { name: 'L1 (f=0.05, w=800)', factor: 0.05, w: 800 },
    { name: 'L2 (f=0.12, w=600)', factor: 0.12, w: 600 },
    { name: 'L3 (f=0.25, w=400)', factor: 0.25, w: 400 },
    { name: 'L4 (f=0.45, w=300)', factor: 0.45, w: 300 },
  ];

  layers.forEach((l, idx) => {
    const r = tiledParallaxRange(camera, l.factor, l.w, viewportWidth);
    ctx.fillStyle = '#b599e0';
    ctx.fillText(`${l.name}:`, 20, 34 + idx * 14);
    ctx.fillStyle = '#00ffcc';
    ctx.fillText(`x=${r.startX.toFixed(1)} c=${r.copies}`, 155, 34 + idx * 14);
  });

  ctx.restore();
}

// --- Scene Renderer ---

function renderScene(ctx: CanvasRenderingContext2D, camera: number, viewportWidth: number, viewportHeight: number) {
  // 1. Sky Gradient (Layer 1)
  const skyRange = tiledParallaxRange(camera, 0.05, 800, viewportWidth);
  for (let i = 0; i < skyRange.copies; i++) {
    drawSkyTile(ctx, skyRange.startX + i * 800, 800, viewportHeight);
  }

  // 2. Hills (Layer 2)
  const hillsRange = tiledParallaxRange(camera, 0.12, 600, viewportWidth);
  for (let i = 0; i < hillsRange.copies; i++) {
    drawHillsTile(ctx, hillsRange.startX + i * 600, 600, viewportHeight);
  }

  // 3. Statues (Layer 3)
  const statuesRange = tiledParallaxRange(camera, 0.25, 400, viewportWidth);
  for (let i = 0; i < statuesRange.copies; i++) {
    drawStatuesTile(ctx, statuesRange.startX + i * 400, 400, viewportHeight);
  }

  // 4. Chains (Layer 4)
  const chainsRange = tiledParallaxRange(camera, 0.45, 300, viewportWidth);
  for (let i = 0; i < chainsRange.copies; i++) {
    drawChainsTile(ctx, chainsRange.startX + i * 300, 300, viewportHeight);
  }

  // Debug Overlay
  drawDebugOverlay(ctx, camera, viewportWidth);
}

// --- Benchmark 1: scroll-right.png ---

function renderScrollRight() {
  console.log('Rendering scroll-right.png...');
  const frameW = 640;
  const frameH = 360;
  const cols = 4;
  const rows = 2;
  const headerH = 100;

  const W = frameW * cols;
  const H = frameH * rows + headerH;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('aicraft-engine — Seamless Parallax Scroll Right (Positive Camera)', 40, 45);
  ctx.fillStyle = '#a192b8';
  ctx.font = '16px sans-serif';
  ctx.fillText('Verifying seamless horizontal tiling at positive camera offsets. No gaps, no overlapping artifacts.', 40, 75);

  const cameras = [0, 100, 200, 400, 800, 1600, 3200, 5000];

  cameras.forEach((cam, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = col * frameW;
    const y = row * frameH + headerH;

    ctx.save();
    ctx.translate(x, y);

    // Clip to frame
    ctx.beginPath();
    ctx.rect(0, 0, frameW, frameH);
    ctx.clip();

    // Render scene
    renderScene(ctx, cam, frameW, frameH);

    // Frame border
    ctx.strokeStyle = '#321e42';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, frameW, frameH);

    ctx.restore();
  });

  const destPath = join(OUTPUT_DIR, 'scroll-right.png');
  writeFileSync(destPath, canvas.toBuffer('image/png'));
  console.log(`Saved scroll-right.png to ${destPath}`);
}

// --- Benchmark 2: scroll-left.png ---

function renderScrollLeft() {
  console.log('Rendering scroll-left.png...');
  const frameW = 640;
  const frameH = 360;
  const cols = 4;
  const rows = 2;
  const headerH = 100;

  const W = frameW * cols;
  const H = frameH * rows + headerH;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('aicraft-engine — Seamless Parallax Scroll Left (Negative Camera)', 40, 45);
  ctx.fillStyle = '#a192b8';
  ctx.font = '16px sans-serif';
  ctx.fillText('Verifying seamless horizontal tiling at negative camera offsets. Critical test for modulo sign bugs.', 40, 75);

  const cameras = [0, -100, -200, -400, -800, -1600, -3200, -5000];

  cameras.forEach((cam, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = col * frameW;
    const y = row * frameH + headerH;

    ctx.save();
    ctx.translate(x, y);

    // Clip to frame
    ctx.beginPath();
    ctx.rect(0, 0, frameW, frameH);
    ctx.clip();

    // Render scene
    renderScene(ctx, cam, frameW, frameH);

    // Frame border
    ctx.strokeStyle = '#321e42';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, frameW, frameH);

    ctx.restore();
  });

  const destPath = join(OUTPUT_DIR, 'scroll-left.png');
  writeFileSync(destPath, canvas.toBuffer('image/png'));
  console.log(`Saved scroll-left.png to ${destPath}`);
}

// --- Benchmark 3: perfect-alignment.png ---

function renderPerfectAlignment() {
  console.log('Rendering perfect-alignment.png...');
  const frameW = 640;
  const frameH = 240;
  const rows = 6;
  const cols = 2;
  const headerH = 100;

  const W = frameW * cols;
  const H = frameH * rows + headerH;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('aicraft-engine — Perfect Grid Alignment Comparison', 40, 45);
  ctx.fillStyle = '#a192b8';
  ctx.font = '16px sans-serif';
  ctx.fillText('Proposed "Optimal Branching Remainder" (Left) vs Naive Branchless (Right). Red dashed lines show tile boundaries.', 40, 75);

  const cameras = [0, 1600, 3200, 4800, 6400, 8000];
  const factor = 0.25;
  const tileWidth = 400;

  cameras.forEach((cam, rowIdx) => {
    // Left Column: Proposed
    {
      const x = 0;
      const y = rowIdx * frameH + headerH;

      ctx.save();
      ctx.translate(x, y);

      // Clip to frame
      ctx.beginPath();
      ctx.rect(0, 0, frameW, frameH);
      ctx.clip();

      // Background
      ctx.fillStyle = '#110822';
      ctx.fillRect(0, 0, frameW, frameH);

      // Render Layer 3 (Proposed)
      const range = tiledParallaxRange(cam, factor, tileWidth, frameW);
      for (let i = 0; i < range.copies; i++) {
        drawStatuesTile(ctx, range.startX + i * tileWidth, tileWidth, frameH);
      }

      // Draw boundaries
      drawTileBoundaries(ctx, range.startX, tileWidth, range.copies, frameH);

      // Label
      ctx.fillStyle = 'rgba(0, 255, 200, 0.85)';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`PROPOSED (Cam: ${cam}) — startX: ${range.startX}, copies: ${range.copies}`, 15, 220);

      // Frame border
      ctx.strokeStyle = '#321e42';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, frameW, frameH);

      ctx.restore();
    }

    // Right Column: Naive
    {
      const x = frameW;
      const y = rowIdx * frameH + headerH;

      ctx.save();
      ctx.translate(x, y);

      // Clip to frame
      ctx.beginPath();
      ctx.rect(0, 0, frameW, frameH);
      ctx.clip();

      // Background
      ctx.fillStyle = '#110822';
      ctx.fillRect(0, 0, frameW, frameH);

      // Render Layer 3 (Naive)
      const range = tiledParallaxRangeNaive(cam, factor, tileWidth, frameW);
      for (let i = 0; i < range.copies; i++) {
        drawStatuesTile(ctx, range.startX + i * tileWidth, tileWidth, frameH);
      }

      // Draw boundaries
      drawTileBoundaries(ctx, range.startX, tileWidth, range.copies, frameH);

      // Label
      ctx.fillStyle = 'rgba(255, 100, 100, 0.85)';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`NAIVE (Cam: ${cam}) — startX: ${range.startX}, copies: ${range.copies} (WASTED TILE AT LEFT)`, 15, 220);

      // Frame border
      ctx.strokeStyle = '#321e42';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, frameW, frameH);

      ctx.restore();
    }
  });

  const destPath = join(OUTPUT_DIR, 'perfect-alignment.png');
  writeFileSync(destPath, canvas.toBuffer('image/png'));
  console.log(`Saved perfect-alignment.png to ${destPath}`);
}

function drawTileBoundaries(ctx: CanvasRenderingContext2D, startX: number, tileWidth: number, copies: number, height: number) {
  ctx.save();
  for (let i = 0; i < copies; i++) {
    const tx = startX + i * tileWidth;

    // Draw boundary line
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(tx, 0);
    ctx.lineTo(tx, height);
    ctx.stroke();

    // Draw tile index label
    ctx.fillStyle = 'rgba(255, 0, 0, 0.25)';
    ctx.fillRect(tx + 5, 5, 110, 18);
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tx + 5, 5, 110, 18);

    ctx.fillStyle = '#ff6666';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Tile ${i} (x=${tx.toFixed(0)})`, tx + 10, 8);
  }
  ctx.restore();
}

// --- Benchmark 4: sub-pixel.png ---

function drawSubPixelTile(ctx: CanvasRenderingContext2D, screenX: number, tileWidth: number, height: number, snap: boolean) {
  ctx.save();

  // Apply snap if requested
  const drawX = snap ? Math.round(screenX) : screenX;
  ctx.translate(drawX, 0);

  // Background
  ctx.fillStyle = '#150d2a';
  ctx.fillRect(0, 0, tileWidth, height);

  // Diagonal line
  ctx.strokeStyle = '#00ffcc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(tileWidth, height);
  ctx.stroke();

  // Vertical lines
  ctx.strokeStyle = '#ff0055';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, height);
  ctx.moveTo(50, 0);
  ctx.lineTo(50, height);
  ctx.stroke();

  // Circle at seam (0 and tileWidth)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, height / 2, 5, 0, Math.PI * 2);
  ctx.arc(tileWidth, height / 2, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function renderSubPixel() {
  console.log('Rendering sub-pixel.png...');
  const frameW = 640;
  const frameH = 80;
  const rows = 12;
  const cols = 2;
  const headerH = 100;

  const W = frameW * cols;
  const H = frameH * rows + headerH;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('aicraft-engine — Sub-pixel Camera Increments (0.25px steps)', 40, 45);
  ctx.fillStyle = '#a192b8';
  ctx.font = '16px sans-serif';
  ctx.fillText('Comparing Unsnapped Float Draws (Left) vs Math.round-Snapped Draws (Right). Look for seam gaps or double-thick lines.', 40, 75);

  const factor = 0.5;
  const tileWidth = 100;

  for (let rowIdx = 0; rowIdx < rows; rowIdx++) {
    const cam = rowIdx * 0.25;
    const y = rowIdx * frameH + headerH;

    // Left Column: Unsnapped Float
    {
      const x = 0;
      ctx.save();
      ctx.translate(x, y);

      // Clip to frame
      ctx.beginPath();
      ctx.rect(0, 0, frameW, frameH);
      ctx.clip();

      // Render
      const range = tiledParallaxRange(cam, factor, tileWidth, frameW);
      for (let i = 0; i < range.copies; i++) {
        drawSubPixelTile(ctx, range.startX + i * tileWidth, tileWidth, frameH, false);
      }

      // Label
      ctx.fillStyle = 'rgba(0, 255, 200, 0.9)';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`FLOAT (Cam: ${cam.toFixed(2)}) — startX: ${range.startX.toFixed(3)}, copies: ${range.copies}`, 15, 20);

      // Frame border
      ctx.strokeStyle = '#321e42';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, frameW, frameH);

      ctx.restore();
    }

    // Right Column: Math.round Snapped
    {
      const x = frameW;
      ctx.save();
      ctx.translate(x, y);

      // Clip to frame
      ctx.beginPath();
      ctx.rect(0, 0, frameW, frameH);
      ctx.clip();

      // Render
      const range = tiledParallaxRange(cam, factor, tileWidth, frameW);
      for (let i = 0; i < range.copies; i++) {
        drawSubPixelTile(ctx, range.startX + i * tileWidth, tileWidth, frameH, true);
      }

      // Label
      ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`SNAPPED (Cam: ${cam.toFixed(2)}) — startX: ${Math.round(range.startX).toFixed(0)}, copies: ${range.copies}`, 15, 20);

      // Frame border
      ctx.strokeStyle = '#321e42';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, frameW, frameH);

      ctx.restore();
    }
  }

  const destPath = join(OUTPUT_DIR, 'sub-pixel.png');
  writeFileSync(destPath, canvas.toBuffer('image/png'));
  console.log(`Saved sub-pixel.png to ${destPath}`);
}

// --- Benchmark 5: comparison.png ---

function renderComparison() {
  console.log('Rendering comparison.png...');
  const frameW = 480;
  const frameH = 270;
  const rows = 3;
  const cols = 4;
  const headerH = 100;

  const W = frameW * cols;
  const H = frameH * rows + headerH;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('aicraft-engine — Parallax Implementation Comparison', 40, 45);
  ctx.fillStyle = '#a192b8';
  ctx.font = '16px sans-serif';
  ctx.fillText('Top: Pure Geometry (tiledParallaxRange) | Middle: Canvas Wrapper (drawTiledParallax) | Bottom: Naive Formula', 40, 75);

  const cameras = [0, 400, 800, 1200];

  cameras.forEach((cam, colIdx) => {
    const x = colIdx * frameW;

    // Row 1: Pure Geometry (tiledParallaxRange)
    {
      const y = 0 * frameH + headerH;
      ctx.save();
      ctx.translate(x, y);

      ctx.beginPath();
      ctx.rect(0, 0, frameW, frameH);
      ctx.clip();

      // Render using tiledParallaxRange
      renderScene(ctx, cam, frameW, frameH);

      // Label
      ctx.fillStyle = 'rgba(0, 255, 200, 0.9)';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`GEOMETRY (Cam: ${cam})`, 15, 25);

      ctx.strokeStyle = '#321e42';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, frameW, frameH);

      ctx.restore();
    }

    // Row 2: Canvas Wrapper (drawTiledParallax)
    {
      const y = 1 * frameH + headerH;
      ctx.save();
      ctx.translate(x, y);

      ctx.beginPath();
      ctx.rect(0, 0, frameW, frameH);
      ctx.clip();

      // Render using drawTiledParallax convenience wrapper
      // 1. Sky
      drawTiledParallax(ctx, (c, sx) => drawSkyTile(c, sx, 800, frameH), cam, 0.05, 800, frameW);
      // 2. Hills
      drawTiledParallax(ctx, (c, sx) => drawHillsTile(c, sx, 600, frameH), cam, 0.12, 600, frameW);
      // 3. Statues
      drawTiledParallax(ctx, (c, sx) => drawStatuesTile(c, sx, 400, frameH), cam, 0.25, 400, frameW);
      // 4. Chains
      drawTiledParallax(ctx, (c, sx) => drawChainsTile(c, sx, 300, frameH), cam, 0.45, 300, frameW);

      // Debug Overlay
      drawDebugOverlay(ctx, cam, frameW);

      // Label
      ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`WRAPPER (Cam: ${cam})`, 15, 25);

      ctx.strokeStyle = '#321e42';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, frameW, frameH);

      ctx.restore();
    }

    // Row 3: Naive Formula
    {
      const y = 2 * frameH + headerH;
      ctx.save();
      ctx.translate(x, y);

      ctx.beginPath();
      ctx.rect(0, 0, frameW, frameH);
      ctx.clip();

      // Render using Naive Formula
      // 1. Sky
      const skyRange = tiledParallaxRangeNaive(cam, 0.05, 800, frameW);
      for (let i = 0; i < skyRange.copies; i++) drawSkyTile(ctx, skyRange.startX + i * 800, 800, frameH);
      // 2. Hills
      const hillsRange = tiledParallaxRangeNaive(cam, 0.12, 600, frameW);
      for (let i = 0; i < hillsRange.copies; i++) drawHillsTile(ctx, hillsRange.startX + i * 600, 600, frameH);
      // 3. Statues
      const statuesRange = tiledParallaxRangeNaive(cam, 0.25, 400, frameW);
      for (let i = 0; i < statuesRange.copies; i++) drawStatuesTile(ctx, statuesRange.startX + i * 400, 400, frameH);
      // 4. Chains
      const chainsRange = tiledParallaxRangeNaive(cam, 0.45, 300, frameW);
      for (let i = 0; i < chainsRange.copies; i++) drawChainsTile(ctx, chainsRange.startX + i * 300, 300, frameH);

      // Debug Overlay (using naive range for display)
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(10, 10, 240, 95);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(10, 10, 240, 95);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`Camera X: ${cam}`, 20, 18);

      const layers = [
        { name: 'L1 (f=0.05, w=800)', factor: 0.05, w: 800 },
        { name: 'L2 (f=0.12, w=600)', factor: 0.12, w: 600 },
        { name: 'L3 (f=0.25, w=400)', factor: 0.25, w: 400 },
        { name: 'L4 (f=0.45, w=300)', factor: 0.45, w: 300 },
      ];

      layers.forEach((l, idx) => {
        const r = tiledParallaxRangeNaive(cam, l.factor, l.w, frameW);
        ctx.fillStyle = '#ff9999';
        ctx.fillText(`${l.name}:`, 20, 34 + idx * 14);
        ctx.fillStyle = '#ff3333';
        ctx.fillText(`x=${r.startX.toFixed(1)} c=${r.copies}`, 155, 34 + idx * 14);
      });
      ctx.restore();

      // Label
      ctx.fillStyle = 'rgba(255, 100, 100, 0.9)';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`NAIVE (Cam: ${cam})`, 15, 25);

      ctx.strokeStyle = '#321e42';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, frameW, frameH);

      ctx.restore();
    }
  });

  const destPath = join(OUTPUT_DIR, 'comparison.png');
  writeFileSync(destPath, canvas.toBuffer('image/png'));
  console.log(`Saved comparison.png to ${destPath}`);
}

// --- Main Execution ---

function runAllBenchmarks() {
  const start = performance.now();
  console.log('Starting seamless-tiled-parallax benchmark rendering...');

  renderScrollRight();
  renderScrollLeft();
  renderPerfectAlignment();
  renderSubPixel();
  renderComparison();

  const end = performance.now();
  console.log(`All benchmarks rendered successfully in ${(end - start).toFixed(2)}ms.`);
}

runAllBenchmarks();
