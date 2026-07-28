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

/** Occasional low sprigs; the connected grass band supplies the main silhouette. */
const GRASS_TUFTS: readonly (readonly number[])[] = [
  [1, 2, 1],
  [1, 2, 2, 1],
  [1, 2, 3, 2, 1],
];

function randomSpan(
  rng: () => number,
  start: number,
  length: number,
  span: number,
): number {
  return Math.floor(start + rng() * Math.max(1, length - span));
}

function pickGrassTuft(rng: () => number, availableWidth: number): readonly number[] {
  let count = 0;
  while (
    count < GRASS_TUFTS.length &&
    (GRASS_TUFTS[count]?.length ?? 0) <= availableWidth
  ) {
    count++;
  }
  if (count === 0) return GRASS_TUFTS[0]!;
  return GRASS_TUFTS[Math.floor(rng() * count)] ?? GRASS_TUFTS[0]!;
}

/**
 * Draw a filled pixel tuft with a one-unit dark contour along its irregular
 * upper silhouette. Both layers stop exactly at the terrain surface; the
 * continuous top cap beneath them owns every pixel inside the tile.
 */
function drawGrassTuft(
  ctx: CanvasRenderingContext2D,
  startX: number,
  surfaceY: number,
  heights: readonly number[],
  unit: number,
  outline: string,
  fill: string,
): void {
  ctx.fillStyle = outline;
  for (let i = 0; i < heights.length; i++) {
    const height = (heights[i] ?? 1) * unit;
    ctx.fillRect(startX + i * unit, surfaceY - height, unit, height);
  }

  ctx.fillStyle = fill;
  for (let i = 0; i < heights.length; i++) {
    const height = (heights[i] ?? 1) * unit;
    if (height <= unit) continue;
    ctx.fillRect(
      startX + i * unit,
      surfaceY - height + unit,
      unit,
      height - unit,
    );
  }
}

function drawSubtleRockCapShade(
  ctx: CanvasRenderingContext2D,
  detail: Readonly<TerrainEdgeDetailContext>,
  rng: () => number,
): void {
  const { material: m, x, y, width, height } = detail;
  const capHeight = Math.max(1, Math.min(height, Math.round(m.topThickness)));
  const unit = Math.max(1, Math.round(m.edgeScale));
  const attempts = 2;
  const shadeChance = m.edgeDensity * 0.3;

  ctx.save();
  for (let i = 0; i < attempts; i++) {
    if (rng() > shadeChance) continue;
    const shadeWidth = Math.min(
      width - 2,
      unit * (4 + Math.floor(rng() * 4)),
    );
    const shadeX = randomSpan(rng, x + 1, width - 2, shadeWidth);
    const leftInset = capHeight > 1 ? Math.floor(rng() * 2) : 1;
    const middleInset = capHeight > 1 ? Math.floor(rng() * 2) : 1;

    // Broad translucent facets stay entirely inside the existing lit cap.
    // They suggest uneven stone without creating a second silhouette.
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = m.palette.detail;
    ctx.beginPath();
    ctx.moveTo(shadeX, y + capHeight);
    ctx.lineTo(shadeX + unit, y + Math.min(capHeight - 1, leftInset));
    ctx.lineTo(
      shadeX + shadeWidth * 0.58,
      y + Math.min(capHeight - 1, middleInset),
    );
    ctx.lineTo(shadeX + shadeWidth, y + capHeight);
    ctx.closePath();
    ctx.fill();

    if (rng() < 0.4) {
      const highlightWidth = Math.max(unit, Math.floor(shadeWidth * 0.42));
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = m.palette.accent;
      ctx.fillRect(shadeX + unit, y, highlightWidth, unit);
    }
  }
  ctx.restore();
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

    case 'stonework': {
      // Stonework is drawn across the complete exposed ledge by the tile
      // renderer. Drawing it per cell here would restart the masonry pattern
      // at every tile boundary.
      break;
    }

    case 'rocky': {
      if (!n.north) drawSubtleRockCapShade(ctx, detail, rng);
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
        const grassUnit = 1;
        const clusterCount = Math.max(1, Math.ceil(width / 24));
        const overhang = grassUnit * 2;
        const start = x - (n.west ? overhang : 0);
        const span = width
          + (n.west ? overhang : 0)
          + (n.east ? overhang : 0);

        for (let i = 0; i < clusterCount; i++) {
          if (rng() > m.edgeDensity * 0.3) continue;
          const tuft = pickGrassTuft(rng, Math.floor(span / grassUnit));
          const tuftWidth = tuft.length * grassUnit;
          const tuftX = randomSpan(rng, start, span, tuftWidth);
          drawGrassTuft(
            ctx,
            tuftX,
            y,
            tuft,
            grassUnit,
            m.palette.detail,
            rng() < 0.12 ? m.palette.accent : m.palette.top,
          );
        }
      }
      break;
    }
  }
};
