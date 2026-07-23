/**
 * Death feedback benchmark renderer.
 *
 * Uses the production helpers from `showcase/sections/playground-death.ts`
 * for the deterministic lifecycle, with rendering code local to this script.
 *
 * Outputs:
 *   - `benchmarks/death-feedback/comparison-gallery.png` — all ticks at key frames
 *   - `benchmarks/death-feedback/best-candidate-sequence.png` — Stack A frame-by-frame
 */

import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  beginDeath,
  advanceDeath,
  deathProgress,
  isOneShotTick,
  shouldFlash,
  flashAlpha,
  respawnPopScale,
  DEATH_ANIM_TICKS,
  DEATH_PARTICLE_COUNT,
  DEATH_PARTICLE_COUNT_REDUCED,
  DEATH_SHAKE_AMPLITUDE,
  DEATH_SHAKE_DURATION,
  DEATH_FLASH_DURATION_TICKS,
  DEATH_RESPAWN_POP_TICKS,
  DEATH_PARTICLE_SPEED,
  DEATH_PARTICLE_SIZE,
  DEATH_PARTICLE_LIFE,
  DEATH_PARTICLE_DRAG,
  DEATH_PARTICLE_COLOR,
  DEATH_FLASH_COLOR,
  DEATH_HIT_STOP_TICKS,
  type DeathState,
} from '../../showcase/sections/playground-death';
import { spawn } from '../../src/particles/spawn';
import { step as stepParticles } from '../../src/particles/step';
import type { Particle } from '../../src/particles/types';
import { sineShake, shakeEnvelope } from '../../src/animation/oscillators';
import { mulberry32 } from '../../src/rng/mulberry32';

const OUTPUT_DIR = 'benchmarks/death-feedback';

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

/** Stack A constants (production default). */
const STACK_A = {
  PARTICLE_COUNT: DEATH_PARTICLE_COUNT,
  PARTICLE_SPEED: DEATH_PARTICLE_SPEED,
  PARTICLE_SIZE: DEATH_PARTICLE_SIZE,
  PARTICLE_LIFE: DEATH_PARTICLE_LIFE,
  PARTICLE_DRAG: DEATH_PARTICLE_DRAG,
  SHAKE_AMPLITUDE: DEATH_SHAKE_AMPLITUDE,
  SHAKE_DURATION: DEATH_SHAKE_DURATION,
  SHAKE_FREQ_X: 0.8,
  SHAKE_FREQ_Y: 1.2,
  FLASH_DURATION_TICKS: DEATH_FLASH_DURATION_TICKS,
} as const;

/** Render a single death frame with Stack A parameters. */
function renderDeathFrame(
  ctx: CanvasRenderingContext2D,
  reducedMotion: boolean,
  tick: number,
): void {
  const W = 200;
  const H = 200;
  const cx = W / 2;
  const cy = H / 2;
  const rm = reducedMotion;

  const particleCount = rm ? DEATH_PARTICLE_COUNT_REDUCED : STACK_A.PARTICLE_COUNT;
  const shakeAmp = rm ? 0 : STACK_A.SHAKE_AMPLITUDE;
  const shakeDuration = rm ? 0 : STACK_A.SHAKE_DURATION;

  const rng = mulberry32(42);
  let particles: Particle[] = [];

  // Build lifecycle state up to the requested tick.
  let death = beginDeath('enemy', cx, cy, 0, 0);
  for (let t = 0; t < tick; t++) death = advanceDeath(death);

  // Spawn particles at tick 0.
  if (particleCount > 0) {
    particles = spawn(0, 0, {
      count: particleCount,
      speed: STACK_A.PARTICLE_SPEED,
      speedJitter: 0.2,
      life: STACK_A.PARTICLE_LIFE,
      size: STACK_A.PARTICLE_SIZE,
      color: DEATH_PARTICLE_COLOR,
      rng,
    });
  }

  // Step particles to the current tick.
  for (let t = 0; t < tick; t++) {
    particles = stepParticles(particles, 1, { drag: STACK_A.PARTICLE_DRAG });
  }

  // Camera shake.
  const envelope = shakeEnvelope(tick, shakeDuration, shakeAmp);
  const shake = sineShake(tick, envelope, STACK_A.SHAKE_FREQ_X, STACK_A.SHAKE_FREQ_Y);

  // Flash.
  const flashActive = shouldFlash(death, rm);
  const alpha = flashAlpha(death);

  // Death progress for circle.
  const progress = deathProgress(death);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  if (shake.x !== 0 || shake.y !== 0) {
    ctx.translate(shake.x, shake.y);
  }

  // Death circle.
  const circleAlpha = Math.max(0, 1 - progress * 1.5);
  const circleRadius = 20 * (1 - progress * 0.5);
  if (circleAlpha > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, circleRadius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 68, 68, ${circleAlpha})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 200, 200, ${circleAlpha * 0.8})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Particles.
  for (const p of particles) {
    const age = p.maxLife > 0 ? 1 - p.life / p.maxLife : 1;
    const pAlpha = Math.max(0, 1 - age);
    const radius = p.size * (1 - age * 0.5);
    ctx.beginPath();
    ctx.arc(cx + p.x, cy + p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 68, 68, ${pAlpha})`;
    ctx.fill();
  }

  ctx.restore();

  // Flash overlay.
  if (flashActive && alpha > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.7})`;
    ctx.fillRect(0, 0, W, H);
  }
}

/** Render the respawn pop-scale effect. */
function renderRespawnFrame(ctx: CanvasRenderingContext2D, tick: number): void {
  const W = 200;
  const H = 200;
  const cx = W / 2;
  const cy = H / 2;
  const playerW = 32;
  const playerH = 48;

  const scale = respawnPopScale(tick);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale.scaleX, scale.scaleY);

  ctx.fillStyle = '#44aaff';
  ctx.fillRect(-playerW / 2, -playerH / 2, playerW, playerH);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.strokeRect(-playerW / 2, -playerH / 2, playerW, playerH);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-8, -16, 6, 6);
  ctx.fillRect(2, -16, 6, 6);

  ctx.restore();

  ctx.fillStyle = '#aaaaaa';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`respawn tick ${tick}`, cx, H - 12);
}

function renderDeathFeedbackBenchmarks() {
  console.log('Rendering death feedback benchmarks...');
  const start = performance.now();

  const CELL_W = 200;
  const CELL_H = 200;
  const PADDING = 20;
  const LABEL_H = 30;

  // --- Comparison gallery: 3 columns (default, reduced) × 4 rows (ticks) ---
  const COLS = 2;
  const ROWS = 4;
  const keyTicks = [0, 5, 10, 14];

  const W = COLS * (CELL_W + PADDING) + PADDING;
  const H = ROWS * (CELL_H + PADDING) + PADDING + LABEL_H + 40;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('Death Feedback — Stack A: Default vs Reduced Motion', PADDING, 24);

  const headers = ['Default', 'Reduced Motion'];
  for (let col = 0; col < COLS; col++) {
    const x = PADDING + col * (CELL_W + PADDING);
    ctx.fillStyle = '#888888';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(headers[col], x + CELL_W / 2, 44);
  }

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = PADDING + col * (CELL_W + PADDING);
      const y = LABEL_H + 40 + row * (CELL_H + PADDING);
      const rm = col % 2 === 1;
      const tick = keyTicks[row];

      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 1, y - 1, CELL_W + 2, CELL_H + 2);

      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.rect(0, 0, CELL_W, CELL_H);
      ctx.clip();
      renderDeathFrame(ctx as any, rm, tick);
      ctx.restore();
    }
  }

  const galleryPath = join(OUTPUT_DIR, 'comparison-gallery.png');
  writeFileSync(galleryPath, canvas.toBuffer('image/png'));
  console.log(`Comparison gallery saved to: ${galleryPath}`);

  // --- Best-candidate sequence: Stack A frame-by-frame ---
  const seqCols = 12;
  const seqW = seqCols * (CELL_W + PADDING) + PADDING;
  const seqH = (CELL_H + PADDING) + PADDING + LABEL_H + 40;

  const seqCanvas = createCanvas(seqW, seqH);
  const seqCtx = seqCanvas.getContext('2d');

  seqCtx.fillStyle = '#0a0a1a';
  seqCtx.fillRect(0, 0, seqW, seqH);

  seqCtx.fillStyle = '#ffffff';
  seqCtx.font = 'bold 16px monospace';
  seqCtx.textAlign = 'left';
  seqCtx.fillText('Best Candidate Sequence: Stack A + Respawn Pop', PADDING, 24);

  const deathTicks = [0, 2, 4, 6, 8, 10, 12, 14];
  for (let i = 0; i < deathTicks.length; i++) {
    const x = PADDING + i * (CELL_W + PADDING);
    const y = LABEL_H + 40;
    const tick = deathTicks[i];

    seqCtx.fillStyle = '#888888';
    seqCtx.font = '11px monospace';
    seqCtx.textAlign = 'center';
    seqCtx.fillText(`Dying Tick ${tick}`, x + CELL_W / 2, 44);

    seqCtx.strokeStyle = '#333333';
    seqCtx.lineWidth = 1;
    seqCtx.strokeRect(x - 1, y - 1, CELL_W + 2, CELL_H + 2);

    seqCtx.save();
    seqCtx.translate(x, y);
    seqCtx.beginPath();
    seqCtx.rect(0, 0, CELL_W, CELL_H);
    seqCtx.clip();
    renderDeathFrame(seqCtx as any, false, tick);
    seqCtx.restore();
  }

  const respawnTicks = [0, 2, 4, 7];
  for (let i = 0; i < respawnTicks.length; i++) {
    const col = deathTicks.length + i;
    const x = PADDING + col * (CELL_W + PADDING);
    const y = LABEL_H + 40;
    const tick = respawnTicks[i];

    seqCtx.fillStyle = '#888888';
    seqCtx.font = '11px monospace';
    seqCtx.textAlign = 'center';
    seqCtx.fillText(`Respawn Tick ${tick}`, x + CELL_W / 2, 44);

    seqCtx.strokeStyle = '#333333';
    seqCtx.lineWidth = 1;
    seqCtx.strokeRect(x - 1, y - 1, CELL_W + 2, CELL_H + 2);

    seqCtx.save();
    seqCtx.translate(x, y);
    seqCtx.beginPath();
    seqCtx.rect(0, 0, CELL_W, CELL_H);
    seqCtx.clip();
    renderRespawnFrame(seqCtx as any, tick);
    seqCtx.restore();
  }

  const sequencePath = join(OUTPUT_DIR, 'best-candidate-sequence.png');
  writeFileSync(sequencePath, seqCanvas.toBuffer('image/png'));
  console.log(`Best candidate sequence saved to: ${sequencePath}`);

  // --- Integration-focused sequence: 9 frames ---
  const intCols = 9;
  const intW = intCols * (CELL_W + PADDING) + PADDING;
  const intH = (CELL_H + PADDING) + PADDING + LABEL_H + 40;

  const intCanvas = createCanvas(intW, intH);
  const intCtx = intCanvas.getContext('2d');

  intCtx.fillStyle = '#0a0a1a';
  intCtx.fillRect(0, 0, intW, intH);

  intCtx.fillStyle = '#ffffff';
  intCtx.font = 'bold 16px monospace';
  intCtx.textAlign = 'left';
  intCtx.fillText('Integration Sequence: Pre-Hit, Death Ticks, and Respawn Ticks', PADDING, 24);

  const intFrames: Array<{ label: string; phase: 'pre-hit' | 'death' | 'respawn'; tick: number }> = [
    { label: 'Pre-Hit', phase: 'pre-hit', tick: 0 },
    { label: 'Death Tick 0', phase: 'death', tick: 0 },
    { label: 'Death Tick 3', phase: 'death', tick: 3 },
    { label: 'Death Tick 6', phase: 'death', tick: 6 },
    { label: 'Death Tick 10', phase: 'death', tick: 10 },
    { label: 'Death Tick 14', phase: 'death', tick: 14 },
    { label: 'Respawn Tick 0', phase: 'respawn', tick: 0 },
    { label: 'Respawn Tick 4', phase: 'respawn', tick: 4 },
    { label: 'Respawn Tick 7', phase: 'respawn', tick: 7 },
  ];

  function drawPlayer(ctx: any, cx: number, cy: number, scaleX = 1, scaleY = 1): void {
    const playerW = 32;
    const playerH = 48;
    ctx.save();
    ctx.translate(cx, cy + playerH / 2); // Translate to bottom-center of player
    ctx.scale(scaleX, scaleY);
    ctx.translate(0, -playerH / 2);

    // Draw body
    ctx.fillStyle = '#44aaff';
    ctx.fillRect(-playerW / 2, -playerH / 2, playerW, playerH);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(-playerW / 2, -playerH / 2, playerW, playerH);

    // Draw eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-8, -10, 6, 6);
    ctx.fillRect(2, -10, 6, 6);

    ctx.restore();
  }

  function renderIntegrationFrame(
    ctx: any,
    phase: 'pre-hit' | 'death' | 'respawn',
    tick: number,
  ): void {
    const W = 200;
    const H = 200;
    const cx = W / 2;
    const cy = H / 2;
    const groundY = cy + 24; // Bottom of player is at groundY

    // 1. Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    // 2. Ground platform
    ctx.fillStyle = '#2e2e4a';
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.strokeStyle = '#4e4e7a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(W, groundY);
    ctx.stroke();

    // 3. Setup state
    const rm = false; // default motion
    const particleCount = STACK_A.PARTICLE_COUNT;
    const shakeAmp = STACK_A.SHAKE_AMPLITUDE;
    const shakeDuration = STACK_A.SHAKE_DURATION;

    const rng = mulberry32(42);
    let particles: Particle[] = [];

    if (phase === 'death') {
      // Spawn particles at tick 0
      particles = spawn(0, 0, {
        count: particleCount,
        speed: STACK_A.PARTICLE_SPEED,
        speedJitter: 0.2,
        life: STACK_A.PARTICLE_LIFE,
        size: STACK_A.PARTICLE_SIZE,
        color: DEATH_PARTICLE_COLOR,
        rng,
      });
      // Step particles to current tick
      for (let t = 0; t < tick; t++) {
        particles = stepParticles(particles, 1, { drag: STACK_A.PARTICLE_DRAG });
      }
    }

    // Camera shake
    let shake = { x: 0, y: 0 };
    if (phase === 'death') {
      const envelope = shakeEnvelope(tick, shakeDuration, shakeAmp);
      shake = sineShake(tick, envelope, STACK_A.SHAKE_FREQ_X, STACK_A.SHAKE_FREQ_Y);
    }

    // Flash
    let flashActive = false;
    let alpha = 0;
    if (phase === 'death') {
      let death = beginDeath('enemy', cx, cy, 0, 0);
      for (let t = 0; t < tick; t++) death = advanceDeath(death);
      flashActive = shouldFlash(death, rm);
      alpha = flashAlpha(death);
    }

    // Draw shaken content
    ctx.save();
    if (shake.x !== 0 || shake.y !== 0) {
      ctx.translate(shake.x, shake.y);
    }

    // Draw player if alive
    if (phase === 'pre-hit') {
      drawPlayer(ctx, cx, groundY - 24); // player height is 48, so center is groundY - 24
    } else if (phase === 'respawn') {
      const scale = respawnPopScale(tick);
      drawPlayer(ctx, cx, groundY - 24, scale.scaleX, scale.scaleY);
    }

    // Draw death particles
    if (phase === 'death') {
      for (const p of particles) {
        const age = p.maxLife > 0 ? 1 - p.life / p.maxLife : 1;
        const pAlpha = Math.max(0, 1 - age);
        const radius = p.size * (1 - age * 0.5);
        ctx.beginPath();
        ctx.arc(cx + p.x, cy + p.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 68, 68, ${pAlpha})`;
        ctx.fill();
      }
    }

    ctx.restore();

    // Flash overlay (screen-space)
    if (phase === 'death' && flashActive && alpha > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.7})`;
      ctx.fillRect(0, 0, W, H);
    }

    // Draw HUD (screen-space)
    ctx.fillStyle = '#8888ff';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';

    let hudText = 'x:100  y:150  grounded';
    if (phase === 'death') {
      const frozen = tick < DEATH_HIT_STOP_TICKS ? '  [FROZEN]' : '';
      hudText += `${frozen}  [DYING: enemy]`;
    } else if (phase === 'respawn') {
      hudText += '  [RESPAWNING]';
    }
    hudText += '  ·  playing';

    ctx.fillText(hudText, 6, 14);
  }

  for (let i = 0; i < intFrames.length; i++) {
    const x = PADDING + i * (CELL_W + PADDING);
    const y = LABEL_H + 40;
    const frame = intFrames[i];

    intCtx.fillStyle = '#888888';
    intCtx.font = '11px monospace';
    intCtx.textAlign = 'center';
    intCtx.fillText(frame.label, x + CELL_W / 2, 44);

    intCtx.strokeStyle = '#333333';
    intCtx.lineWidth = 1;
    intCtx.strokeRect(x - 1, y - 1, CELL_W + 2, CELL_H + 2);

    intCtx.save();
    intCtx.translate(x, y);
    intCtx.beginPath();
    intCtx.rect(0, 0, CELL_W, CELL_H);
    intCtx.clip();
    renderIntegrationFrame(intCtx, frame.phase, frame.tick);
    intCtx.restore();
  }

  const integrationPath = join(OUTPUT_DIR, 'integration-sequence.png');
  writeFileSync(integrationPath, intCanvas.toBuffer('image/png'));
  console.log(`Integration sequence saved to: ${integrationPath}`);

  const end = performance.now();
  console.log(`Death feedback benchmark rendering complete in ${(end - start).toFixed(2)}ms.`);
}

renderDeathFeedbackBenchmarks();
