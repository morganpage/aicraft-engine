import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  solveLimb,
  blendAirborneTuck,
  DEFAULT_TUCK,
  evaluateLocomotion,
  advanceLocomotionByDisplacement,
  createJumpState,
  advanceJump,
  evaluateJump,
  DEFAULT_JUMP,
} from '../../src/animation';
import type { Vec2, VerletNode } from '../../src/animation';
import { deriveHeroConfig } from '../../showcase/helpers/slime-knight';
import type { HeroConfig } from '../../showcase/helpers/slime-knight';
import type { Palette } from '../../src/palette';

const OUTPUT_DIR = 'benchmarks/animation';
const BACKGROUND_COLOR = '#f1f5f9'; // Slate-100: clean, high-contrast neutral background

// Custom draw helpers to allow precise control over alpha, squash/stretch, and tucking
function roundRectPathCustom(
  ctx: any,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawLimbCustom(
  ctx: any,
  hip: Vec2,
  foot: Vec2,
  thighLen: number,
  shinLen: number,
  bendDir: number,
  palette: Palette,
): void {
  const solve = solveLimb(hip, foot, thighLen, shinLen, { bendDir });
  const knee = solve.jointPos;
  const ankle = solve.endPos;

  // Outline pass
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(hip.x, hip.y);
  ctx.lineTo(knee.x, knee.y);
  ctx.lineTo(ankle.x, ankle.y);
  ctx.stroke();

  // Accent fill
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(hip.x, hip.y);
  ctx.lineTo(knee.x, knee.y);
  ctx.lineTo(ankle.x, ankle.y);
  ctx.stroke();

  // Shoe
  const shoeW = 18;
  const shoeH = 10;
  ctx.fillStyle = palette.accent;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 3;
  roundRectPathCustom(ctx, ankle.x - shoeW * 0.65, ankle.y - shoeH / 2, shoeW, shoeH, 3);
  ctx.fill();
  ctx.stroke();
}

function drawAntennaCustom(
  ctx: any,
  bodyCx: number,
  bodyCy: number,
  config: HeroConfig,
  palette: Palette,
): void {
  const anchorX = bodyCx;
  const anchorY = bodyCy - config.bodyHeight / 2;
  const nodes: VerletNode[] = [];
  for (let i = 0; i < config.antennaSegments; i++) {
    const y = anchorY - i * config.antennaSegmentLength;
    nodes.push({ x: anchorX, y, prevX: anchorX, prevY: y });
  }

  if (nodes.length < 2) return;

  // Outline pass
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  for (let i = 1; i < nodes.length; i++) ctx.lineTo(nodes[i].x, nodes[i].y);
  ctx.stroke();

  // Core
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  for (let i = 1; i < nodes.length; i++) ctx.lineTo(nodes[i].x, nodes[i].y);
  ctx.stroke();

  // Tip ball
  const tip = nodes[nodes.length - 1];
  const ballR = 5;
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, ballR, 0, Math.PI * 2);
  ctx.fillStyle = palette.accent;
  ctx.fill();
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawSlimeKnightCustom(
  ctx: any,
  x: number,
  y: number,
  phase: number,
  yOffset: number,
  airborneBlend: number,
  scale: { scaleX: number; scaleY: number },
  alpha: number,
  config: HeroConfig,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;

  const palette = config.palette;
  const pose = evaluateLocomotion({ phase }, config.gaitConfig);

  // Apply airborne tuck to the foot offsets
  const blendedLeftOffset = blendAirborneTuck(pose.leftFootOffset, airborneBlend, DEFAULT_TUCK);
  const blendedRightOffset = blendAirborneTuck(pose.rightFootOffset, airborneBlend, DEFAULT_TUCK);

  // Hip raises slightly when airborne
  const hipRaise = DEFAULT_TUCK.hipRaise * airborneBlend;

  // Body center position
  const reach = (config.boneLengths.thigh + config.boneLengths.shin) * 0.9;
  const restBodyCenterY = y - config.bodyHeight / 2 - reach;

  const bodyCx = x + pose.hipOffset.x;
  const bodyCy = restBodyCenterY + pose.hipOffset.y + yOffset + hipRaise;

  // Hip positions
  const hipY = bodyCy + config.bodyHeight / 2;
  const hipLeftX = bodyCx - config.bodyWidth * 0.22;
  const hipRightX = bodyCx + config.bodyWidth * 0.22;

  // Foot positions
  const leftFoot = {
    x: hipLeftX + blendedLeftOffset.x,
    y: y - blendedLeftOffset.y + yOffset,
  };
  const rightFoot = {
    x: hipRightX + blendedRightOffset.x,
    y: y - blendedRightOffset.y + yOffset,
  };

  // 1. Draw Legs
  //    bendDir = -1 → knees point RIGHT (the platformer convention: un-mirrored
  //    = facing right). Matches the showcase's drawSlimeKnight facing fix so
  //    Panel A (walk rightward) reads as forward-right motion, not a moonwalk.
  drawLimbCustom(ctx, { x: hipLeftX, y: hipY }, leftFoot, config.boneLengths.thigh, config.boneLengths.shin, -1, palette);
  drawLimbCustom(ctx, { x: hipRightX, y: hipY }, rightFoot, config.boneLengths.thigh, config.boneLengths.shin, -1, palette);

  // 2. Draw Body
  ctx.save();
  ctx.translate(bodyCx, bodyCy);
  ctx.scale(scale.scaleX, scale.scaleY);

  const w = config.bodyWidth;
  const h = config.bodyHeight;
  const r = Math.min(w, h) * 0.2;
  roundRectPathCustom(ctx, -w / 2, -h / 2, w, h, r);
  ctx.fillStyle = palette.base;
  ctx.fill();
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 3;
  ctx.stroke();

  // 3. Draw Eye
  const eyeCx = 0;
  const eyeCy = -config.bodyHeight * 0.12;
  const eyeR = config.eyeRadius;

  ctx.beginPath();
  ctx.arc(eyeCx, eyeCy, eyeR, 0, Math.PI * 2);
  ctx.fillStyle = palette.feature;
  ctx.fill();
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 3;
  ctx.stroke();

  const pupilR = eyeR * 0.42;
  ctx.beginPath();
  ctx.arc(eyeCx, eyeCy, pupilR, 0, Math.PI * 2);
  ctx.fillStyle = palette.outline;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(eyeCx - pupilR * 0.45, eyeCy - pupilR * 0.45, Math.max(1, pupilR * 0.35), 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.restore();

  // 4. Draw Antenna
  drawAntennaCustom(ctx, bodyCx, bodyCy, config, palette);

  ctx.restore();
}

function drawShadowCustom(
  ctx: any,
  x: number,
  y: number,
  scaleX: number,
  alpha: number,
  outlineColor: string,
): void {
  ctx.save();
  ctx.fillStyle = outlineColor;
  ctx.globalAlpha = alpha * 0.18;
  ctx.beginPath();
  ctx.ellipse(x, y + 2, 56 * scaleX, 8 * scaleX, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function main() {
  console.log('Generating locomotion-walk-jump benchmark PNG...');

  const canvas = createCanvas(1024, 400);
  const ctx = canvas.getContext('2d');

  // Fill background
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, 1024, 400);

  // Draw panel divider
  ctx.strokeStyle = '#cbd5e1'; // Slate-300
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(512, 0);
  ctx.lineTo(512, 400);
  ctx.stroke();

  // Ground line across both panels
  const groundY = 320;
  ctx.strokeStyle = '#94a3b8'; // Slate-400
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, groundY);
  ctx.lineTo(1004, groundY);
  ctx.stroke();

  // Derive hero config for seed 98724
  const baseConfig = deriveHeroConfig(98724);

  // ---------------------------------------------------------------------------
  // PANEL A: Walk-across (displacement-driven locomotion)
  // ---------------------------------------------------------------------------
  const dx = 60;
  const customStrideLength = (3 * dx) / (Math.PI * Math.PI); // ~18.24px
  const customGait = {
    ...baseConfig.gaitConfig,
    strideLength: customStrideLength,
    strideHeight: 12,
    hipBobHeight: 5,
    hipSwayWidth: 3,
  };
  const walkConfig = {
    ...baseConfig,
    gaitConfig: customGait,
  };

  const walkPositions = [
    { x: 45, alpha: 0.15 },
    { x: 105, alpha: 0.20 },
    { x: 165, alpha: 0.25 },
    { x: 225, alpha: 0.35 },
    { x: 285, alpha: 0.45 },
    { x: 345, alpha: 0.60 },
    { x: 405, alpha: 0.80 },
    { x: 465, alpha: 1.0 },
  ];

  let locoState = { phase: 0 };

  // Draw Panel A shadows first
  for (let i = 0; i < walkPositions.length; i++) {
    const pos = walkPositions[i];
    drawShadowCustom(ctx, pos.x, groundY, 1.0, pos.alpha, walkConfig.palette.outline);
  }

  // Draw Panel A characters
  for (let i = 0; i < walkPositions.length; i++) {
    const pos = walkPositions[i];
    drawSlimeKnightCustom(
      ctx,
      pos.x,
      groundY,
      locoState.phase,
      0, // yOffset
      0, // airborneBlend
      { scaleX: 1, scaleY: 1 },
      pos.alpha,
      walkConfig,
    );

    // Advance phase for next position
    locoState = advanceLocomotionByDisplacement(locoState, dx, customGait);
  }

  // Panel A Labels
  ctx.fillStyle = '#1e293b'; // Slate-800
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('Panel A: Displacement-driven walk (no foot sliding)', 20, 35);
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#64748b'; // Slate-500
  ctx.fillText('Phase advances in sync with horizontal displacement. Feet plant perfectly.', 20, 55);

  // ---------------------------------------------------------------------------
  // PANEL B: Jump arc
  // ---------------------------------------------------------------------------
  const jumpConfig = DEFAULT_JUMP;
  let jumpState = createJumpState(jumpConfig);
  const dt = 1 / 60;

  // Run the actual jump simulation to capture exact frame states
  const simulatedFrames: { yOffset: number; airborneBlend: number; scale: { scaleX: number; scaleY: number } }[] = [];
  let currentY = 0;

  for (let frame = 0; frame <= 45; frame++) {
    const isGrounded = frame === 0 || (currentY >= 0 && frame > 5);
    const inputs = {
      jumpPressed: frame === 0,
      jumpHeld: true,
      isGrounded,
    };
    jumpState = advanceJump(jumpState, inputs, dt, jumpConfig);
    const pose = evaluateJump(jumpState);
    currentY = pose.yOffset;

    simulatedFrames.push({
      yOffset: Math.min(0, pose.yOffset), // snap positive landing offsets to 0
      airborneBlend: jumpState.airborneBlend,
      scale: { scaleX: pose.scale.scaleX, scaleY: pose.scale.scaleY },
    });
  }

  // Key frames to draw along the horizontal span of Panel B
  const jumpPositions = [
    { frame: 0, x: 512 + 45, alpha: 0.15, label: 'Grounded' },
    { frame: 3, x: 512 + 105, alpha: 0.25, label: 'Anticipate' },
    { frame: 4, x: 512 + 165, alpha: 0.35, label: 'Launch' },
    { frame: 12, x: 512 + 225, alpha: 0.50, label: 'Rise' },
    { frame: 20, x: 512 + 285, alpha: 0.70, label: 'Apex' },
    { frame: 30, x: 512 + 345, alpha: 0.85, label: 'Fall' },
    { frame: 38, x: 512 + 405, alpha: 0.95, label: 'Land Squash' },
    { frame: 45, x: 512 + 465, alpha: 1.0, label: 'Recovery' },
  ];

  // Draw Panel B shadows first
  for (const pos of jumpPositions) {
    const frameData = simulatedFrames[pos.frame];
    const heightFactor = Math.max(0, 1 + frameData.yOffset / 150);
    const shadowScale = frameData.scale.scaleX * heightFactor;
    const shadowAlpha = pos.alpha * heightFactor;
    drawShadowCustom(ctx, pos.x, groundY, shadowScale, shadowAlpha, baseConfig.palette.outline);
  }

  // Draw Panel B characters
  for (const pos of jumpPositions) {
    const frameData = simulatedFrames[pos.frame];
    drawSlimeKnightCustom(
      ctx,
      pos.x,
      groundY,
      0, // idle phase during jump
      frameData.yOffset,
      frameData.airborneBlend,
      frameData.scale,
      pos.alpha,
      baseConfig,
    );

    // Draw a small label under each jump pose to document the phase
    ctx.save();
    ctx.globalAlpha = pos.alpha;
    ctx.fillStyle = '#475569'; // Slate-600
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(pos.label, pos.x, groundY + 35);
    ctx.restore();
  }

  // Panel B Labels
  ctx.fillStyle = '#1e293b'; // Slate-800
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('Panel B: Apex-parameterized jump (coyote + buffer + variable height + landing squash)', 532, 35);
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#64748b'; // Slate-500
  ctx.fillText('Full jump arc: anticipation crouch → launch stretch → rise with tuck → apex → fall → land squash → recovery.', 532, 55);

  // Save composite image
  const destPath = join(OUTPUT_DIR, 'locomotion-walk-jump.png');
  writeFileSync(destPath, canvas.toBuffer('image/png'));
  console.log(`Saved locomotion-walk-jump benchmark PNG to ${destPath}`);
}

main();
