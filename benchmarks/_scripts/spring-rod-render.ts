import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSpringRod,
  advanceSpringRod,
  DEFAULT_SPRING_ROD,
  type SpringRodConfig,
} from '../../src/animation/spring-rod';
import type { VerletNode } from '../../src/animation/spring';

const OUTPUT_DIR = 'benchmarks/spring-rod';

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

function drawAnchorMarker(ctx: any, x: number, y: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 6, y);
  ctx.lineTo(x + 6, y);
  ctx.moveTo(x, y - 6);
  ctx.lineTo(x, y + 6);
  ctx.stroke();
  ctx.restore();
}

function drawRod(
  ctx: any,
  nodes: VerletNode[],
  outlineColor: string,
  accentColor: string,
  alpha: number = 1.0,
  isBroken: boolean = false
) {
  if (nodes.length < 2) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (isBroken) {
    // Draw broken rod: draw valid segments in red/dashed, and a red X at the NaN node
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (Number.isFinite(n.x) && Number.isFinite(n.y)) {
        if (!started) {
          ctx.moveTo(n.x, n.y);
          started = true;
        } else {
          ctx.lineTo(n.x, n.y);
        }
      } else {
        // Draw a red X at the NaN node's previous position or anchor + offset
        const prev = nodes[i - 1] || nodes[0];
        const x = prev.x + 12;
        const y = prev.y - 12;
        ctx.stroke(); // flush current path
        ctx.beginPath();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.moveTo(x - 6, y - 6);
        ctx.lineTo(x + 6, y + 6);
        ctx.moveTo(x + 6, y - 6);
        ctx.lineTo(x - 6, y + 6);
        ctx.stroke();
        
        // Resume dashed line if possible
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        started = false;
      }
    }
    if (started) {
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // Normal tapered drawing
  // Outline pass (thicker)
  for (let i = 0; i < nodes.length - 1; i++) {
    const t = i / (nodes.length - 1);
    const w = 8 * (1 - 0.4 * t); // tapered from 8px to 4.8px
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(nodes[i].x, nodes[i].y);
    ctx.lineTo(nodes[i + 1].x, nodes[i + 1].y);
    ctx.stroke();
  }

  // Core pass (narrower)
  for (let i = 0; i < nodes.length - 1; i++) {
    const t = i / (nodes.length - 1);
    const w = 4 * (1 - 0.4 * t); // tapered from 4px to 2.4px
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(nodes[i].x, nodes[i].y);
    ctx.lineTo(nodes[i + 1].x, nodes[i + 1].y);
    ctx.stroke();
  }

  // Tip ball
  const tip = nodes[nodes.length - 1];
  if (Number.isFinite(tip.x) && Number.isFinite(tip.y)) {
    const ballR = 6;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, ballR, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.restore();
}

function renderSpringRodBenchmarks() {
  console.log('Rendering Spring Rod benchmark...');
  const start = performance.now();

  const W = 960;
  const H = 560;
  const headerHeight = 80;
  const panelW = 320;
  const panelH = 240;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0b0f19';
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = '#0f172a'; // Slate-900
  ctx.fillRect(0, 0, W, headerHeight);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('aicraft-engine — Spring Rod Primitive Benchmark', 24, 38);

  ctx.fillStyle = '#94a3b8'; // Slate-400
  ctx.font = '13px sans-serif';
  ctx.fillText('Verifying secondary-dynamics spring-rod solver: stability, recovery, and stress tests.', 24, 60);

  // ---------------------------------------------------------------------------
  // Panel 1: Upward antenna
  // ---------------------------------------------------------------------------
  console.log('Simulating Panel 1: Upward antenna...');
  const p1States: { nodes: VerletNode[]; tick: number; ax: number; ay: number }[] = [];
  let p1Nodes = createSpringRod(6, 160, 180, 12, { x: 0.32, y: -1 });
  const p1Config: SpringRodConfig = {
    ...DEFAULT_SPRING_ROD,
    segmentLength: 12,
    restDirection: { x: 0.32, y: -1 },
    stiffness: 0.7,
    tipWeight: 0.12,
  };

  for (let tick = 0; tick <= 120; tick++) {
    const ax = 160 + Math.sin(tick * 0.1) * 15;
    const ay = 180;
    p1Nodes = advanceSpringRod(p1Nodes, ax, ay, 1 / 60, p1Config);
    if (tick > 0 && tick % 10 === 0) {
      p1States.push({ nodes: p1Nodes, tick, ax, ay });
    }
  }

  // ---------------------------------------------------------------------------
  // Panel 2: Downward tail
  // ---------------------------------------------------------------------------
  console.log('Simulating Panel 2: Downward tail...');
  const p2States: { nodes: VerletNode[]; tick: number; ax: number; ay: number }[] = [];
  let p2Nodes = createSpringRod(6, 160, 60, 12, { x: 0, y: 1 });
  const p2Config: SpringRodConfig = {
    ...DEFAULT_SPRING_ROD,
    segmentLength: 12,
    restDirection: { x: 0, y: 1 },
    stiffness: 0.3,
    tipWeight: 0,
  };

  for (let tick = 0; tick <= 120; tick++) {
    const ax = 160 + Math.sin(tick * 0.1) * 15;
    const ay = 60;
    p2Nodes = advanceSpringRod(p2Nodes, ax, ay, 1 / 60, p2Config);
    if (tick > 0 && tick % 10 === 0) {
      p2States.push({ nodes: p2Nodes, tick, ax, ay });
    }
  }

  // ---------------------------------------------------------------------------
  // Panel 3: Sideways → vertical recovery
  // ---------------------------------------------------------------------------
  console.log('Simulating Panel 3: Sideways -> vertical recovery...');
  const p3States: { nodes: VerletNode[]; tick: number; ax: number; ay: number }[] = [];
  let p3Nodes = createSpringRod(6, 160, 180, 12, { x: 1, y: 0 }); // start sideways
  const p3Config: SpringRodConfig = {
    ...DEFAULT_SPRING_ROD,
    segmentLength: 12,
    restDirection: { x: 0, y: -1 }, // recover upward
    stiffness: 0.6,
  };

  // Save initial state (tick 0)
  p3States.push({ nodes: p3Nodes, tick: 0, ax: 160, ay: 180 });

  for (let tick = 1; tick <= 120; tick++) {
    p3Nodes = advanceSpringRod(p3Nodes, 160, 180, 1 / 60, p3Config);
    if (tick === 15 || tick === 30 || tick === 60 || tick === 120) {
      p3States.push({ nodes: p3Nodes, tick, ax: 160, ay: 180 });
    }
  }

  // ---------------------------------------------------------------------------
  // Panel 4: Stress: anchor teleport +200px
  // ---------------------------------------------------------------------------
  console.log('Simulating Panel 4: Stress: anchor teleport +200px...');
  const p4States: { nodes: VerletNode[]; tick: number; ax: number; ay: number }[] = [];
  let p4Nodes = createSpringRod(6, 60, 180, 12, { x: 0, y: -1 });
  const p4Config: SpringRodConfig = {
    ...DEFAULT_SPRING_ROD,
    segmentLength: 12,
    restDirection: { x: 0, y: -1 },
    stiffness: 0.5,
  };

  for (let tick = 0; tick <= 120; tick++) {
    const ax = tick < 60 ? 60 : 260;
    const ay = 180;
    p4Nodes = advanceSpringRod(p4Nodes, ax, ay, 1 / 60, p4Config);
    if (tick === 59 || tick === 60 || tick === 61 || tick === 65 || tick === 120) {
      p4States.push({ nodes: p4Nodes, tick, ax, ay });
    }
  }

  // ---------------------------------------------------------------------------
  // Panel 5: Stress: dt=100
  // ---------------------------------------------------------------------------
  console.log('Simulating Panel 5: Stress: dt=100...');
  const p5States: { nodes: VerletNode[]; tick: number; ax: number; ay: number }[] = [];
  let p5Nodes = createSpringRod(6, 160, 180, 12, { x: 0.32, y: -1 });
  const p5Config: SpringRodConfig = {
    ...DEFAULT_SPRING_ROD,
    segmentLength: 12,
    restDirection: { x: 0.32, y: -1 },
    stiffness: 0.7,
  };

  for (let tick = 0; tick <= 120; tick++) {
    p5Nodes = advanceSpringRod(p5Nodes, 160, 180, 100, p5Config);
    if (tick > 0 && tick % 10 === 0) {
      p5States.push({ nodes: p5Nodes, tick, ax: 160, ay: 180 });
    }
  }

  // ---------------------------------------------------------------------------
  // Panel 6: Stress: NaN input
  // ---------------------------------------------------------------------------
  console.log('Simulating Panel 6: Stress: NaN input...');
  const p6States: { nodes: VerletNode[]; tick: number; ax: number; ay: number; isBroken: boolean }[] = [];
  let p6Nodes = createSpringRod(6, 160, 180, 12, { x: 0.32, y: -1 });
  const p6Config: SpringRodConfig = {
    ...DEFAULT_SPRING_ROD,
    segmentLength: 12,
    restDirection: { x: 0.32, y: -1 },
    stiffness: 0.7,
  };

  // Save tick 0 (broken state)
  const p6Tick0 = p6Nodes.map(n => ({ ...n }));
  p6Tick0[3].x = NaN; // Corrupt node 3
  p6States.push({ nodes: p6Tick0, tick: 0, ax: 160, ay: 180, isBroken: true });

  // Advance to tick 1 with NaN input to trigger recovery
  p6Nodes[3].x = NaN; // Corrupt active state
  p6Nodes = advanceSpringRod(p6Nodes, 160, 180, 1 / 60, p6Config);
  p6States.push({ nodes: p6Nodes, tick: 1, ax: 160, ay: 180, isBroken: false });


  // ---------------------------------------------------------------------------
  // Render Panels to Canvas
  // ---------------------------------------------------------------------------
  console.log('Rendering panels to canvas...');

  const panels = [
    {
      title: '1. Upward Antenna',
      desc: 'restDir: {x:0.32, y:-1}, stiff: 0.7, weight: 0.12\nSwaying anchor. Smooth forward lean & sag.',
      accent: '#f97316', // Orange
      states: p1States,
      finalNodes: p1Nodes,
      finalAx: 160 + Math.sin(120 * 0.1) * 15,
      finalAy: 180,
    },
    {
      title: '2. Downward Tail',
      desc: 'restDir: {x:0, y:1}, stiff: 0.3, weight: 0\nSwaying anchor. Smooth floppy wag.',
      accent: '#3b82f6', // Blue
      states: p2States,
      finalNodes: p2Nodes,
      finalAx: 160 + Math.sin(120 * 0.1) * 15,
      finalAy: 60,
    },
    {
      title: '3. Sideways → Vertical Recovery',
      desc: 'Start: {x:1, y:0} | Rest: {x:0, y:-1}, stiff: 0.6\nOverlay ticks 0, 15, 30, 60, 120.',
      accent: '#10b981', // Emerald
      states: p3States.slice(0, -1), // all except final
      finalNodes: p3Nodes,
      finalAx: 160,
      finalAy: 180,
    },
    {
      title: '4. Stress: Anchor Teleport +200px',
      desc: 'Teleport from x=60 to x=260 at tick 60.\nOverlay ticks 59, 60, 61, 65, 120.',
      accent: '#ec4899', // Pink
      states: p4States.slice(0, -1), // all except final
      finalNodes: p4Nodes,
      finalAx: 260,
      finalAy: 180,
    },
    {
      title: '5. Stress: dt=100',
      desc: 'Step with dt=100 for 120 ticks.\nRod stays finite and stable.',
      accent: '#eab308', // Yellow
      states: p5States,
      finalNodes: p5Nodes,
      finalAx: 160,
      finalAy: 180,
    },
    {
      title: '6. Stress: NaN Input & Recovery',
      desc: 'Set node[3].x = NaN at tick 0.\nTick 0 (broken, red) -> Tick 1 (recovered, bold).',
      accent: '#ef4444', // Red
      states: [p6States[0]], // tick 0 broken
      finalNodes: p6States[1].nodes, // tick 1 recovered
      finalAx: 160,
      finalAy: 180,
    },
  ];

  panels.forEach((p, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const xOffset = col * panelW;
    const yOffset = headerHeight + row * panelH;

    ctx.save();
    ctx.translate(xOffset, yOffset);

    // Clip to panel bounds
    ctx.beginPath();
    ctx.rect(0, 0, panelW, panelH);
    ctx.clip();

    // Background
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, panelW, panelH);

    // Draw grid border
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, panelW, panelH);

    // Draw panel title
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(p.title, 16, 28);

    // Draw panel description
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    const descLines = p.desc.split('\n');
    descLines.forEach((line, lineIdx) => {
      ctx.fillText(line, 16, 44 + lineIdx * 14);
    });

    // Draw anchor markers for historical states
    p.states.forEach((s) => {
      drawAnchorMarker(ctx, s.ax, s.ay, '#1e293b');
    });
    // Draw final anchor marker
    drawAnchorMarker(ctx, p.finalAx, p.finalAy, '#38bdf8');

    // Draw historical faded states
    p.states.forEach((s) => {
      const isBroken = (s as any).isBroken || false;
      drawRod(ctx, s.nodes, '#020617', isBroken ? '#ef4444' : p.accent, 0.2, isBroken);
    });

    // Draw final bold state
    drawRod(ctx, p.finalNodes, '#020617', p.accent, 1.0, false);

    ctx.restore();
  });

  const destPath = join(OUTPUT_DIR, 'gallery.png');
  writeFileSync(destPath, canvas.toBuffer('image/png'));

  const end = performance.now();
  console.log(`Spring Rod benchmark rendering complete in ${(end - start).toFixed(2)}ms.`);
  console.log(`Output saved to: ${destPath}`);
}

renderSpringRodBenchmarks();
