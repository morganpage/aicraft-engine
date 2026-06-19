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

function renderAntennaFix() {
  const seed = 98724;
  const config = deriveHeroConfig(seed);
  const DT = 1 / 60;

  console.log('Simulating 6 states for antenna vision check...');

  // 1. Idle — stationary, breath oscillating
  let frame1 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame1 = stepHero(frame1, DT, { walkDx: 0, facing: 1 });
  }
  const tick1 = 30;

  // 2. Walk right, midstride — moving rightward
  let frame2 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame2 = stepHero(frame2, DT, { walkDx: 1.5, facing: 1 });
  }
  const tick2 = 30;

  // 3. Walk left, midstride — mirrored, moving leftward
  let frame3 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame3 = stepHero(frame3, DT, { walkDx: -1.5, facing: -1 });
  }
  const tick3 = 30;

  // 4. Jump apex — airborne, airborneBlend: 1
  let frame4 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame4 = stepHero(frame4, DT);
  }
  frame4 = stepHero(frame4, DT, { jumpPressed: true, jumpHeld: true });
  for (let i = 0; i < 25; i++) {
    frame4 = stepHero(frame4, DT, { jumpPressed: false, jumpHeld: true });
  }
  const tick4 = 30 + 1 + 25;

  // 5. Jump landing squash — minimum scaleY
  let frame5 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame5 = stepHero(frame5, DT);
  }
  frame5 = stepHero(frame5, DT, { jumpPressed: true, jumpHeld: true });
  for (let i = 0; i < 25; i++) {
    frame5 = stepHero(frame5, DT, { jumpPressed: false, jumpHeld: true });
  }
  let landingFrames: { frame: any; tick: number; scaleY: number }[] = [];
  let currentTick = 30 + 1 + 25;
  for (let i = 0; i < 40; i++) {
    frame5 = stepHero(frame5, DT, { jumpPressed: false, jumpHeld: false });
    currentTick++;
    if (frame5.jump.phase === 'landing') {
      landingFrames.push({
        frame: frame5,
        tick: currentTick,
        scaleY: frame5.jump.scale.scaleY,
      });
    }
  }
  landingFrames.sort((a, b) => a.scaleY - b.scaleY);
  const bestLanding = landingFrames[0];

  // 6. A few ticks post-landing (recovery) — e.g. 10 ticks after landing squash
  let frame6 = bestLanding.frame;
  let tick6 = bestLanding.tick;
  for (let i = 0; i < 10; i++) {
    frame6 = stepHero(frame6, DT, { jumpPressed: false, jumpHeld: false });
    tick6++;
  }

  // Create a 3x2 composite canvas (960 x 640)
  const compositeWidth = HERO_CANVAS_SIZE * 3;
  const compositeHeight = HERO_CANVAS_SIZE * 2;
  const canvas = createCanvas(compositeWidth, compositeHeight);
  const ctx = canvas.getContext('2d');

  const panels = [
    {
      frame: frame1,
      tick: tick1,
      label: '1. Idle (Facing Right)',
      subLabel: `Phase: ${frame1.jump.phase} | ScaleY: ${frame1.jump.scale.scaleY.toFixed(3)} | Tick: ${tick1}`,
      col: 0,
      row: 0,
    },
    {
      frame: frame2,
      tick: tick2,
      label: '2. Walk Right (Midstride)',
      subLabel: `Phase: ${frame2.jump.phase} | x: ${frame2.x.toFixed(1)} | Tick: ${tick2}`,
      col: 1,
      row: 0,
    },
    {
      frame: frame3,
      tick: tick3,
      label: '3. Walk Left (Midstride)',
      subLabel: `Phase: ${frame3.jump.phase} | x: ${frame3.x.toFixed(1)} | Tick: ${tick3}`,
      col: 2,
      row: 0,
    },
    {
      frame: frame4,
      tick: tick4,
      label: '4. Jump Apex',
      subLabel: `Phase: ${frame4.jump.phase} | Blend: ${frame4.jump.airborneBlend.toFixed(2)} | Tick: ${tick4}`,
      col: 0,
      row: 1,
    },
    {
      frame: bestLanding.frame,
      tick: bestLanding.tick,
      label: '5. Landing Squash (Max Squash)',
      subLabel: `Phase: ${bestLanding.frame.jump.phase} | ScaleY: ${bestLanding.scaleY.toFixed(3)} | Tick: ${bestLanding.tick}`,
      col: 1,
      row: 1,
    },
    {
      frame: frame6,
      tick: tick6,
      label: '6. Post-Landing Recovery',
      subLabel: `Phase: ${frame6.jump.phase} | ScaleY: ${frame6.jump.scale.scaleY.toFixed(3)} | Tick: ${tick6}`,
      col: 2,
      row: 1,
    },
  ];

  panels.forEach((panel) => {
    const xOffset = panel.col * HERO_CANVAS_SIZE;
    const yOffset = panel.row * HERO_CANVAS_SIZE;

    ctx.save();
    ctx.translate(xOffset, yOffset);

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

    // 3. Shadow (scaled with height, squash, and horizontal offset)
    const jumpY = panel.frame.jump.y; // negative = up
    const heightFactor = Math.max(0, 1 + jumpY / 150);
    const shadowScale = panel.frame.jump.scale.scaleX * heightFactor;
    const shadowAlpha = 0.18 * heightFactor;
    const shadowCx = HERO_CANVAS_SIZE / 2 + panel.frame.x;
    const shadowCy = groundY + 2;

    ctx.save();
    ctx.fillStyle = config.palette.outline;
    ctx.globalAlpha = shadowAlpha;
    ctx.beginPath();
    ctx.ellipse(shadowCx, shadowCy, 56 * shadowScale, 8 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 4. Character
    drawSlimeKnight(ctx as any, panel.frame, panel.tick);

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
  });

  // Draw grid dividers
  ctx.strokeStyle = '#cbd5e1'; // Slate-300
  ctx.lineWidth = 1;

  // Vertical lines
  for (let col = 1; col < 3; col++) {
    ctx.beginPath();
    ctx.moveTo(col * HERO_CANVAS_SIZE, 0);
    ctx.lineTo(col * HERO_CANVAS_SIZE, compositeHeight);
    ctx.stroke();
  }

  // Horizontal line
  ctx.beginPath();
  ctx.moveTo(0, HERO_CANVAS_SIZE);
  ctx.lineTo(compositeWidth, HERO_CANVAS_SIZE);
  ctx.stroke();

  const destPath = 'benchmarks/hero-antenna-fix.png';
  writeFileSync(destPath, canvas.toBuffer('image/png'));
  console.log(`Saved antenna fix benchmark PNG to ${destPath}`);
}

renderAntennaFix();
