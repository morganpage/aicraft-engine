/**
 * Spider Render Script
 *
 * Produces a sample sheet PNG at benchmarks/spider/sample-sheet.png
 * with 4 panels demonstrating the procedural spider locomotion.
 *
 * Run: npx tsx benchmarks/_scripts/spider-render.ts
 */

import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSpiderState,
  stepSpider,
  evaluateSpiderPose,
  drawSpider,
  DEFAULT_SPIDER,
  type SpiderConfig,
  type SpiderState,
  type SpiderPose,
} from '../../src/animation/spider';
import type { TileSolidityQuery } from '../../src/collision/types';

const OUTPUT_DIR = 'benchmarks/spider';

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Tile query: solid below floorY, empty above
// floorY MUST be a multiple of TILE_SIZE for feet to plant on the surface.
// ---------------------------------------------------------------------------

const TILE_SIZE = 16;
const FLOOR_Y = 192; // 12 * 16 — tile-aligned so sampleGround surface matches drawn floor

function makeFloorQuery(floorY: number): TileSolidityQuery {
  return (_tileX: number, tileY: number) => {
    const worldY = tileY * TILE_SIZE;
    return worldY >= floorY ? 'solid' : 'empty';
  };
}

// ---------------------------------------------------------------------------
// Simulation helper: advance spider for N ticks, snapshot at intervals
// ---------------------------------------------------------------------------

interface SimSnapshot {
  pose: SpiderPose;
  bodyX: number;
  bodyY: number;
  tick: number;
  footPlants?: readonly { x: number; y: number }[];
}

function simulateSpider(
  config: SpiderConfig,
  jitterSeed: number,
  startX: number,
  startY: number,
  vx: number,
  vy: number,
  facing: 1 | -1,
  totalTicks: number,
  snapshotInterval: number,
  floorY: number,
): SimSnapshot[] {
  const tileQuery = makeFloorQuery(floorY);
  let state = createSpiderState(config, jitterSeed, startX, startY);
  const snapshots: SimSnapshot[] = [];
  const dt = 1 / 60;

  for (let tick = 1; tick <= totalTicks; tick++) {
    const bodyX = startX + vx * tick * dt;
    const bodyY = startY;

    state = stepSpider(
      state, bodyX, bodyY, vx, vy, facing, dt,
      config, tileQuery, TILE_SIZE, tick,
    );

    if (tick % snapshotInterval === 0 || tick === totalTicks) {
      const pose = evaluateSpiderPose(
        state, bodyX, bodyY, facing, vx, vy, tick,
        config,
      );

      const footPlants = state.gait.legs.map((leg) => ({ x: leg.footX, y: leg.footY }));

      snapshots.push({ pose, bodyX, bodyY, tick, footPlants });
    }
  }

  return snapshots;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function drawFloor(ctx: CanvasRenderingContext2D, floorY: number, width: number) {
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, floorY, width, 20);
  ctx.fillStyle = '#12121f';
  ctx.fillRect(0, floorY + 20, width, 40);

  ctx.strokeStyle = '#444466';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, floorY);
  ctx.lineTo(width, floorY);
  ctx.stroke();

  ctx.strokeStyle = '#252540';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < width; x += TILE_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x, floorY);
    ctx.lineTo(x, floorY + 20);
    ctx.stroke();
  }
}

function drawFootDots(ctx: CanvasRenderingContext2D, snapshots: readonly SimSnapshot[], color: string) {
  for (const snap of snapshots) {
    if (!snap.footPlants) continue;
    for (const foot of snap.footPlants) {
      ctx.beginPath();
      ctx.arc(foot.x, foot.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }
}

function drawSnapshotOverlays(
  ctx: CanvasRenderingContext2D,
  snapshots: readonly SimSnapshot[],
  visualConfig: SpiderConfig,
  currentAlpha: number,
) {
  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const isLast = i === snapshots.length - 1;
    ctx.globalAlpha = isLast ? currentAlpha : 0.15;
    drawSpider(ctx, snap.pose, visualConfig);
  }
  ctx.globalAlpha = 1.0;
}

// ---------------------------------------------------------------------------
// Instrumentation: sanity-check spider positions
// ---------------------------------------------------------------------------

function logSimSummary(
  name: string,
  snapshots: readonly SimSnapshot[],
  floorY: number,
  panelW: number,
  thighLength: number,
  shinLength: number,
): void {
  if (snapshots.length === 0) {
    console.log(`  ${name}: NO SNAPSHOTS`);
    return;
  }
  const bodyXs = snapshots.map((s) => s.bodyX);
  const minX = Math.min(...bodyXs);
  const maxX = Math.max(...bodyXs);
  console.log(`  ${name}: bodyX range [${minX.toFixed(1)}, ${maxX.toFixed(1)}] (panel 0–${panelW})`);

  const last = snapshots[snapshots.length - 1];
  const feet = last.footPlants ?? [];
  if (feet.length > 0) {
    const avgFootY = feet.reduce((s, f) => s + f.y, 0) / feet.length;
    const maxFootX = Math.max(...feet.map((f) => f.x));
    const minFootX = Math.min(...feet.map((f) => f.x));
    console.log(`  ${name}: last-frame avg foot Y = ${avgFootY.toFixed(1)} (floor ${floorY}), foot X range [${minFootX.toFixed(1)}, ${maxFootX.toFixed(1)}]`);
  }

  const onPanel = minX >= -10 && maxX <= panelW + 10;
  const maxReach = thighLength + shinLength;
  console.log(`  ${name}: on-panel=${onPanel}, max-reach=${maxReach}`);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderSpiderBenchmarks() {
  console.log('Rendering Spider benchmark...');
  const start = performance.now();

  const W = 960;
  const H = 600;
  const headerHeight = 80;
  const panelW = 480;
  const panelH = 260;
  const floorY = FLOOR_Y;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0b0f19';
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, headerHeight);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('aicraft-engine — Procedural Spider', 24, 38);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px sans-serif';
  ctx.fillText('Approach B hybrid: gait coordinator + segmented body + IK legs + pedipalps.', 24, 60);

  // -----------------------------------------------------------------------
  // Panel 1: Coordinated gait walk
  // -----------------------------------------------------------------------
  console.log('Simulating Panel 1: Coordinated gait...');
  const p1Config: SpiderConfig = {
    ...DEFAULT_SPIDER,
    mode: 'coordinated',
    stepDuration: 0.18,
    phaseAdvanceRate: 0.08,
  };
  const p1Snapshots = simulateSpider(p1Config, 42, 80, floorY - 18, 50, 0, 1, 180, 20, floorY);

  // -----------------------------------------------------------------------
  // Panel 2: Frantic gait scuttle
  // -----------------------------------------------------------------------
  console.log('Simulating Panel 2: Frantic gait...');
  const p2Config: SpiderConfig = {
    ...DEFAULT_SPIDER,
    mode: 'frantic',
    stepDuration: 0.1,
    comfortRadius: 8,
  };
  const p2Snapshots = simulateSpider(p2Config, 42, 80, floorY - 18, 70, 0, 1, 120, 15, floorY);

  // -----------------------------------------------------------------------
  // Panel 3: Body showcase (stationary, breathing)
  // -----------------------------------------------------------------------
  console.log('Simulating Panel 3: Body showcase...');
  const palettes = [
    { name: 'Dark Purple', cephFill: '#4a2d6b', abdFill: '#3d2458', legFg: '#5c3d8a', legBg: '#382455', eyeFill: '#ff2222', cheliceraeFill: '#2a1a3d', palpFill: '#5c3d8a', outline: '#1d1128' },
    { name: 'Sickly Green', cephFill: '#2d5a2d', abdFill: '#1e4a1e', legFg: '#3d7a3d', legBg: '#264226', eyeFill: '#ffff22', cheliceraeFill: '#1a3d1a', palpFill: '#3d7a3d', outline: '#0d1f0d' },
    { name: 'Blood Red', cephFill: '#6b2d2d', abdFill: '#582424', legFg: '#8a3d3d', legBg: '#552424', eyeFill: '#ffaa00', cheliceraeFill: '#3d1a1a', palpFill: '#8a3d3d', outline: '#280d0d' },
  ];

  const p3States: { state: SpiderState; config: SpiderConfig; bodyX: number; bodyY: number }[] = [];
  const p3Spacing = panelW / 3;
  for (let i = 0; i < palettes.length; i++) {
    const pal = palettes[i];
    const cfg: SpiderConfig = { ...DEFAULT_SPIDER, palette: pal };
    const cx = p3Spacing * i + p3Spacing / 2;
    const bodyY = floorY - 18;
    let state = createSpiderState(cfg, 99, cx, bodyY);
    const tileQuery = makeFloorQuery(floorY);
    for (let t = 1; t <= 180; t++) {
      state = stepSpider(state, cx, bodyY, 0, 0, 1, 1 / 60, cfg, tileQuery, TILE_SIZE, t);
    }
    p3States.push({ state, config: cfg, bodyX: cx, bodyY });
  }

  // -----------------------------------------------------------------------
  // Panel 4: Multi-spider scuttle
  // -----------------------------------------------------------------------
  console.log('Simulating Panel 4: Multi-spider...');
  const spiderSeeds = [101, 202, 303];
  const spiderSizes = [0.8, 1.0, 1.2];
  const p4Configs: SpiderConfig[] = spiderSeeds.map((_, i) => ({
    ...DEFAULT_SPIDER,
    mode: 'frantic' as const,
    stepDuration: 0.1,
    comfortRadius: 8,
    cephRadius: DEFAULT_SPIDER.cephRadius * spiderSizes[i],
    abdRx: DEFAULT_SPIDER.abdRx * spiderSizes[i],
    abdRy: DEFAULT_SPIDER.abdRy * spiderSizes[i],
    thighLength: DEFAULT_SPIDER.thighLength * spiderSizes[i],
    shinLength: DEFAULT_SPIDER.shinLength * spiderSizes[i],
    abdOffsetX: DEFAULT_SPIDER.abdOffsetX * spiderSizes[i],
  }));
  const p4SnapshotsList: SimSnapshot[][] = p4Configs.map((cfg, i) =>
    simulateSpider(cfg, spiderSeeds[i], 60 + i * 120, floorY - 18 * spiderSizes[i], 50 + i * 5, 0, 1, 120, 120, floorY),
  );

  // -----------------------------------------------------------------------
  // Sanity-check instrumentation
  // -----------------------------------------------------------------------
  console.log('\n--- Sanity checks ---');
  logSimSummary('Panel 1', p1Snapshots, floorY, panelW, DEFAULT_SPIDER.thighLength, DEFAULT_SPIDER.shinLength);
  logSimSummary('Panel 2', p2Snapshots, floorY, panelW, DEFAULT_SPIDER.thighLength, DEFAULT_SPIDER.shinLength);
  for (let i = 0; i < p3States.length; i++) {
    const { bodyX, bodyY } = p3States[i];
    console.log(`  Panel 3 spider ${i}: bodyX=${bodyX.toFixed(1)}, bodyY=${bodyY.toFixed(1)} (floor ${floorY})`);
  }
  for (let i = 0; i < p4SnapshotsList.length; i++) {
    logSimSummary(`Panel 4 spider ${i}`, p4SnapshotsList[i], floorY, panelW, p4Configs[i].thighLength, p4Configs[i].shinLength);
  }
  console.log('--- End sanity checks ---\n');

  // -----------------------------------------------------------------------
  // Render panels
  // -----------------------------------------------------------------------
  console.log('Rendering panels...');

  const panels = [
    {
      title: '1. Coordinated Gait Walk',
      desc: 'Alternating tetrapod: Set A/B legs step in alternation. Faded = history, bold = current.',
      x: 0, y: headerHeight,
      draw: () => {
        drawFloor(ctx, floorY, panelW);
        drawFootDots(ctx, p1Snapshots, '#5c3d8a44');
        drawSnapshotOverlays(ctx, p1Snapshots, p1Config, 1.0);
      },
    },
    {
      title: '2. Frantic Gait Scuttle',
      desc: 'Free-stepping with neighbor-lock. Higher speed, chaotic scuttling.',
      x: panelW, y: headerHeight,
      draw: () => {
        drawFloor(ctx, floorY, panelW);
        drawFootDots(ctx, p2Snapshots, '#5c3d8a44');
        drawSnapshotOverlays(ctx, p2Snapshots, p2Config, 1.0);
      },
    },
    {
      title: '3. Body Showcase (3 palettes)',
      desc: 'Idle breathing. L-R: Dark Purple, Sickly Green, Blood Red.',
      x: 0, y: headerHeight + panelH,
      draw: () => {
        drawFloor(ctx, floorY, panelW);
        for (let i = 0; i < p3States.length; i++) {
          const { state, config, bodyX, bodyY } = p3States[i];
          const pose = evaluateSpiderPose(state, bodyX, bodyY, 1, 0, 0, 180, config);
          drawSpider(ctx, pose, config);
        }
      },
    },
    {
      title: '4. Multi-Spider Scuttle',
      desc: '3 spiders at different seeds/sizes. Swarm check.',
      x: panelW, y: headerHeight + panelH,
      draw: () => {
        drawFloor(ctx, floorY, panelW);
        for (let i = 0; i < p4SnapshotsList.length; i++) {
          const snapshots = p4SnapshotsList[i];
          const lastSnap = snapshots[snapshots.length - 1];
          if (lastSnap) {
            ctx.globalAlpha = 0.7;
            drawSpider(ctx, lastSnap.pose, p4Configs[i]);
            ctx.globalAlpha = 1.0;
          }
        }
      },
    },
  ];

  for (const panel of panels) {
    ctx.save();
    ctx.translate(panel.x, panel.y);

    ctx.beginPath();
    ctx.rect(0, 0, panelW, panelH);
    ctx.clip();

    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, panelW, panelH);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, panelW, panelH);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(panel.title, 16, 20);

    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.fillText(panel.desc, 16, 35);

    ctx.save();
    ctx.translate(0, 40);
    panel.draw();
    ctx.restore();

    ctx.restore();
  }

  const destPath = join(OUTPUT_DIR, 'sample-sheet.png');
  writeFileSync(destPath, canvas.toBuffer('image/png'));

  const end = performance.now();
  console.log(`Spider benchmark rendering complete in ${(end - start).toFixed(2)}ms.`);
  console.log(`Output saved to: ${destPath}`);
}

renderSpiderBenchmarks();
