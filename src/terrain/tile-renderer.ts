/** Connected, culled deterministic tile terrain renderer. @module */

import type { TileGrid } from '../level/types';
import { mixChannel, mixNumber, finalizeSeed } from '../rng/visual-seed';
import { sampleTerrainNeighborhood } from './connectivity';
import { visibleTileRange } from './viewport';
import type { TerrainConnectionTable, TerrainViewport } from './types';
import type { TerrainMaterialTable } from './material';
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

export function drawTerrainTiles(
  ctx: CanvasRenderingContext2D,
  grid: Readonly<TileGrid>,
  options: Readonly<DrawTerrainTilesOptions>,
): void {
  const range = visibleTileRange(grid, options.view, options.overscanTiles);
  const include = options.includeValues;
  const overlap = 1 / (Number.isFinite(options.devicePixelRatio) && options.devicePixelRatio > 0
    ? options.devicePixelRatio : 1);
  const size = grid.tileSize;
  const detail = options.drawDetail ?? drawBuiltinTerrainDetail;
  const edgeDetail = options.drawEdgeDetail ?? drawBuiltinTerrainEdgeDetail;
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
      ctx.fillStyle = material.palette.fill;
      ctx.fillRect(x - left, y - top, size + left + right, size + top + bottom);
      if (!n.south && material.sideDepth > 0) {
        ctx.fillStyle = material.palette.side;
        ctx.fillRect(
          x - left,
          y + size - Math.min(size, material.sideDepth),
          size + left + right,
          Math.min(size, material.sideDepth),
        );
      }
      if (!n.north && material.topThickness > 0) {
        ctx.fillStyle = material.palette.top;
        ctx.fillRect(
          x - left,
          y,
          size + left + right,
          Math.min(size, material.topThickness),
        );
      }
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
}
