import { createCanvas, type Canvas } from 'canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EnemyState } from '../../src/platformer/enemy/types';
import {
  drawCharger,
  DEFAULT_CHARGER_PALETTE,
} from '../../src/platformer/enemy/archetypes/charger';

const OUTPUT_DIR = 'benchmarks/enemy-archetype-catalog';
const OUTPUT_FILE = join(OUTPUT_DIR, 'charger-production.png');
const WIDTH = 960;
const HEIGHT = 440;
const BACKGROUND = '#0d0b12';
const PANEL = '#18131f';
const BORDER = '#3d3149';
const TEXT = '#f3edf7';
const MUTED = '#a79caf';

interface FrameSpec {
  readonly label: string;
  readonly phase: 'patrol' | 'windup' | 'dash' | 'recovery';
  readonly facing: 1 | -1;
  readonly dashDir?: 1 | -1;
  readonly windupTimer?: number;
  readonly grayscale?: boolean;
}

function ctx2d(canvas: Canvas): CanvasRenderingContext2D {
  return canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
}

function state(spec: FrameSpec, x: number, y: number): EnemyState {
  return {
    x,
    y,
    vx: spec.phase === 'dash' ? spec.facing * 300 : 0,
    vy: 0,
    facing: spec.facing,
    alive: true,
    data: {
      phase: spec.phase,
      dashDir: spec.dashDir ?? spec.facing,
      windupTimer: spec.phase === 'windup' ? (spec.windupTimer ?? 0.25) : 0,
      recoveryTimer: spec.phase === 'recovery' ? 0.5 : 0,
      distanceTraveled: spec.phase === 'dash' ? 64 : 0,
    },
  };
}

function renderSheet(): Canvas {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = TEXT;
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('Charger archetype validation', 20, 30);
  ctx.fillStyle = MUTED;
  ctx.font = '12px sans-serif';
  ctx.fillText(
    'shape-readable windup · locked dash · wall impact · recovery · grayscale',
    20,
    50,
  );

  const specs: readonly FrameSpec[] = [
    { label: 'patrol →', phase: 'patrol', facing: 1 },
    { label: 'early windup', phase: 'windup', facing: 1, windupTimer: 0.45 },
    { label: 'late windup', phase: 'windup', facing: 1, windupTimer: 0.08 },
    { label: 'first dash', phase: 'dash', facing: 1 },
    { label: 'mid dash', phase: 'dash', facing: 1 },
    { label: 'wall impact', phase: 'recovery', facing: 1 },
    { label: 'recovery', phase: 'recovery', facing: 1 },
    { label: 'return patrol', phase: 'patrol', facing: 1 },
    { label: 'patrol ←', phase: 'patrol', facing: -1 },
    { label: 'windup ←', phase: 'windup', facing: -1, dashDir: -1 },
    { label: 'dash ←', phase: 'dash', facing: -1, dashDir: -1 },
    { label: 'grayscale windup', phase: 'windup', facing: 1, grayscale: true },
  ];
  const columns = 6;
  const cellWidth = 145;
  const cellHeight = 155;
  specs.forEach((spec, index) => {
    const x = 20 + (index % columns) * (cellWidth + 8);
    const y = 70 + Math.floor(index / columns) * (cellHeight + 8);
    ctx.fillStyle = PANEL;
    ctx.fillRect(x, y, cellWidth, cellHeight);
    ctx.strokeStyle = BORDER;
    ctx.strokeRect(x + 0.5, y + 0.5, cellWidth - 1, cellHeight - 1);
    ctx.fillStyle = TEXT;
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(spec.label, x + 9, y + 18);
    ctx.strokeStyle = '#655b70';
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 130.5);
    ctx.lineTo(x + cellWidth - 10, y + 130.5);
    ctx.stroke();
    const palette = spec.grayscale
      ? {
          body: '#8e8a92',
          armor: '#5c5861',
          feature: '#f1edf4',
          outline: '#171419',
        }
      : DEFAULT_CHARGER_PALETTE;
    ctx.save();
    ctx.translate(x + 72, y + 119);
    ctx.scale(3, 3);
    ctx.translate(-8, -16);
    drawCharger(ctx, state(spec, 0, 0), palette);
    ctx.restore();

    if (spec.label === 'wall impact') {
      ctx.fillStyle = '#60566b';
      ctx.fillRect(x + 112, y + 60, 10, 70);
    }
  });

  ctx.fillStyle = MUTED;
  ctx.font = '11px sans-serif';
  ctx.fillText('player scale reference', 20, 410);
  ctx.strokeStyle = '#d9c8ff';
  ctx.strokeRect(145.5, 370.5, 24, 36);
  ctx.fillText('Windup compresses backward; recovery slumps and emits sparks.', 230, 410);
  return canvas;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const first = renderSheet().toBuffer('image/png');
const second = renderSheet().toBuffer('image/png');
if (!first.equals(second)) {
  throw new Error('charger benchmark is not byte-deterministic');
}
writeFileSync(OUTPUT_FILE, first);
console.log(`ok ${OUTPUT_FILE} ${(first.byteLength / 1024).toFixed(1)} KB`);
