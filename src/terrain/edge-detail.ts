/**
 * Built-in procedural treatments for exposed terrain silhouettes.
 *
 * Every primitive stays on, or immediately outside, an exposed edge. The
 * connected terrain body remains plain so decoration cannot reveal tile-cell
 * boundaries.
 *
 * @module
 */

import { mulberry32 } from '../rng/mulberry32';
import type { NormalizedTerrainMaterial } from './material';
import type { TerrainNeighborhood } from './types';

export interface TerrainEdgeDetailContext {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly neighborhood: Readonly<TerrainNeighborhood>;
  readonly material: NormalizedTerrainMaterial;
}

export type TerrainEdgeDetailRenderer = (
  ctx: CanvasRenderingContext2D,
  detail: Readonly<TerrainEdgeDetailContext>,
) => void;

const EDGE_SEED_SALT = 0x45444745;

function randomSpan(
  rng: () => number,
  start: number,
  length: number,
  span: number,
): number {
  return Math.floor(start + rng() * Math.max(1, length - span));
}

/** Draw restrained, deterministic decoration on exposed terrain edges. */
export const drawBuiltinTerrainEdgeDetail: TerrainEdgeDetailRenderer = (
  ctx,
  detail,
) => {
  const { material: m, neighborhood: n, x, y, width, height } = detail;
  if (m.edgeDetail === 'none' || width <= 2 || height <= 2) return;

  const rng = mulberry32((detail.seed ^ EDGE_SEED_SALT) >>> 0);
  const unit = Math.max(1, Math.round(m.edgeScale));
  const chance = (): boolean => rng() <= m.edgeDensity;
  const topDepth = Math.max(1, Math.min(height, Math.round(m.topThickness)));
  const sideDepth = Math.max(1, Math.min(height, Math.round(m.sideDepth)));

  switch (m.edgeDetail) {
    case 'chipped': {
      if (!n.north && chance()) {
        const chipW = Math.min(width - 2, unit * (1 + Math.floor(rng() * 3)));
        const chipH = Math.min(topDepth, unit * (1 + Math.floor(rng() * 2)));
        const chipX = randomSpan(rng, x + 1, width - 2, chipW);
        ctx.fillStyle = m.palette.fill;
        ctx.fillRect(chipX, y, chipW, chipH);
      }
      if (!n.south && chance()) {
        const chipW = Math.min(width - 2, unit * (1 + Math.floor(rng() * 2)));
        const chipH = Math.min(sideDepth, unit);
        const chipX = randomSpan(rng, x + 1, width - 2, chipW);
        ctx.fillStyle = m.palette.fill;
        ctx.fillRect(chipX, y + height - sideDepth, chipW, chipH);
      }
      break;
    }

    case 'rocky': {
      if (!n.north && chance()) {
        const rockW = Math.min(width - 2, unit * (2 + Math.floor(rng() * 3)));
        const rockH = unit * (1 + Math.floor(rng() * 2));
        const rockX = randomSpan(rng, x + 1, width - 2, rockW);
        ctx.fillStyle = m.palette.top;
        ctx.fillRect(rockX, y - rockH, rockW, rockH);
        if (rockW > unit * 2) {
          ctx.fillStyle = m.palette.fill;
          ctx.fillRect(rockX + unit, y - rockH, rockW - unit * 2, unit);
        }
      }
      if (!n.south && chance()) {
        const rockW = Math.min(width - 2, unit * (1 + Math.floor(rng() * 3)));
        const rockH = unit * (1 + Math.floor(rng() * 2));
        const rockX = randomSpan(rng, x + 1, width - 2, rockW);
        ctx.fillStyle = m.palette.side;
        ctx.fillRect(rockX, y + height, rockW, rockH);
      }
      if (!n.west && chance() && rng() < 0.45) {
        const rockH = Math.min(height - 2, unit * (1 + Math.floor(rng() * 3)));
        const rockY = randomSpan(rng, y + 1, height - 2, rockH);
        ctx.fillStyle = m.palette.fill;
        ctx.fillRect(x - unit, rockY, unit, rockH);
      }
      if (!n.east && chance() && rng() < 0.45) {
        const rockH = Math.min(height - 2, unit * (1 + Math.floor(rng() * 3)));
        const rockY = randomSpan(rng, y + 1, height - 2, rockH);
        ctx.fillStyle = m.palette.fill;
        ctx.fillRect(x + width, rockY, unit, rockH);
      }
      break;
    }

    case 'beveled': {
      if (!n.north && chance()) {
        const notchW = Math.min(width - 2, unit * (2 + Math.floor(rng() * 3)));
        const notchX = randomSpan(rng, x + 1, width - 2, notchW);
        ctx.fillStyle = m.palette.shadow;
        ctx.fillRect(notchX, y, notchW, unit);
      }
      if (!n.south && chance()) {
        const notchW = Math.min(width - 2, unit * (2 + Math.floor(rng() * 2)));
        const notchX = randomSpan(rng, x + 1, width - 2, notchW);
        ctx.fillStyle = m.palette.fill;
        ctx.fillRect(notchX, y + height - unit, notchW, unit);
      }
      break;
    }

    case 'grass': {
      if (!n.north) {
        const candidates = Math.max(2, Math.floor(width / Math.max(3, unit * 4)));
        for (let i = 0; i < candidates; i++) {
          if (!chance()) continue;
          const bladeX = Math.floor(x + 1 + rng() * Math.max(1, width - 2));
          const bladeH = unit * (1 + Math.floor(rng() * 3));
          ctx.fillStyle = rng() < 0.22 ? m.palette.accent : m.palette.top;
          ctx.fillRect(bladeX, y - bladeH, unit, bladeH);
        }
      }
      if (!n.south && chance()) {
        const clodW = Math.min(width - 2, unit * (1 + Math.floor(rng() * 3)));
        const clodH = unit * (1 + Math.floor(rng() * 2));
        const clodX = randomSpan(rng, x + 1, width - 2, clodW);
        ctx.fillStyle = m.palette.side;
        ctx.fillRect(clodX, y + height, clodW, clodH);
      }
      break;
    }
  }
};
