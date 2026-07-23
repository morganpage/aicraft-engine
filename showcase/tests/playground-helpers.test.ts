import { describe, it, expect } from 'vitest';
import { DEFAULT_CATALOG, findCatalogEntry } from '../../src/editor';
import type { LevelRect, LevelEntity } from '../../src/level/types';
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

// ---------------------------------------------------------------------------
// Enemy editor bugs (regression suite).
//
// These cover three reported playground bugs:
//  1) Toolbar active identity must include the enemy archetype — clicking
//     Spinny must not also mark Turret active (both share data-kind="enemy").
//  2) Placement / ghost preview must resolve Spinny/Turret by their dedicated
//     catalog keys (entries.spinny / entries.turret), with a generic fallback
//     for unknown archetypes. A Spinny placed at (x,y) must receive its
//     default two-point patrol translated so point 0 = placement and
//     point 1 = (x+48, y).
//  3) Authored enemy entities must NOT be drawn through drawLevelEntity in
//     play mode — runtime drawEnemies is the sole enemy renderer. Edit mode
//     still shows the authored rectangle.
// ---------------------------------------------------------------------------

import {
  isEnemyToolbarButtonActive,
  resolveEnemyCatalogEntry,
  instantiateEnemyAt,
  shouldRenderEntityInPlay,
  computeShootToWidgetGeometry,
  hitTestShootToEndpoint,
  computeShootToFromEndpoint,
  shouldShowShootToWidget,
  SHOOT_TO_WIDGET_CONFIG,
} from '../sections/playground-helpers';
import type { EntityKind } from '../../src/level/types';

describe('isEnemyToolbarButtonActive (regression: archetype identity)', () => {
  type Btn = { kind: EntityKind; archetype: string | null };

  it('matches only the Spinny button when Spinny is selected', () => {
    const spinny: Btn = { kind: 'enemy', archetype: 'spinny' };
    const turret: Btn = { kind: 'enemy', archetype: 'turret' };
    expect(isEnemyToolbarButtonActive('enemy', 'spinny', spinny.kind, spinny.archetype)).toBe(true);
    expect(isEnemyToolbarButtonActive('enemy', 'spinny', turret.kind, turret.archetype)).toBe(false);
  });

  it('matches only the Turret button when Turret is selected', () => {
    const spinny: Btn = { kind: 'enemy', archetype: 'spinny' };
    const turret: Btn = { kind: 'enemy', archetype: 'turret' };
    expect(isEnemyToolbarButtonActive('enemy', 'turret', turret.kind, turret.archetype)).toBe(true);
    expect(isEnemyToolbarButtonActive('enemy', 'turret', spinny.kind, spinny.archetype)).toBe(false);
  });

  it('does not mark any enemy button active when a non-enemy kind is selected', () => {
    expect(
      isEnemyToolbarButtonActive('platform', 'spinny', 'enemy', 'spinny'),
    ).toBe(false);
    expect(
      isEnemyToolbarButtonActive('platform', 'spinny', 'enemy', 'turret'),
    ).toBe(false);
  });

  it('matches non-enemy buttons by kind only (archetype ignored)', () => {
    expect(isEnemyToolbarButtonActive('platform', null, 'platform', null)).toBe(true);
    expect(isEnemyToolbarButtonActive('platform', null, 'platform', 'spinny')).toBe(true);
    expect(isEnemyToolbarButtonActive('movingPlatform', null, 'movingPlatform', null)).toBe(true);
    expect(isEnemyToolbarButtonActive('platform', null, 'passthrough', null)).toBe(false);
  });

  it('treats a missing archetype on an enemy button as the generic enemy match', () => {
    // The generic "Enemy" catalog button has no data-archetype; it should
    // be active whenever an enemy archetype is selected (defensive — the
    // shipped HTML always pairs enemy buttons with an archetype, but the
    // helper must not over-match if a future button omits it).
    expect(isEnemyToolbarButtonActive('enemy', 'spinny', 'enemy', null)).toBe(true);
  });

  it('pure: identical inputs always return the same result', () => {
    const a = isEnemyToolbarButtonActive('enemy', 'spinny', 'enemy', 'spinny');
    const b = isEnemyToolbarButtonActive('enemy', 'spinny', 'enemy', 'spinny');
    expect(a).toBe(b);
  });
});

describe('resolveEnemyCatalogEntry (regression: dedicated prefab lookup)', () => {
  it('resolves the spinny prefab by archetype key', () => {
    const entry = resolveEnemyCatalogEntry(DEFAULT_CATALOG, 'spinny');
    expect(entry.kind).toBe('enemy');
    expect(entry.defaultProps.archetype).toBe('spinny');
    // The dedicated spinny entry ships with a default patrolPath.
    const params = entry.defaultProps.params as { patrolPath?: unknown };
    expect(Array.isArray(params.patrolPath)).toBe(true);
    expect((params.patrolPath as { x: number; y: number }[]).length).toBeGreaterThanOrEqual(2);
  });

  it('resolves the turret prefab by archetype key', () => {
    const entry = resolveEnemyCatalogEntry(DEFAULT_CATALOG, 'turret');
    expect(entry.kind).toBe('enemy');
    expect(entry.defaultProps.archetype).toBe('turret');
    // Turret ships with fireRate etc., no patrolPath.
    const params = entry.defaultProps.params as { fireRate?: number; patrolPath?: unknown };
    expect(typeof params.fireRate).toBe('number');
    expect(params.patrolPath).toBeUndefined();
  });

  it('falls back to the generic enemy entry for unknown archetypes', () => {
    const entry = resolveEnemyCatalogEntry(DEFAULT_CATALOG, 'customBoss');
    expect(entry.kind).toBe('enemy');
  });

  it('falls back to the generic enemy entry when the archetype key exists but is not an enemy prefab', () => {
    // Defensive: if a non-enemy entry happens to share the archetype name,
    // do not return it — the fallback is the generic enemy entry.
    const catalog = {
      entries: {
        spinny: { kind: 'platform' as const, label: 'wrong', defaultRect: { x: 0, y: 0, width: 1, height: 1 }, defaultProps: {} },
        enemy: DEFAULT_CATALOG.entries.enemy,
      },
    };
    const entry = resolveEnemyCatalogEntry(catalog, 'spinny');
    expect(entry.kind).toBe('enemy');
  });
});

describe('instantiateEnemyAt (regression: Spinny placement patrol translation)', () => {
  it('translates the default two-point patrol so point 0 = placement, point 1 = +48px X', () => {
    const entry = resolveEnemyCatalogEntry(DEFAULT_CATALOG, 'spinny');
    const placed = instantiateEnemyAt(entry, { x: 200, y: 100 }, 'spinny');
    expect(placed.rect).toEqual({ x: 200, y: 100, width: 16, height: 16 });
    const props = placed.props as { archetype: string; params: { patrolPath: { x: number; y: number }[] } };
    expect(props.archetype).toBe('spinny');
    // The bug: prior to the fix, the generic enemy catalog entry was used
    // (no patrolPath), so the spinny fell back to ledge/wall patrol at
    // runtime. The dedicated spinny prefab translates point[0] to the
    // placement and point[1] to +48px X (the default relative offset).
    expect(props.params.patrolPath[0]).toEqual({ x: 200, y: 100 });
    expect(props.params.patrolPath[1]).toEqual({ x: 248, y: 100 });
  });

  it('preserves the default relative offset regardless of placement position', () => {
    const entry = resolveEnemyCatalogEntry(DEFAULT_CATALOG, 'spinny');
    const placed = instantiateEnemyAt(entry, { x: -32, y: 400 }, 'spinny');
    const props = placed.props as { params: { patrolPath: { x: number; y: number }[] } };
    expect(props.params.patrolPath[0]).toEqual({ x: -32, y: 400 });
    expect(props.params.patrolPath[1]).toEqual({ x: 16, y: 400 });
  });

  it('preserves speed + ledgeTurnAround from the dedicated prefab defaults', () => {
    const entry = resolveEnemyCatalogEntry(DEFAULT_CATALOG, 'spinny');
    const placed = instantiateEnemyAt(entry, { x: 0, y: 0 }, 'spinny');
    const params = (placed.props as { params: Record<string, unknown> }).params;
    expect(params.speed).toBe(60);
    expect(params.ledgeTurnAround).toBe(true);
  });

  it('sets archetype on the resulting props (overrides any default)', () => {
    const entry = resolveEnemyCatalogEntry(DEFAULT_CATALOG, 'spinny');
    const placed = instantiateEnemyAt(entry, { x: 0, y: 0 }, 'turret');
    // Even if the entry's defaultProps.archetype was 'spinny', the caller
    // asked for turret — the helper stamps the requested archetype.
    expect((placed.props as { archetype: string }).archetype).toBe('turret');
  });

  it('does not synthesize a patrolPath for turret (no default patrol)', () => {
    const entry = resolveEnemyCatalogEntry(DEFAULT_CATALOG, 'turret');
    const placed = instantiateEnemyAt(entry, { x: 100, y: 100 }, 'turret');
    const params = (placed.props as { params: Record<string, unknown> }).params;
    expect(params.patrolPath).toBeUndefined();
  });

  it('falls back gracefully for an unknown archetype using the generic enemy entry', () => {
    const entry = resolveEnemyCatalogEntry(DEFAULT_CATALOG, 'customBoss');
    const placed = instantiateEnemyAt(entry, { x: 50, y: 50 }, 'customBoss');
    expect(placed.rect).toEqual({ x: 50, y: 50, width: 16, height: 16 });
    expect((placed.props as { archetype: string }).archetype).toBe('customBoss');
  });

  it('returns props suitable for an addEntity op (compileEnemies-compatible)', () => {
    const entry = resolveEnemyCatalogEntry(DEFAULT_CATALOG, 'spinny');
    const placed = instantiateEnemyAt(entry, { x: 100, y: 100 }, 'spinny');
    // The props bag must be acceptable as LevelEntity enemy props: an
    // `archetype` string and a `params` record.
    const props = placed.props as { archetype: unknown; params: unknown };
    expect(typeof props.archetype).toBe('string');
    expect(props.params).toBeTruthy();
    expect(typeof props.params).toBe('object');
  });

  it('pure: identical placements produce equal but independent records', () => {
    const entry = resolveEnemyCatalogEntry(DEFAULT_CATALOG, 'spinny');
    const a = instantiateEnemyAt(entry, { x: 100, y: 100 }, 'spinny');
    const b = instantiateEnemyAt(entry, { x: 100, y: 100 }, 'spinny');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.props).not.toBe(b.props);
  });
});

describe('shouldRenderEntityInPlay (regression: authored enemies double-drawn)', () => {
  function entityOf(kind: LevelEntity['kind']): LevelEntity {
    return {
      id: 1,
      kind,
      rect: { x: 0, y: 0, width: 16, height: 16 },
      props: kind === 'exit' ? { isTrap: false, locked: false } : {},
    } as LevelEntity;
  }

  it('returns false for enemy (runtime drawEnemies owns enemy rendering)', () => {
    expect(shouldRenderEntityInPlay(entityOf('enemy'))).toBe(false);
  });

  it('returns false for spawn (player marker IS the spawn in play mode)', () => {
    expect(shouldRenderEntityInPlay(entityOf('spawn'))).toBe(false);
  });

  it('returns true for platform / passthrough / hazard / trap / exit / decoration / trigger / movingPlatform', () => {
    const kinds: LevelEntity['kind'][] = [
      'platform',
      'passthrough',
      'hazard',
      'trap',
      'exit',
      'decoration',
      'trigger',
      'movingPlatform',
    ];
    for (const kind of kinds) {
      expect(shouldRenderEntityInPlay(entityOf(kind))).toBe(true);
    }
  });

  it('pure: identical inputs always return the same result', () => {
    const e = entityOf('enemy');
    expect(shouldRenderEntityInPlay(e)).toBe(shouldRenderEntityInPlay(e));
  });
});

// ---------------------------------------------------------------------------
// Turret shootTo widget helpers
// ---------------------------------------------------------------------------

describe('computeShootToWidgetGeometry', () => {
  it('returns geometry for a valid shootTo', () => {
    const geom = computeShootToWidgetGeometry(100, 100, 16, 16, { x: 128, y: 0 });
    expect(geom).not.toBeNull();
    expect(geom!.centerX).toBeCloseTo(108, 5);
    expect(geom!.centerY).toBeCloseTo(108, 5);
    expect(geom!.endX).toBeCloseTo(236, 5);
    expect(geom!.endY).toBeCloseTo(108, 5);
    expect(geom!.dirX).toBeCloseTo(1, 5);
    expect(geom!.dirY).toBeCloseTo(0, 5);
    expect(geom!.maxRange).toBeCloseTo(128, 5);
    expect(geom!.labelText).toBe('128px');
  });

  it('returns null for missing shootTo', () => {
    expect(computeShootToWidgetGeometry(100, 100, 16, 16, null)).toBeNull();
    expect(computeShootToWidgetGeometry(100, 100, 16, 16, undefined)).toBeNull();
  });

  it('returns null for non-object shootTo', () => {
    expect(computeShootToWidgetGeometry(100, 100, 16, 16, 'invalid')).toBeNull();
  });

  it('returns null for zero-length shootTo', () => {
    expect(computeShootToWidgetGeometry(100, 100, 16, 16, { x: 0, y: 0 })).toBeNull();
  });

  it('returns null for non-finite shootTo component', () => {
    expect(computeShootToWidgetGeometry(100, 100, 16, 16, { x: NaN, y: 0 })).toBeNull();
    expect(computeShootToWidgetGeometry(100, 100, 16, 16, { x: 0, y: Infinity })).toBeNull();
  });

  it('preserves zero x-component {x:0, y:120}', () => {
    const geom = computeShootToWidgetGeometry(100, 100, 16, 16, { x: 0, y: 120 });
    expect(geom).not.toBeNull();
    expect(geom!.dirX).toBeCloseTo(0, 5);
    expect(geom!.dirY).toBeCloseTo(1, 5);
    expect(geom!.maxRange).toBeCloseTo(120, 5);
  });

  it('pure: identical inputs produce equal but independent outputs', () => {
    const a = computeShootToWidgetGeometry(100, 100, 16, 16, { x: 128, y: 0 });
    const b = computeShootToWidgetGeometry(100, 100, 16, 16, { x: 128, y: 0 });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('hitTestShootToEndpoint', () => {
  const cx = 108;
  const cy = 108;
  const shootTo = { x: 128, y: 0 };
  const hitRadius = SHOOT_TO_WIDGET_CONFIG.hitRadius;

  it('returns true when mouse is on the endpoint', () => {
    // endpoint = center + shootTo = (236, 108)
    expect(hitTestShootToEndpoint({ x: 236, y: 108 }, cx, cy, shootTo, hitRadius)).toBe(true);
  });

  it('returns false when mouse is far from endpoint', () => {
    expect(hitTestShootToEndpoint({ x: 0, y: 0 }, cx, cy, shootTo, hitRadius)).toBe(false);
  });

  it('returns false for null shootTo', () => {
    expect(hitTestShootToEndpoint({ x: 236, y: 108 }, cx, cy, null, hitRadius)).toBe(false);
  });

  it('returns false for zero-length shootTo', () => {
    expect(hitTestShootToEndpoint({ x: 108, y: 108 }, cx, cy, { x: 0, y: 0 }, hitRadius)).toBe(false);
  });
});

describe('computeShootToFromEndpoint', () => {
  it('returns the relative vector from center to endpoint', () => {
    const result = computeShootToFromEndpoint(236, 108, 108, 108);
    expect(result).toEqual({ x: 128, y: 0 });
  });

  it('handles negative offsets', () => {
    const result = computeShootToFromEndpoint(50, 50, 108, 108);
    expect(result).toEqual({ x: -58, y: -58 });
  });
});

describe('shouldShowShootToWidget', () => {
  function turretEntity(shootTo: unknown): LevelEntity {
    return {
      id: 1,
      kind: 'enemy',
      rect: { x: 100, y: 100, width: 16, height: 16 },
      props: { archetype: 'turret', params: { shootTo } },
    } as LevelEntity;
  }

  it('returns true for turret with valid shootTo', () => {
    expect(shouldShowShootToWidget(turretEntity({ x: 128, y: 0 }))).toBe(true);
  });

  it('returns false for turret with zero shootTo', () => {
    expect(shouldShowShootToWidget(turretEntity({ x: 0, y: 0 }))).toBe(false);
  });

  it('returns false for turret with no shootTo', () => {
    const entity: LevelEntity = {
      id: 1,
      kind: 'enemy',
      rect: { x: 100, y: 100, width: 16, height: 16 },
      props: { archetype: 'turret', params: {} },
    } as LevelEntity;
    expect(shouldShowShootToWidget(entity)).toBe(false);
  });

  it('returns false for non-turret enemy', () => {
    const entity: LevelEntity = {
      id: 1,
      kind: 'enemy',
      rect: { x: 100, y: 100, width: 16, height: 16 },
      props: { archetype: 'spinny', params: {} },
    } as LevelEntity;
    expect(shouldShowShootToWidget(entity)).toBe(false);
  });

  it('returns false for non-enemy entity', () => {
    const entity: LevelEntity = {
      id: 1,
      kind: 'platform',
      rect: { x: 100, y: 100, width: 32, height: 16 },
      props: {},
    } as LevelEntity;
    expect(shouldShowShootToWidget(entity)).toBe(false);
  });

  it('returns false for turret with malformed shootTo', () => {
    expect(shouldShowShootToWidget(turretEntity('invalid'))).toBe(false);
    expect(shouldShowShootToWidget(turretEntity({ x: NaN, y: 0 }))).toBe(false);
  });
});
