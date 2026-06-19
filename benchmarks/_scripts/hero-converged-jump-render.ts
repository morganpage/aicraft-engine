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

function renderConvergedJump() {
  const seed = 98724;
  const config = deriveHeroConfig(seed);
  const DT = 1 / 60;

  // Phase 1: GROUNDED (walk-in-place, no jump) — step 30 ticks to settle into walk cycle
  let frame = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame = stepHero(frame, DT);
  }
  const groundedFrame = frame;
  const groundedTick = 30;

  // Phase 2: ANTICIPATION — trigger jump, step ~2 ticks (anticipationDuration default 0.05 ≈ 3 ticks)
  frame = createHeroFrameState(config); // reset
  for (let i = 0; i < 30; i++) {
    frame = stepHero(frame, DT);
  }
  frame = stepHero(frame, DT, { jumpPressed: true, jumpHeld: true });
  const anticipateFrame = frame;
  const anticipateTick = 31;

  // Phase 3: APEX — continue holding, step until apex (~timeToApex/dt ticks after launch)
  let apexFrame = frame;
  for (let i = 0; i < 25; i++) {
    apexFrame = stepHero(apexFrame, DT, { jumpPressed: false, jumpHeld: true });
  }
  const apexTick = 31 + 25;

  // Phase 4: LANDING SQUASH — continue until landed
  let landFrame = apexFrame;
  let landTick = apexTick;
  for (let i = 0; i < 40; i++) {
    landFrame = stepHero(landFrame, DT, { jumpPressed: false, jumpHeld: false });
    landTick++;
    if (landFrame.jump.phase === 'landing') break;
  }

  // Create a 4-panel composite canvas (1280 x 320)
  const compositeWidth = HERO_CANVAS_SIZE * 4;
  const compositeHeight = HERO_CANVAS_SIZE;
  const canvas = createCanvas(compositeWidth, compositeHeight);
  const ctx = canvas.getContext('2d');

  const panels = [
    { frame: groundedFrame, tick: groundedTick, label: 'Grounded (walk)' },
    { frame: anticipateFrame, tick: anticipateTick, label: 'Anticipation (crouch)' },
    { frame: apexFrame, tick: apexTick, label: 'Apex (tuck + lift)' },
    { frame: landFrame, tick: landTick, label: 'Landing (squash)' },
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

    // 3. Shadow (scaled with height and squash)
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

    // 6. Sub-label with phase and offset info
    ctx.fillStyle = '#64748b'; // Slate-500
    ctx.font = '10px sans-serif';
    ctx.fillText(
      `Phase: ${panel.frame.jump.phase} | Y: ${yOffset.toFixed(1)}px | ScaleY: ${panel.frame.jump.scale.scaleY.toFixed(2)}`,
      HERO_CANVAS_SIZE / 2,
      55
    );

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
  const destPath = 'benchmarks/hero-converged-jump.png';
  writeFileSync(destPath, canvas.toBuffer('image/png'));
  console.log(`Saved composite jump benchmark PNG to ${destPath}`);
}

renderConvergedJump();
