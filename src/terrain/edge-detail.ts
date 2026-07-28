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

/** Angular silhouettes used by both broken masonry and natural boulders. */
const ROCK_PROFILES: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 0], [0.12, 0.42], [0.35, 0.82], [0.58, 1], [0.82, 0.72], [1, 0.2]],
  [[0, 0.1], [0.16, 0.58], [0.4, 0.78], [0.7, 0.74], [0.9, 0.42], [1, 0]],
  [[0, 0], [0.22, 0.36], [0.48, 1], [0.66, 0.86], [0.84, 0.4], [1, 0.12]],
  [[0, 0.08], [0.1, 0.52], [0.3, 0.7], [0.52, 0.62], [0.76, 0.9], [1, 0.18]],
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

function drawRock(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  width: number,
  height: number,
  unit: number,
  profile: readonly (readonly [number, number])[],
  outline: string,
  fill: string,
  highlight: string,
): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = unit;

  ctx.beginPath();
  for (let i = 0; i < profile.length; i++) {
    const point = profile[i]!;
    const px = Math.round(x + point[0] * width);
    const py = Math.round(baseY - point[1] * height);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.lineTo(x + width, baseY);
  ctx.lineTo(x, baseY);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.stroke();

  // A short inset highlight follows the upper-facing facets without turning
  // into a straight cap line.
  ctx.beginPath();
  const highlightEnd = Math.max(2, Math.ceil(profile.length * 0.6));
  for (let i = 1; i < highlightEnd; i++) {
    const point = profile[i]!;
    const px = Math.round(x + point[0] * width);
    const py = Math.round(baseY - point[1] * height + unit);
    if (i === 1) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = highlight;
  ctx.lineWidth = unit;
  ctx.stroke();
  ctx.restore();
}

function drawRockTopEdge(
  ctx: CanvasRenderingContext2D,
  detail: Readonly<TerrainEdgeDetailContext>,
  rng: () => number,
  natural: boolean,
): void {
  const { material: m, neighborhood: n, x, y, width } = detail;
  const baseUnit = Math.max(1, Math.round(m.edgeScale));
  const unit = Math.max(baseUnit, Math.min(2, Math.floor(width / 16)));
  const spacing = (natural ? 11 : 9) * unit;
  const clusters = Math.max(1, Math.ceil(width / spacing));
  const topDepth = Math.max(1, Math.round(m.topThickness));
  const overhang = unit * 2;
  const segmentWidth = width / clusters;

  for (let i = 0; i < clusters; i++) {
    const segmentX = x + i * segmentWidth;
    const canOverhangLeft = i > 0 || n.west;
    const canOverhangRight = i < clusters - 1 || n.east;
    const start = segmentX - (canOverhangLeft ? overhang : 0);
    const span = segmentWidth
      + (canOverhangLeft ? overhang : 0)
      + (canOverhangRight ? overhang : 0);

    // A darker rear stone makes the edge read as a shallow pile rather than a
    // row of independent bumps.
    if (rng() <= m.edgeDensity * 0.72) {
      const rockWidth = Math.min(
        span,
        unit * ((natural ? 5 : 4) + Math.floor(rng() * 4)),
      );
      const rockHeight = unit * ((natural ? 3 : 2) + Math.floor(rng() * 3));
      const rockX = randomSpan(rng, start, span, rockWidth);
      const profile = ROCK_PROFILES[Math.floor(rng() * ROCK_PROFILES.length)]
        ?? ROCK_PROFILES[0]!;
      drawRock(
        ctx,
        rockX,
        y + Math.max(unit, topDepth - unit),
        rockWidth,
        rockHeight,
        unit,
        profile,
        m.palette.outline,
        m.palette.side,
        m.palette.fill,
      );
    }

    if (rng() > m.edgeDensity) continue;
    const rockWidth = Math.min(
      span,
      unit * ((natural ? 7 : 6) + Math.floor(rng() * (natural ? 6 : 4))),
    );
    const rockHeight = unit * ((natural ? 4 : 3) + Math.floor(rng() * (natural ? 4 : 3)));
    const rockX = randomSpan(rng, start, span, rockWidth);
    const profile = ROCK_PROFILES[Math.floor(rng() * ROCK_PROFILES.length)]
      ?? ROCK_PROFILES[0]!;
    drawRock(
      ctx,
      rockX,
      y + topDepth,
      rockWidth,
      rockHeight,
      unit,
      profile,
      m.palette.outline,
      m.palette.fill,
      m.palette.top,
    );
  }
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
      if (!n.north) drawRockTopEdge(ctx, detail, rng, false);
      if (!n.south && chance()) {
        const chipW = Math.min(width - 2, unit * (1 + Math.floor(rng() * 2)));
        const chipX = randomSpan(rng, x + 1, width - 2, chipW);
        ctx.fillStyle = m.palette.fill;
        ctx.fillRect(chipX, y + height - sideDepth, chipW, unit);
      }
      break;
    }

    case 'rocky': {
      if (!n.north) drawRockTopEdge(ctx, detail, rng, true);
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
