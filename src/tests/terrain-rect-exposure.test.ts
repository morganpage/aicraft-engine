import { describe, expect, it } from 'vitest';
import {
  computeRectExposures,
  type TerrainRectInput,
} from '../terrain';

const rect = (
  key: number,
  x: number,
  y: number,
  width: number,
  height: number,
  familyId = 1,
  minimumSpan?: number,
): TerrainRectInput => ({
  key,
  rect: { x, y, width, height },
  familyId,
  minimumSpan,
});

describe('computeRectExposures', () => {
  it('returns full exposure for an isolated rectangle', () => {
    expect(computeRectExposures([rect(1, 0, 0, 20, 10)]).get(1)).toEqual({
      top: [{ start: 0, end: 20 }],
      right: [{ start: 0, end: 10 }],
      bottom: [{ start: 0, end: 20 }],
      left: [{ start: 0, end: 10 }],
    });
  });

  it('removes the shared edge between adjacent family members', () => {
    const result = computeRectExposures([
      rect(1, 0, 0, 20, 10),
      rect(2, 20, 0, 20, 10),
    ]);
    expect(result.get(1)?.right).toEqual([]);
    expect(result.get(2)?.left).toEqual([]);
    expect(result.get(1)?.top).toEqual([{ start: 0, end: 20 }]);
  });

  it('subtracts partial coverage into sorted half-open spans', () => {
    const result = computeRectExposures([
      rect(1, 0, 0, 100, 10),
      rect(2, 20, -10, 20, 10),
      rect(3, 60, -10, 10, 10),
    ]);
    expect(result.get(1)?.top).toEqual([
      { start: 0, end: 20 },
      { start: 40, end: 60 },
      { start: 70, end: 100 },
    ]);
  });

  it('does not occlude across disconnected families', () => {
    const result = computeRectExposures([
      rect(1, 0, 0, 20, 10, 1),
      rect(2, 20, 0, 20, 10, 2),
    ]);
    expect(result.get(1)?.right).toEqual([{ start: 0, end: 10 }]);
    expect(result.get(2)?.left).toEqual([{ start: 0, end: 10 }]);
  });

  it('supports a custom family connector and touching epsilon', () => {
    const result = computeRectExposures(
      [
        rect(1, 0, 0, 20, 10, 1),
        rect(2, 20.005, 0, 20, 10, 2),
      ],
      { connects: () => true, epsilon: 0.01 },
    );
    expect(result.get(1)?.right).toEqual([]);
    expect(result.get(2)?.left).toEqual([]);
  });

  it('drops exposed slivers shorter than minimumSpan', () => {
    const result = computeRectExposures([
      rect(1, 0, 0, 20, 10, 1, 4),
      rect(2, 3, -10, 17, 10),
    ]);
    expect(result.get(1)?.top).toEqual([]);
  });

  it('is independent of input order', () => {
    const inputs = [
      rect(3, 40, 0, 20, 10),
      rect(1, 0, 0, 20, 10),
      rect(2, 20, 0, 20, 10),
    ];
    const forward = [...computeRectExposures(inputs).entries()];
    const reverse = [...computeRectExposures([...inputs].reverse()).entries()];
    expect(forward).toEqual(reverse);
  });

  it('ignores malformed rectangles without throwing', () => {
    const malformed = rect(1, 0, 0, -1, 10);
    expect(() => computeRectExposures([malformed])).not.toThrow();
    expect(computeRectExposures([malformed]).size).toBe(0);
  });
});
