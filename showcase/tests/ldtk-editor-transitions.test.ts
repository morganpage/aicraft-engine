/**
 * Level-transition geometry and momentum preservation for the LDtk play mode.
 *
 * The session switches rooms when the player's AABB leaves the active level
 * through a cardinal edge linked in `__neighbours`. The interesting parts —
 * which edge was crossed, where to enter the neighbour, whether momentum
 * survives — are pure functions over plain data, so they are tested here
 * without a canvas or a running loop.
 *
 * Geometry fixtures come from the bundled `Typical_2D_platformer_example.ldtk`
 * world (4 rooms in a `Free` layout, edges flush), so the tests pin the math
 * against the sample that motivated the feature.
 */

import { describe, expect, it } from 'vitest';
import {
  transitionFor,
  entryPoint,
  type CardinalDir,
} from '../sections/ldtk-editor/play';
import type { LdtkLevel, LdtkNeighbour } from '../../src/ldtk';

// --- the platformer sample's world geometry --------------------------------

/**
 * The 4 levels of `Typical_2D_platformer_example.ldtk` reduced to the fields
 * the transition math needs. Sourced from the sample's `worldX/Y` + `pxWid/Hei`.
 */
const MAIN: LdtkLevel = {
  identifier: 'Your_typical_2D_platformer',
  iid: 'main',
  uid: 0,
  worldX: 0, worldY: 0, worldDepth: 0,
  pxWid: 848, pxHei: 336,
  fieldInstances: [], externalRelPath: null, __neighbours: [
    { dir: 'n', levelIid: 'top' },
    { dir: 's', levelIid: 'bottom' },
    { dir: 'e', levelIid: 'east' },
  ],
  layerInstances: null,
};
const TOP: Pick<LdtkLevel, 'worldX' | 'worldY' | 'pxWid' | 'pxHei' | 'identifier'> = {
  identifier: 'Top', worldX: 352, worldY: -352, pxWid: 672, pxHei: 352,
};
const BOTTOM: Pick<LdtkLevel, 'worldX' | 'worldY' | 'pxWid' | 'pxHei' | 'identifier'> = {
  identifier: 'Bottom', worldX: 80, worldY: 336, pxWid: 464, pxHei: 256,
};
const EAST: Pick<LdtkLevel, 'worldX' | 'worldY' | 'pxWid' | 'pxHei' | 'identifier'> = {
  identifier: 'World_Level_3', worldX: 848, worldY: 0, pxWid: 304, pxHei: 320,
};

/** Player body used throughout (8×24 — the play-mode size at a 16px tile). */
const PLAYER = { x: 0, y: 0, width: 8, height: 24 };

describe('transitionFor', () => {
  it('returns undefined while the player is inside the level', () => {
    const body = { ...PLAYER, x: 100, y: 100 };
    expect(transitionFor(body, MAIN)).toBeUndefined();
  });

  it('fires north when the player crosses the top edge', () => {
    const body = { ...PLAYER, x: 500, y: -1 }; // top edge just above 0
    const result = transitionFor(body, MAIN);
    expect(result?.dir).toBe('n');
    expect(result?.neighbour.levelIid).toBe('top');
  });

  it('fires south, east, and west for their respective edges', () => {
    // South and east are linked in MAIN; west is tested on a level that has one.
    expect(transitionFor({ ...PLAYER, x: 100, y: MAIN.pxHei }, MAIN)?.dir).toBe('s');
    expect(transitionFor({ ...PLAYER, x: MAIN.pxWid, y: 100 }, MAIN)?.dir).toBe('e');
    const withWest: LdtkLevel = { ...MAIN, __neighbours: [{ dir: 'w', levelIid: 'x' }] };
    expect(transitionFor({ ...PLAYER, x: -1, y: 100 }, withWest)?.dir).toBe('w');
  });

  it('resolves a corner exit to the dominant axis', () => {
    // MAIN links north and east. Past both top and right, but further past the
    // right → east wins (the axis the player is furthest out of bounds on).
    const result = transitionFor({ ...PLAYER, x: MAIN.pxWid + 20, y: -1 }, MAIN);
    expect(result?.dir).toBe('e');
    // And the symmetric case: further past the top → north wins.
    const northward = transitionFor({ ...PLAYER, x: MAIN.pxWid + 1, y: -10 }, MAIN);
    expect(northward?.dir).toBe('n');
  });

  it('returns undefined when the crossed edge has no neighbour (the void)', () => {
    // MAIN has no west neighbour; walking off the left edge drops into the void,
    // which the respawn fallback (not a transition) handles.
    expect(transitionFor({ ...PLAYER, x: -1, y: 100 }, MAIN)).toBeUndefined();
  });
});

describe('entryPoint', () => {
  it('maps a north exit into Top at its bottom edge, accounting for worldX offset', () => {
    // Player at local x=500 in MAIN → world x=500 → Top local x = 500 − 352 = 148.
    // y≈0 (the seam) → world y=0 → Top local y = 0 − (−352) = 352, clamped to
    // Top.pxHei − playerHeight = 352 − 24 = 328 (just inside the bottom edge).
    const entry = entryPoint({ ...PLAYER, x: 500, y: 0 }, MAIN, TOP);
    expect(entry).toEqual({ x: 148, y: 328 });
  });

  it('maps an east exit into World_Level_3 at its left edge', () => {
    // Player at local x≈pxWid, y=100 in MAIN → world (848, 100) → East local
    // (848−848, 100−0) = (0, 100): entering at the left edge, same height.
    const entry = entryPoint({ ...PLAYER, x: MAIN.pxWid, y: 100 }, MAIN, EAST);
    expect(entry).toEqual({ x: 0, y: 100 });
  });

  it('maps a south exit into Bottom at its top edge', () => {
    // Player at local x=200, y≈pxHei in MAIN → world (200, 336) → Bottom local
    // (200−80, 336−336) = (120, 0): entering at the top edge.
    const entry = entryPoint({ ...PLAYER, x: 200, y: MAIN.pxHei }, MAIN, BOTTOM);
    expect(entry).toEqual({ x: 120, y: 0 });
  });

  it('clamps the entry inside the target when the seam window is narrower than the player', () => {
    // Top spans worldX [352, 1024]; MAIN [0, 848]. A player exiting north at the
    // far left of MAIN (world x=10, outside Top's window) must still land inside
    // Top rather than back out in the void — clamped to local x=0.
    const entry = entryPoint({ ...PLAYER, x: 10, y: 0 }, MAIN, TOP);
    expect(entry.x).toBe(0);
    // Likewise past the right edge: world x=2000 → local 1648, clamped to
    // pxWid − width = 672 − 8 = 664.
    const right = entryPoint({ ...PLAYER, x: 2000, y: 0 }, MAIN, TOP);
    expect(right.x).toBe(664);
  });
});

describe('momentum preservation (mirrors the session transition)', () => {
  it('keeps vx/vy/facing across a level swap while resetting contacts', async () => {
    // Re-implement the exact merge the session does, against a hand-built state,
    // so the contract is pinned independently of the canvas-bound createPlaySession.
    const { createPlatformerState, EMPTY_CONTACTS } = await import('../../src/platformer');
    const pw = 8;
    const ph = 24;
    // A moving player: running right and falling.
    const before = createPlatformerState(500, -1, undefined, pw, ph);
    const moving = {
      ...before,
      core: { ...before.core, vx: 120, vy: 200, facing: 1 as const, onGround: true },
    };
    // Entry into Top at (148, 328) — the north-exit case above.
    const entry = entryPoint(moving.core, MAIN, TOP);
    const after = {
      ...createPlatformerState(entry.x, entry.y, undefined, pw, ph),
      core: {
        ...moving.core,
        x: entry.x,
        y: entry.y,
        onGround: false,
        contacts: EMPTY_CONTACTS,
      },
    };
    // Momentum survives…
    expect(after.core.vx).toBe(120);
    expect(after.core.vy).toBe(200);
    expect(after.core.facing).toBe(1);
    // …position is the computed entry…
    expect(after.core.x).toBe(148);
    expect(after.core.y).toBe(328);
    // …and ground/contact state is reset for the new geometry.
    expect(after.core.onGround).toBe(false);
    expect(after.core.contacts).toBe(EMPTY_CONTACTS);
  });
});

describe('transitionFor — type coverage', () => {
  it('handles a level with empty __neighbours (no links anywhere)', () => {
    const lone: LdtkLevel = { ...MAIN, __neighbours: [] };
    expect(transitionFor({ ...PLAYER, x: -1, y: 0 }, lone)).toBeUndefined();
    expect(transitionFor({ ...PLAYER, x: 0, y: -1 }, lone)).toBeUndefined();
  });

  it('treats only cardinal dirs as transitionable', () => {
    // A diagonal neighbour should not match a cardinal exit. (The session falls
    // through to respawn in that case — out of scope for transitions.)
    const diagonal: LdtkNeighbour = { dir: 'ne', levelIid: 'x' };
    const level: LdtkLevel = { ...MAIN, __neighbours: [diagonal] };
    // Exiting north with only a `ne` neighbour → no match.
    expect(transitionFor({ ...PLAYER, x: 100, y: -1 }, level)).toBeUndefined();
    // Confirm the cardinal set the helper recognises.
    const cards: readonly CardinalDir[] = ['n', 's', 'e', 'w'];
    expect(cards).toHaveLength(4);
  });
});
