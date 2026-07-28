/** Connected, culled deterministic tile terrain renderer. @module */

import type { TileGrid } from '../level/types';
import { mixChannel, mixNumber, finalizeSeed } from '../rng/visual-seed';
import { sampleTerrainNeighborhood } from './connectivity';
import { visibleTileRange } from './viewport';
import type { TerrainConnectionTable, TerrainViewport } from './types';
import type { NormalizedTerrainMaterial, TerrainMaterialTable } from './material';
import {
  drawBuiltinTerrainEdgeDetail,
  type TerrainEdgeDetailRenderer,
} from './edge-detail';
import { drawBuiltinTerrainDetail, type TerrainDetailRenderer } from './surface-detail';

export interface DrawTerrainTilesOptions {
  readonly visualSeed: number;
  readonly view: Readonly<TerrainViewport>;
  readonly devicePixelRatio: number;
  readonly materials: TerrainMaterialTable;
  readonly connections: TerrainConnectionTable;
  readonly drawDetail?: TerrainDetailRenderer;
  readonly drawEdgeDetail?: TerrainEdgeDetailRenderer;
  readonly includeValues?: readonly number[];
  readonly overscanTiles?: number;
}

type TerrainNeighborhood = ReturnType<typeof sampleTerrainNeighborhood>;

interface TerrainTileDrawRecord {
  readonly col: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly neighborhood: Readonly<TerrainNeighborhood>;
  readonly material: NormalizedTerrainMaterial;
}

function grassCornerRadius(
  size: number,
  material: Readonly<NormalizedTerrainMaterial>,
): number {
  const grassCornerScale = Math.max(1, Math.min(2, Math.floor(size / 16)));
  return Math.floor(Math.min(
    size / 3,
    material.cornerSize * grassCornerScale,
  ));
}

function drawTileBase(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  overlap: Readonly<{ left: number; right: number; top: number; bottom: number }>,
  neighborhood: Readonly<TerrainNeighborhood>,
  material: Readonly<NormalizedTerrainMaterial>,
): void {
  const { left, right, top, bottom } = overlap;
  const grassCorner = grassCornerRadius(size, material);
  const roundTopLeft = material.edgeDetail === 'grass'
    && !neighborhood.north
    && !neighborhood.west;
  const roundTopRight = material.edgeDetail === 'grass'
    && !neighborhood.north
    && !neighborhood.east;
  const roundBottomLeft = material.edgeDetail === 'grass'
    && !neighborhood.south
    && !neighborhood.west;
  const roundBottomRight = material.edgeDetail === 'grass'
    && !neighborhood.south
    && !neighborhood.east;
  const topLeftRadius = roundTopLeft ? grassCorner : 0;
  const topRightRadius = roundTopRight ? grassCorner : 0;
  const bottomLeftRadius = roundBottomLeft ? grassCorner : 0;
  const bottomRightRadius = roundBottomRight ? grassCorner : 0;
  const rounded = topLeftRadius > 0
    || topRightRadius > 0
    || bottomLeftRadius > 0
    || bottomRightRadius > 0;

  if (rounded) {
    const leftX = x - left;
    const rightX = x + size + right;
    const topY = y - top;
    const bottomY = y + size + bottom;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(leftX + topLeftRadius, topY);
    ctx.lineTo(rightX - topRightRadius, topY);
    if (topRightRadius > 0) {
      ctx.quadraticCurveTo(rightX, topY, rightX, topY + topRightRadius);
    } else {
      ctx.lineTo(rightX, topY);
    }
    ctx.lineTo(rightX, bottomY - bottomRightRadius);
    if (bottomRightRadius > 0) {
      ctx.quadraticCurveTo(rightX, bottomY, rightX - bottomRightRadius, bottomY);
    } else {
      ctx.lineTo(rightX, bottomY);
    }
    ctx.lineTo(leftX + bottomLeftRadius, bottomY);
    if (bottomLeftRadius > 0) {
      ctx.quadraticCurveTo(leftX, bottomY, leftX, bottomY - bottomLeftRadius);
    } else {
      ctx.lineTo(leftX, bottomY);
    }
    ctx.lineTo(leftX, topY + topLeftRadius);
    if (topLeftRadius > 0) {
      ctx.quadraticCurveTo(leftX, topY, leftX + topLeftRadius, topY);
    } else {
      ctx.lineTo(leftX, topY);
    }
    ctx.closePath();
    ctx.clip();
  }

  ctx.fillStyle = material.palette.fill;
  ctx.fillRect(
    x - left,
    y - top,
    size + left + right,
    size + top + bottom,
  );

  if (rounded) ctx.restore();
}

function drawTopBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  bodyHeight: number,
  leftRadius: number,
  rightRadius: number,
  color: string,
): void {
  ctx.fillStyle = color;
  if (leftRadius <= 0 && rightRadius <= 0) {
    ctx.fillRect(x, y, width, height);
    return;
  }

  const rightX = x + width;
  const bottomY = y + bodyHeight;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + leftRadius, y);
  ctx.lineTo(rightX - rightRadius, y);
  if (rightRadius > 0) {
    ctx.quadraticCurveTo(rightX, y, rightX, y + rightRadius);
  } else {
    ctx.lineTo(rightX, y);
  }
  ctx.lineTo(rightX, bottomY);
  ctx.lineTo(x, bottomY);
  ctx.lineTo(x, y + leftRadius);
  if (leftRadius > 0) {
    ctx.quadraticCurveTo(x, y, x + leftRadius, y);
  } else {
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.clip();
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

interface WavePoint {
  readonly x: number;
  readonly y: number;
}

function organicNoise(
  visualSeed: number,
  material: Readonly<NormalizedTerrainMaterial>,
  coordinate: number,
  salt: number,
): number {
  let seed = mixChannel(visualSeed, material.channelId);
  seed = mixNumber(seed, Math.floor(coordinate));
  seed = mixNumber(seed, salt);
  return finalizeSeed(seed) / 0xffffffff;
}

function organicWavePoints(
  startX: number,
  endX: number,
  baseY: number,
  spacing: number,
  amplitude: number,
  direction: -1 | 1,
  visualSeed: number,
  material: Readonly<NormalizedTerrainMaterial>,
  salt: number,
): WavePoint[] {
  const points: WavePoint[] = [];
  const firstAnchor = Math.floor(startX / spacing) * spacing;
  const lastAnchor = Math.ceil(endX / spacing) * spacing;
  for (let anchor = firstAnchor; anchor <= lastAnchor; anchor += spacing) {
    if (anchor < startX || anchor > endX) continue;
    const noise = organicNoise(visualSeed, material, anchor / spacing, salt);
    points.push({
      x: anchor,
      y: baseY + direction * amplitude * (0.2 + noise * 0.8),
    });
  }
  if (points[0]?.x !== startX) {
    const noise = organicNoise(visualSeed, material, startX / spacing, salt);
    points.unshift({
      x: startX,
      y: baseY + direction * amplitude * (0.2 + noise * 0.8),
    });
  }
  if (points[points.length - 1]?.x !== endX) {
    const noise = organicNoise(visualSeed, material, endX / spacing, salt);
    points.push({
      x: endX,
      y: baseY + direction * amplitude * (0.2 + noise * 0.8),
    });
  }
  return points;
}

function traceSmoothWave(
  ctx: CanvasRenderingContext2D,
  points: readonly WavePoint[],
): void {
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]!;
    const point = points[i]!;
    const controlX = (previous.x + point.x) / 2;
    ctx.bezierCurveTo(
      controlX,
      previous.y,
      controlX,
      point.y,
      point.x,
      point.y,
    );
  }
}

function drawOrganicGrassBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  tileSize: number,
  leftRadius: number,
  rightRadius: number,
  visualSeed: number,
  material: Readonly<NormalizedTerrainMaterial>,
): void {
  const rightX = x + width;
  const topStart = x + leftRadius;
  const topEnd = rightX - rightRadius;
  const scale = Math.max(0.75, Math.min(2, tileSize / 16));
  const spacing = Math.max(4, Math.round(6 * scale));
  const topAmplitude = Math.min(1.5, 0.75 * scale);
  const bottomAmplitude = Math.min(3, 1.8 * scale);
  const top = organicWavePoints(
    topStart,
    topEnd,
    y,
    spacing,
    topAmplitude,
    -1,
    visualSeed,
    material,
    0x544f50,
  );
  const bottom = organicWavePoints(
    x,
    rightX,
    y + height,
    spacing,
    bottomAmplitude,
    1,
    visualSeed,
    material,
    0x424f54,
  );

  if (leftRadius > 0 && top[0] !== undefined) {
    top[0] = { x: top[0].x, y };
  }
  if (rightRadius > 0 && top[top.length - 1] !== undefined) {
    const lastIndex = top.length - 1;
    top[lastIndex] = { x: top[lastIndex]!.x, y };
  }

  const reversedBottom = [...bottom].reverse();
  ctx.beginPath();
  if (leftRadius > 0) {
    ctx.moveTo(x, y + leftRadius);
    ctx.quadraticCurveTo(x, y, topStart, y);
  } else {
    ctx.moveTo(top[0]!.x, top[0]!.y);
  }
  if (top.length > 0) {
    ctx.lineTo(top[0]!.x, top[0]!.y);
    traceSmoothWave(ctx, top);
  }
  if (rightRadius > 0) {
    ctx.quadraticCurveTo(rightX, y, rightX, y + rightRadius);
  }
  if (reversedBottom.length > 0) {
    ctx.lineTo(reversedBottom[0]!.x, reversedBottom[0]!.y);
    traceSmoothWave(ctx, reversedBottom);
  }
  ctx.lineTo(x, y + leftRadius);
  ctx.closePath();
  ctx.fillStyle = material.palette.top;
  ctx.fill();
}

function drawOrganicMudBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  tileSize: number,
  leftRadius: number,
  rightRadius: number,
  visualSeed: number,
  material: Readonly<NormalizedTerrainMaterial>,
): void {
  const rightX = x + width;
  const bottomY = y + height;
  const bottomStart = x + leftRadius;
  const bottomEnd = rightX - rightRadius;
  const scale = Math.max(0.75, Math.min(2, tileSize / 16));
  const spacing = Math.max(4, Math.round(6 * scale));
  const topAmplitude = Math.min(3, 1.8 * scale);
  const bottomAmplitude = Math.min(1.5, 0.75 * scale);
  const top = organicWavePoints(
    x,
    rightX,
    y,
    spacing,
    topAmplitude,
    -1,
    visualSeed,
    material,
    0x4d544f,
  );
  const bottom = organicWavePoints(
    bottomStart,
    bottomEnd,
    bottomY,
    spacing,
    bottomAmplitude,
    1,
    visualSeed,
    material,
    0x4d424f,
  );
  if (leftRadius > 0 && bottom[0] !== undefined) {
    bottom[0] = { x: bottom[0].x, y: bottomY };
  }
  if (rightRadius > 0 && bottom[bottom.length - 1] !== undefined) {
    const lastIndex = bottom.length - 1;
    bottom[lastIndex] = { x: bottom[lastIndex]!.x, y: bottomY };
  }
  const reversedBottom = [...bottom].reverse();

  ctx.beginPath();
  ctx.moveTo(top[0]!.x, top[0]!.y);
  traceSmoothWave(ctx, top);
  if (rightRadius > 0) {
    ctx.lineTo(rightX, bottomY - rightRadius);
    ctx.quadraticCurveTo(rightX, bottomY, bottomEnd, bottomY);
  }
  if (reversedBottom.length > 0) {
    ctx.lineTo(reversedBottom[0]!.x, reversedBottom[0]!.y);
    traceSmoothWave(ctx, reversedBottom);
  }
  if (leftRadius > 0) {
    ctx.quadraticCurveTo(x, bottomY, x, bottomY - leftRadius);
  }
  ctx.closePath();
  ctx.fillStyle = material.palette.side;
  ctx.fill();
}

function drawConnectedTerrainBands(
  ctx: CanvasRenderingContext2D,
  tiles: readonly Readonly<TerrainTileDrawRecord>[],
  size: number,
  visualSeed: number,
): void {
  for (const kind of ['side', 'top'] as const) {
    for (let i = 0; i < tiles.length;) {
      const first = tiles[i]!;
      const firstExposed = kind === 'top'
        ? !first.neighborhood.north
        : !first.neighborhood.south;
      const firstHeight = Math.min(
        size,
        kind === 'top' ? first.material.topThickness : first.material.sideDepth,
      );
      if (!firstExposed || firstHeight <= 0) {
        i++;
        continue;
      }

      const color = kind === 'top'
        ? first.material.palette.top
        : first.material.palette.side;
      let lastIndex = i;
      while (lastIndex + 1 < tiles.length) {
        const previous = tiles[lastIndex]!;
        const next = tiles[lastIndex + 1]!;
        const nextExposed = kind === 'top'
          ? !next.neighborhood.north
          : !next.neighborhood.south;
        const nextHeight = Math.min(
          size,
          kind === 'top' ? next.material.topThickness : next.material.sideDepth,
        );
        const nextColor = kind === 'top'
          ? next.material.palette.top
          : next.material.palette.side;
        if (
          next.row !== previous.row ||
          next.col !== previous.col + 1 ||
          !previous.neighborhood.east ||
          !next.neighborhood.west ||
          !nextExposed ||
          nextHeight !== firstHeight ||
          nextColor !== color ||
          (
            next.material.edgeDetail !== first.material.edgeDetail ||
            next.material.channelId !== first.material.channelId
          )
        ) {
          break;
        }
        lastIndex++;
      }

      const last = tiles[lastIndex]!;
      const width = last.x + size - first.x;
      if (kind === 'side') {
        const leftRadius = first.material.edgeDetail === 'grass'
          && !first.neighborhood.west
          ? grassCornerRadius(size, first.material)
          : 0;
        const rightRadius = last.material.edgeDetail === 'grass'
          && !last.neighborhood.east
          ? grassCornerRadius(size, last.material)
          : 0;
        if (
          first.material.edgeDetail === 'grass' &&
          last.material.edgeDetail === 'grass'
        ) {
          drawOrganicMudBand(
            ctx,
            first.x,
            first.y + size - firstHeight,
            width,
            firstHeight,
            size,
            leftRadius,
            rightRadius,
            visualSeed,
            first.material,
          );
        } else {
          ctx.fillStyle = color;
          ctx.fillRect(first.x, first.y + size - firstHeight, width, firstHeight);
        }
      } else {
        const leftRadius = first.material.edgeDetail === 'grass'
          && !first.neighborhood.west
          ? grassCornerRadius(size, first.material)
          : 0;
        const rightRadius = last.material.edgeDetail === 'grass'
          && !last.neighborhood.east
          ? grassCornerRadius(size, last.material)
          : 0;
        if (
          first.material.edgeDetail === 'grass' &&
          last.material.edgeDetail === 'grass'
        ) {
          drawOrganicGrassBand(
            ctx,
            first.x,
            first.y,
            width,
            firstHeight,
            size,
            leftRadius,
            rightRadius,
            visualSeed,
            first.material,
          );
        } else {
          drawTopBand(
            ctx,
            first.x,
            first.y,
            width,
            firstHeight,
            size,
            leftRadius,
            rightRadius,
            color,
          );
        }
      }
      i = lastIndex + 1;
    }
  }
}

export function drawTerrainTiles(
  ctx: CanvasRenderingContext2D,
  grid: Readonly<TileGrid>,
  options: Readonly<DrawTerrainTilesOptions>,
): void {
  const range = visibleTileRange(grid, options.view, options.overscanTiles);
  const include = options.includeValues;
  const overlap = 2 / (Number.isFinite(options.devicePixelRatio) && options.devicePixelRatio > 0
    ? options.devicePixelRatio : 1);
  const size = grid.tileSize;
  const detail = options.drawDetail ?? drawBuiltinTerrainDetail;
  const edgeDetail = options.drawEdgeDetail ?? drawBuiltinTerrainEdgeDetail;
  const tiles: TerrainTileDrawRecord[] = [];
  for (let row = range.startRow; row < range.endRow; row++) {
    for (let col = range.startCol; col < range.endCol; col++) {
      const value = grid.data[row * grid.cols + col];
      if (value === undefined || (include !== undefined && !include.includes(value))) continue;
      const material = options.materials.get(value);
      if (material === undefined) continue;
      const n = sampleTerrainNeighborhood(grid, col, row, options.connections.connects);
      const x = col * size;
      const y = row * size;
      const left = n.west ? overlap : 0;
      const right = n.east ? overlap : 0;
      const top = n.north ? overlap : 0;
      const bottom = n.south ? overlap : 0;
      drawTileBase(
        ctx,
        x,
        y,
        size,
        { left, right, top, bottom },
        n,
        material,
      );
      tiles.push({ col, row, x, y, neighborhood: n, material });
    }
  }

  // Caps and undersides are deliberately emitted as one primitive per
  // connected horizontal span. Per-cell rectangles can reveal their shared
  // anti-aliased edges when a canvas is magnified or resampled, even when the
  // logical pixels happen to compare equal at 1×.
  drawConnectedTerrainBands(ctx, tiles, size, options.visualSeed);

  for (const tile of tiles) {
    const { col, row, x, y, neighborhood: n, material } = tile;
    let seed = mixChannel(options.visualSeed, material.channelId);
    seed = mixNumber(seed, col);
    seed = mixNumber(seed, row);
    try {
      detail(ctx, { x, y, width: size, height: size, seed: finalizeSeed(seed), neighborhood: n, material });
    } catch {
      // A detail plug-in may fail one tile without aborting the terrain pass.
    }
    try {
      edgeDetail(ctx, {
        x,
        y,
        width: size,
        height: size,
        seed: finalizeSeed(seed),
        neighborhood: n,
        material,
      });
    } catch {
      // A detail plug-in may fail one tile without aborting the terrain pass.
    }
  }
}
