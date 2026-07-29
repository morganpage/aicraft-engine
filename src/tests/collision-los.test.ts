import { describe, expect, it } from 'vitest';
import type { TileSolidityQuery } from '../collision/types';
import {
  checkLineOfSight,
  checkLineOfSightWithLimits,
  LOS_MAX_VISITED_TILES,
} from '../collision/los';

function query(solids: ReadonlySet<string>): TileSolidityQuery {
  return (x, y) => (solids.has(`${x},${y}`) ? 'solid' : 'empty');
}

describe('checkLineOfSight', () => {
  it('handles clear, blocked, endpoint, passthrough, and same-tile paths', () => {
    expect(checkLineOfSight(1, 1, 47, 1, () => 'empty', 16)).toBe(true);
    expect(checkLineOfSight(1, 1, 47, 1, query(new Set(['1,0'])), 16)).toBe(false);
    expect(checkLineOfSight(1, 1, 47, 1, query(new Set(['2,0'])), 16)).toBe(false);
    expect(checkLineOfSight(1, 1, 47, 1, () => 'passthrough', 16)).toBe(true);
    let calls = 0;
    expect(checkLineOfSight(1, 1, 2, 2, () => {
      calls += 1;
      return 'empty';
    }, 16)).toBe(true);
    expect(calls).toBe(1);
  });

  it('visits both orthogonals and the diagonal at corners', () => {
    for (const blocker of ['1,0', '0,1', '1,1']) {
      expect(
        checkLineOfSight(8, 8, 24, 24, query(new Set([blocker])), 16),
      ).toBe(false);
    }
  });

  it('is endpoint-reversible and queries unique cells once', () => {
    const cases = [
      [1, 1, 63, 1],
      [1, 1, 1, 63],
      [1, 1, 63, 63],
      [1, 1, 63, 62.99999999999],
    ] as const;
    for (const points of cases) {
      const [x1, y1, x2, y2] = points;
      const q = query(new Set(['1,0']));
      expect(checkLineOfSight(x1, y1, x2, y2, q, 16)).toBe(
        checkLineOfSight(x2, y2, x1, y1, q, 16),
      );
    }
    const visits = new Map<string, number>();
    expect(
      checkLineOfSight(8, 8, 72, 72, (x, y) => {
        const key = `${x},${y}`;
        visits.set(key, (visits.get(key) ?? 0) + 1);
        return 'empty';
      }, 16),
    ).toBe(true);
    expect([...visits.values()].every((count) => count === 1)).toBe(true);
  });

  it('fails closed for invalid, throwing, malformed, and capped inputs', () => {
    expect(checkLineOfSight(Number.NaN, 0, 1, 1, () => 'empty', 16)).toBe(false);
    expect(checkLineOfSight(0, 0, 1, 1, () => 'empty', 0)).toBe(false);
    expect(checkLineOfSight(0, 0, 16, 0, () => {
      throw new Error('failure');
    }, 16)).toBe(false);
    expect(
      checkLineOfSight(0, 0, 16, 0, (() => 'water') as unknown as TileSolidityQuery, 16),
    ).toBe(false);
    let calls = 0;
    expect(
      checkLineOfSight(0, 0, LOS_MAX_VISITED_TILES * 16, 0, () => {
        calls += 1;
        return 'empty';
      }, 16),
    ).toBe(false);
    expect(calls).toBe(0);
    expect(
      checkLineOfSightWithLimits(0, 0, 64, 0, () => {
        calls += 1;
        return 'empty';
      }, 16, 100, 2),
    ).toBe(false);
    expect(calls).toBe(2);
  });
});
