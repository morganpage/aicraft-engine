import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateWaveLine,
  DEFAULT_WAVE_LINE,
  DEFAULT_GERSTNER,
  type WaveLineConfig,
} from '../../src/primitives/wave-line';

const OUTPUT_DIR = 'benchmarks/surface-ripple';

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

function renderWaveLineBenchmarks() {
  console.log('Rendering surface ripple benchmark...');
  const start = performance.now();

  const W = 1800;
  const H = 1200;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#1d1128';
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('aicraft-engine — Surface Ripple / Wave Line Benchmark', 30, 50);

  ctx.fillStyle = '#b599e0';
  ctx.font = '16px sans-serif';
  ctx.fillText('Comparing Sine vs Gerstner wave algorithms, pixel snapping, and tuned lava parameters over time (t = 0 to 120)', 30, 80);

  // Column Headers (Time steps)
  const ticks = [0, 30, 60, 90, 120];
  const leftGutter = 300;
  const colWidth = 300;
  const rowHeight = 180;
  const headerY = 120;

  ctx.fillStyle = '#e2d9f3';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ticks.forEach((t, colIdx) => {
    const cellX = leftGutter + colIdx * colWidth;
    ctx.fillText(`t = ${t}`, cellX + 150, headerY - 15);
  });
  ctx.textAlign = 'left'; // Reset

  // Parameter sets (Rows)
  // Parameter sets (Rows). After the surface-ripple decision, the
  // ratified DEFAULT_WAVE_LINE / DEFAULT_GERSTNER match the tuned lava
  // configs — rows 1≈5 and 3≈6 now overlap by design (the tuning became
  // the defaults). The grid still illustrates the sine-vs-gerstner
  // contrast and the snapToPixel interactions the decision ratified.
  const tunedSineConfig: WaveLineConfig = {
    mode: 'sine',
    octaves: [
      { amplitude: 5.5, wavelength: 28, speed: 0.8 },
      { amplitude: 2.0, wavelength: 15, speed: -1.2 },
    ],
    snapToPixel: true,
  };

  const tunedGerstnerConfig: WaveLineConfig = {
    mode: 'gerstner',
    octaves: [
      { amplitude: 5.5, wavelength: 28, speed: 0.8 },
      { amplitude: 2.0, wavelength: 15, speed: -1.2 },
    ],
    steepness: 0.8,
    snapToPixel: false,
  };

  const rows = [
    {
      name: '1. Sine Default + Snap',
      config: { ...DEFAULT_WAVE_LINE, mode: 'sine' as const, snapToPixel: true },
      desc: 'amp: 5.5/2, wl: 28/15, 2 oct\nsnap: true (retro)'
    },
    {
      name: '2. Sine Default + Smooth',
      config: { ...DEFAULT_WAVE_LINE, mode: 'sine' as const, snapToPixel: false },
      desc: 'amp: 5.5/2, wl: 28/15, 2 oct\nsnap: false (smooth)'
    },
    {
      name: '3. Gerstner Default + Smooth',
      config: { ...DEFAULT_GERSTNER, mode: 'gerstner' as const, snapToPixel: false },
      desc: 'amp: 5.5/2, wl: 28/15, steep: 0.7\nsnap: false (viscous)'
    },
    {
      name: '4. Gerstner Default + Snap',
      config: { ...DEFAULT_GERSTNER, mode: 'gerstner' as const, snapToPixel: true },
      desc: 'amp: 5.5/2, wl: 28/15, steep: 0.7\nsnap: true (degenerate crests)'
    },
    {
      name: '5. Tuned Sine for Lava',
      config: tunedSineConfig,
      desc: 'amp: 5.5/2, wl: 28/15, 2 oct\nsnap: true (retro)'
    },
    {
      name: '6. Tuned Gerstner for Lava',
      config: tunedGerstnerConfig,
      desc: 'amp: 5.5/2, wl: 28/15, steep: 0.8\nsnap: false (sharp)'
    },
  ];

  const sampleSpacing = 4;

  rows.forEach((row, rowIdx) => {
    const cellY = headerY + rowIdx * rowHeight;

    // Draw Row Label & Description in Left Gutter
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(row.name, 30, cellY + 50);

    ctx.fillStyle = '#a192b8';
    ctx.font = '12px monospace';
    const descLines = row.desc.split('\n');
    descLines.forEach((line, lineIdx) => {
      ctx.fillText(line, 30, cellY + 75 + lineIdx * 18);
    });

    // Draw Row Divider
    ctx.strokeStyle = '#321e42';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, cellY + rowHeight);
    ctx.lineTo(W - 30, cellY + rowHeight);
    ctx.stroke();

    // Draw each column cell
    ticks.forEach((t, colIdx) => {
      const cellX = leftGutter + colIdx * colWidth;
      const poolX = cellX + 10;
      const poolY = cellY + 10;
      const poolW = 280;
      const poolH = 160;
      const surfaceY = poolH / 2;

      ctx.save();
      ctx.translate(poolX, poolY);

      // Draw subtle cell bounding box
      ctx.strokeStyle = '#3a2250';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, poolW, poolH);

      // Generate wave points
      const points = generateWaveLine(0, surfaceY, poolW, surfaceY, sampleSpacing, t, row.config);

      if (points && points.length > 0) {
        // Draw Lava Body
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.lineTo(poolW, poolH);
        ctx.lineTo(0, poolH);
        ctx.closePath();
        ctx.fillStyle = '#8B0000';
        ctx.fill();

        // Stroke Surface Line
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.strokeStyle = '#FF6600';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.restore();
    });
  });

  const destPath = join(OUTPUT_DIR, 'sine-vs-gerstner.png');
  writeFileSync(destPath, canvas.toBuffer('image/png'));

  const end = performance.now();
  console.log(`Wave line benchmark rendering complete in ${(end - start).toFixed(2)}ms.`);
  console.log(`Output saved to: ${destPath}`);
}

renderWaveLineBenchmarks();
