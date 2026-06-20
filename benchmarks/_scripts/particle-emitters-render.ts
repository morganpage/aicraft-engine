import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createEmitter,
  stepEmitters,
  type Emitter,
  type Particle,
} from '../../src/particles';
import { mulberry32 } from '../../src/rng';

const OUTPUT_DIR = 'benchmarks/particle-emitters';
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

function renderLavaPoolBenchmark() {
  const W = 1000;
  const H = 960;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#1d1128';
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('aicraft-engine — Particle Emitter Benchmark', 50, 30);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px sans-serif';
  ctx.fillText('Lava Pool Use Case: Fire (positive gravityScale, falls) vs Smoke (negative gravityScale, rises)', 50, 48);

  // Setup emitters
  const lavaLine = {
    type: 'line' as const,
    x1: 300,
    y1: 120,
    x2: 700,
    y2: 120,
  };

  const fireEmitter = createEmitter({
    rate: 2.0,
    region: lavaLine,
    cone: { baseAngle: -Math.PI / 2, spread: 0.5, speedMin: 1.0, speedMax: 2.5 },
    gravityScale: 0.6,
    dragScale: 0.98,
    life: 30,
    size: 3,
    color: '#FFAA00',
    rng: mulberry32(42),
  });

  const smokeEmitter = createEmitter({
    rate: 0.8,
    region: lavaLine,
    cone: { baseAngle: -Math.PI / 2, spread: 1.0, speedMin: 0.5, speedMax: 1.5 },
    gravityScale: -0.4,
    dragScale: 0.95,
    life: 60,
    size: 6,
    color: '#888888',
    rng: mulberry32(99),
  });

  const snapshots: {
    tick: number;
    fireParticles: Particle[];
    smokeParticles: Particle[];
  }[] = [];

  let emitters: Emitter[] = [fireEmitter, smokeEmitter];

  for (let tick = 0; tick <= 120; tick++) {
    if (tick === 0 || tick === 30 || tick === 60 || tick === 90 || tick === 120) {
      snapshots.push({
        tick,
        fireParticles: emitters[0].particles.map((p) => ({ ...p })),
        smokeParticles: emitters[1].particles.map((p) => ({ ...p })),
      });
    }
    emitters = stepEmitters(emitters, 1, { gravity: 0.5, drag: 1.0 });
  }

  const startY = 60;
  const rowHeight = 180;

  // Draw separator lines
  ctx.strokeStyle = '#2d1a3e';
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const y = startY + i * rowHeight;
    ctx.beginPath();
    ctx.moveTo(20, y);
    ctx.lineTo(980, y);
    ctx.stroke();
  }

  snapshots.forEach((snapshot, index) => {
    const yOffset = startY + index * rowHeight;

    // Draw row label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(
      `Tick ${snapshot.tick} — fire: ${snapshot.fireParticles.length}, smoke: ${snapshot.smokeParticles.length}`,
      50,
      yOffset + 40,
    );

    // Draw lava line
    ctx.strokeStyle = '#FF6600';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(300, yOffset + 120);
    ctx.lineTo(700, yOffset + 120);
    ctx.stroke();

    // Draw smoke particles (larger, draw first so fire draws on top if they overlap)
    snapshot.smokeParticles.forEach((p) => {
      ctx.fillStyle = '#888888';
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.beginPath();
      ctx.arc(p.x, yOffset + p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw fire particles
    snapshot.fireParticles.forEach((p) => {
      ctx.fillStyle = '#FFAA00';
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.beginPath();
      ctx.arc(p.x, yOffset + p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });

    // Reset alpha
    ctx.globalAlpha = 1.0;
  });

  const destPath = join(OUTPUT_DIR, 'lava-pool.png');
  writeFileSync(destPath, canvas.toBuffer('image/png'));
  console.log(`Saved benchmark PNG to ${destPath}`);
}

renderLavaPoolBenchmark();
