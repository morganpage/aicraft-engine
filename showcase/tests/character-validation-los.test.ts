import { describe, expect, it } from 'vitest';
import type { TileSolidityQuery } from '../../src/collision/types';
import {
  checkLineOfSight,
  checkLineOfSightWithLimits,
  LOS_MAX_VISITED_TILES,
} from '../_prototype/character-enemy-validation/los';

function queryWithSolids(
  solids: ReadonlySet<string>,
  visits?: Map<string, number>,
): TileSolidityQuery {
  return (x, y) => {
    const key = `${x},${y}`;
    visits?.set(key, (visits.get(key) ?? 0) + 1);
    return solids.has(key) ? 'solid' : 'empty';
  };
}

describe('line-of-sight validation prototype', () => {
  it('handles empty, blocked, passthrough, endpoint, and same-cell paths', () => {
    expect(checkLineOfSight(1, 1, 47, 1, () => 'empty', 16)).toBe(true);
    expect(
      checkLineOfSight(1, 1, 47, 1, queryWithSolids(new Set(['1,0'])), 16),
    ).toBe(false);
    expect(checkLineOfSight(1, 1, 47, 1, () => 'passthrough', 16)).toBe(true);
    expect(
      checkLineOfSight(1, 1, 47, 1, queryWithSolids(new Set(['2,0'])), 16),
    ).toBe(false);

    let calls = 0;
    expect(
      checkLineOfSight(
        1,
        1,
        2,
        2,
        () => {
          calls += 1;
          return 'empty';
        },
        16,
      ),
    ).toBe(true);
    expect(calls).toBe(1);
  });

  it('is reversible for horizontal, vertical, diagonal, and near-corner rays', () => {
    const cases = [
      [1, 1, 63, 1],
      [1, 1, 1, 63],
      [1, 1, 63, 63],
      [1, 1, 63, 62.99999999999],
    ] as const;
    for (const [x1, y1, x2, y2] of cases) {
      const query = queryWithSolids(new Set(['1,0']));
      expect(checkLineOfSight(x1, y1, x2, y2, query, 16)).toBe(
        checkLineOfSight(x2, y2, x1, y1, query, 16),
      );
    }
  });

  it('blocks diagonal corner peeking through either orthogonal neighbor', () => {
    expect(
      checkLineOfSight(8, 8, 24, 24, queryWithSolids(new Set(['1,0'])), 16),
    ).toBe(false);
    expect(
      checkLineOfSight(8, 8, 24, 24, queryWithSolids(new Set(['0,1'])), 16),
    ).toBe(false);
    expect(
      checkLineOfSight(8, 8, 24, 24, queryWithSolids(new Set(['1,1'])), 16),
    ).toBe(false);
  });

  it('queries each coordinate at most once', () => {
    const visits = new Map<string, number>();
    expect(
      checkLineOfSight(8, 8, 72, 72, queryWithSolids(new Set(), visits), 16),
    ).toBe(true);
    expect([...visits.values()].every((count) => count === 1)).toBe(true);
  });

  it('fails closed on invalid inputs, throwing queries, and malformed values', () => {
    expect(checkLineOfSight(Number.NaN, 0, 1, 1, () => 'empty', 16)).toBe(false);
    expect(checkLineOfSight(0, 0, 1, 1, () => 'empty', 0)).toBe(false);
    expect(
      checkLineOfSight(
        Number.MAX_SAFE_INTEGER,
        0,
        Number.MAX_SAFE_INTEGER,
        1,
        () => 'empty',
        0.25,
      ),
    ).toBe(false);
    expect(
      checkLineOfSight(0, 0, 16, 0, () => {
        throw new Error('query failure');
      }, 16),
    ).toBe(false);
    expect(
      checkLineOfSight(
        0,
        0,
        16,
        0,
        (() => 'water') as unknown as TileSolidityQuery,
        16,
      ),
    ).toBe(false);
  });

  it('enforces predicted and runtime caps', () => {
    let predictedCalls = 0;
    expect(
      checkLineOfSight(
        0,
        0,
        LOS_MAX_VISITED_TILES * 16,
        0,
        () => {
          predictedCalls += 1;
          return 'empty';
        },
        16,
      ),
    ).toBe(false);
    expect(predictedCalls).toBe(0);

    let runtimeCalls = 0;
    expect(
      checkLineOfSightWithLimits(
        0,
        0,
        64,
        0,
        () => {
          runtimeCalls += 1;
          return 'empty';
        },
        16,
        100,
        2,
      ),
    ).toBe(false);
    expect(runtimeCalls).toBe(2);
  });
});
