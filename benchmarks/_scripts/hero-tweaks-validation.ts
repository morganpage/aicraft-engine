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
import { breathe, evaluateJump, evaluateLocomotion, DEFAULT_TUCK } from '../../src/animation';

function renderValidationComposites() {
  const seed = 98724;
  const config = deriveHeroConfig(seed);
  const DT = 1 / 60;

  console.log('Simulating frames for Composite 1 (Larger steps)...');

  // Composite 1: Larger steps (4 walk frames across a full stride cycle)
  // Frame 1: Widest crossing A (Tick 0, phase ≈ 0)
  let state1_1 = createHeroFrameState(config);
  state1_1 = stepHero(state1_1, DT, { walkDx: 1.5, facing: 1 }); // Tick 0 is after first step

  // Frame 2: Passing & Lift A (Tick 41, phase ≈ π/2)
  let state1_2 = createHeroFrameState(config);
  for (let i = 0; i <= 41; i++) {
    state1_2 = stepHero(state1_2, DT, { walkDx: 1.5, facing: 1 });
  }

  // Frame 3: Widest crossing B (Tick 84, phase ≈ π)
  let state1_3 = createHeroFrameState(config);
  for (let i = 0; i <= 84; i++) {
    state1_3 = stepHero(state1_3, DT, { walkDx: 1.5, facing: 1 });
  }

  // Frame 4: Passing & Lift B (Tick 126, phase ≈ 3π/2)
  let state1_4 = createHeroFrameState(config);
  for (let i = 0; i <= 126; i++) {
    state1_4 = stepHero(state1_4, DT, { walkDx: 1.5, facing: 1 });
  }

  console.log('Simulating frames for Composite 2 (Antenna base flush)...');

  // Composite 2: Antenna base flush (4 frames zoomed on the antenna-to-body junction)
  // Frame 1: Idle breath-stretch (Tick 40, scaleY = 1.0358)
  let state2_1 = createHeroFrameState(config);
  for (let i = 0; i < 40; i++) {
    state2_1 = stepHero(state2_1, DT, { walkDx: 0, facing: 1 });
  }

  // Frame 2: Idle breath-squash (Tick 56, scaleY = 0.9642)
  let state2_2 = createHeroFrameState(config);
  for (let i = 0; i < 56; i++) {
    state2_2 = stepHero(state2_2, DT, { walkDx: 0, facing: 1 });
  }

  // Frame 3: Walk midstride (Tick 44, walkDx: 1.5, facing: 1)
  let state2_3 = createHeroFrameState(config);
  for (let i = 0; i < 44; i++) {
    state2_3 = stepHero(state2_3, DT, { walkDx: 1.5, facing: 1 });
  }

  // Frame 4: Jump landing squash (Tick 69, scaleY = 0.715)
  let state2_4 = createHeroFrameState(config);
  for (let i = 0; i < 30; i++) {
    state2_4 = stepHero(state2_4, DT);
  }
  state2_4 = stepHero(state2_4, DT, { jumpPressed: true, jumpHeld: true });
  for (let i = 0; i < 25; i++) {
    state2_4 = stepHero(state2_4, DT, { jumpPressed: false, jumpHeld: true });
  }
  for (let i = 0; i < 13; i++) {
    state2_4 = stepHero(state2_4, DT, { jumpPressed: false, jumpHeld: false });
  }

  // ---------------------------------------------------------------------------
  // Render Composite 1: Larger steps
  // ---------------------------------------------------------------------------
  const headerHeight = 80;
  const panelSize = HERO_CANVAS_SIZE;
  const comp1Width = panelSize * 4;
  const comp1Height = panelSize + headerHeight;

  const canvas1 = createCanvas(comp1Width, comp1Height);
  const ctx1 = canvas1.getContext('2d');

  // Draw Header
  ctx1.fillStyle = '#0f172a'; // Slate-900
  ctx1.fillRect(0, 0, comp1Width, headerHeight);

  ctx1.fillStyle = '#ffffff';
  ctx1.font = 'bold 22px sans-serif';
  ctx1.fillText('Hero Larger Steps Stride Cycle (Seed: 98724)', 24, 38);

  ctx1.fillStyle = '#94a3b8'; // Slate-400
  ctx1.font = '13px sans-serif';
  ctx1.fillText('Verifying larger steps (12-18px stride, 4.5-7.5px lift) across a full walk cycle. Feet should swing clearly and lift off the ground.', 24, 60);

  const panels1 = [
    { state: state1_1, tick: 0, label: '1. Widest Crossing (Left Forward)', subLabel: 'Tick 0 | cos(phi) ≈ 1.0 | Feet at max splay' },
    { state: state1_2, tick: 41, label: '2. Passing & Lift (Left Lifted)', subLabel: 'Tick 41 | cos(phi) ≈ 0.0 | Left foot lifted high' },
    { state: state1_3, tick: 84, label: '3. Widest Crossing (Right Forward)', subLabel: 'Tick 84 | cos(phi) ≈ -1.0 | Feet at max splay' },
    { state: state1_4, tick: 126, label: '4. Passing & Lift (Right Lifted)', subLabel: 'Tick 126 | cos(phi) ≈ 0.0 | Right foot lifted high' },
  ];

  panels1.forEach((panel, index) => {
    const xOffset = index * panelSize;
    const yOffset = headerHeight;

    ctx1.save();
    ctx1.translate(xOffset, yOffset);

    // Background
    ctx1.fillStyle = '#1e293b'; // Slate-800
    ctx1.fillRect(0, 0, panelSize, panelSize);

    // Ground line
    ctx1.strokeStyle = '#475569'; // Slate-600
    ctx1.lineWidth = 2;
    ctx1.beginPath();
    ctx1.moveTo(0, HERO_GROUND_Y);
    ctx1.lineTo(panelSize, HERO_GROUND_Y);
    ctx1.stroke();

    // Shadow
    const shadowCx = panelSize / 2 + panel.state.x;
    const shadowCy = HERO_GROUND_Y + 2;
    ctx1.save();
    ctx1.fillStyle = '#010000';
    ctx1.globalAlpha = 0.3;
    ctx1.beginPath();
    ctx1.ellipse(shadowCx, shadowCy, 56, 8, 0, 0, Math.PI * 2);
    ctx1.fill();
    ctx1.restore();

    // Character
    drawSlimeKnight(ctx1 as any, panel.state, panel.tick);

    // Label
    ctx1.fillStyle = '#ffffff';
    ctx1.font = 'bold 14px sans-serif';
    ctx1.fillText(panel.label, 16, 30);

    // Sub-label
    ctx1.fillStyle = '#94a3b8';
    ctx1.font = '11px sans-serif';
    ctx1.fillText(panel.subLabel, 16, 48);

    ctx1.restore();

    // Grid line
    ctx1.strokeStyle = '#334155';
    ctx1.lineWidth = 1;
    ctx1.beginPath();
    ctx1.rect(xOffset, yOffset, panelSize, panelSize);
    ctx1.stroke();
  });

  const destPath1 = 'benchmarks/hero-larger-steps.png';
  writeFileSync(destPath1, canvas1.toBuffer('image/png'));
  console.log(`Saved Composite 1 to ${destPath1}`);

  // ---------------------------------------------------------------------------
  // Render Composite 2: Antenna base flush (Zoomed 3x)
  // ---------------------------------------------------------------------------
  const canvas2 = createCanvas(comp1Width, comp1Height);
  const ctx2 = canvas2.getContext('2d');

  // Draw Header
  ctx2.fillStyle = '#0f172a'; // Slate-900
  ctx2.fillRect(0, 0, comp1Width, headerHeight);

  ctx2.fillStyle = '#ffffff';
  ctx2.font = 'bold 22px sans-serif';
  ctx2.fillText('Hero Antenna-to-Body Junction (Seed: 98724, Zoomed 3.5x)', 24, 38);

  ctx2.fillStyle = '#94a3b8'; // Slate-400
  ctx2.font = '13px sans-serif';
  ctx2.fillText('Verifying antenna base is flush with the body top (no gaps or floating) across breath, walk, and landing squash.', 24, 60);

  const panels2 = [
    { state: state2_1, tick: 40, label: '1. Idle Breath-Stretch', subLabel: 'Tick 40 | scaleY ≈ 1.036 | Body tall' },
    { state: state2_2, tick: 56, label: '2. Idle Breath-Squash', subLabel: 'Tick 56 | scaleY ≈ 0.964 | Body short' },
    { state: state2_3, tick: 44, label: '3. Walk Midstride', subLabel: 'Tick 44 | Walk Right | Hip sway tracking' },
    { state: state2_4, tick: 69, label: '4. Jump Landing Squash', subLabel: 'Tick 69 | scaleY ≈ 0.715 | Max squash impact' },
  ];

  panels2.forEach((panel, index) => {
    const xOffset = index * panelSize;
    const yOffset = headerHeight;

    ctx2.save();
    ctx2.translate(xOffset, yOffset);

    // Clip to panel bounds
    ctx2.beginPath();
    ctx2.rect(0, 0, panelSize, panelSize);
    ctx2.clip();

    // Background
    ctx2.fillStyle = '#1e293b'; // Slate-800
    ctx2.fillRect(0, 0, panelSize, panelSize);

    // Calculate antenna base position to center the zoom on it
    const pose = evaluateLocomotion(panel.state.locomotion, config.gaitConfig);
    const jumpPose = evaluateJump(panel.state.jump);
    const breath = breathe(panel.tick, config.breathConfig);
    const composedScaleY = breath.scaleY * jumpPose.scale.scaleY;
    const jumpLift = jumpPose.yOffset + DEFAULT_TUCK.hipRaise * jumpPose.airborneBlend;
    const bodyCx = HERO_CANVAS_SIZE / 2 + panel.state.x + pose.hipOffset.x;
    const bodyCy = (HERO_GROUND_Y - config.bodyHeight / 2 - (config.boneLengths.thigh + config.boneLengths.shin) * 0.9) + pose.hipOffset.y + jumpLift;
    const jumpScaleY = jumpPose.scale.scaleY;
    const landingDrop = jumpScaleY < 1 ? (1 - jumpScaleY) * config.bodyHeight : 0;
    const effectiveBodyCy = bodyCy + landingDrop;
    const antennaBaseX = bodyCx;
    const antennaBaseY = effectiveBodyCy - (config.bodyHeight / 2) * composedScaleY;

    // Draw zoomed character
    ctx2.save();
    const zoom = 3.5;
    ctx2.translate(panelSize / 2, panelSize / 2);
    ctx2.scale(zoom, zoom);
    ctx2.translate(-antennaBaseX, -antennaBaseY + 15); // Offset slightly down to show more of the body top
    drawSlimeKnight(ctx2 as any, panel.state, panel.tick);
    ctx2.restore();

    // Draw a small crosshair or guide line at the junction to help verify alignment
    ctx2.strokeStyle = 'rgba(239, 68, 68, 0.4)'; // Red guide line
    ctx2.lineWidth = 1;
    ctx2.beginPath();
    ctx2.moveTo(panelSize / 2 - 20, panelSize / 2 + 15);
    ctx2.lineTo(panelSize / 2 + 20, panelSize / 2 + 15);
    ctx2.stroke();

    // Label
    ctx2.fillStyle = '#ffffff';
    ctx2.font = 'bold 14px sans-serif';
    ctx2.fillText(panel.label, 16, 30);

    // Sub-label
    ctx2.fillStyle = '#94a3b8';
    ctx2.font = '11px sans-serif';
    ctx2.fillText(panel.subLabel, 16, 48);

    ctx2.restore();

    // Grid line
    ctx2.strokeStyle = '#334155';
    ctx2.lineWidth = 1;
    ctx2.beginPath();
    ctx2.rect(xOffset, yOffset, panelSize, panelSize);
    ctx2.stroke();
  });

  const destPath2 = 'benchmarks/hero-antenna-attached.png';
  writeFileSync(destPath2, canvas2.toBuffer('image/png'));
  console.log(`Saved Composite 2 to ${destPath2}`);
}

renderValidationComposites();
