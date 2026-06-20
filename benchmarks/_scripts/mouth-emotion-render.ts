import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';
import {
  deriveHeroConfig,
  createHeroFrameState,
  stepHero,
  drawSlimeKnight,
  HERO_CANVAS_SIZE,
  HERO_GROUND_Y,
} from '../../showcase/helpers/slime-knight';

/**
 * Render the parametric mouth across the full emotion range [-1, 1] in a single
 * horizontal strip. The first five panels sample the negative half so the
 * flat-line → filled-circle morph reads cleanly (emotion 0, -0.25, -0.5,
 * -0.75, -1); the last two panels show the positive half (mild smile + full
 * smile). A single settled tick is used for every panel because the current
 * mouth design is fully tick-independent (the negative range reads the
 * nervousness from the small "o" shape itself, not from motion).
 *
 * Idle pose (walkDx 0, facing 1, cyclops), settled ~30 ticks. Same node-canvas
 * + stepHero + drawSlimeKnight pattern as `hero-eye-render.ts`.
 *
 * Run:   `npx tsx benchmarks/_scripts/mouth-emotion-render.ts`
 * Output: `benchmarks/mouth-emotion.png`
 */
function renderMouthEmotionBenchmark(): void {
  const seed = 98724; // same seed as hero-eye-render for cross-benchmark consistency
  const config = deriveHeroConfig(seed);
  const DT = 1 / 60;

  // Settle the hero into a clean idle cyclops pose (~30 ticks).
  let frame = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame = stepHero(frame, DT, { walkDx: 0, facing: 1, eyeCount: 1 });
  }
  const SETTLE_TICK = 30;
  const look = { x: 0, y: 0 };

  // Panels: emotion samples across the full range. The first five show the
  // flat-line → filled-circle morph (the nervous "o"); the last two show the
  // smile Bézier. Single tick — no tremble in the current design.
  const panels: { emotion: number; tick: number; label: string; subLabel: string }[] = [
    {
      emotion: 0,
      tick: SETTLE_TICK,
      label: 'emotion: 0',
      subLabel: 'neutral (flat line) · tick 30',
    },
    {
      emotion: -0.25,
      tick: SETTLE_TICK,
      label: 'emotion: -0.25',
      subLabel: 'nervous (slight "o") · tick 30',
    },
    {
      emotion: -0.5,
      tick: SETTLE_TICK,
      label: 'emotion: -0.5',
      subLabel: 'nervous (half "o") · tick 30',
    },
    {
      emotion: -0.75,
      tick: SETTLE_TICK,
      label: 'emotion: -0.75',
      subLabel: 'nervous (near-full "o") · tick 30',
    },
    {
      emotion: -1,
      tick: SETTLE_TICK,
      label: 'emotion: -1',
      subLabel: 'nervous (full "o" circle) · tick 30',
    },
    {
      emotion: 0.5,
      tick: SETTLE_TICK,
      label: 'emotion: 0.5',
      subLabel: 'happy (mild smile) · tick 30',
    },
    {
      emotion: 1,
      tick: SETTLE_TICK,
      label: 'emotion: 1',
      subLabel: 'happy (full smile) · tick 30',
    },
  ];

  const canvas = createCanvas(HERO_CANVAS_SIZE * panels.length, HERO_CANVAS_SIZE);
  const ctx = canvas.getContext('2d');

  panels.forEach((panel, index) => {
    const xOffset = index * HERO_CANVAS_SIZE;

    ctx.save();
    ctx.translate(xOffset, 0);

    // 1. Background
    ctx.fillStyle = config.palette.background;
    ctx.fillRect(0, 0, HERO_CANVAS_SIZE, HERO_CANVAS_SIZE);

    // 2. Ground line
    ctx.strokeStyle = config.palette.outline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, HERO_GROUND_Y + 0.5);
    ctx.lineTo(HERO_CANVAS_SIZE, HERO_GROUND_Y + 0.5);
    ctx.stroke();

    // 3. Shadow (settled idle → neutral shadow; frame.x stays 0 for idle cyclops)
    ctx.save();
    ctx.fillStyle = config.palette.outline;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.ellipse(
      HERO_CANVAS_SIZE / 2 + frame.x,
      HERO_GROUND_Y + 2,
      56,
      8,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();

    // 4. Character with mouth (no blink, so the eye stays open + readable)
    drawSlimeKnight(ctx as unknown as CanvasRenderingContext2D, frame, panel.tick, look, {
      emotion: panel.emotion,
    });

    // 5. Label
    ctx.fillStyle = config.palette.outline;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(panel.label, HERO_CANVAS_SIZE / 2, 35);

    // 6. Sub-label
    ctx.fillStyle = '#64748b'; // Slate-500
    ctx.font = '10px sans-serif';
    ctx.fillText(panel.subLabel, HERO_CANVAS_SIZE / 2, 55);

    ctx.restore();

    // Divider between panels
    if (index > 0) {
      ctx.strokeStyle = '#cbd5e1'; // Slate-300
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xOffset, 0);
      ctx.lineTo(xOffset, HERO_CANVAS_SIZE);
      ctx.stroke();
    }
  });

  writeFileSync('benchmarks/mouth-emotion.png', canvas.toBuffer('image/png'));
  console.log('Saved benchmarks/mouth-emotion.png');
}

renderMouthEmotionBenchmark();
