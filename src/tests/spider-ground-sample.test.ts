import { describe, it, expect } from 'vitest';
import {
  sampleGround,
} from '../animation/spider/ground-sample';
import type { TileSolidityQuery } from '../collision/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mock tile query: row `solidRow` and below are solid (tile coords).
 * For tileSize=16, row 5 means y >= 80 is solid.
 */
function floorAtRow(solidRow: number): TileSolidityQuery {
  return (_tileX: number, tileY: number) =>
    tileY >= solidRow ? 'solid' : 'empty';
}

/** All-empty tile query. */
const emptyQuery: TileSolidityQuery = () => 'empty';

/** Passthrough tile query. */
const passthroughQuery: TileSolidityQuery = () => 'passthrough';

// ---------------------------------------------------------------------------
// sampleGround — finds first solid downward
// ---------------------------------------------------------------------------

describe('sampleGround — downward sampling', () => {
  it('finds the first solid tile below the origin', () => {
    // Tile row 5 is solid (y >= 80 for tileSize=16).
    // Origin at y=50 (tile row 3). Should find solid at row 5.
    const result = sampleGround(100, 50, 0, 1, 200, 16, floorAtRow(5));

    expect(result.hasGround).toBe(true);
  });

  it('returns the surface point at the TOP of the first solid tile (foot-snap fix)', () => {
    // Tile row 5 is solid → tileToWorld(0, 5, 16) = {x:0, y:80}.
    // The surface point Y should be 80 (top of the tile), not inside it.
    const result = sampleGround(100, 50, 0, 1, 200, 16, floorAtRow(5));

    expect(result.hasGround).toBe(true);
    // The Y coordinate should equal tileRow * tileSize = 5 * 16 = 80
    expect(result.point.y).toBe(80);
  });

  it('returns the outward normal for downward sampling', () => {
    const result = sampleGround(100, 50, 0, 1, 200, 16, floorAtRow(5));

    expect(result.hasGround).toBe(true);
    expect(result.normal.x).toBe(0);
    expect(result.normal.y).toBe(-1);
  });

  it('returns point X matching the origin X (floor-only v1)', () => {
    // In floor-only v1, sampling is strictly downward, so X doesn't change.
    const result = sampleGround(42, 50, 0, 1, 200, 16, floorAtRow(5));

    expect(result.hasGround).toBe(true);
    expect(result.point.x).toBe(42);
  });

  it('handles origin already inside or on the solid tile boundary', () => {
    // Origin at y=80 which is exactly the top of the solid row.
    // Should still find it (origin is on the boundary).
    const result = sampleGround(100, 80, 0, 1, 200, 16, floorAtRow(5));

    expect(result.hasGround).toBe(true);
    expect(result.point.y).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// sampleGround — no ground found
// ---------------------------------------------------------------------------

describe('sampleGround — no ground', () => {
  it('returns hasGround false when no solid tile within maxDistance', () => {
    const result = sampleGround(100, 0, 0, 1, 50, 16, emptyQuery);

    expect(result.hasGround).toBe(false);
  });

  it('returns hasGround false when solid is beyond maxDistance', () => {
    // Solid at row 10 (y >= 160), but maxDistance only 50 from y=0.
    const result = sampleGround(100, 0, 0, 1, 50, 16, floorAtRow(10));

    expect(result.hasGround).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sampleGround — passthrough tiles
// ---------------------------------------------------------------------------

describe('sampleGround — passthrough tiles', () => {
  it('passthrough tiles do not count as plantable ground', () => {
    // Passthrough tiles are one-way platforms; feet should not plant on them
    // from above in the same way as solid tiles.
    const result = sampleGround(100, 0, 0, 1, 200, 16, passthroughQuery);

    expect(result.hasGround).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sampleGround — maxDistance respected
// ---------------------------------------------------------------------------

describe('sampleGround — maxDistance', () => {
  it('a solid tile beyond maxDistance is not found', () => {
    // Solid at row 5 (y=80), origin at y=0, maxDistance=50
    const result = sampleGround(100, 0, 0, 1, 50, 16, floorAtRow(5));

    expect(result.hasGround).toBe(false);
  });

  it('a solid tile within maxDistance IS found', () => {
    // Solid at row 5 (y=80), origin at y=0, maxDistance=100
    const result = sampleGround(100, 0, 0, 1, 100, 16, floorAtRow(5));

    expect(result.hasGround).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sampleGround — surface-point regression (foot-snap fix)
// ---------------------------------------------------------------------------

describe('sampleGround — surface-point regression', () => {
  it('returned Y equals the solid tile top edge, not a point inside the tile', () => {
    // This is the foot-snap regression test.
    // Tile row 5 is solid → top edge Y = 5 * 16 = 80.
    // The old bug returned checkY which was inside the tile (e.g. 85).
    const result = sampleGround(50, 10, 0, 1, 300, 16, floorAtRow(5));

    expect(result.hasGround).toBe(true);
    expect(result.point.y).toBe(80); // exact tile top edge
  });

  it('works for different tile sizes', () => {
    // Tile row 3 is solid → top edge Y = 3 * 32 = 96 for tileSize=32.
    const result = sampleGround(50, 10, 0, 1, 300, 32, floorAtRow(3));

    expect(result.hasGround).toBe(true);
    expect(result.point.y).toBe(96);
  });
});

// ---------------------------------------------------------------------------
// sampleGround — never throws
// ---------------------------------------------------------------------------

describe('sampleGround — never throws', () => {
  it('zero tileSize does not throw', () => {
    expect(() =>
      sampleGround(100, 50, 0, 1, 200, 0, floorAtRow(5)),
    ).not.toThrow();
  });

  it('negative tileSize does not throw', () => {
    expect(() =>
      sampleGround(100, 50, 0, 1, 200, -16, floorAtRow(5)),
    ).not.toThrow();
  });

  it('NaN origin does not throw', () => {
    expect(() =>
      sampleGround(NaN, NaN, 0, 1, 200, 16, floorAtRow(5)),
    ).not.toThrow();
  });

  it('zero maxDistance does not throw', () => {
    expect(() =>
      sampleGround(100, 50, 0, 1, 0, 16, floorAtRow(5)),
    ).not.toThrow();
  });

  it('negative maxDistance does not throw', () => {
    expect(() =>
      sampleGround(100, 50, 0, 1, -100, 16, floorAtRow(5)),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// sampleGround — determinism
// ---------------------------------------------------------------------------

describe('sampleGround — determinism', () => {
  it('same inputs produce identical results', () => {
    const a = sampleGround(42, 17, 0, 1, 200, 16, floorAtRow(5));
    const b = sampleGround(42, 17, 0, 1, 200, 16, floorAtRow(5));

    expect(a).toEqual(b);
  });
});
