import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  stepProjectile,
  type ProjectileState,
} from '../../src/platformer/enemy';
import {
  computeShootToWidgetGeometry as computeProductionWidgetGeometry,
  SHOOT_TO_WIDGET_CONFIG,
} from '../../showcase/sections/playground-helpers';

const OUTPUT_DIR = 'benchmarks/turret-shoot-to';

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Inline shootTo resolution (mirrors production logic in registry.ts)
function resolveShootTo(shootTo: unknown): { dirX: number; dirY: number; maxRange: number } {
  if (!shootTo || typeof shootTo !== 'object') return { dirX: 1, dirY: 0, maxRange: 0 };
  const st = shootTo as Record<string, unknown>;
  const rawX = Number(st.x);
  const rawY = Number(st.y);
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return { dirX: 1, dirY: 0, maxRange: 0 };
  const magnitude = Math.hypot(rawX, rawY);
  if (magnitude === 0) return { dirX: 1, dirY: 0, maxRange: 0 };
  return { dirX: rawX / magnitude, dirY: rawY / magnitude, maxRange: magnitude };
}

// Inline widget geometry computation (mirrors production logic in playground-helpers.ts)
function computeShootToWidgetGeometry(
  tx: number, ty: number, tw: number, th: number, shootTo: unknown,
): { centerX: number; centerY: number; endX: number; endY: number; dirX: number; dirY: number; maxRange: number; labelText: string; handleX: number; handleY: number; handleRadius: number; rangeCircleRadius: number; arrowTipX: number; arrowTipY: number; arrowLeftX: number; arrowLeftY: number; arrowRightX: number; arrowRightY: number; labelX: number; labelY: number } {
  const resolved = resolveShootTo(shootTo);
  const cx = tx + tw / 2;
  const cy = ty + th / 2;
  const endX = cx + resolved.dirX * resolved.maxRange;
  const endY = cy + resolved.dirY * resolved.maxRange;
  const perpX = -resolved.dirY;
  const perpY = resolved.dirX;
  const aw = 6;
  const al = 12;
  const baseX = endX - resolved.dirX * al;
  const baseY = endY - resolved.dirY * al;
  const midX = (cx + endX) / 2;
  const midY = (cy + endY) / 2;
  return {
    centerX: cx, centerY: cy, endX, endY,
    dirX: resolved.dirX, dirY: resolved.dirY, maxRange: resolved.maxRange,
    labelText: resolved.maxRange > 0 ? `${Math.round(resolved.maxRange)}px` : 'no limit',
    handleX: endX, handleY: endY, handleRadius: 8,
    rangeCircleRadius: resolved.maxRange,
    arrowTipX: endX, arrowTipY: endY,
    arrowLeftX: baseX + perpX * aw, arrowLeftY: baseY + perpY * aw,
    arrowRightX: baseX - perpX * aw, arrowRightY: baseY - perpY * aw,
    labelX: midX + perpX * 14, labelY: midY + perpY * 14,
  };
}

// Inline trajectory simulation using production stepProjectile
function simulateTrajectory(
  tx: number, ty: number, tw: number, th: number,
  shootTo: unknown, speed: number, size: number, dt: number, maxTicks = 1000,
): ReadonlyArray<{ readonly x: number; readonly y: number; readonly tick: number }> {
  const resolved = resolveShootTo(shootTo);
  const spawnX = tx + tw / 2 - size / 2;
  const spawnY = ty + th / 2 - size / 2;
  let proj: ProjectileState = {
    x: spawnX, y: spawnY,
    vx: resolved.dirX * speed, vy: resolved.dirY * speed,
    width: size, height: size, alive: true,
    ...(resolved.maxRange > 0 ? { maxRange: resolved.maxRange, distanceTraveled: 0 } : {}),
  };
  const points: Array<{ x: number; y: number; tick: number }> = [
    { x: proj.x, y: proj.y, tick: 0 },
  ];
  for (let tick = 1; tick <= maxTicks; tick++) {
    const result = stepProjectile(proj, dt, []);
    points.push({ x: result.x, y: result.y, tick });
    if (!result.alive) break;
    proj = result;
  }
  return points;
}

// Helper to draw a rounded rectangle
function drawRoundedRect(
  ctx: any,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fillColor: string,
  strokeColor?: string,
  strokeWidth = 1
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
}

// Helper to draw a turret
function drawTurret(ctx: any, x: number, y: number, dirX: number, dirY: number): void {
  const size = 32;
  const cx = x + size / 2;
  const cy = y + size / 2;

  // Base
  drawRoundedRect(ctx, x, y, size, size, 6, '#475569', '#334155', 2);

  // Inner core
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#1e293b';
  ctx.fill();
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Nozzle
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + dirX * 18, cy + dirY * 18);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Nozzle tip highlight
  ctx.beginPath();
  ctx.arc(cx + dirX * 18, cy + dirY * 18, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#f1f5f9';
  ctx.fill();
}

/**
 * Render 1: Widget Treatments Comparison Sheet
 */
function renderWidgetTreatments(): void {
  const W = 1200;
  const H = 1120; // Increased to fit Case 4
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0f172a'; // Slate 900
  ctx.fillRect(0, 0, W, H);

  // Grid lines for editor feel
  ctx.strokeStyle = '#1e293b'; // Slate 800
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Header
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('Turret ShootTo Widget Treatments', 40, 50);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px sans-serif';
  ctx.fillText('Comparison of 3 editor widget treatments across different directions (Right, Up, Diagonal) and lengths (Short, Long)', 40, 75);

  // Columns: Treatments
  const colWidth = 360;
  const colGap = 40;
  const startX = 40;
  const startY = 160;
  const rowHeight = 220;

  const treatments = [
    {
      name: 'Treatment A: Minimalist Vector',
      desc: 'Dashed line, simple arrow, small handle, text label. Low clutter.',
      color: '#38bdf8', // Sky 400
      draw: (ctx: any, geom: any) => {
        // Trajectory line
        ctx.save();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(geom.centerX, geom.centerY);
        ctx.lineTo(geom.endX, geom.endY);
        ctx.stroke();
        ctx.restore();

        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(geom.arrowTipX, geom.arrowTipY);
        ctx.lineTo(geom.arrowLeftX, geom.arrowLeftY);
        ctx.lineTo(geom.arrowRightX, geom.arrowRightY);
        ctx.closePath();
        ctx.fillStyle = '#38bdf8';
        ctx.fill();

        // Handle
        ctx.beginPath();
        ctx.arc(geom.handleX, geom.handleY, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#0284c7'; // Sky 600
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(geom.labelText, geom.labelX, geom.labelY);
      }
    },
    {
      name: 'Treatment B: Full Range Ring',
      desc: 'Treatment A + dashed range circle. Shows complete coverage area.',
      color: '#06b6d4', // Cyan 500
      draw: (ctx: any, geom: any) => {
        // Range circle
        if (geom.rangeCircleRadius > 0) {
          ctx.save();
          ctx.strokeStyle = 'rgba(6, 182, 212, 0.35)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 6]);
          ctx.beginPath();
          ctx.arc(geom.centerX, geom.centerY, geom.rangeCircleRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Trajectory line
        ctx.save();
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(geom.centerX, geom.centerY);
        ctx.lineTo(geom.endX, geom.endY);
        ctx.stroke();
        ctx.restore();

        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(geom.arrowTipX, geom.arrowTipY);
        ctx.lineTo(geom.arrowLeftX, geom.arrowLeftY);
        ctx.lineTo(geom.arrowRightX, geom.arrowRightY);
        ctx.closePath();
        ctx.fillStyle = '#06b6d4';
        ctx.fill();

        // Handle
        ctx.beginPath();
        ctx.arc(geom.handleX, geom.handleY, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#0891b2'; // Cyan 600
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(geom.labelText, geom.labelX, geom.labelY);
      }
    },
    {
      name: 'Treatment C: High-Contrast Reticle',
      desc: 'Solid vector, target reticle handle, range fill, text pill. Max legibility.',
      color: '#fbbf24', // Amber 400
      draw: (ctx: any, geom: any) => {
        // Use production geometry and config
        const prodGeom = computeProductionWidgetGeometry(
          geom.centerX - 16,
          geom.centerY - 16,
          32,
          32,
          { x: geom.dirX * geom.maxRange, y: geom.dirY * geom.maxRange }
        );
        if (!prodGeom) return;

        const cfg = SHOOT_TO_WIDGET_CONFIG;

        // Faint amber range disk
        if (prodGeom.maxRange > 0) {
          ctx.beginPath();
          ctx.arc(prodGeom.centerX, prodGeom.centerY, prodGeom.maxRange, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(251, 191, 36, 0.03)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.15)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Solid amber vector line
        ctx.beginPath();
        ctx.moveTo(prodGeom.centerX, prodGeom.centerY);
        ctx.lineTo(prodGeom.endX, prodGeom.endY);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Arrowhead at endpoint
        const tipX = prodGeom.endX;
        const tipY = prodGeom.endY;
        const baseX = tipX - prodGeom.dirX * cfg.arrowLength;
        const baseY = tipY - prodGeom.dirY * cfg.arrowLength;
        const perpX = -prodGeom.dirY;
        const perpY = prodGeom.dirX;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(baseX + perpX * cfg.arrowHalfWidth, baseY + perpY * cfg.arrowHalfWidth);
        ctx.lineTo(baseX - perpX * cfg.arrowHalfWidth, baseY - perpY * cfg.arrowHalfWidth);
        ctx.closePath();
        ctx.fillStyle = '#fbbf24';
        ctx.fill();

        // Reticle handle — outer ring
        ctx.beginPath();
        ctx.arc(prodGeom.endX, prodGeom.endY, cfg.reticleOuterRadius, 0, Math.PI * 2);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Reticle handle — inner dot
        ctx.beginPath();
        ctx.arc(prodGeom.endX, prodGeom.endY, cfg.reticleInnerRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();

        // Reticle crosshair ticks
        const tickLen = cfg.reticleOuterRadius + cfg.reticleTickLength;
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(prodGeom.endX, prodGeom.endY - cfg.reticleOuterRadius);
        ctx.lineTo(prodGeom.endX, prodGeom.endY - tickLen);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(prodGeom.endX, prodGeom.endY + cfg.reticleOuterRadius);
        ctx.lineTo(prodGeom.endX, prodGeom.endY + tickLen);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(prodGeom.endX - cfg.reticleOuterRadius, prodGeom.endY);
        ctx.lineTo(prodGeom.endX - tickLen, prodGeom.endY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(prodGeom.endX + cfg.reticleOuterRadius, prodGeom.endY);
        ctx.lineTo(prodGeom.endX + tickLen, prodGeom.endY);
        ctx.stroke();

        // Distance pill (dark-blue text on amber background)
        const midX = (prodGeom.centerX + prodGeom.endX) / 2;
        const midY = (prodGeom.centerY + prodGeom.endY) / 2;
        const pillX = midX + perpX * cfg.pillOffset;
        const pillY = midY + perpY * cfg.pillOffset;

        ctx.font = 'bold 10px monospace';
        const textWidth = ctx.measureText(prodGeom.labelText).width;
        const pillW = textWidth + 12;
        const pillH = 18;
        const px = pillX - pillW / 2;
        const py = pillY - pillH / 2;

        // Pill background
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        const r = 4;
        ctx.moveTo(px + r, py);
        ctx.lineTo(px + pillW - r, py);
        ctx.quadraticCurveTo(px + pillW, py, px + pillW, py + r);
        ctx.lineTo(px + pillW, py + pillH - r);
        ctx.quadraticCurveTo(px + pillW, py + pillH, px + pillW - r, py + pillH);
        ctx.lineTo(px + r, py + pillH);
        ctx.quadraticCurveTo(px, py + pillH, px, py + pillH - r);
        ctx.lineTo(px, py + r);
        ctx.quadraticCurveTo(px, py, px + r, py);
        ctx.closePath();
        ctx.fill();

        // Pill text
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(prodGeom.labelText, pillX, pillY);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      }
    }
  ];

  const testCases = [
    {
      label: 'Case 1: Right, Long Vector (160px)',
      shootTo: { x: 160, y: 0 },
      turretOffset: { x: 80, y: 110 }
    },
    {
      label: 'Case 2: Up, Short Vector (45px)',
      shootTo: { x: 0, y: -45 },
      turretOffset: { x: 180, y: 150 }
    },
    {
      label: 'Case 3: Diagonal, Long Vector (120px)',
      shootTo: { x: 85, y: 85 }, // ~120px magnitude
      turretOffset: { x: 120, y: 80 }
    },
    {
      label: 'Case 4: Default Catalog Vector (128px)',
      shootTo: { x: 128, y: 0 },
      turretOffset: { x: 80, y: 110 }
    }
  ];

  // Draw Column Headers
  treatments.forEach((t, colIdx) => {
    const x = startX + colIdx * (colWidth + colGap);

    // Column Header Box
    drawRoundedRect(ctx, x, 105, colWidth, 45, 6, '#1e293b');
    ctx.fillStyle = t.color;
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(t.name, x + 12, 124);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.fillText(t.desc, x + 12, 142);
  });

  // Draw Rows
  testCases.forEach((tc, rowIdx) => {
    const y = startY + rowIdx * rowHeight;

    // Row label
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(tc.label.toUpperCase(), startX, y + 25);

    // Divider line below row label
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(startX, y + 35);
    ctx.lineTo(W - startX, y + 35);
    ctx.stroke();

    // Draw each treatment cell
    treatments.forEach((t, colIdx) => {
      const cellX = startX + colIdx * (colWidth + colGap);
      const cellY = y + 45;
      const cellW = colWidth;
      const cellH = rowHeight - 55;

      // Cell background
      ctx.fillStyle = '#0b0f19';
      ctx.fillRect(cellX, cellY, cellW, cellH);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.strokeRect(cellX, cellY, cellW, cellH);

      // Turret position in cell
      const tx = cellX + tc.turretOffset.x;
      const ty = cellY + tc.turretOffset.y;

      const resolved = resolveShootTo(tc.shootTo);
      const geom = computeShootToWidgetGeometry(tx, ty, 32, 32, tc.shootTo);

      // Draw widget treatment
      t.draw(ctx, geom);

      // Draw turret on top of the line start, but below handle
      drawTurret(ctx, tx, ty, resolved.dirX, resolved.dirY);
    });
  });

  // Save image
  const buffer = canvas.toBuffer('image/png');
  writeFileSync(join(OUTPUT_DIR, 'widget-treatments.png'), buffer);
  console.log('Rendered widget-treatments.png');
}

/**
 * Render 2: Trajectory Clamping Panel
 */
function renderTrajectoryClamping(): void {
  const W = 1000;
  const H = 700;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Header
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('Deterministic Trajectory & Range Clamping', 40, 50);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px sans-serif';
  ctx.fillText('Demonstrating that projectiles deactivate exactly at the authored maxRange distance across different vectors.', 40, 75);

  const startX = 60;
  const startY = 130;
  const rowHeight = 170;

  const testCases = [
    {
      name: 'Case A: Horizontal Right (Range: 180px, Speed: 180px/s, dt: 1/60s)',
      shootTo: { x: 180, y: 0 },
      speed: 180,
      size: 6,
      dt: 1 / 60,
      turretX: 100,
      turretY: 50,
    },
    {
      name: 'Case B: Vertical Up (Range: 100px, Speed: 200px/s, dt: 1/60s)',
      shootTo: { x: 0, y: -100 },
      speed: 200,
      size: 6,
      dt: 1 / 60,
      turretX: 100,
      turretY: 130,
    },
    {
      name: 'Case C: Diagonal 45° Down-Right (Range: 150px, Speed: 150px/s, dt: 1/60s)',
      shootTo: { x: 106, y: 106 }, // ~150px magnitude
      speed: 150,
      size: 6,
      dt: 1 / 60,
      turretX: 100,
      turretY: 40,
    }
  ];

  testCases.forEach((tc, idx) => {
    const y = startY + idx * rowHeight;

    // Panel background
    drawRoundedRect(ctx, startX, y, W - startX * 2, rowHeight - 30, 6, '#0b0f19', '#1e293b', 1);

    // Case title
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(tc.name, startX + 20, y + 25);

    // Draw Turret
    const resolved = resolveShootTo(tc.shootTo);
    const tx = startX + tc.turretX;
    const ty = y + tc.turretY;
    drawTurret(ctx, tx, ty, resolved.dirX, resolved.dirY);

    // Simulate trajectory
    const points = simulateTrajectory(tx, ty, 32, 32, tc.shootTo, tc.speed, tc.size, tc.dt);

    // Draw range limit boundary marker
    const cx = tx + 16;
    const cy = ty + 16;
    const rx = cx + resolved.dirX * resolved.maxRange;
    const ry = cy + resolved.dirY * resolved.maxRange;

    // Draw range boundary line
    ctx.save();
    ctx.strokeStyle = '#ef4444'; // Red 500
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    if (resolved.dirX === 0) {
      // Vertical line
      ctx.moveTo(rx - 20, ry);
      ctx.lineTo(rx + 20, ry);
    } else if (resolved.dirY === 0) {
      // Horizontal line
      ctx.moveTo(rx, ry - 20);
      ctx.lineTo(rx, ry + 20);
    } else {
      // Perpendicular line segment
      const px = -resolved.dirY;
      const py = resolved.dirX;
      ctx.moveTo(rx - px * 20, ry - py * 20);
      ctx.lineTo(rx + px * 20, ry + py * 20);
    }
    ctx.stroke();
    ctx.restore();

    // Draw trajectory path line
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(rx, ry);
    ctx.stroke();

    // Draw each step
    let finalDist = 0;
    let finalTick = 0;
    let finalPx = 0;
    let finalPy = 0;

    points.forEach((pt, pIdx) => {
      const isFirst = pIdx === 0;
      const isLast = pIdx === points.length - 1;

      // Projectile center
      const px = pt.x + tc.size / 2;
      const py = pt.y + tc.size / 2;

      if (isLast) {
        finalDist = Math.hypot(px - cx, py - cy);
        finalTick = pt.tick;
        finalPx = px;
        finalPy = py;

        // Draw deactivation marker (Red X)
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px - 5, py - 5);
        ctx.lineTo(px + 5, py + 5);
        ctx.moveTo(px + 5, py - 5);
        ctx.lineTo(px - 5, py + 5);
        ctx.stroke();

        // Draw a clean, non-overlapping label next to the X
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 9px monospace';
        ctx.fillText(`X (t${pt.tick})`, px + 8, py + 3);
      } else if (!isFirst) {
        // Draw active projectile step
        ctx.beginPath();
        ctx.arc(px, py, tc.size / 2, 0, Math.PI * 2);
        ctx.fillStyle = '#38bdf8'; // Sky 400
        ctx.fill();

        // Draw tick number spaced out and offset perpendicularly to avoid overlapping the line
        if (pIdx % 10 === 0 || pIdx === 1) {
          const perpX = -resolved.dirY;
          const perpY = resolved.dirX;
          const labelX = px + perpX * 12;
          const labelY = py + perpY * 12;

          ctx.fillStyle = '#64748b';
          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`t${pt.tick}`, labelX, labelY);
        }
      }
    });

    // Draw a beautiful, high-contrast summary box on the right side of the panel
    const summaryX = W - startX - 280;
    const summaryY = y + 15;
    const summaryW = 260;
    const summaryH = rowHeight - 60;
    drawRoundedRect(ctx, summaryX, summaryY, summaryW, summaryH, 4, '#1e293b', '#334155', 1);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('SIMULATION METRICS', summaryX + 15, summaryY + 22);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText(`Authored Range:  ${resolved.maxRange.toFixed(1)}px`, summaryX + 15, summaryY + 42);
    ctx.fillText(`Final Distance:  ${finalDist.toFixed(1)}px`, summaryX + 15, summaryY + 57);

    // Highlight overshoot in green if 0, red if not
    const overshoot = finalDist - resolved.maxRange;
    ctx.fillText(`Overshoot:       `, summaryX + 15, summaryY + 72);
    ctx.fillStyle = Math.abs(overshoot) < 0.01 ? '#10b981' : '#ef4444';
    ctx.fillText(`${overshoot.toFixed(4)}px`, summaryX + 120, summaryY + 72);

    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`Deactivated At:  Tick ${finalTick}`, summaryX + 15, summaryY + 87);
  });

  // Save image
  const buffer = canvas.toBuffer('image/png');
  writeFileSync(join(OUTPUT_DIR, 'trajectory-clamping.png'), buffer);
  console.log('Rendered trajectory-clamping.png');
}

// Run both renders
renderWidgetTreatments();
renderTrajectoryClamping();
