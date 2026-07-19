import { describe, it, expect } from 'vitest';
import { snapToGrid, snapRectToGrid, snapToEdges } from '../editor';
import type { LevelRect } from '../level/types';

describe('snapToGrid', () => {
  it('rounds to the nearest grid multiple', () => {
    expect(snapToGrid(17, 22, 16)).toEqual({ x: 16, y: 16 });
    expect(snapToGrid(20, 30, 16)).toEqual({ x: 16, y: 32 });
    expect(snapToGrid(0, 0, 16)).toEqual({ x: 0, y: 0 });
    expect(snapToGrid(8, 8, 16)).toEqual({ x: 16, y: 16 });
  });

  it('handles non-16 grid sizes', () => {
    expect(snapToGrid(11, 11, 8)).toEqual({ x: 8, y: 8 });
    expect(snapToGrid(5, 5, 8)).toEqual({ x: 8, y: 8 });
    expect(snapToGrid(3, 3, 8)).toEqual({ x: 0, y: 0 });
  });

  it('defaults to a 16-pixel grid when gridSize is omitted', () => {
    expect(snapToGrid(20, 30)).toEqual({ x: 16, y: 32 });
  });

  it('handles negative coordinates', () => {
    expect(snapToGrid(-5, -10, 16)).toEqual({ x: 0, y: -16 });
  });
});

describe('snapRectToGrid', () => {
  it('snaps x and y while preserving width and height', () => {
    const r: LevelRect = { x: 20, y: 30, width: 32, height: 16 };
    expect(snapRectToGrid(r, 16)).toEqual({
      x: 16,
      y: 32,
      width: 32,
      height: 16,
    });
  });

  it('does not mutate the input rect', () => {
    const r: LevelRect = { x: 20, y: 30, width: 32, height: 16 };
    const snapshot = JSON.parse(JSON.stringify(r)) as LevelRect;
    snapRectToGrid(r, 16);
    expect(r).toEqual(snapshot);
  });
});

describe('snapToEdges', () => {
  it('snaps when the moved rect is within threshold', () => {
    const moved: LevelRect = { x: 95, y: 0, width: 16, height: 16 };
    const others: LevelRect[] = [{ x: 80, y: 0, width: 16, height: 16 }];
    const result = snapToEdges(moved, others, 4);
    // Left edge of moved (95) is within 1 of right edge of other (96)
    expect(result.rect.x).toBe(96);
    expect(result.guides.length).toBeGreaterThanOrEqual(1);
    const xGuide = result.guides.find((g) => g.axis === 'x');
    expect(xGuide).toBeDefined();
    expect(xGuide?.position).toBe(96);
  });

  it('does not snap when beyond threshold', () => {
    const moved: LevelRect = { x: 50, y: 50, width: 16, height: 16 };
    const others: LevelRect[] = [{ x: 0, y: 0, width: 16, height: 16 }];
    const result = snapToEdges(moved, others, 4);
    expect(result.rect).toEqual(moved);
    expect(result.guides).toEqual([]);
  });

  it('snaps on both axes simultaneously when both are within threshold', () => {
    const moved: LevelRect = { x: 18, y: 18, width: 16, height: 16 };
    const others: LevelRect[] = [
      { x: 0, y: 0, width: 16, height: 16 }, // right/bottom edge at 16
    ];
    const result = snapToEdges(moved, others, 4);
    // Left of moved (18) snaps to right of other (16): delta -2
    expect(result.rect.x).toBe(16);
    // Top of moved (18) snaps to bottom of other (16): delta -2
    expect(result.rect.y).toBe(16);
    expect(result.guides.length).toBe(2);
  });

  it('chooses the closest reference when multiple are within threshold', () => {
    const moved: LevelRect = { x: 19, y: 0, width: 16, height: 16 };
    const others: LevelRect[] = [
      { x: 0, y: 0, width: 16, height: 16 },   // right edge at 16: moved.left(19)→16 = delta -3
      { x: 32, y: 0, width: 16, height: 16 },  // left edge at 32: moved.right(35)→32 = delta -3
      { x: 36, y: 0, width: 16, height: 16 },  // left edge at 36: moved.right(35)→36 = delta +1 (closest)
    ];
    const result = snapToEdges(moved, others, 4);
    // The +1 snap to x=36 is closer than the -3 snap to x=16, so x snaps by +1 to 20.
    expect(result.rect.x).toBe(20);
  });

  it('does not mutate the input rect', () => {
    const moved: LevelRect = { x: 95, y: 0, width: 16, height: 16 };
    const movedSnapshot = JSON.parse(JSON.stringify(moved)) as LevelRect;
    const others: LevelRect[] = [{ x: 80, y: 0, width: 16, height: 16 }];
    snapToEdges(moved, others, 4);
    expect(moved).toEqual(movedSnapshot);
  });

  it('handles an empty otherRects array', () => {
    const moved: LevelRect = { x: 50, y: 50, width: 16, height: 16 };
    const result = snapToEdges(moved, [], 4);
    expect(result.rect).toEqual(moved);
    expect(result.guides).toEqual([]);
  });
});
