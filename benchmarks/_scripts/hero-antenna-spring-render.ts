import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  deriveHeroConfig,
  createHeroFrameState,
  stepHero,
  drawSlimeKnight,
  HERO_CANVAS_SIZE,
  HERO_GROUND_Y,
} from '../../showcase/helpers/slime-knight';
import { breathe, evaluateJump, evaluateLocomotion, DEFAULT_TUCK } from '../../src/animation';

function renderAntennaSpringBenchmarks() {
  const seed = 98724;
  const config = deriveHeroConfig(seed);
  const DT = 1 / 60;

  // Ensure output directory exists
  mkdirSync('benchmarks', { recursive: true });

  const headerHeight = 80;
  const panelSize = HERO_CANVAS_SIZE;

  // ---------------------------------------------------------------------------
  // Composite 1: Walk cycle bounce
  // ---------------------------------------------------------------------------
  console.log('Simulating Walk Cycle Bounce (Composite 1)...');
  const walkFrames: { frame: any; tick: number; label: string; subLabel: string }[] = [];
  let walkState = createHeroFrameState(config);

  // We want to collect frames at specific ticks:
  // 0 (idle), 30 (max velocity), 60 (mid-stride), 90 (mid-stride), 120 (mid-stride), 142 (before wrap), 144 (after wrap), 150 (settling)
  const targetWalkTicks = [0, 30, 60, 90, 120, 142, 144, 150];
  const walkLabels = [
    '1. Idle Rest Pose',
    '2. Walk Start (Lag)',
    '3. Mid-stride A (Lag)',
    '4. Mid-stride B (Lag)',
    '5. Mid-stride C (Lag)',
    '6. Before Wrap (Lag)',
    '7. After Wrap (Whip)',
    '8. Settling (Swing)',
  ];
  const walkSubLabels = [
    'Tick 0 | Rest pose | Leaning forward',
    'Tick 30 | Max velocity | Ball trailing back',
    'Tick 60 | Mid-stride | Ball trailing back',
    'Tick 90 | Mid-stride | Ball trailing back',
    'Tick 120 | Mid-stride | Ball trailing back',
    'Tick 142 | Just before wrap | Ball trailing',
    'Tick 144 | Just after wrap | Ball whips forward',
    'Tick 150 | Settling | Ball swinging forward',
  ];

  for (let tick = 0; tick <= 150; tick++) {
    const idx = targetWalkTicks.indexOf(tick);
    if (idx !== -1) {
      walkFrames.push({
        frame: { ...walkState },
        tick,
        label: walkLabels[idx],
        subLabel: walkSubLabels[idx],
      });
    }
    walkState = stepHero(walkState, DT, { walkDx: 1.5, facing: 1 });
  }

  // Render Composite 1 (4x2 grid)
  const comp1Width = panelSize * 4;
  const comp1Height = panelSize * 2 + headerHeight;
  const canvas1 = createCanvas(comp1Width, comp1Height);
  const ctx1 = canvas1.getContext('2d');

  // Draw Header
  ctx1.fillStyle = '#0f172a'; // Slate-900
  ctx1.fillRect(0, 0, comp1Width, headerHeight);
  ctx1.fillStyle = '#ffffff';
  ctx1.font = 'bold 22px sans-serif';
  ctx1.fillText('Hero Antenna Walk Cycle Bounce (Seed: 98724, Zoomed 1.6x)', 24, 38);
  ctx1.fillStyle = '#94a3b8'; // Slate-400
  ctx1.font = '13px sans-serif';
  ctx1.fillText('Verifying antenna springiness and ball lag during walk, plus forward swing/whip on wrap/turn.', 24, 60);

  walkFrames.forEach((panel, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    const xOffset = col * panelSize;
    const yOffset = headerHeight + row * panelSize;

    ctx1.save();
    ctx1.translate(xOffset, yOffset);

    // Clip to panel bounds
    ctx1.beginPath();
    ctx1.rect(0, 0, panelSize, panelSize);
    ctx1.clip();

    // Background
    ctx1.fillStyle = config.palette.background;
    ctx1.fillRect(0, 0, panelSize, panelSize);

    // Ground line (unzoomed/zoomed)
    ctx1.strokeStyle = config.palette.outline;
    ctx1.lineWidth = 1;
    ctx1.beginPath();
    ctx1.moveTo(0, HERO_GROUND_Y + 0.5);
    ctx1.lineTo(panelSize, HERO_GROUND_Y + 0.5);
    ctx1.stroke();

    // Center the character for drawing by setting x = 0 and shifting antenna nodes
    const drawFrame = {
      ...panel.frame,
      x: 0,
      antenna: panel.frame.antenna.map((node: any) => ({
        ...node,
        x: node.x - panel.frame.x,
        y: node.y,
        prevX: node.prevX - panel.frame.x,
        prevY: node.prevY,
      })),
    };

    // Calculate antenna base position to center the zoom on it
    const pose = evaluateLocomotion(drawFrame.locomotion, config.gaitConfig);
    const jumpPose = evaluateJump(drawFrame.jump);
    const breath = breathe(panel.tick, config.breathConfig);
    const composedScaleY = breath.scaleY * jumpPose.scale.scaleY;
    const jumpLift = jumpPose.yOffset + DEFAULT_TUCK.hipRaise * jumpPose.airborneBlend;
    const bodyCx = HERO_CANVAS_SIZE / 2 + drawFrame.x + pose.hipOffset.x;
    const bodyCy = (HERO_GROUND_Y - config.bodyHeight / 2 - (config.boneLengths.thigh + config.boneLengths.shin) * 0.9) + pose.hipOffset.y + jumpLift;
    const jumpScaleY = jumpPose.scale.scaleY;
    const landingDrop = jumpScaleY < 1 ? (1 - jumpScaleY) * config.bodyHeight : 0;
    const effectiveBodyCy = bodyCy + landingDrop;
    const antennaBaseX = bodyCx;
    const antennaBaseY = effectiveBodyCy - (config.bodyHeight / 2) * composedScaleY;

    // Draw zoomed character
    ctx1.save();
    const zoom = 1.6;
    ctx1.translate(panelSize / 2, panelSize / 2);
    ctx1.scale(zoom, zoom);
    ctx1.translate(-antennaBaseX, -antennaBaseY + 35); // Offset down to show antenna + body top
    drawSlimeKnight(ctx1 as any, drawFrame, panel.tick);
    ctx1.restore();

    // Label
    ctx1.fillStyle = config.palette.outline;
    ctx1.font = 'bold 14px sans-serif';
    ctx1.fillText(panel.label, 16, 30);

    // Sub-label
    ctx1.fillStyle = '#64748b';
    ctx1.font = '11px sans-serif';
    ctx1.fillText(panel.subLabel, 16, 48);

    ctx1.restore();

    // Grid line
    ctx1.strokeStyle = '#cbd5e1';
    ctx1.lineWidth = 1;
    ctx1.beginPath();
    ctx1.rect(xOffset, yOffset, panelSize, panelSize);
    ctx1.stroke();
  });

  const destPath1 = 'benchmarks/hero-antenna-spring-walk.png';
  writeFileSync(destPath1, canvas1.toBuffer('image/png'));
  console.log(`Saved Composite 1 to ${destPath1}`);


  // ---------------------------------------------------------------------------
  // Composite 2: Jump landing bounce
  // ---------------------------------------------------------------------------
  console.log('Simulating Jump Landing Bounce (Composite 2)...');
  const jumpFrames: { frame: any; tick: number; label: string; subLabel: string }[] = [];
  let jumpState = createHeroFrameState(config);

  // Settle for 30 ticks
  for (let i = 0; i < 30; i++) {
    jumpState = stepHero(jumpState, DT);
  }

  // Trigger jump
  jumpState = stepHero(jumpState, DT, { jumpPressed: true, jumpHeld: true });
  let currentTick = 31;

  const targetJumpTicks = [30, 37, 51, 67, 69, 73, 78, 88];
  const jumpLabels = [
    '1. Pre-jump (Idle)',
    '2. Launch / Rising',
    '3. Mid-air Apex',
    '4. Just Before Landing',
    '5. Landing Impact',
    '6. Landing Squash',
    '7. Rebound 1',
    '8. Rebound 2',
  ];
  const jumpSubLabels = [
    'Tick 30 | Grounded | Ball slightly sagged',
    'Tick 37 | Rising | Ball whipped down/back',
    'Tick 51 | Apex | Ball settling',
    'Tick 67 | Falling | Ball lagging high',
    'Tick 69 | Impact | Ball lagging high',
    'Tick 73 | Max Squash | Ball whips down',
    'Tick 78 | Grounded | Ball rebounding up',
    'Tick 88 | Grounded | Ball rebounding up',
  ];

  // Settle frame is tick 30 (before jump trigger)
  // Let's collect the frames
  let tempState = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    tempState = stepHero(tempState, DT);
  }
  jumpFrames.push({
    frame: { ...tempState },
    tick: 30,
    label: jumpLabels[0],
    subLabel: jumpSubLabels[0],
  });

  // Now simulate the jump
  for (let i = 0; i < 80; i++) {
    const tick = 31 + i;
    const idx = targetJumpTicks.indexOf(tick);
    if (idx !== -1) {
      jumpFrames.push({
        frame: { ...jumpState },
        tick,
        label: jumpLabels[idx],
        subLabel: jumpSubLabels[idx],
      });
    }
    const inputs = i < 25 ? { jumpPressed: false, jumpHeld: true } : { jumpPressed: false, jumpHeld: false };
    jumpState = stepHero(jumpState, DT, inputs);
  }

  // Render Composite 2 (4x2 grid)
  const canvas2 = createCanvas(comp1Width, comp1Height);
  const ctx2 = canvas2.getContext('2d');

  // Draw Header
  ctx2.fillStyle = '#0f172a'; // Slate-900
  ctx2.fillRect(0, 0, comp1Width, headerHeight);
  ctx2.fillStyle = '#ffffff';
  ctx2.font = 'bold 22px sans-serif';
  ctx2.fillText('Hero Antenna Jump Landing Bounce (Seed: 98724, Zoomed 1.6x)', 24, 38);
  ctx2.fillStyle = '#94a3b8'; // Slate-400
  ctx2.font = '13px sans-serif';
  ctx2.fillText('Verifying antenna whip and ball bounce on landing impact (downward overshoot and rebound).', 24, 60);

  jumpFrames.forEach((panel, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    const xOffset = col * panelSize;
    const yOffset = headerHeight + row * panelSize;

    ctx2.save();
    ctx2.translate(xOffset, yOffset);

    // Clip to panel bounds
    ctx2.beginPath();
    ctx2.rect(0, 0, panelSize, panelSize);
    ctx2.clip();

    // Background
    ctx2.fillStyle = config.palette.background;
    ctx2.fillRect(0, 0, panelSize, panelSize);

    // Ground line
    ctx2.strokeStyle = config.palette.outline;
    ctx2.lineWidth = 1;
    ctx2.beginPath();
    ctx2.moveTo(0, HERO_GROUND_Y + 0.5);
    ctx2.lineTo(panelSize, HERO_GROUND_Y + 0.5);
    ctx2.stroke();

    // Calculate antenna base position to center the zoom on it
    const pose = evaluateLocomotion(panel.frame.locomotion, config.gaitConfig);
    const jumpPose = evaluateJump(panel.frame.jump);
    const breath = breathe(panel.tick, config.breathConfig);
    const composedScaleY = breath.scaleY * jumpPose.scale.scaleY;
    const jumpLift = jumpPose.yOffset + DEFAULT_TUCK.hipRaise * jumpPose.airborneBlend;
    const bodyCx = HERO_CANVAS_SIZE / 2 + panel.frame.x + pose.hipOffset.x;
    const bodyCy = (HERO_GROUND_Y - config.bodyHeight / 2 - (config.boneLengths.thigh + config.boneLengths.shin) * 0.9) + pose.hipOffset.y + jumpLift;
    const jumpScaleY = jumpPose.scale.scaleY;
    const landingDrop = jumpScaleY < 1 ? (1 - jumpScaleY) * config.bodyHeight : 0;
    const effectiveBodyCy = bodyCy + landingDrop;
    const antennaBaseX = bodyCx;
    const antennaBaseY = effectiveBodyCy - (config.bodyHeight / 2) * composedScaleY;

    // Draw zoomed character
    ctx2.save();
    const zoom = 1.6;
    ctx2.translate(panelSize / 2, panelSize / 2);
    ctx2.scale(zoom, zoom);
    ctx2.translate(-antennaBaseX, -antennaBaseY + 35); // Offset down to show antenna + body top
    drawSlimeKnight(ctx2 as any, panel.frame, panel.tick);
    ctx2.restore();

    // Label
    ctx2.fillStyle = config.palette.outline;
    ctx2.font = 'bold 14px sans-serif';
    ctx2.fillText(panel.label, 16, 30);

    // Sub-label
    ctx2.fillStyle = '#64748b';
    ctx2.font = '11px sans-serif';
    ctx2.fillText(panel.subLabel, 16, 48);

    ctx2.restore();

    // Grid line
    ctx2.strokeStyle = '#cbd5e1';
    ctx2.lineWidth = 1;
    ctx2.beginPath();
    ctx2.rect(xOffset, yOffset, panelSize, panelSize);
    ctx2.stroke();
  });

  const destPath2 = 'benchmarks/antenna-spring-jump.png';
  writeFileSync(destPath2, canvas2.toBuffer('image/png'));
  console.log(`Saved Composite 2 to ${destPath2}`);


  // ---------------------------------------------------------------------------
  // Composite 3: Rest pose forward lean
  // ---------------------------------------------------------------------------
  console.log('Simulating Rest Pose Forward Lean (Composite 3)...');
  let restStateRight = createHeroFrameState(config);
  let restStateLeft = createHeroFrameState(config);

  // Settle both for 30 ticks
  for (let i = 0; i < 30; i++) {
    restStateRight = stepHero(restStateRight, DT, { walkDx: 0, facing: 1 });
    restStateLeft = stepHero(restStateLeft, DT, { walkDx: 0, facing: -1 });
  }

  // Render Composite 3 (2x1 grid)
  const comp3Width = panelSize * 2;
  const comp3Height = panelSize + headerHeight;
  const canvas3 = createCanvas(comp3Width, comp3Height);
  const ctx3 = canvas3.getContext('2d');

  // Draw Header
  ctx3.fillStyle = '#0f172a'; // Slate-900
  ctx3.fillRect(0, 0, comp3Width, headerHeight);
  ctx3.fillStyle = '#ffffff';
  ctx3.font = 'bold 22px sans-serif';
  ctx3.fillText('Hero Antenna Rest Pose Forward Lean (Seed: 98724, Zoomed 1.6x)', 24, 38);
  ctx3.fillStyle = '#94a3b8'; // Slate-400
  ctx3.font = '13px sans-serif';
  ctx3.fillText('Verifying antenna forward lean (~12.4°) and subtle ball sag at rest for both facing directions.', 24, 60);

  const restPanels = [
    {
      frame: restStateRight,
      tick: 30,
      label: '1. Facing Right (facing: 1)',
      subLabel: 'Tick 30 | Antenna leans forward (right, screen-space)',
    },
    {
      frame: restStateLeft,
      tick: 30,
      label: '2. Facing Left (facing: -1)',
      subLabel: 'Tick 30 | Antenna leans forward (left, screen-space)',
    },
  ];

  restPanels.forEach((panel, index) => {
    const xOffset = index * panelSize;
    const yOffset = headerHeight;

    ctx3.save();
    ctx3.translate(xOffset, yOffset);

    // Clip to panel bounds
    ctx3.beginPath();
    ctx3.rect(0, 0, panelSize, panelSize);
    ctx3.clip();

    // Background
    ctx3.fillStyle = config.palette.background;
    ctx3.fillRect(0, 0, panelSize, panelSize);

    // Ground line
    ctx3.strokeStyle = config.palette.outline;
    ctx3.lineWidth = 1;
    ctx3.beginPath();
    ctx3.moveTo(0, HERO_GROUND_Y + 0.5);
    ctx3.lineTo(panelSize, HERO_GROUND_Y + 0.5);
    ctx3.stroke();

    // Calculate antenna base position to center the zoom on it
    const pose = evaluateLocomotion(panel.frame.locomotion, config.gaitConfig);
    const jumpPose = evaluateJump(panel.frame.jump);
    const breath = breathe(panel.tick, config.breathConfig);
    const composedScaleY = breath.scaleY * jumpPose.scale.scaleY;
    const jumpLift = jumpPose.yOffset + DEFAULT_TUCK.hipRaise * jumpPose.airborneBlend;
    const bodyCx = HERO_CANVAS_SIZE / 2 + panel.frame.x + pose.hipOffset.x;
    const bodyCy = (HERO_GROUND_Y - config.bodyHeight / 2 - (config.boneLengths.thigh + config.boneLengths.shin) * 0.9) + pose.hipOffset.y + jumpLift;
    const jumpScaleY = jumpPose.scale.scaleY;
    const landingDrop = jumpScaleY < 1 ? (1 - jumpScaleY) * config.bodyHeight : 0;
    const effectiveBodyCy = bodyCy + landingDrop;
    const antennaBaseX = bodyCx;
    const antennaBaseY = effectiveBodyCy - (config.bodyHeight / 2) * composedScaleY;

    // Draw zoomed character
    ctx3.save();
    const zoom = 1.6;
    ctx3.translate(panelSize / 2, panelSize / 2);
    ctx3.scale(zoom, zoom);
    ctx3.translate(-antennaBaseX, -antennaBaseY + 35); // Offset down to show antenna + body top
    drawSlimeKnight(ctx3 as any, panel.frame, panel.tick);
    ctx3.restore();

    // Label
    ctx3.fillStyle = config.palette.outline;
    ctx3.font = 'bold 14px sans-serif';
    ctx3.fillText(panel.label, 16, 30);

    // Sub-label
    ctx3.fillStyle = '#64748b';
    ctx3.font = '11px sans-serif';
    ctx3.fillText(panel.subLabel, 16, 48);

    ctx3.restore();

    // Grid line
    ctx3.strokeStyle = '#cbd5e1';
    ctx3.lineWidth = 1;
    ctx3.beginPath();
    ctx3.rect(xOffset, yOffset, panelSize, panelSize);
    ctx3.stroke();
  });

  const destPath3 = 'benchmarks/hero-antenna-spring-rest.png';
  writeFileSync(destPath3, canvas3.toBuffer('image/png'));
  console.log(`Saved Composite 3 to ${destPath3}`);
}

renderAntennaSpringBenchmarks();
