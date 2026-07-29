/** Role-aware rectangular terrain renderer. @module */

import type { LevelRect } from '../level/types';
import { finalizeSeed, mixChannel, mixNumber } from '../rng/visual-seed';
import type { NormalizedTerrainMaterial } from './material';
import type { TerrainDetailRenderer } from './surface-detail';
import type { TerrainRectExposure, TerrainRectRole } from './types';

export interface DrawTerrainRectOptions {
  readonly visualSeed: number;
  readonly devicePixelRatio: number;
  readonly entityKey: number;
  readonly role: TerrainRectRole;
  readonly material: NormalizedTerrainMaterial;
  readonly drawDetail?: TerrainDetailRenderer;
  readonly exposure?: Readonly<TerrainRectExposure>;
}

export function drawTerrainRect(
  ctx: CanvasRenderingContext2D,
  rect: Readonly<LevelRect>,
  options: Readonly<DrawTerrainRectOptions>,
): void {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return;
  const m = options.material;
  const full = options.exposure ?? {
    top: [{ start: rect.x, end: rect.x + rect.width }],
    right: [{ start: rect.y, end: rect.y + rect.height }],
    bottom: [{ start: rect.x, end: rect.x + rect.width }],
    left: [{ start: rect.y, end: rect.y + rect.height }],
  };
  if (options.role === 'hazard') {
    const spike = Math.max(3, Math.min(rect.height, m.cornerSize * 2 || 6));
    ctx.fillStyle = m.palette.fill;
    ctx.beginPath();
    ctx.moveTo(rect.x, rect.y + rect.height);
    for (let x = rect.x; x < rect.x + rect.width; x += spike) {
      ctx.lineTo(x + spike * 0.5, rect.y);
      ctx.lineTo(Math.min(x + spike, rect.x + rect.width), rect.y + rect.height);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = m.palette.outline; ctx.lineWidth = m.outlineWidth; ctx.stroke();
    return;
  }
  const bodyHeight = options.role === 'passthrough'
    ? Math.min(rect.height, Math.max(m.topThickness + m.sideDepth, 2))
    : rect.height;
  ctx.fillStyle = m.palette.fill;
  ctx.fillRect(rect.x, rect.y, rect.width, bodyHeight);
  if (options.role === 'moving') {
    ctx.fillStyle = m.palette.accent;
    const mark = Math.max(2, m.cornerSize);
    ctx.fillRect(rect.x + mark, rect.y + bodyHeight / 2 - 1, Math.max(0, rect.width - mark * 2), 2);
  }
  ctx.lineWidth = m.outlineWidth;
  ctx.strokeStyle = m.palette.outline;
  for (const span of full.top) {
    ctx.fillStyle = m.palette.top;
    ctx.fillRect(span.start, rect.y, span.end - span.start, Math.min(bodyHeight, m.topThickness));
    ctx.beginPath(); ctx.moveTo(span.start, rect.y); ctx.lineTo(span.end, rect.y); ctx.stroke();
  }
  for (const span of full.bottom) {
    ctx.beginPath(); ctx.moveTo(span.start, rect.y + bodyHeight); ctx.lineTo(span.end, rect.y + bodyHeight); ctx.stroke();
  }
  for (const [spans, x] of [[full.left, rect.x], [full.right, rect.x + rect.width]] as const) {
    for (const span of spans) {
      ctx.beginPath(); ctx.moveTo(x, span.start); ctx.lineTo(x, Math.min(span.end, rect.y + bodyHeight)); ctx.stroke();
    }
  }
  if (options.drawDetail !== undefined) {
    let seed = mixChannel(options.visualSeed, m.channelId);
    seed = mixNumber(seed, options.entityKey);
    try {
      options.drawDetail(ctx, {
        x: rect.x, y: rect.y, width: rect.width, height: bodyHeight,
        seed: finalizeSeed(seed), material: m,
      });
    } catch {
      // Isolate consumer detail failures per entity.
    }
  }
}
