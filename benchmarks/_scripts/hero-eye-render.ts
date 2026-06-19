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

function renderEyeBenchmarks() {
  const seed = 98724;
  const config = deriveHeroConfig(seed);
  const DT = 1 / 60;

  // ---------------------------------------------------------------------------
  // Task 1: Eye Tracking (6 frames)
  // ---------------------------------------------------------------------------

  // 1. Idle, facing right (look: {1, 0})
  let frame1 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame1 = stepHero(frame1, DT, { walkDx: 0, facing: 1, eyeCount: 1 });
  }

  // 2. Walk right (look: {1, 0}, facing: 1)
  let frame2 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame2 = stepHero(frame2, DT, { walkDx: 1.5, facing: 1, eyeCount: 1 });
  }

  // 3. Walk left (look: {-1, 0}, facing: -1)
  let frame3 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame3 = stepHero(frame3, DT, { walkDx: -1.5, facing: -1, eyeCount: 1 });
  }

  // 4. Jump rising (look: {0, -1})
  let frame4 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame4 = stepHero(frame4, DT, { walkDx: 0, facing: 1, eyeCount: 1 });
  }
  frame4 = stepHero(frame4, DT, { jumpPressed: true, jumpHeld: true });
  for (let i = 0; i < 10; i++) {
    frame4 = stepHero(frame4, DT, { jumpHeld: true });
  }

  // 5. Jump falling (look: {0, 1})
  let frame5 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame5 = stepHero(frame5, DT, { walkDx: 0, facing: 1, eyeCount: 1 });
  }
  frame5 = stepHero(frame5, DT, { jumpPressed: true, jumpHeld: true });
  for (let i = 0; i < 20; i++) {
    frame5 = stepHero(frame5, DT, { jumpHeld: true });
  }
  for (let i = 0; i < 10; i++) {
    frame5 = stepHero(frame5, DT, { jumpHeld: true });
  }

  // 6. Diagonal: walk right + rising (look: {1, -1}, normalized)
  let frame6 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame6 = stepHero(frame6, DT, { walkDx: 1.5, facing: 1, eyeCount: 1 });
  }
  frame6 = stepHero(frame6, DT, { jumpPressed: true, jumpHeld: true });
  for (let i = 0; i < 10; i++) {
    frame6 = stepHero(frame6, DT, { jumpHeld: true });
  }

  console.log('Frame 4 phase:', frame4.jump.phase, 'Y:', frame4.jump.y);
  console.log('Frame 5 phase:', frame5.jump.phase, 'Y:', frame5.jump.y);
  console.log('Frame 6 phase:', frame6.jump.phase, 'Y:', frame6.jump.y);

  const look1 = { x: 1, y: 0 };
  const look2 = { x: 1, y: 0 };
  const look3 = { x: -1, y: 0 };
  const look4 = { x: 0, y: -1 };
  const look5 = { x: 0, y: 1 };
  const look6 = { x: 1 / Math.sqrt(2), y: -1 / Math.sqrt(2) };

  const canvasTracking = createCanvas(960, 640);
  const ctxTracking = canvasTracking.getContext('2d');

  const panelsTracking = [
    { frame: frame1, tick: 30, look: look1, label: '1. Idle, Facing Right', subLabel: 'look: {1, 0} | facing: 1' },
    { frame: frame2, tick: 30, look: look2, label: '2. Walk Right', subLabel: 'look: {1, 0} | facing: 1' },
    { frame: frame3, tick: 30, look: look3, label: '3. Walk Left', subLabel: 'look: {-1, 0} | facing: -1' },
    { frame: frame4, tick: 41, look: look4, label: '4. Jump Rising', subLabel: 'look: {0, -1} | facing: 1' },
    { frame: frame5, tick: 66, look: look5, label: '5. Jump Falling', subLabel: 'look: {0, 1} | facing: 1' },
    { frame: frame6, tick: 41, look: look6, label: '6. Diagonal: Walk R + Rise', subLabel: 'look: {0.71, -0.71} | facing: 1' },
  ];

  panelsTracking.forEach((panel, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const xOffset = col * HERO_CANVAS_SIZE;
    const yOffset = row * HERO_CANVAS_SIZE;

    ctxTracking.save();
    ctxTracking.translate(xOffset, yOffset);

    // 1. Background
    ctxTracking.fillStyle = config.palette.background;
    ctxTracking.fillRect(0, 0, HERO_CANVAS_SIZE, HERO_CANVAS_SIZE);

    // 2. Ground line
    const groundY = HERO_GROUND_Y;
    ctxTracking.strokeStyle = config.palette.outline;
    ctxTracking.lineWidth = 1;
    ctxTracking.beginPath();
    ctxTracking.moveTo(0, groundY + 0.5);
    ctxTracking.lineTo(HERO_CANVAS_SIZE, groundY + 0.5);
    ctxTracking.stroke();

    // 3. Shadow
    const yOffsetJump = panel.frame.jump.y; // negative = up
    const heightFactor = Math.max(0, 1 + yOffsetJump / 150);
    const shadowScale = panel.frame.jump.scale.scaleX * heightFactor;
    const shadowAlpha = 0.18 * heightFactor;

    ctxTracking.save();
    ctxTracking.fillStyle = config.palette.outline;
    ctxTracking.globalAlpha = shadowAlpha;
    ctxTracking.beginPath();
    ctxTracking.ellipse(HERO_CANVAS_SIZE / 2 + panel.frame.x, groundY + 2, 56 * shadowScale, 8 * shadowScale, 0, 0, Math.PI * 2);
    ctxTracking.fill();
    ctxTracking.restore();

    // 4. Character
    drawSlimeKnight(ctxTracking as any, panel.frame, panel.tick, panel.look);

    // 5. Label
    ctxTracking.fillStyle = config.palette.outline;
    ctxTracking.font = 'bold 14px sans-serif';
    ctxTracking.textAlign = 'center';
    ctxTracking.fillText(panel.label, HERO_CANVAS_SIZE / 2, 35);

    // 6. Sub-label
    ctxTracking.fillStyle = '#64748b'; // Slate-500
    ctxTracking.font = '10px sans-serif';
    ctxTracking.fillText(panel.subLabel, HERO_CANVAS_SIZE / 2, 55);

    ctxTracking.restore();

    // Draw dividers
    ctxTracking.strokeStyle = '#cbd5e1'; // Slate-300
    ctxTracking.lineWidth = 1;
    if (col > 0) {
      ctxTracking.beginPath();
      ctxTracking.moveTo(xOffset, yOffset);
      ctxTracking.lineTo(xOffset, yOffset + HERO_CANVAS_SIZE);
      ctxTracking.stroke();
    }
    if (row > 0) {
      ctxTracking.beginPath();
      ctxTracking.moveTo(xOffset, yOffset);
      ctxTracking.lineTo(xOffset + HERO_CANVAS_SIZE, yOffset);
      ctxTracking.stroke();
    }
  });

  writeFileSync('benchmarks/hero-eye-tracking.png', canvasTracking.toBuffer('image/png'));
  console.log('Saved benchmarks/hero-eye-tracking.png');

  // ---------------------------------------------------------------------------
  // Task 2: Eye Toggle (2 frames)
  // ---------------------------------------------------------------------------

  // 7. 1 eye (cyclops)
  let frame7 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame7 = stepHero(frame7, DT, { walkDx: 0, facing: 1, eyeCount: 1 });
  }

  // 8. 2 eyes
  let frame8 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    frame8 = stepHero(frame8, DT, { walkDx: 0, facing: 1, eyeCount: 2 });
  }

  const canvasToggle = createCanvas(640, 320);
  const ctxToggle = canvasToggle.getContext('2d');

  const panelsToggle = [
    { frame: frame7, tick: 30, look: { x: 1, y: 0 }, label: '7. 1 Eye (Cyclops)', subLabel: 'eyeCount: 1 | look: {1, 0}' },
    { frame: frame8, tick: 30, look: { x: 1, y: 0 }, label: '8. 2 Eyes', subLabel: 'eyeCount: 2 | look: {1, 0}' },
  ];

  panelsToggle.forEach((panel, index) => {
    const xOffset = index * HERO_CANVAS_SIZE;

    ctxToggle.save();
    ctxToggle.translate(xOffset, 0);

    // 1. Background
    ctxToggle.fillStyle = config.palette.background;
    ctxToggle.fillRect(0, 0, HERO_CANVAS_SIZE, HERO_CANVAS_SIZE);

    // 2. Ground line
    const groundY = HERO_GROUND_Y;
    ctxToggle.strokeStyle = config.palette.outline;
    ctxToggle.lineWidth = 1;
    ctxToggle.beginPath();
    ctxToggle.moveTo(0, groundY + 0.5);
    ctxToggle.lineTo(HERO_CANVAS_SIZE, groundY + 0.5);
    ctxToggle.stroke();

    // 3. Shadow
    ctxToggle.save();
    ctxToggle.fillStyle = config.palette.outline;
    ctxToggle.globalAlpha = 0.18;
    ctxToggle.beginPath();
    ctxToggle.ellipse(HERO_CANVAS_SIZE / 2, groundY + 2, 56, 8, 0, 0, Math.PI * 2);
    ctxToggle.fill();
    ctxToggle.restore();

    // 4. Character
    drawSlimeKnight(ctxToggle as any, panel.frame, panel.tick, panel.look);

    // 5. Label
    ctxToggle.fillStyle = config.palette.outline;
    ctxToggle.font = 'bold 14px sans-serif';
    ctxToggle.textAlign = 'center';
    ctxToggle.fillText(panel.label, HERO_CANVAS_SIZE / 2, 35);

    // 6. Sub-label
    ctxToggle.fillStyle = '#64748b'; // Slate-500
    ctxToggle.font = '10px sans-serif';
    ctxToggle.fillText(panel.subLabel, HERO_CANVAS_SIZE / 2, 55);

    ctxToggle.restore();

    // Draw divider
    if (index > 0) {
      ctxToggle.strokeStyle = '#cbd5e1'; // Slate-300
      ctxToggle.lineWidth = 1;
      ctxToggle.beginPath();
      ctxToggle.moveTo(xOffset, 0);
      ctxToggle.lineTo(xOffset, HERO_CANVAS_SIZE);
      ctxToggle.stroke();
    }
  });

  writeFileSync('benchmarks/hero-eye-toggle.png', canvasToggle.toBuffer('image/png'));
  console.log('Saved benchmarks/hero-eye-toggle.png');
}

renderEyeBenchmarks();
