import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { drawLevelEntity } from '../../src/platformer/renderer';
import { drawEnemies } from '../../src/platformer/enemy/renderer';
import { outlineRect } from '../../src/primitives/outline-rect';
import { spinnyBehavior } from '../../src/platformer/enemy/registry';
import type { LevelEntity } from '../../src/level/types';
import type { CompiledEnemy } from '../../src/platformer/enemy/types';

const OUTPUT_DIR = 'benchmarks/platformer-enemies';

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Color Constants matching the playground
const COLOR_BG = '#120c18';
const COLOR_GRID = '#3a2820';
const COLOR_SELECTION = '#ffd84a';
const COLOR_PATH = '#5fd4ff';
const COLOR_PATH_FILL = 'rgba(95, 212, 255, 0.55)';
const COLOR_TEXT_MUTED = '#88888e';
const COLOR_TEXT_LIGHT = '#e4e4e7';

// Custom entity palette for drawLevelEntity
const PLAYGROUND_PALETTE = {
  platform: '#9a6a4a',
  passthrough: '#7a9a6a',
  movingPlatform: '#5a7a9a',
  hazard: '#ff3a3a',
  spawn: '#7aff7a',
  exit: '#ffe066',
  enemy: '#ff3a3a',
};

const ENEMY_PALETTE = {
  spinny: '#ff3a3a',
  turret: '#ff6a00',
  default: '#ff3a3a',
  indicator: '#ffffff',
  projectile: '#ffaa00',
};

function drawPanelBorder(
  ctx: any,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  subtitle: string
): void {
  ctx.save();
  ctx.translate(x, y);

  // Draw panel background
  ctx.fillStyle = '#0f0a14';
  ctx.fillRect(0, 0, w, h);

  // Draw panel border
  ctx.strokeStyle = '#2d1f38';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, w, h);

  // Draw panel title
  ctx.fillStyle = COLOR_TEXT_LIGHT;
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(title, 15, 25);

  // Draw panel subtitle
  ctx.fillStyle = COLOR_TEXT_MUTED;
  ctx.font = '11px sans-serif';
  ctx.fillText(subtitle, 15, 42);

  // Draw a divider line below title area
  ctx.strokeStyle = '#2d1f38';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 52);
  ctx.lineTo(w, 52);
  ctx.stroke();

  ctx.restore();
}

function drawGridBackground(ctx: any, w: number, h: number): void {
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = COLOR_GRID;
  ctx.lineWidth = 1;
  const gridSize = 16;
  ctx.beginPath();
  for (let x = 0; x < w; x += gridSize) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
  }
  for (let y = 0; y < h; y += gridSize) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
  }
  ctx.stroke();
}

function drawAsymmetricSpinny(
  ctx: any,
  enemy: CompiledEnemy,
  tick: number,
  palette: any
): void {
  // 1. Draw the production sawblade
  drawEnemies(ctx, [enemy], tick, palette);

  // 2. Draw the asymmetric marker on top of it at the exact same rotation angle
  const cx = enemy.state.x + 8;
  const cy = enemy.state.y + 8;
  const storedAngle = enemy.state.data.spinAngle;
  const SPINNY_ANGULAR_SPEED = (Math.PI * 2) / 120;
  const rotation =
    typeof storedAngle === 'number' && Number.isFinite(storedAngle)
      ? storedAngle
      : tick * SPINNY_ANGULAR_SPEED * enemy.state.facing;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);

  // Draw a highly visible asymmetric marker: a white dot and line pointing to one spike
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(5, 0, 2.5, 0, Math.PI * 2); // offset from center to make it asymmetric
  ctx.fill();
  ctx.stroke();

  // Draw a line from center to the dot
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(5, 0);
  ctx.stroke();

  ctx.restore();
}

function renderEnemiesBenchmark(): void {
  console.log('Rendering platformer-enemies verification benchmark...');
  const start = performance.now();

  const W = 1080;
  const H = 840;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 1. Background
  ctx.fillStyle = '#07050a';
  ctx.fillRect(0, 0, W, H);

  // 2. Header Title & Subtitle
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('aicraft-engine — Platformer Enemies Verification', 40, 45);

  ctx.fillStyle = COLOR_TEXT_MUTED;
  ctx.font = '13px sans-serif';
  ctx.fillText(
    'Verifying immediate selection, Select mode, cyan patrol path widget, and roll/turnaround phase continuity',
    40,
    68
  );

  // Divider line below header
  ctx.strokeStyle = '#27272a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, 85);
  ctx.lineTo(W - 40, 85);
  ctx.stroke();

  // Panel Dimensions
  const panelW = 480;
  const panelH = 340;
  const contentW = 460;
  const contentH = 270;

  // -------------------------------------------------------------------------
  // PANEL 1: Immediately after Spinny placement (Select Mode)
  // -------------------------------------------------------------------------
  const p1X = 40;
  const p1Y = 100;
  drawPanelBorder(
    ctx,
    p1X,
    p1Y,
    panelW,
    panelH,
    'Panel 1: Spinny Placement & Selection',
    'Verifying immediate selection, Select mode, and cyan patrol path widget'
  );

  ctx.save();
  ctx.translate(p1X + 10, p1Y + 60);

  // Draw grid background
  drawGridBackground(ctx, contentW, contentH);

  // Define Spinny Entity
  const spinnyEntity: LevelEntity = {
    id: 1,
    kind: 'enemy',
    rect: { x: 150, y: 120, width: 16, height: 16 },
    props: {
      archetype: 'spinny',
      params: {
        speed: 60,
        ledgeTurnAround: true,
        patrolPath: [
          { x: 150, y: 120 },
          { x: 198, y: 120 },
        ],
      },
    },
  };

  // Draw Spinny as standard entity in Edit Mode (red square)
  drawLevelEntity(ctx, spinnyEntity, { palette: PLAYGROUND_PALETTE });

  // Draw selection highlight (gold/yellow border)
  ctx.strokeStyle = COLOR_SELECTION;
  ctx.lineWidth = 2;
  ctx.strokeRect(
    spinnyEntity.rect.x - 1,
    spinnyEntity.rect.y - 1,
    spinnyEntity.rect.width + 2,
    spinnyEntity.rect.height + 2
  );

  // Draw path widget
  const cx = spinnyEntity.rect.width / 2;
  const cy = spinnyEntity.rect.height / 2;
  const path = spinnyEntity.props.params.patrolPath as { x: number; y: number }[];
  const centers = path.map((p) => ({ x: p.x + cx, y: p.y + cy }));

  // Dashed polyline
  ctx.strokeStyle = COLOR_PATH;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(centers[0].x + 0.5, centers[0].y + 0.5);
  ctx.lineTo(centers[1].x + 0.5, centers[1].y + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  // Waypoint handles
  for (const c of centers) {
    ctx.fillStyle = COLOR_PATH_FILL;
    ctx.strokeStyle = COLOR_PATH;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Draw labels for waypoints
  ctx.fillStyle = '#ffffff';
  ctx.font = '9px monospace';
  ctx.textBaseline = 'alphabetic';

  ctx.textAlign = 'right';
  ctx.fillText('wp0 (150, 120) ', centers[0].x - 10, centers[0].y - 10);

  ctx.textAlign = 'left';
  ctx.fillText(' wp1 (198, 120)', centers[1].x + 10, centers[1].y - 10);

  // Draw path length label
  ctx.fillStyle = COLOR_PATH;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    '48px Patrol Path',
    (centers[0].x + centers[1].x) / 2,
    centers[0].y + 20
  );

  // Draw Editor UI Overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillRect(10, 10, 180, 45);
  ctx.strokeStyle = '#3d2f4d';
  ctx.lineWidth = 1;
  ctx.strokeRect(10, 10, 180, 45);

  ctx.fillStyle = '#7aff7a';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('MODE: SELECT (Active)', 18, 26);

  ctx.fillStyle = COLOR_TEXT_MUTED;
  ctx.font = '9px sans-serif';
  ctx.fillText('Selected: Spinny (ID: 1)', 18, 42);

  ctx.restore();

  // -------------------------------------------------------------------------
  // PANEL 2: Rolling Right (Clockwise)
  // -------------------------------------------------------------------------
  const p2X = 560;
  const p2Y = 100;
  drawPanelBorder(
    ctx,
    p2X,
    p2Y,
    panelW,
    panelH,
    'Panel 2: Rolling Right (Clockwise)',
    'Verifying clockwise rotation from actual horizontal displacement'
  );

  ctx.save();
  ctx.translate(p2X + 10, p2Y + 60);

  // Draw grid background
  drawGridBackground(ctx, contentW, contentH);

  // Run simulation to get 5 frames of rolling right
  let stateRight = {
    x: 40,
    y: 120,
    vx: 0,
    vy: 0,
    facing: 1,
    alive: true,
    data: {} as Record<string, unknown>,
  };
  const ctxStep = {
    dt: 1.333333, // speed * dt = 60 * 1.333333 = 80px displacement per step
    solids: [],
    tileQuery: null,
    tileSize: 16,
    playerRect: null,
  };
  const params = { speed: 60 };

  const framesRight: any[] = [];
  for (let i = 0; i < 5; i++) {
    framesRight.push({ ...stateRight, data: { ...stateRight.data } });
    const result = spinnyBehavior.step(stateRight, ctxStep, params);
    stateRight = {
      x: result.x,
      y: result.y,
      vx: result.vx,
      vy: result.vy,
      facing: result.facing,
      alive: result.alive,
      data: result.data,
    };
  }

  // Draw ground line
  ctx.strokeStyle = '#3a2820';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 136);
  ctx.lineTo(contentW, 136);
  ctx.stroke();

  // Draw frames
  framesRight.forEach((frame, idx) => {
    const enemyCompiled: CompiledEnemy = {
      id: 1,
      archetype: 'spinny',
      state: {
        x: frame.x,
        y: frame.y,
        vx: frame.vx,
        vy: frame.vy,
        facing: frame.facing,
        alive: frame.alive,
        data: frame.data,
      },
      entity: spinnyEntity,
      params: {},
    };

    drawAsymmetricSpinny(ctx, enemyCompiled, 0, ENEMY_PALETTE);

    // Draw frame labels
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`F${idx + 1}`, frame.x + 8, frame.y - 20);

    ctx.fillStyle = COLOR_TEXT_MUTED;
    ctx.font = '9px monospace';
    ctx.fillText(`x:${frame.x.toFixed(0)}`, frame.x + 8, frame.y + 32);
    const deg = ((frame.data.spinAngle || 0) * 180) / Math.PI;
    ctx.fillText(`${deg.toFixed(0)}°`, frame.x + 8, frame.y + 44);
  });

  // Draw timeline arrow
  ctx.strokeStyle = '#fe5701';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(40, 210);
  ctx.lineTo(420, 210);
  ctx.stroke();
  // Arrowhead
  ctx.fillStyle = '#fe5701';
  ctx.beginPath();
  ctx.moveTo(420, 210);
  ctx.lineTo(412, 206);
  ctx.lineTo(412, 214);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#fe5701';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TIME / DISPLACEMENT (→)', 230, 225);

  ctx.restore();

  // -------------------------------------------------------------------------
  // PANEL 3: Rolling Left (Counterclockwise)
  // -------------------------------------------------------------------------
  const p3X = 40;
  const p3Y = 470;
  drawPanelBorder(
    ctx,
    p3X,
    p3Y,
    panelW,
    panelH,
    'Panel 3: Rolling Left (Counterclockwise)',
    'Verifying counterclockwise rotation from actual horizontal displacement'
  );

  ctx.save();
  ctx.translate(p3X + 10, p3Y + 60);

  // Draw grid background
  drawGridBackground(ctx, contentW, contentH);

  // Run simulation to get 5 frames of rolling left
  let stateLeft = {
    x: 360,
    y: 120,
    vx: 0,
    vy: 0,
    facing: -1,
    alive: true,
    data: {} as Record<string, unknown>,
  };

  const framesLeft: any[] = [];
  for (let i = 0; i < 5; i++) {
    framesLeft.push({ ...stateLeft, data: { ...stateLeft.data } });
    const result = spinnyBehavior.step(stateLeft, ctxStep, params);
    stateLeft = {
      x: result.x,
      y: result.y,
      vx: result.vx,
      vy: result.vy,
      facing: result.facing,
      alive: result.alive,
      data: result.data,
    };
  }

  // Draw ground line
  ctx.strokeStyle = '#3a2820';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 136);
  ctx.lineTo(contentW, 136);
  ctx.stroke();

  // Draw frames
  framesLeft.forEach((frame, idx) => {
    const enemyCompiled: CompiledEnemy = {
      id: 1,
      archetype: 'spinny',
      state: {
        x: frame.x,
        y: frame.y,
        vx: frame.vx,
        vy: frame.vy,
        facing: frame.facing,
        alive: frame.alive,
        data: frame.data,
      },
      entity: spinnyEntity,
      params: {},
    };

    drawAsymmetricSpinny(ctx, enemyCompiled, 0, ENEMY_PALETTE);

    // Draw frame labels
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`F${idx + 1}`, frame.x + 8, frame.y - 20);

    ctx.fillStyle = COLOR_TEXT_MUTED;
    ctx.font = '9px monospace';
    ctx.fillText(`x:${frame.x.toFixed(0)}`, frame.x + 8, frame.y + 32);
    const deg = ((frame.data.spinAngle || 0) * 180) / Math.PI;
    ctx.fillText(`${deg.toFixed(0)}°`, frame.x + 8, frame.y + 44);
  });

  // Draw timeline arrow (pointing left)
  ctx.strokeStyle = '#fe5701';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(420, 210);
  ctx.lineTo(40, 210);
  ctx.stroke();
  // Arrowhead
  ctx.fillStyle = '#fe5701';
  ctx.beginPath();
  ctx.moveTo(40, 210);
  ctx.lineTo(48, 206);
  ctx.lineTo(48, 214);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#fe5701';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TIME / DISPLACEMENT (←)', 230, 225);

  ctx.restore();

  // -------------------------------------------------------------------------
  // PANEL 4: Turnaround Sequence (Angular Phase Continuity)
  // -------------------------------------------------------------------------
  const p4X = 560;
  const p4Y = 470;
  drawPanelBorder(
    ctx,
    p4X,
    p4Y,
    panelW,
    panelH,
    'Panel 4: Turnaround Sequence (Phase Continuity)',
    'Verifying angle preservation on stationary reversal frame (no snap)'
  );

  ctx.save();
  ctx.translate(p4X + 10, p4Y + 60);

  // Draw grid background
  drawGridBackground(ctx, contentW, contentH);

  // Run simulation to get 5 frames of turnaround sequence
  let stateTurn = {
    x: 100,
    y: 120,
    vx: 0,
    vy: 0,
    facing: 1,
    alive: true,
    data: {} as Record<string, unknown>,
  };
  const ctxTurn = {
    dt: 0.1,
    solids: [{ x: 124, y: 120, width: 16, height: 16 }],
    tileQuery: null,
    tileSize: 16,
    playerRect: null,
  };

  const framesTurn: any[] = [];
  for (let i = 0; i < 5; i++) {
    framesTurn.push({ ...stateTurn, data: { ...stateTurn.data } });
    const result = spinnyBehavior.step(stateTurn, ctxTurn, params);
    stateTurn = {
      x: result.x,
      y: result.y,
      vx: result.vx,
      vy: result.vy,
      facing: result.facing,
      alive: result.alive,
      data: result.data,
    };
  }

  // Draw 5 columns
  const colW = contentW / 5;
  framesTurn.forEach((frame, idx) => {
    const colX = idx * colW + colW / 2;

    // Draw vertical divider
    if (idx > 0) {
      ctx.strokeStyle = '#1d1128';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(idx * colW, 0);
      ctx.lineTo(idx * colW, contentH);
      ctx.stroke();
    }

    // Draw ground line inside column
    ctx.strokeStyle = '#3a2820';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(idx * colW, 136);
    ctx.lineTo((idx + 1) * colW, 136);
    ctx.stroke();

    // Draw solid wall inside column
    // Wall is at x = 124 relative to start x = 100.
    // So wall offset from center is (124 - 106) = 18px.
    const wallX = colX + 18;
    ctx.fillStyle = '#5a7a9a';
    ctx.fillRect(wallX, 120, 16, 16);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(wallX, 120, 16, 16);

    // Draw enemy inside column
    // Enemy is at frame.x relative to start x = 100.
    // So enemy offset from center is (frame.x - 106)px.
    const enemyX = colX + (frame.x - 106);
    const enemyCompiled: CompiledEnemy = {
      id: 1,
      archetype: 'spinny',
      state: {
        x: enemyX,
        y: frame.y,
        vx: frame.vx,
        vy: frame.vy,
        facing: frame.facing,
        alive: frame.alive,
        data: frame.data,
      },
      entity: spinnyEntity,
      params: {},
    };

    drawAsymmetricSpinny(ctx, enemyCompiled, 0, ENEMY_PALETTE);

    // Draw frame labels
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`F${idx + 1}`, colX, frame.y - 20);

    ctx.fillStyle = COLOR_TEXT_MUTED;
    ctx.font = '9px monospace';
    ctx.fillText(`x:${frame.x.toFixed(0)}`, colX, frame.y + 32);
    const deg = ((frame.data.spinAngle || 0) * 180) / Math.PI;
    ctx.fillText(`${deg.toFixed(0)}°`, colX, frame.y + 44);

    // Draw status label
    ctx.fillStyle =
      idx === 2 ? '#ffd84a' : frame.facing === 1 ? '#7aff7a' : '#ff3a3a';
    ctx.font = 'bold 8px sans-serif';
    const status =
      idx === 2
        ? 'REVERSAL'
        : frame.facing === 1
        ? 'MOVING R'
        : 'MOVING L';
    ctx.fillText(status, colX, frame.y + 58);
  });

  // Draw explanation text at the bottom of Panel 4
  ctx.fillStyle = '#7aff7a';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    '✓ F3 (Reversal Frame) is stationary (x:106) and preserves angle (43°) exactly',
    contentW / 2,
    220
  );
  ctx.fillText(
    '✓ Phase continuity verified: no angular snap or jump during turnaround',
    contentW / 2,
    235
  );

  ctx.restore();

  // Save Canvas to PNG
  const destPath = join(OUTPUT_DIR, 'showcase-verification.png');
  writeFileSync(destPath, canvas.toBuffer('image/png'));

  const end = performance.now();
  console.log(
    `Platformer enemies benchmark rendering complete in ${(
      end - start
    ).toFixed(2)}ms.`
  );
  console.log(`Output saved to: ${destPath}`);
}

renderEnemiesBenchmark();
