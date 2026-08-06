import type { TileGrid } from '../level/types';
import { terrainArtLinePixels } from './pixel-tools';
import type { TerrainArtGridCell } from './types';

function inBounds(grid: Readonly<TileGrid>, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < grid.cols && row < grid.rows;
}

export function paintTerrainArtLogicalCells(grid: Readonly<TileGrid>, cells: readonly Readonly<TerrainArtGridCell>[], tileValue: number): TileGrid {
  const data = [...grid.data];
  for (const { col, row } of cells) if (inBounds(grid, col, row)) data[row * grid.cols + col] = tileValue;
  return { ...grid, data };
}

export function terrainArtLogicalLine(from: Readonly<TerrainArtGridCell>, to: Readonly<TerrainArtGridCell>): TerrainArtGridCell[] {
  return terrainArtLinePixels({ x: from.col, y: from.row }, { x: to.col, y: to.row }).map(({ x, y }) => ({ col: x, row: y }));
}

export function terrainArtLogicalRectangle(from: Readonly<TerrainArtGridCell>, to: Readonly<TerrainArtGridCell>, filled = true): TerrainArtGridCell[] {
  const left = Math.min(from.col, to.col); const right = Math.max(from.col, to.col);
  const top = Math.min(from.row, to.row); const bottom = Math.max(from.row, to.row);
  const result: TerrainArtGridCell[] = [];
  for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
    if (filled || row === top || row === bottom || col === left || col === right) result.push({ col, row });
  }
  return result;
}

export function terrainArtLogicalFill(grid: Readonly<TileGrid>, start: Readonly<TerrainArtGridCell>): TerrainArtGridCell[] {
  if (!inBounds(grid, start.col, start.row)) return [];
  const target = grid.data[start.row * grid.cols + start.col];
  const visited = new Uint8Array(grid.cols * grid.rows); const queue = [start]; const result: TerrainArtGridCell[] = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor]!; const index = cell.row * grid.cols + cell.col;
    if (visited[index]) continue; visited[index] = 1;
    if (grid.data[index] !== target) continue; result.push(cell);
    if (cell.col > 0) queue.push({ col: cell.col - 1, row: cell.row });
    if (cell.col + 1 < grid.cols) queue.push({ col: cell.col + 1, row: cell.row });
    if (cell.row > 0) queue.push({ col: cell.col, row: cell.row - 1 });
    if (cell.row + 1 < grid.rows) queue.push({ col: cell.col, row: cell.row + 1 });
  }
  return result;
}

export function pickTerrainArtLogicalValue(grid: Readonly<TileGrid>, cell: Readonly<TerrainArtGridCell>): number | null {
  return inBounds(grid, cell.col, cell.row) ? grid.data[cell.row * grid.cols + cell.col] ?? null : null;
}
