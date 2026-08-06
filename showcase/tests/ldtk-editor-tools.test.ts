/**
 * Editor tool geometry and viewport maths.
 *
 * These are the parts of the editor that are wrong in ways a screenshot will
 * not reveal: a pencil that skips cells on a fast drag, a fill that overflows
 * the grid, a fit that rounds up into a scrollbar.
 */

import { describe, expect, it } from 'vitest';
import {
  floodFillCells,
  lineCells,
  rectangleFilledCells,
  rectangleOutlineCells,
  toolCells,
  PREVIEW_TOOLS,
} from '../sections/ldtk-editor/tools';
import {
  clampViewport,
  fitViewport,
  screenToCell,
  snapZoom,
  zoomAbout,
  zoomIn,
  zoomOut,
  ZOOM_STEPS,
} from '../sections/ldtk-editor/viewport';

describe('lineCells', () => {
  it('returns a single cell when start and end coincide', () => {
    expect(lineCells({ cx: 3, cy: 4 }, { cx: 3, cy: 4 })).toEqual([{ cx: 3, cy: 4 }]);
  });

  it('leaves no gaps on a fast diagonal drag', () => {
    // The whole point of interpolating: consecutive cells must touch, or a
    // quick stroke paints a dotted line.
    const cells = lineCells({ cx: 0, cy: 0 }, { cx: 20, cy: 13 });
    expect(cells[0]).toEqual({ cx: 0, cy: 0 });
    expect(cells[cells.length - 1]).toEqual({ cx: 20, cy: 13 });
    for (let i = 1; i < cells.length; i++) {
      const dx = Math.abs(cells[i].cx - cells[i - 1].cx);
      const dy = Math.abs(cells[i].cy - cells[i - 1].cy);
      expect(Math.max(dx, dy)).toBe(1);
    }
  });

  it('works in every direction', () => {
    for (const [ex, ey] of [[5, 0], [-5, 0], [0, 5], [0, -5], [-4, -7], [7, -4]] as const) {
      const cells = lineCells({ cx: 0, cy: 0 }, { cx: ex, cy: ey });
      expect(cells[cells.length - 1]).toEqual({ cx: ex, cy: ey });
    }
  });
});

describe('rectangle tools', () => {
  it('outlines a rectangle without filling it', () => {
    const cells = rectangleOutlineCells({ cx: 0, cy: 0 }, { cx: 3, cy: 2 });
    expect(cells).toHaveLength(10); // perimeter of a 4x3 block
    expect(cells).not.toContainEqual({ cx: 1, cy: 1 });
    expect(cells).toContainEqual({ cx: 0, cy: 1 });
  });

  it('fills a rectangle', () => {
    expect(rectangleFilledCells({ cx: 0, cy: 0 }, { cx: 3, cy: 2 })).toHaveLength(12);
  });

  it('normalizes corners dragged in any direction', () => {
    const a = rectangleFilledCells({ cx: 5, cy: 5 }, { cx: 2, cy: 1 });
    const b = rectangleFilledCells({ cx: 2, cy: 1 }, { cx: 5, cy: 5 });
    expect(a).toEqual(b);
  });

  it('handles a degenerate one-cell rectangle', () => {
    expect(rectangleOutlineCells({ cx: 2, cy: 2 }, { cx: 2, cy: 2 })).toEqual([{ cx: 2, cy: 2 }]);
  });
});

describe('floodFillCells', () => {
  //  0 0 1
  //  0 1 1
  //  0 0 1
  const cols = 3;
  const rows = 3;
  const grid = [0, 0, 1, 0, 1, 1, 0, 0, 1];
  const valueAt = (cx: number, cy: number): number => grid[cx + cy * cols];

  it('fills only the connected region of equal value', () => {
    const cells = floodFillCells({ cx: 0, cy: 0 }, cols, rows, valueAt);
    expect(cells).toHaveLength(5);
    expect(cells).not.toContainEqual({ cx: 2, cy: 0 });
  });

  it('is 4-connected, not 8-connected', () => {
    // (1,1) is solid; the empties above-left and below-left of it must not be
    // joined through the diagonal.
    const diagonal = [1, 0, 0, 1];
    const cells = floodFillCells({ cx: 1, cy: 0 }, 2, 2, (cx, cy) => diagonal[cx + cy * 2]);
    expect(cells).toEqual([{ cx: 1, cy: 0 }]);
  });

  it('returns nothing for a seed outside the grid', () => {
    expect(floodFillCells({ cx: -1, cy: 0 }, cols, rows, valueAt)).toEqual([]);
    expect(floodFillCells({ cx: 0, cy: 99 }, cols, rows, valueAt)).toEqual([]);
  });

  it('fills a large uniform grid without exhausting the stack', () => {
    const big = 200;
    const cells = floodFillCells({ cx: 0, cy: 0 }, big, big, () => 0);
    expect(cells).toHaveLength(big * big);
  });
});

describe('toolCells', () => {
  const grid = { cols: 4, rows: 4, valueAt: (): number => 0 };

  it('uses the interpolated path for freehand tools', () => {
    const path = [{ cx: 0, cy: 0 }, { cx: 1, cy: 0 }];
    expect(toolCells('pencil', { cx: 0, cy: 0 }, { cx: 1, cy: 0 }, path, grid)).toBe(path);
    expect(toolCells('eraser', { cx: 0, cy: 0 }, { cx: 1, cy: 0 }, path, grid)).toBe(path);
  });

  it('uses only the endpoints for shape tools', () => {
    expect(toolCells('line', { cx: 0, cy: 0 }, { cx: 3, cy: 0 }, [], grid)).toHaveLength(4);
    expect(toolCells('rectangleFilled', { cx: 0, cy: 0 }, { cx: 1, cy: 1 }, [], grid)).toHaveLength(4);
  });

  it('paints nothing for the picker', () => {
    expect(toolCells('picker', { cx: 0, cy: 0 }, { cx: 1, cy: 1 }, [], grid)).toEqual([]);
  });

  it('marks exactly the shape tools as previewing', () => {
    expect([...PREVIEW_TOOLS].sort()).toEqual(['line', 'rectangle', 'rectangleFilled']);
  });
});

describe('viewport', () => {
  it('snaps zoom down to an allowed step', () => {
    expect(snapZoom(1.06)).toBe(1);
    expect(snapZoom(2.99)).toBe(2);
    expect(ZOOM_STEPS).toContain(snapZoom(3));
  });

  it('steps zoom in and out without escaping the range', () => {
    expect(zoomIn(1)).toBe(1.5);
    expect(zoomOut(1)).toBe(0.75);
    expect(zoomOut(ZOOM_STEPS[0])).toBe(ZOOM_STEPS[0]);
    expect(zoomIn(ZOOM_STEPS[ZOOM_STEPS.length - 1])).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  });

  it('fits content inside the view without overflowing', () => {
    const content = { width: 848, height: 336 };
    const view = { width: 900, height: 520 };
    const vp = fitViewport(content, view);
    // Snapped down, so the scaled content can never exceed the view.
    expect(content.width * vp.scale).toBeLessThanOrEqual(view.width);
    expect(content.height * vp.scale).toBeLessThanOrEqual(view.height);
    expect(ZOOM_STEPS).toContain(vp.scale);
  });

  it('centres the content when fitting', () => {
    const vp = fitViewport({ width: 100, height: 100 }, { width: 400, height: 400 });
    // A 100x100 content at 4x fills the view exactly, so the origin is 0.
    expect(vp).toEqual({ x: 0, y: 0, scale: 4 });
  });

  it('survives zero-sized content', () => {
    expect(fitViewport({ width: 0, height: 0 }, { width: 10, height: 10 }))
      .toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('keeps the world point under the cursor fixed while zooming', () => {
    const before = { x: 100, y: 50, scale: 1 };
    const screenX = 300;
    const screenY = 200;
    const worldBefore = { x: before.x + screenX, y: before.y + screenY };
    const after = zoomAbout(before, 2, screenX, screenY);
    expect(after.x + screenX / 2).toBeCloseTo(worldBefore.x);
    expect(after.y + screenY / 2).toBeCloseTo(worldBefore.y);
  });

  it('floors negative world coordinates to the correct cell', () => {
    // Truncation would put -1 in cell 0 and make painting near the top-left
    // land one cell inside.
    const vp = { x: -32, y: -32, scale: 1 };
    expect(screenToCell(vp, 0, 0, 16)).toEqual({ cx: -2, cy: -2 });
    expect(screenToCell(vp, 24, 24, 16)).toEqual({ cx: -1, cy: -1 });
    expect(screenToCell(vp, 48, 48, 16)).toEqual({ cx: 1, cy: 1 });
  });

  it('accounts for zoom when converting to cells', () => {
    expect(screenToCell({ x: 0, y: 0, scale: 2 }, 64, 64, 16)).toEqual({ cx: 2, cy: 2 });
  });

  it('clamps panning to keep the content reachable', () => {
    const content = { width: 800, height: 400 };
    const view = { width: 400, height: 200 };
    const far = clampViewport({ x: 99999, y: 99999, scale: 1 }, content, view);
    expect(far.x).toBeLessThan(content.width);
    expect(far.y).toBeLessThan(content.height);
    const negative = clampViewport({ x: -99999, y: -99999, scale: 1 }, content, view);
    expect(negative.x).toBeGreaterThan(-view.width);
    expect(negative.y).toBeGreaterThan(-view.height);
  });
});
