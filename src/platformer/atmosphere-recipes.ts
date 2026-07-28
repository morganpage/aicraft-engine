/** Stateless atmosphere layer recipes. State advancement remains consumer-owned. @module */

import type { LevelLayerRenderer } from './level-theme';

/** Sparse deterministic dust motes. Reduced motion keeps the same static read. */
export const drawRuinsDust: LevelLayerRenderer = (ctx, frame) => {
  ctx.fillStyle = '#8f795c55';
  const phase = frame.reducedMotion ? 0 : frame.tick % 120;
  for (let i = 0; i < 9; i++) {
    const x = (i * 83 + phase * (i % 2 ? 0.08 : -0.05) + 17) % Math.max(1, frame.view.width);
    const y = 50 + ((i * 47 + phase * 0.04) % Math.max(1, frame.view.height - 70));
    ctx.fillRect(x, y, i % 3 === 0 ? 2 : 1, 1);
  }
};

/** Static cavern drips with an optional tick-addressed falling bead. */
export const drawCavernDrips: LevelLayerRenderer = (ctx, frame) => {
  ctx.strokeStyle = '#66547988';
  ctx.lineWidth = 1;
  for (let x = 38; x < frame.view.width; x += 97) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 12 + (x % 19)); ctx.stroke();
    if (!frame.reducedMotion) {
      ctx.fillStyle = '#9b83aa88';
      ctx.fillRect(x, (frame.tick * 0.35 + x) % Math.max(1, frame.view.height), 1, 2);
    }
  }
};

/** Small warning sparks; static dots replace motion under reduced motion. */
export const drawMechanicalSparks: LevelLayerRenderer = (ctx, frame) => {
  ctx.fillStyle = '#e7b94f99';
  const phase = frame.reducedMotion ? 0 : frame.tick % 30;
  for (let i = 0; i < 5; i++) {
    const x = 44 + i * 121;
    const y = frame.view.height - 28 - (frame.reducedMotion ? 0 : (phase + i * 5) % 14);
    ctx.fillRect(x, y, 2, 2);
  }
};
