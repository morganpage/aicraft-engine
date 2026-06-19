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

function renderDirectionalWalk() {
  const seed = 98724;
  const config = deriveHeroConfig(seed);
  const DT = 1 / 60;

  // Panel 1: Idle, facing right (facing: 1, walkDx: 0)
  let frame1 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame1 = stepHero(frame1, DT, { walkDx: 0, facing: 1 });
  }

  // Panel 2: Walking right (facing: 1, walkDx: 1.5)
  let frame2 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame2 = stepHero(frame2, DT, { walkDx: 1.5, facing: 1 });
  }

  // Panel 3: Walking left (facing: -1, walkDx: -1.5)
  let frame3 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame3 = stepHero(frame3, DT, { walkDx: -1.5, facing: -1 });
  }

  // Panel 4: Idle, facing left (facing: -1, walkDx: 0)
  let frame4 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame4 = stepHero(frame4, DT, { walkDx: 0, facing: -1 });
  }

  // Create a 4-panel composite canvas (1280 x 320)
  const compositeWidth = HERO_CANVAS_SIZE * 4;
  const compositeHeight = HERO_CANVAS_SIZE;
  const canvas = createCanvas(compositeWidth, compositeHeight);
  const ctx = canvas.getContext('2d');

  const panels = [
    { frame: frame1, label: 'Idle →', subLabel: 'facing: 1 | walkDx: 0 | x: 0' },
    { frame: frame2, label: 'Walk →', subLabel: 'facing: 1 | walkDx: 1.5 | x: 45' },
    { frame: frame3, label: 'Walk ←', subLabel: 'facing: -1 | walkDx: -1.5 | x: -45' },
    { frame: frame4, label: 'Idle ←', subLabel: 'facing: -1 | walkDx: 0 | x: 0' },
  ];

  panels.forEach((panel, index) => {
    const xOffset = index * HERO_CANVAS_SIZE;

    ctx.save();
    ctx.translate(xOffset, 0);

    // 1. Background
    ctx.fillStyle = config.palette.background;
    ctx.fillRect(0, 0, HERO_CANVAS_SIZE, HERO_CANVAS_SIZE);

    // 2. Ground line
    const groundY = HERO_GROUND_Y;
    ctx.strokeStyle = config.palette.outline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, groundY + 0.5);
    ctx.lineTo(HERO_CANVAS_SIZE, groundY + 0.5);
    ctx.stroke();

    // 3. Shadow (tracks frame.x)
    const shadowCx = HERO_CANVAS_SIZE / 2 + panel.frame.x;
    const shadowCy = groundY + 2;
    ctx.save();
    ctx.fillStyle = config.palette.outline;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.ellipse(shadowCx, shadowCy, 56, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 4. Character
    drawSlimeKnight(ctx as any, panel.frame, 30);

    // 5. Label
    ctx.fillStyle = config.palette.outline;
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(panel.label, HERO_CANVAS_SIZE / 2, 35);

    // 6. Sub-label
    ctx.fillStyle = '#64748b'; // Slate-500
    ctx.font = '11px sans-serif';
    ctx.fillText(panel.subLabel, HERO_CANVAS_SIZE / 2, 55);

    ctx.restore();

    // Draw panel divider
    if (index > 0) {
      ctx.strokeStyle = '#cbd5e1'; // Slate-300
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xOffset, 0);
      ctx.lineTo(xOffset, HERO_CANVAS_SIZE);
      ctx.stroke();
    }
  });

  // Save composite image
  const destPath = 'benchmarks/hero-directional-walk.png';
  writeFileSync(destPath, canvas.toBuffer('image/png'));
  console.log(`Saved composite directional walk benchmark PNG to ${destPath}`);
}

renderDirectionalWalk();
