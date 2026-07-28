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

function usesFacetedStone(
  material: Readonly<NormalizedTerrainMaterial>,
): boolean {
  return material.edgeDetail === 'stonework' || material.edgeDetail === 'rocky';
}

function drawTileBase(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  overlap: Readonly<{ left: number; right: number; top: number; bottom: number }>,
  neighborhood: Readonly<TerrainNeighborhood>,
  material: Readonly<NormalizedTerrainMaterial>,
  visualSeed: number,
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
  const grassContour = material.edgeDetail === 'grass';
  const stoneContour = usesFacetedStone(material);
  const organicLeft = (grassContour || stoneContour) && !neighborhood.west;
  const organicRight = (grassContour || stoneContour) && !neighborhood.east;
  const rounded = topLeftRadius > 0
    || topRightRadius > 0
    || bottomLeftRadius > 0
    || bottomRightRadius > 0;
  const shaped = rounded || organicLeft || organicRight;

  if (shaped) {
    const leftX = x - left;
    const rightX = x + size + right;
    const topY = y - top;
    const bottomY = y + size + bottom;
    const sideScale = Math.max(0.75, Math.min(2, size / 16));
    const sideSpacing = grassContour
      ? Math.max(4, Math.round(6 * sideScale))
      : Math.max(4, Math.round((material.edgeDetail === 'rocky' ? 5 : 7) * sideScale));
    const sideAmplitude = grassContour
      ? Math.min(1.25, 0.65 * sideScale)
      : Math.min(
        material.edgeDetail === 'rocky' ? 1.5 : 1,
        (material.edgeDetail === 'rocky' ? 0.8 : 0.55) * sideScale,
      );
    const sidePoints = grassContour ? organicSidePoints : facetedSidePoints;
    const rightSide = organicRight
      ? sidePoints(
        rightX,
        topY + topRightRadius,
        bottomY - bottomRightRadius,
        sideSpacing,
        sideAmplitude,
        -1,
        visualSeed,
        material,
        0x52474854,
      )
      : [];
    const leftSide = organicLeft
      ? sidePoints(
        leftX,
        topY + topLeftRadius,
        bottomY - bottomLeftRadius,
        sideSpacing,
        sideAmplitude,
        1,
        visualSeed,
        material,
        0x4c465454,
      )
      : [];
    if (topRightRadius > 0 && rightSide[0] !== undefined) {
      rightSide[0] = { x: rightX, y: rightSide[0].y };
    }
    if (bottomRightRadius > 0 && rightSide[rightSide.length - 1] !== undefined) {
      const lastIndex = rightSide.length - 1;
      rightSide[lastIndex] = { x: rightX, y: rightSide[lastIndex]!.y };
    }
    if (topLeftRadius > 0 && leftSide[0] !== undefined) {
      leftSide[0] = { x: leftX, y: leftSide[0].y };
    }
    if (bottomLeftRadius > 0 && leftSide[leftSide.length - 1] !== undefined) {
      const lastIndex = leftSide.length - 1;
      leftSide[lastIndex] = { x: leftX, y: leftSide[lastIndex]!.y };
    }
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(leftX + topLeftRadius, topY);
    ctx.lineTo(rightX - topRightRadius, topY);
    if (topRightRadius > 0) {
      ctx.quadraticCurveTo(rightX, topY, rightX, topY + topRightRadius);
    } else {
      ctx.lineTo(rightX, topY);
    }
    if (rightSide.length > 0) {
      for (const point of rightSide) ctx.lineTo(point.x, point.y);
    } else {
      ctx.lineTo(rightX, bottomY - bottomRightRadius);
    }
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
    if (leftSide.length > 0) {
      for (let i = leftSide.length - 1; i >= 0; i--) {
        const point = leftSide[i]!;
        ctx.lineTo(point.x, point.y);
      }
    } else {
      ctx.lineTo(leftX, topY + topLeftRadius);
    }
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

  if (shaped) ctx.restore();
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

function organicSideValue(
  visualSeed: number,
  material: Readonly<NormalizedTerrainMaterial>,
  coordinate: number,
  spacing: number,
  salt: number,
): number {
  const position = coordinate / spacing;
  const lower = Math.floor(position);
  const mix = position - lower;
  const smooth = mix * mix * (3 - 2 * mix);
  const a = organicNoise(visualSeed, material, lower, salt);
  const b = organicNoise(visualSeed, material, lower + 1, salt);
  return a + (b - a) * smooth;
}

function organicSidePoints(
  baseX: number,
  startY: number,
  endY: number,
  spacing: number,
  amplitude: number,
  direction: -1 | 1,
  visualSeed: number,
  material: Readonly<NormalizedTerrainMaterial>,
  salt: number,
): WavePoint[] {
  const points: WavePoint[] = [];
  const addPoint = (pointY: number): void => {
    const noise = organicSideValue(
      visualSeed,
      material,
      pointY,
      spacing,
      salt,
    );
    points.push({
      x: baseX + direction * amplitude * (0.2 + noise * 0.8),
      y: pointY,
    });
  };
  addPoint(startY);
  for (let pointY = Math.ceil(startY); pointY < endY; pointY++) {
    if (pointY > startY) addPoint(pointY);
  }
  if (endY > startY) addPoint(endY);
  return points;
}

function facetedSideValue(
  visualSeed: number,
  material: Readonly<NormalizedTerrainMaterial>,
  coordinate: number,
  spacing: number,
  salt: number,
): number {
  const position = coordinate / spacing;
  const lower = Math.floor(position);
  const mix = position - lower;
  const a = organicNoise(visualSeed, material, lower, salt);
  const b = organicNoise(visualSeed, material, lower + 1, salt);
  return a + (b - a) * mix;
}

function facetedSidePoints(
  baseX: number,
  startY: number,
  endY: number,
  spacing: number,
  amplitude: number,
  direction: -1 | 1,
  visualSeed: number,
  material: Readonly<NormalizedTerrainMaterial>,
  salt: number,
): WavePoint[] {
  const point = (pointY: number): WavePoint => ({
    x: baseX + direction * amplitude * (
      0.2 + facetedSideValue(
        visualSeed,
        material,
        pointY,
        spacing,
        salt,
      ) * 0.8
    ),
    y: pointY,
  });
  const points: WavePoint[] = [point(startY)];
  const firstAnchor = (Math.floor(startY / spacing) + 1) * spacing;
  for (let anchor = firstAnchor; anchor < endY; anchor += spacing) {
    points.push(point(anchor));
  }
  if (endY > startY) points.push(point(endY));
  return points;
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

function drawFacetedStoneBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  tileSize: number,
  kind: 'top' | 'side',
  visualSeed: number,
  material: Readonly<NormalizedTerrainMaterial>,
): void {
  const rightX = x + width;
  const natural = material.edgeDetail === 'rocky';
  const scale = Math.max(0.75, Math.min(2, tileSize / 16));
  const spacing = Math.max(
    4,
    Math.round((natural ? 5 : 7) * scale),
  );
  const outerAmplitude = Math.min(
    natural ? 2 : 1.5,
    (natural ? 1.1 : 0.72) * scale,
  );
  const innerAmplitude = Math.min(
    natural ? 2.5 : 2,
    (natural ? 1.5 : 1.05) * scale,
  );
  const upperAmplitude = kind === 'top' ? outerAmplitude : innerAmplitude;
  const lowerAmplitude = kind === 'top' ? innerAmplitude : outerAmplitude;
  const upper = organicWavePoints(
    x,
    rightX,
    y,
    spacing,
    upperAmplitude,
    -1,
    visualSeed,
    material,
    kind === 'top' ? 0x53544f50 : 0x53555050,
  );
  const lower = organicWavePoints(
    x,
    rightX,
    y + height,
    spacing,
    lowerAmplitude,
    1,
    visualSeed,
    material,
    kind === 'top' ? 0x534c4f57 : 0x53424f54,
  );
  const reversedLower = [...lower].reverse();

  ctx.beginPath();
  ctx.moveTo(upper[0]!.x, upper[0]!.y);
  for (let i = 1; i < upper.length; i++) {
    ctx.lineTo(upper[i]!.x, upper[i]!.y);
  }
  if (reversedLower.length > 0) {
    ctx.lineTo(reversedLower[0]!.x, reversedLower[0]!.y);
    for (let i = 1; i < reversedLower.length; i++) {
      ctx.lineTo(reversedLower[i]!.x, reversedLower[i]!.y);
    }
  }
  ctx.closePath();
  ctx.fillStyle = kind === 'top'
    ? material.palette.top
    : material.palette.side;
  ctx.fill();
}

/**
 * Scatter differently sized square shades across a connected Ruins ledge.
 * Squares are positioned on a world-space texture grid rather than per tile,
 * and use fills only—there are no strokes, joints, or cell divisions.
 */
function drawRuinsSquareShading(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  tileSize: number,
  exposedLeft: boolean,
  exposedRight: boolean,
  exposedTop: boolean,
  visualSeed: number,
  material: Readonly<NormalizedTerrainMaterial>,
): void {
  const unit = Math.max(1, Math.round(tileSize / 16));
  const insetLeft = exposedLeft ? unit : 0;
  const insetRight = exposedRight ? unit : 0;
  const leftX = x + insetLeft;
  const rightX = x + width - insetRight;
  const topY = y + (exposedTop ? unit : 0);
  const bottomY = y + height;
  if (rightX <= leftX || bottomY <= topY) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(leftX, topY, rightX - leftX, bottomY - topY);
  ctx.clip();

  const step = unit * 3;
  const firstCol = Math.floor(leftX / step) - 1;
  const lastCol = Math.ceil(rightX / step) + 1;
  const firstRow = Math.floor(topY / step) - 1;
  const lastRow = Math.ceil(bottomY / step) + 1;
  const presenceChance = 0.46 + material.edgeDensity * 0.44;

  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const coordinate = col * 8191 + row;
      const presence = organicNoise(
        visualSeed,
        material,
        coordinate,
        0x52535150,
      );
      if (presence > presenceChance) continue;

      const sizeNoise = organicNoise(
        visualSeed,
        material,
        coordinate,
        0x52535153,
      );
      const xNoise = organicNoise(
        visualSeed,
        material,
        coordinate,
        0x52535158,
      );
      const yNoise = organicNoise(
        visualSeed,
        material,
        coordinate,
        0x52535159,
      );
      const toneNoise = organicNoise(
        visualSeed,
        material,
        coordinate,
        0x52535154,
      );
      const squareSize = unit * (1 + Math.floor(sizeNoise * 3));
      const slack = Math.max(0, step - squareSize);
      const squareX = col * step + Math.round(xNoise * slack);
      const squareY = row * step + Math.round(yNoise * slack);
      const nearExposedTop = exposedTop
        && squareY + squareSize / 2 < y + tileSize * 0.38;

      if (nearExposedTop) {
        ctx.fillStyle = material.palette.top;
        ctx.globalAlpha = 0.14 + toneNoise * 0.14;
      } else if (toneNoise > 0.82) {
        ctx.fillStyle = material.palette.top;
        ctx.globalAlpha = 0.08 + toneNoise * 0.08;
      } else {
        ctx.fillStyle = toneNoise > 0.62
          ? material.palette.side
          : material.palette.detail;
        ctx.globalAlpha = 0.14 + toneNoise * 0.14;
      }
      ctx.fillRect(squareX, squareY, squareSize, squareSize);
    }
  }
  ctx.restore();
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
        } else if (
          usesFacetedStone(first.material) &&
          usesFacetedStone(last.material)
        ) {
          drawFacetedStoneBand(
            ctx,
            first.x,
            first.y + size - firstHeight,
            width,
            firstHeight,
            size,
            'side',
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
        } else if (
          usesFacetedStone(first.material) &&
          usesFacetedStone(last.material)
        ) {
          drawFacetedStoneBand(
            ctx,
            first.x,
            first.y,
            width,
            firstHeight,
            size,
            'top',
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
        options.visualSeed,
      );
      tiles.push({ col, row, x, y, neighborhood: n, material });
    }
  }

  // Ruins texture is drawn after every base tile exists, so a world-space
  // square crossing an internal boundary cannot be overwritten by the next
  // tile's overlap. The exact tile clips meet without sharing pixels.
  for (const tile of tiles) {
    if (tile.material.edgeDetail !== 'stonework') continue;
    drawRuinsSquareShading(
      ctx,
      tile.x,
      tile.y,
      size,
      size,
      size,
      !tile.neighborhood.west,
      !tile.neighborhood.east,
      !tile.neighborhood.north,
      options.visualSeed,
      tile.material,
    );
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
