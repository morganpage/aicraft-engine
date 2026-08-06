/**
 * Cell-space drawing tools.
 *
 * Pure geometry: each tool turns a gesture into the list of cells it covers.
 * Nothing here touches the DOM, the project, or the canvas — which keeps the
 * interesting part (does the pencil skip cells on a fast drag?) testable
 * without a browser.
 */

/** A cell coordinate. */
export interface Cell {
  readonly cx: number;
  readonly cy: number;
}

/** The tools the editor offers. */
export type LdtkToolId =
  | 'pencil'
  | 'eraser'
  | 'line'
  | 'rectangle'
  | 'rectangleFilled'
  | 'fill'
  | 'picker'
  | 'entity';

/** Tools that preview a shape while dragging rather than painting immediately. */
export const PREVIEW_TOOLS: ReadonlySet<LdtkToolId> = new Set<LdtkToolId>([
  'line',
  'rectangle',
  'rectangleFilled',
]);

/**
 * Cells on the integer line between two points (Bresenham).
 *
 * Pointer events arrive far slower than a fast drag moves, so consecutive
 * samples can be many cells apart. Interpolating between them is what stops a
 * quick stroke from coming out as dots.
 */
export function lineCells(from: Cell, to: Cell): readonly Cell[] {
  const out: Cell[] = [];
  let x0 = Math.trunc(from.cx);
  let y0 = Math.trunc(from.cy);
  const x1 = Math.trunc(to.cx);
  const y1 = Math.trunc(to.cy);

  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;

  // Bounded so a malformed coordinate cannot spin forever.
  const limit = dx - dy + 2;
  for (let step = 0; step <= limit; step++) {
    out.push({ cx: x0, cy: y0 });
    if (x0 === x1 && y0 === y1) break;
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x0 += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y0 += sy;
    }
  }
  return out;
}

/** Cells forming a rectangle outline between two corners. */
export function rectangleOutlineCells(from: Cell, to: Cell): readonly Cell[] {
  const left = Math.min(from.cx, to.cx);
  const right = Math.max(from.cx, to.cx);
  const top = Math.min(from.cy, to.cy);
  const bottom = Math.max(from.cy, to.cy);
  const out: Cell[] = [];
  for (let cx = left; cx <= right; cx++) {
    out.push({ cx, cy: top });
    if (bottom !== top) out.push({ cx, cy: bottom });
  }
  for (let cy = top + 1; cy < bottom; cy++) {
    out.push({ cx: left, cy });
    if (right !== left) out.push({ cx: right, cy });
  }
  return out;
}

/** Cells filling a rectangle between two corners. */
export function rectangleFilledCells(from: Cell, to: Cell): readonly Cell[] {
  const left = Math.min(from.cx, to.cx);
  const right = Math.max(from.cx, to.cx);
  const top = Math.min(from.cy, to.cy);
  const bottom = Math.max(from.cy, to.cy);
  const out: Cell[] = [];
  for (let cy = top; cy <= bottom; cy++) {
    for (let cx = left; cx <= right; cx++) out.push({ cx, cy });
  }
  return out;
}

/**
 * Cells reachable from a seed that share its value (4-connected flood fill).
 *
 * Iterative rather than recursive: a large empty region would blow the call
 * stack, and levels routinely have thousands of contiguous empty cells.
 */
export function floodFillCells(
  seed: Cell,
  cols: number,
  rows: number,
  valueAt: (cx: number, cy: number) => number,
): readonly Cell[] {
  if (seed.cx < 0 || seed.cy < 0 || seed.cx >= cols || seed.cy >= rows) return [];
  const target = valueAt(seed.cx, seed.cy);
  const seen = new Uint8Array(cols * rows);
  const out: Cell[] = [];
  const stack: number[] = [seed.cx + seed.cy * cols];
  seen[stack[0]] = 1;

  while (stack.length > 0) {
    const index = stack.pop() as number;
    const cx = index % cols;
    const cy = Math.floor(index / cols);
    out.push({ cx, cy });

    const push = (nx: number, ny: number): void => {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return;
      const next = nx + ny * cols;
      if (seen[next] === 1) return;
      if (valueAt(nx, ny) !== target) return;
      seen[next] = 1;
      stack.push(next);
    };
    push(cx - 1, cy);
    push(cx + 1, cy);
    push(cx, cy - 1);
    push(cx, cy + 1);
  }
  return out;
}

/**
 * Cells a completed gesture covers.
 *
 * `pencil` and `eraser` receive an already-interpolated path; the shape tools
 * use only the gesture's endpoints.
 */
export function toolCells(
  tool: LdtkToolId,
  start: Cell,
  end: Cell,
  path: readonly Cell[],
  grid: { cols: number; rows: number; valueAt: (cx: number, cy: number) => number },
): readonly Cell[] {
  switch (tool) {
    case 'pencil':
    case 'eraser':
      return path;
    case 'line':
      return lineCells(start, end);
    case 'rectangle':
      return rectangleOutlineCells(start, end);
    case 'rectangleFilled':
      return rectangleFilledCells(start, end);
    case 'fill':
      return floodFillCells(end, grid.cols, grid.rows, grid.valueAt);
    case 'picker':
    case 'entity':
      // Entities are placed by pointer hit-testing, not cell painting, so the
      // cell tool produces no painted cells (mirroring `picker`).
      return [];
    default:
      return [];
  }
}
