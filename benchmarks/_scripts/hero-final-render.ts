import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';
import {
  deriveHeroConfig,
  createHeroFrameState,
  stepHero,
  drawSlimeKnight,
  HERO_CANVAS_SIZE,
} from '../../showcase/helpers/slime-knight';

function renderHeroFinal(seed: number, filename: string) {
  const config = deriveHeroConfig(seed);
  let frame = createHeroFrameState(config);

  // Step 30 ticks to get past the initial anticipation into a representative walk frame
  for (let i = 0; i < 30; i++) {
    frame = stepHero(frame, 1 / 60);
  }

  const canvas = createCanvas(HERO_CANVAS_SIZE, HERO_CANVAS_SIZE);
  const ctx = canvas.getContext('2d');

  // Background (mirror what hero.ts drawBackground does):
  ctx.fillStyle = config.palette.background;
  ctx.fillRect(0, 0, HERO_CANVAS_SIZE, HERO_CANVAS_SIZE);

  // Ground line + shadow:
  const groundY = HERO_CANVAS_SIZE * 0.82;
  ctx.strokeStyle = config.palette.outline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, groundY + 0.5);
  ctx.lineTo(HERO_CANVAS_SIZE, groundY + 0.5);
  ctx.stroke();

  ctx.save();
  ctx.fillStyle = config.palette.outline;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.ellipse(HERO_CANVAS_SIZE / 2, groundY + 2, 56, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Character:
  drawSlimeKnight(ctx as any, frame, 30);

  // Save:
  writeFileSync(filename, canvas.toBuffer('image/png'));
  console.log(`Rendered final hero for seed ${seed} to ${filename}`);
}

renderHeroFinal(1337, 'benchmarks/hero-final-1337.png');
renderHeroFinal(98724, 'benchmarks/hero-final-98724.png');
