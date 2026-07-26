/**
 * Single-leg diagnostic: renders one rear leg's behavior over time at
 * multiple speeds and both facings, showing foot position, extension ratio,
 * and step targets as a visual timeline.
 */
import { createCanvas } from 'canvas';
import {
  createSpiderState,
  stepSpider,
  evaluateSpiderPose,
  getGaitFootPosition,
  DEFAULT_SPIDER,
  type SpiderConfig,
} from '../../src/animation/spider';
import {
  scaleShowcaseSpiderConfig,
  tuneShowcaseSpiderSpeed,
  groundShowcaseSpiderState,
} from '../../showcase/sections/spider-config';
import { writeFileSync } from 'node:fs';

const FLOOR_Y = 224;
const TILE_SIZE = 16;
const DT = 1 / 60;
const BODY_CLEARANCE = 30;

function makeFloorQuery(floorY: number) {
  return (_tx: number, ty: number) => ty * TILE_SIZE >= floorY ? 'solid' as const : 'empty' as const;
}

function makeConfig(speed: number, scale: number): SpiderConfig {
  const base = scale === 1 ? DEFAULT_SPIDER : scaleShowcaseSpiderConfig(DEFAULT_SPIDER, scale);
  return tuneShowcaseSpiderSpeed({ ...base, mode: 'coordinated' }, speed);
}

interface LegFrame {
  tick: number;
  bodyX: number;
  footX: number;
  footY: number;
  gaitFootX: number;
  coxaX: number;
  coxaY: number;
  kneeX: number;
  kneeY: number;
  ratio: number;
  isSwinging: boolean;
  stepStart: boolean;
  stepEnd: number;
  stepStart_x: number;
}

function simulateLeg(
  config: SpiderConfig,
  speed: number,
  scale: number,
  facing: 1 | -1,
  legIndex: number,
  ticks: number,
): LegFrame[] {
  const tileQuery = makeFloorQuery(FLOOR_Y);
  const bodyY = FLOOR_Y - BODY_CLEARANCE * scale;
  const startX = 480;
  const femurTibia = config.geometry.femurLength + config.geometry.tibiaLength;

  let state = groundShowcaseSpiderState(
    createSpiderState(config, 42, startX, bodyY, facing),
    startX,
    bodyY,
    facing,
    FLOOR_Y,
    config,
  );

  let bodyX = startX;
  const frames: LegFrame[] = [];

  for (let tick = 1; tick <= ticks; tick++) {
    bodyX += speed * facing * DT;
    // Keep on a wide track — no lane bouncing for diagnostic clarity
    if (bodyX > 900) { bodyX = 900; facing = -1 as 1 | -1; }
    else if (bodyX < 60) { bodyX = 60; facing = 1 as 1 | -1; }

    const prev = state;
    state = stepSpider(state, bodyX, bodyY, speed * facing, 0, facing, DT, config, tileQuery, TILE_SIZE, tick);

    const pose = evaluateSpiderPose(state, bodyX, bodyY, facing, speed * facing, 0, tick, config);
    const lp = pose.legPoses[legIndex];
    const leg = state.gait.legs[legIndex];
    const prevLeg = prev.gait.legs[legIndex];

    const coxaDist = Math.hypot(lp.footX - lp.coxaX, lp.footY - lp.coxaY);
    const ratio = femurTibia > 0 ? coxaDist / femurTibia : 0;

    frames.push({
      tick,
      bodyX,
      footX: lp.footX,
      footY: lp.footY,
      gaitFootX: leg.footX,
      coxaX: lp.coxaX,
      coxaY: lp.coxaY,
      kneeX: lp.kneeX,
      kneeY: lp.kneeY,
      ratio,
      isSwinging: leg.isSwinging,
      stepStart: !prevLeg.isSwinging && leg.isSwinging,
      stepEnd: leg.endX,
      stepStart_x: leg.startX,
    });
  }

  return frames;
}

function renderDiagnostic() {
  const W = 1200;
  const H = 800;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0b0f19';
  ctx.fillRect(0, 0, W, H);

  const configs: { label: string; speed: number; scale: number }[] = [
    { label: '30px/s right (1.0x)', speed: 30, scale: 1 },
    { label: '60px/s right (1.0x)', speed: 60, scale: 1 },
    { label: '90px/s right (1.2x)', speed: 90, scale: 1.2 },
    { label: '30px/s left (1.0x)', speed: 30, scale: 1 },
    { label: '60px/s left (1.0x)', speed: 60, scale: 1 },
    { label: '90px/s left (1.2x)', speed: 90, scale: 1.2 },
  ];

  const panelH = H / configs.length;
  const trackLen = 300; // ticks to show
  const pxPerTick = (W - 200) / trackLen;

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px sans-serif';

  configs.forEach((cfg, idx) => {
    const facing: 1 | -1 = idx < 3 ? 1 : -1;
    const config = makeConfig(cfg.speed, cfg.scale);
    // Use the rear-most leg (leg 0 = rear outer on near side)
    const frames = simulateLeg(config, cfg.speed, cfg.scale, facing, 0, trackLen);

    const y0 = idx * panelH + 20;
    const centerY = y0 + panelH / 2 - 20;

    // Label
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px monospace';
    ctx.fillText(cfg.label, 10, y0);

    // Floor line
    ctx.strokeStyle = '#333355';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(100, centerY + 30);
    ctx.lineTo(W - 50, centerY + 30);
    ctx.stroke();

    // Body center line (bodyX relative to startX)
    ctx.strokeStyle = '#222244';
    ctx.beginPath();
    for (let t = 0; t < trackLen; t++) {
      const f = frames[t];
      if (!f) continue;
      const x = 100 + t * pxPerTick;
      const bodyY = centerY + 30 - (f.bodyX - 480) * 0.3; // not great but shows movement
    }
    ctx.stroke();

    // Draw foot trail
    let prevFootX = 0;
    for (let t = 0; t < trackLen; t++) {
      const f = frames[t];
      if (!f) continue;
      const x = 100 + t * pxPerTick;
      const footY = centerY + 30 - (FLOOR_Y - f.footY) * 0.8;

      // Color by extension ratio
      const r = f.ratio;
      let color: string;
      if (f.isSwinging) color = '#ffcc00aa';
      else if (r > 0.90) color = '#ff4444';
      else if (r > 0.82) color = '#ff8844';
      else if (r > 0.65) color = '#44ff44';
      else color = '#4488ff';

      ctx.fillStyle = color;
      ctx.fillRect(x - 1, footY - 1, 3, 3);

      // Step start marker
      if (f.stepStart) {
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, footY - 8);
        ctx.lineTo(x, footY + 8);
        ctx.stroke();
        // Step length label
        const stepLen = Math.abs(f.stepEnd - f.stepStart_x);
        ctx.fillStyle = '#ffff88';
        ctx.font = '8px monospace';
        ctx.fillText(`${stepLen.toFixed(0)}px`, x + 2, footY - 10);
      }
    }

    // Stats
    const maxRatio = Math.max(...frames.map(f => f.ratio));
    const steps = frames.filter(f => f.stepStart);
    const stepLens = steps.map(f => Math.abs(f.stepEnd - f.stepStart_x) * facing);
    const avgStep = stepLens.length > 0 ? stepLens.reduce((s, v) => s + v, 0) / stepLens.length : 0;
    const minStep = stepLens.length > 0 ? Math.min(...stepLens) : 0;
    const ticksAbove90 = frames.filter(f => !f.isSwinging && f.ratio > 0.90).length;

    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px monospace';
    ctx.fillText(
      `maxRatio=${maxRatio.toFixed(2)} steps=${steps.length} avgStep=${avgStep.toFixed(1)} minStep=${minStep.toFixed(1)} ticks>0.90=${ticksAbove90}`,
      150, y0,
    );
  });

  // Legend
  ctx.fillStyle = '#ffffff';
  ctx.font = '10px monospace';
  ctx.fillText('Legend:', 10, H - 30);
  const legend = [
    { color: '#4488ff', label: '<0.65 (compressed)' },
    { color: '#44ff44', label: '0.65-0.82 (good)' },
    { color: '#ff8844', label: '0.82-0.90 (extended)' },
    { color: '#ff4444', label: '>0.90 (over-extended)' },
    { color: '#ffcc00', label: 'swinging' },
  ];
  legend.forEach((l, i) => {
    ctx.fillStyle = l.color;
    ctx.fillRect(70 + i * 140, H - 35, 8, 8);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(l.label, 82 + i * 140, H - 28);
  });

  writeFileSync('benchmarks/spider/leg-diagnostic.png', canvas.toBuffer('image/png'));
  console.log('Saved benchmarks/spider/leg-diagnostic.png');
}

renderDiagnostic();
