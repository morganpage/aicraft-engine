import { describe, it, expect } from 'vitest';
import { DEFAULT_CATALOG, findCatalogEntry } from '../../src/editor';
import type { LevelRect } from '../../src/level/types';
import {
  boundingRect,
  mouseToWaypointTopLeft,
  hitTestWaypoint,
  instantiateMovingPlatformAt,
  canvasMouseToWorld,
  buildDrawnEntityOp,
} from '../sections/playground-helpers';

/**
 * Unit tests for the pure helpers the playground's UI handlers call.
 *
 * These are DOM-free arithmetic / data transforms extracted from
 * `showcase/sections/playground.ts` so they can be tested in Node. They
 * are the AUTHORITATIVE implementation — `sections/playground.ts`
 * imports and calls them — so a regression here is a real playground
 * regression.
 */

describe('boundingRect', () => {
  it('normalizes two corners in either diagonal order', () => {
    const a = boundingRect({ x: 10, y: 20 }, { x: 30, y: 60 });
    expect(a).toEqual({ x: 10, y: 20, width: 20, height: 40 });

    const b = boundingRect({ x: 30, y: 60 }, { x: 10, y: 20 });
    expect(b).toEqual({ x: 10, y: 20, width: 20, height: 40 });
  });

  it('produces a 0-sized rect when both corners are the same point', () => {
    expect(boundingRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });
});

describe('mouseToWaypointTopLeft (regression: center-vs-top-left jump)', () => {
  it('offsets the mouse by half the platform rect (so the handle stays under the cursor)', () => {
    const r = mouseToWaypointTopLeft({ x: 100, y: 80 }, { width: 48, height: 16 });
    // Mouse (100, 80) should produce waypoint top-left (100 - 24, 80 - 8) = (76, 72).
    expect(r).toEqual({ x: 76, y: 72 });
  });

  it('with a 0-size rect, the waypoint equals the mouse position', () => {
    const r = mouseToWaypointTopLeft({ x: 50, y: 50 }, { width: 0, height: 0 });
    expect(r).toEqual({ x: 50, y: 50 });
  });
});

describe('hitTestWaypoint', () => {
  const path = [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
  ];
  const rect = { width: 48, height: 16 };

  it('returns the index of the center-offset waypoint within the hit radius', () => {
    // Waypoint 0 center = (100+24, 100+8) = (124, 108).
    expect(hitTestWaypoint({ x: 124, y: 108 }, path, rect, 6)).toBe(0);
    // Waypoint 1 center = (200+24, 100+8) = (224, 108).
    expect(hitTestWaypoint({ x: 224, y: 108 }, path, rect, 6)).toBe(1);
  });

  it('returns -1 when the mouse is not within the hit radius of any waypoint', () => {
    expect(hitTestWaypoint({ x: 0, y: 0 }, path, rect, 6)).toBe(-1);
  });

  it('returns the FIRST waypoint in a tie (closest one wins)', () => {
    // Equidistant from both: pick waypoint 0 since it's iterated first.
    const midX = (124 + 224) / 2; // 174
    expect(hitTestWaypoint({ x: midX, y: 108 }, path, rect, 100)).toBe(0);
  });
});

describe('instantiateMovingPlatformAt (regression: path at origin after placement)', () => {
  const entry = findCatalogEntry(DEFAULT_CATALOG, 'movingPlatform');
  if (!entry) throw new Error('missing movingPlatform in DEFAULT_CATALOG');

  it('translates the default path so path[0] equals the placement position', () => {
    const placed = instantiateMovingPlatformAt(entry, { x: 200, y: 100 });
    expect(placed.rect.x).toBe(200);
    expect(placed.rect.y).toBe(100);
    expect(placed.rect.width).toBe(48);
    expect(placed.rect.height).toBe(16);

    const path = placed.props.path as { x: number; y: number }[];
    // path[0] must equal the placement top-left, NOT the catalog default (0, 0).
    expect(path[0]).toEqual({ x: 200, y: 100 });
    // Subsequent waypoints preserve their default relative offset.
    expect(path[1]).toEqual({ x: 248, y: 100 });
  });

  it('preserves speed + loopMode from the catalog default', () => {
    const placed = instantiateMovingPlatformAt(entry, { x: 0, y: 0 });
    expect(placed.props.speed).toBe(60);
    expect(placed.props.loopMode).toBe('loop');
  });

  it('returns a path that compileLevel would accept (path[0] = body top-left)', () => {
    const placed = instantiateMovingPlatformAt(entry, { x: 300, y: 50 });
    const path = placed.props.path as { x: number; y: number }[];
    // The runtime kernel uses path[0] as the platform's home position,
    // so the body rect top-left MUST equal path[0]. Otherwise the
    // platform snaps to path[0] on play.
    expect(placed.rect.x).toBe(path[0].x);
    expect(placed.rect.y).toBe(path[0].y);
  });

  it('pure: multiple calls produce independent records', () => {
    const a = instantiateMovingPlatformAt(entry, { x: 100, y: 100 });
    const b = instantiateMovingPlatformAt(entry, { x: 100, y: 100 });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.props.path).not.toBe(b.props.path);
  });
});

describe('canvasMouseToWorld', () => {
  it('scales client coords by (world / css) ratio', () => {
    const r = canvasMouseToWorld(
      150,
      100,
      { left: 50, top: 50, width: 300, height: 200 },
      600,
      400,
    );
    // scaleX = 600 / 300 = 2; scaleY = 400 / 200 = 2.
    expect(r).toEqual({ x: 200, y: 100 });
  });

  it('returns identity scale when canvasRect width is 0 (defensive)', () => {
    const r = canvasMouseToWorld(10, 20, { left: 0, top: 0, width: 0, height: 100 }, 600, 400);
    expect(r.x).toBe(10);
  });

  it('returns identity scale when canvasRect height is 0 (defensive)', () => {
    const r = canvasMouseToWorld(10, 20, { left: 0, top: 0, width: 100, height: 0 }, 600, 400);
    expect(r.y).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Player visual geometry — foot-platform alignment invariants
// ---------------------------------------------------------------------------

import {
  computePlayerVisuals,
  type PlayerVisualInput,
} from '../sections/playground-helpers';

/** Canonical idle input: identity squash/stretch, no breath modulation. */
const IDLE_INPUT: PlayerVisualInput = {
  coreX: 60,
  coreY: 336,
  coreW: 24,
  coreH: 32,
  scaleX: 1,
  scaleY: 1,
  breathScaleX: 1,
  breathScaleY: 1,
  footH: 5,
  clearance: 3,
};

describe('computePlayerVisuals — geometry invariants', () => {
  it('feet baseY + footH === 0 so foot bottom is exactly at local platform surface', () => {
    const v = computePlayerVisuals(IDLE_INPUT);
    // In local coordinates (origin at platform surface), foot top = baseY,
    // foot bottom = baseY + footH.  Bottom must equal 0 (= platform surface).
    expect(v.feetBaseY + IDLE_INPUT.footH).toBe(0);
  });

  it('foot top is negative (above platform surface, not embedded)', () => {
    const v = computePlayerVisuals(IDLE_INPUT);
    expect(v.feetBaseY).toBeLessThan(0);
  });

  it('body bottom is above platform surface by exactly the clearance', () => {
    const v = computePlayerVisuals(IDLE_INPUT);
    const coreBottom = IDLE_INPUT.coreY + IDLE_INPUT.coreH;
    const bodyBottom = v.bodyY + v.bodyH;
    expect(bodyBottom).toBe(coreBottom - IDLE_INPUT.clearance);
  });

  it('body bottom is strictly above platform surface (never touches or goes below)', () => {
    const v = computePlayerVisuals(IDLE_INPUT);
    const coreBottom = IDLE_INPUT.coreY + IDLE_INPUT.coreH;
    expect(v.bodyY + v.bodyH).toBeLessThan(coreBottom);
  });

  it('body top is above body bottom (positive height)', () => {
    const v = computePlayerVisuals(IDLE_INPUT);
    expect(v.bodyH).toBeGreaterThan(0);
  });

  it('body overlaps the upper portion of the feet at rest', () => {
    const v = computePlayerVisuals(IDLE_INPUT);
    // Body bottom in local coords (relative to platform surface):
    const coreBottom = IDLE_INPUT.coreY + IDLE_INPUT.coreH;
    const bodyBottomLocal = (v.bodyY + v.bodyH) - coreBottom; // = -clearance
    // Feet top in local coords = -footH
    // Feet bottom in local coords = 0
    // Body bottom local should be between feet top and feet bottom.
    expect(bodyBottomLocal).toBeLessThan(0);
    expect(bodyBottomLocal).toBeGreaterThan(-IDLE_INPUT.footH);
  });

  it('squash/breath scales produce finite positive dimensions', () => {
    const squashed: PlayerVisualInput = {
      ...IDLE_INPUT,
      scaleX: 1.3,
      scaleY: 0.7,
      breathScaleX: 1.02,
      breathScaleY: 0.98,
    };
    const v = computePlayerVisuals(squashed);
    expect(Number.isFinite(v.bodyW)).toBe(true);
    expect(Number.isFinite(v.bodyH)).toBe(true);
    expect(v.bodyW).toBeGreaterThan(0);
    expect(v.bodyH).toBeGreaterThan(0);
    expect(v.feetBaseY).toBe(-IDLE_INPUT.footH);
  });

  it('invariant holds under squash: body bottom still above platform by clearance', () => {
    const squashed: PlayerVisualInput = {
      ...IDLE_INPUT,
      scaleX: 1.3,
      scaleY: 0.7,
      breathScaleX: 1,
      breathScaleY: 1,
    };
    const v = computePlayerVisuals(squashed);
    const coreBottom = squashed.coreY + squashed.coreH;
    expect(v.bodyY + v.bodyH).toBe(coreBottom - squashed.clearance);
  });

  it('invariant holds under stretch: body bottom still above platform by clearance', () => {
    const stretched: PlayerVisualInput = {
      ...IDLE_INPUT,
      scaleX: 0.85,
      scaleY: 1.15,
      breathScaleX: 1,
      breathScaleY: 1,
    };
    const v = computePlayerVisuals(stretched);
    const coreBottom = stretched.coreY + stretched.coreH;
    expect(v.bodyY + v.bodyH).toBe(coreBottom - stretched.clearance);
  });

  it('pure: identical inputs produce equal but independent outputs', () => {
    const a = computePlayerVisuals(IDLE_INPUT);
    const b = computePlayerVisuals(IDLE_INPUT);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('feet baseY equals -footH regardless of squash/stretch/breath', () => {
    const cases: PlayerVisualInput[] = [
      IDLE_INPUT,
      { ...IDLE_INPUT, scaleX: 0.85, scaleY: 1.15 },
      { ...IDLE_INPUT, breathScaleX: 0.95, breathScaleY: 1.05 },
      { ...IDLE_INPUT, scaleX: 1.2, scaleY: 0.8, breathScaleX: 0.97, breathScaleY: 1.03, clearance: 5 },
    ];
    for (const input of cases) {
      const v = computePlayerVisuals(input);
      expect(v.feetBaseY).toBe(-input.footH);
    }
  });

  it('different core dimensions still satisfy all invariants', () => {
    const bigCore: PlayerVisualInput = {
      ...IDLE_INPUT,
      coreW: 48,
      coreH: 64,
      footH: 8,
      clearance: 5,
    };
    const v = computePlayerVisuals(bigCore);
    const coreBottom = bigCore.coreY + bigCore.coreH;
    expect(v.feetBaseY + bigCore.footH).toBe(0);
    expect(v.bodyY + v.bodyH).toBe(coreBottom - bigCore.clearance);
    expect(v.bodyH).toBeGreaterThan(0);
  });
});

describe('buildDrawnEntityOp', () => {
  function entry(kind: 'platform' | 'passthrough' | 'hazard' = 'platform') {
    const e = findCatalogEntry(DEFAULT_CATALOG, kind);
    if (!e) throw new Error(`missing ${kind} entry`);
    return e;
  }

  it('produces an addEntity op with the dragged rect when drag exceeds minSize', () => {
    const op = buildDrawnEntityOp(
      entry(),
      { x: 10, y: 10 },
      { x: 110, y: 42 },
      16,
    );
    expect(op.type).toBe('addEntity');
    if (op.type !== 'addEntity') return;
    expect(op.kind).toBe('platform');
    expect(op.rect).toEqual({ x: 10, y: 10, width: 100, height: 32 });
  });

  it('falls back to the catalog default size when drag is smaller than minSize', () => {
    const op = buildDrawnEntityOp(
      entry(),
      { x: 100, y: 100 },
      { x: 105, y: 105 },
      16,
    );
    if (op.type !== 'addEntity') throw new Error('not addEntity');
    // Anchored at the start corner so a click places the entity at that corner.
    expect(op.rect).toEqual({
      x: 100,
      y: 100,
      width: 32, // catalog default for 'platform'
      height: 16,
    });
  });

  it('normalizes corners in any order (top-right + bottom-left works)', () => {
    const op = buildDrawnEntityOp(
      entry(),
      { x: 200, y: 10 },
      { x: 10, y: 50 },
      16,
    );
    if (op.type !== 'addEntity') throw new Error('not addEntity');
    expect(op.rect).toEqual({ x: 10, y: 10, width: 190, height: 40 });
  });

  it('produces a rect that satisfies the LevelRect shape', () => {
    const op = buildDrawnEntityOp(entry('hazard'), { x: 0, y: 0 }, { x: 32, y: 32 }, 16);
    if (op.type !== 'addEntity') throw new Error('not addEntity');
    const rect: LevelRect = op.rect;
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
});
