/** Built-in, coordinate-addressed terrain surface details. @module */

import { mulberry32 } from '../rng/mulberry32';
import type { TerrainNeighborhood } from './types';
import type { NormalizedTerrainMaterial } from './material';

export interface TerrainDetailContext {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly neighborhood?: Readonly<TerrainNeighborhood>;
  readonly material: NormalizedTerrainMaterial;
}

export type TerrainDetailRenderer = (
  ctx: CanvasRenderingContext2D,
  detail: Readonly<TerrainDetailContext>,
) => void;

export const drawBuiltinTerrainDetail: TerrainDetailRenderer = (ctx, detail) => {
  const { material, x, y, width, height } = detail;
  if (material.surfaceDetail === 'none' || width <= 2 || height <= 2) return;
  const rng = mulberry32(detail.seed);
  if (rng() > material.detailDensity) return;
  const scale = material.detailScale;
  const px = x + 2 + rng() * Math.max(0, width - 4);
  const py = y + 2 + rng() * Math.max(0, height - 4);
  ctx.strokeStyle = material.palette.detail;
  ctx.fillStyle = material.palette.detail;
  ctx.lineWidth = Math.max(0.5, scale);
  ctx.beginPath();
  switch (material.surfaceDetail) {
    case 'mortar':
      ctx.moveTo(x, py); ctx.lineTo(x + width, py);
      ctx.moveTo(px, py); ctx.lineTo(px, Math.min(y + height, py + height * 0.45));
      ctx.stroke();
      break;
    case 'cracks':
    case 'rivulets':
      ctx.moveTo(px, y);
      ctx.lineTo(px - scale, py);
      ctx.lineTo(px + scale, Math.min(y + height, py + height * 0.35));
      ctx.stroke();
      break;
    case 'rivets': {
      const r = Math.max(0.75, scale);
      ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'crystal':
      ctx.moveTo(px, py - 2 * scale);
      ctx.lineTo(px + 2 * scale, py);
      ctx.lineTo(px, py + 2 * scale);
      ctx.lineTo(px - 2 * scale, py);
      ctx.closePath(); ctx.fill();
      break;
  }
};
