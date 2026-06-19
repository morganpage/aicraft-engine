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

function renderLandingFix() {
  const seed = 98724;
  const config = deriveHeroConfig(seed);
  const DT = 1 / 60;

  console.log('Simulating jump-trigger flow to find minimum landing scaleY...');

  // Step 1: Settle into walk cycle (30 ticks)
  let frame = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame = stepHero(frame, DT);
  }

  // Step 2: Trigger jump
  frame = stepHero(frame, DT, { jumpPressed: true, jumpHeld: true });

  // Step 3: Advance to apex (25 ticks)
  for (let i = 0; i < 25; i++) {
    frame = stepHero(frame, DT, { jumpPressed: false, jumpHeld: true });
  }

  // Step 4: Advance until landing phase, then find the frame with minimum scaleY
  let landingFrames: { frame: any; tick: number; scaleY: number }[] = [];
  let currentTick = 30 + 1 + 25;

  for (let i = 0; i < 40; i++) {
    frame = stepHero(frame, DT, { jumpPressed: false, jumpHeld: false });
    currentTick++;
    if (frame.jump.phase === 'landing') {
      landingFrames.push({
        frame,
        tick: currentTick,
        scaleY: frame.jump.scale.scaleY,
      });
    }
  }

  if (landingFrames.length === 0) {
    console.error('Error: No landing frames found!');
    return;
  }

  // Sort landing frames to find the one with the minimum scaleY
  landingFrames.sort((a, b) => a.scaleY - b.scaleY);
  const bestLanding = landingFrames[0];
  console.log(`Found minimum landing scaleY: ${bestLanding.scaleY.toFixed(4)} at tick ${bestLanding.tick}`);

  // Step 5: Simulate idle frame (walkDx: 0, settle 30 ticks)
  let idleFrame = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    idleFrame = stepHero(idleFrame, DT, { walkDx: 0 });
  }
  const idleTick = 30;

  // Create a 2-panel composite canvas (640 x 320)
  const compositeWidth = HERO_CANVAS_SIZE * 2;
  const compositeHeight = HERO_CANVAS_SIZE;
  const canvas = createCanvas(compositeWidth, compositeHeight);
  const ctx = canvas.getContext('2d');

  const panels = [
    {
      frame: bestLanding.frame,
      tick: bestLanding.tick,
      label: '1. Landing Squash (Fix Target)',
      subLabel: `Phase: landing | ScaleY: ${bestLanding.scaleY.toFixed(3)} | Tick: ${bestLanding.tick}`,
    },
    {
      frame: idleFrame,
      tick: idleTick,
      label: '2. Idle (Regression Baseline)',
      subLabel: `Phase: grounded | ScaleY: ${idleFrame.jump.scale.scaleY.toFixed(3)} | Tick: ${idleTick}`,
    },
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

    // 3. Shadow
    const yOffset = panel.frame.jump.y; // negative = up
    const heightFactor = Math.max(0, 1 + yOffset / 150);
    const shadowScale = panel.frame.jump.scale.scaleX * heightFactor;
    const shadowAlpha = 0.18 * heightFactor;

    ctx.save();
    ctx.fillStyle = config.palette.outline;
    ctx.globalAlpha = shadowAlpha;
    ctx.beginPath();
    ctx.ellipse(HERO_CANVAS_SIZE / 2, groundY + 2, 56 * shadowScale, 8 * shadowScale, 0, 0, Math.PI * 2);
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

  const destPath = 'benchmarks/hero-landing-fix.png';
  writeFileSync(destPath, canvas.toBuffer('image/png'));
  console.log(`Saved landing fix benchmark PNG to ${destPath}`);
}

renderLandingFix();
