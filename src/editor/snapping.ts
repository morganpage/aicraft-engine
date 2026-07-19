/**
 * Snapping helpers for the editor (Pillar 4 — Level Editor Core).
 *
 * Pure math functions for grid snapping and edge alignment. No DOM, no
 * rendering — the reference editor issues draw calls based on the
 * returned {@link SnapGuide} array.
 *
 * All exports are pure: inputs are never mutated, fresh values are
 * returned each call.
 *
 * @module
 */

import type { LevelRect } from '../level/types';
import type { SnapGuide } from './types';
import { DEFAULT_GRID_SIZE, DEFAULT_SNAP_THRESHOLD } from './constants';

/**
 * Round `v` to the nearest multiple of `grid`. Half-values round toward
 * positive infinity (matches `Math.round` for positive inputs).
 *
 * Normalises `-0` to `+0` (matches the convention in `src/primitives/parallax.ts`).
 */
function roundToMultiple(v: number, grid: number): number {
  const result = Math.round(v / grid) * grid;
  return result === 0 ? 0 : result;
}

/**
 * Snap a point to the nearest grid intersection. **Pure.**
 *
 * @example
 * ```ts
 * snapToGrid(17, 22, 16); // { x: 16, y: 16 }
 * snapToGrid(20, 30, 16); // { x: 16, y: 32 }
 * ```
 *
 * @param x        - World X to snap.
 * @param y        - World Y to snap.
 * @param gridSize - Grid size in world units (defaults to {@link DEFAULT_GRID_SIZE}).
 * @returns A new point with coordinates rounded to the nearest grid multiple.
 */
export function snapToGrid(
  x: number,
  y: number,
  gridSize: number = DEFAULT_GRID_SIZE,
): { readonly x: number; readonly y: number } {
  return { x: roundToMultiple(x, gridSize), y: roundToMultiple(y, gridSize) };
}

/**
 * Snap all four edges of a rect to the grid (effectively snaps the
 * top-left corner; the width and height are preserved). **Pure.**
 *
 * @param rect     - Rect to snap.
 * @param gridSize - Grid size in world units (defaults to {@link DEFAULT_GRID_SIZE}).
 * @returns A new rect with `x` and `y` rounded to the nearest grid multiple.
 */
export function snapRectToGrid(
  rect: LevelRect,
  gridSize: number = DEFAULT_GRID_SIZE,
): LevelRect {
  return {
    x: roundToMultiple(rect.x, gridSize),
    y: roundToMultiple(rect.y, gridSize),
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Edge-align `movedRect` against any of `otherRects` if they are within
 * `threshold` pixels. **Pure.**
 *
 * For each of the four edges (left, right, top, bottom) of `movedRect`,
 * check each edge of each rect in `otherRects`. If any pair is within
 * `threshold`, snap the moved rect's edge to the other rect's edge and
 * emit a {@link SnapGuide} for UI rendering.
 *
 * Multiple edges may snap simultaneously (e.g. left and top both align
 * to two different reference rects). Only the closest reference is
 * snapped per axis.
 *
 * @example
 * ```ts
 * const result = snapToEdges(
 *   { x: 95, y: 0, width: 16, height: 16 },
 *   [{ x: 80, y: 0, width: 16, height: 16 }],
 *   4,
 * );
 * // result.rect.x === 96 (snapped from 95 to align right edge with 96)
 * // result.guides has one entry on the x axis at position 96
 * ```
 *
 * @param movedRect  - The rect being dragged.
 * @param otherRects - Reference rects (typically the other entities in the level).
 * @param threshold  - Snap distance in pixels (defaults to {@link DEFAULT_SNAP_THRESHOLD}).
 * @returns `{ rect, guides }` — `rect` may equal `movedRect` if no snap occurred.
 */
export function snapToEdges(
  movedRect: LevelRect,
  otherRects: readonly LevelRect[],
  threshold: number = DEFAULT_SNAP_THRESHOLD,
): { readonly rect: LevelRect; readonly guides: readonly SnapGuide[] } {
  let { x, y, width, height } = movedRect;
  const guides: SnapGuide[] = [];

  const left = x;
  const right = x + width;
  const top = y;
  const bottom = y + height;

  let bestX: { delta: number; position: number; start: number; end: number } | null = null;
  let bestY: { delta: number; position: number; start: number; end: number } | null = null;

  for (const other of otherRects) {
    const otherLeft = other.x;
    const otherRight = other.x + other.width;
    const otherTop = other.y;
    const otherBottom = other.y + other.height;

    const xCandidates = [
      { moved: left, target: otherLeft },
      { moved: left, target: otherRight },
      { moved: right, target: otherLeft },
      { moved: right, target: otherRight },
    ];
    for (const c of xCandidates) {
      const delta = c.target - c.moved;
      if (Math.abs(delta) > threshold) continue;
      if (bestX === null || Math.abs(delta) < Math.abs(bestX.delta)) {
        bestX = {
          delta,
          position: c.target,
          start: Math.min(top, otherTop),
          end: Math.max(bottom, otherBottom),
        };
      }
    }

    const yCandidates = [
      { moved: top, target: otherTop },
      { moved: top, target: otherBottom },
      { moved: bottom, target: otherTop },
      { moved: bottom, target: otherBottom },
    ];
    for (const c of yCandidates) {
      const delta = c.target - c.moved;
      if (Math.abs(delta) > threshold) continue;
      if (bestY === null || Math.abs(delta) < Math.abs(bestY.delta)) {
        bestY = {
          delta,
          position: c.target,
          start: Math.min(left, otherLeft),
          end: Math.max(right, otherRight),
        };
      }
    }
  }

  if (bestX !== null) {
    x += bestX.delta;
    guides.push({
      axis: 'x',
      position: bestX.position,
      start: bestX.start,
      end: bestX.end,
    });
  }
  if (bestY !== null) {
    y += bestY.delta;
    guides.push({
      axis: 'y',
      position: bestY.position,
      start: bestY.start,
      end: bestY.end,
    });
  }

  return { rect: { x, y, width, height }, guides };
}
